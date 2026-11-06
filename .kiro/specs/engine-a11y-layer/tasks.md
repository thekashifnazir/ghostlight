# Tasks: engine a11y layer

These tasks implement the design. Each cites the requirements it covers. Build and verify as you go (replay transcripts and unit checks per the design's testing strategy). Follow the process-log rule: log and commit after each task.

- [ ] 1. Fork and patch scaffold
  - Set up the GPL-3.0 ScummVM fork, add empty `engines/drascula/a11y.cpp` and `a11y.h`, wire them into the Drascula module build so it compiles natively and under Emscripten unchanged.
  - Confirm the build needs the Ogg audio pack and `--extrapath` for `drascula.dat`; capture the exact native and Emscripten build commands.
  - _Requirements: 10.1, 10.2, 10.4, 10.6, gotcha 13_

- [ ] 2. Startup: intro skip, subtitles guard, first room state
  - Hard-code the intro skip at startup.
  - Assert subtitles are on; if off, emit `A11Y_ERR` warning that no text will be captured.
  - Emit the first playable room's `A11Y` line.
  - _Requirements: 1.4, 6.1, gotcha 1_

- [ ] 3. Room state snapshot and `A11Y` emission
  - Build the room-state object: chapter, room, objects (num, name, rect, walkTo, visible, door, toRoom for doors), inventory (ids 7+ only), all 50 flags.
  - Add the hero point `curX + curWidth/2`, `curY + curHeight` in object coordinate space.
  - Hook room entry so the line prints on every room change; back the `dump`/`state` command with the same code.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 5.1, 5.2, 5.3, gotcha 7_

- [ ] 4. Command file reader and queue
  - Read `<savepath>/a11y-cmd.txt` each frame from the main-loop hook; split into lines; drop `#` lines and blanks; queue the rest.
  - Run one command at a time; dequeue the next only after the current settles.
  - Emit `A11Y_CMD` on receipt; emit `A11Y_ERR` and continue on any command that cannot run.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 5. Synthetic click model
  - Implement press-on-one-frame, release-on-the-next; never press and release in the same frame; never hold the button across dialogue.
  - Warp the mouse to the target object's hotspot so hover names stay correct, while the action itself runs on the object slot.
  - _Requirements: 3.3, 8.1, 8.2, gotchas 2, 3_

- [ ] 6. Verb-on-object dispatch (direct, not pixels)
  - For `look/take/open/close/talk/push <obj>`: set the verb, walk to the object, run `verify2()`/`checkAction()` for that object slot.
  - Act on the slot directly so it works when the hero wins the hit test or hotspots overlap.
  - _Requirements: 3.1, 3.2, 2.6, gotcha 6_

- [ ] 7. Doors and walking
  - `walk <obj>`: walk to the object; if it is a door, call `exitRoom(slot)` so the door animation plays and the next room is entered.
  - Confirm locked doors return their text (e.g. "I DON'T HAVE A ROOM YET") rather than erroring.
  - _Requirements: 3.8, 2.6_

- [ ] 8. Use item on object; item return
  - `use <item> <obj>`: clear the verb, `removeObject(item)`, `pickObject(item)`, run the action for the object.
  - Return a still-picked item to the inventory after the action settles, so the diff shows only net changes.
  - _Requirements: 3.4, 3.5_

- [ ] 9. Inventory-screen targets and self (object 50)
  - Verb or `use` targeting an inventory item: open the inventory screen the right-click way, set `_menuScreen`, run `checkAction(item)`, close the screen.
  - Verb or `use` targeting object 50: run the action against the hero.
  - _Requirements: 3.6, 3.7_

- [ ] 10. `inventory` listing
  - Emit `A11Y_INV` with each item's id, name (from the `InventoryItems` enums, chapters 1 to 3 and 4 to 6 sets), and the "look at it" line (pseudo-room 200 in `_roomActions`).
  - _Requirements: 6.4, gotcha 9_

- [ ] 11. Text capture
  - Hook text drawing to emit `A11Y_TEXT` for every drawn line, including character replies that `talk.cpp` does not route through TTS.
  - _Requirements: 6.2, gotcha 11_

- [ ] 12. Conversations
  - Hook the `converse()` loop to emit `A11Y_CHOICES` when the conversation opens and after each choice (text, used, which one ends it).
  - Apply `choose <n>` by setting the same click state a real choice click uses; `choose 4` ends the conversation.
  - Back the `choices` command from the same data.
  - _Requirements: 7.1, 7.2, 6.3, gotcha 4_

- [ ] 13. Cutscene/speech skipping
  - Poll the command file from `updateEvents()` so a queued `skip` is honoured while a cutscene or speech loop runs (about every 250 ms).
  - `skip` raises the engine's `kActionSkip`, ending one line or the cutscene.
  - _Requirements: 7.3, 7.4, gotcha 5_

- [ ] 14. Snapshot diff and `A11Y_DIFF` emission
  - Snapshot state before a command; compare after it settles; build one `A11Y_DIFF` with: `cmd`; `chapter`/`room` as `[from,to]` with new-room objects (doors carry `toRoom`); same-room `appeared`/`disappeared`/`doors`; `invAdded`/`invRemoved`; `flags` as `{index:[from,to]}`; `said` lines with colour; `changed:false` when nothing moved.
  - Report flag 12 faithfully but mark it as known noise for downstream.
  - Ensure a chapter-crossing `walk` (walk out, cutscene, enter next chapter) yields one coherent diff.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, gotcha 8_

- [ ] 15. Saving and loading
  - `save <slot>`: save and emit `A11Y_SAVED`.
  - Confirm `--save-slot=<n>` at launch loads from that slot so a run can start partway through.
  - _Requirements: 9.1, 9.2_

- [ ] 16. Low-level commands and parity lines
  - Keep `verb <0-6>` and `click <obj>` (click acts on the slot directly, mouse warped for hover).
  - Keep `A11Y_HOVER` and `A11Y_SAY` for parity with the spikes.
  - _Requirements: 2.6, 3.3_

- [ ] 17. Replay transcripts as regression fixtures
  - Turn the four spike command scripts (tavern, leave-tavern, ch2 handbag, ch2 vending machine) into fixtures and assert the `A11Y_DIFF` sequence, covering room entry, verbs, use-item-on-object, doors, conversations, flags and the chapter 1-to-2 crossing.
  - Run automation against the web build or a virtual display, not fully headless native SDL.
  - _Requirements: all; gotcha 12_

- [ ] 18. Unit checks for diff, click model and hero point
  - Diff: assert each field for synthetic snapshots (room change, appeared/disappeared, inv, flags, said, `changed:false`).
  - Click model: assert press/release land on separate frames and the button is not held across dialogue.
  - Hero point: assert `hero` equals `curX + curWidth/2`, `curY + curHeight` for a known pose.
  - _Requirements: 4.*, 5.2, 8.1, 8.2_

- [ ] 19. Finalise the patch
  - Regenerate the readable `git diff` of `engines/drascula` under `engine/`; confirm it adds `a11y.cpp`/`a11y.h` plus small hooks only in `drascula.cpp`, `converse.cpp`, `graphics.cpp`; confirm GPL-3.0-or-later headers; confirm no game data is committed.
  - _Requirements: 10.1, 10.2, 10.3, 10.5_
