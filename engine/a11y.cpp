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
 * The hooks that call this layer are in hooks.patch.
 */

#include "common/config-manager.h"
#include "common/fs.h"
#include "common/path.h"
#include "common/stream.h"
#include "common/str.h"
#include "common/system.h"
#include "common/textconsole.h"
#include "common/tokenizer.h"
#include "common/util.h"

#include "drascula/drascula.h"
#include "drascula/a11y.h"

namespace Drascula {

// True when the chapter 5 plug (item 16) is on the cursor. The original keeps
// it there (ScummVM bug #3885) for the player to click on the socket, so it
// must not be stowed, and counts as carried.
static bool isHeldPlug(const DrasculaEngine *e) {
	return e->currentChapter == 5 && e->takeObject == 1 && e->pickedObject == 16;
}

// Count of A11Y_ERR lines emitted. A command that errs gets no A11Y_DIFF, so
// the diff builder compares this before and after dispatch.
static uint32 g_errCount = 0;

// Time of the last line emitLine() wrote. The busy watchdog treats any output
// as a sign of life, so a long cutscene that keeps drawing text never trips it.
static uint32 g_lastEngineOutputMs = 0;


// All a11y output is one prefixed line on stderr: Module.printErr on the web,
// fd 2 natively. logMessage() with kError goes to stderr on SDL and adds no
// prefix of its own.
static void emitLine(const Common::String &line) {
	// Track error lines so the diff layer can tell a command failed and skip
	// the diff (exactly one A11Y_DIFF XOR at least one A11Y_ERR per command).
	if (line.hasPrefix("A11Y_ERR"))
		g_errCount++;

	if (!g_system)
		return;

	// Stamp liveness for the busy watchdog.
	g_lastEngineOutputMs = g_system->getMillis();

	Common::String out = line + "\n";
	g_system->logMessage(LogMessageType::kError, out.c_str());
}

// JSON string escape. Game strings are ASCII in practice, but a control
// character or quote would break line parsing.
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

// Split a command line into its first word (the verb) and the trimmed rest
// (the argument, empty for a bare verb).
static void splitVerb(const Common::String &cmd, Common::String &verb, Common::String &arg) {
	uint sp = 0;
	while (sp < cmd.size() && cmd[sp] != ' ')
		sp++;
	verb = (sp < cmd.size()) ? Common::String(cmd.c_str(), sp) : cmd;
	arg = (sp < cmd.size()) ? Common::String(cmd.c_str() + sp + 1) : Common::String();
	arg.trim();
}

// Split an argument into words, collapsing runs of spaces and tabs.
static Common::Array<Common::String> splitWords(const Common::String &arg) {
	return Common::StringTokenizer(arg, " \t").split();
}

A11yLayer::A11yLayer(DrasculaEngine *engine)
	: _engine(engine), _lastChapter(-1), _lastRoom(-1), _capturingSaid(false),
	  _converseActive(false), _converseNeedChoices(false), _choicePressed(false),
	  _choiceDiffPending(false), _choiceErrCount(0),
	  _mainCmdDiffPending(false), _mainCmdOpenedConverse(false), _mainCmdErrCount(0),
	  _queueHead(0), _inRunCommand(false), _lastSkipPollMs(0), _voicePlaying(false),
	  _readPause(false), _inHold(false), _voiceLen(0), _cmdLinesRead(0),
	  _lastPhase(kPhaseNone),
	  _lastPollMs(0), _watchdogStage(0), _watchdogBaseMs(0),
	  _walkGuardArmed(false) {
	for (int i = 0; i < 4; i++)
		_choiceBottom[i] = 0;
	// Register so the centerText() hook in graphics.cpp can reach this layer.
	_engine->_a11y = this;
}

// Unregister, so centerText() between chapters does nothing.
A11yLayer::~A11yLayer() {
	if (_engine->_a11y == this)
		_engine->_a11y = nullptr;
}

// Emit a drawn text line once. centerText() calls this every frame the line
// is on screen, so repeats of the last line are dropped.
void A11yLayer::onText(const char *message) {
	if (!message || !*message)
		return;

	// Same line as last time (the engine is still redrawing the current
	// subtitle this frame) — already reported, so stay quiet.
	if (_lastText == message)
		return;

	_lastText = message;

	// A line drawn while talkInit()'s voice sample plays is spoken by the game,
	// so mark it A11Y_VTEXT and let the player skip reading it aloud.
	const bool voiced = _engine->soundIsActive();
	emitLine(Common::String(voiced ? "A11Y_VTEXT " : "A11Y_TEXT ") + message);
	// A voiced clip is now playing: remember it so checkVoiceEnd() can emit one
	// A11Y_VEND when the sample stops (voice timing).
	if (voiced) {
		_voicePlaying = true;
		// Characters (not bytes) of this line, for the reading pause estimate.
		_voiceLen = 0;
		for (const char *p = message; *p; p++) {
			if ((*p & 0xC0) != 0x80)
				_voiceLen++;
		}
	}

	// Attribute the line, with its colour, to the running command's `said`.
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
// are on and emits the first room's A11Y state line.
void A11yLayer::onStartup() {
	// The game only draws text with subtitles on, so A11Y_TEXT needs them.
	if (!ConfMan.getBool("subtitles")) {
		emitLine("A11Y_ERR subtitles are off; no on-screen text will be captured. "
		         "Relaunch with --subtitles.");
	}

	// A chapter crossing emits its single diff here, once the new room exists,
	// instead of a room-state line.
	if (emitPendingCrossChapterDiff())
		return;

	// Normal chapter start (no pending crossing): emit the first playable room
	// exactly as a room entry would, so the very first line an external reader
	// sees is a complete A11Y room state.
	emitRoomState();
}

// JSON for the object in `slot`, shared by the room state and the diff:
// {"num":52,"name":"BARTENDER","rect":[x,y,w,h],"walkTo":[x,y],
//  "visible":true,"door":false[,"toRoom":63]}
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

// Palette indices 1-11 are the named Colors; anything else is "color<N>".
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
// dispatch window so the diff carries only this command's text.
void A11yLayer::beginSaidCapture() {
	_said.clear();
	_capturingSaid = true;
}

// Snapshot of what the diff reports: chapter, room, visible objects,
// inventory (id >= 7) and all flags.
void A11yLayer::takeSnapshot(Snapshot &snap) const {
	DrasculaEngine *e = _engine;

	snap.chapter = e->currentChapter;
	snap.room = e->_roomNumber;

	// Hero point — the SAME point buildRoomState() reports, via the
	// shared helpers, so the room state and the diff's optional `hero` field can
	// never drift.
	snap.heroX = heroX();
	snap.heroY = heroY();

	snap.objNums.clear();
	snap.objVisible.clear();
	snap.objDoor.clear();
	for (int l = 0; l < e->numRoomObjs; l++) {
		// updateDoor() keeps isDoor current for flag-gated doors (chapters 2 and 4).
		// Call it before reading isDoor.
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

// Hero point: centre and foot of the hero sprite, in object coordinates.
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

	// Room objects 0..numRoomObjs-1; the parallel object arrays share this index.
	for (int l = 0; l < e->numRoomObjs; l++) {
		// Refresh flag-gated doors before objectJson() reads isDoor.
		e->updateDoor(l);
		if (l > 0)
			json += ",";
		json += objectJson(l);
	}

	// Inventory: slots 1..6 are the verb icons, not real items, so
	// only ids >= 7 are reported. inventoryObjects[0] is unused; a 0
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
	// noise — cleaning up belongs to a later layer, not here.
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

// The items in `from` that are not in `other`, as comma-separated JSON objects
// {"id":N,"name":"..."} in `from`'s order. Empty when there are none.
Common::String A11yLayer::inventoryDelta(const Common::Array<int> &from,
                                         const Common::Array<int> &other) const {
	Common::String out;
	for (uint i = 0; i < from.size(); i++) {
		int id = from[i];
		bool inOther = false;
		for (uint k = 0; k < other.size(); k++) {
			if (other[k] == id) { inOther = true; break; }
		}
		if (inOther)
			continue;
		if (!out.empty())
			out += ",";
		out += Common::String::format("{\"id\":%d", id);
		Common::String nm = itemName(id);
		if (!nm.empty())
			out += Common::String::format(",\"name\":\"%s\"", jsonEscape(nm.c_str()).c_str());
		out += "}";
	}
	return out;
}

// The captured `said` lines as a JSON array. `voiced` is added only when true,
// so unvoiced entries keep their original shape.
Common::String A11yLayer::saidJson() const {
	Common::String json = "[";
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
	return json + "]";
}

// Emits one A11Y_DIFF comparing `before` with the settled state:
// {"cmd","chapter":[from,to],"room":[from,to],"objects","appeared",
//  "disappeared","doors","hero","invAdded","invRemoved","flags",
//  "said","changed"}
// A room change reports the new room's objects instead of appeared,
// disappeared and doors. Flag 12 changes constantly as animation state, so
// it is reported but does not set `changed`; neither does speech.
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

	// --- chapter / room change ---------------------------------------
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
		// object is new to this room. Objects are the live slots now.
		json += ",\"objects\":[";
		for (int l = 0; l < e->numRoomObjs; l++) {
			if (l > 0)
				json += ",";
			json += objectJson(l);
		}
		json += "]";
	} else {
		// Same-room visibility and door changes, keyed on object number.
		Common::String appeared, disappeared, doors;

		for (int l = 0; l < e->numRoomObjs; l++) {
			int num = e->objectNum[l];

			// Refresh flag-gated doors, as takeSnapshot() did.
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
			// reported under doors. Visible-state is handled above, so
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

	// The hero's new point, only when it moved, for sonar panning.
	if (after.heroX != before.heroX || after.heroY != before.heroY) {
		json += Common::String::format(",\"hero\":{\"x\":%d,\"y\":%d}",
		                               after.heroX, after.heroY);
	}

	// Inventory gained and lost, in id order.
	{
		Common::String added = inventoryDelta(after.inventory, before.inventory);
		Common::String removed = inventoryDelta(before.inventory, after.inventory);
		if (!added.empty() || !removed.empty())
			changed = true;

		if (!added.empty())
			json += ",\"invAdded\":[" + added + "]";
		if (!removed.empty())
			json += ",\"invRemoved\":[" + removed + "]";
	}

	// Changed flags. Flag 12 alone does not set `changed`.
	{
		Common::String flagsJson;
		for (int f = 0; f < NUM_FLAGS; f++) {
			if (after.flags[f] != before.flags[f]) {
				if (!flagsJson.empty())
					flagsJson += ",";
				flagsJson += Common::String::format("\"%d\":[%d,%d]",
				                                    f, before.flags[f], after.flags[f]);
				// Flag 12 is noise: report it, but it alone is not a
				// "change" for the `changed` flag. Any other flag is a real move.
				if (f != 12)
					changed = true;
			}
		}
		if (!flagsJson.empty())
			json += ",\"flags\":{" + flagsJson + "}";
	}

	// Lines spoken during the command. Speech alone does not set `changed`.
	if (!_said.empty())
		json += ",\"said\":" + saidJson();

	// --- changed -----------------------------------------------------
	json += Common::String::format(",\"changed\":%s}", changed ? "true" : "false");

	emitLine(json);

	// Close the capture window and clear the buffer so the next command starts
	// clean.
	_capturingSaid = false;
	_said.clear();
}

// Emits the deferred diff of a `talk` that opened a conversation, on the
// first converse frame instead of when the conversation ends.
void A11yLayer::emitPendingMainCmdDiff() {
	if (!_mainCmdDiffPending)
		return;
	emitDiff(_mainCmd, _mainCmdSnapshot, _mainCmdErrCount);
	_mainCmdDiffPending = false;
}

// <savepath>/a11y-cmd.txt. Under Emscripten the page writes it to MEMFS.
static Common::FSNode commandFileNode() {
	Common::Path savePath = ConfMan.getPath("savepath");
	return Common::FSNode(savePath.appendComponent("a11y-cmd.txt"));
}

// Queues each line of the command file and truncates it. Blank lines and
// lines starting with # are skipped; a missing file is the idle case.
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
		_cmdLinesRead++;
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

// Echoes `cmd` as A11Y_CMD and dispatches it. Returns true when the command
// ended the chapter (a door, or checkAction() returning true), so poll()
// can return from runCurrentChapter().
bool A11yLayer::runCommand(const Common::String &cmd) {
	emitLine(Common::String("A11Y_CMD ") + cmd);

	// Split off the first word as the verb; the remainder is the argument(s).
	Common::String verb, arg;
	splitVerb(cmd, verb, arg);

	if (verb == "state" || verb == "dump") {
		// Backed by the same room-state code as room entry.
		emitRoomState();
		return false;
	}

	// Verb words map to kVerb* constants; `take` is kVerbPick.
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

	// `walk <num>` walks to an object or through a door; `walk <x> <y>` walks
	// to a point.
	if (verb == "walk") {
		return dispatchWalk(arg);
	}

	// Use an inventory item on a room object:
	// `use <item> on <obj>` or `use <item> <obj>`.
	if (verb == "use") {
		return dispatchUse(arg);
	}

	// Inventory listing. `inventory` and the short alias `inv`
	// both emit the dedicated A11Y_INV line. It takes no argument; any trailing
	// text is ignored.
	if (verb == "inventory" || verb == "inv") {
		dispatchInventory();
		return false;
	}

	// A `skip` that reaches the main loop has nothing to skip (cutscenes take
	// theirs in onUpdateEvents()), so raising the skip action is a no-op.
	if (verb == "skip") {
		raiseSkip();
		return false;
	}

	// Reading pause toggle: `readpause on` / `readpause off`. Reaching here
	// means no talk loop is blocking poll(); the same line is also taken by
	// onUpdateEvents() and the converse hook while one is.
	if (verb == "readpause") {
		applyReadPause(arg);
		return false;
	}

	// `save <slot>`. Loading is the --save-slot launch option.
	if (verb == "save") {
		dispatchSave(arg);
		return false;
	}

	// Conversations consume `choices` and `choose` in the converse hook, so
	// here no conversation is open.
	if (verb == "choices") {
		emitLine("A11Y_ERR no conversation is open");
		return false;
	}
	if (verb == "choose") {
		emitLine("A11Y_ERR no conversation is open");
		return false;
	}

	// No handler yet (lands in a later task). Report and continue.
	emitLine(Common::String("A11Y_ERR no handler for command: ") + cmd);
	return false;
}

// Slot of the room object with engine number `num`, or -1.
int A11yLayer::slotForObjectNum(int num) const {
	DrasculaEngine *e = _engine;
	for (int l = 0; l < e->numRoomObjs; l++) {
		if (e->objectNum[l] == num)
			return l;
	}
	return -1;
}

// Runs a verb on a room-object slot the way verify2()'s per-object branch
// does after a click, but on the chosen slot, so overlapping hotspots and
// the hero cannot steal it. The cursor is moved over the object and
// checkObjects() run first, because checkAction() only gives the generic
// refusal when _hasName is set.
bool A11yLayer::runVerbOnSlot(int verb, int slot) {
	DrasculaEngine *e = _engine;

	// An action with no handler leaves the verb held, and selectVerb() would
	// then add the verb number to the inventory. Reset it first, as a
	// right-click does.
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Select the verb, so pickedObject/takeObject are what the room handlers
	// and checkAction() read (interface.cpp selectVerb). This is the same state
	// a click on the verb bar leaves behind.
	e->selectVerb(verb);

	// Move the cursor to the hotspot centre so the hover name matches.
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

	// Walk to the object and run its action, as verify2() does.
	e->trackFinal = e->trackObj[slot];
	e->_walkToObject = true;
	guardedWalkToPoint(e->_roomObject[slot]);
	// The action ended the chapter; skip the item return.
	if (e->checkAction(e->objectNum[slot]))
		return true;

	// Some handlers reward a verb with pickObject(), leaving the item on the
	// cursor until the player right-clicks. Stow it the same way
	// (selectVerb(kVerbNone)), but only real items (id >= 7): an unhandled
	// verb leaves the verb itself held. The chapter 5 plug stays held.
	if (e->takeObject == 1 && e->pickedObject >= 7 && !isHeldPlug(e))
		e->selectVerb(kVerbNone);
	return false;
}

// `<verb> <num>`. Returns true when the verb ended the chapter.
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

	// Object 50 is the engine's special "hero / self" object: it is not
	// a room object in objectNum[], so it gets its own path. A verb on 50 runs
	// checkAction(50) against the hero (e.g. `look 50` is look-at-self).
	if (num == 50) {
		runVerbOnSelf(verbConst);
		return false;
	}

	// A room object: resolve its slot and run the verb through the engine's own
	// room-object path.
	int slot = slotForObjectNum(num);
	if (slot >= 0)
		return runVerbOnSlot(verbConst, slot);

	// Not a room object. It may be an inventory item the player wants to act on
	// in the inventory screen, e.g. `look 28` to look at the phone. Real
	// items are id >= 7; verb slots 1..6 are not items.
	if (num >= 7 && slotForItem(num) >= 0) {
		runVerbOnItemSlot(verbConst, num);
		return false;
	}

	// Neither a room object, the hero, nor an inventory item the player holds.
	emitLine(Common::String::format(
		"A11Y_ERR object %d is not in this room or inventory", num));
	return false;
}

// Using an item on a room object, as the three clicks do: drop what is
// held, take the item from its slot (removeObject + pickObject), walk to
// the object and checkAction(). If the handler did not consume the item
// it is still on the cursor, and selectVerb(kVerbNone) puts it back, so
// a use that does not apply never loses the item.

// Apply item `itemId` to the room object in `slot`, then return the item to the
// inventory if the action did not consume it.
bool A11yLayer::useItemOnSlot(int itemId, int slot) {
	DrasculaEngine *e = _engine;

	// Drop whatever is held, as a right-click does. A plug already held for
	// this use stays on the cursor (bug #3885).
	bool alreadyHeldPlug = itemId == 16 && isHeldPlug(e);
	if (e->takeObject == 1 && !alreadyHeldPlug)
		e->selectVerb(kVerbNone);

	// Pick the item up as a click in the inventory screen does.
	if (!alreadyHeldPlug) {
		e->removeObject(itemId);
		e->pickObject(itemId);
	}

	// Warp the cursor to the object's hotspot centre so the engine's hover name
	// matches the object the use runs on, the same as a verb command.
	const Common::Rect &r = e->_objectRect[slot];
	int hx = r.left + r.width() / 2;
	int hy = r.top + r.height() / 2;
	e->_mouseX = hx;
	e->_mouseY = hy;
	if (g_system)
		g_system->warpMouse(hx, hy);

	// Walk to the object and run its action with the item held.
	e->trackFinal = e->trackObj[slot];
	e->_walkToObject = true;
	guardedWalkToPoint(e->_roomObject[slot]);
	// checkAction() true == this use ended the chapter. Relay it and skip the
	// item return: the chapter is over and its state is being torn down.
	if (e->checkAction(e->objectNum[slot]))
		return true;

	// Return the item if the handler did not consume it. A held plug stays.
	if (e->takeObject == 1 && !isHeldPlug(e))
		e->selectVerb(kVerbNone);
	return false;
}

// `use <item> [on] <obj>`. Returns true when the use ended the chapter.
bool A11yLayer::dispatchUse(const Common::String &arg) {
	Common::Array<Common::String> words = splitWords(arg);

	// A bare `use` or `use <item>` has no target. There is no standalone-use
	// path in this engine (items are always applied to an object, another item,
	// or the hero), so this is an error here.
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

	// The item must be in the inventory (real items are id >= 7). Check before
	// touching any state.
	if (itemId < 7) {
		emitLine(Common::String::format(
			"A11Y_ERR %d is a verb slot, not an inventory item (items are id 7+)", itemId));
		return false;
	}
	if (slotForItem(itemId) < 0 && !(itemId == 16 && isHeldPlug(_engine))) {
		emitLine(Common::String::format(
			"A11Y_ERR item %d is not in the inventory", itemId));
		return false;
	}

	// The target is object 50, the hero / self: `use <item> on 50`.
	// Object 50 is not a room object, so it has its own path — the room handlers
	// key item-on-self on `pickedObject == <itemId> && fl == 50`.
	if (objNum == 50) {
		useItemOnSelf(itemId);
		return false;
	}

	// The target may be a live room object: `use <item> on <objNum>`.
	// A use that ends the chapter returns true, relayed to runCommand().
	int slot = slotForObjectNum(objNum);
	if (slot >= 0)
		return useItemOnSlot(itemId, slot);

	// The target may be another inventory item: both the
	// held item and the target are in the inventory, combined on the inventory
	// screen. Real items are id >= 7.
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

// `inventory` emits one A11Y_INV line:
// A11Y_INV {"items":[{"id":28,"name":"phone","look":"..."}]}
// The game draws no item names, so names come from the InventoryItems
// enums and look lines from the room 200 action table. Missing ones are
// left out.

// Item names from the InventoryItems (chapters 1-3) and InventoryItems2
// (chapters 4-6) enums in drascula.h. Empty when unknown.
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

// The item's look line from the room 200 table, matched as
// roomParse(200, itemId) would, returned without speaking it.
Common::String A11yLayer::itemLookLine(int itemId) const {
	DrasculaEngine *e = _engine;

	// _text is loaded at chapter start (loadTexts); guard defensively in case a
	// listing is somehow requested before it exists.
	if (!e->_text || !e->_roomActions)
		return "";

	// roomParse() takes the first match; so do we.
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

// Emits A11Y_INV without opening the inventory screen.
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

		// name: only when the table knows this id.
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

// Targets the room-object path cannot reach: the hero (object 50, see
// verify2()'s non-menu branch) and another inventory item (item-on-item
// on the inventory screen, through checkAction()'s _menuScreen branch).
// Both return any item a use did not consume.

// Find the live inventory slot holding real item `itemId`, or -1. Slots are
// indexed 1..ARRAYSIZE(inventoryObjects)-1. Used to confirm a verb/use target
// is really an inventory item the hero holds before acting on it.
int A11yLayer::slotForItem(int itemId) const {
	DrasculaEngine *e = _engine;
	for (int n = 1; n < ARRAYSIZE(e->inventoryObjects); n++) {
		if (e->inventoryObjects[n] == itemId)
			return n;
	}
	return -1;
}

// Opens the inventory screen as the main loop's right-click does: loads the
// chapter's icon surfaces and sets _menuScreen.
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

// Closes the inventory screen as the right-click-close path does: reloads
// the room surfaces and palette and clears _menuScreen.
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
// self branch directly. No room slot, no walk: the action is against the
// hero where they stand.
void A11yLayer::runVerbOnSelf(int verb) {
	DrasculaEngine *e = _engine;

	// Drop a verb held from a previous command (see runVerbOnSlot).
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Select the verb so pickedObject/takeObject are what checkAction() reads.
	e->selectVerb(verb);

	// checkAction() only gives the generic refusal when _hasName is set; the
	// self handlers key on fl == 50 alone.
	e->_hasName = true;

	// No walk: object 50 is the hero.
	e->checkAction(50);
}

// Apply inventory item `itemId` to object 50 (the hero / self), then return the
// item if the use did not consume it. Mirrors useItemOnSlot() but
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

	// Return the item if it was not consumed.
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);
}

// Run a verb on an inventory-screen item (the target is an inventory item, not
// a room object): open the inventory screen, warp to the item's slot, run the
// engine's own menu-screen action, close the screen.
void A11yLayer::runVerbOnItemSlot(int verb, int itemId) {
	DrasculaEngine *e = _engine;

	// Clear any held verb/item first (same stale-verb reasoning as elsewhere).
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Open the inventory screen so checkAction() takes its _menuScreen branch.
	openInventoryScreen();

	// Select the verb while the screen is open — selectVerb sets pickedObject,
	// which the menu look-at-item handlers (checkAction's _menuScreen branch)
	// read. For a look, pickedObject == kVerbLook.
	e->selectVerb(verb);

	// With the menu open, checkAction(itemId) takes its _menuScreen branch
	// (the room 200 look table and the chapter's menu handlers).
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
//.
void A11yLayer::useItemOnItemSlot(int itemA, int itemB) {
	DrasculaEngine *e = _engine;

	// Drop whatever is held first (right-click equivalent).
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Open the inventory screen so checkAction() takes its _menuScreen branch.
	openInventoryScreen();

	// Hold item A, as clicking it on the inventory screen does. B stays in its
	// slot. The handlers read pickedObject == itemA && fl == itemB.
	e->removeObject(itemA);
	e->pickObject(itemA);

	// Run the combination. A pair with no handler gets the generic refusal and
	// consumes nothing.
	e->checkAction(itemB);

	// Return item A if it was not consumed; B was never removed.
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Close the screen and restore the room.
	closeInventoryScreen();
}

// `walk <num>` walks to an object or through a door; `walk <x> <y>` walks
// to a point. Anything else is an A11Y_ERR.

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

// Returns true when a door ended the chapter.
bool A11yLayer::dispatchWalk(const Common::String &arg) {
	Common::Array<Common::String> words = splitWords(arg);

	if (words.empty()) {
		emitLine("A11Y_ERR walk needs a target: `walk <object>` or `walk <x> <y>`");
		return false;
	}

	// One word: object walk. Resolve the slot for the engine hotspot number and
	// walk to / through it; A11Y_ERR if the object is not in this room.
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

	// Two words: free-point walk. Both must be integers.
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

	// Anything else is malformed.
	emitLine("A11Y_ERR walk takes one object number or two coordinates, "
	         "e.g. `walk 52` or `walk 170 158`");
	return false;
}

// Walks to the object in `slot`. A door goes through exitRoom(), as
// verify1() does, so the game plays the door and the room change itself.
// A locked door speaks its own line and returns false.
bool A11yLayer::walkObject(int slot) {
	DrasculaEngine *e = _engine;

	// Refresh flag-gated doors (chapters 2 and 4) before testing isDoor;
	// exitRoom() does the same first.
	e->updateDoor(slot);

	if (e->isDoor[slot]) {
		// exitRoom() returns true for a door that ends the chapter (chapter 1's
		// door 105 runs animation_2_1()). Pass it up as verify1() does, or the
		// chapter never ends.
		return e->exitRoom(slot);
	}

	// Not a door: walk to its walk-to point and face it. Never ends the chapter.
	e->trackFinal = e->trackObj[slot];
	e->_walkToObject = true;
	guardedWalkToPoint(e->_roomObject[slot]);
	return false;
}

// Walks to a point, clamped to _walkRect as verify1() does for a click.
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

// Conversations. converse() runs its own loop, so poll() does not run while
// one is open. onConverseFrame() is called after the options are laid out
// and before the cursor test: it lists the choices on the first frame and
// after each choice, and applies `choose <n>` by putting _mouseY in that
// option's band and pressing the button. The press is released on the
// next frame; holding it would skip the reply.

// Called by converse() just before its while-loop. Marks a conversation open
// and arms the first A11Y_CHOICES emission.
void A11yLayer::onConverseBegin() {
	_converseActive = true;
	_converseNeedChoices = true;
	_choicePressed = false;

	// Drop skips left over from an earlier line, or converse()'s first
	// getAction() would pick or dismiss an option.
	dropSurplusSkips();

	// This conversation was opened by the current `talk`: emit its diff when
	// the choices appear.
	if (_mainCmdDiffPending)
		_mainCmdOpenedConverse = true;
}

// Called by converse() just after its while-loop ends. Clears all conversation
// state so a later conversation starts clean and the main-loop reader treats
// `choices`/`choose` as "no conversation open" again.
void A11yLayer::onConverseEnd() {
	// The ending choice leaves the loop, so emit its deferred diff here.
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

// Emits A11Y_CHOICES from the engine's option strings:
// {"choices":[{"n":1,"text":"...","used":false},...,
//  {"n":4,"text":"...","ends":true}]}
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
		// Option 4 always ends the conversation.
		if (i == 3)
			json += ",\"ends\":true";
		json += "}";
	}
	json += "]}";
	emitLine(json);

	// Only the converse path can raise `choice`; poll() doesn't run here.
	emitPhase(kPhaseChoice);
}

// Applies `choose <n>` as a click on that option line. Out of range, or a
// band not laid out, is an A11Y_ERR.
void A11yLayer::applyChoose(int n) {
	DrasculaEngine *e = _engine;

	if (n < 1 || n > 4) {
		emitLine(Common::String::format(
			"A11Y_ERR choose takes an option 1-4, got %d", n));
		return;
	}

	// converse() selects option k when _mouseY is between the previous bottom
	// and k's bottom; use the midpoint.
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

	// Any on-screen X will do; the engine selects on _mouseY.
	e->_mouseX = 160;
	e->_mouseY = midY;
	if (g_system)
		g_system->warpMouse(160, midY);

	e->_leftMouseButton = 1;
	_choicePressed = true;
}

// Per converse frame: release last frame's press, cache the band bottoms,
// list the choices if needed, then consume every queued command.
// A command left at the head of the queue would block all later ones.
void A11yLayer::onConverseFrame(const char *phrase1, const char *phrase2,
                                const char *phrase3, const char *phrase4,
                                int game1, int game2, int game3,
                                int bottom1, int bottom2, int bottom3, int bottom4) {
	DrasculaEngine *e = _engine;

	// Nothing is emitted while the menu is open, so keep liveness fresh here;
	// otherwise the watchdog would start from a stale stamp after it closes.
	if (g_system)
		_lastPollMs = g_system->getMillis();

	// Release the press from the previous frame; the engine has acted on it.
	if (_choicePressed) {
		e->_leftMouseButton = 0;
		_choicePressed = false;
		// The list reopens after a choice that doesn't end the conversation.
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
	// non-ending choice.
	if (_converseNeedChoices) {
		emitChoices(phrase1, phrase2, phrase3, phrase4, game1, game2, game3);
		_converseNeedChoices = false;
	}

	// On the opening frame, emit the diff of the `talk` that opened it.
	if (_mainCmdOpenedConverse && _mainCmdDiffPending) {
		emitPendingMainCmdDiff();
		_mainCmdOpenedConverse = false;
	}

	// A choice made last frame has settled: emit its diff.
	if (_choiceDiffPending) {
		emitDiff(_choiceCmd, _choiceSnapshot, _choiceErrCount);
		_choiceDiffPending = false;
	}

	// Drop skips the reply did not use before listing the choices again.
	dropSurplusSkips();

	// (4) Service the command file. Append any new lines, then look at the next
	// queued command.
	readCommandFile();

	while (_queueHead < _commandQueue.size()) {
		const Common::String &cmd = _commandQueue[_queueHead];

		Common::String verb, arg;
		splitVerb(cmd, verb, arg);

		if (verb == "choices") {
			// Re-list the current options on demand. Consume the command
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

			// poll() doesn't run during a conversation, so snapshot here and emit the
			// diff once the reply has settled (or in onConverseEnd() for option 4).
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

		// A surplus `skip` has nothing to skip in a menu. Consume it, so it cannot
		// block the queue.
		if (verb == "skip") {
			emitLine(Common::String("A11Y_CMD ") + cmd);
			_queueHead++;
			continue;
		}

		// `readpause` is a setting, not a game action, so it is fine mid-
		// conversation. Apply it, settle it with the same no-op diff the skip
		// hook uses, and keep scanning.
		if (verb == "readpause") {
			emitLine(Common::String("A11Y_CMD ") + cmd);
			const uint32 errBefore = g_errCount;
			applyReadPause(arg);
			if (g_errCount == errBefore)
				emitLine(Common::String("A11Y_DIFF {\"cmd\":\"readpause ") + arg + "\",\"changed\":false}");
			_queueHead++;
			continue;
		}

		// Other commands must wait until the conversation ends. Reject and consume
		// them, never leave them at the head.
		emitLine(Common::String("A11Y_ERR finish the conversation first: ") + cmd);
		_queueHead++;
		continue;
	}

	// Reclaim the queue once it has drained.
	if (_queueHead >= _commandQueue.size()) {
		_commandQueue.clear();
		_queueHead = 0;
	}
}

// Called once per main-loop frame: reads the command file, runs at most
// one queued command (it returns only once settled), then reports a room
// change that no command caused.

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

// Control/busy phase for this frame. Called once per poll() frame; emits only
// on a change, so in the steady state it is one check plus a compare per frame.
void A11yLayer::updateControlPhase() {
	emitPhase(playerInControl() ? kPhaseControl : kPhaseBusy);
}

// True when the engine is idle in free play: poll() ran this frame or the
// last, no menu screen is open and no command is running.
// _canSaveLoad is not usable here: it is only true inside two short
// windows of the main loop.
bool A11yLayer::playerInControl() const {
	// One or two frames, with jitter.
	static const uint32 kPollFreshMs = 120;
	uint32 last = _lastPollMs;
	bool pollFresh = last != 0 && g_system &&
	                 (g_system->getMillis() - last) <= kPollFreshMs;
	return pollFresh && !_engine->_menuScreen && !_inRunCommand;
}

bool A11yLayer::poll() {
	// Voice timing: tell the player when an actor's clip has ended.
	checkVoiceEnd();

	// Stamp first, before any early return.
	if (g_system)
		_lastPollMs = g_system->getMillis();

	readCommandFile();

	bool ranCommand = false;
	// Room at the start of the frame, to see whether this command changed it.
	int cmdBeforeChapter = _engine->currentChapter;
	int cmdBeforeRoom = _engine->_roomNumber;
	if (_queueHead < _commandQueue.size()) {
		Common::String cmd = _commandQueue[_queueHead];
		_queueHead++;
		ranCommand = true;

		// Snapshot, run the command until it settles, then emit one diff. A
		// command that errs gets no diff.
		Snapshot before;
		takeSnapshot(before);
		uint32 errCountBefore = g_errCount;
		beginSaidCapture();

		// A `talk` that opens a conversation has its diff emitted by the converse
		// hook, which cannot see these locals, so publish them on the layer.
		_mainCmd = cmd;
		_mainCmdSnapshot = before;
		_mainCmdErrCount = errCountBefore;
		_mainCmdDiffPending = true;
		_mainCmdOpenedConverse = false;

		// A `skip` taken by the skip hook while this is set belongs to this command.
		_inRunCommand = true;
		// Busy before runCommand(), so even a one-frame command shows the edge.
		emitPhase(kPhaseBusy);
		bool endedChapter = runCommand(cmd);
		_inRunCommand = false;

		if (endedChapter) {
			// The command ended the chapter. The next chapter's first room doesn't
			// exist yet, so stash the diff for its onStartup(), drop any surplus
			// skips, and return true as verify1() does.
			dropSurplusSkips();
			if (_engine->currentChapter == 6) {
				// After chapter 6 there is no next chapter. A11Y_GAME_END is normally
				// emitted from animation_9_6(); this is the fallback.
				if (!_gameEnded)
					emitGameEnd(cmd);
				// The engine is about to quit. The web page cannot see the process exit,
				// so say so.
				emitLine("A11Y_EXIT");
				_mainCmdDiffPending = false;
				_mainCmdOpenedConverse = false;
				return true;
			}
			stashCrossChapterDiff(cmd, before, errCountBefore);
			// A crossing opens no conversation; clear the pending talk diff.
			_mainCmdDiffPending = false;
			_mainCmdOpenedConverse = false;
			return true;
		}

		// Skip if the converse hook already emitted this command's diff.
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

	// A normal room change within the chapter (the crossing returned above).
	const bool cmdChangedRoom =
		ranCommand && (_engine->currentChapter != cmdBeforeChapter ||
		               _engine->_roomNumber != cmdBeforeRoom);

	if (ranCommand) {
		if (cmdChangedRoom) {
			// The diff already carries the new room, so no separate room-state line.
			// Re-stamp _lastPollMs: the walk and transition ran inside this frame, and
			// a stale stamp would report busy.
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
		// A room change no command drove: emit the room state.
		emitRoomState();
	}

	// control or busy for this frame, emitted only on change.
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
	Common::String json = "A11Y_GAME_END {\"cmd\":\"" + jsonEscape(cmd.c_str()) +
	                      "\",\"said\":" + saidJson() + "}";
	emitLine(json);
	_capturingSaid = false;
	_said.clear();
}
// Carrier for a chapter-crossing diff. A lazily created pointer, never
// freed, because ScummVM builds with -Wglobal-constructors.
A11yLayer::CrossCarry &A11yLayer::crossCarry() {
	static CrossCarry *instance = new CrossCarry();
	return *instance;
}

void A11yLayer::stashCrossChapterDiff(const Common::String &cmd,
                                      const Snapshot &before, uint32 errCountBefore) {
	CrossCarry &cd = crossCarry();
	cd.pending = true;
	cd.cmd = cmd;
	cd.errCountBefore = errCountBefore;
	cd.before = before;
	// The said lines the crossing cutscene drew (captured by onText() while
	// _capturingSaid was armed), so the crossing diff reports them.
	cd.said = _said;

	// Close this layer's capture window; the layer is about to be destroyed.
	_capturingSaid = false;
	_said.clear();
}

// Emits a stashed crossing diff against this chapter's first room. Returns
// true if it did, so onStartup() skips the room-state line.
bool A11yLayer::emitPendingCrossChapterDiff() {
	CrossCarry &cd = crossCarry();
	if (!cd.pending)
		return false;

	// Restore the said lines the crossing cutscene drew, and arm the capture
	// flag so emitDiff() treats them as this command's `said` and clears them.
	_said = cd.said;
	_capturingSaid = true;

	Common::String cmd = cd.cmd;
	uint32 errCountBefore = cd.errCountBefore;
	Snapshot before = cd.before;

	// Consume the carrier before emitting so a re-entrant path cannot double-emit.
	cd = CrossCarry();

	// The hero moved across the crossing, so the diff includes `hero`.
	emitDiff(cmd, before, errCountBefore);

	// This layer may have read more skips while the new chapter set up.
	dropSurplusSkips();

	// Sync the last-room markers to the settled state so poll() does not then
	// re-emit a plain room-state line for the same room.
	_lastChapter = _engine->currentChapter;
	_lastRoom = _engine->_roomNumber;
	return true;
}

// Skipping. Speech loops end a line on any key or action
// (isTalkFinished()); cutscenes break on kActionSkip. Both call
// updateEvents(), so the hook there raises the engine's own skip action.

// One call skips one line or one cutscene step.
void A11yLayer::raiseSkip() {
	Common::CustomEventType action = kActionSkip;
	_engine->addActionToBuffer(action);
}

// `save <slot>` calls saveGame(), as the F10 screen does, so
// --save-slot=<n> loads it. Slots are 1-based on disk.
void A11yLayer::dispatchSave(const Common::String &arg) {
	if (arg.empty()) {
		emitLine("A11Y_ERR save needs a slot number, e.g. `save 1`");
		return;
	}

	// Positive integer only.
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

	// The description shows chapter and room in the load list.
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

// Removes the first queued `skip`, keeping the rest in order.
bool A11yLayer::takeQueuedSkip() {
	for (uint i = _queueHead; i < _commandQueue.size(); i++) {
		const Common::String &cmd = _commandQueue[i];

		Common::String verb, arg;
		splitVerb(cmd, verb, arg);

		if (verb == "skip") {
			// Echo it as received, exactly as the main reader would.
			emitLine(Common::String("A11Y_CMD ") + cmd);
			// Remove just this entry, preserving the order of the rest.
			_commandQueue.remove_at(i);
			return true;
		}
	}
	return false;
}

// Drops surplus skips once a cutscene has ended, so they cannot skip the
// next room's first line.
void A11yLayer::dropSurplusSkips() {
	// Unread kActionSkip entries: collapse the ring buffer. Not
	// flushActionBuffer(), which would re-enter updateEvents().
	_engine->_actionBufferTail = _engine->_actionBufferHead;

	// Unread `skip` commands in our queue.
	uint w = _queueHead;
	for (uint r = _queueHead; r < _commandQueue.size(); r++) {
		Common::String verb, arg;
		splitVerb(_commandQueue[r], verb, arg);
		if (verb == "skip")
			continue;                 // surplus skip: drop it
		if (w != r)
			_commandQueue[w] = _commandQueue[r];
		w++;
	}
	while (_commandQueue.size() > w)
		_commandQueue.remove_at(_commandQueue.size() - 1);
}

// Busy watchdog decision, free of engine state. Liveness is the newer of
// the last poll() and the last output line. Never escalates while a
// conversation is open: a player reading a reply menu is not a stall.
A11yLayer::WatchdogAction A11yLayer::watchdogDecision(
    bool converseActive, bool queued, uint32 liveness, uint32 lastPollMs,
    uint32 now, int stage, uint32 baseMs) {
	// Conversation open: never escalate.
	if (converseActive)
		return kWatchdogNoop;

	// Nothing queued to settle: not a dead state.
	if (!queued)
		return kWatchdogNoop;

	// Nothing has run or been emitted yet (boot) — no stall to measure against.
	if (liveness == 0)
		return kWatchdogHold;

	// Reset when the engine is alive again. Once stage 1 has fired, its own
	// output line refreshes liveness, so only poll() running again counts.
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

	// Never escalates during a conversation.
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
		// Stage 1: a log-only error and one skip. The emit refreshes liveness, so
		// stage 2 is timed from _watchdogBaseMs.
		emitLine("A11Y_ERR busy-skip");
		raiseSkip();
		_watchdogStage = 1;
		return;

	case kWatchdogStage2:
		// Stage 2: drop surplus skips and the queue, and report it.
		dropSurplusSkips();
		_commandQueue.clear();
		_queueHead = 0;
		emitLine("A11Y_ERR busy: commands dropped");
		_watchdogStage = 2;
		return;
	}
}

// Walk overshoot. moveCharacters() stops a walk only on an exact-hit window
// one step wide. Perspective re-scaling can move the centre one pixel past
// it (chapter 4, room 22), and the walk never ends. Armed only around our
// own walkToPoint() calls.

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

	// End the walk as the engine's own arrival does.
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

// Emits A11Y_VEND once when a voiced clip stops, played out or skipped.
void A11yLayer::checkVoiceEnd() {
	if (!_voicePlaying || !_engine)
		return;
	if (_engine->soundIsActive())
		return;
	_voicePlaying = false;
	emitLine("A11Y_VEND");
	if (_readPause && !_inHold)
		holdForReading();
}

// Reading pause: after a voiced clip, wait 400 ms plus 65 ms per character
// (at most 9000 ms) so a screen reader can finish the line. This runs
// inside the talk loop, so it pumps events and the screen like the
// engine's own pause loops, and ends on a key, mouse button, new command
// or quit.
void A11yLayer::holdForReading() {
	if (!g_system || !_engine || _engine->shouldQuit())
		return;

	// A key already waiting (a skip) means the player is moving on: no hold.
	if (_engine->_actionBufferHead != _engine->_actionBufferTail)
		return;

	uint32 ms = 400 + 65 * _voiceLen;
	if (ms > 9000)
		ms = 9000;

	_inHold = true;
	emitLine(Common::String::format("A11Y_VHOLD %u", (uint)ms));

	const uint linesBefore = _cmdLinesRead;
	const uint32 start = g_system->getMillis();
	uint32 lastRead = start;
	while (g_system->getMillis() - start < ms) {
		g_system->delayMillis(10);
		_engine->updateEvents();     // pumps events; its hook also reads the command file
		g_system->updateScreen();

		if (_engine->shouldQuit())
			break;
		// Key (queued as an action) or mouse button.
		if (_engine->_actionBufferHead != _engine->_actionBufferTail ||
		    _engine->_leftMouseButton || _engine->_rightMouseButton)
			break;
		// New command-file line, checked here about every 100 ms in case the
		// hook's own throttled read has not run.
		uint32 now = g_system->getMillis();
		if (now - lastRead >= 100) {
			lastRead = now;
			readCommandFile();
		}
		if (_cmdLinesRead != linesBefore)
			break;
	}
	_inHold = false;
}

// `readpause on` / `readpause off`. Anything else is an A11Y_ERR.
bool A11yLayer::applyReadPause(const Common::String &arg) {
	if (arg == "on") {
		_readPause = true;
		return true;
	}
	if (arg == "off") {
		_readPause = false;
		return true;
	}
	emitLine(Common::String("A11Y_ERR readpause needs on or off, got: ") + arg);
	return false;
}

// Take every queued `readpause` line (see the header).
bool A11yLayer::takeQueuedReadPause() {
	bool took = false;
	for (uint i = _queueHead; i < _commandQueue.size();) {
		const Common::String cmd = _commandQueue[i];
		Common::String verb, arg;
		splitVerb(cmd, verb, arg);
		if (verb != "readpause") {
			i++;
			continue;
		}
		emitLine(Common::String("A11Y_CMD ") + cmd);
		_commandQueue.remove_at(i);
		const uint32 errBefore = g_errCount;
		applyReadPause(arg);
		// Settle like a skip with no command in flight; when a command is in
		// flight its own diff covers this window.
		if (!_inRunCommand && g_errCount == errBefore)
			emitLine(Common::String("A11Y_DIFF {\"cmd\":\"readpause ") + arg + "\",\"changed\":false}");
		took = true;
	}
	return took;
}

void A11yLayer::onUpdateEvents() {
	if (!g_system)
		return;

	// The watchdog runs every frame, not on the 250 ms skip-read throttle.
	runBusyWatchdog();

	// Voice timing: every frame (not throttled), so A11Y_VEND is emitted as soon
	// as the actor's clip ends or a skip stops it inside a talk or cutscene loop.
	checkVoiceEnd();

	// Every frame, right after a step that may have overshot.
	checkWalkOvershoot();

	// Read the command file at most every 250 ms from here.
	uint32 now = g_system->getMillis();
	if (_lastSkipPollMs != 0 && now - _lastSkipPollMs < 250)
		return;
	_lastSkipPollMs = now;

	// Honour every queued `skip`. With no command in flight there is nothing
	// to skip, so emit its no-op diff here; a reader waits for one.
	readCommandFile();
	while (takeQueuedSkip()) {
		raiseSkip();
		if (!_inRunCommand)
			emitLine("A11Y_DIFF {\"cmd\":\"skip\",\"changed\":false}");
	}
	// A `readpause` queued while a talk or cutscene loop blocks poll().
	takeQueuedReadPause();

	// Reclaim a fully-drained queue so a long cutscene does not leave a growing
	// spent prefix. Only when nothing is pending — a non-`skip` command left in
	// the queue must survive for poll() to run after the cutscene ends.
	if (_queueHead >= _commandQueue.size()) {
		_commandQueue.clear();
		_queueHead = 0;
	}
}

} // namespace Drascula
