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

// All a11y output is one prefixed line on stderr, so a web page reads it via
// Module.printErr and a native run reads it on fd 2 (Requirement 10.6). We go
// through g_system->logMessage() with the error type because, on the SDL
// backend, kInfo/kDebug go to stdout while everything else goes to stderr
// (backends/platform/sdl/sdl.cpp). logMessage adds no prefix of its own — the
// "WARNING:"/"ERROR:" text is added by the warning()/error() callers, not here
// — so each A11Y line comes out clean and parseable line by line (R1.6).
static void emitLine(const Common::String &line) {
	if (!g_system)
		return;
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

A11yLayer::A11yLayer(DrasculaEngine *engine)
	: _engine(engine), _lastChapter(-1), _lastRoom(-1), _queueHead(0),
	  _clickState(kClickIdle) {
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

	// Emit the first playable room exactly as a normal room entry would, so the
	// very first line an external reader sees is a complete A11Y room state.
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
Common::String A11yLayer::buildRoomState() {
	DrasculaEngine *e = _engine;

	// Hero point: horizontal centre and foot of the hero (R5.2), in the same
	// coordinate space as the object rects and walk-to points (R5.3).
	int heroX = e->curX + e->curWidth / 2;
	int heroY = e->curY + e->curHeight;

	Common::String json = Common::String::format(
		"{\"chapter\":%d,\"room\":%d,\"hero\":{\"x\":%d,\"y\":%d},\"objects\":[",
		e->currentChapter, e->_roomNumber, heroX, heroY);

	// Objects: indices 0 .. numRoomObjs-1 are the live room-object slots; the
	// parallel arrays (objectNum/objName/_objectRect/_roomObject/visible/isDoor/
	// _doorDestRoom) are all keyed on that same slot index (see rooms.cpp room
	// parse and objects.cpp checkObjects).
	for (int l = 0; l < e->numRoomObjs; l++) {
		if (l > 0)
			json += ",";

		// rect is reported as [x, y, w, h]; the engine stores it as a
		// Common::Rect(left, top, right, bottom), so width()/height() give the
		// size (R1.3).
		const Common::Rect &r = e->_objectRect[l];
		const Common::Point &w = e->_roomObject[l];

		json += Common::String::format(
			"{\"num\":%d,\"name\":\"%s\",\"rect\":[%d,%d,%d,%d],"
			"\"walkTo\":[%d,%d],\"visible\":%s,\"door\":%s",
			e->objectNum[l],
			jsonEscape(e->objName[l]).c_str(),
			r.left, r.top, r.width(), r.height(),
			w.x, w.y,
			e->visible[l] ? "true" : "false",
			e->isDoor[l] ? "true" : "false");

		// A door also carries its destination room (R1.3).
		if (e->isDoor[l])
			json += Common::String::format(",\"toRoom\":%d", e->_doorDestRoom[l]);

		json += "}";
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
void A11yLayer::runCommand(const Common::String &cmd) {
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
		return;
	}

	// Verb-on-object dispatch (task 8, R3.1/R3.2/R3.4): each a11y verb word maps
	// to the engine's own kVerb* constant, and the action runs through the
	// engine's verify2()/checkAction() path for the named object slot. `talk`
	// has no kVerb of its own in these commands — it is kVerbTalk — and `take`
	// is the engine's kVerbPick.
	if (verb == "look") {
		dispatchVerb(kVerbLook, arg);
		return;
	}
	if (verb == "take") {
		dispatchVerb(kVerbPick, arg);
		return;
	}
	if (verb == "open") {
		dispatchVerb(kVerbOpen, arg);
		return;
	}
	if (verb == "close") {
		dispatchVerb(kVerbClose, arg);
		return;
	}
	if (verb == "talk") {
		dispatchVerb(kVerbTalk, arg);
		return;
	}
	if (verb == "push") {
		// The engine's "push/move" verb is kVerbMove.
		dispatchVerb(kVerbMove, arg);
		return;
	}

	// Doors and walking (task 9, R3.8 / R2.6). One numeric arg is an object
	// walk (`walk 52`); two numeric args are a free-point walk (`walk 170 158`).
	if (verb == "walk") {
		dispatchWalk(arg);
		return;
	}

	// No handler yet (lands in a later task). Report and continue (R2.5).
	emitLine(Common::String("A11Y_ERR no handler for command: ") + cmd);
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
void A11yLayer::runVerbOnSlot(int verb, int slot) {
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
	e->walkToPoint(e->_roomObject[slot]);
	e->checkAction(e->objectNum[slot]);
}

// Handle a `<verb> <num>` command: resolve the slot for the engine object
// number, emit A11Y_ERR if it is not in the room (R2.5), else run the verb on
// that slot. Returns true when the command was understood (even if the object
// was missing); false only when the argument was not a number.
bool A11yLayer::dispatchVerb(int verbConst, const Common::String &arg) {
	if (arg.empty()) {
		emitLine("A11Y_ERR verb needs an object number, e.g. `look 52`");
		return true;
	}

	// Parse the object number. a11y object ids are plain strings of digits
	// (e.g. "52"), so require every character to be a digit; a non-numeric
	// argument like `look door` is a clear error, not a silent atoi() 0.
	for (uint i = 0; i < arg.size(); i++) {
		if (arg[i] < '0' || arg[i] > '9') {
			emitLine(Common::String("A11Y_ERR object must be a number, got: ") + arg);
			return true;
		}
	}
	int num = atoi(arg.c_str());

	int slot = slotForObjectNum(num);
	if (slot < 0) {
		emitLine(Common::String::format(
			"A11Y_ERR object %d is not in this room", num));
		return true;
	}

	runVerbOnSlot(verbConst, slot);
	return true;
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

void A11yLayer::dispatchWalk(const Common::String &arg) {
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
		return;
	}

	// One word: object walk. Resolve the slot for the engine hotspot number and
	// walk to / through it; A11Y_ERR if the object is not in this room (R2.5).
	if (words.size() == 1) {
		int num;
		if (!parseInt(words[0], num)) {
			emitLine(Common::String("A11Y_ERR walk object must be a number, got: ") + words[0]);
			return;
		}
		int slot = slotForObjectNum(num);
		if (slot < 0) {
			emitLine(Common::String::format(
				"A11Y_ERR object %d is not in this room", num));
			return;
		}
		walkObject(slot);
		return;
	}

	// Two words: free-point walk. Both must be integers (R2.5).
	if (words.size() == 2) {
		int x, y;
		if (!parseInt(words[0], x) || !parseInt(words[1], y)) {
			emitLine(Common::String::format(
				"A11Y_ERR walk point needs two integer coordinates, got: %s %s",
				words[0].c_str(), words[1].c_str()));
			return;
		}
		walkPoint(x, y);
		return;
	}

	// Anything else is malformed (R2.5).
	emitLine("A11Y_ERR walk takes one object number or two coordinates, "
	         "e.g. `walk 52` or `walk 170 158`");
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
void A11yLayer::walkObject(int slot) {
	DrasculaEngine *e = _engine;

	if (e->isDoor[slot]) {
		// The engine's own door path: walk to the door, play any door
		// animation, run exitRoom()/enterRoom() for _doorDestRoom[slot]. poll()
		// detects the resulting room/chapter change and re-emits the A11Y room
		// state (task 4), so we do not emit it here.
		e->exitRoom(slot);
		return;
	}

	// A non-door object: just walk the hero to the object's walk-to point, the
	// same point the engine walks to before acting on the object. Face the
	// object afterwards, as the engine's own object-walk does (trackFinal via
	// _walkToObject). walkToPoint() runs its own loop to completion.
	e->trackFinal = e->trackObj[slot];
	e->_walkToObject = true;
	e->walkToPoint(e->_roomObject[slot]);
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
	e->walkToPoint(Common::Point(cx, cy));
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
void A11yLayer::poll() {
	// Advance any click in flight (release the button the frame after a press).
	stepClick();

	readCommandFile();

	// Hold the queue while a synthetic click is mid-flight: the current command
	// has not settled until its click's release frame has run (R2.2, R8.1).
	if (!clickSettled())
		return;

	if (_queueHead < _commandQueue.size()) {
		Common::String cmd = _commandQueue[_queueHead];
		_queueHead++;
		runCommand(cmd);

		// Reclaim the spent prefix once the queue has fully drained, so a long
		// session does not grow the array without bound. Nothing is pending, so
		// clearing is safe and keeps _queueHead meaningful.
		if (_queueHead >= _commandQueue.size()) {
			_commandQueue.clear();
			_queueHead = 0;
		}
	}

	if (_engine->currentChapter != _lastChapter || _engine->_roomNumber != _lastRoom)
		emitRoomState();
}

} // namespace Drascula
