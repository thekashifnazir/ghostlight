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
	// Find the room-object slot whose engine hotspot number is `num`, or -1 if
	// no live room object has that number. a11y commands name objects by the
	// engine's own per-room hotspot number (the `num` field in the A11Y room
	// state); the parallel room arrays are keyed on the slot index, so dispatch
	// looks the slot up here first. (R3.1)
	int slotForObjectNum(int num) const;

	// Run a verb (look/take/open/close/talk/push) on the room object in `slot`,
	// by reproducing the engine's own click path: select the verb, warp the
	// mouse to the object's hotspot for hover-name correctness (R3.3), set the
	// object's name (so the engine's own "can't do that" response can fire),
	// then run the engine's walkToPoint() + checkAction() for that slot (R3.1,
	// R3.2). This is the body of verify2()'s per-object branch, run directly on
	// the chosen slot rather than via a pixel hit test, so it is reliable when
	// the hero wins the hit test or hotspots overlap (gotcha 6).
	void runVerbOnSlot(int verb, int slot);

	// Parse a verb command of the form `<verb> <num>` (e.g. `look 52`): look up
	// the slot for `num`, emit A11Y_ERR if the object is not in the room (R2.5),
	// otherwise run the verb on that slot. `verbConst` is the engine's kVerb*
	// value for the a11y verb word. Returns true if it handled the command.
	bool dispatchVerb(int verbConst, const Common::String &arg);

	// Handle the `use` command (task 10, R3.4 / R3.5). The only form this task
	// handles is applying an inventory item to a room object:
	//   * `use <item> on <obj>`  — apply inventory item <item> to room object
	//                              whose engine hotspot number is <obj>.
	//   * `use <item> <obj>`     — same, without the literal `on` word (R3.4
	//                              spells the command `use <item> <object>`).
	// Emits A11Y_ERR and keeps running (R2.5) when the item is not in the
	// inventory, the object is not in the room, or the syntax is malformed. A
	// bare `use <item>` (no target) has no standalone-use path in this engine,
	// so it is an A11Y_ERR here; self / object-50 targets belong to task 11.
	void dispatchUse(const Common::String &arg);

	// True when inventory item id `itemId` (a real item, id >= 7) is currently
	// held in a live inventory slot (inventoryObjects[1..]). Used to reject a
	// `use` of an item the hero does not have before anything is disturbed, so
	// the command is a clean A11Y_ERR with no state change (R2.5).
	bool itemInInventory(int itemId) const;

	// Apply inventory item `itemId` to the room object in `slot` by reproducing
	// the engine's own "click a room object while holding an item" path (R3.4),
	// then return the item to the inventory if the use did not consume it
	// (R3.5). Runs the GAME'S OWN room-action handler (checkAction), so applying
	// uses behave exactly as a mouse would, and a non-applying use leaves the
	// item safely back in inventory rather than lost.
	void useItemOnSlot(int itemId, int slot);

	// --- Inventory-screen targets and self / object 50 (task 11, R3.6/R3.7) --

	// Find the live inventory slot (index into inventoryObjects[], 1-based) that
	// currently holds real item id `itemId` (>= 7), or -1 if the item is not in
	// the inventory. A verb or use whose TARGET is an inventory item uses this
	// to confirm the hero actually holds it before acting (R3.6, R2.5). The
	// action itself passes the item id straight to checkAction() as `fl`, so no
	// on-screen slot position is needed. (R3.6)
	int slotForItem(int itemId) const;

	// Run a verb (look/take/open/close/talk/push) on object 50, the engine's
	// special "hero / self" object (R3.7). The non-menu branch of verify2()
	// treats the hero as object 50: when the cursor is over the hero
	// (`textName == _textmisc[3]` and `_hasName`) it runs `checkAction(50)` with
	// the held verb. We reproduce that directly: select the verb, set
	// textName/_hasName to the hero so the engine's own self-handlers fire
	// (e.g. chapter 6 `pickedObject == kVerbLook && fl == 50`), then run
	// checkAction(50). Object 50 is NOT a room object in objectNum[], so there
	// is no slot and no walk — the action is against the hero in place.
	void runVerbOnSelf(int verb);

	// Apply inventory item `itemId` to object 50 (the hero / self) and return
	// the item if the use did not consume it (R3.7, R3.5). The engine's room
	// handlers key item-on-self on `pickedObject == <itemId> && fl == 50` (e.g.
	// chapter 2 `pickedObject == 11 && fl == 50`), so we pick the item up the
	// game's way, mark the cursor as over the hero, run checkAction(50), then
	// return a still-held item exactly as the room-object use does.
	void useItemOnSelf(int itemId);

	// Run a verb on an inventory-screen item: the TARGET is an inventory item,
	// not a room object (R3.6). Opens the inventory screen the way a right-click
	// does (set _menuScreen, load the icon surfaces), selects the verb, runs the
	// engine's own menu-screen action (checkAction(itemId), which takes its
	// `_menuScreen` branch — roomParse(200) and the look-at-item handlers), then
	// closes the screen and restores the room palette/surfaces exactly as the
	// right-click-close path does. `verb` is the held kVerb* (e.g. look). The
	// item id is passed straight to checkAction() as `fl`, so no mouse-position
	// lookup is needed (gotcha 6: act on the item, not a pixel).
	void runVerbOnItemSlot(int verb, int itemId);

	// Apply inventory item `itemA` to another inventory item `itemB` on the
	// inventory screen (item-on-item combination, R3.6), returning any item not
	// consumed (R3.5). In the real game this is: right-click to open the menu,
	// left-click item A (it becomes the picked object), then click item B —
	// pickupObject() sees the slot under B is occupied, so it falls through to
	// checkMenuFlags() -> checkAction(itemB) with pickedObject == itemA, and the
	// `_menuScreen` combination handlers fire (e.g. chapter 4
	// `pickedObject == 18 && fl == 19` combines the two coins into the bill).
	// We reproduce that: open the screen, hold item A, warp to item B's slot,
	// run checkAction(itemB), return any still-held item, close the screen.
	void useItemOnItemSlot(int itemA, int itemB);

	// Open the inventory screen the way the main loop's right-click block does
	// (drascula.cpp): load the chapter's icon surfaces into backSurface and
	// cursorSurface and set _menuScreen = true, so checkAction() takes its
	// `_menuScreen` branch. Paired with closeInventoryScreen(). Factored out so
	// both the verb-on-item and item-on-item paths open and close the screen
	// identically to the engine. (R3.6)
	void openInventoryScreen();

	// Close the inventory screen the way the main loop's right-click-close block
	// does: reload the room background/cursor surfaces, restore gamePalette and
	// clear _menuScreen. Paired with openInventoryScreen(). (R3.6)
	void closeInventoryScreen();

	// Handle the `inventory` / `inv` command (task 13, R6.4 / gotcha 9). Emit a
	// single `A11Y_INV ` line listing every real inventory item (id >= 7;
	// gotcha 7 excludes the verb-icon slots 1..6) with its id, a human-readable
	// name, and the game's own "look at it" line where one is defined. The game
	// never shows item names on screen (gotcha 9): the name comes from a static
	// table keyed on the item id (the `InventoryItems` / `InventoryItems2`
	// enums in drascula.h — the chapters 1-3 set and the chapters 4-6 set,
	// chosen by currentChapter), and the look line comes from the engine's own
	// "look at item" table (pseudo-room 200 in _roomActions). Names and look
	// lines are READ from the engine's data, never fabricated: an item with no
	// known name/look emits what is reliably available and omits the rest.
	void dispatchInventory();

	// Human-readable name for inventory item `itemId`, from the static table
	// backing the `InventoryItems` (chapters 1-3) and `InventoryItems2`
	// (chapters 4-6) enums in drascula.h. The game stores no item-name strings,
	// so the name mirrors the enum constant turned into plain words (gotcha 9).
	// Returns an empty string when the id is unknown for the current chapter set
	// (so the caller omits the name rather than inventing one). The set is
	// chosen by `chapter`: 1..3 use InventoryItems, 4..6 use InventoryItems2.
	Common::String itemName(int itemId) const;

	// The game's own "look at it" speech line for inventory item `itemId`, or an
	// empty string if the engine defines none. This is the exact text the game
	// would speak for a look at the item on the inventory screen: the engine
	// runs `roomParse(200, itemId)` for that (checkAction's _menuScreen branch),
	// which looks up _roomActions for room 200 with a matching action/objectID
	// and speaks _text[speechID]. We resolve the SAME entry and return the
	// string directly from _text, without animating or speaking it, so the look
	// line is captured as data. Empty when no room-200 entry matches (the item
	// has no defined look line) — never fabricated.
	Common::String itemLookLine(int itemId) const;

	// Handle the `walk` command. Two forms (R3.8, R2.6):
	//   * `walk <num>`     — one argument: walk to / through the room object
	//                        whose engine hotspot number is <num>. A door runs
	//                        the engine's own exitRoom() so the door animation
	//                        plays and the next room is entered (R3.8); a
	//                        non-door just walks the hero to its walk-to point.
	//   * `walk <x> <y>`   — two arguments: walk the hero to the free point
	//                        (x, y) in room coordinates.
	// Emits A11Y_ERR and keeps running on a bad target (object not in room, or
	// malformed coordinates) (R2.5). The engine's walk/door code runs its own
	// loop to completion before returning, so the command settles before the
	// next one starts (R2.2).
	void dispatchWalk(const Common::String &arg);

	// Walk to / through the room object in `slot`. If the object is a door,
	// call the engine's exitRoom(slot) so the hero walks to it the game's way
	// and the engine runs its own door animation + enterRoom() transition
	// (R3.8). Otherwise walk the hero to the object's walk-to point with the
	// engine's own walkToPoint(). Does not teleport the hero or set the room
	// number directly — the transition is always the engine's.
	void walkObject(int slot);

	// Walk the hero to a free point (x, y) in room coordinates using the
	// engine's own walkToPoint(). The point is clipped to the room's walkable
	// rectangle (_walkRect, with the hero's foot height), the same clamp the
	// engine's own free-point click path (verify1()) applies, so an off-walk
	// target lands on the nearest reachable spot rather than wandering.
	void walkPoint(int x, int y);

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
