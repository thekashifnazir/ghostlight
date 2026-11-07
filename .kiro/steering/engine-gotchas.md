---
inclusion: manual
---

# Engine gotchas

Thirteen findings from spikes 02 and 04 that the Drascula a11y patch has to live with. Dense, situational notes — pull them in with `#engine-gotchas` when touching `engine/` (the patch, `a11y.cpp`/`a11y.h`, `hooks.patch`) or the pinned ScummVM sources under `vendor/`. Each one must be handled in the patch or explicitly accounted for.

1. **Subtitles must be on** (`--subtitles`), or no text is drawn and nothing comes back. The layer asserts this at startup and warns via `A11Y_ERR` if off.
2. **Press and release must be on separate frames.** A press and release in the same frame never reaches the game — the main loop reads `_leftMouseButton` once per frame and sees a single value.
3. **A held button skips dialogue.** Queue the release straight after the press, the way a real click works. Never hold the button across a dialogue line.
4. **Conversations run their own loop** (`converse()`), so the main loop does not see commands during them. A hook in that loop handles `choices` and `choose` — it is the only place those two commands can be serviced while a conversation is open.
5. **Cutscenes and speech run their own loops** too, but all call `updateEvents()`. The command file is polled from there so `skip` is honoured (throttled to about every 250 ms); non-`skip` commands wait for the main loop.
6. **Act on objects directly, not hotspot centres.** Clicking the hotspot centre breaks when the hero wins the hit test (chapter 2) or hotspots overlap. Pick the object slot and run the engine's own verify/`checkAction` code for it.
7. **Inventory slots 1 to 6 are the verb icons**, not items. Real items are id 7 and up. The phone is id 28. The room-state `inventory` and `A11Y_INV` list only real items.
8. **Flag 12 flips on its own** on many actions (an animation or timing flag). It is noise; mark it so a later layer can filter it. The engine layer still reports it faithfully — all 50 flags, verbatim.
9. **The game never names inventory items on screen.** Names come from the `InventoryItems` enums in `drascula.h` (two sets: chapters 1 to 3 and 4 to 6, the latter partial); descriptions come from the "look at item" table (pseudo-room 200 in `_roomActions`). Names and look lines are read from engine data, never fabricated.
10. **Some object names are Spanish** in the freeware data (`ESCALERA`, `HABITACIONES`, `ESCALERAS`). The engine reports them as-is; a label override belongs to the pack, not the patch.
11. **`talk.cpp` has no `sayText` call**, so ScummVM's own TTS does not speak character replies. `A11Y_TEXT` must capture them — `centerText()` is the one chokepoint every drawn line passes through.
12. **Fully headless native (SDL dummy video) is flaky.** A real window works natively; the web build or a virtual display is the path for automation. Interactive/replay checks run against a real window.
13. **The build needs the Ogg audio pack** and `--extrapath` for `drascula.dat`, or an MP3 pack triggers a blocking "missing CD audio" dialog. Launch with `--extrapath`, `--savepath` and `--subtitles`.
