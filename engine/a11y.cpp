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

	if (verb == "state" || verb == "dump") {
		// Backed by the same room-state code as room entry (R1.5, task 4).
		dump();
		return;
	}

	// No handler yet (lands in a later task). Report and continue (R2.5).
	emitLine(Common::String("A11Y_ERR no handler for command: ") + cmd);
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
