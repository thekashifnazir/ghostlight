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

#include "common/array.h"
#include "common/str.h"

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

	// Emits the current room state as an `A11Y { ... }` line, identical to a
	// room entry. Backs the `dump`/`state` command (R1.5); the command reader
	// in a later task calls this.
	void dump();

	// Called once per main-loop frame; reads the command file, queues any new
	// lines, and runs at most one queued command (emitting A11Y_CMD and, when a
	// handler exists, A11Y_DIFF, or A11Y_ERR when it cannot run). Also re-emits
	// the A11Y room state on a room/chapter change.
	void poll();

	// Schedule a synthetic left click at room-coordinate (x, y). A real click
	// is a button press on one frame and a release on a following frame, so
	// this does NOT click immediately: it warps the mouse to (x, y) so the
	// engine's hover name matches the target (R3.3), presses the button this
	// frame, and queues the release for the next frame (R8.1). The button is
	// never pressed and released in the same frame, and never held across a
	// dialogue line (R8.2 / gotchas 2, 3).
	//
	// The dispatch tasks (8-11, 20) call this to drive the game. It returns
	// once the press is set up; the press is acted on by the engine's own
	// button handling later in the same frame, and clickSettled() reports true
	// only after the release frame has run, so the one-command-at-a-time settle
	// model waits for the whole click to complete.
	void synthClick(int x, int y);

	// True when no synthetic click is mid-flight (idle), so a command that
	// issued a click has fully settled its click (press frame and release
	// frame both done). Dispatch code uses this to hold the command queue until
	// the click completes.
	bool clickSettled() const;

private:
	// Build the full room-state JSON object (chapter, room, hero point,
	// objects, inventory, flags) as a single line. Shared by onRoomEntry()
	// and dump() so both emit identical state.
	Common::String buildRoomState();

	// Emit the room state and remember what room/chapter it describes, so the
	// per-frame poll() can tell when a room change has happened and emit again.
	void emitRoomState();

	// Read <savepath>/a11y-cmd.txt, append every non-blank, non-`#` line to the
	// command queue, then truncate the file so each line is consumed exactly
	// once. A missing or empty file is normal (nothing queued). (R2.1, R2.3)
	void readCommandFile();

	// Run one command string: echo it as A11Y_CMD (R2.4), then dispatch it.
	// Dispatch for most verbs lands in later tasks (7-20); any command with no
	// handler yet emits A11Y_ERR and the layer keeps running (R2.5).
	void runCommand(const Common::String &cmd);

	// Advance the synthetic-click state machine by one frame. Called at the top
	// of poll(), before any command is dequeued, so a click in flight finishes
	// (press this frame, release the next) before the next command runs. See
	// the ClickState comments and synthClick() for the two-step model (R8).
	void stepClick();

	DrasculaEngine *_engine;

	// Last chapter/room an `A11Y` room-state line was emitted for. poll()
	// compares the live engine values against these each frame and re-emits on
	// a change, so the line prints on every room change even though the room
	// transition itself happens inside exitRoom()/enterRoom() in rooms.cpp
	// (which the patch does not touch). -1 means "nothing emitted yet".
	int _lastChapter;
	int _lastRoom;

	// Commands waiting to run. The command file is read every frame and its
	// lines are appended here; poll() runs exactly one per frame, dequeuing the
	// next only after the current one has settled (control has returned to the
	// main loop with walking/speech/cutscene finished). _queueHead is the index
	// of the next command to run; entries before it are spent. (R2.1, R2.2)
	Common::Array<Common::String> _commandQueue;
	uint _queueHead;

	// Synthetic click state machine (R8 / gotchas 2, 3). A real mouse click is
	// a press event on one frame followed by a release event on a later frame;
	// the engine's main loop reads _leftMouseButton once per frame and only
	// acts on the press when the button was not already held (_leftMouseButtonHeld),
	// then clears the "held" latch when it sees the button go back to 0. So a
	// synthetic click MUST set the button down on one frame and clear it on a
	// following frame — never both in one frame (the press/release would cancel
	// and never be seen, gotcha 2), and never hold it down across frames of
	// dialogue (a held button skips every line, gotcha 3).
	//
	//   kClickIdle    — nothing in flight.
	//   kClickPressed — the button was set down and the mouse warped this frame;
	//                   the release is queued for the next frame.
	//
	// synthClick() moves Idle -> Pressed and sets the button/mouse for the press
	// frame. stepClick(), at the top of the next poll(), moves Pressed -> Idle and
	// clears the button for the release frame. clickSettled() is true only in
	// kClickIdle, so dispatch holds the command queue until the full click is done.
	enum ClickState {
		kClickIdle = 0,
		kClickPressed
	};
	ClickState _clickState;
};

} // namespace Drascula

#endif // DRASCULA_A11Y_H
