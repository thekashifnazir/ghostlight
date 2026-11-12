/* Ghostlight — accessibility layer for the ScummVM Drascula engine
 *
 * Copyright (C) 2026 Ghostlight contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This file is NEW code added to a GPL ScummVM fork. It is copied into the
 * pinned checkout under vendor/ by scripts/build-engine.sh. Never edit vendor/.
 */

#include "common/config-manager.h"
#include "common/fs.h"
#include "common/path.h"
#include "common/stream.h"
#include "common/str.h"
#include "common/system.h"
#include "common/textconsole.h"
#include "common/util.h"

#include "drascula/drascula.h"
#include "drascula/a11y.h"

namespace Drascula {

// True when the chapter 5 plug (item 16) is held on the cursor. The original
// game deliberately keeps it there: selectVerb() will not stow item 16 in
// chapter 5 (the fix for ScummVM bug #3885), and the player clicks the held
// plug on the wall socket. The a11y layer must not stow it (that throws it
// away), must accept it as a `use` item, and reports it as carried.
static bool isHeldPlug(const DrasculaEngine *e) {
	return e->currentChapter == 5 && e->takeObject == 1 && e->pickedObject == 16;
}

// Monotonic count of `A11Y_ERR ` lines emitted. The diff layer (task 17) needs
// to know whether the command it just ran failed, because a command that erred
// emits an A11Y_ERR and NO A11Y_DIFF (the replay fixtures and the task-22
// invariant: exactly one diff XOR at least one err, never both). Rather than
// thread an "errored" flag through every dispatch path (errors are reported
// from ~20 call sites), emitLine() bumps this counter whenever it writes an
// A11Y_ERR line, so the diff builder can compare the count before and after a
// dispatch and suppress the diff when it rose. Module-local and single-threaded
// (the engine runs one frame at a time), so no synchronisation is needed.
static uint32 g_errCount = 0;

// Wall-clock time (g_system->getMillis()) of the last line emitLine() wrote.
// ANY a11y output — an A11Y room line, an A11Y_DIFF, A11Y_TEXT, a `said` line,
// an A11Y_PHASE, an A11Y_ERR — stamps this. The busy watchdog measures its
// stall from max(_lastPollMs, g_lastEngineOutputMs): a legitimate long cutscene
// that is still making progress (e.g. the Von Braun history, animation_16_2,
// which draws a fresh picture about every 6 s WITHOUT returning control to the
// main loop, so poll() never runs and _lastPollMs freezes) keeps stamping this
// through each A11Y_TEXT/`said` line, so the watchdog sees recent activity and
// does NOT trip. The watchdog fires only when poll() is stale AND no line has
// been emitted for the whole window — a truly silent dead state. Module-local
// and single-threaded, like g_errCount, so no synchronisation is needed. It is
// a module static because emitLine() is a file-scope helper (not a member), so
// it has no `this` to stamp; the watchdog, a member, reads it alongside the
// member _lastPollMs. 0 means nothing has been emitted yet.
static uint32 g_lastEngineOutputMs = 0;

// --- Cross-chapter diff carrier (task 17/18, R4.3 / design "Settling") ------
//
// A chapter-ending `walk` (chapter 1's door 105, chapter 2's crossings) or a
// verb / `use` whose checkAction() returned true (chapters 3 to 6) ends the
// chapter and tears down this layer (it lives on the stack of runCurrentChapter())
// BEFORE the next chapter's first room (for chapter 1, chapter 2 room 14) is set
// up, so the ending chapter's layer cannot build the crossing's A11Y_DIFF itself:
// the "after" state does not exist yet when it is destroyed.
//
// Instead the ending chapter's layer, at the moment it detects the crossing, stashes
// the before-snapshot, the `cmd` string, the error-count baseline and the
// `said` lines captured during the cutscene into this module-static carrier
// (module-static so it survives the layer's destruction, like g_errCount). The
// NEXT chapter's layer, once its first room is fully set up, emits ONE
// A11Y_DIFF from the carrier in onStartup() — chapter [1,2], room [62,14], the
// new room's objects — instead of a plain A11Y room-state line. This is what
// makes the chapter-crossing walk yield exactly one coherent diff (R4.3), and
// matches the leave-tavern fixture and the spike transcript.
//
// The carrier mirrors the Snapshot fields the diff needs (Snapshot is a private
// nested type, so we store its parts here) plus the captured said lines.
struct CrossChapterDiff {
	bool pending;
	Common::String cmd;
	uint32 errCountBefore;
	// before-snapshot parts
	int chapter;
	int room;
	int heroX;
	int heroY;
	Common::Array<int> objNums;
	Common::Array<bool> objVisible;
	Common::Array<bool> objDoor;
	Common::Array<int> inventory;
	int flags[NUM_FLAGS];
	// said lines captured during the crossing cutscene (colour, text pairs)
	Common::Array<Common::String> saidColor;
	Common::Array<Common::String> saidText;
	// voiced flag per captured said line, parallel to saidColor/saidText, so a
	// crossing cutscene's voiced lines keep their marking through the carrier.
	Common::Array<bool> saidVoiced;

	CrossChapterDiff() : pending(false), errCountBefore(0), chapter(0), room(0),
	                     heroX(0), heroY(0) {
		for (int f = 0; f < NUM_FLAGS; f++)
			flags[f] = 0;
	}
};

// The single process-lifetime carrier, reached through g_crossDiff(). Held by
// a lazily-constructed pointer rather than a static object so no global
// constructor/destructor runs at load/exit (ScummVM builds with
// -Wglobal-constructors). It lives for the whole process — the crossing data it
// carries is handed from one chapter's layer to the next and is never needed
// after that — so the one-time allocation is deliberately not freed.
static CrossChapterDiff &g_crossDiff() {
	static CrossChapterDiff *instance = new CrossChapterDiff();
	return *instance;
}

// All a11y output is one prefixed line on stderr, so a web page reads it via
// Module.printErr and a native run reads it on fd 2 (Requirement 10.6). We go
// through g_system->logMessage() with the error type because, on the SDL
// backend, kInfo/kDebug go to stdout while everything else goes to stderr
// (backends/platform/sdl/sdl.cpp). logMessage adds no prefix of its own — the
// "WARNING:"/"ERROR:" text is added by the warning()/error() callers, not here
// — so each A11Y line comes out clean and parseable line by line (R1.6).
static void emitLine(const Common::String &line) {
	// Track error lines so the diff layer can tell a command failed and skip
	// the diff (exactly one A11Y_DIFF XOR at least one A11Y_ERR per command).
	if (line.hasPrefix("A11Y_ERR"))
		g_errCount++;

	if (!g_system)
		return;

	// Stamp the engine-output liveness clock BEFORE writing: any emitted line is
	// a sign of life the busy watchdog counts (Fix C tuning), so a legitimate
	// slow cutscene that is still drawing text keeps the watchdog quiet even
	// though poll() is not running. Stamped only when g_system exists, the same
	// guard the write below uses, so the stamp and the write stay in lock-step.
	g_lastEngineOutputMs = g_system->getMillis();

	Common::String out = line + "\n";
	g_system->logMessage(LogMessageType::kError, out.c_str());
}

// Escape a string for embedding in a JSON double-quoted value. The engine's
// object and item names come straight from the game data and are plain ASCII
// in practice (including the Spanish names like ESCALERA, gotcha 10), but a
// control character or a stray quote would break line-by-line parsing (R1.6),
// so we escape defensively.
static Common::String jsonEscape(const char *s) {
	Common::String out;
	for (const char *p = s; p && *p; p++) {
		unsigned char c = (unsigned char)*p;
		switch (c) {
		case '"':  out += "\\\""; break;
		case '\\': out += "\\\\"; break;
		case '\n': out += "\\n";  break;
		case '\r': out += "\\r";  break;
		case '\t': out += "\\t";  break;
		default:
			if (c < 0x20)
				out += Common::String::format("\\u%04x", c);
			else
				out += (char)c;
		}
	}
	return out;
}

// Parse a whole-string signed integer. Defined below (used by both the `use`
// and `walk` dispatchers); forward-declared here so dispatchUse can call it.
static bool parseInt(const Common::String &s, int &out);

A11yLayer::A11yLayer(DrasculaEngine *engine)
	: _engine(engine), _lastChapter(-1), _lastRoom(-1), _capturingSaid(false),
	  _converseActive(false), _converseNeedChoices(false), _choicePressed(false),
	  _choiceDiffPending(false), _choiceErrCount(0),
	  _mainCmdDiffPending(false), _mainCmdOpenedConverse(false), _mainCmdErrCount(0),
	  _queueHead(0), _inRunCommand(false), _lastSkipPollMs(0),
	  _clickState(kClickIdle), _lastPhase(kPhaseNone), _probe(nullptr),
	  _lastPollMs(0), _watchdogStage(0), _watchdogBaseMs(0),
	  _walkGuardArmed(false) {
	for (int i = 0; i < 4; i++)
		_choiceBottom[i] = 0;
	// The per-engine "player in control" probe the phase logic reads. This is
	// the Drascula implementation; porting the layer to another game swaps only
	// this line (and the probe class), not any phase logic. Owned by the layer;
	// freed in the destructor.
	_probe = new DrasculaControlProbe(this);
	// Register as the engine's current a11y layer so the centerText() hook in
	// graphics.cpp can reach us (the hook has only the DrasculaEngine `this`,
	// not this stack-local layer). _lastText default-constructs empty, so the
	// first drawn line is always emitted.
	_engine->_a11y = this;
}

// Unregister on destruction. The layer lives on the stack in
// runCurrentChapter(), so this fires on every return path from that function;
// clearing the engine's pointer means a centerText() call made after the layer
// is gone (e.g. between chapters) safely does nothing rather than dereferencing
// a dangling layer. Guarded so we only clear the pointer if it still refers to
// us, in case chapters ever nest.
A11yLayer::~A11yLayer() {
	if (_engine->_a11y == this)
		_engine->_a11y = nullptr;
	delete _probe;
	_probe = nullptr;
}

// Capture one whole on-screen text line (R6.2). Called from the centerText()
// hook with the full message the engine is about to draw — spoken dialogue,
// narration, system text and hover/examine text all pass through centerText()
// (gotcha 11: talk.cpp routes nothing through sayText(), so this is the only
// capture point for character replies). The string is emitted verbatim: it is
// the engine's own text for whatever data is loaded (English subtitle text, or
// the raw Spanish object names, gotcha 10), never altered here.
//
// centerText() is called once per frame for the full duration a line is on
// screen (the talk loops call it inside `do { ... } while (!isTalkFinished())`),
// so onText() de-duplicates: it emits only when the message differs from the
// last line emitted, so each distinct line appears once when it is drawn, not
// once per frame. A null or empty message is ignored (nothing was drawn).
void A11yLayer::onText(const char *message) {
	if (!message || !*message)
		return;

	// Same line as last time (the engine is still redrawing the current
	// subtitle this frame) — already reported, so stay quiet.
	if (_lastText == message)
		return;

	_lastText = message;

	// Voiced-line marking (speech fix 1). A character line drawn by a talk loop
	// is preceded by talkInit()->playFile(), which starts the actor's recorded
	// voice sample; soundIsActive() is true for the whole time that sample
	// plays (talk.cpp). When a voice is playing, the drawn line is being spoken
	// aloud by the game, so the player's screen reader reading the same subtitle
	// over it is overwhelming (the real VoiceOver playtest). Mark such a line
	// with the distinct prefix `A11Y_VTEXT` so the player can suppress the
	// screen-reader echo by default; an UNVOICED line keeps the exact
	// `A11Y_TEXT` prefix as before, so nothing a voice does not cover changes.
	const bool voiced = _engine->soundIsActive();
	emitLine(Common::String(voiced ? "A11Y_VTEXT " : "A11Y_TEXT ") + message);

	// Task 17 (R4.7): while a command's dispatch window is open, attribute each
	// distinct drawn line to that command's diff `said`, with the engine's own
	// text colour for the line (_color is set by the talker/narrator before
	// centerText() draws). The de-dup above means each distinct line is appended
	// exactly once, in draw order, so the diff's `said` mirrors what the player
	// heard during the command. Text drawn outside a command (an idle hover
	// name) is still emitted as A11Y_TEXT above but is not attributed here. The
	// same voiced flag is carried on the said entry, so the settling diff's
	// `said` tells the player which lines were voiced (and the player's said
	// de-dup can suppress a voiced line consistently whether it matches a
	// streamed line or arrives only via the diff).
	if (_capturingSaid) {
		SaidLine s;
		s.color = colorName(_engine->_color);
		s.text = message;
		s.voiced = voiced;
		_said.push_back(s);
	}
}

// Called once at startup, after the intro has been skipped and the first
// playable room has been entered and the hero positioned. Asserts subtitles
// are on (gotcha 1 / R6.1) and emits the first room's A11Y state line (R1.4).
void A11yLayer::onStartup() {
	// R6.1 / gotcha 1: the game only draws on-screen text when subtitles are
	// on. Without them no A11Y_TEXT can ever be captured, so warn loudly and
	// keep going — the room/diff machinery still works, only spoken/handwritten
	// text is lost.
	if (!ConfMan.getBool("subtitles")) {
		emitLine("A11Y_ERR subtitles are off; no on-screen text will be captured. "
		         "Relaunch with --subtitles.");
	}

	// If the previous chapter ended on a chapter-crossing `walk` (door 105 ->
	// animation_2_1 -> chapter 2), the previous layer stashed the before-state;
	// emit the one coherent crossing A11Y_DIFF now that this chapter's first
	// room is live, INSTEAD of a plain room-state line. The leave-tavern fixture
	// and spike transcript show the crossing as a single diff with no A11Y line
	// (R4.3, design "Settling").
	if (emitPendingCrossChapterDiff())
		return;

	// Normal chapter start (no pending crossing): emit the first playable room
	// exactly as a room entry would, so the very first line an external reader
	// sees is a complete A11Y room state.
	onRoomEntry();
}

// Build the full room-state JSON object as a single line (R1.1, R1.2, R1.3,
// R1.6, R5.*). The same code backs both room entry (onRoomEntry) and the
// `dump`/`state` command (R1.5), so an external reader sees identical state
// whichever triggered it.
//
// Shape (design.md "A11Y room state"):
//   {"chapter":1,"room":62,"hero":{"x":171,"y":158},
//    "objects":[{"num":52,"name":"BARTENDER","rect":[x,y,w,h],
//                "walkTo":[x,y],"visible":true,"door":false}, ...
//               {"num":105,...,"door":true,"toRoom":63}],
//    "inventory":[28],"flags":[0,0,...]}
// Build the JSON object for the room object in `slot`, in the shape used by
// both the room-state line and the diff's objects/appeared/disappeared/doors
// lists (R1.3, R4.3, R4.4):
//   {"num":52,"name":"BARTENDER","rect":[x,y,w,h],"walkTo":[x,y],
//    "visible":true,"door":false[,"toRoom":63]}
// rect is [x, y, w, h]; the engine stores a Common::Rect(left, top, right,
// bottom), so width()/height() give the size. A door also carries toRoom.
Common::String A11yLayer::objectJson(int slot) const {
	DrasculaEngine *e = _engine;

	const Common::Rect &r = e->_objectRect[slot];
	const Common::Point &w = e->_roomObject[slot];

	Common::String json = Common::String::format(
		"{\"num\":%d,\"name\":\"%s\",\"rect\":[%d,%d,%d,%d],"
		"\"walkTo\":[%d,%d],\"visible\":%s,\"door\":%s",
		e->objectNum[slot],
		jsonEscape(e->objName[slot]).c_str(),
		r.left, r.top, r.width(), r.height(),
		w.x, w.y,
		e->visible[slot] ? "true" : "false",
		e->isDoor[slot] ? "true" : "false");

	if (e->isDoor[slot])
		json += Common::String::format(",\"toRoom\":%d", e->_doorDestRoom[slot]);

	json += "}";
	return json;
}

// Map a Drascula text colour (the `Colors` enum in drascula.h, as held in
// _color when a line is drawn) to the lower-case name the design's `said` field
// uses. The game's palette indices 1..11 are the named colours; anything else
// is reported as "color<N>" so no line is dropped and the raw value survives.
Common::String A11yLayer::colorName(int color) const {
	switch (color) {
	case kColorBrown:      return "brown";
	case kColorDarkBlue:   return "darkblue";
	case kColorLightGreen: return "lightgreen";
	case kColorDarkGreen:  return "darkgreen";
	case kColorYellow:     return "yellow";
	case kColorOrange:     return "orange";
	case kColorRed:        return "red";
	case kColorMaroon:     return "maroon";
	case kColorPurple:     return "purple";
	case kColorWhite:      return "white";
	case kColorPink:       return "pink";
	default:               return Common::String::format("color%d", color);
	}
}

// Begin capturing spoken/narration lines for a command: clear the per-command
// buffer and arm onText() to append to it. Called at the top of a command's
// dispatch window so the diff carries only this command's text (R4.7).
void A11yLayer::beginSaidCapture() {
	_said.clear();
	_capturingSaid = true;
}

// Snapshot the engine's live state into `snap` for the before/after diff (R4).
// Captures only what the diff reports: chapter, room, the visible room objects
// (by engine number + visible/door flags), the inventory item ids (>= 7,
// gotcha 7), and all 50 flags verbatim (flag 12 included — gotcha 8). Cheap
// enough to take on the stack each command; holds no engine references.
void A11yLayer::takeSnapshot(Snapshot &snap) const {
	DrasculaEngine *e = _engine;

	snap.chapter = e->currentChapter;
	snap.room = e->_roomNumber;

	// Hero point (R5.2/R5.3) — the SAME point buildRoomState() reports, via the
	// shared helpers, so the room state and the diff's optional `hero` field can
	// never drift (task 30, R5.1).
	snap.heroX = heroX();
	snap.heroY = heroY();

	snap.objNums.clear();
	snap.objVisible.clear();
	snap.objDoor.clear();
	for (int l = 0; l < e->numRoomObjs; l++) {
		// Refresh any flag-gated door for this slot before reading isDoor[l], so
		// the door state captured here matches what exitRoom()/walkObject() will
		// act on. In chapters 2 and 4 isDoor is only kept current by updateDoor()
		// (rooms.cpp doors[] table); without this a gated door that has been
		// unlocked would still read as closed in the diff. No-op elsewhere.
		e->updateDoor(l);
		snap.objNums.push_back(e->objectNum[l]);
		snap.objVisible.push_back(e->visible[l]);
		snap.objDoor.push_back(e->isDoor[l]);
	}

	snap.inventory.clear();
	for (int n = 1; n < ARRAYSIZE(e->inventoryObjects); n++) {
		int id = e->inventoryObjects[n];
		if (id >= 7)
			snap.inventory.push_back(id);
	}
	// Chapter 5 plug held on the cursor counts as carried (see isHeldPlug()).
	if (isHeldPlug(e))
		snap.inventory.push_back(16);

	for (int f = 0; f < NUM_FLAGS; f++)
		snap.flags[f] = e->flags[f];
}

// The hero point: horizontal centre and foot of the hero sprite (R5.2), in the
// same coordinate space as the object rects and walk-to points (R5.3). One
// definition shared by buildRoomState(), takeSnapshot() and the diff's optional
// `hero` field (task 30) so the point is identical everywhere and can never
// drift. curX/curWidth/curY/curHeight are the hero sprite's live screen box.
int A11yLayer::heroX() const {
	return _engine->curX + _engine->curWidth / 2;
}

int A11yLayer::heroY() const {
	return _engine->curY + _engine->curHeight;
}

Common::String A11yLayer::buildRoomState() {
	DrasculaEngine *e = _engine;

	Common::String json = Common::String::format(
		"{\"chapter\":%d,\"room\":%d,\"hero\":{\"x\":%d,\"y\":%d},\"objects\":[",
		e->currentChapter, e->_roomNumber, heroX(), heroY());

	// Objects: indices 0 .. numRoomObjs-1 are the live room-object slots; the
	// parallel arrays (objectNum/objName/_objectRect/_roomObject/visible/isDoor/
	// _doorDestRoom) are all keyed on that same slot index (see rooms.cpp room
	// parse and objects.cpp checkObjects). Each object's JSON is built by
	// objectJson() so room state and the diff report an object identically.
	for (int l = 0; l < e->numRoomObjs; l++) {
		// Refresh any flag-gated door for this slot before objectJson() reads
		// isDoor[l], so the emitted exit list reflects doors the player has
		// unlocked. updateDoor() only acts in chapters 2 and 4 (rooms.cpp doors[]
		// table); it is a no-op everywhere else.
		e->updateDoor(l);
		if (l > 0)
			json += ",";
		json += objectJson(l);
	}

	// Inventory: slots 1..6 are the verb icons, not real items (gotcha 7), so
	// only ids >= 7 are reported (R1.2). inventoryObjects[0] is unused; a 0
	// entry is an empty slot.
	json += "],\"inventory\":[";
	bool firstItem = true;
	for (int n = 1; n < ARRAYSIZE(e->inventoryObjects); n++) {
		int id = e->inventoryObjects[n];
		if (id < 7)
			continue;
		if (!firstItem)
			json += ",";
		json += Common::String::format("%d", id);
		firstItem = false;
	}
	// Chapter 5 plug held on the cursor counts as carried (see isHeldPlug()).
	if (isHeldPlug(e)) {
		if (!firstItem)
			json += ",";
		json += "16";
	}

	// Flags: all 50, reported faithfully including flag 12's self-flipping
	// noise (gotcha 8) — cleaning up belongs to a later layer, not here.
	json += "],\"flags\":[";
	for (int f = 0; f < NUM_FLAGS; f++) {
		if (f > 0)
			json += ",";
		json += Common::String::format("%d", e->flags[f]);
	}
	json += "]}";

	return json;
}

// Emit the current room state as an `A11Y ` line and remember which
// chapter/room it describes, so poll() can detect the next room change.
void A11yLayer::emitRoomState() {
	emitLine(Common::String("A11Y ") + buildRoomState());
	_lastChapter = _engine->currentChapter;
	_lastRoom = _engine->_roomNumber;
}

// Called on every room entry; emits one `A11Y { ... }` room-state line (R1.1).
void A11yLayer::onRoomEntry() {
	emitRoomState();
}

// Backs the `dump`/`state` command (R1.5): emit the current room state in the
// same `A11Y ` format as a room entry. The command reader (a later task) calls
// this; it is intentionally identical to onRoomEntry() so a dump on demand and
// a dump on room entry are indistinguishable to an external reader.
void A11yLayer::dump() {
	emitRoomState();
}

// --- Snapshot diff and A11Y_DIFF emission (task 17, R4 / gotcha 8) ----------
//
// After a command settles, this builds ONE `A11Y_DIFF` line describing what
// changed between the before-snapshot (taken in poll()/the converse hook just
// before dispatch) and the engine's current, settled state. Shape and field
// order follow design.md "A11Y_DIFF" and the recorded spike transcripts:
//
//   {"cmd":..,"chapter":[from,to],"room":[from,to],"objects":[ newroom ],
//    "appeared":[..],"disappeared":[..],"doors":[..],
//    "invAdded":[{id,name}],"invRemoved":[{id,name}],
//    "flags":{"idx":[from,to]},"said":[{color,text}],"changed":bool}
//
// Rules the fixtures pin down:
//   * A command that emitted an A11Y_ERR gets NO diff (errCountBefore compare):
//     exactly one diff XOR at least one err per command.
//   * Room/chapter change (R4.3) reports [from,to] and the NEW room's objects
//     (doors carry toRoom); same-room visibility uses appeared/disappeared and
//     a door whose state changed goes in doors (R4.4). On a room change the
//     appeared/disappeared/doors sets are not emitted — the whole object list
//     replaces them.
//   * Inventory gained/lost (R4.5) is invAdded/invRemoved, each {id,name} in
//     ascending id order; name from itemName().
//   * Flags (R4.6) are reported as {"idx":[from,to]} in ascending index order,
//     flag 12 INCLUDED faithfully (gotcha 8 — the engine layer reports it; a
//     later layer filters it).
//   * `said` (R4.7) carries each spoken line with its colour, in draw order.
//   * `changed` (R4.8) is true iff a REAL change moved — any of room/chapter/
//     object visibility/doors/inventory, or a flag OTHER than flag 12. Flag 12
//     alone and `said` alone do NOT make a command "changed": flag 12 is
//     animation noise (gotcha 8) and speech is not a world change. So a look
//     that only speaks a line and flips flag 12 is `changed:false`, yet still
//     reports the flag-12 move and the said line faithfully.
void A11yLayer::emitDiff(const Common::String &cmd, const Snapshot &before,
                         uint32 errCountBefore) {
	// The command emitted an error (and so no diff): exactly one diff XOR at
	// least one err. Still close the said-capture window so stray later text is
	// not misattributed, and drop any text the failed command happened to draw.
	if (g_errCount != errCountBefore) {
		_capturingSaid = false;
		_said.clear();
		return;
	}

	DrasculaEngine *e = _engine;

	// After-snapshot of the settled state.
	Snapshot after;
	takeSnapshot(after);

	const bool roomChanged = (after.room != before.room) ||
	                         (after.chapter != before.chapter);

	// `changed` accumulates only REAL moves (flag 12 and said excluded).
	bool changed = false;

	Common::String json = Common::String("A11Y_DIFF {\"cmd\":\"") +
	                      jsonEscape(cmd.c_str()) + "\"";

	// --- chapter / room change (R4.3) ---------------------------------------
	if (after.chapter != before.chapter) {
		json += Common::String::format(",\"chapter\":[%d,%d]",
		                               before.chapter, after.chapter);
		changed = true;
	}
	if (after.room != before.room) {
		json += Common::String::format(",\"room\":[%d,%d]",
		                               before.room, after.room);
		changed = true;
	}

	if (roomChanged) {
		// On a room change the whole new-room object list is reported (doors
		// carry toRoom); appeared/disappeared/doors are not used, because every
		// object is new to this room (R4.3). Objects are the live slots now.
		json += ",\"objects\":[";
		for (int l = 0; l < e->numRoomObjs; l++) {
			if (l > 0)
				json += ",";
			json += objectJson(l);
		}
		json += "]";
	} else {
		// --- same-room visibility + door changes (R4.4) ---------------------
		// Objects that became visible / hidden, and doors whose door/visible
		// state changed, keyed on the engine object number so a slot reshuffle
		// does not masquerade as a change. We compare the before-snapshot's
		// per-number visible/door flags against the live slots.
		Common::String appeared, disappeared, doors;

		for (int l = 0; l < e->numRoomObjs; l++) {
			int num = e->objectNum[l];

			// Refresh any flag-gated door before reading isDoor[l] live below, so
			// an action that set a door's gating flag is reported as the door
			// opening/closing (R4.4). Matches the refresh in takeSnapshot() that
			// produced the before-snapshot. No-op outside chapters 2 and 4.
			e->updateDoor(l);

			// Find this number in the before-snapshot.
			int bi = -1;
			for (uint k = 0; k < before.objNums.size(); k++) {
				if (before.objNums[k] == num) {
					bi = (int)k;
					break;
				}
			}

			bool wasVisible = (bi >= 0) ? before.objVisible[bi] : false;
			bool nowVisible = e->visible[l];

			if (nowVisible && !wasVisible) {
				if (!appeared.empty())
					appeared += ",";
				appeared += objectJson(l);
				changed = true;
			} else if (!nowVisible && wasVisible) {
				if (!disappeared.empty())
					disappeared += ",";
				disappeared += objectJson(l);
				changed = true;
			}

			// A door whose door-ness changed (a passage opened/closed) is
			// reported under doors (R4.4). Visible-state is handled above, so
			// this catches a door toggling while staying present.
			bool wasDoor = (bi >= 0) ? before.objDoor[bi] : false;
			if (e->isDoor[l] != wasDoor) {
				if (!doors.empty())
					doors += ",";
				doors += objectJson(l);
				changed = true;
			}
		}

		if (!appeared.empty())
			json += ",\"appeared\":[" + appeared + "]";
		if (!disappeared.empty())
			json += ",\"disappeared\":[" + disappeared + "]";
		if (!doors.empty())
			json += ",\"doors\":[" + doors + "]";
	}

	// --- hero moved (task 30, R5.1/R5.2/R5.3) -------------------------------
	// Sonar pans object pings relative to where the hero stands (R5), so when a
	// command moved the hero (a `walk` to a free point or through a door) the
	// diff carries the hero's NEW point — same point as the room state (R5.2),
	// same coordinate space as object rects/walkTo (R5.3). Emitted ONLY when the
	// hero moved, so every non-movement diff (look/talk/inventory/...) stays
	// byte-identical to before. The after-position is reported (where the hero
	// ended up), not a delta. A hero move alone does NOT set `changed` — this is
	// purely additional positional data; whatever moved `changed` (a room
	// change on a walk through a door) is handled by the existing rules above.
	// Placed right after the object fields and before invAdded for a stable,
	// readable field order.
	if (after.heroX != before.heroX || after.heroY != before.heroY) {
		json += Common::String::format(",\"hero\":{\"x\":%d,\"y\":%d}",
		                               after.heroX, after.heroY);
	}

	// --- inventory gained / lost (R4.5) -------------------------------------
	// invAdded: ids in `after` not in `before`; invRemoved: in `before` not in
	// `after`. Both in ascending id order with the item's name from itemName().
	// buildRoomState()/the snapshot already filter to real items (id >= 7).
	{
		Common::String added, removed;

		// Added.
		for (uint i = 0; i < after.inventory.size(); i++) {
			int id = after.inventory[i];
			bool inBefore = false;
			for (uint k = 0; k < before.inventory.size(); k++) {
				if (before.inventory[k] == id) { inBefore = true; break; }
			}
			if (!inBefore) {
				if (!added.empty())
					added += ",";
				added += Common::String::format("{\"id\":%d", id);
				Common::String nm = itemName(id);
				if (!nm.empty())
					added += Common::String::format(",\"name\":\"%s\"",
					                                 jsonEscape(nm.c_str()).c_str());
				added += "}";
				changed = true;
			}
		}

		// Removed.
		for (uint i = 0; i < before.inventory.size(); i++) {
			int id = before.inventory[i];
			bool inAfter = false;
			for (uint k = 0; k < after.inventory.size(); k++) {
				if (after.inventory[k] == id) { inAfter = true; break; }
			}
			if (!inAfter) {
				if (!removed.empty())
					removed += ",";
				removed += Common::String::format("{\"id\":%d", id);
				Common::String nm = itemName(id);
				if (!nm.empty())
					removed += Common::String::format(",\"name\":\"%s\"",
					                                   jsonEscape(nm.c_str()).c_str());
				removed += "}";
				changed = true;
			}
		}

		if (!added.empty())
			json += ",\"invAdded\":[" + added + "]";
		if (!removed.empty())
			json += ",\"invRemoved\":[" + removed + "]";
	}

	// --- flags (R4.6 / gotcha 8) --------------------------------------------
	// Every flag whose value changed, as {"idx":[from,to]} in ascending index
	// order. Flag 12 is reported faithfully (gotcha 8), but a flag-12-only move
	// does NOT set `changed` — it is known animation/timing noise that a later
	// layer filters; the raw layer reports it so downstream can decide.
	{
		Common::String flagsJson;
		for (int f = 0; f < NUM_FLAGS; f++) {
			if (after.flags[f] != before.flags[f]) {
				if (!flagsJson.empty())
					flagsJson += ",";
				flagsJson += Common::String::format("\"%d\":[%d,%d]",
				                                    f, before.flags[f], after.flags[f]);
				// Flag 12 is noise (gotcha 8): report it, but it alone is not a
				// "change" for the `changed` flag. Any other flag is a real move.
				if (f != 12)
					changed = true;
			}
		}
		if (!flagsJson.empty())
			json += ",\"flags\":{" + flagsJson + "}";
	}

	// --- said (R4.7) --------------------------------------------------------
	// The lines spoken/drawn during the command, in order, each with its colour.
	// Speech is not a world change, so it never sets `changed` (a line-only
	// command such as `look 102` is changed:false, per the transcript).
	if (!_said.empty()) {
		json += ",\"said\":[";
		for (uint i = 0; i < _said.size(); i++) {
			if (i > 0)
				json += ",";
			json += Common::String::format("{\"color\":\"%s\",\"text\":\"%s\"",
			                               jsonEscape(_said[i].color.c_str()).c_str(),
			                               jsonEscape(_said[i].text.c_str()).c_str());
			// Carry the voiced flag only when true, so unvoiced `said` entries
			// stay byte-identical to before (the diff fixtures are unchanged for
			// non-voiced lines); a voiced line adds `,"voiced":true` so the
			// player suppresses its screen-reader echo consistently whether it
			// matched a streamed A11Y_VTEXT line or arrived only here.
			if (_said[i].voiced)
				json += ",\"voiced\":true";
			json += "}";
		}
		json += "]";
	}

	// --- changed (R4.8) -----------------------------------------------------
	json += Common::String::format(",\"changed\":%s}", changed ? "true" : "false");

	emitLine(json);

	// Close the capture window and clear the buffer so the next command starts
	// clean.
	_capturingSaid = false;
	_said.clear();
}

// Emit the pending main-loop command's A11Y_DIFF (task 29, R4.1/R7.1). Called
// from the opening onConverseFrame when a `talk` opened a conversation, so the
// talk's diff is emitted at choices-open rather than after the conversation
// ends. Delegates to emitDiff() with the before-snapshot, cmd and errCount
// poll() stored before runCommand(), so the one-diff-XOR-one-err invariant and
// all the field rules are unchanged — only the TIMING differs. The after-state
// emitDiff() reads is the engine's current state on this opening frame: the
// talk's world-state changes (the flags the open set, any greeting line already
// captured in _said) are settled, so the diff is complete. Clears
// _mainCmdDiffPending so the diff fires exactly once (poll() then skips its own
// emit for this command).
void A11yLayer::emitPendingMainCmdDiff() {
	if (!_mainCmdDiffPending)
		return;
	emitDiff(_mainCmd, _mainCmdSnapshot, _mainCmdErrCount);
	_mainCmdDiffPending = false;
}

// The command file lives at <savepath>/a11y-cmd.txt (design.md, R2). savepath
// is resolved through the config manager and joined with the file name via the
// portable Common::Path / Common::FSNode APIs, so the same code finds the file
// on a native run (real directory) and under Emscripten (MEMFS written by the
// page with FS.writeFile) — no native-only or web-only path (design "same
// source, two targets").
static Common::FSNode commandFileNode() {
	Common::Path savePath = ConfMan.getPath("savepath");
	return Common::FSNode(savePath.appendComponent("a11y-cmd.txt"));
}

// Read the command file once, append each queued command to _commandQueue, then
// truncate the file so every line is consumed exactly once (R2.1). Lines that
// are blank or begin with `#` are dropped (R2.3). A missing file is the normal
// idle case (the page has written nothing yet), so it is silent, not an error.
void A11yLayer::readCommandFile() {
	Common::FSNode node = commandFileNode();
	if (!node.exists())
		return;

	Common::SeekableReadStream *in = node.createReadStream();
	if (!in)
		return;

	bool sawAny = false;
	while (!in->eos()) {
		// readLine handles LF and CR/LF, so a file written on either platform
		// splits the same way. A trailing partial line (no newline) is returned
		// too, which is fine: the page writes whole lines.
		Common::String line = in->readLine();
		if (in->err())
			break;

		line.trim();                     // drop surrounding whitespace / stray CR
		if (line.empty())                // blank line (R2.3)
			continue;
		if (line[0] == '#')              // comment line (R2.3)
			continue;

		_commandQueue.push_back(line);
		sawAny = true;
	}
	delete in;

	// Consume the file so the same commands are not re-read next frame. Only
	// truncate when there was something to read, to avoid churning the FS every
	// idle frame. createWriteStream with no bytes written leaves an empty file.
	if (sawAny) {
		Common::SeekableWriteStream *out = node.createWriteStream();
		delete out;
	}
}

// Run one queued command: echo it as A11Y_CMD (R2.4), then dispatch. The full
// verb/walk/use dispatch is built in tasks 7-20; here only the room-state
// commands have a handler. Anything else has no handler yet, so it emits
// A11Y_ERR and the layer keeps running (R2.5) — exactly the behaviour a real,
// still-unimplemented command should have until its task lands.
// Returns true when this command ended the chapter: a `walk` through a
// chapter-ending door (exitRoom() returned true), or a verb / `use` on a room
// object whose room action code made checkAction() return true (chapters 3 to 6
// end this way). poll() relays that up so the main-loop hook ends
// runCurrentChapter(), exactly as the engine's own `if (verify1()) return true;`
// and `if (checkAction(...)) return true;` do for a real click. Every other
// command returns false.
bool A11yLayer::runCommand(const Common::String &cmd) {
	emitLine(Common::String("A11Y_CMD ") + cmd);

	// Split off the first word as the verb; the remainder is the argument(s).
	// A single-word command (no space) has an empty argument.
	Common::String verb = cmd;
	uint sp = 0;
	while (sp < cmd.size() && cmd[sp] != ' ')
		sp++;
	if (sp < cmd.size())
		verb = Common::String(cmd.c_str(), sp);

	// The argument (everything after the first space). Empty for a bare verb.
	Common::String arg;
	if (sp < cmd.size())
		arg = Common::String(cmd.c_str() + sp + 1);
	arg.trim();

	if (verb == "state" || verb == "dump") {
		// Backed by the same room-state code as room entry (R1.5, task 4).
		dump();
		return false;
	}

	// Verb-on-object dispatch (task 8, R3.1/R3.2/R3.4): each a11y verb word maps
	// to the engine's own kVerb* constant, and the action runs through the
	// engine's verify2()/checkAction() path for the named object slot. `talk`
	// has no kVerb of its own in these commands — it is kVerbTalk — and `take`
	// is the engine's kVerbPick.
	if (verb == "look") {
		return dispatchVerb(kVerbLook, arg);
	}
	if (verb == "take") {
		return dispatchVerb(kVerbPick, arg);
	}
	if (verb == "open") {
		return dispatchVerb(kVerbOpen, arg);
	}
	if (verb == "close") {
		return dispatchVerb(kVerbClose, arg);
	}
	if (verb == "talk") {
		return dispatchVerb(kVerbTalk, arg);
	}
	if (verb == "push") {
		// The engine's "push/move" verb is kVerbMove.
		return dispatchVerb(kVerbMove, arg);
	}

	// Doors and walking (task 9, R3.8 / R2.6). One numeric arg is an object
	// walk (`walk 52`); two numeric args are a free-point walk (`walk 170 158`).
	// A `walk` through a chapter-ending door returns true (see dispatchWalk /
	// walkObject): relay it so poll() can end the chapter.
	if (verb == "walk") {
		return dispatchWalk(arg);
	}

	// Use an inventory item on a room object (task 10, R3.4 / R3.5):
	// `use <item> on <obj>` or `use <item> <obj>`.
	if (verb == "use") {
		return dispatchUse(arg);
	}

	// Inventory listing (task 13, R6.4). `inventory` and the short alias `inv`
	// both emit the dedicated A11Y_INV line. It takes no argument; any trailing
	// text is ignored.
	if (verb == "inventory" || verb == "inv") {
		dispatchInventory();
		return false;
	}

	// Cutscene / speech skipping (task 16, R7.3 / R7.4). A `skip` that reaches
	// the main-loop reader means no cutscene or speech loop is currently blocking
	// poll() (a `skip` queued DURING a cutscene is taken by the updateEvents()
	// hook, onUpdateEvents(), long before control returns here). So this is a
	// `skip` with nothing to skip: raise the engine's kActionSkip anyway — it is
	// a harmless no-op (the action sits in the engine's buffer and is drained by
	// the next getScan()/getAction() in the main loop with no visible effect),
	// which the design allows ("a `skip` with nothing to skip should be a
	// harmless no-op"). Modelling it on the real skip key keeps one code path for
	// skip whether or not a cutscene is running.
	if (verb == "skip") {
		raiseSkip();
		return false;
	}

	// Saving to a slot (task 19, R9.1). `save <slot>` saves the game to that
	// numbered slot and emits A11Y_SAVED. The loading half (R9.2) is the
	// engine's own `--save-slot=<n>` launch path (ConfMan "save_slot" ->
	// loadGame() in run()), so there is no `load` command here — a run resumes
	// partway through by launching with the slot, not by an in-game command.
	if (verb == "save") {
		dispatchSave(arg);
		return false;
	}

	// Conversation commands (task 15, R7.1/R7.2/R6.3). These are only meaningful
	// while a converse() loop is open; that loop does not run the main-loop
	// reader, so when one IS open the command is consumed by the converse-frame
	// hook (runConverseCommand, below), never here. Reaching this point means no
	// conversation is active, so `choices`/`choose` here is an A11Y_ERR that
	// keeps the layer running (R2.5).
	if (verb == "choices") {
		emitLine("A11Y_ERR no conversation is open");
		return false;
	}
	if (verb == "choose") {
		emitLine("A11Y_ERR no conversation is open");
		return false;
	}

	// No handler yet (lands in a later task). Report and continue (R2.5).
	emitLine(Common::String("A11Y_ERR no handler for command: ") + cmd);
	return false;
}

// Look up the room-object slot whose engine hotspot number is `num`. The room
// arrays (objectNum/objName/_objectRect/_roomObject/trackObj/visible/isDoor)
// are all keyed on the slot index 0..numRoomObjs-1; a11y commands name the
// object by the engine's own per-room number (objectNum[slot]), so we scan for
// it. Returns -1 when no live room object carries that number. (R3.1)
int A11yLayer::slotForObjectNum(int num) const {
	DrasculaEngine *e = _engine;
	for (int l = 0; l < e->numRoomObjs; l++) {
		if (e->objectNum[l] == num)
			return l;
	}
	return -1;
}

// Run a verb on a room-object slot by reproducing the engine's own click path,
// so the GAME'S OWN logic runs (R3.1). This mirrors verify2()'s non-menu,
// per-object branch (drascula.cpp):
//
//     trackFinal = trackObj[l];
//     _walkToObject = true;
//     walkToPoint(_roomObject[l]);
//     checkAction(objectNum[l]);
//
// run directly on the chosen slot rather than via a pixel hit test, so it is
// reliable when the hero wins the hit test or hotspots overlap (gotcha 6 / the
// R3 user story). The steps before it reproduce the rest of the click frame:
//
//   * selectVerb(verb) sets the engine's pickedObject/takeObject, exactly as
//     clicking a verb on the bar does. The room action handlers branch on
//     `pickedObject == kVerb*`, so the verb must be live before checkAction().
//   * Warp the mouse to the object's hotspot (R3.3). Direct dispatch does not
//     use the pixel under the cursor, but the engine derives the hover name and
//     the generic "can't do that" path from _mouseX/_mouseY, so the cursor must
//     sit over the object.
//   * checkObjects() sets _hasName/textName for the object under the (now
//     warped) cursor, the same call the main loop makes each frame before
//     verify2(). checkAction() only runs the generic room_0 "no, I can't"
//     reply when _hasName is set, so without this an unhandled verb would stay
//     silent instead of giving the game's own refusal.
bool A11yLayer::runVerbOnSlot(int verb, int slot) {
	DrasculaEngine *e = _engine;

	// Clear any verb still held from a previous command before selecting the
	// new one. selectVerb() runs `if (takeObject == 1) addObject(pickedObject)`
	// at its top (interface.cpp): in the real game a verb is reset to none by a
	// successful action handler (selectVerb(kVerbNone) in rooms.cpp) or by a
	// right-click, so the next verb selection almost always starts from
	// takeObject == 0. But an action with no handler (the generic "I can't do
	// that" refusal) leaves the verb held, so without this reset a following
	// a11y command's selectVerb() would call addObject(oldVerb) and dump the
	// verb *number* (1..6) into the inventory as a bogus item. Resetting to
	// none first — exactly what a right-click does — keeps each command's verb
	// selection starting from a clean state, as the real game does.
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Select the verb, so pickedObject/takeObject are what the room handlers
	// and checkAction() read (interface.cpp selectVerb). This is the same state
	// a click on the verb bar leaves behind.
	e->selectVerb(verb);

	// Warp the cursor to the object's hotspot centre so the engine's hover name
	// matches the object the action runs on (R3.3). We set the engine's own
	// tracked position (what checkObjects/checkAction read) and move the backend
	// cursor so a native real-window run shows it over the object too.
	const Common::Rect &r = e->_objectRect[slot];
	int hx = r.left + r.width() / 2;
	int hy = r.top + r.height() / 2;
	e->_mouseX = hx;
	e->_mouseY = hy;
	if (g_system)
		g_system->warpMouse(hx, hy);

	// Set _hasName/textName for the warped-over object, the same call the main
	// loop makes before verify2(). Needed so checkAction()'s generic refusal
	// (room_0) can fire for a verb the object does not handle.
	if (!e->_menuScreen && e->takeObject == 1)
		e->checkObjects();

	// Run the engine's own action for this slot: walk to the object, then
	// checkAction() on the object's engine number (R3.1, R3.2). This is the
	// verify2() per-object body, keyed on the slot we resolved rather than on a
	// pixel hit test.
	e->trackFinal = e->trackObj[slot];
	e->_walkToObject = true;
	guardedWalkToPoint(e->_roomObject[slot]);
	// checkAction() returns true when the action ended the chapter (the
	// original game's `if (checkAction(...)) return true;`). Relay that to the
	// caller and skip the item-return step: the chapter is over and its state
	// is being torn down.
	if (e->checkAction(e->objectNum[slot]))
		return true;

	// R3.5 item return — drop a newly-PICKED item into the inventory, as a
	// right-click would. Some room handlers reward a plain verb-on-object with
	// an item via pickObject(): e.g. chapter-2 `open 183` (the trunk) runs
	// pickObject(22), so the handbag ends up HELD on the cursor (takeObject == 1,
	// pickedObject == 22), exactly as it would after the on-screen click — NOT
	// yet in an inventory slot. In the real game the player then right-clicks to
	// stow it; chooseObject()/selectVerb() only call addObject() for the
	// previously held object on the NEXT selection, so without a drop here the
	// picked item never reaches inventoryObjects[] and the diff shows no
	// invAdded (and a later `open 22` errors: the handbag is not in inventory).
	//
	// selectVerb(kVerbNone) is the engine's own right-click-to-drop: its top runs
	// `if (takeObject == 1) addObject(pickedObject)` (interface.cpp), stowing the
	// held item and clearing the cursor. We only do it when the held object is a
	// REAL item (id >= 7, gotcha 7): an UNHANDLED verb leaves the verb itself
	// held (pickedObject == 1..6), and dropping that would dump a bogus
	// verb-number "item" into inventory. The next command's own top-of-function
	// reset clears a still-held verb, so leaving a held verb for it is correct.
	//
	// Exception, chapter 5 plug (bug #3885): the original game deliberately
	// keeps item 16 on the cursor in chapter 5 (selectVerb() will not stow it),
	// and the player then clicks it on the wall socket. Stowing it here would
	// throw it away, so leave it held; `use 16 <num>` accepts it from the cursor.
	if (e->takeObject == 1 && e->pickedObject >= 7 && !isHeldPlug(e))
		e->selectVerb(kVerbNone);
	return false;
}

// Handle a `<verb> <num>` command: resolve the slot for the engine object
// number, emit A11Y_ERR if it is not in the room (R2.5), else run the verb on
// that slot. Returns true only when the verb ended the chapter (checkAction()
// returned true); every other outcome, including an A11Y_ERR, returns false.
bool A11yLayer::dispatchVerb(int verbConst, const Common::String &arg) {
	if (arg.empty()) {
		emitLine("A11Y_ERR verb needs an object number, e.g. `look 52`");
		return false;
	}

	// Parse the object number. a11y object ids are plain strings of digits
	// (e.g. "52"), so require every character to be a digit; a non-numeric
	// argument like `look door` is a clear error, not a silent atoi() 0.
	for (uint i = 0; i < arg.size(); i++) {
		if (arg[i] < '0' || arg[i] > '9') {
			emitLine(Common::String("A11Y_ERR object must be a number, got: ") + arg);
			return false;
		}
	}
	int num = atoi(arg.c_str());

	// Object 50 is the engine's special "hero / self" object (R3.7): it is not
	// a room object in objectNum[], so it gets its own path. A verb on 50 runs
	// checkAction(50) against the hero (e.g. `look 50` is look-at-self).
	if (num == 50) {
		runVerbOnSelf(verbConst);
		return false;
	}

	// A room object: resolve its slot and run the verb through the engine's own
	// room-object path (task 8).
	int slot = slotForObjectNum(num);
	if (slot >= 0)
		return runVerbOnSlot(verbConst, slot);

	// Not a room object. It may be an inventory item the player wants to act on
	// in the inventory screen (R3.6), e.g. `look 28` to look at the phone. Real
	// items are id >= 7 (gotcha 7); verb slots 1..6 are not items.
	if (num >= 7 && slotForItem(num) >= 0) {
		runVerbOnItemSlot(verbConst, num);
		return false;
	}

	// Neither a room object, the hero, nor an inventory item the player holds.
	emitLine(Common::String::format(
		"A11Y_ERR object %d is not in this room or inventory", num));
	return false;
}

// --- Use an inventory item on a room object (task 10, R3.4 / R3.5) ----------
//
// In the real game, using an item on a room object is three clicks:
//
//   1. right-click to open the inventory screen;
//   2. left-click the item — removeObject() takes it out of its slot and
//      chooseObject() makes it the cursor (takeObject == 1, pickedObject == id);
//   3. right-click to close the screen, then left-click the room object —
//      verify2() calls checkAction(objectNum), and the room handler branches on
//      `pickedObject == <itemId> && fl == <objNum>` (see the room_N() handlers
//      in rooms.cpp, e.g. room_15: `pickedObject == 18 && fl == 188`).
//
// The item is the ENGINE'S picked object for that click, exactly as a verb is
// for a plain verb command. So the a11y path mirrors the design table:
//   selectVerb(kVerbNone)  — drop whatever was held, as a right-click does
//   removeObject(item)     — take the item out of its inventory slot
//   pickObject(item)       — make it the picked object / cursor
//   run the action on the object slot (walk + checkAction)
//   return the item if it is still held afterwards (R3.5)
//
// The crucial safety property (R3.5, gotcha on item loss): a use that does NOT
// apply must leave the item back in the inventory, not lost. When the room
// handler consumes the item it calls removeObject()/selectVerb(kVerbNone)
// itself, so takeObject drops to 0. When it does NOT apply (the generic room_0
// refusal), the item is still held as the cursor and absent from the inventory
// array; we put it back with selectVerb(kVerbNone), whose own top-of-function
// `if (takeObject == 1) addObject(pickedObject)` is the very right-click return
// a player would do. Either way the item ends up in inventory unless the game
// deliberately used it up.

// True when the real item `itemId` (>= 7) sits in a live inventory slot.
bool A11yLayer::itemInInventory(int itemId) const {
	DrasculaEngine *e = _engine;
	for (int n = 1; n < ARRAYSIZE(e->inventoryObjects); n++) {
		if (e->inventoryObjects[n] == itemId)
			return true;
	}
	return false;
}

// Apply item `itemId` to the room object in `slot`, then return the item to the
// inventory if the action did not consume it (R3.4, R3.5).
bool A11yLayer::useItemOnSlot(int itemId, int slot) {
	DrasculaEngine *e = _engine;

	// Drop whatever verb/item is currently held, returning it to the inventory,
	// exactly as a right-click does. selectVerb(kVerbNone) runs
	// `if (takeObject == 1) addObject(pickedObject)` then clears takeObject, so
	// after this the hero holds nothing and no stale verb number can leak into
	// the inventory on the next pick (interface.cpp selectVerb).
	//
	// Chapter 5 plug (bug #3885): if the plug is already held on the cursor and
	// is the item being used, leave it there. selectVerb(kVerbNone) would throw
	// it away (the original never stows item 16 in chapter 5), and it is
	// already in the state the room handler reads (takeObject == 1,
	// pickedObject == 16), so there is nothing to pick up either.
	bool alreadyHeldPlug = itemId == 16 && isHeldPlug(e);
	if (e->takeObject == 1 && !alreadyHeldPlug)
		e->selectVerb(kVerbNone);

	// Pick up the item the game's way: take it out of its inventory slot
	// (removeObject(id)) and make it the picked object / cursor (pickObject ->
	// chooseObject sets takeObject = 1, pickedObject = id). This is the state a
	// left-click on the item in the inventory screen leaves behind, and it is
	// what the room-action handlers read.
	if (!alreadyHeldPlug) {
		e->removeObject(itemId);
		e->pickObject(itemId);
	}

	// Warp the cursor to the object's hotspot centre so the engine's hover name
	// matches the object the use runs on (R3.3), the same as a verb command.
	const Common::Rect &r = e->_objectRect[slot];
	int hx = r.left + r.width() / 2;
	int hy = r.top + r.height() / 2;
	e->_mouseX = hx;
	e->_mouseY = hy;
	if (g_system)
		g_system->warpMouse(hx, hy);

	// Run the engine's own action for this object slot while the item is held:
	// walk to the object, then checkAction(objectNum) — the verify2() per-object
	// body (drascula.cpp), keyed on the resolved slot rather than a pixel hit
	// test (gotcha 6). The room handler branches on pickedObject == itemId.
	e->trackFinal = e->trackObj[slot];
	e->_walkToObject = true;
	guardedWalkToPoint(e->_roomObject[slot]);
	// checkAction() true == this use ended the chapter. Relay it and skip the
	// item return: the chapter is over and its state is being torn down.
	if (e->checkAction(e->objectNum[slot]))
		return true;

	// R3.5 — item return. If the item was consumed, the handler already removed
	// it and cleared the picked object (takeObject == 0). If the use did not
	// apply, the item is still held (takeObject == 1, pickedObject == itemId)
	// and currently absent from the inventory array, so selectVerb(kVerbNone)
	// puts it back (its addObject(pickedObject)) and clears the cursor — the
	// right-click a player would do. Guarding on `takeObject == 1` means we
	// never double-add a consumed item.
	// Chapter 5 plug (bug #3885): a plug still on the cursor stays there, as in
	// the original, so it can be tried again on another target.
	if (e->takeObject == 1 && !isHeldPlug(e))
		e->selectVerb(kVerbNone);
	return false;
}

// Parse and dispatch `use <item> on <obj>` / `use <item> <obj>` (R3.4). Rejects
// an item not in inventory, an object not in the room, and malformed syntax
// with A11Y_ERR, keeping the layer running (R2.5). Returns true only when the
// use ended the chapter (a room-object use whose checkAction() returned true).
bool A11yLayer::dispatchUse(const Common::String &arg) {
	// Split the argument into whitespace-separated words, collapsing runs of
	// spaces. arg is already trimmed by runCommand().
	Common::Array<Common::String> words;
	Common::String cur;
	for (uint i = 0; i < arg.size(); i++) {
		char c = arg[i];
		if (c == ' ' || c == '\t') {
			if (!cur.empty()) {
				words.push_back(cur);
				cur.clear();
			}
		} else {
			cur += c;
		}
	}
	if (!cur.empty())
		words.push_back(cur);

	// A bare `use` or `use <item>` has no target. There is no standalone-use
	// path in this engine (items are always applied to an object, another item,
	// or the hero), so this is an error here (R2.5).
	if (words.empty()) {
		emitLine("A11Y_ERR use needs an item and a target: `use <item> on <object>`");
		return false;
	}
	if (words.size() == 1) {
		emitLine("A11Y_ERR use needs a target: `use <item> on <object>` "
		         "(a room object, another item, or 50 for the hero)");
		return false;
	}

	// Accept both `use <item> on <obj>` and `use <item> <obj>`. When the middle
	// word is the literal `on`, there must be exactly `item on obj` (3 words);
	// otherwise it is the two-word `item obj` form. Anything else is malformed.
	Common::String itemWord;
	Common::String objWord;
	if (words.size() == 3 && words[1].equalsIgnoreCase("on")) {
		itemWord = words[0];
		objWord = words[2];
	} else if (words.size() == 2) {
		itemWord = words[0];
		objWord = words[1];
	} else {
		emitLine("A11Y_ERR use takes `<item> on <object>` or `<item> <object>`, "
		         "e.g. `use 18 on 188`");
		return false;
	}

	// Both the item id and the object number must be plain strings of digits
	// (a11y ids are numeric), so a non-numeric token is a clear error rather
	// than a silent atoi() 0.
	int itemId, objNum;
	if (!parseInt(itemWord, itemId) || itemId < 0) {
		emitLine(Common::String("A11Y_ERR use item must be a number, got: ") + itemWord);
		return false;
	}
	if (!parseInt(objWord, objNum) || objNum < 0) {
		emitLine(Common::String("A11Y_ERR use object must be a number, got: ") + objWord);
		return false;
	}

	// The item must actually be in the inventory (gotcha 7: real items are
	// id >= 7; verb slots 1..6 are not items). Reject before touching any state
	// so a bad `use` changes nothing (R2.5).
	if (itemId < 7) {
		emitLine(Common::String::format(
			"A11Y_ERR %d is a verb slot, not an inventory item (items are id 7+)", itemId));
		return false;
	}
	if (!itemInInventory(itemId) && !(itemId == 16 && isHeldPlug(_engine))) {
		emitLine(Common::String::format(
			"A11Y_ERR item %d is not in the inventory", itemId));
		return false;
	}

	// The target is object 50, the hero / self (R3.7): `use <item> on 50`.
	// Object 50 is not a room object, so it has its own path — the room handlers
	// key item-on-self on `pickedObject == <itemId> && fl == 50`.
	if (objNum == 50) {
		useItemOnSelf(itemId);
		return false;
	}

	// The target may be a live room object (task 10): `use <item> on <objNum>`.
	// A use that ends the chapter returns true, relayed to runCommand().
	int slot = slotForObjectNum(objNum);
	if (slot >= 0)
		return useItemOnSlot(itemId, slot);

	// The target may be another inventory item (item-on-item, R3.6): both the
	// held item and the target are in the inventory, combined on the inventory
	// screen. Real items are id >= 7 (gotcha 7).
	if (objNum >= 7 && slotForItem(objNum) >= 0) {
		// An item cannot be combined with itself.
		if (objNum == itemId) {
			emitLine(Common::String::format(
				"A11Y_ERR cannot use item %d on itself", itemId));
			return false;
		}
		useItemOnItemSlot(itemId, objNum);
		return false;
	}

	// Not the hero, a room object, or an inventory item.
	emitLine(Common::String::format(
		"A11Y_ERR target %d is not a room object, an inventory item, or the hero (50)",
		objNum));
	return false;
}

// --- Inventory listing (task 13, R6.4 / gotcha 9) ---------------------------
//
// `inventory` / `inv` emits one `A11Y_INV ` line describing what the hero is
// carrying. Shape (design.md "A11Y_INV"):
//
//   A11Y_INV {"items":[{"id":28,"name":"phone","look":"THIS IS THE MOBILE PHONE..."}]}
//
// Three facts about this engine shape the implementation (all are READ from the
// engine's own data — nothing is invented, gotcha 9):
//
//   * Items vs verb slots. inventoryObjects[1..] holds what the hero carries;
//     ids 1..6 are the verb icons and only id >= 7 is a real item (gotcha 7),
//     so the list mirrors buildRoomState()'s `inventory` filter exactly.
//   * Names. The game never draws an item's name on screen (gotcha 9); the
//     only name source is the InventoryItems / InventoryItems2 enums in
//     drascula.h, which are compile-time C++ constants with no runtime string
//     table. itemName() turns the relevant enum constant into plain words via a
//     static id->name table, chosen by chapter (1-3 vs 4-6). An id with no
//     table entry contributes no `name` field rather than a fabricated one.
//   * Look lines. The game's own "look at this item" speech is the room-200
//     action table (_roomActions): checkAction()'s _menuScreen branch runs
//     roomParse(200, itemId), which speaks _text[speechID]. itemLookLine()
//     resolves the SAME entry and returns the string as data, without speaking
//     it, so the line is captured for the player. No matching entry => no
//     `look` field.
//
// Names are available for every real item regardless of whether it is currently
// "hovered" on the inventory screen, because the table is keyed on the id, not
// on any on-screen/hover state — so a full, correct listing is emitted for the
// whole inventory from a single command, with the inventory screen never opened.

// Human-readable name for an inventory item id. The game ships no item-name
// strings, so these mirror the InventoryItems (chapters 1-3) and
// InventoryItems2 (chapters 4-6) enum constants in drascula.h, turned into
// plain lower-case words (gotcha 9). Empty string for an id the current chapter
// set does not name, so the caller omits `name` rather than inventing one.
Common::String A11yLayer::itemName(int itemId) const {
	// Chapters 4-6 reuse several ids for different items (InventoryItems2), so
	// the set is chosen by the live chapter. Ids not listed in the active set
	// return "" (no fabricated name).
	if (_engine->currentChapter >= 4) {
		// InventoryItems2 (chapters 4 onwards; the engine defines this set only
		// partially, so only the known ids are named).
		switch (itemId) {
		case 7:  return "key";            // kItemKey2
		case 9:  return "cross";          // kItemCross2
		case 19: return "rope";           // kItemRope2
		case 20: return "reefer";         // kItemReefer2
		case 22: return "one coin";       // kItemOneCoin2
		case 28: return "phone";          // kItemPhone2
		default: return "";
		}
	}

	// InventoryItems (chapters 1-3). This is the set that covers the demo scope
	// (chapters 1 and 2).
	switch (itemId) {
	case 7:  return "money";              // kItemMoney
	case 8:  return "leaves";             // kItemLeaves
	case 9:  return "cross";              // kItemCross
	case 10: return "spike";              // kItemSpike
	case 11: return "earplugs";           // kItemEarplugs
	case 12: return "book";               // kItemBook
	case 13: return "bubble gum";         // kItemBubbleGum
	case 14: return "sickle";             // kItemSickle
	case 15: return "tissues";            // kItemTissues
	case 16: return "cigarettes";         // kItemCigarettes
	case 17: return "candle";             // kItemCandle
	case 18: return "two coins";          // kItemTwoCoins
	case 19: return "one coin";           // kItemOneCoin
	case 20: return "reefer";             // kItemReefer
	case 21: return "key";                // kItemKey
	case 22: return "handbag";            // kItemHandbag
	case 23: return "ear with earplug";   // kItemEarWithEarPlug
	case 28: return "phone";              // kItemPhone
	default: return "";
	}
}

// The game's own "look at this item" line for an inventory item, read straight
// from the engine's room-200 action table (the same lookup checkAction() does
// on the inventory screen), or "" when the engine defines no look line for the
// item. We reproduce roomParse(200, itemId)'s match rule — room == 200, chapter
// matches the live chapter (or is -1 for all chapters), action is kVerbLook or
// kVerbDefault, objectID is the item id (or -1 for any) — and return
// _text[speechID] rather than calling talk(), so the line is captured as data
// with nothing animated or spoken.
Common::String A11yLayer::itemLookLine(int itemId) const {
	DrasculaEngine *e = _engine;

	// _text is loaded at chapter start (loadTexts); guard defensively in case a
	// listing is somehow requested before it exists.
	if (!e->_text || !e->_roomActions)
		return "";

	// roomParse() scans _roomActions in order and acts on the first entry whose
	// room/chapter/action/objectID all match; we mirror that so the captured
	// look line is exactly the one the game would speak. A look is pickedObject
	// == kVerbLook, so we match kVerbLook (and kVerbDefault, which roomParse
	// also accepts) with the item as objectID (or the wildcard -1).
	bool seen = false;
	for (int i = 0; i < e->_roomActionsSize; i++) {
		const RoomTalkAction &a = e->_roomActions[i];
		if (a.room == 200) {
			seen = true;
			if (a.chapter == e->currentChapter || a.chapter == -1) {
				if (a.action == kVerbLook || a.action == kVerbDefault) {
					if (a.objectID == itemId || a.objectID == -1) {
						const char *s = e->_text[a.speechID];
						return s ? Common::String(s) : Common::String();
					}
				}
			}
		} else if (seen) {
			// _roomActions is grouped by room; once we have passed the room-200
			// block there is no point scanning further (same early-out as
			// roomParse()).
			break;
		}
	}
	return "";
}

// Emit the `A11Y_INV` line: every real inventory item (id >= 7) with its id,
// name (where known) and look line (where the engine defines one). Does not
// open the inventory screen or change any state — it only reads
// inventoryObjects[], the name table, and the room-200 look table (R6.4).
void A11yLayer::dispatchInventory() {
	DrasculaEngine *e = _engine;

	Common::String json = "A11Y_INV {\"items\":[";

	bool first = true;
	for (int n = 1; n < ARRAYSIZE(e->inventoryObjects); n++) {
		int id = e->inventoryObjects[n];
		if (id < 7)                      // verb-icon slots / empty slots (gotcha 7)
			continue;

		if (!first)
			json += ",";
		first = false;

		json += Common::String::format("{\"id\":%d", id);

		// name: only when the table knows this id (never fabricated, gotcha 9).
		Common::String name = itemName(id);
		if (!name.empty())
			json += Common::String::format(",\"name\":\"%s\"", jsonEscape(name.c_str()).c_str());

		// look: only when the engine's own room-200 table defines a line.
		Common::String look = itemLookLine(id);
		if (!look.empty())
			json += Common::String::format(",\"look\":\"%s\"", jsonEscape(look.c_str()).c_str());

		json += "}";
	}

	// The plug held on the cursor in chapter 5 is not in inventoryObjects[]
	// but the player has it, so list it too (see isHeldPlug()).
	if (isHeldPlug(e)) {
		if (!first)
			json += ",";
		json += "{\"id\":16";
		Common::String name = itemName(16);
		if (!name.empty())
			json += Common::String::format(",\"name\":\"%s\"", jsonEscape(name.c_str()).c_str());
		Common::String look = itemLookLine(16);
		if (!look.empty())
			json += Common::String::format(",\"look\":\"%s\"", jsonEscape(look.c_str()).c_str());
		json += "}";
	}

	json += "]}";
	emitLine(json);
}

// --- Inventory-screen targets and self / object 50 (task 11, R3.6/R3.7) -----
//
// Two target kinds the room-object dispatch (tasks 8-10) cannot reach:
//
//   1. The hero / self — the engine's special object number 50. verify2()'s
//      non-menu branch treats a click on the hero as `checkAction(50)`:
//
//          if (!strcmp(textName, _textmisc[3]) && _hasName) {
//              if (checkAction(50)) return true;
//          }
//
//      i.e. when the cursor is over the hero (textName is the hero's name,
//      _textmisc[3]) the game runs the held verb/item against fl == 50. Object
//      50 is not in objectNum[], so slotForObjectNum() returns -1 and it needs
//      this dedicated path. The room/action handlers key self actions on
//      `fl == 50` (e.g. ch6 `pickedObject == kVerbLook && fl == 50` looks at
//      the hero; ch2 `pickedObject == 11 && fl == 50` uses item 11 on the hero).
//
//   2. Another inventory item — item-on-item combination on the inventory
//      screen. With the menu open and item A held, clicking item B runs
//      pickupObject(): the slot under B is occupied, so it falls through to
//      checkMenuFlags() -> checkAction(inventoryObjects[slotB]) with
//      pickedObject == A. checkAction()'s `_menuScreen` branch then runs the
//      combination handlers (e.g. ch4 `pickedObject == 18 && fl == 19` combines
//      the two coins). We call checkAction(itemB) directly with item B as `fl`
//      — the same value the engine resolves from the slot under the cursor —
//      so no mouse-position lookup (whichObject/_itemLocations) is needed.
//
// Both keep the task-10 item-return safety (R3.5): a verb/use that does not
// apply leaves every item back in the inventory, lost by neither path.

// Find the live inventory slot holding real item `itemId`, or -1. Slots are
// indexed 1..ARRAYSIZE(inventoryObjects)-1. Used to confirm a verb/use target
// is really an inventory item the hero holds before acting on it (R3.6, R2.5).
int A11yLayer::slotForItem(int itemId) const {
	DrasculaEngine *e = _engine;
	for (int n = 1; n < ARRAYSIZE(e->inventoryObjects); n++) {
		if (e->inventoryObjects[n] == itemId)
			return n;
	}
	return -1;
}

// Open the inventory screen the same way the main loop's right-click block does
// (drascula.cpp ~650): load the chapter's icon surfaces into backSurface and
// cursorSurface, then set _menuScreen so checkAction() takes its menu branch.
// Chapter 2 uses menuBackground; chapters 1/3 use icons.alg; 4/5/6 use their
// own icon sets. We mirror that selection exactly so the screen the engine's
// own code draws and reads is the one it expects.
void A11yLayer::openInventoryScreen() {
	DrasculaEngine *e = _engine;

	if (e->currentChapter == 4) {
		e->loadPic("icons2.alg", e->backSurface);
		e->loadPic("icons2.alg", e->cursorSurface);
	} else if (e->currentChapter == 5) {
		e->loadPic("icons3.alg", e->backSurface);
		e->loadPic("icons3.alg", e->cursorSurface);
	} else if (e->currentChapter == 6) {
		e->loadPic("iconsp.alg", e->backSurface);
		e->loadPic("iconsp.alg", e->cursorSurface);
	} else {
		e->loadPic("icons.alg", e->backSurface);
		e->loadPic("icons.alg", e->cursorSurface);
	}

	e->_menuScreen = true;
}

// Close the inventory screen the same way the main loop's right-click-close
// block does (drascula.cpp ~629): reload the room background/cursor surfaces,
// restore gamePalette, clear _menuScreen. Chapter 2 reloads menuBackground;
// everything else reloads pic 99 (the room background). Leaves the game back in
// its normal room state so the per-frame poll() sees nothing stuck open.
void A11yLayer::closeInventoryScreen() {
	DrasculaEngine *e = _engine;

	if (e->currentChapter == 2) {
		e->loadPic(e->menuBackground, e->cursorSurface);
		e->loadPic(e->menuBackground, e->backSurface);
	} else {
		e->loadPic(99, e->cursorSurface);
		e->loadPic(99, e->backSurface);
	}
	e->setPalette((byte *)&e->gamePalette);
	e->_menuScreen = false;
}

// Run a verb on object 50 (the hero / self), reproducing verify2()'s non-menu
// self branch directly (R3.7). No room slot, no walk: the action is against the
// hero where they stand.
void A11yLayer::runVerbOnSelf(int verb) {
	DrasculaEngine *e = _engine;

	// Clear any verb still held from a previous command, so a stale verb number
	// cannot leak into the inventory (same reasoning as runVerbOnSlot): an
	// unhandled action leaves the verb held, and the next selectVerb() would
	// addObject() the verb number. Resetting to none first, as a right-click
	// does, keeps each command starting clean.
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Select the verb so pickedObject/takeObject are what checkAction() reads.
	e->selectVerb(verb);

	// Mark that the cursor is over a named thing so checkAction()'s generic
	// refusal can fire. In the full click path verify2() sets textName to the
	// hero's name and _hasName before calling checkAction(50); here we call
	// checkAction(50) directly (bypassing verify2()'s routing, gotcha 6), and
	// the self-handlers key only on `fl == 50`, not on textName. The one place
	// textName/_hasName matters inside checkAction is its closing generic
	// room_0 "I can't do that" reply, which fires when `_hasName || _menuScreen`
	// — so setting _hasName gives an unhandled self verb the game's own refusal.
	e->_hasName = true;

	// Run the engine's own self action. checkAction(50) dispatches to the
	// room/chapter self-handlers (fl == 50); an unhandled verb falls through to
	// the generic room_0 refusal (fires because _hasName is set). No walk:
	// object 50 is the hero, already in place.
	e->checkAction(50);
}

// Apply inventory item `itemId` to object 50 (the hero / self), then return the
// item if the use did not consume it (R3.7, R3.5). Mirrors useItemOnSlot() but
// targets fl == 50 with no room slot / walk.
void A11yLayer::useItemOnSelf(int itemId) {
	DrasculaEngine *e = _engine;

	// Drop whatever verb/item is currently held, returning it to inventory, as
	// a right-click does (selectVerb(kVerbNone) re-adds a held item).
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Pick the item up the game's way: take it out of its slot and make it the
	// picked object / cursor, the state a left-click on the inventory item
	// leaves behind. The self-handlers read pickedObject == itemId.
	e->removeObject(itemId);
	e->pickObject(itemId);

	// Mark that a named thing is under the cursor so the generic refusal can
	// fire for a non-applying item-on-self (see runVerbOnSelf). The self
	// handlers key on `fl == 50` only, which we pass directly to checkAction().
	e->_hasName = true;

	// Run the engine's own item-on-self action (fl == 50). The handler branches
	// on `pickedObject == itemId && fl == 50`. No walk: the hero is self.
	e->checkAction(50);

	// R3.5 item return: if the use did not consume the item it is still held
	// (takeObject == 1) and absent from the inventory array, so
	// selectVerb(kVerbNone) puts it back and clears the cursor — the right-click
	// a player would do. A consumed item already dropped takeObject to 0, so the
	// guard prevents double-adding it.
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);
}

// Run a verb on an inventory-screen item (the target is an inventory item, not
// a room object): open the inventory screen, warp to the item's slot, run the
// engine's own menu-screen action, close the screen (R3.6).
void A11yLayer::runVerbOnItemSlot(int verb, int itemId) {
	DrasculaEngine *e = _engine;

	int slot = slotForItem(itemId);
	if (slot < 0) {
		// Should not happen (dispatchVerb checked), but guard so a race or bad
		// state is a clean error, not a bad array read.
		emitLine(Common::String::format(
			"A11Y_ERR item %d is not in the inventory", itemId));
		return;
	}

	// Clear any held verb/item first (same stale-verb reasoning as elsewhere).
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Open the inventory screen so checkAction() takes its _menuScreen branch.
	openInventoryScreen();

	(void)slot; // resolved above only to confirm the item is really held

	// Select the verb while the screen is open — selectVerb sets pickedObject,
	// which the menu look-at-item handlers (checkAction's _menuScreen branch)
	// read. For a look, pickedObject == kVerbLook.
	e->selectVerb(verb);

	// Run the engine's own action for the item while the menu is open:
	// checkAction(itemId) takes its _menuScreen branch (roomParse(200) — the
	// look-at-item table — and the per-chapter menu handlers). We pass the item
	// id directly as `fl`, which is what the engine's whichObject()-based click
	// path resolves to from the slot under the cursor; calling it directly means
	// the action runs on the chosen item itself, not a pixel hit test (gotcha 6),
	// so no mouse-position lookup is needed.
	e->checkAction(itemId);

	// A plain verb does not pick anything up, but a handler could have left a
	// verb/item held; return it as a right-click would before closing, so no
	// stale cursor survives the screen close.
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Close the screen and restore the room, as a right-click does.
	closeInventoryScreen();
}

// Apply inventory item `itemA` to another inventory item `itemB` on the
// inventory screen (item-on-item combination), returning any item not consumed
// (R3.6, R3.5).
void A11yLayer::useItemOnItemSlot(int itemA, int itemB) {
	DrasculaEngine *e = _engine;

	if (slotForItem(itemB) < 0) {
		emitLine(Common::String::format(
			"A11Y_ERR item %d is not in the inventory", itemB));
		return;
	}

	// Drop whatever is held first (right-click equivalent).
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Open the inventory screen so checkAction() takes its _menuScreen branch.
	openInventoryScreen();

	// Pick item A up the game's way: take it out of its slot and make it the
	// picked object / cursor. This is the state after left-clicking item A on
	// the open inventory screen. The combination handlers read
	// `pickedObject == itemA && fl == itemB`.
	//
	// removeObject(itemA) frees A's slot but leaves B in its slot, exactly as
	// the real click sequence does (A becomes the cursor, B stays put).
	e->removeObject(itemA);
	e->pickObject(itemA);

	// Run the engine's own combination action: checkAction(itemB) takes its
	// _menuScreen branch with pickedObject == itemA. We pass itemB directly as
	// `fl` — the same value the engine's whichObject()-based menu click resolves
	// from the slot under the cursor — so no mouse-position lookup is needed
	// (gotcha 6: act on the item itself, not a pixel). A matching handler
	// combines the items (consuming one or both and adding the result); a
	// non-matching pair falls through to the generic refusal and consumes
	// nothing, so item B stays in its slot and item A is returned below.
	e->checkAction(itemB);

	// R3.5 item return: if the combination did not consume item A it is still
	// held (takeObject == 1) and absent from the inventory, so selectVerb puts
	// it back. Item B was never removed from its slot by this path (only read),
	// so a non-applying combination leaves BOTH items intact — neither lost.
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Close the screen and restore the room.
	closeInventoryScreen();
}

// --- Doors and walking (task 9, R3.8 / R2.6) --------------------------------
//
// `walk` has two forms, told apart by how many whitespace-separated integer
// arguments follow it:
//
//   * one arg  — `walk 52`      — walk to / through the room object whose
//                                 engine hotspot number is 52.
//   * two args — `walk 170 158` — walk the hero to the free room point (170,158).
//
// A bad target (object not in the room, or arguments that are not one or two
// integers) emits A11Y_ERR and the layer keeps running (R2.5). Both forms route
// through the engine's own walk/door code, which runs its own loop to
// completion before returning, so the command has settled by the time control
// is back in poll() and the next command can start (R2.2).

// Parse the whitespace-separated words of `arg` and decide which walk form it
// is. Accepts an optional leading sign on each integer so a negative coordinate
// is a clear malformed-target error rather than a silent atoi() surprise.
static bool parseInt(const Common::String &s, int &out) {
	if (s.empty())
		return false;
	uint i = 0;
	if (s[0] == '-' || s[0] == '+')
		i = 1;
	if (i >= s.size())
		return false;                 // sign with no digits
	for (; i < s.size(); i++) {
		if (s[i] < '0' || s[i] > '9')
			return false;
	}
	out = atoi(s.c_str());
	return true;
}

// Returns true when the walk went through a door that ENDED the chapter
// (exitRoom() returned true), so the caller can relay it up and end
// runCurrentChapter(). Every other outcome (free-point walk, non-door object,
// a non-chapter-ending door, or an A11Y_ERR) returns false.
bool A11yLayer::dispatchWalk(const Common::String &arg) {
	// Split the argument into whitespace-separated words. arg is already
	// trimmed by runCommand(), so there is no leading/trailing space; collapse
	// any run of spaces between words.
	Common::Array<Common::String> words;
	Common::String cur;
	for (uint i = 0; i < arg.size(); i++) {
		char c = arg[i];
		if (c == ' ' || c == '\t') {
			if (!cur.empty()) {
				words.push_back(cur);
				cur.clear();
			}
		} else {
			cur += c;
		}
	}
	if (!cur.empty())
		words.push_back(cur);

	if (words.empty()) {
		emitLine("A11Y_ERR walk needs a target: `walk <object>` or `walk <x> <y>`");
		return false;
	}

	// One word: object walk. Resolve the slot for the engine hotspot number and
	// walk to / through it; A11Y_ERR if the object is not in this room (R2.5).
	if (words.size() == 1) {
		int num;
		if (!parseInt(words[0], num)) {
			emitLine(Common::String("A11Y_ERR walk object must be a number, got: ") + words[0]);
			return false;
		}
		int slot = slotForObjectNum(num);
		if (slot < 0) {
			emitLine(Common::String::format(
				"A11Y_ERR object %d is not in this room", num));
			return false;
		}
		// Relay the door's chapter-ending signal (true == exitRoom ended the
		// chapter) up to the caller.
		return walkObject(slot);
	}

	// Two words: free-point walk. Both must be integers (R2.5).
	if (words.size() == 2) {
		int x, y;
		if (!parseInt(words[0], x) || !parseInt(words[1], y)) {
			emitLine(Common::String::format(
				"A11Y_ERR walk point needs two integer coordinates, got: %s %s",
				words[0].c_str(), words[1].c_str()));
			return false;
		}
		walkPoint(x, y);
		return false;
	}

	// Anything else is malformed (R2.5).
	emitLine("A11Y_ERR walk takes one object number or two coordinates, "
	         "e.g. `walk 52` or `walk 170 158`");
	return false;
}

// Walk to / through the room object in `slot`. A door runs the engine's own
// exitRoom(), so the hero walks to the door and the game plays its door
// animation and runs exitRoom()/enterRoom() the same way clicking the door
// does — the transition is the game's, not a teleport (R3.8). verify1() checks
// exitRoom(l) first for exactly this reason, so we mirror that: a door goes
// through exitRoom(); a non-door is a plain walk to its walk-to point.
//
// exitRoom() takes the slot index (it reads objectNum[slot], _roomObject[slot],
// isDoor[slot], _doorDestRoom[slot] itself) and does its own walkToPoint() to
// the door before the transition. A locked or no-op door returns its own text
// (e.g. chapter 1's room-105 door says "I DON'T HAVE A ROOM YET" via talk(442)
// when flags[0]==0) and returns false without changing room, which is the
// correct game behaviour, not an error — poll() simply finds the room
// unchanged and emits nothing new.
bool A11yLayer::walkObject(int slot) {
	DrasculaEngine *e = _engine;

	// Refresh the gated-door state before deciding the door path. In chapters 2
	// and 4 some doors are flag-gated: isDoor[slot] is only brought up to date by
	// updateDoor() (rooms.cpp doors[] table, e.g. ch2 door 136 keyed on flag 8),
	// and the engine's own exitRoom() calls updateDoor(doorNumber) as its first
	// step for exactly this reason. verify1() reaches exitRoom() unconditionally,
	// so a freshly-opened gated door works on a click. We check isDoor[slot]
	// ourselves to pick the door path, so we must refresh it the same way first —
	// otherwise a gated door whose flag was just set still reads isDoor==0 here
	// and a `walk` never opens it. updateDoor() is a no-op outside chapters 2/4.
	e->updateDoor(slot);

	if (e->isDoor[slot]) {
		// The engine's own door path: walk to the door, play any door
		// animation, run exitRoom()/enterRoom() for _doorDestRoom[slot]. When
		// this is driven by a `walk` command, poll()'s A11Y_DIFF carries the
		// resulting room/chapter change and the new room's objects (task 17), so
		// we do not emit a room-state line here.
		//
		// CRITICAL (chapter crossing): exitRoom() returns true for a door that
		// ENDS the chapter — chapter 1's door 105 runs animation_2_1() and
		// `return true` (rooms.cpp). In the real game that true flows out via
		// verify1() (`if (exitRoom(l)) return true;`) to the main loop
		// (`if (verify1()) return true;`), which ends runCurrentChapter() so
		// run() advances to the next chapter. We must propagate the SAME true,
		// or the chapter never ends and the hero walks past door 105 into
		// invalid coordinates. Mirrors the spike's `a11yActOnObject(l)` returning
		// the exitRoom result. The caller (dispatchWalk -> runCommand -> poll ->
		// the main-loop hook) relays it up so runCurrentChapter() returns true.
		return e->exitRoom(slot);
	}

	// A non-door object: just walk the hero to the object's walk-to point, the
	// same point the engine walks to before acting on the object. Face the
	// object afterwards, as the engine's own object-walk does (trackFinal via
	// _walkToObject). walkToPoint() runs its own loop to completion. A plain
	// walk never ends the chapter, so report false.
	e->trackFinal = e->trackObj[slot];
	e->_walkToObject = true;
	guardedWalkToPoint(e->_roomObject[slot]);
	return false;
}

// Walk the hero to a free room point using the engine's own walkToPoint(). The
// point is clamped to the walkable rectangle exactly as verify1() does for a
// free-point click: x within [_walkRect.left, _walkRect.right], y within
// [_walkRect.top + feetHeight, _walkRect.bottom]. This keeps the target on the
// floor the hero can actually reach; walkToPoint() then runs its own walk loop
// to completion (and returns at once if the hero is already on that cell, so a
// walk-in-place never hangs).
void A11yLayer::walkPoint(int x, int y) {
	DrasculaEngine *e = _engine;

	int cx = CLIP<int>(x, (int)e->_walkRect.left, (int)e->_walkRect.right);
	int cy = CLIP<int>(y, (int)e->_walkRect.top + e->feetHeight, (int)e->_walkRect.bottom);

	// A free-point walk is not an object walk, so clear _walkToObject; this
	// stops walkToPoint() applying trackFinal (the object-facing direction)
	// from a previous command.
	e->_walkToObject = false;
	guardedWalkToPoint(Common::Point(cx, cy));
}

// --- Conversations (task 15, R7.1 / R7.2 / R6.3 / gotcha 4) -----------------
//
// A Drascula conversation is a modal loop inside DrasculaEngine::converse()
// (converse.cpp). converse() loads op_<n>.cal — four option phrases plus the
// goodbye line — and loops: each frame it lays the four lines out with
// print_abc_opc() (which returns their heights, accumulated into the band
// bottoms), then selects the option whose band the cursor is over. A left click
// on options 1-3 runs talk()+response() (the reply plays through A11Y_TEXT from
// task 14) and loops again; a click on option 4 sets breakOut and ends the
// conversation. Because this loop runs its OWN frame pump (updateRoom /
// updateEvents / updateScreen) the engine main loop — and A11yLayer::poll() —
// does not run while it is open (gotcha 4). So the only way to describe the
// conversation and apply `choose`/`choices` is a hook inside converse()'s loop.
//
// The hook (onConverseFrame) is placed after the four option lines are laid out
// (so the band bottoms are known) and before the engine tests the cursor
// against them. Each frame the layer:
//   1. refreshes the band bottoms (the layout shifts as options are struck out);
//   2. (re-)emits A11Y_CHOICES on the opening frame and after each choice runs
//      (R6.3);
//   3. reads the command file and, if a `choose <n>`/`choices` is queued, acts
//      on it — `choose` sets _mouseY into option n's band and presses the left
//      button so the engine's own selection fires THIS frame (R7.1), exactly as
//      a real click would; option 4 ends the conversation (R7.2).
//
// The press/release split (R8.1, gotchas 2, 3) is kept: applyChoose presses on
// one converse frame, and the next frame's hook clears the button before
// looking at the next command, so the button is never pressed-and-released in
// one frame (dropped) nor held across the reply (which would skip lines).

// Called by converse() just before its while-loop. Marks a conversation open
// and arms the first A11Y_CHOICES emission.
void A11yLayer::onConverseBegin() {
	_converseActive = true;
	_converseNeedChoices = true;
	_choicePressed = false;

	// Fix A (permanent-busy dead state): a conversation must never inherit a
	// stale kActionSkip. The `talk` that opens this conversation may have been
	// preceded by skips the player queued to clear an earlier cutscene/line
	// (e.g. the drunk greeting), and any surplus kActionSkip left unconsumed in
	// the engine's action buffer would otherwise be read by converse()'s own
	// getAction() on its first frames — selecting or dismissing an option the
	// player never chose, and in the animation_16_2 case wedging the engine in
	// a state where no later command settles and A11Y_PHASE stays `busy`
	// forever. Drop any such surplus once, right as the conversation opens, so
	// the choice menu starts from clean input. dropSurplusSkips() touches only
	// unread skip input (queued skip commands and buffered kActionSkip), never
	// any other command or engine state.
	dropSurplusSkips();

	// Task 29 (R4.1/R7.1): converse() is running nested inside the current
	// main-loop command's dispatch (the `talk <npc>` that opened it), so this
	// conversation was opened BY that command. Record it, so the opening
	// onConverseFrame flushes the talk's A11Y_DIFF at choices-open instead of
	// poll() emitting it after the whole conversation ends. The flag is only
	// meaningful while a main command's diff is still pending (set in poll()).
	if (_mainCmdDiffPending)
		_mainCmdOpenedConverse = true;
}

// Called by converse() just after its while-loop ends. Clears all conversation
// state so a later conversation starts clean and the main-loop reader treats
// `choices`/`choose` as "no conversation open" again (R2.5).
void A11yLayer::onConverseEnd() {
	// Task 17 (R4): the ending choice (option 4, or a breakOut) exits the loop,
	// so its deferred A11Y_DIFF never reaches onConverseFrame's step (3b). Flush
	// it here so a `choose 4` still yields exactly one diff (R4.1). The ending
	// choice does not run a reply, so _said is normally empty; emitDiff() clears
	// the capture window regardless.
	if (_choiceDiffPending) {
		emitDiff(_choiceCmd, _choiceSnapshot, _choiceErrCount);
		_choiceDiffPending = false;
	}

	_converseActive = false;
	_converseNeedChoices = false;
	_choicePressed = false;
	for (int i = 0; i < 4; i++)
		_choiceBottom[i] = 0;
	// A choice click may have left the button pressed; make sure it is released
	// so the main loop does not read a stale press on its next frame.
	_engine->_leftMouseButton = 0;
}

// Emit one A11Y_CHOICES line from the engine's own option strings (R6.3). Shape:
//   A11Y_CHOICES {"choices":[{"n":1,"text":"...","used":false}, ...,
//                            {"n":4,"text":"...","ends":true}]}
// An option already picked this conversation has game == kDialogOptionClicked,
// reported as "used":true. Option 4 is the goodbye line and always ends the
// conversation, so it carries "ends":true (R7.2). Text is the engine's own,
// emitted verbatim (never fabricated).
void A11yLayer::emitChoices(const char *p1, const char *p2, const char *p3, const char *p4,
                            int game1, int game2, int game3) {
	const char *phrases[4] = { p1, p2, p3, p4 };
	int games[4] = { game1, game2, game3, kDialogOptionUnselected };

	Common::String json = "A11Y_CHOICES {\"choices\":[";
	for (int i = 0; i < 4; i++) {
		if (i > 0)
			json += ",";
		const char *t = phrases[i] ? phrases[i] : "";
		json += Common::String::format(
			"{\"n\":%d,\"text\":\"%s\",\"used\":%s",
			i + 1,
			jsonEscape(t).c_str(),
			games[i] == kDialogOptionClicked ? "true" : "false");
		// Option 4 always ends the conversation (R7.2).
		if (i == 3)
			json += ",\"ends\":true";
		json += "}";
	}
	json += "]}";
	emitLine(json);

	// Engine-truth phase: a choice menu is now open and waiting for the player.
	// The conversation runs its own modal loop (gotcha 4), so poll() — which
	// emits control/busy — does not run while it is open; this is the only
	// place the `choice` phase can be raised. Emitted after the A11Y_CHOICES
	// line so a reader sees the choices first, then the phase that says they
	// are waiting. emitPhase only writes on a change, so a re-emit after a
	// non-ending choice (the menu re-opens) does not repeat the phase line.
	emitPhase(kPhaseChoice);
}

// Apply `choose <n>` (n in 1..4) inside a conversation by reproducing a real
// click on that option line (R7.1): warp the cursor to the vertical middle of
// option n's text band and press the left button, so the engine's own cursor
// test in converse() selects option n this frame. The engine then runs
// talk()+response() (options 1-3) or sets breakOut (option 4, R7.2). The band
// bottoms come from the most recent onConverseFrame(); the midpoint of band n
// is between the previous option's bottom and option n's bottom. An n outside
// 1..4, or a band that is not laid out (bottom 0), is an A11Y_ERR with no
// action (R2.5).
void A11yLayer::applyChoose(int n) {
	DrasculaEngine *e = _engine;

	if (n < 1 || n > 4) {
		emitLine(Common::String::format(
			"A11Y_ERR choose takes an option 1-4, got %d", n));
		return;
	}

	// The engine selects option k when _mouseY is strictly between the previous
	// option's bottom and option k's bottom (converse.cpp). Band 1's lower edge
	// is 0. Pick a Y safely inside the band: the midpoint of (prevBottom,
	// thisBottom). _choiceBottom is 1-indexed by option in [0..3].
	int prevBottom = (n == 1) ? 0 : _choiceBottom[n - 2];
	int thisBottom = _choiceBottom[n - 1];

	// A degenerate band (thisBottom <= prevBottom + 1) means the layout has not
	// produced a selectable strip for this option (e.g. an empty goodbye line in
	// a malformed conversation). Refuse rather than press into a dead zone.
	if (thisBottom <= prevBottom + 1) {
		emitLine(Common::String::format(
			"A11Y_ERR option %d is not selectable in this conversation", n));
		return;
	}

	int midY = (prevBottom + thisBottom) / 2;

	// Warp the cursor to the band and press the left button, exactly as a real
	// click on that line does. The X only has to be on screen; the engine
	// selects on _mouseY alone. We set the engine's own tracked position (what
	// converse() reads) and move the backend cursor so a native real-window run
	// shows the cursor over the option too.
	e->_mouseX = 160;
	e->_mouseY = midY;
	if (g_system)
		g_system->warpMouse(160, midY);

	e->_leftMouseButton = 1;
	_choicePressed = true;
}

// Called from the converse() loop each frame (gotcha 4). See the block comment
// above. Order within the frame:
//   1. Release a press from the previous frame (R8.1): the engine already acted
//      on it (ran talk()+response() or breakOut), so clear the button now so it
//      is a clean one-frame press, never held across the reply (gotcha 3). A
//      non-ending choice (options 1-3) means the conversation re-opens, so arm
//      a fresh A11Y_CHOICES for this frame (R6.3 "after each choice").
//   2. Cache this frame's band bottoms (the layout shifts as options are used).
//   3. Emit A11Y_CHOICES if armed (opening frame or just after a choice).
//   4. Read the command file and act on each queued command in turn:
//      `choices` re-emits; `choose <n>` applies and returns (the engine acts on
//      the press this same frame); a leftover `skip` is a no-op here and is
//      consumed; any other verb is rejected with an A11Y_ERR ("finish the
//      conversation first") and consumed. Every command is consumed — the loop
//      never leaves one at the head, because a stuck head is what wedged the
//      queue in the chapter-2 dead state.
void A11yLayer::onConverseFrame(const char *phrase1, const char *phrase2,
                                const char *phrase3, const char *phrase4,
                                int game1, int game2, int game3,
                                int bottom1, int bottom2, int bottom3, int bottom4) {
	DrasculaEngine *e = _engine;

	// Reply-menu fix (liveness): a conversation runs converse.cpp's own modal
	// loop, so poll() does not run and nothing is emitted for the whole time the
	// menu is open — liveness (max of _lastPollMs and g_lastEngineOutputMs) goes
	// stale even though the engine is perfectly alive and simply waiting for the
	// player. The busy watchdog already refuses to escalate while _converseActive
	// is set, but the FIRST frames right after the conversation ends must not
	// start the watchdog's clock from the long-stale stamp this menu left behind.
	// Stamp _lastPollMs here (the same liveness the watchdog reads) on every
	// converse frame, so when control returns to the main loop liveness is fresh
	// and a brand-new stall is measured from now, not from before the menu opened.
	if (g_system)
		_lastPollMs = g_system->getMillis();

	// (1) Release a press issued on the previous converse frame. The engine has
	// already selected the option and run its talk()+response() (options 1-3) or
	// set breakOut (option 4) before control returned here, so dropping the
	// button now gives a clean press-then-release across two frames (R8.1) and
	// never a button held through the reply (gotcha 3).
	if (_choicePressed) {
		e->_leftMouseButton = 0;
		_choicePressed = false;
		// A non-ending choice re-opens the option list, so list it again with
		// the picked option now struck through (R6.3 "after each choice"). If
		// the choice ended the conversation, onConverseEnd() runs instead and
		// this flag is harmless.
		_converseNeedChoices = true;
	}

	// (2) Cache the current band bottoms so applyChoose() can land _mouseY in the
	// right strip. Refreshed every frame because used options are struck out and
	// the layout shifts.
	_choiceBottom[0] = bottom1;
	_choiceBottom[1] = bottom2;
	_choiceBottom[2] = bottom3;
	_choiceBottom[3] = bottom4;

	// (3) Emit the choices when armed: on the opening frame and after each
	// non-ending choice (R6.3).
	if (_converseNeedChoices) {
		emitChoices(phrase1, phrase2, phrase3, phrase4, game1, game2, game3);
		_converseNeedChoices = false;
	}

	// (3a) Task 29 (R4.1/R7.1/R6.3): on the OPENING frame of a conversation that
	// the current `talk` command opened, emit that talk's A11Y_DIFF now — right
	// after the first A11Y_CHOICES — so the player hears what the talk changed
	// at the moment the choices appear, not after the whole conversation ends.
	// emitPendingMainCmdDiff() uses the before-snapshot/cmd/errCount poll()
	// stored before runCommand() and clears _mainCmdDiffPending so the diff
	// fires exactly once; poll() then skips its own emit for this command. This
	// runs only while _mainCmdOpenedConverse is set (the talk that opened this
	// conversation), so a later non-ending choice re-arming _converseNeedChoices
	// does not re-emit it (the pending flag is already clear by then).
	if (_mainCmdOpenedConverse && _mainCmdDiffPending) {
		emitPendingMainCmdDiff();
		_mainCmdOpenedConverse = false;
	}

	// (3b) Task 17 (R4): a non-ending choice applied on a previous frame has now
	// had its reply run (talk()+response()) and control is back in the loop, so
	// the choice has settled — emit its deferred A11Y_DIFF. The said lines drawn
	// during the reply are already in _said (captured by onText since the choice
	// armed the window). emitDiff() clears the capture and the buffer. An ending
	// choice (option 4) never reaches here — onConverseEnd() flushes it instead.
	if (_choiceDiffPending) {
		emitDiff(_choiceCmd, _choiceSnapshot, _choiceErrCount);
		_choiceDiffPending = false;
	}

	// Fix A (permanent-busy dead state): after a non-ending choice's reply has
	// run and settled (step 3b above), drop any surplus skip input before this
	// frame re-lists the choices and reads the next command. The reply
	// (talk()+response()) runs its own speech loop, which — like a cutscene —
	// drains kActionSkip via getAction(); if the player had queued more skips
	// than that reply had lines, the leftover kActionSkip would sit in the
	// engine's action buffer and be read by the NEXT converse frame's own
	// getAction(), dismissing or mis-selecting the re-listed options and, in the
	// animation_16_2 path, wedging the engine so no later command settles and
	// A11Y_PHASE never leaves `busy`. Clearing it here means each re-listed
	// choice menu starts from clean input. Only unread skip input is touched.
	dropSurplusSkips();

	// (4) Service the command file. Append any new lines, then look at the next
	// queued command.
	readCommandFile();

	while (_queueHead < _commandQueue.size()) {
		const Common::String &cmd = _commandQueue[_queueHead];

		// Split off the first word (the verb).
		uint sp = 0;
		while (sp < cmd.size() && cmd[sp] != ' ')
			sp++;
		Common::String verb = (sp < cmd.size()) ? Common::String(cmd.c_str(), sp) : cmd;
		Common::String arg;
		if (sp < cmd.size())
			arg = Common::String(cmd.c_str() + sp + 1);
		arg.trim();

		if (verb == "choices") {
			// Re-list the current options on demand (R7.1). Consume the command
			// and keep looking (a `choices` does not act on the engine, so a
			// following `choose` on the same frame is fine).
			emitLine(Common::String("A11Y_CMD ") + cmd);
			emitChoices(phrase1, phrase2, phrase3, phrase4, game1, game2, game3);
			_queueHead++;
			continue;
		}

		if (verb == "choose") {
			emitLine(Common::String("A11Y_CMD ") + cmd);
			int n;
			if (!parseInt(arg, n)) {
				emitLine(Common::String("A11Y_ERR choose needs an option number 1-4, got: ") + arg);
				_queueHead++;
				continue;
			}
			_queueHead++;

			// Task 17 (R4): poll() cannot build this command's diff — the
			// conversation loop runs instead. Snapshot the state and arm said-
			// capture NOW, before the choice runs, and defer the A11Y_DIFF until
			// the choice's reply has settled: the next converse frame for a non-
			// ending choice (options 1-3, where talk()+response() runs and
			// control returns to the loop), or onConverseEnd() for the ending
			// choice (option 4). applyChoose() may itself A11Y_ERR on a bad n,
			// in which case the deferred diff is suppressed by the errCount
			// compare in emitDiff(), so the command still yields one err and no
			// diff (R4.1).
			takeSnapshot(_choiceSnapshot);
			_choiceErrCount = g_errCount;
			_choiceCmd = cmd;
			_choiceDiffPending = true;
			beginSaidCapture();

			// Apply the choice: this presses the button so the engine selects
			// option n THIS frame, below in converse(). Return so the engine's
			// own selection/reply runs before we look at the next command.
			applyChoose(n);
			// Reclaim the queue if it has now drained.
			if (_queueHead >= _commandQueue.size()) {
				_commandQueue.clear();
				_queueHead = 0;
			}
			return;
		}

		// Fix (chapter-2 dead state): a leftover `skip` at the head of the queue.
		// A `skip` the player pressed DURING the Von Braun story (or any reply)
		// is normally drained by that reply's own speech loop; but when the
		// player queued more skips than the reply had lines, a surplus `skip`
		// stays in our queue and arrives here, at the head, once the reply has
		// settled and the choices are re-listed. It is NOT a conversation
		// command, so the old code hit `break` below and left it stuck at the
		// head — and because the head never advanced, every later command (the
		// player's next `choose`, and everything after it) waited behind it
		// forever while onUpdateEvents() kept running and the busy watchdog
		// fired. Consume the surplus `skip` here instead: it has nothing left to
		// skip inside an open choice menu, so it is a harmless no-op. Echo it as
		// A11Y_CMD (the same convention takeQueuedSkip() uses when it drains a
		// queued skip, a11y.cpp), advance the head, and keep scanning so a
		// `choose` queued right behind it still runs this frame.
		if (verb == "skip") {
			emitLine(Common::String("A11Y_CMD ") + cmd);
			_queueHead++;
			continue;
		}

		// Any other verb while a conversation is open is a command the player
		// cannot run until the conversation ends (walk, take, use, look, …).
		// The old code left it at the head with `break`, which — exactly like
		// the stuck `skip` above — wedged the queue so no later command ever
		// ran. Instead, tell the player plainly that they must finish the
		// conversation first, then CONSUME the command (advance the head) and
		// keep scanning. Never `break` with an unconsumed command at the head:
		// an unconsumed head is what caused the dead state. The player's error
		// line is mapped in src/engine/error-lines.ts.
		emitLine(Common::String("A11Y_ERR finish the conversation first: ") + cmd);
		_queueHead++;
		continue;
	}

	// Reclaim the queue so a long session does not grow it. The loop above now
	// consumes every command at the head — a `choose` returns after applying,
	// and `choices`/`skip`/any other verb each advance the head and continue —
	// so control reaches here only once the queue has fully drained (or when
	// `choose` returned, which reclaims inline). The guard stays defensive: it
	// clears only when nothing is pending.
	if (_queueHead >= _commandQueue.size()) {
		_commandQueue.clear();
		_queueHead = 0;
	}
}

// --- Synthetic click model (R8 / R3.3 / gotchas 2, 3) -----------------------
//
// A real left click in Drascula is two events on two different frames: a
// button-down, then a button-up later. The main loop (drascula.cpp,
// runCurrentChapter) reads the resulting _leftMouseButton once per frame and,
// when it is 1 and was not already handled (_leftMouseButtonHeld == false),
// runs verify1()/verify2() for that click, sets _leftMouseButtonHeld = true and
// delays ~50 ms. On a later frame it sees _leftMouseButton == 0 and clears
// _leftMouseButtonHeld. updateEvents() is what normally sets _leftMouseButton
// (1 on EVENT_LBUTTONDOWN, 0 on EVENT_LBUTTONUP) and _mouseX/_mouseY (on
// EVENT_MOUSEMOVE); with no real input device driving the replay, those fields
// stay exactly as we leave them until the next real event, so we set them
// directly.
//
// Two hard rules fall out of that (gotchas 2, 3):
//   * Press and release must land on separate frames. If we set the button to
//     1 and back to 0 within one poll(), the main loop reads a single value and
//     the click is either seen once or not at all — never the clean down-then-up
//     a click needs. So synthClick() only presses; stepClick() releases next
//     frame (R8.1).
//   * The button must not stay held across dialogue. A held button makes the
//     speech loop treat every line as "skip", so lines are lost. Releasing on
//     the very next frame, the way a real click does, avoids that (R8.2).

// Set the button down for the press frame and warp the mouse to (x, y).
//
// The warp is the R3.3 requirement: direct object dispatch (tasks 8-11) acts on
// the object slot itself and does not depend on the pixel under the cursor, but
// the engine derives the on-screen hover name from _mouseX/_mouseY in
// checkObjects()/moveCursor(). Warping the cursor to the target's hotspot keeps
// that hover name matching the object the action runs on. We set the engine's
// own _mouseX/_mouseY (what checkObjects/verify read) and also ask the backend
// to move the real cursor via g_system->warpMouse(), so a native real-window
// run shows the cursor over the object too; on the web build warpMouse is a
// no-op on an invisible cursor, which is fine.
void A11yLayer::synthClick(int x, int y) {
	DrasculaEngine *e = _engine;

	// Warp (R3.3): move both the engine's tracked position and the backend
	// cursor to the target hotspot so the hover name matches.
	e->_mouseX = x;
	e->_mouseY = y;
	if (g_system)
		g_system->warpMouse(x, y);

	// Press (R8.1): button down, and make sure the "already handled" latch is
	// clear so the main loop treats this as a fresh click and runs verify*().
	e->_leftMouseButton = 1;
	e->_leftMouseButtonHeld = false;

	_clickState = kClickPressed;
}

// Release frame: with the press acted on last frame, drop the button back to 0
// so the main loop clears _leftMouseButtonHeld and the click ends — press and
// release on separate frames, button not left held (R8.1, R8.2). Called from
// stepClick() at the top of the frame after synthClick().
bool A11yLayer::clickSettled() const {
	return _clickState == kClickIdle;
}

// Advance the click state machine by one frame. Runs at the top of poll(),
// before any command is dequeued, so an in-flight click's release lands before
// the next command is considered (R2.2 settle model).
void A11yLayer::stepClick() {
	if (_clickState == kClickPressed) {
		// Release the button on this, the frame after the press (R8.1). The
		// main loop will see _leftMouseButton == 0 and reset _leftMouseButtonHeld.
		_engine->_leftMouseButton = 0;
		_clickState = kClickIdle;
	}
}

// Called once per main-loop frame. Three jobs, in order:
//
//   1. Read the command file and append any new lines to the queue (R2.1).
//   2. Run at most one queued command this frame, dequeuing the next only after
//      the current one has settled (R2.2). Because dispatch calls the engine's
//      own action code — which runs its own walk/speech/cutscene loops to
//      completion before returning — control is back here only once the command
//      has settled, so "one command per poll" is exactly "one at a time, next
//      after the previous settles". Commands with no handler yet (this task)
//      settle immediately.
//   3. Re-emit the A11Y room state on a room/chapter change (R1.1). The
//      transition itself happens inside exitRoom()/enterRoom() in rooms.cpp
//      (which the patch does not touch); control returns here once the move has
//      settled, so detecting the change in the main-loop poll keeps all engine
//      hooks in drascula.cpp (R10.2) and lines up with the command-settle model.
//
// The room-change check runs after the command so that a command which changed
// room (a later task) still produces its room-state line in the same frame.
//
// A synthetic click in flight is advanced first (stepClick): its release lands
// on the frame after the press, and no new command is dequeued until the click
// has settled (clickSettled). This keeps the two-step press/release click
// (R8.1, R8.2) inside the one-command-at-a-time settle model (R2.2): a command
// that issues a click this frame does not let the next command start until the
// click's release frame has run.

// Emit `A11Y_PHASE <name>` only when the phase changes (kPhaseNone forces the
// first real phase out, so a reader always sees an initial phase). Cheap: a
// compare, and on a change only, one emitLine().
void A11yLayer::emitPhase(Phase phase) {
	if (phase == _lastPhase)
		return;
	_lastPhase = phase;
	const char *name =
		phase == kPhaseControl ? "control" :
		phase == kPhaseChoice  ? "choice"  : "busy";
	emitLine(Common::String("A11Y_PHASE ") + name);
}

// Control/busy phase for this frame, read from the per-engine control probe.
// There is no reliable engine-wide "player in control" API
// (canSaveGameStateCurrently() does NOT mean this — see A11yControlProbe), so
// the test lives behind the probe interface and this function stays
// game-agnostic: it asks the probe and maps the answer to a phase. Called once
// per poll() frame; emits only on a change, so in the steady state it is one
// virtual call plus a compare per frame.
void A11yLayer::updateControlPhase() {
	emitPhase(_probe->playerInControl() ? kPhaseControl : kPhaseBusy);
}

// --- DrasculaControlProbe: the Drascula "player in control" test -------------
//
// playerInControl() is true when the engine is idle in free play and ready for
// a command this frame. In Drascula that is three things together:
//   1. The main-loop poll hook (drascula.cpp:588) was reached this frame or the
//      previous one. A talk, cutscene or room-transition loop runs the engine's
//      OWN frame pump and never returns to the main loop, so poll() (and the
//      _lastPollMs stamp) stops advancing for the whole of that loop; a stale
//      stamp therefore means a nested loop has taken over and the player is not
//      in control. We treat "this frame or the previous one" as a stamp no more
//      than ~1-2 frames old (kPollFreshMs below), which tolerates the normal
//      per-frame cadence while still going stale the moment a nested loop runs.
//   2. The engine is not in a modal verb/inventory menu (!_menuScreen).
//   3. No a11y command is executing (!_inRunCommand) — a command in flight is
//      driving the engine, so the player is not at the controls until it
//      settles.
// NB: the engine's own _canSaveLoad is deliberately NOT used: it is set true
// only inside two narrow event-pump windows of the main loop
// (drascula.cpp:630-633 and 704-707), so read from our poll hook it is false
// even in free play.
//
// awaitingChoice() is true for the whole converse() window — between
// onConverseBegin() (converse.cpp:223) and onConverseEnd() (converse.cpp:328) —
// tracked by the layer's _converseActive flag. The `choice` phase itself is
// still raised from emitChoices() (the modal loop means poll() cannot), so this
// signal is exposed for completeness and for ports that drive the phase from
// the probe alone.
bool A11yLayer::DrasculaControlProbe::playerInControl() {
	// How recent the last poll() stamp must be to count as "this frame or the
	// previous one". The engine caps itself near 25-60 fps (frames are tens of
	// ms apart), so ~120 ms comfortably spans one or two frames of jitter while
	// still reading stale within a frame or two of a nested loop taking over.
	static const uint32 kPollFreshMs = 120;
	DrasculaEngine *e = _layer->_engine;
	uint32 last = _layer->_lastPollMs;
	bool pollFresh = last != 0 && g_system &&
	                 (g_system->getMillis() - last) <= kPollFreshMs;
	return pollFresh && !e->_menuScreen && !_layer->_inRunCommand;
}

bool A11yLayer::DrasculaControlProbe::awaitingChoice() {
	return _layer->_converseActive;
}

bool A11yLayer::poll() {
	// Stamp that the main loop reached our per-frame poll hook this frame. The
	// control probe reads this: a nested talk/cutscene/transition loop runs the
	// engine's own pump and never returns here, so the stamp goes stale and the
	// probe reports the player is no longer in control (phase `busy`). Stamped
	// first thing, before any early return below, so even the click-settle hold
	// frames still count as the main loop being live.
	if (g_system)
		_lastPollMs = g_system->getMillis();

	// Advance any click in flight (release the button the frame after a press).
	stepClick();

	readCommandFile();

	// Hold the queue while a synthetic click is mid-flight: the current command
	// has not settled until its click's release frame has run (R2.2, R8.1).
	if (!clickSettled())
		return false;

	bool ranCommand = false;
	// The chapter/room this frame started in, captured before runCommand() so
	// the tail of poll() can tell whether THIS command changed the room (a walk
	// through a door). A command-driven room change needs the room-state line
	// re-emitted and a fresh control-phase evaluation (see the tail), because
	// the whole walk+transition runs inside this one frame and the top-of-frame
	// _lastPollMs stamp is stale by the time we reach updateControlPhase().
	int cmdBeforeChapter = _engine->currentChapter;
	int cmdBeforeRoom = _engine->_roomNumber;
	if (_queueHead < _commandQueue.size()) {
		Common::String cmd = _commandQueue[_queueHead];
		_queueHead++;
		ranCommand = true;

		// Task 17 (R4): snapshot the state and arm the said-capture window just
		// before dispatch, run the command to settle, then emit ONE A11Y_DIFF
		// describing what moved. runCommand() calls the engine's own action
		// code, which runs its walk/speech/cutscene loops to completion before
		// returning, so by the time control is back here the command has
		// settled and the after-snapshot inside emitDiff() is the settled state
		// — a single `walk` that crosses a chapter boundary (walk out, cutscene,
		// enter chapter 2) yields one coherent diff (design "Settling").
		//
		// emitDiff() suppresses the diff when the command emitted an A11Y_ERR
		// (errCountBefore compare), so an erring command yields one err and no
		// diff (R2.5 / R4.1).
		Snapshot before;
		takeSnapshot(before);
		uint32 errCountBefore = g_errCount;
		beginSaidCapture();

		// Task 29 (R4.1/R7.1/R6.3): a `talk` that opens a conversation runs
		// converse()'s modal loop to completion INSIDE runCommand(), and the
		// converse hook — not poll() — must emit this command's A11Y_DIFF at the
		// moment the choices first appear. The converse hook cannot see poll()'s
		// locals (it runs nested below this frame), so publish the command's
		// before-snapshot, errCount and cmd string on the layer, and arm the
		// pending flag. If a conversation opens, the opening onConverseFrame
		// flushes the diff and clears _mainCmdDiffPending; otherwise the flag
		// stays set and poll() emits the diff itself below (the normal path).
		_mainCmd = cmd;
		_mainCmdSnapshot = before;
		_mainCmdErrCount = errCountBefore;
		_mainCmdDiffPending = true;
		_mainCmdOpenedConverse = false;

		// Mark that a command is in flight for the whole of runCommand(). The
		// skip hook (onUpdateEvents) checks this: a `skip` it drains WHILE this
		// is set is advancing this command's own cutscene/speech loop, so it
		// emits no diff of its own (this command's diff covers it); a `skip` it
		// drains with this clear has nothing to skip and emits the no-op diff.
		_inRunCommand = true;
		// Engine-truth phase: a command is now in flight, so the engine is busy
		// until it settles. Emit `busy` BEFORE runCommand() — which blocks the
		// main loop for the whole command (walk/speech/cutscene) — so a reader
		// sees the busy edge even for a command that settles within one frame
		// (the tail of poll() re-emits `control` once it has). A `talk` that
		// opens a conversation instead reaches `choice` from the converse path.
		emitPhase(kPhaseBusy);
		bool endedChapter = runCommand(cmd);
		_inRunCommand = false;

		if (endedChapter) {
			// The command ended the chapter: a `walk` through a chapter-ending
			// door (exitRoom() ran the crossing cutscene, e.g. animation_2_1, and
			// returned true), or a verb / `use` whose checkAction() returned
			// true. runCommand() relayed that up to us. We must now end the chapter so
			// run() advances to the next one — but the NEXT chapter's first room
			// is not set up yet, so the crossing's A11Y_DIFF cannot be built
			// here (the after-state does not exist). Stash the before-snapshot,
			// cmd, error baseline and the cutscene's captured `said` lines in the
			// module-static carrier; the next chapter's onStartup() emits the one
			// coherent diff once its room is live (R4.3, design "Settling"). Then
			// return true so the main-loop hook ends runCurrentChapter(), exactly
			// as `if (verify1()) return true;` does for a real door click.
			//
			// Task 23 (R7.3/R7.4, gotcha 5): the crossing cutscene (animation_2_1)
			// was advanced by paced `skip`s, and the player may have queued MORE
			// skips than the cutscene had steps to end. Drop the surplus now —
			// both the extra kActionSkip left unconsumed in the engine's action
			// buffer and any extra `skip` still unread in our queue — so no stray
			// skip bleeds into chapter 2's first room (skipping its opening line)
			// or runs as a main-loop `skip` there. Non-`skip` commands are kept.
			dropSurplusSkips();
			if (_engine->currentChapter == 6) {
				// The LAST chapter ended: there is no next chapter to carry a
				// diff (no stash for a chapter 7). onGameEnd() (hooked in
				// animation_9_6) has normally
				// already emitted A11Y_GAME_END before the credits; this is the
				// fallback so the line is never missing. run() leaves after
				// chapter 6 and the engine exits on its own.
				if (!_gameEnded)
					emitGameEnd(cmd);
				// The ending (and its credits) ran inside this command, so the
				// engine is now about to quit. Say so with one bare line: the
				// web runtime keeps running after the engine quits, so the page
				// cannot rely on a process exit to know the game stopped.
				emitLine("A11Y_EXIT");
				_mainCmdDiffPending = false;
				_mainCmdOpenedConverse = false;
				return true;
			}
			stashCrossChapterDiff(cmd, before, errCountBefore);
			// A chapter-crossing walk opens no conversation; its diff is carried
			// by the next chapter's onStartup(), not by the converse hook, so
			// clear the main-cmd pending flag (task 29) — it is not this path's
			// concern and must not leak into the next command.
			_mainCmdDiffPending = false;
			_mainCmdOpenedConverse = false;
			return true;
		}

		// Task 29: if a conversation opened during this command, the opening
		// onConverseFrame already emitted this command's A11Y_DIFF at
		// choices-open (and cleared _mainCmdDiffPending), so poll() must NOT
		// emit a second diff for the same command at conversation end (R4.1).
		// When no conversation opened the flag is still set and we emit here as
		// usual (the normal path, unchanged). Either way the command yields
		// exactly one diff.
		if (_mainCmdDiffPending) {
			emitDiff(cmd, before, errCountBefore);
			_mainCmdDiffPending = false;
		}
		_mainCmdOpenedConverse = false;

		// Reclaim the spent prefix once the queue has fully drained, so a long
		// session does not grow the array without bound. Nothing is pending, so
		// clearing is safe and keeps _queueHead meaningful.
		if (_queueHead >= _commandQueue.size()) {
			_commandQueue.clear();
			_queueHead = 0;
		}
	}

	// Did THIS command change the room (a walk through a within-chapter door,
	// e.g. chapter 2's inn-bar exit 159 -> street room 12)? The chapter-ending
	// crossing (door 105) already returned true above, so reaching here with a
	// changed room means a normal within-chapter exit settled this frame.
	const bool cmdChangedRoom =
		ranCommand && (_engine->currentChapter != cmdBeforeChapter ||
		               _engine->_roomNumber != cmdBeforeRoom);

	if (ranCommand) {
		if (cmdChangedRoom) {
			// A command-driven within-chapter room change (a walk through a
			// door). The A11Y_DIFF above already carries the room/chapter change
			// AND the new room's objects, so it is the single carrier for the
			// transition — the player applies the room change and refreshes its
			// hotspot list straight from that diff. We deliberately do NOT
			// re-emit a separate A11Y room-state line here: that would make the
			// player read the room twice and autosave twice on one exit. (An
			// earlier fix emitted it on the assumption the diff was not enough;
			// with the glued-line split fixed in the player, the diff reaches
			// the player intact and the extra line is redundant.) The
			// chapter-crossing path keeps its single-diff shape via the carrier
			// and does NOT reach here (it returned true above).
			//
			// Re-stamp _lastPollMs to NOW. The whole walk + door transition ran
			// inside this one poll() frame, taking hundreds of ms, so the
			// top-of-frame stamp is now stale (> kPollFreshMs). Without a fresh
			// stamp updateControlPhase()'s probe would read the player as NOT in
			// control and emit `busy`, so the engine-truth web player
			// (src/engine/status.ts drives its phase ONLY from A11Y_PHASE and
			// never settles on the diff) would never return to `ready`.
			// Re-stamping means the settling frame reports `control`. Sync the
			// last-room markers to the settled state too, exactly as the
			// no-room-change branch does.
			if (g_system)
				_lastPollMs = g_system->getMillis();
			_lastChapter = _engine->currentChapter;
			_lastRoom = _engine->_roomNumber;
		} else {
			// No room change: the A11Y_DIFF carried the result, so no separate
			// A11Y room-state line (the look/take/talk transcripts show the diff
			// alone). Just sync the last-room markers to the settled state.
			_lastChapter = _engine->currentChapter;
			_lastRoom = _engine->_roomNumber;
		}
	} else if (_engine->currentChapter != _lastChapter ||
	           _engine->_roomNumber != _lastRoom) {
		// A room/chapter change that NO command drove (a spontaneous engine
		// transition — none occur in chapters 1-2, but guard anyway). There is
		// no command to attribute a diff to, so re-emit the full A11Y room state
		// as the original per-frame room-change watch did (R1.1).
		emitRoomState();
	}

	// Engine-truth control phase for this frame: after any command this frame
	// has run and settled (_inRunCommand is false again), emit `control` when
	// the engine can take a command, `busy` otherwise — but only on a change,
	// so the steady-state idle frame emits nothing. This is the edge that moves
	// the player's readiness signal back to 'ready' straight from the engine,
	// with no pause-based guessing. On a command-driven room change the
	// _lastPollMs re-stamp above guarantees the probe reads the player as back
	// in control on this frame, so `control` is emitted on the settling frame
	// rather than a later frame that may never come. Not reached while a
	// conversation is open (converse() runs its own loop and poll() does not
	// run); that path emits `choice` instead.
	updateControlPhase();

	// No chapter-ending command this frame, so the main loop keeps running.
	return false;
}

// The final chapter ended. Emit `A11Y_GAME_END {"cmd":...,"said":[...]}` with
// the ending's captured spoken lines, then close the said-capture window.
void A11yLayer::onGameEnd() {
	if (_gameEnded)
		return;
	emitGameEnd(_inRunCommand ? _mainCmd : Common::String());
}
void A11yLayer::emitGameEnd(const Common::String &cmd) {
	_gameEnded = true;
	Common::String json = "A11Y_GAME_END {\"cmd\":\"" + jsonEscape(cmd.c_str()) + "\",\"said\":[";
	for (uint i = 0; i < _said.size(); i++) {
		if (i > 0)
			json += ",";
		json += Common::String::format("{\"color\":\"%s\",\"text\":\"%s\"",
		                               jsonEscape(_said[i].color.c_str()).c_str(),
		                               jsonEscape(_said[i].text.c_str()).c_str());
		if (_said[i].voiced)
			json += ",\"voiced\":true";
		json += "}";
	}
	json += "]}";
	emitLine(json);
	_capturingSaid = false;
	_said.clear();
}
// Stash the before-snapshot and captured said lines for a chapter-crossing
// `walk` into the module-static carrier, so the NEXT chapter's onStartup() can
// emit the one coherent A11Y_DIFF once its first room is set up. Called from
// poll() at the instant it detects the crossing (exitRoom returned true), just
// before poll() returns true to end the chapter. Copies the Snapshot's parts
// (Snapshot is a private nested type, so its fields are stored individually in
// the carrier) plus the _said buffer, then closes the said-capture window.
void A11yLayer::stashCrossChapterDiff(const Common::String &cmd,
                                      const Snapshot &before, uint32 errCountBefore) {
	CrossChapterDiff &cd = g_crossDiff();

	cd.pending = true;
	cd.cmd = cmd;
	cd.errCountBefore = errCountBefore;

	cd.chapter = before.chapter;
	cd.room = before.room;
	cd.heroX = before.heroX;
	cd.heroY = before.heroY;
	cd.objNums = before.objNums;
	cd.objVisible = before.objVisible;
	cd.objDoor = before.objDoor;
	cd.inventory = before.inventory;
	for (int f = 0; f < NUM_FLAGS; f++)
		cd.flags[f] = before.flags[f];

	// Carry the said lines the crossing cutscene drew (captured by onText()
	// while _capturingSaid was armed) so the crossing diff reports them.
	cd.saidColor.clear();
	cd.saidText.clear();
	cd.saidVoiced.clear();
	for (uint i = 0; i < _said.size(); i++) {
		cd.saidColor.push_back(_said[i].color);
		cd.saidText.push_back(_said[i].text);
		cd.saidVoiced.push_back(_said[i].voiced);
	}

	// Close this layer's capture window; the layer is about to be destroyed.
	_capturingSaid = false;
	_said.clear();
}

// If a chapter-crossing diff is pending (stashed by the previous chapter's
// layer), emit it now from THIS layer, against this layer's live (settled) room
// — the new chapter's first room. Rebuilds the before-Snapshot from the carrier
// and the _said buffer, then calls the normal emitDiff() so the crossing is a
// single ordinary A11Y_DIFF (chapter [1,2], room [62,14], new-room objects,
// said lines, changed:true). Returns true if a diff was emitted (so onStartup()
// skips the usual plain room-state line, matching the fixture which shows the
// crossing as one diff and no A11Y line). Clears the carrier either way.
bool A11yLayer::emitPendingCrossChapterDiff() {
	CrossChapterDiff &cd = g_crossDiff();

	if (!cd.pending)
		return false;

	// Rebuild the before-snapshot from the carrier.
	Snapshot before;
	before.chapter = cd.chapter;
	before.room = cd.room;
	before.heroX = cd.heroX;
	before.heroY = cd.heroY;
	before.objNums = cd.objNums;
	before.objVisible = cd.objVisible;
	before.objDoor = cd.objDoor;
	before.inventory = cd.inventory;
	for (int f = 0; f < NUM_FLAGS; f++)
		before.flags[f] = cd.flags[f];

	// Restore the said lines the crossing cutscene drew, and arm the capture
	// flag so emitDiff() treats them as this command's `said` and clears them.
	_said.clear();
	for (uint i = 0; i < cd.saidText.size(); i++) {
		SaidLine s;
		s.color = cd.saidColor[i];
		s.text = cd.saidText[i];
		s.voiced = (i < cd.saidVoiced.size()) ? cd.saidVoiced[i] : false;
		_said.push_back(s);
	}
	_capturingSaid = true;

	Common::String cmd = cd.cmd;
	uint32 errCountBefore = cd.errCountBefore;

	// Consume the carrier before emitting so a re-entrant path cannot double-emit.
	cd.pending = false;
	cd.cmd.clear();
	cd.objNums.clear();
	cd.objVisible.clear();
	cd.objDoor.clear();
	cd.inventory.clear();
	cd.saidColor.clear();
	cd.saidText.clear();
	cd.saidVoiced.clear();

	// emitDiff() takes the after-snapshot from the live engine (now the new
	// chapter's room) and builds the one coherent crossing diff. Task 30: the
	// hero definitely moved across the crossing (room 62 -> room 14), so the
	// before hero point (chapter 1) and after hero point (chapter 2) differ and
	// emitDiff() includes the `hero` field carrying the NEW room's hero point.
	// That is exactly the point sonar wants for the room the player is now in,
	// so the crossing diff carries it like any other movement command.
	emitDiff(cmd, before, errCountBefore);

	// Task 23 (R7.3/R7.4, gotcha 5): belt-and-braces over-skip guard on the
	// RECEIVING side. The outgoing chapter-1 layer already dropped the surplus,
	// but this new layer was constructed before chapter 2's setup ran, so its
	// onUpdateEvents() could have pulled further `skip`s the player wrote while
	// the setup animations played. Drop any such surplus now that chapter 2's
	// first room is live, so the very first command the player issues in the new
	// room is not a stray leftover skip and no unconsumed kActionSkip lingers.
	dropSurplusSkips();

	// Sync the last-room markers to the settled state so poll() does not then
	// re-emit a plain room-state line for the same room.
	_lastChapter = _engine->currentChapter;
	_lastRoom = _engine->_roomNumber;
	return true;
}

// --- Cutscene / speech skipping (task 16, R7.3 / R7.4 / gotcha 5) -----------
//
// A cutscene or a speech line runs the engine's OWN loop and does not return to
// the main loop until it finishes or is skipped, so A11yLayer::poll() — and the
// command reader it drives — never runs for the whole duration (gotcha 5). Two
// kinds of blocking loop matter here:
//
//   * Speech (talk.cpp). Every talker runs `do { ...draw frame... pause(3); }
//     while (!isTalkFinished())`. isTalkFinished() calls getScan() and
//     getAction(); if a key was pressed OR an action fired (anything other than
//     kActionNone) it calls stopSound(), which ends the current line. So a
//     single skip input ends exactly the line on screen (R7.4, "one line at a
//     time").
//   * Cutscenes (animation.cpp, e.g. animation_2_1 the chapter 1->2 crossing).
//     These run a long sequence of steps with `if (getAction() == kActionSkip)
//     break;` between them, so a kActionSkip aborts the whole cutscene and
//     returns control to the caller. animation_3_1 (the tavern first-visit
//     talk) is just playTalkSequence(3), i.e. a run of talk lines, so it is
//     skipped the speech way — one line per skip.
//
// Both getScan() and getAction() call updateEvents() first (the engine's
// per-frame event pump, which also runs directly inside the animation loops),
// so updateEvents() is the single point that executes every frame inside BOTH
// kinds of loop. Hooking it is therefore the only way to deliver a `skip` from
// the command file while poll() is blocked. The hook calls onUpdateEvents().
//
// Rather than invent a bespoke "skip pending" flag, we raise the engine's OWN
// skip input: kActionSkip pushed through the engine's addActionToBuffer(),
// exactly as the keymapper does for the player's skip key. This makes the
// engine's existing skip path fire with no new engine logic — the loops already
// watch for kActionSkip (cutscenes) and for any key/action (speech).

// Raise one skip: push kActionSkip into the engine's action buffer the same way
// a real skip-key press does (R7.4). getAction() inside the running talk or
// animation loop then returns it, ending one speech line or aborting the
// cutscene. One call == one skip event, so repeated `skip`s step through a
// multi-line cutscene one line at a time.
void A11yLayer::raiseSkip() {
	Common::CustomEventType action = kActionSkip;
	_engine->addActionToBuffer(action);
}

// --- Saving to a slot (task 19, R9.1) ---------------------------------------
//
// `save <slot>` writes the game to a numbered save slot and emits one
// `A11Y_SAVED ` line so an external reader knows the save landed. We call the
// engine's OWN saveGame(slot, desc) — the exact function the F10 save screen
// runs (saveLoadScreen / scummVMSaveLoadDialog -> saveGame) — so the slot holds
// a standard Drascula save that the engine's `--save-slot=<n>` launch path
// (R9.2) can load back. The save captures the live chapter, room data, hero
// position, inventory and all flags (saveload.cpp saveGame), so a run saved
// here resumes at exactly this point.
//
// Slot numbering follows the engine: on-disk slots are 1-based
// (getSaveStateName formats "%s.%03d" from the slot, and the save screen writes
// `selectedSlot + 1`), and `--save-slot=<n>` at launch loads that same number.
// So `save 1` and `--save-slot=1` name the same file; we keep the player's
// number verbatim and only require it to be a positive integer.
//
// The `desc` is a short human label stored in the save's metadata (shown in the
// ScummVM load list). The game is normally always saveable while a room is live
// (_canSaveLoad), but we do not gate on it: saveGame() itself does not check
// _canSaveLoad, and a replay/survey run drives saves between settled commands
// where saving is valid. If the write fails, saveGame() warns through the
// engine's own log; we still report A11Y_SAVED only on the path that ran, and a
// malformed slot is an A11Y_ERR that keeps the layer running (R2.5).
void A11yLayer::dispatchSave(const Common::String &arg) {
	if (arg.empty()) {
		emitLine("A11Y_ERR save needs a slot number, e.g. `save 1`");
		return;
	}

	// The slot must be a plain positive integer. The engine's slots are 1-based
	// (slot 0 is the autosave slot in ScummVM's convention and not a normal
	// manual save target), so require >= 1 and reject anything non-numeric
	// rather than silently saving to a surprising slot.
	int slot;
	if (!parseInt(arg, slot)) {
		emitLine(Common::String("A11Y_ERR save slot must be a number, got: ") + arg);
		return;
	}
	if (slot < 1) {
		emitLine(Common::String::format(
			"A11Y_ERR save slot must be 1 or greater, got: %d", slot));
		return;
	}

	// Save through the engine's own saveGame(), the same call its F10 save
	// screen makes, so the slot holds a standard Drascula save the launcher's
	// --save-slot can load (R9.1, R9.2). A short description records where the
	// save was taken (chapter + room) for the ScummVM load list.
	Common::String desc = Common::String::format(
		"ghostlight ch%d room%d", _engine->currentChapter, _engine->_roomNumber);
	_engine->saveGame(slot, desc);

	// Report the save. The line carries the slot and the chapter/room so an
	// external reader can confirm the run saved at the expected position (the
	// task-19 verification: save mid-run, relaunch --save-slot, check the room).
	emitLine(Common::String::format(
		"A11Y_SAVED {\"slot\":%d,\"chapter\":%d,\"room\":%d}",
		slot, _engine->currentChapter, _engine->_roomNumber));
}

// Remove the first queued `skip` from the command queue (keeping the rest in
// order) and report whether one was found. Lets onUpdateEvents() honour a `skip`
// that arrived while a cutscene blocks poll(), without disturbing any other
// commands the page queued at the same time (they wait in the queue for poll()
// to run once control returns to the main loop). A command is a `skip` when its
// first whitespace-delimited word is exactly "skip" (any trailing text is
// ignored, matching the lenient parsing the main reader uses).
bool A11yLayer::takeQueuedSkip() {
	for (uint i = _queueHead; i < _commandQueue.size(); i++) {
		const Common::String &cmd = _commandQueue[i];

		// First word of the command.
		uint sp = 0;
		while (sp < cmd.size() && cmd[sp] != ' ')
			sp++;
		Common::String verb = (sp < cmd.size()) ? Common::String(cmd.c_str(), sp) : cmd;

		if (verb == "skip") {
			// Echo it as received (R2.4), exactly as the main reader would.
			emitLine(Common::String("A11Y_CMD ") + cmd);
			// Remove just this entry, preserving the order of the rest.
			_commandQueue.remove_at(i);
			return true;
		}
	}
	return false;
}

// Drop every surplus `skip` once a cutscene/speech loop has ended, so an
// over-skip (more skips than there were lines/cutscenes to end) cannot bleed
// past the cutscene into the next room or line (task 23, R7.3/R7.4, gotcha 5).
// Two kinds of leftover can survive a blocking loop; both are cleared here, and
// nothing else is touched.
void A11yLayer::dropSurplusSkips() {
	// 1) Skip ACTIONS still queued in the engine's own action buffer. During a
	//    cutscene onUpdateEvents() raises one kActionSkip per queued `skip`; the
	//    cutscene drains them between steps via getAction(). If more were raised
	//    than the cutscene had steps left to consume, the surplus kActionSkip
	//    entries sit in _actionBuffer and the NEXT getAction() — now in the new
	//    room — would return kActionSkip and skip that room's first line. As a
	//    friend of DrasculaEngine we discard exactly those queued actions by
	//    collapsing the ring buffer (tail := head). This drops only unread input
	//    and runs no engine logic — the same net state as the buffer having
	//    drained naturally — and we deliberately do NOT call the engine's
	//    flushActionBuffer(), which would re-enter updateEvents() (and so this
	//    hook) mid-transition.
	_engine->_actionBufferTail = _engine->_actionBufferHead;

	// 2) Skip COMMANDS still unread in our own queue (the player queued more
	//    `skip`s than the cutscene needed). Left in place, poll() would run each
	//    as a main-loop `skip` in the new room, raising a fresh kActionSkip
	//    there. Remove every `skip` from _queueHead onward, keeping the order of
	//    any non-`skip` command so legitimate follow-ups still run (R2.2).
	uint w = _queueHead;
	for (uint r = _queueHead; r < _commandQueue.size(); r++) {
		const Common::String &cmd = _commandQueue[r];
		uint sp = 0;
		while (sp < cmd.size() && cmd[sp] != ' ')
			sp++;
		Common::String verb = (sp < cmd.size()) ? Common::String(cmd.c_str(), sp) : cmd;
		if (verb == "skip")
			continue;                 // surplus skip: drop it
		if (w != r)
			_commandQueue[w] = _commandQueue[r];
		w++;
	}
	while (_commandQueue.size() > w)
		_commandQueue.remove_at(_commandQueue.size() - 1);
}

// --- Busy watchdog (Fix C: A11Y_PHASE busy can never be permanent) ----------
//
// Called from onUpdateEvents() every frame (the one hook that keeps running
// while a blocking loop has taken over the main loop). A command can wedge the
// engine so poll() never runs again and A11Y_PHASE stays `busy` forever with
// queued commands never settling (the observed dead state: a conversation reply
// consumed a stale skip, animation_16_2 never returned control). This detects
// that and escalates in two 20 s stages so the condition is reported and
// cleared rather than being silent and permanent.
//
// LIVENESS is max(_lastPollMs, g_lastEngineOutputMs): the newer of the last
// poll() stamp (main loop live) and the last emitted-line stamp (a cutscene
// still drawing text). A nested cutscene like the Von Braun history
// (animation_16_2) never returns control to the main loop — so poll() freezes —
// yet it draws a fresh picture about every 6 s, each stamping
// g_lastEngineOutputMs through its A11Y_TEXT/`said` output. Measuring the stall
// from the liveness stamp means that legitimate slow progress keeps the
// watchdog quiet; only a window with NEITHER a poll() NOR any emitted line is a
// true dead state. The watchdog only acts when there is also something queued
// to settle — an idle engine with a stale stamp (nothing to do) is not a dead
// state.
// The pure decision behind the watchdog, factored out so it can be unit-tested
// without a running engine (tests/engine/watchdog-decision.test.ts). It encodes exactly
// the rules the stateful runBusyWatchdog() below applies; that function only
// reads engine state, calls this, and carries out the returned action.
//
// Tester case (reply-menu drop): a VoiceOver tester opened the drunk's reply
// menu, browsed for ~40 s, then pressed Enter on option 3. While a reply menu
// is open the engine sits in converse.cpp's own loop — poll() does not run and
// nothing is emitted — so liveness goes stale while the player is legitimately
// thinking. Their queued `choose 3` would then trip the watchdog: stage 1
// raised a skip and stage 2 cleared the queue, dropping the pick and leaving
// them stuck on "The game didn't respond." The fix: while a conversation is
// open (converseActive) the watchdog must NEVER escalate. onConverseFrame()
// already consumes or rejects every queued command, so nothing can wedge there;
// the conversation is modal and the player simply thinking is not a dead state.
// We return kWatchdogNoop (and the caller resets the escalation) so a reply menu
// can stay open indefinitely without the pick ever being dropped.
A11yLayer::WatchdogAction A11yLayer::watchdogDecision(
    bool converseActive, bool queued, uint32 liveness, uint32 lastPollMs,
    uint32 now, int stage, uint32 baseMs) {
	// A conversation is open: the converse loop owns every queued command, and a
	// player browsing a reply menu looks exactly like a stale-liveness stall.
	// Never escalate here; reset so a real stall after the conversation ends
	// starts a fresh two-stage escalation.
	if (converseActive)
		return kWatchdogNoop;

	// Nothing queued to settle: not a dead state.
	if (!queued)
		return kWatchdogNoop;

	// Nothing has run or been emitted yet (boot) — no stall to measure against.
	if (liveness == 0)
		return kWatchdogHold;

	// Reset the escalation when the engine shows it is alive again. The test is
	// stage-aware so the watchdog's OWN stage-1 emit cannot reset its own clock:
	//
	//   * Stage 0 (no escalation yet): any liveness within the window means no
	//     silent stall — a poll() this frame, or a cutscene line (the Von Braun
	//     history draws one about every 6 s). Clear.
	//   * Stage >= 1 (already skipped): the stage-1 emit itself stamps the
	//     liveness source, so a plain liveness test would read "fresh" the very
	//     next frame and reset forever, never reaching stage 2. The only thing
	//     that genuinely means "unwedged" here is poll() resuming — the main loop
	//     running again — so we reset only when lastPollMs has advanced PAST the
	//     stall anchor (poll ran since the stall began). A frozen poll stamp
	//     stays equal to the anchor and leaves the escalation running toward
	//     stage 2.
	if (stage == 0) {
		if (now - liveness < kWatchdogMs)
			return kWatchdogNoop;
	} else {
		if (lastPollMs > baseMs)
			return kWatchdogNoop;
	}

	// Liveness is stale AND commands are queued.
	if (stage == 0)
		return kWatchdogStage1;

	// Already skipped (stage 1). Wait for a second full window measured from the
	// same anchor before giving up on the queue.
	if (stage == 1 && now - baseMs >= 2 * kWatchdogMs)
		return kWatchdogStage2;

	// Stall is building but no stage fires this frame; keep the current stage.
	return kWatchdogHold;
}

void A11yLayer::runBusyWatchdog() {
	// The game has ended: the credits are a minutes-long, legitimate cutscene
	// and nothing after them will settle. Never escalate (no busy-skip).
	if (_gameEnded)
		return;
	// Liveness: the newer of the last poll() and the last emitted line. Either
	// counts as the engine being alive this window.
	uint32 liveness = _lastPollMs > g_lastEngineOutputMs
	                  ? _lastPollMs : g_lastEngineOutputMs;
	uint32 now = g_system->getMillis();
	bool queued = _queueHead < _commandQueue.size();

	// Ask the pure decision what to do. Passing _converseActive is the reply-menu
	// fix: while a conversation is open the decision is always kWatchdogNoop, so
	// a player thinking over a reply menu for 20-40 s never trips the watchdog
	// and their queued `choose <n>` is never dropped.
	WatchdogAction action = watchdogDecision(_converseActive, queued, liveness,
	                                         _lastPollMs, now, _watchdogStage,
	                                         _watchdogBaseMs);

	switch (action) {
	case kWatchdogNoop:
		// Not a dead state (idle, fresh, or a conversation open). Reset so a
		// later stall starts a fresh two-stage escalation.
		_watchdogStage = 0;
		_watchdogBaseMs = 0;
		return;

	case kWatchdogHold:
		// Stall building but no stage fires yet; leave stage/anchor untouched.
		return;

	case kWatchdogStage1:
		// Anchor the stall on the liveness stamp so the two windows are measured
		// from a stable origin rather than creeping with each frame.
		_watchdogBaseMs = liveness;
		// Stage 1 is SILENT to the player: emit only the log-only diagnostic
		// `A11Y_ERR busy-skip` (the page maps it to NO announcement) and raise
		// one skip to try to free the blocking loop (the same input a stuck
		// cutscene/line responds to). raiseSkip() only pushes one kActionSkip;
		// if the loop is genuinely dead it does nothing and stage 2 follows.
		//
		// NB: this emitLine() itself stamps g_lastEngineOutputMs, so the second
		// window is measured from _watchdogBaseMs (captured above, before this
		// emit) rather than from the fresh stamp.
		emitLine("A11Y_ERR busy-skip");
		raiseSkip();
		_watchdogStage = 1;
		return;

	case kWatchdogStage2:
		// Stage 2: the skip did not free it. Drop any surplus skip input, clear
		// the queue so it cannot wedge or bleed into the next room, and tell the
		// reader the commands were dropped. The player maps this to "The game
		// didn't respond. Press L to hear where you are."
		dropSurplusSkips();
		_commandQueue.clear();
		_queueHead = 0;
		emitLine("A11Y_ERR busy: commands dropped");
		_watchdogStage = 2;
		return;
	}
}

// --- Walk overshoot guard (ch4 room 22 hang, 10 Nov) ------------------------
//
// The engine's walk ends only through the stop tests at the top of
// moveCharacters() (actors.cpp). Each is an exact-hit window one step wide:
// for a sideways walk, "is the hero's centre within STEP_X - 1 px of the
// target"; for an up/down walk, "are the feet within STEP_Y - 1 px". There is
// no "already past it" test. A sideways step is normally exactly STEP_X (8) px,
// so it cannot jump the 8 px window, but increaseFrameNum() also re-scales the
// sprite for perspective each frame (curX += curWidth - newWidth), and when
// the width grows by one pixel on the same frame as the last step, the centre
// moves 9 px and lands one pixel beyond the window. From then on the test can
// never pass, so walkToPoint()'s loop never sees !_characterMoved and the hero
// walks on forever.
//
// Concrete case: chapter 4 room 22, hero at (207,160) after `look 180`, then
// `use 22 52` walks to the magpie point (190,177). dx == dy == 17, so
// startWalking() picks a sideways walk (track 0) with stepY 8; the centre goes
// 207, 199, 191, and on the third step the feet cross scale row 176 (width 38
// to 39), so the centre lands on 182, one short of the window [183,190].
//
// This guard only acts once the walk is past its window, i.e. once it could no
// longer stop by itself. A walk the engine ends normally never reaches that
// state, so it is unchanged. It is armed only around this layer's own
// walkToPoint() calls; player clicks and scripted walks are left alone.

bool A11yLayer::walkOvershot(int chapter, int track, int heroLeft, int heroWidth,
                             int feetY, int targetX, int targetY) {
	if (track == 0 || track == 1) {
		// Chapter 2 tests the left edge (track 0) or right edge (track 1);
		// the other chapters test the centre (moveCharacters()).
		int x;
		if (chapter == 2)
			x = (track == 0) ? heroLeft : heroLeft + heroWidth;
		else
			x = heroLeft + heroWidth / 2;
		if (track == 0)
			return x < targetX - (STEP_X - 1);
		return x > targetX + (STEP_X - 1);
	}
	if (track == 2)
		return feetY < targetY - (STEP_Y - 1);
	if (track == 3)
		return feetY > targetY + (STEP_Y - 1);
	return false;
}

void A11yLayer::guardedWalkToPoint(const Common::Point &target) {
	_walkGuardArmed = true;
	_engine->walkToPoint(target);
	_walkGuardArmed = false;
}

void A11yLayer::checkWalkOvershoot() {
	if (!_walkGuardArmed)
		return;
	DrasculaEngine *e = _engine;
	if (!e->_characterMoved)
		return;
	// Chapter 5 room 45 pins the hero to (0,0) every frame (the engine's own
	// bug #5903 workaround in increaseFrameNum()), so position says nothing
	// about the walk there. Leave it to the engine.
	if (e->currentChapter == 5 && e->_roomNumber == 45)
		return;

	// walkToPoint() stores its target in roomX/roomY before startWalking().
	if (!walkOvershot(e->currentChapter, e->trackProtagonist, e->curX, e->curWidth,
	                  e->curY + e->curHeight, e->roomX, e->roomY))
		return;

	// End the walk the way the engine's own track-1 arrival does in
	// moveCharacters(): stop, reset the step sizes and place the hero on the
	// target point. The overshoot is a pixel or two past the window, so the
	// hero ends where a normal arrival would. walkToPoint() then sees
	// !_characterMoved and returns, applying trackFinal as usual.
	e->_characterMoved = false;
	e->stepX = STEP_X;
	e->stepY = STEP_Y;
	if (e->currentChapter == 2)
		e->curX = e->roomX - e->curWidth + 4;
	else
		e->curX = e->roomX - e->curWidth / 2;
	e->curY = e->roomY - e->curHeight;
	_walkGuardArmed = false;
	debug(1, "Ghostlight: walk overshoot guard ended a walk at (%d,%d)",
	      e->roomX, e->roomY);
}

// Hook body: run from the end of DrasculaEngine::updateEvents() every frame.
// Because a cutscene/speech loop can call updateEvents() every ~10 ms, reading
// the command file on each call would churn the filesystem; so we throttle to
// about one read every 250 ms (gotcha 5), which is well within human skip
// cadence. When a `skip` is queued we take it and raise the engine's skip
// input; non-`skip` commands are left for poll() to run once control returns to
// the main loop (so a `walk`-into-a-cutscene followed by other commands still
// runs those commands in order afterwards). Guarded so it does nothing before
// g_system exists.
void A11yLayer::onUpdateEvents() {
	if (!g_system)
		return;

	// Fix C: run the busy watchdog first, before the skip-read throttle below.
	// It is timed off the engine liveness stamp — max(_lastPollMs,
	// g_lastEngineOutputMs) — not the 250 ms skip-read cadence, so it must not
	// be gated by that throttle — a wedged engine still calls updateEvents()
	// every frame, which is exactly when the watchdog needs to fire. It is a
	// no-op whenever the engine is still showing life (poll() fresh or a line
	// emitted within the window) or nothing is queued.
	runBusyWatchdog();

	// End an a11y walk that has walked past its stop window and so can never
	// stop by itself (see checkWalkOvershoot). Every frame, not throttled:
	// walkToPoint() calls updateEvents() each frame, so this runs right after
	// the step that overshot, before the hero goes any further.
	checkWalkOvershoot();

	// Throttle: at most one command-file read per ~250 ms from this hook. poll()
	// still reads every frame when the main loop is running; this cap only
	// applies to the high-frequency in-cutscene path. _lastSkipPollMs == 0 means
	// we have not read from here yet, so the first in-cutscene frame reads at
	// once (no startup lag on the very first skip).
	uint32 now = g_system->getMillis();
	if (_lastSkipPollMs != 0 && now - _lastSkipPollMs < 250)
		return;
	_lastSkipPollMs = now;

	// Pull any newly-written lines into the queue, then honour every queued
	// `skip` this tick. Honouring all of them (not just one) means a burst of
	// `skip`s written together steps the cutscene forward that many lines on the
	// next poll windows; each raiseSkip() is a separate action event the loop's
	// getAction() consumes one at a time.
	//
	// A `skip` drained here settles one of two ways. When a command is in flight
	// (_inRunCommand), this hook is running nested inside that command's own
	// cutscene/speech loop, so the skip is advancing THAT command — its diff
	// covers the result and we emit nothing here. When no command is in flight,
	// the main loop is idle and there is nothing to skip: the skip is a harmless
	// no-op, so we emit its settling diff `A11Y_DIFF {"cmd":"skip",
	// "changed":false}` ourselves. Without it an external reader (the MCP native
	// transport) waits its full timeout for a settle that never arrives. The
	// takeQueuedSkip() echo already printed the `A11Y_CMD skip`, so this adds
	// only the missing diff, giving the one-echo-plus-one-settle shape every
	// other command has.
	readCommandFile();
	while (takeQueuedSkip()) {
		raiseSkip();
		if (!_inRunCommand)
			emitLine("A11Y_DIFF {\"cmd\":\"skip\",\"changed\":false}");
	}

	// Reclaim a fully-drained queue so a long cutscene does not leave a growing
	// spent prefix. Only when nothing is pending — a non-`skip` command left in
	// the queue must survive for poll() to run after the cutscene ends.
	if (_queueHead >= _commandQueue.size()) {
		_commandQueue.clear();
		_queueHead = 0;
	}
}

} // namespace Drascula
