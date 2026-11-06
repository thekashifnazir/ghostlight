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
	: _engine(engine), _lastChapter(-1), _lastRoom(-1) {
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

// Called once per main-loop frame. For task 4 it watches for a room or chapter
// change and emits the new room state, so the `A11Y` line prints on every room
// change (R1.1). The actual transition happens inside exitRoom()/enterRoom() in
// rooms.cpp, which runs its own walk loop; control returns here once the move
// has settled, so detecting the change in the main-loop poll keeps all engine
// hooks in drascula.cpp (R10.2) and lines up with the command-settle model.
//
// The command reader and queue (A11Y_CMD / A11Y_DIFF) land in task 5 and build
// on this same per-frame entry point.
void A11yLayer::poll() {
	if (_engine->currentChapter != _lastChapter || _engine->_roomNumber != _lastRoom)
		emitRoomState();
}

} // namespace Drascula
