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
class A11yLayer;

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
	// whatever is loaded — never altered here). A line drawn while a voice
	// sample is playing (soundIsActive(), i.e. a talk loop after talkInit()->
	// playFile()) is emitted as `A11Y_VTEXT <text>` instead, so the player can
	// suppress the screen-reader echo of a line the game is speaking aloud.
	//
	// centerText() is called every frame for the whole time a line is on screen
	// (the talk loops in talk.cpp call it inside `do { ... } while
	// (!isTalkFinished())`), so emitting on every call would spam one line
	// hundreds of times. onText() de-duplicates against the last line it emitted
	// and only emits when the text changes, so each distinct line appears once
	// when it is drawn, not once per frame.
	void onText(const char *message);
	// Called from animation_9_6() (the chapter 6 ending, after its last spoken
	// line and before the credits roll). Emits `A11Y_GAME_END` once, with the
	// ending's spoken lines; the engine runs the credits and quits on its own.
	void onGameEnd();

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

	// Called once per main-loop frame; reads the command file, queues any new
	// lines, and runs at most one queued command (emitting A11Y_CMD and, when a
	// handler exists, A11Y_DIFF, or A11Y_ERR when it cannot run). Also re-emits
	// the A11Y room state on a room/chapter change.
	//
	// Returns true when the command it ran this frame ENDED the chapter — a
	// `walk` through a chapter-ending door (chapter 1's door 105), whose
	// exitRoom() ran the crossing cutscene and returned true. The main-loop hook
	// relays that out as `if (_a11y.poll()) return true;`, ending
	// runCurrentChapter() exactly as the engine's own `if (verify1()) return
	// true;` does for a real door click, so run() advances to the next chapter.
	// Returns false on every other frame (the main loop keeps running).
	bool poll();

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
		// The hero point at snapshot time — curX + curWidth/2, curY + curHeight
		// (R5.2), the SAME point buildRoomState() reports, in object coordinate
		// space (R5.3). Captured so emitDiff() can compare before vs after and
		// add an optional `hero` field only when the command moved the hero
		// (task 30, R5.1). It is purely positional data for sonar panning; a
		// hero move alone does NOT set the diff's `changed` flag.
		int heroX;
		int heroY;
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

	// JSON helpers for emitDiff() and emitGameEnd(): the items in `from` that
	// are not in `other`, and the captured `said` lines as an array.
	Common::String inventoryDelta(const Common::Array<int> &from,
	                              const Common::Array<int> &other) const;
	Common::String saidJson() const;

	// --- Chapter-crossing diff carry (task 18, R4.3 / design "Settling") ----
	//
	// A `walk` through a chapter-ending door (chapter 1's door 105) runs the
	// crossing cutscene and makes exitRoom() return true. poll() relays that out
	// to end runCurrentChapter(), which TEARS DOWN this layer (it lives on the
	// runCurrentChapter() stack) before the next chapter's first room exists —
	// so the crossing's A11Y_DIFF cannot be built here. stashCrossChapterDiff()
	// copies the before-snapshot, the cmd, the error baseline and the captured
	// cutscene `said` lines into a module-static carrier (which survives the
	// layer's destruction). The NEXT chapter's layer calls
	// emitPendingCrossChapterDiff() from onStartup(), once its first room is
	// live, to emit the single coherent crossing diff (chapter [1,2], room
	// [62,14], new-room objects) instead of a plain room-state line — matching
	// the leave-tavern fixture. emitPendingCrossChapterDiff() returns true when
	// it emitted a diff (so onStartup() skips the usual room-state line).
	void stashCrossChapterDiff(const Common::String &cmd, const Snapshot &before,
	                           uint32 errCountBefore);
	bool emitPendingCrossChapterDiff();
	// The final chapter ended: emit one A11Y_GAME_END line (no next chapter).
	void emitGameEnd(const Common::String &cmd);
	// True once A11Y_GAME_END was emitted: emitted at most once, and the busy
	// watchdog stands down for the credits (a long, legitimate cutscene).
	bool _gameEnded = false;

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
	// the hero wins the hit test or hotspots overlap (gotcha 6). Returns true
	// when checkAction() ended the chapter (no item return is done then).
	bool runVerbOnSlot(int verb, int slot);

	// Parse a verb command of the form `<verb> <num>` (e.g. `look 52`): look up
	// the slot for `num`, emit A11Y_ERR if the object is not in the room (R2.5),
	// otherwise run the verb on that slot. `verbConst` is the engine's kVerb*
	// value for the a11y verb word. Returns true only when the verb ended the
	// chapter (checkAction() returned true); false for every other outcome.
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
	// Returns true only when the use ended the chapter (checkAction() true).
	bool dispatchUse(const Common::String &arg);


	// Apply inventory item `itemId` to the room object in `slot` by reproducing
	// the engine's own "click a room object while holding an item" path (R3.4),
	// then return the item to the inventory if the use did not consume it
	// (R3.5). Runs the GAME'S OWN room-action handler (checkAction), so applying
	// uses behave exactly as a mouse would, and a non-applying use leaves the
	// item safely back in inventory rather than lost. Returns true when
	// checkAction() ended the chapter (no item return is done then).
	bool useItemOnSlot(int itemId, int slot);

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
	//
	// Returns true when the walk went through a chapter-ending door (exitRoom()
	// returned true), so runCommand()/poll() can end the chapter; false for a
	// free-point walk, a non-door object, a non-chapter-ending door, or an error.
	bool dispatchWalk(const Common::String &arg);

	// Walk to / through the room object in `slot`. If the object is a door,
	// call the engine's exitRoom(slot) so the hero walks to it the game's way
	// and the engine runs its own door animation + enterRoom() transition
	// (R3.8). Otherwise walk the hero to the object's walk-to point with the
	// engine's own walkToPoint(). Does not teleport the hero or set the room
	// number directly — the transition is always the engine's.
	//
	// Returns the boolean exitRoom() gives for a door: true when the door ENDED
	// the chapter (chapter 1's door 105 runs animation_2_1() and returns true),
	// which must be relayed up so runCurrentChapter() returns and run() advances
	// to the next chapter — mirroring the engine's own `if (exitRoom(l)) return
	// true;` in verify1(). A non-door walk returns false.
	bool walkObject(int slot);

	// Walk the hero to a free point (x, y) in room coordinates using the
	// engine's own walkToPoint(). The point is clipped to the room's walkable
	// rectangle (_walkRect, with the hero's foot height), the same clamp the
	// engine's own free-point click path (verify1()) applies, so an off-walk
	// target lands on the nearest reachable spot rather than wandering.
	void walkPoint(int x, int y);

	// The hero point: horizontal centre and foot of the hero sprite —
	// curX + curWidth/2, curY + curHeight (R5.2) — in the same coordinate
	// space as object rects and walk-to points (R5.3). Factored into one place
	// so buildRoomState() (the A11Y room-state line), takeSnapshot() (the diff
	// before/after) and the diff's optional `hero` field all use the exact same
	// point and can never drift (task 30). Sonar pans object pings relative to
	// this point (R5), so the diff reports the NEW hero point after a command
	// that moved the hero.
	int heroX() const;
	int heroY() const;

	// Build the full room-state JSON object (chapter, room, hero point,
	// objects, inventory, flags) as a single line. Shared by room entry and
	// the `dump`/`state` command so both emit identical state.
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
	//
	// Returns true when the command ended the chapter — a `walk` through a
	// chapter-ending door whose exitRoom() returned true (relayed up from
	// dispatchWalk/walkObject). Every other command returns false. poll() uses
	// this to know when to end runCurrentChapter().
	bool runCommand(const Common::String &cmd);

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

	// --- Saving to a slot (task 19, R9.1) -----------------------------------

	// Handle the `save <slot>` command: save the game to the numbered slot
	// through the engine's own saveGame() (the same call the F10 save screen
	// makes) and emit one `A11Y_SAVED ` line carrying the slot, chapter and
	// room (R9.1). The slot is a plain 1-based integer, matching the engine's
	// on-disk slot numbering and the `--save-slot=<n>` launch option that loads
	// it back (R9.2) — so `save 1` and `--save-slot=1` name the same file. A
	// missing, non-numeric or < 1 slot is an A11Y_ERR that keeps the layer
	// running (R2.5). There is no `load` command: a run resumes partway through
	// by launching with --save-slot, which is the engine's own launcher path,
	// not an in-game command.
	void dispatchSave(const Common::String &arg);

	// Scan the command queue from _queueHead for the first `skip` line, and if
	// one is present remove just that entry (keeping the order of the rest) and
	// return true. Used by onUpdateEvents() so a `skip` queued while a cutscene
	// blocks poll() is honoured immediately, while any non-`skip` commands
	// queued at the same time stay in the queue for poll() to run once the
	// cutscene settles. Returns false when no `skip` is queued.
	bool takeQueuedSkip();

	// --- Cutscene over-skip guard (task 23, R7.3 / R7.4 / gotcha 5) ---------
	//
	// Drop every `skip` the player queued beyond what the cutscene/speech loop
	// actually consumed, so a burst of extra skips cannot bleed past the
	// cutscene into the next room or line. Two leftovers can exist once a
	// blocking loop ends:
	//   1. `skip` ACTIONS already pushed into the engine's own _actionBuffer by
	//      raiseSkip() that the loop never drained (it ended first). The next
	//      getAction() in the new room would otherwise return kActionSkip and
	//      skip that room's first line. We discard them by resetting the
	//      engine's action-buffer indices (we are a friend of DrasculaEngine),
	//      which drops ONLY the queued input — it runs no engine logic and is
	//      the same net state as the buffer having drained naturally.
	//   2. `skip` COMMANDS still sitting unread in _commandQueue (the player
	//      queued more than the cutscene needed). poll() would run each as a
	//      main-loop `skip` in the new room, raising a fresh kActionSkip there.
	//      We remove every queued `skip` from _queueHead onward, keeping any
	//      non-`skip` command's order intact so legitimate follow-up commands
	//      still run.
	// Non-`skip` state is never touched. Called when a chapter-crossing cutscene
	// has just ended (the crossing path in poll()) and defensively at a fresh
	// chapter start (onStartup()), so no stray skip survives the transition.
	void dropSurplusSkips();

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
		// True when a voice sample was playing (soundIsActive()) as this line
		// was drawn, i.e. the game is speaking the line aloud. onText() sets it
		// and emits the line as A11Y_VTEXT; the diff's `said` carries it so the
		// player can suppress the screen-reader echo of a voiced line.
		bool voiced = false;
	};
	Common::Array<SaidLine> _said;

	// The carrier stashCrossChapterDiff() fills and the next chapter's layer
	// reads. One per process, reached through crossCarry(); it outlives the
	// layer that filled it.
	struct CrossCarry {
		bool pending = false;
		Common::String cmd;
		uint32 errCountBefore = 0;
		Snapshot before;
		Common::Array<SaidLine> said;
	};
	static CrossCarry &crossCarry();

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

	// --- Conversation-opening talk diff (task 29, R4.1 / R7.1 / R6.3) -------
	//
	// A `talk <npc>` that opens a conversation runs converse()'s modal loop to
	// completion INSIDE runCommand(), so if poll() emitted the talk's A11Y_DIFF
	// after runCommand() returned, the player would hear nothing back for the
	// talk until the whole conversation had ended. Instead the talk's diff is
	// emitted at the moment the choices first appear — the same opening frame
	// onConverseFrame() emits the first A11Y_CHOICES — so the wire order is
	// A11Y_CMD talk, then A11Y_CHOICES, then A11Y_DIFF talk, before any `choose`.
	//
	// poll()'s `before`/`errCountBefore`/`cmd` locals are NOT visible to the
	// converse hook (converse() runs nested inside runCommand(), below poll()'s
	// frame), so poll() copies them here before calling runCommand(). When a
	// conversation OPENS during that command (onConverseBegin sets
	// _mainCmdOpenedConverse), the opening onConverseFrame emits the main
	// command's diff from these fields and clears _mainCmdDiffPending so it
	// fires exactly once. Back in poll(), if the flag was cleared the converse
	// hook already emitted the diff, so poll() SKIPS its own emitDiff for this
	// command — the talk yields exactly one diff (at choices-open), none at
	// conversation end. A talk that does NOT open a conversation (it erred, or
	// the NPC has no dialogue) leaves the flag set, so poll() emits as usual.
	//
	// _mainCmdDiffPending is armed in poll() before every main-loop command and
	// consumed either by the converse hook (conversation opened) or by poll()
	// itself (no conversation). _mainCmdOpenedConverse records that a converse()
	// opened during the current command, so the opening frame knows to flush the
	// main command's diff rather than wait. These are distinct from the
	// _choice* deferral above: that handles each `choose <n>`'s own diff; this
	// handles the `talk` that opened the conversation.
	bool _mainCmdDiffPending;
	bool _mainCmdOpenedConverse;
	Common::String _mainCmd;
	Snapshot _mainCmdSnapshot;
	uint32 _mainCmdErrCount;

	// Emit the pending main-loop command's A11Y_DIFF (a `talk` that opened a
	// conversation) from the stored before-snapshot/cmd/errCount, then clear
	// _mainCmdDiffPending so it fires exactly once (R4.1). Called from the
	// opening onConverseFrame once the choices are laid out. No-op if no main
	// diff is pending.
	void emitPendingMainCmdDiff();

	// Commands waiting to run. The command file is read every frame and its
	// lines are appended here; poll() runs exactly one per frame, dequeuing the
	// next only after the current one has settled (control has returned to the
	// main loop with walking/speech/cutscene finished). _queueHead is the index
	// of the next command to run; entries before it are spent. (R2.1, R2.2)
	Common::Array<Common::String> _commandQueue;
	uint _queueHead;

	// True only while poll() is running a command through runCommand() — i.e.
	// while a command's own walk/speech/cutscene loops may be blocking the main
	// loop. The skip hook (onUpdateEvents) reads this to tell apart the two
	// kinds of `skip` it drains: a `skip` taken while a command is in flight is
	// advancing that command's cutscene/speech (its diff covers it), but a
	// `skip` taken with no command in flight has nothing to skip — the main loop
	// is idle — so the hook emits the no-op diff `A11Y_DIFF {"cmd":"skip",
	// "changed":false}` itself. Without that line an external reader (the MCP
	// native transport) waits its full timeout for a settle that never comes.
	bool _inRunCommand;

	// Wall-clock time (g_system->getMillis()) of the last command-file read done
	// from the updateEvents() skip hook. A cutscene's delay loops call
	// updateEvents() every ~10 ms, so reading the command file on every call
	// would churn the filesystem hundreds of times a second. onUpdateEvents()
	// reads at most about once every 250 ms (gotcha 5 / the design's "about
	// every 250 ms"), which is well inside human skip-key cadence and keeps a
	// cutscene responsive to `skip` without the I/O storm. 0 means "never read
	// from the skip hook yet", so the first cutscene frame reads immediately.
	uint32 _lastSkipPollMs;

	// True from the moment onText() emits an A11Y_VTEXT line until
	// checkVoiceEnd() sees the voice sample stop and emits A11Y_VEND.
	bool _voicePlaying;

	// Reading pause (`readpause on` / `readpause off`, default off). When on,
	// checkVoiceEnd() holds the engine after a voiced clip ends, for an
	// estimated reading time of the line just spoken, so the player's screen
	// reader can finish it before the next actor starts.
	bool _readPause;

	// True while holdForReading() runs, so the updateEvents() hook it pumps
	// cannot start a second hold.
	bool _inHold;

	// Length in characters of the last voiced line drawn (set by onText()).
	uint _voiceLen;

	// Count of command-file lines read so far. The hold compares it to see
	// whether a new line arrived while it waited.
	uint _cmdLinesRead;

	// Emits one A11Y_VEND if a voiced clip was playing and has now stopped.
	// Called every frame from poll() and onUpdateEvents().
	void checkVoiceEnd();

	// Holds the engine for the reading time of the last voiced line, keeping
	// events and the screen pumped. Ends early on a key or mouse event, a new
	// command-file line, or quit. Emits A11Y_VHOLD <ms> when it starts.
	void holdForReading();

	// Applies the argument of `readpause`: "on" or "off". Emits A11Y_ERR for
	// anything else and returns false.
	bool applyReadPause(const Common::String &arg);

	// Removes every queued `readpause` line from _queueHead onward and applies
	// it, so it is honoured while a talk, cutscene or conversation loop blocks
	// poll(). Returns true if one was taken.
	bool takeQueuedReadPause();

	// --- Engine-truth control phase (A11Y_PHASE) ----------------------------
	//
	// A single line, `A11Y_PHASE <control|busy|choice>`, tells an external
	// reader whether the engine is at the player's command or still working,
	// straight from the engine rather than inferred from the gaps between text
	// lines. The player's readiness signal (src/engine/status.ts) is driven by
	// this instead of guessing a conversation has ended from a pause.
	//
	//   control — the engine is idle in free play and able to take a command
	//             this frame: playerInControl() is true. There is no reliable
	//             engine-wide API for this (canSaveGameStateCurrently() is not
	//             it, and Drascula's _canSaveLoad is only true inside two narrow
	//             windows of the main loop), so the test is Drascula's own.
	//   busy    — a command is running, a cutscene/speech loop has taken over the
	//             main loop (so poll stops being reached), or the engine is
	//             otherwise not ready.
	//   choice  — a conversation choice menu is open and waiting for the player.
	//             Emitted from the converse path (emitChoices), because the
	//             conversation runs its own modal loop and poll() does not run
	//             while it is open (gotcha 4).
	//
	// The phase is emitted only when it CHANGES (plus once after boot), so a
	// per-frame poll() adds at most one cheap check and a compare, never a
	// line per frame. _lastPhase is the last value emitted; kPhaseNone (the
	// initial value) forces the first real phase to be emitted so a reader
	// always sees an initial A11Y_PHASE.
	enum Phase {
		kPhaseNone = 0,
		kPhaseControl,
		kPhaseBusy,
		kPhaseChoice
	};
	Phase _lastPhase;

	// Milliseconds (g_system->getMillis()) at the top of the last poll() call.
	// poll() is the main loop's per-frame a11y hook; a talk/cutscene/room-
	// transition loop runs the engine's OWN frame pump and never returns to the
	// main loop, so poll() (and this stamp) stop advancing for the whole of that
	// loop. playerInControl() compares this against the
	// current time: a poll within the last frame or two means the main loop is
	// live (free play); a stale stamp means a nested loop has taken over, so the
	// phase reads `busy`. 0 means poll() has not run yet.
	uint32 _lastPollMs;

	// --- Busy watchdog (Fix C: A11Y_PHASE busy can never be permanent) ------
	//
	// A command can leave the engine wedged so that poll() never runs again
	// (the observed permanent-busy dead state: a conversation reply consumed a
	// stale skip and animation_16_2 never handed control back to the main
	// loop). Without a watchdog A11Y_PHASE would then read `busy` forever and no
	// queued command would ever settle. onUpdateEvents() — which keeps running
	// inside the blocking loop — watches for this: when commands are queued but
	// the engine has shown no sign of life for kWatchdogMs — NEITHER a poll()
	// (main loop live) NOR any emitted a11y line (a cutscene still drawing) — it
	// escalates in two stages. Liveness is max(_lastPollMs, g_lastEngineOutputMs),
	// so a legitimate slow cutscene (animation_16_2 draws a Von Braun-history
	// picture about every 6 s with no poll()) keeps the watchdog quiet via its
	// A11Y_TEXT/said output, and only a genuinely silent stall trips it.
	//
	// Stage 1 (after kWatchdogMs) is SILENT to the player: it emits only
	// `A11Y_ERR busy-skip` (a log-only diagnostic the page maps to NO
	// announcement) and raises one skip to try to free the loop. Stage 2 (after
	// another kWatchdogMs still stuck) drops the surplus skips, clears the queue
	// and emits `A11Y_ERR busy: commands dropped`, which the page announces as
	// "The game didn't respond. Press L to hear where you are." So the player
	// hears nothing on a stall the skip clears, and one clear line only if the
	// queue had to be dropped.
	//
	// _watchdogStage is 0 when not stuck, 1 after the stage-1 skip, 2 after the
	// stage-2 drop; it resets to 0 whenever the engine shows life (poll() runs
	// or a line is emitted) or the queue drains, so a later genuine stall is
	// caught fresh. _watchdogBaseMs is the liveness stamp the current stall is
	// measured from, captured when the watchdog first sees a queued command with
	// a stale liveness stamp, so the two windows are measured from a stable
	// origin rather than drifting with each check.
	int _watchdogStage;
	uint32 _watchdogBaseMs;

	// Walk overshoot guard (ch4 room 22 hang, 10 Nov). True only while one of
	// this layer's own walkToPoint() calls is running (see guardedWalkToPoint).
	// While armed, onUpdateEvents() checks every frame whether the hero has
	// already walked PAST the engine's stop window on the axis the engine tests
	// (see walkOvershot). Past that window the engine's exact-hit stop test in
	// moveCharacters() can never fire again, so walkToPoint() would loop
	// forever; the guard ends that walk the way the engine's own arrival does.
	bool _walkGuardArmed;

	// Run the engine's own walkToPoint(target) with the overshoot guard armed.
	// Every a11y walk that blocks on walkToPoint() goes through this. A walk
	// that stops normally is unchanged: the guard only acts once the walk can
	// no longer stop by itself.
	void guardedWalkToPoint(const Common::Point &target);

	// Called from onUpdateEvents() each frame. If the guard is armed and the
	// running walk has overshot, end it: place the hero on the target point
	// (the same placement the engine's own track-1 arrival does in
	// moveCharacters()) and clear _characterMoved so walkToPoint() returns.
	void checkWalkOvershoot();

	// Pure overshoot test, kept free of engine state (like watchdogDecision)
	// and ported line for line in tests/engine/walk-overshoot.test.ts. Mirrors
	// the stop windows in moveCharacters() (actors.cpp):
	//   track 0 (left):  stop while (chapter 2: left edge, else centre) is in
	//                    [targetX - (STEP_X-1), targetX]; overshot if below it.
	//   track 1 (right): stop while (chapter 2: right edge, else centre) is in
	//                    [targetX, targetX + (STEP_X-1)]; overshot if above it.
	//   track 2 (up):    stop while feet in [targetY - (STEP_Y-1), targetY];
	//                    overshot if above it (smaller y).
	//   track 3 (down):  stop while feet in [targetY, targetY + (STEP_Y-1)];
	//                    overshot if below it (larger y).
	// startWalking() always picks the direction toward the target, and each
	// step moves the tested coordinate monotonically toward and then past it,
	// so once overshot the engine's test can never pass again.
	static bool walkOvershot(int chapter, int track, int heroLeft, int heroWidth,
	                         int feetY, int targetX, int targetY);

	// How long (ms) the engine may show no sign of life (no poll(), no emitted
	// line) with commands queued before each watchdog stage fires. 20 s per the
	// Fix C tuning: long enough never to trip on the legitimate long Von Braun
	// history cutscene (animation_16_2 pauses ~6 s per picture), short enough
	// that a true dead state is reported and cleared within a handful of frames.
	static const uint32 kWatchdogMs = 20000;

	// Run the busy watchdog from onUpdateEvents(): detect a stalled poll() with
	// commands still queued and escalate (warn + raiseSkip, then drop + clear).
	// A no-op when poll() is fresh or nothing is queued. Fix C.
	void runBusyWatchdog();

	// What the busy watchdog should do this frame, factored out as a pure
	// decision so it can be unit-tested without a running engine. Returns:
	//   kWatchdogNoop     — do nothing (and reset the escalation)
	//   kWatchdogHold     — stall is building but no stage fires yet (keep stage)
	//   kWatchdogStage1   — emit busy-skip + raiseSkip, go to stage 1
	//   kWatchdogStage2   — drop the queue + emit busy, go to stage 2
	// Inputs are exactly what runBusyWatchdog() reads: whether a conversation is
	// open (converseActive), whether a command is queued (queued), the liveness
	// stamp and the current time (so age = now - liveness), the last poll() stamp
	// and the current stage/anchor. Keeping it pure means the tester's reply-menu
	// case (converseActive true, stale liveness, a `choose` queued) can be
	// asserted directly as kWatchdogNoop. Fix (reply-menu drop).
	enum WatchdogAction {
		kWatchdogNoop,
		kWatchdogHold,
		kWatchdogStage1,
		kWatchdogStage2
	};
	static WatchdogAction watchdogDecision(bool converseActive, bool queued,
	                                       uint32 liveness, uint32 lastPollMs,
	                                       uint32 now, int stage, uint32 baseMs);

	// Emit `A11Y_PHASE <name>` if `phase` differs from the last one emitted,
	// and remember it. Cheap: a compare and, on a change only, one emitLine().
	void emitPhase(Phase phase);

	// Compute and emit the control/busy phase for this frame: control when
	// playerInControl() is true, busy otherwise. Called once per poll() frame
	// (and once at boot). Not called while a conversation is open — that path
	// emits `choice`.
	void updateControlPhase();

	// True when the main-loop poll hook was reached this frame or the previous
	// one AND the engine is not in a modal menu (!_menuScreen) AND no a11y
	// command is executing (!_inRunCommand).
	bool playerInControl() const;

};

} // namespace Drascula

#endif // DRASCULA_A11Y_H
