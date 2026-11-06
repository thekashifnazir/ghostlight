# Requirements: engine a11y layer

## Introduction

The engine a11y layer is a small, readable patch to ScummVM's Drascula engine. It turns the game into something a program outside the engine can read and drive without a mouse or a screen: it prints the current room as JSON, accepts text commands from a file each frame, prints one "what changed" line after each command settles, and reports where the hero is standing. Everything the web player and the survey tools do rests on this layer.

The patch lives in a GPL-3.0-or-later ScummVM fork, kept as a readable `git diff` of `engines/drascula` under `engine/`. It builds both natively (dev and survey) and under Emscripten (the web player). It is plain enough to propose upstream later, but upstream is not a deadline goal.

Scope is the machinery: the JSON contract, the command handler, the diff, and the hero position. Turning this output into speech, parsing English, labels, hints and sonar belong to other specs.

Requirements use EARS (Easy Approach to Requirements Syntax). Terms:
- **room state**: chapter, room number, the room's objects (number, name, hotspot rectangle, walk-to point, visible flag, door flag, destination room), inventory item ids, and the 50 progress flags.
- **settle**: a command has settled when its effects are complete: walking has finished, any speech is over, and any cutscene or conversation it triggered has ended.
- **command file**: a text file at `<savepath>/a11y-cmd.txt` that the layer reads for queued commands.

## Requirements

### Requirement 1: Print room state as JSON on room entry

**User story:** As the web player, I want the engine to print the full room state as one JSON line whenever a room is entered, so that I can describe the room to the player without seeing the screen.

#### Acceptance criteria

1. WHEN a room is entered THEN the layer SHALL print one line prefixed `A11Y ` followed by a single JSON object containing the room state.
2. WHERE the room state is printed, the layer SHALL include the chapter number, the room number, the inventory item ids, and all 50 progress flags.
3. WHERE the room state lists objects, the layer SHALL include for each object its number, name, hotspot rectangle, walk-to point, visible flag, door flag, and (for a door) its destination room.
4. WHEN the game first starts THEN the layer SHALL skip the intro and print the room state for the first playable room.
5. WHEN a `dump` command is received THEN the layer SHALL print the current room state in the same `A11Y ` format as on room entry.
6. THE layer SHALL print each JSON object as a single line so that an external reader can parse it line by line.

### Requirement 2: Accept commands from a file each frame

**User story:** As the web player, I want the engine to read queued text commands from a file each frame, so that I can drive the game with no mouse.

#### Acceptance criteria

1. WHILE the game is running, the layer SHALL read the command file each frame for queued commands.
2. WHEN more than one command is queued THEN the layer SHALL run them one at a time, starting the next only after the previous has settled.
3. WHEN a command line begins with `#` THEN the layer SHALL ignore that line.
4. WHEN a command is received THEN the layer SHALL print a line prefixed `A11Y_CMD ` echoing the command.
5. WHEN a command cannot be carried out THEN the layer SHALL print a line prefixed `A11Y_ERR ` describing the problem, and SHALL continue running.
6. THE layer SHALL support these commands: `look`, `take`, `open`, `close`, `talk`, `push` on a room object; `walk` on an object or door; `use <item> <object>`; a verb or `use` targeting an inventory item; a verb or `use` targeting the hero (object 50); `inventory`; `choices`; `choose <n>`; `skip`; `save <slot>`; `state` (dump); and the low-level `verb`/`click` from the first spike.

### Requirement 3: Act on objects directly, not by clicking hotspot centres

**User story:** As the web player, I want verbs to act on the chosen object itself rather than on a pixel at the hotspot centre, so that actions are reliable when the hero stands in front of an object or hotspots overlap.

#### Acceptance criteria

1. WHEN a verb is applied to a room object THEN the layer SHALL select the object slot and run the engine's own action code (`verify2()` / `checkAction()`) for that slot, not a pixel hit test.
2. WHEN a verb is applied to a room object THEN the layer SHALL first walk the hero to the object, as the game does for a click.
3. WHERE an action is run on an object, the layer SHALL still warp the mouse to that object's hotspot so that the engine's hover name stays correct.
4. WHEN `use <item> <object>` is received THEN the layer SHALL reproduce the on-screen sequence: clear the current verb, remove the item from its slot, make it the picked object, then run the action for the target object.
5. WHEN an action settles with an item still picked up THEN the layer SHALL return that item to the inventory, as a right-click would, so that the diff shows only what was gained or used up.
6. WHEN a verb or `use` targets an inventory item THEN the layer SHALL open the inventory screen the way a right-click does, set the menu-screen state, run `checkAction()` for that item, and close the screen again.
7. WHEN a verb or `use` targets object 50 THEN the layer SHALL run the action against the hero.
8. WHEN `walk` targets a door THEN the layer SHALL call the engine's `exitRoom()` so that any door animation plays and the next room is entered.

### Requirement 4: Print one "what changed" line after each command settles

**User story:** As the web player, I want one JSON line describing what changed after each command, so that I can tell the player what their action did.

#### Acceptance criteria

1. WHEN a command settles THEN the layer SHALL print exactly one line prefixed `A11Y_DIFF ` followed by a single JSON object.
2. WHERE a diff is printed, the layer SHALL include the command that produced it.
3. WHEN the chapter or room changed THEN the diff SHALL report the change as `[from, to]`, and WHERE the room changed the diff SHALL include the new room's objects, with doors carrying their destination room.
4. WHILE the room is unchanged, WHEN objects became visible or hidden THEN the diff SHALL list them as `appeared` / `disappeared`, and WHEN a door's state changed THEN the diff SHALL report it.
5. WHEN an inventory item was gained or lost THEN the diff SHALL list it under `invAdded` / `invRemoved`.
6. WHEN a progress flag changed THEN the diff SHALL report it as `{index: [from, to]}`.
7. WHEN a character said something THEN the diff SHALL list each spoken line with its text colour under `said`.
8. WHERE nothing changed, the diff SHALL state that explicitly (`changed: false`).

### Requirement 5: Report the hero position

**User story:** As the sonar and list-mode features, I want the hero's position in the room, so that I can pan object pings relative to where the player is standing.

#### Acceptance criteria

1. WHERE the room state is printed, the layer SHALL include the hero's position as a point.
2. THE layer SHALL compute the hero point as the horizontal centre and the foot of the hero: `curX + curWidth/2` and `curY + curHeight`.
3. WHERE the hero position is reported, the layer SHALL use the same coordinate space as the objects' hotspot rectangles and walk-to points.

### Requirement 6: Subtitles and text capture

**User story:** As the web player, I want every line of on-screen text captured, so that nothing a sighted player would read is lost.

#### Acceptance criteria

1. THE layer SHALL require the game to run with subtitles on, because without them the game draws no text and no text can be captured.
2. WHEN the game draws a line of on-screen text THEN the layer SHALL print it prefixed `A11Y_TEXT `, including lines that characters speak in reply.
3. WHERE a conversation is open, the layer SHALL print the available choices prefixed `A11Y_CHOICES ` as a JSON object, both when the conversation opens and after each choice.
4. WHEN `inventory` is received THEN the layer SHALL print a line prefixed `A11Y_INV ` listing item ids, names, and the game's own "look at it" line.

### Requirement 7: Conversations, cutscenes and skipping

**User story:** As the web player, I want commands to work during conversations and cutscenes, which run their own loops, so that the player is never stuck.

#### Acceptance criteria

1. WHILE a conversation loop is running (the main loop is not reading commands), the layer SHALL list the choices and SHALL apply a `choose <n>` command by setting the same state a click on that choice would.
2. WHEN `choose 4` is received in a conversation THEN the layer SHALL end the conversation, because choice 4 always ends it.
3. WHILE a cutscene or a speech line is running (the main loop is not reading commands), the layer SHALL still read the command file from within the engine's event polling so that a queued `skip` is honoured.
4. WHEN `skip` is received THEN the layer SHALL end the current line or cutscene, as the Escape key does, one line at a time.

### Requirement 8: Clicks reach the game reliably

**User story:** As the layer, I want synthetic clicks to behave like real ones, so that actions and dialogue are not dropped or skipped.

#### Acceptance criteria

1. WHEN a synthetic click is issued THEN the layer SHALL set the button press on a frame and SHALL queue the release on a following frame, not press and release in the same frame.
2. WHILE a click is simulated, the layer SHALL NOT leave the button held down across dialogue, because a held button skips every line.

### Requirement 9: Saving

**User story:** As the survey tools, I want to save progress to a slot, so that a run can resume from a known point.

#### Acceptance criteria

1. WHEN `save <slot>` is received THEN the layer SHALL save the game to that slot and SHALL print a line prefixed `A11Y_SAVED `.
2. WHERE a save slot is given at launch, the engine SHALL load from that slot so that a run can start partway through.

### Requirement 10: Build, packaging and provenance

**User story:** As the project, I want the patch kept small, readable and correctly licensed, so that it can be reviewed, built for web, and possibly proposed upstream.

#### Acceptance criteria

1. THE patch SHALL be kept as a readable `git diff` of `engines/drascula` under `engine/`.
2. THE patch SHALL add engine behaviour in a dedicated source file (`engines/drascula/a11y.cpp`) with only small hooks in existing files (`drascula.cpp`, `converse.cpp`, `graphics.cpp`).
3. THE patch and its built wasm SHALL stay GPL-3.0-or-later.
4. THE layer SHALL build both natively and under Emscripten from the same source.
5. THE layer SHALL NOT commit game data; game data is fetched separately with checksums.
6. WHERE the engine prints a11y lines, it SHALL use the engine's own logging path (`debug`/`printErr`) so that a web page can read them via `Module.printErr`.

## Known gotchas to carry into design and tasks

These are findings from spikes 02 and 04. Each must be handled or explicitly accounted for.

1. **Subtitles must be on** (`--subtitles`), or no text is drawn and nothing comes back.
2. **Press and release must be on separate frames.** A press and release in the same frame never reaches the game.
3. **A held button skips dialogue.** Queue the release straight after the press, the way a real click works.
4. **Conversations run their own loop** (`converse()`), so the main loop does not see commands during them; a hook in that loop handles `choices` and `choose`.
5. **Cutscenes and speech run their own loops** too, but all call `updateEvents()`; the command file is polled from there so `skip` is honoured (about every 250 ms).
6. **Act on objects directly, not hotspot centres.** Clicking the hotspot centre breaks when the hero wins the hit test (chapter 2) or hotspots overlap. Pick the object slot and run the verify code for it.
7. **Inventory slots 1 to 6 are the verb icons**, not items. Real items are id 7 and up. The phone is id 28.
8. **Flag 12 flips on its own** on many actions (an animation or timing flag). It is noise; mark it so a later layer can filter it. The engine layer still reports it faithfully.
9. **The game never names inventory items on screen.** Names come from the `InventoryItems` enums in `drascula.h` (two sets: chapters 1 to 3 and 4 to 6, the latter partial); descriptions come from the "look at item" table (pseudo-room 200 in `_roomActions`).
10. **Some object names are Spanish** in the freeware data (`ESCALERA`, `HABITACIONES`, `ESCALERAS`). The engine reports them as-is; a label override belongs to the pack, not here.
11. **`talk.cpp` has no `sayText` call**, so ScummVM's own TTS does not speak character replies. `A11Y_TEXT` must capture them.
12. **Fully headless native (SDL dummy video) is flaky.** A real window works natively; the web build or a virtual display is the path for automation.
13. **The build needs the Ogg audio pack** and `--extrapath` for `drascula.dat`, or an MP3 pack triggers a blocking "missing CD audio" dialog.
