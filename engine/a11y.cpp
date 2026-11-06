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

// Parse a whole-string signed integer. Defined below (used by both the `use`
// and `walk` dispatchers); forward-declared here so dispatchUse can call it.
static bool parseInt(const Common::String &s, int &out);

A11yLayer::A11yLayer(DrasculaEngine *engine)
	: _engine(engine), _lastChapter(-1), _lastRoom(-1), _queueHead(0),
	  _clickState(kClickIdle) {
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
	emitLine(Common::String("A11Y_TEXT ") + message);
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

	// Use an inventory item on a room object (task 10, R3.4 / R3.5):
	// `use <item> on <obj>` or `use <item> <obj>`.
	if (verb == "use") {
		dispatchUse(arg);
		return;
	}

	// Inventory listing (task 13, R6.4). `inventory` and the short alias `inv`
	// both emit the dedicated A11Y_INV line. It takes no argument; any trailing
	// text is ignored.
	if (verb == "inventory" || verb == "inv") {
		dispatchInventory();
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

	// Object 50 is the engine's special "hero / self" object (R3.7): it is not
	// a room object in objectNum[], so it gets its own path. A verb on 50 runs
	// checkAction(50) against the hero (e.g. `look 50` is look-at-self).
	if (num == 50) {
		runVerbOnSelf(verbConst);
		return true;
	}

	// A room object: resolve its slot and run the verb through the engine's own
	// room-object path (task 8).
	int slot = slotForObjectNum(num);
	if (slot >= 0) {
		runVerbOnSlot(verbConst, slot);
		return true;
	}

	// Not a room object. It may be an inventory item the player wants to act on
	// in the inventory screen (R3.6), e.g. `look 28` to look at the phone. Real
	// items are id >= 7 (gotcha 7); verb slots 1..6 are not items.
	if (num >= 7 && slotForItem(num) >= 0) {
		runVerbOnItemSlot(verbConst, num);
		return true;
	}

	// Neither a room object, the hero, nor an inventory item the player holds.
	emitLine(Common::String::format(
		"A11Y_ERR object %d is not in this room or inventory", num));
	return true;
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
void A11yLayer::useItemOnSlot(int itemId, int slot) {
	DrasculaEngine *e = _engine;

	// Drop whatever verb/item is currently held, returning it to the inventory,
	// exactly as a right-click does. selectVerb(kVerbNone) runs
	// `if (takeObject == 1) addObject(pickedObject)` then clears takeObject, so
	// after this the hero holds nothing and no stale verb number can leak into
	// the inventory on the next pick (interface.cpp selectVerb).
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);

	// Pick up the item the game's way: take it out of its inventory slot
	// (removeObject(id)) and make it the picked object / cursor (pickObject ->
	// chooseObject sets takeObject = 1, pickedObject = id). This is the state a
	// left-click on the item in the inventory screen leaves behind, and it is
	// what the room-action handlers read.
	e->removeObject(itemId);
	e->pickObject(itemId);

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
	e->walkToPoint(e->_roomObject[slot]);
	e->checkAction(e->objectNum[slot]);

	// R3.5 — item return. If the item was consumed, the handler already removed
	// it and cleared the picked object (takeObject == 0). If the use did not
	// apply, the item is still held (takeObject == 1, pickedObject == itemId)
	// and currently absent from the inventory array, so selectVerb(kVerbNone)
	// puts it back (its addObject(pickedObject)) and clears the cursor — the
	// right-click a player would do. Guarding on `takeObject == 1` means we
	// never double-add a consumed item.
	if (e->takeObject == 1)
		e->selectVerb(kVerbNone);
}

// Parse and dispatch `use <item> on <obj>` / `use <item> <obj>` (R3.4). Rejects
// an item not in inventory, an object not in the room, and malformed syntax
// with A11Y_ERR, keeping the layer running (R2.5).
void A11yLayer::dispatchUse(const Common::String &arg) {
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
		return;
	}
	if (words.size() == 1) {
		emitLine("A11Y_ERR use needs a target: `use <item> on <object>` "
		         "(a room object, another item, or 50 for the hero)");
		return;
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
		return;
	}

	// Both the item id and the object number must be plain strings of digits
	// (a11y ids are numeric), so a non-numeric token is a clear error rather
	// than a silent atoi() 0.
	int itemId, objNum;
	if (!parseInt(itemWord, itemId) || itemId < 0) {
		emitLine(Common::String("A11Y_ERR use item must be a number, got: ") + itemWord);
		return;
	}
	if (!parseInt(objWord, objNum) || objNum < 0) {
		emitLine(Common::String("A11Y_ERR use object must be a number, got: ") + objWord);
		return;
	}

	// The item must actually be in the inventory (gotcha 7: real items are
	// id >= 7; verb slots 1..6 are not items). Reject before touching any state
	// so a bad `use` changes nothing (R2.5).
	if (itemId < 7) {
		emitLine(Common::String::format(
			"A11Y_ERR %d is a verb slot, not an inventory item (items are id 7+)", itemId));
		return;
	}
	if (!itemInInventory(itemId)) {
		emitLine(Common::String::format(
			"A11Y_ERR item %d is not in the inventory", itemId));
		return;
	}

	// The target is object 50, the hero / self (R3.7): `use <item> on 50`.
	// Object 50 is not a room object, so it has its own path — the room handlers
	// key item-on-self on `pickedObject == <itemId> && fl == 50`.
	if (objNum == 50) {
		useItemOnSelf(itemId);
		return;
	}

	// The target may be a live room object (task 10): `use <item> on <objNum>`.
	int slot = slotForObjectNum(objNum);
	if (slot >= 0) {
		useItemOnSlot(itemId, slot);
		return;
	}

	// The target may be another inventory item (item-on-item, R3.6): both the
	// held item and the target are in the inventory, combined on the inventory
	// screen. Real items are id >= 7 (gotcha 7).
	if (objNum >= 7 && slotForItem(objNum) >= 0) {
		// An item cannot be combined with itself.
		if (objNum == itemId) {
			emitLine(Common::String::format(
				"A11Y_ERR cannot use item %d on itself", itemId));
			return;
		}
		useItemOnItemSlot(itemId, objNum);
		return;
	}

	// Not the hero, a room object, or an inventory item.
	emitLine(Common::String::format(
		"A11Y_ERR target %d is not a room object, an inventory item, or the hero (50)",
		objNum));
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
