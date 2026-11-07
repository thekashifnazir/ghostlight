# Tasks: engine a11y layer

These tasks implement the design. Each cites the requirements it covers. Our engine code lives in `engine/` (`a11y.cpp`, `a11y.h`, `hooks.patch`); `vendor/` is a pinned ScummVM checkout that is never edited by hand. Build and verify as you go: replay runs use the native build in a real window for now, not the web build. Follow the process-log rule: log and commit after each task.

- [x] 1. Fetch script: pinned ScummVM and verified game data
  - Write `scripts/fetch.sh`: clone ScummVM at a pinned commit into `vendor/`, and download the Drascula freeware data from `downloads.scummvm.org` into `vendor/`: `drascula-1.0.zip` (game) and `drascula-audio-2.0.zip` (Ogg audio).
  - Verify each download against a recorded sha256 before use; abort on mismatch.
  - Confirm `vendor/` is gitignored and game data is never committed.
  - _Requirements: 10.5, gotcha 13_

- [x] 2. Engine code layout and build script
  - Create `engine/a11y.cpp` and `engine/a11y.h` (empty scaffolds) and an empty `engine/hooks.patch` placeholder.
  - Write `scripts/build-engine.sh`: copy `engine/a11y.cpp` and `engine/a11y.h` into the pinned checkout's Drascula engine, apply `engine/hooks.patch`, and build. Never edit `vendor/` by hand; a fresh `vendor/` plus the script must reproduce the build.
  - Confirm it builds natively and under Emscripten from the same source; capture both build commands and the native real-window run command (Ogg pack, `--extrapath` for `drascula.dat`, `--subtitles`, `--savepath`).
  - _Requirements: 10.1, 10.2, 10.4, 10.6, gotcha 13_

- [x] 3. Startup: intro skip, subtitles guard, first room state
  - Hard-code the intro skip at startup.
  - Assert subtitles are on; if off, emit `A11Y_ERR` warning that no text will be captured.
  - Emit the first playable room's `A11Y` line.
  - _Requirements: 1.4, 6.1, gotcha 1_

- [x] 4. Room state snapshot and `A11Y` emission
  - Build the room-state object: chapter, room, objects (num, name, rect, walkTo, visible, door, toRoom for doors), inventory (ids 7+ only), all 50 flags.
  - Add the hero point `curX + curWidth/2`, `curY + curHeight` in object coordinate space.
  - Hook room entry so the line prints on every room change; back the `dump`/`state` command with the same code.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 5.1, 5.2, 5.3, gotcha 7_

- [x] 5. Command file reader and queue
  - Read `<savepath>/a11y-cmd.txt` each frame from the main-loop hook; split into lines; drop `#` lines and blanks; queue the rest.
  - Run one command at a time; dequeue the next only after the current settles.
  - Emit `A11Y_CMD` on receipt; emit `A11Y_ERR` and continue on any command that cannot run.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 6. Checkpoint: replay the tavern script (after reader + room state)
  - Build the native engine in a real window and run the replay harness on the tavern command script.
  - Confirm room entry emits `A11Y` with the expected objects and hero point, commands are echoed as `A11Y_CMD`, and the harness reads lines back cleanly. This is a smoke checkpoint before dispatch work.
  - _Requirements: 1.*, 2.*, 5.*, gotcha 12_

- [x] 7. Synthetic click model
  - Implement press-on-one-frame, release-on-the-next; never press and release in the same frame; never hold the button across dialogue.
  - Warp the mouse to the target object's hotspot so hover names stay correct, while the action itself runs on the object slot.
  - _Requirements: 3.3, 8.1, 8.2, gotchas 2, 3_

- [x] 8. Verb-on-object dispatch (direct, not pixels)
  - For `look/take/open/close/talk/push <obj>`: set the verb, walk to the object, run `verify2()`/`checkAction()` for that object slot.
  - Act on the slot directly so it works when the hero wins the hit test or hotspots overlap.
  - _Requirements: 3.1, 3.2, 2.6, gotcha 6_

- [x] 9. Doors and walking
  - `walk <obj>`: walk to the object; if it is a door, call `exitRoom(slot)` so the door animation plays and the next room is entered.
  - Confirm locked doors return their text (e.g. "I DON'T HAVE A ROOM YET") rather than erroring.
  - _Requirements: 3.8, 2.6_

- [x] 10. Use item on object; item return
  - `use <item> <obj>`: clear the verb, `removeObject(item)`, `pickObject(item)`, run the action for the object.
  - Return a still-picked item to the inventory after the action settles, so the diff shows only net changes.
  - _Requirements: 3.4, 3.5_

- [x] 11. Inventory-screen targets and self (object 50)
  - Verb or `use` targeting an inventory item: open the inventory screen the right-click way, set `_menuScreen`, run `checkAction(item)`, close the screen.
  - Verb or `use` targeting object 50: run the action against the hero.
  - _Requirements: 3.6, 3.7_

- [x] 12. Checkpoint: replay the tavern script (after core dispatch)
  - Run the replay harness on the tavern script against the native build.
  - Confirm verbs on objects, walking through doors, and use-on-object behave as in the spike transcript. Fix any regression before moving on.
  - _Requirements: 3.*, gotcha 12_

- [x] 13. `inventory` listing
  - Emit `A11Y_INV` with each item's id, name (from the `InventoryItems` enums, chapters 1 to 3 and 4 to 6 sets), and the "look at it" line (pseudo-room 200 in `_roomActions`).
  - _Requirements: 6.4, gotcha 9_

- [x] 14. Text capture
  - Hook text drawing to emit `A11Y_TEXT` for every drawn line, including character replies that `talk.cpp` does not route through TTS.
  - _Requirements: 6.2, gotcha 11_

- [x] 15. Conversations
  - Hook the `converse()` loop to emit `A11Y_CHOICES` when the conversation opens and after each choice (text, used, which one ends it).
  - Apply `choose <n>` by setting the same click state a real choice click uses; `choose 4` ends the conversation.
  - Back the `choices` command from the same data.
  - _Requirements: 7.1, 7.2, 6.3, gotcha 4_

- [x] 16. Cutscene/speech skipping
  - Poll the command file from `updateEvents()` so a queued `skip` is honoured while a cutscene or speech loop runs (about every 250 ms).
  - `skip` raises the engine's `kActionSkip`, ending one line or the cutscene.
  - _Requirements: 7.3, 7.4, gotcha 5_

- [x] 17. Snapshot diff and `A11Y_DIFF` emission
  - Snapshot state before a command; compare after it settles; build one `A11Y_DIFF` with: `cmd`; `chapter`/`room` as `[from,to]` with new-room objects (doors carry `toRoom`); same-room `appeared`/`disappeared`/`doors`; `invAdded`/`invRemoved`; `flags` as `{index:[from,to]}`; `said` lines with colour; `changed:false` when nothing moved.
  - Report flag 12 faithfully but mark it as known noise for downstream.
  - Ensure a chapter-crossing `walk` (walk out, cutscene, enter next chapter) yields one coherent diff.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, gotcha 8_

- [x] 18. Checkpoint: replay the tavern script (after diff)
  - Run the replay harness on the tavern script against the native build and assert the full `A11Y_DIFF` sequence matches the spike transcript.
  - Confirm conversations emit `A11Y_CHOICES`, `said` carries colours, flags appear in diffs, and the chapter 1-to-2 crossing yields one coherent diff.
  - _Requirements: 4.*, 6.3, 7.*, gotcha 12_

- [x] 19. Saving and loading
  - `save <slot>`: save and emit `A11Y_SAVED`.
  - Confirm `--save-slot=<n>` at launch loads from that slot so a run can start partway through.
  - Add `scripts/drive.sh` as the standard replay harness: launches the native build (own save path, optional `--save-slot`, `--subtitles`, `--extrapath`, Ogg pack) and WAITS ON LOG MARKERS (A11Y / A11Y_DIFF / A11Y_SAVED / A11Y_CMD) rather than fixed sleeps, under a hard 60-second cap; cleans up with `kill -9` (ScummVM ignores SIGTERM) and tracks the PID directly to avoid the `pgrep -f` self-match gotcha.
  - Chapter-2 tests load a save at the chapter-2 start via `--save-slot` instead of replaying all of chapter 1 (the ch2-handbag and ch2-vending-machine fixtures); the save is generated on demand by `scripts/make-ch2-save.sh` and never committed (a Drascula save embeds a graphics thumbnail). Chapter-1 fixtures still replay from the start.
  - _Requirements: 9.1, 9.2_

- [ ] 20. Low-level commands and parity lines _(Optional — skipped)_
  - Intentionally skipped for the chapters 1–2 demo: parity-only `verb`/`click` and `A11Y_HOVER`/`A11Y_SAY` lines are a nice-to-have, not needed to ship.
  - Keep `verb <0-6>` and `click <obj>` (click acts on the slot directly, mouse warped for hover).
  - Keep `A11Y_HOVER` and `A11Y_SAY` for parity with the spikes.
  - _Requirements: 2.6, 3.3_

- [x] 21. Replay transcripts as regression fixtures
  - Turn all four spike command scripts (tavern, leave-tavern, ch2 handbag, ch2 vending machine) into fixtures and assert the `A11Y_DIFF` sequence, covering room entry, verbs, use-item-on-object, doors, conversations, flags and the chapter 1-to-2 crossing.
  - Replay runs use the native build in a real window, not the web build.
  - _Requirements: all; gotcha 12_

- [x] 22. Property-based tests (TypeScript + fast-check)
  - Write property-based tests in TypeScript with fast-check that drive the real engine through the replay harness (native build, real window), generating random valid command sequences.
  - Assert the invariants:
    - inventory after a command equals inventory before, plus `invAdded`, minus `invRemoved`;
    - a diff's `room` (when room changed) matches the room in the next `A11Y` room-state line;
    - `changed: false` implies no other diff field moved;
    - every accepted command yields exactly one `A11Y_DIFF` or exactly one `A11Y_ERR`.
  - _Requirements: 2.2, 2.5, 4.1, 4.5, 4.8, 5.*_

- [x] 23. Cutscene over-skip guard
  - Extra `skip` commands arriving during a cutscene or speech loop (more skips than there are lines/cutscenes to end) MUST NOT leave the engine in a broken state: ignore or queue the surplus skips so that once the cutscene ends, no stray skip bleeds into the next room/line and state stays coherent.
  - Add a test that sends more `skip` commands than the crossing needs and asserts the chapter 1→2 crossing still yields exactly one coherent A11Y_DIFF (chapter [1,2], room [62,14]) and the engine remains in a valid state afterward.
  - _Requirements: 7.3, 7.4, gotcha 5_

- [x] 24. Finalise the patch
  - Regenerate `engine/hooks.patch` as a readable diff holding only the small hooks in `drascula.cpp`, `converse.cpp`, `graphics.cpp`; confirm `a11y.cpp`/`a11y.h` are the only new engine sources; confirm GPL-3.0-or-later headers; confirm no game data and no `vendor/` sources are committed.
  - Confirm a clean `scripts/fetch.sh` then `scripts/build-engine.sh` reproduces the build from `engine/` alone.
  - _Requirements: 10.1, 10.2, 10.3, 10.5_

- [ ] 25. Verifier custom agent against requirements
  - Create a verifier custom agent (in `.kiro/agents/`) that re-runs the replay fixtures and property-based tests and compares the layer's observed behaviour against each acceptance criterion in `requirements.md`.
  - Run it and record the result; file any gaps it finds as follow-up tasks.
  - _Requirements: all_
