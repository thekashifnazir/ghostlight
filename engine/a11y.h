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
 * pinned checkout under vendor/ by scripts/build-engine.sh. The matching hooks
 * in drascula.cpp, converse.cpp and graphics.cpp live in engine/hooks.patch.
 * Never edit vendor/ by hand.
 */

#ifndef DRASCULA_A11Y_H
#define DRASCULA_A11Y_H

// Scaffold for the engine a11y layer. Implementation lands in tasks 3 onward.
// This header declares the surface the hooks in hooks.patch call into, so the
// patch stays small (a few lines per file) and all logic lives here.

namespace Drascula {

class DrasculaEngine;

// The a11y layer. Observes room/inventory/flag state, translates text commands
// from <savepath>/a11y-cmd.txt into the engine's own action calls, and emits
// newline-delimited A11Y* log lines via the engine's debug/printErr path.
class A11yLayer {
public:
	explicit A11yLayer(DrasculaEngine *engine);

	// Called once at startup (after the intro is skipped) to assert subtitles
	// are on and emit the first room state.
	void onStartup();

	// Called on every room entry; emits one `A11Y { ... }` room-state line.
	void onRoomEntry();

	// Called once per main-loop frame; reads and runs one queued command,
	// then emits A11Y_CMD and A11Y_DIFF (or A11Y_ERR).
	void poll();

private:
	DrasculaEngine *_engine;
};

} // namespace Drascula

#endif // DRASCULA_A11Y_H
