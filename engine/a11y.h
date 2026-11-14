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
 * The hooks in drascula.cpp, converse.cpp and graphics.cpp that call this
 * layer are in hooks.patch.
 */

#ifndef DRASCULA_A11Y_H
#define DRASCULA_A11Y_H

#include "common/array.h"
#include "common/str.h"

// NUM_FLAGS (the size of DrasculaEngine::flags[]) is defined in drascula.h,
// which every translation unit that includes this header also includes. We use
// it to size the snapshot's flag array below.

// The surface the hooks in hooks.patch call into, so the patch stays a few
// lines per file and the logic lives here.

namespace Drascula {

class DrasculaEngine;
class A11yLayer;

// The a11y layer. Observes room/inventory/flag state, translates text commands
// from <savepath>/a11y-cmd.txt into the engine's own action calls, and emits
// newline-delimited A11Y* log lines via the engine's debug/printErr path.
class A11yLayer {
public:
	explicit A11yLayer(DrasculaEngine *engine);

	// Registers itself as the engine's current a11y layer so the centerText() hook
	// can reach it. It lives on the stack in runCurrentChapter(), so the
	// destructor runs on every return path.
	~A11yLayer();

	// Called once at startup (after the intro is skipped) to assert subtitles
	// are on and emit the first room state.
	void onStartup();

	// Called from the centerText() hook, the one place all spoken, narration and
	// hover text passes through whole (talk.cpp never calls sayText()). Emits
	// A11Y_TEXT, or A11Y_VTEXT while a voice sample plays. centerText() runs every
	// frame a line is on screen, so repeats of the last line are dropped.
	void onText(const char *message);
	// Called from animation_9_6() (the chapter 6 ending, after its last spoken
	// line and before the credits roll). Emits `A11Y_GAME_END` once, with the
	// ending's spoken lines; the engine runs the credits and quits on its own.
	void onGameEnd();

	// Called once per frame from the converse() loop, after the options are laid
	// out and before the cursor test. converse() runs its own modal loop, so this
	// is the only place `choices` and `choose <n>` can be serviced.
	// phrase1-4: the option strings as loaded from op_<n>.cal.
	// game1-3: per-option status; kDialogOptionClicked means already used.
	// bottom1-4: lower screen-Y edge of each option band this frame. A choice
	// is applied by putting _mouseY in its band and pressing the left button.
	void onConverseFrame(const char *phrase1, const char *phrase2,
	                     const char *phrase3, const char *phrase4,
	                     int game1, int game2, int game3,
	                     int bottom1, int bottom2, int bottom3, int bottom4);

	// Called just before and after the converse() loop. Outside a conversation
	// `choices` and `choose` are errors.
	void onConverseBegin();
	void onConverseEnd();

	// Called from the updateEvents() hook. Cutscene and speech loops run their
	// own frame pump and never return to the main loop, so this is the only
	// place a queued `skip` can be honoured while they run. Reads the command
	// file at most every 250 ms; a `skip` raises the engine's own skip action,
	// other commands wait for poll().
	void onUpdateEvents();

	// Called once per main-loop frame: reads the command file and runs at most
	// one queued command. Returns true when that command ended the chapter, so
	// the hook can return from runCurrentChapter() as verify1() does.
	bool poll();

private:
	// State taken just before a command and compared once it has settled, to
	// build its A11Y_DIFF.
	struct Snapshot {
		int chapter;
		int room;
		// Hero point at snapshot time. A hero move alone does not set `changed`.
		int heroX;
		int heroY;
		// Room objects present when the snapshot was taken. Each entry is the
		// object's engine hotspot number and whether it was visible, so the
		// after-comparison can tell appeared/disappeared within the same room.
		Common::Array<int> objNums;
		Common::Array<bool> objVisible;
		Common::Array<bool> objDoor;
		// Inventory item ids (>= 7) held at snapshot time.
		Common::Array<int> inventory;
		// All 50 progress flags, verbatim.
		int flags[NUM_FLAGS];
	};

	// Fill `snap` from the engine's live state. Reused for the before- and
	// after-snapshots; the diff is the difference between two of these.
	void takeSnapshot(Snapshot &snap) const;

	// Emits one A11Y_DIFF for `cmd`, comparing `before` with the settled state.
	// No diff is emitted if the command raised an A11Y_ERR (errCountBefore).
	void emitDiff(const Common::String &cmd, const Snapshot &before,
	              uint32 errCountBefore);

	// JSON helpers for emitDiff() and emitGameEnd(): the items in `from` that
	// are not in `other`, and the captured `said` lines as an array.
	Common::String inventoryDelta(const Common::Array<int> &from,
	                              const Common::Array<int> &other) const;
	Common::String saidJson() const;

	// A chapter-ending door destroys this layer before the next chapter's first
	// room exists, so the crossing's diff is kept in a static and emitted by the
	// next chapter's layer from onStartup().
	void stashCrossChapterDiff(const Common::String &cmd, const Snapshot &before,
	                           uint32 errCountBefore);
	bool emitPendingCrossChapterDiff();
	// The final chapter ended: emit one A11Y_GAME_END line (no next chapter).
	void emitGameEnd(const Common::String &cmd);
	// True once A11Y_GAME_END was emitted: emitted at most once, and the busy
	// watchdog stands down for the credits (a long, legitimate cutscene).
	bool _gameEnded = false;

	// JSON for one room object, shared by the room state and the diff lists.
	Common::String objectJson(int slot) const;

	// Lower-case name for a Colors value; unknown values become "color<N>".
	Common::String colorName(int color) const;

	// Starts collecting spoken lines for the command about to run.
	void beginSaidCapture();

	// Room-object slot for engine hotspot number `num`, or -1.
	int slotForObjectNum(int num) const;

	// Runs a verb on the object in `slot` the way verify2() does after a click,
	// but on the chosen slot instead of a pixel hit test, so overlapping
	// hotspots and the hero cannot steal the click. Returns true when
	// checkAction() ended the chapter.
	bool runVerbOnSlot(int verb, int slot);

	// Handles `<verb> <num>`. Returns true when the verb ended the chapter.
	bool dispatchVerb(int verbConst, const Common::String &arg);

	// Handles `use <item> [on] <obj>`. Returns true when the use ended the chapter.
	bool dispatchUse(const Common::String &arg);


	// Uses an inventory item on the object in `slot` through checkAction(), then
	// returns the item if it was not consumed.
	bool useItemOnSlot(int itemId, int slot);

	// --- Inventory-screen targets and self / object 50 --

	// Inventory slot (1-based) holding item `itemId`, or -1.
	int slotForItem(int itemId) const;

	// Runs a verb on object 50, which the engine uses for the hero (see the
	// non-menu branch of verify2()).
	void runVerbOnSelf(int verb);

	// Uses an item on the hero (object 50), returning it if not consumed.
	void useItemOnSelf(int itemId);

	// Runs a verb on an inventory item through the inventory screen's own
	// checkAction() branch, then closes the screen.
	void runVerbOnItemSlot(int verb, int itemId);

	// Uses item `itemA` on item `itemB` on the inventory screen, as clicking A
	// and then B does.
	void useItemOnItemSlot(int itemA, int itemB);

	// Opens the inventory screen as the main loop's right-click does, so
	// checkAction() takes its _menuScreen branch.
	void openInventoryScreen();

	// Close the inventory screen the way the main loop's right-click-close block
	// does: reload the room background/cursor surfaces, restore gamePalette and
	// clear _menuScreen. Paired with openInventoryScreen().
	void closeInventoryScreen();

	// Handles `inventory`: emits A11Y_INV with each real item (id >= 7), its
	// name and the game's own look line.
	void dispatchInventory();

	// Name for an inventory item, from the InventoryItems (chapters 1-3) and
	// InventoryItems2 (chapters 4-6) enums. The game stores no item names.
	// Empty when unknown.
	Common::String itemName(int itemId) const;

	// The game's look line for an item: the room 200 entry that checkAction()
	// would speak, read without speaking it. Empty when none.
	Common::String itemLookLine(int itemId) const;

	// Handles `walk <num>` (walk to an object, or through a door) and
	// `walk <x> <y>`. Returns true when a door ended the chapter.
	bool dispatchWalk(const Common::String &arg);

	// Walks to the object in `slot`. A door goes through exitRoom(), so the
	// engine plays the door and enters the next room itself. Returns
	// exitRoom()'s result.
	bool walkObject(int slot);

	// Walks to (x, y), clipped to _walkRect as verify1() does for a free click.
	void walkPoint(int x, int y);

	// Hero point: centre and foot of the hero sprite, in object coordinates.
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
	// once. A missing or empty file is normal (nothing queued).
	void readCommandFile();

	// Echoes `cmd` as A11Y_CMD and dispatches it. Returns true when it ended
	// the chapter.
	bool runCommand(const Common::String &cmd);

	// --- Cutscene / speech skipping -------

	// Pushes kActionSkip into the action buffer, as the skip key does, so the
	// running talk line or cutscene step ends through the engine's own path.
	void raiseSkip();

	// --- Saving to a slot -----------------------------------

	// Handles `save <slot>` through saveGame() and emits A11Y_SAVED. Loading
	// uses the --save-slot launch option.
	void dispatchSave(const Common::String &arg);

	// Removes the first queued `skip`, keeping the order of the rest.
	bool takeQueuedSkip();

	// Drops skips left over once a cutscene ends, both in _actionBuffer and in
	// the command queue, so they cannot skip the next room's first line.
	void dropSurplusSkips();

	// --- Conversation helpers -------------------------------------

	// Emits A11Y_CHOICES for the open conversation. Option 4 always ends it.
	void emitChoices(const char *p1, const char *p2, const char *p3, const char *p4,
	                 int game1, int game2, int game3);

	// Applies `choose <n>`: puts _mouseY in option n's band and presses the
	// left button. The converse hook releases it on the next frame.
	void applyChoose(int n);

	DrasculaEngine *_engine;

	// Last chapter and room an A11Y line was emitted for; -1 before the first.
	int _lastChapter;
	int _lastRoom;

	// Last line emitted by onText(), to drop per-frame repeats.
	Common::String _lastText;

	// Lines drawn during the current command, for the diff's `said` field.
	struct SaidLine {
		Common::String color;
		Common::String text;
		// True when a voice sample was playing as the line was drawn.
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

	// True while a command is running, so onText() adds to _said.
	bool _capturingSaid;

	// Conversation state. converse() runs its own loop, so these let the hook
	// describe it and apply `choose` without the main loop.

	// True while a converse() loop is running. The `choices`/`choose` commands
	// are only meaningful then; the main-loop reader rejects them with A11Y_ERR
	// when this is false.
	bool _converseActive;

	// Set when the next frame should emit A11Y_CHOICES: at the start, and after
	// each choice that does not end the conversation.
	bool _converseNeedChoices;

	// Option band bottoms from the last converse frame.
	int _choiceBottom[4];

	// A synthetic choice click is pressed and must be released next frame.
	// Holding it would skip the reply lines.
	bool _choicePressed;

	// Deferred diff for `choose`: emitted on the next converse frame, or in
	// onConverseEnd() for the option that ends the conversation.
	bool _choiceDiffPending;
	Common::String _choiceCmd;
	Snapshot _choiceSnapshot;
	uint32 _choiceErrCount;

	// A `talk` that opens a conversation runs converse() inside runCommand(), so
	// its diff is emitted on the first converse frame, after A11Y_CHOICES,
	// instead of when the conversation ends.
	bool _mainCmdDiffPending;
	bool _mainCmdOpenedConverse;
	Common::String _mainCmd;
	Snapshot _mainCmdSnapshot;
	uint32 _mainCmdErrCount;

	// Emits the deferred diff of the `talk` that opened the conversation.
	void emitPendingMainCmdDiff();

	// Commands read from the file, run one per frame once the previous one has
	// settled. _queueHead is the next to run.
	Common::Array<Common::String> _commandQueue;
	uint _queueHead;

	// True while runCommand() runs. A `skip` with no command in flight gets a
	// no-op diff from the skip hook, so a reader waiting for one doesn't stall.
	bool _inRunCommand;

	// Time of the last command-file read from the skip hook (250 ms throttle).
	uint32 _lastSkipPollMs;

	// True from the moment onText() emits an A11Y_VTEXT line until
	// checkVoiceEnd() sees the voice sample stop and emits A11Y_VEND.
	bool _voicePlaying;

	// Reading pause (`readpause on|off`): after a voiced line, hold long enough
	// for a screen reader to read it before the next actor speaks.
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

	// A11Y_PHASE tells a reader whether the engine is at the player's command:
	// control (free play), busy (a command or cutscene is running) or choice
	// (a conversation menu is open). Emitted only when it changes.
	enum Phase {
		kPhaseNone = 0,
		kPhaseControl,
		kPhaseBusy,
		kPhaseChoice
	};
	Phase _lastPhase;

	// Time of the last poll(). It stops advancing while a nested loop runs.
	uint32 _lastPollMs;

	// Busy watchdog: if commands are queued and the engine shows no sign of life
	// (no poll() and no output) for kWatchdogMs, stage 1 raises a skip and
	// stage 2 drops the queue with an A11Y_ERR. Long cutscenes keep it quiet
	// because they keep drawing text.
	int _watchdogStage;
	uint32 _watchdogBaseMs;

	// Walk overshoot guard: armed while our own walkToPoint() runs.
	bool _walkGuardArmed;

	// walkToPoint() with the overshoot guard armed.
	void guardedWalkToPoint(const Common::Point &target);

	// Ends a walk that has overshot the target, placing the hero as the
	// engine's own arrival does.
	void checkWalkOvershoot();

	// True once the hero has passed the stop window moveCharacters() tests on
	// this track. The engine's exact-hit test can then never fire again, so
	// the walk would loop forever (chapter 4, room 22).
	static bool walkOvershot(int chapter, int track, int heroLeft, int heroWidth,
	                         int feetY, int targetX, int targetY);

	// No sign of life for this long (ms), with commands queued, fires a
	// watchdog stage. The Von Braun cutscene pauses about 6 s per picture.
	static const uint32 kWatchdogMs = 20000;

	// Runs the busy watchdog: escalates when poll() is stale with commands queued.
	void runBusyWatchdog();

	// Watchdog decision for one frame, kept free of engine state. An open
	// conversation is never treated as a stall.
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

	// Emits control or busy for this frame. The conversation path emits choice.
	void updateControlPhase();

	// True when the main-loop poll hook was reached this frame or the previous
	// one AND the engine is not in a modal menu (!_menuScreen) AND no a11y
	// command is executing (!_inRunCommand).
	bool playerInControl() const;

};

} // namespace Drascula

#endif // DRASCULA_A11Y_H
