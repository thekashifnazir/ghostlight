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

A11yLayer::A11yLayer(DrasculaEngine *engine) : _engine(engine) {
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

// Called on every room entry; emits one `A11Y { ... }` room-state line.
//
// Task 3 lands a minimal but valid line (chapter + room) so the startup path
// is exercised end to end and the first A11Y line is present. Task 4 fills in
// objects, inventory, flags and the hero point against this same emission.
void A11yLayer::onRoomEntry() {
	Common::String line = Common::String::format(
		"A11Y {\"chapter\":%d,\"room\":%d}",
		_engine->currentChapter, _engine->_roomNumber);
	emitLine(line);
}

// Called once per main-loop frame. Command reader and queue land in task 5.
void A11yLayer::poll() {
}

} // namespace Drascula
