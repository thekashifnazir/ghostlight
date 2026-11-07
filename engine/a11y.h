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

// NUM_FLAGS (the size of DrasculaEngine::flags[]) is defined in drascula.h,
// which every translation unit that includes this header also includes. We use
// it to size the snapshot's flag array below.

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

	// The engine draws on-screen text through a single chokepoint,
	// DrasculaEngine::centerText(), which every spoken line, narration line and
	// hover/examine string passes through as one whole message before it is
	// wrapped into display lines. The layer registers itself as the engine's
	// current a11y layer in the constructor and unregisters in the destructor,
	// so the centerText() hook can reach it (and safely does nothing when no
	// layer is live). The layer lives on the stack in runCurrentChapter(), so
	// the destructor fires on every return path (R6.2).
	~A11yLayer();

	// Called once at startup (after the intro is skipped) to assert subtitles
	// are on and emit the first room state.
	void onStartup();

	// Called from the DrasculaEngine::centerText() hook with the whole text
	// line the engine is about to draw: spoken dialogue, narration, system
	// messages and hover/examine text all route through centerText() (R6.2 /
	// gotcha 11 — talk.cpp never calls sayText(), so this is the only capture
	// point for character replies). Emits `A11Y_TEXT <text>` so the player's
	// screen reader reads exactly what the game draws (gotcha 10: the string is
	// the engine's own — Spanish object names or the English subtitle data,
	// whatever is loaded — never altered here).
	//
	// centerText() is called every frame for the whole time a line is on screen
	// (the talk loops in talk.cpp call it inside `do { ... } while
	// (!isTalkFinished())`), so emitting on every call would spam one line
	// hundreds of times. onText() de-duplicates against the last line it emitted
	// and only emits when the text changes, so each distinct line appears once
	// when it is drawn, not once per frame.
	void onText(const char *message);

	// Called from the DrasculaEngine::converse() loop once per frame, after the
	// four option lines have been laid out and before the engine tests the
	// cursor against them, so the layer can both describe the open conversation
	// and drive it (R7.1, R7.2, R6.3 / gotcha 4). A conversation runs its own
	// modal loop inside converse() — the main loop and poll() do not run while
	// it is open — so this is the ONLY place `choices` and `choose <n>` can be
	// serviced during a conversation.
	//
	// Arguments are the engine's own conversation data for this frame:
	//   * phrase1..phrase4 — the four option strings exactly as the engine
	//     loaded them from op_<n>.cal (already cleaned of the 0xA7 markers), so
	//     the choices are captured from the game's own data, never fabricated.
	//   * game1..game3 — the per-option selection status (kDialogOption*): an
	//     option the player has already picked in this conversation is
	//     kDialogOptionClicked, so the layer can report it as `used`. Option 4
	//     (goodbye) has no status and always ends the conversation.
	//   * bottom1..bottom4 — the screen-Y lower edge of each option's text band
	//     this frame. The engine selects option N when _mouseY falls between the
	//     previous option's bottom and option N's bottom, so to apply a
	//     `choose <n>` the layer sets _mouseY into option n's band and presses
	//     the left button — the SAME state a real click on that line produces
	//     (R7.1). The bounds change as options are struck through, so they are
	//     passed fresh every frame rather than cached.
	//
	// On the first frame of a conversation (and again after each choice runs
	// and control returns to the loop) the layer emits one `A11Y_CHOICES` line
	// (R6.3); on the frames in between it only watches the command file for a
	// `choose`/`choices` command and applies it.
	void onConverseFrame(const char *phrase1, const char *phrase2,
	                     const char *phrase3, const char *phrase4,
	                     int game1, int game2, int game3,
	                     int bottom1, int bottom2, int bottom3, int bottom4);

	// Called from converse() just before its loop begins and just after it
	// ends, so the layer knows a conversation is open. Between onConverseBegin()
	// and onConverseEnd(), a `choices`/`choose` typed to the main-loop command
	// reader is handled by the converse hook instead; outside a conversation
	// both commands are an A11Y_ERR (R2.5). onConverseEnd() also clears the
	// per-conversation state so a later conversation starts clean.
	void onConverseBegin();
	void onConverseEnd();

	// Called from the DrasculaEngine::updateEvents() hook — the engine's own
	// per-frame event pump, which every cutscene and speech loop calls while it
	// runs (talk.cpp's `do { ... } while (!isTalkFinished())` loops reach it via
	// getScan()/getAction(); animation.cpp's cutscene loops call it directly and
	// test getAction()). A cutscene or speech line runs the engine's OWN loop
	// and does NOT return to the main loop — so poll() (and its command reader)
	// never runs for the whole duration of that loop (gotcha 5). updateEvents()
	// is the one place that DOES run every frame inside those loops, so this is
	// the only hook that can honour a `skip` queued in the command file while a
	// cutscene blocks poll().
	//
	// Each call (throttled to about every 250 ms so a ~10 ms delay loop does not
	// hammer the filesystem) it reads the command file, and if a `skip` is
	// queued it consumes that one command and raises the engine's own skip input
	// — the SAME input the player's Escape/skip key produces — so the engine's
	// existing skip path fires: a talk line ends (isTalkFinished sees the
	// action/ a non-zero key and calls stopSound()), or a cutscene aborts (its
	// `getAction() == kActionSkip` test breaks the animation loop). Non-`skip`
	// commands queued meanwhile are left untouched for poll() to run once the
	// cutscene settles and control returns to the main loop.
	void onUpdateEvents();

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
	// --- Snapshot + diff (task 17, R4 / gotcha 8) ---------------------------
	//
	// A command's `A11Y_DIFF` is computed by snapshotting the game state just
	// before the command runs and comparing it to the state once the command
	// has settled. The snapshot captures only what the diff reports: chapter,
	// room, the visible room objects (by engine number), the inventory item
	// ids, and all 50 flags. It is a cheap value struct taken on the stack in
	// poll()/the converse hook; no engine state is held across frames.
	struct Snapshot {
		int chapter;
		int room;
		// Room objects present when the snapshot was taken. Each entry is the
		// object's engine hotspot number and whether it was visible, so the
		// after-comparison can tell appeared/disappeared within the same room.
		Common::Array<int> objNums;
		Common::Array<bool> objVisible;
		Common::Array<bool> objDoor;
		// Inventory item ids (>= 7) held at snapshot time (gotcha 7).
		Common::Array<int> inventory;
		// All 50 progress flags, verbatim (flag 12 included — gotcha 8).
		int flags[NUM_FLAGS];
	};

	// Fill `snap` from the engine's live state. Reused for the before- and
	// after-snapshots; the diff is the difference between two of these.
	void takeSnapshot(Snapshot &snap) const;

	// Build and emit one `A11Y_DIFF` line for command `cmd`, comparing `before`
	// (taken just before dispatch) with the engine's current (settled) state.
	// `errCountBefore` is g_errCount at dispatch start: if it has risen, the
	// command emitted an A11Y_ERR, so NO diff is emitted (exactly one diff XOR
	// at least one err per command). The `said` lines captured during the
	// command (_said) are included and then cleared. Called from poll() for
	// main-loop commands and from the converse hook for `choose`.
	void emitDiff(const Common::String &cmd, const Snapshot &before,
	              uint32 errCountBefore);

	// Build the JSON object for a single room object (by slot), in the same
	// shape buildRoomState() uses: {"num":..,"name":..,"rect":[..],"walkTo":
	// [..],"visible":..,"door":..[,"toRoom":..]}. Shared by the room-state
	// builder and the diff's objects/appeared/disappeared/doors lists so an
	// object looks identical wherever it is reported.
	Common::String objectJson(int slot) const;

	// Map a Drascula text colour (the engine's `Colors` enum value, as held in
	// _color when a line is drawn) to the lower-case colour name the design's
	// `said` field uses ("yellow", "darkgreen", ...). An unknown value yields
	// "color<N>" so the line is never dropped and the raw value is still
	// recoverable downstream.
	Common::String colorName(int color) const;

	// Begin capturing spoken/narration lines for the command about to run:
	// clears the _said buffer so the diff carries only this command's text.
	// Called at the top of a command's dispatch window (poll() and the converse
	// `choose` path); onText() appends to _said while a capture is open.
	void beginSaidCapture();

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

	// --- Cutscene / speech skipping (task 16, R7.3 / R7.4 / gotcha 5) -------

	// Raise the engine's own skip input so its existing skip path fires. `skip`
	// is modelled on the player's Escape/skip key, not a bespoke flag: we push
	// kActionSkip into the engine's action buffer with the engine's own
	// addActionToBuffer(), exactly as the keymapper does when the player presses
	// the skip key. The next getAction() call inside the running loop then
	// returns kActionSkip — a talk line ends (isTalkFinished() treats a non-None
	// action as "skip" and calls stopSound()), and a cutscene aborts (the
	// animation loop's `getAction() == kActionSkip` test breaks). One call ends
	// exactly one line / advances one cutscene step, matching R7.4 ("one line at
	// a time"). Used by both onUpdateEvents() (during a cutscene) and the
	// poll()-path `skip` command.
	void raiseSkip();

	// Scan the command queue from _queueHead for the first `skip` line, and if
	// one is present remove just that entry (keeping the order of the rest) and
	// return true. Used by onUpdateEvents() so a `skip` queued while a cutscene
	// blocks poll() is honoured immediately, while any non-`skip` commands
	// queued at the same time stay in the queue for poll() to run once the
	// cutscene settles. Returns false when no `skip` is queued.
	bool takeQueuedSkip();

	// --- Conversation helpers (task 15) -------------------------------------

	// Emit one `A11Y_CHOICES` line from the current conversation's four option
	// strings and selection statuses (R6.3). Shape (design.md):
	//   A11Y_CHOICES {"choices":[{"n":1,"text":"...","used":false},
	//                            ...,{"n":4,"text":"...","ends":true}]}
	// `used` is true for an option already picked this conversation
	// (kDialogOptionClicked); option 4 carries `ends:true` because choice 4
	// always ends the conversation (R7.2). The text is the engine's own option
	// string, emitted verbatim.
	void emitChoices(const char *p1, const char *p2, const char *p3, const char *p4,
	                 int game1, int game2, int game3);

	// Apply `choose <n>` inside a conversation (R7.1): set _mouseY into option
	// n's text band (from the most recent frame's bottoms) and press the left
	// button, exactly as a real click on that line does. The engine's own
	// converse() selection test then fires for option n this frame — running
	// talk()+response() for options 1-3, or breakOut for option 4 (R7.2). `n` is
	// 1..4; an out-of-range n emits A11Y_ERR and does nothing (R2.5). The press
	// is released on the next frame by the converse hook (R8.1).
	void applyChoose(int n);

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

	// The last text line emitted by onText(). The engine's centerText() redraws
	// the current subtitle every frame while it is on screen, so onText() is
	// called repeatedly with the same string; we emit `A11Y_TEXT` only when the
	// message differs from this, so each distinct spoken/narration/hover line
	// appears exactly once when it is drawn rather than once per frame (R6.2).
	// Empty means nothing has been emitted yet.
	Common::String _lastText;

	// --- Said capture for the diff (task 17, R4.7) --------------------------
	//
	// The lines a character said DURING the command currently running, each
	// with its on-screen text colour, in the order they were drawn. onText()
	// appends to this (in addition to emitting A11Y_TEXT) whenever a capture is
	// open; emitDiff() reads it for the diff's `said` field and clears it.
	// Captured per command so one command's diff never carries another's text.
	struct SaidLine {
		Common::String color;
		Common::String text;
	};
	Common::Array<SaidLine> _said;

	// True while a command's dispatch window is open, so onText() should append
	// the drawn line to _said. Set by beginSaidCapture() at the top of a
	// command and cleared by emitDiff() once the diff has been built. Text drawn
	// outside any command (e.g. an idle hover) is still emitted as A11Y_TEXT but
	// is not attributed to a command's `said`.
	bool _capturingSaid;

	// --- Conversation state (task 15, R7.1/R7.2/R6.3) -----------------------
	//
	// A conversation runs its own modal loop in converse() (gotcha 4), so these
	// fields let the converse-frame hook describe it and apply `choose`/`choices`
	// without the main loop. onConverseBegin() sets _converseActive; the frame
	// hook emits A11Y_CHOICES and applies queued commands; onConverseEnd() clears
	// everything.

	// True while a converse() loop is running. The `choices`/`choose` commands
	// are only meaningful then; the main-loop reader rejects them with A11Y_ERR
	// when this is false (R2.5).
	bool _converseActive;

	// True when the next onConverseFrame() should (re-)emit A11Y_CHOICES: set at
	// onConverseBegin() so the opening choices are listed, and set again after a
	// non-ending choice runs so the updated list (an option now struck through,
	// R6.3 "after each choice") is listed when control returns to the loop.
	bool _converseNeedChoices;

	// The option band bottoms (screen-Y lower edges) from the most recent
	// onConverseFrame(). applyChoose() sets _mouseY into the chosen option's
	// band using these so the engine's own selection test fires for that option
	// (R7.1). Refreshed every frame because striking an option through changes
	// the layout.
	int _choiceBottom[4];

	// Whether a synthetic conversation click is pressed and awaiting release.
	// A real choice click is a press then a release on a later frame (R8.1), so
	// applyChoose() presses on one converse frame and the next frame's hook
	// clears the button before considering the next command. kDialogOption-style
	// re-press within one frame would be dropped (gotcha 2), and a held button
	// would skip the reply lines (gotcha 3).
	bool _choicePressed;

	// --- Deferred A11Y_DIFF for a `choose` (task 17, R4) --------------------
	//
	// A conversation runs its own modal loop, so poll() does not run and cannot
	// build the diff for a `choose`. Instead the converse hook snapshots state
	// and arms said-capture just before applying the choice, then emits the
	// diff once the choice's reply has settled: for a non-ending choice that is
	// the NEXT converse frame (after the engine ran talk()+response() and
	// control returned to the loop); for the ending choice (option 4) it is
	// onConverseEnd(), since the loop exits and no further frame runs. These
	// fields carry the pending diff across that gap.
	//
	// _choiceDiffPending is true between applying a choice and emitting its
	// diff; _choiceCmd is the `choose <n>` command string for the diff's `cmd`;
	// _choiceSnapshot is the before-state; _choiceErrCount is g_errCount at
	// apply time so a choice that somehow erred emits no diff.
	bool _choiceDiffPending;
	Common::String _choiceCmd;
	Snapshot _choiceSnapshot;
	uint32 _choiceErrCount;

	// Commands waiting to run. The command file is read every frame and its
	// lines are appended here; poll() runs exactly one per frame, dequeuing the
	// next only after the current one has settled (control has returned to the
	// main loop with walking/speech/cutscene finished). _queueHead is the index
	// of the next command to run; entries before it are spent. (R2.1, R2.2)
	Common::Array<Common::String> _commandQueue;
	uint _queueHead;

	// Wall-clock time (g_system->getMillis()) of the last command-file read done
	// from the updateEvents() skip hook. A cutscene's delay loops call
	// updateEvents() every ~10 ms, so reading the command file on every call
	// would churn the filesystem hundreds of times a second. onUpdateEvents()
	// reads at most about once every 250 ms (gotcha 5 / the design's "about
	// every 250 ms"), which is well inside human skip-key cadence and keeps a
	// cutscene responsive to `skip` without the I/O storm. 0 means "never read
	// from the skip hook yet", so the first cutscene frame reads immediately.
	uint32 _lastSkipPollMs;

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
