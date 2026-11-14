# The thirteen findings, answered for Flight of the Amazon Queen

Second worked answer to the checklist in `SKILL.md`. Source reads from `reference/game2-queen-brief.md` section 2, then what the first native runs measured (`docs/kiro-process.md` entries 150 to 152). Queen has no chapters: report `chapter: 1` and pack `coverage.chapters: [1]`.

## The thirteen, for Queen

1. **Subtitles.** Easier. Queen defaults them on and forces them on when speech is off. The speak hook sits before the draw, so capture does not depend on them. Still pass `--subtitles`.
2. **Press and release.** Different. `Input::delay` latches button-down only (no button-up case), so one pushed down event is enough. Move the cursor first: selection reads the mouse position.
3. **Held button.** Different hazard: a right click while a dialogue runs ends the conversation. Never send a right click outside idle. Line skip is its own action (`kActionSkipText`).
4. **Conversations.** Same shape, easier hook. The choice menu is a nested loop that calls `QueenEngine::update()`, so one hook there services `choices` and `choose`. `choose n` pushes the digit action; `n` is the visible order.
5. **Cutscenes and speech.** Same. Walks, talk and cutaways all pump `update()`. Drain `skip` there, throttled.
6. **Acting on objects.** Milder. Selection goes through the grid by cursor position. Plan: verb key, then click the box centre, refusing with `A11Y_ERR` when the point does not hit the target.
7. **Inventory slots.** Different. Verbs are panel zones, not item ids; items are 1 to 100 and only 4 are visible, so `use I N` scrolls the item into view first. Item 2 (the journal) is the save and load UI: leave it out of `A11Y_INV`.
8. **Noise flag.** Unknown. Object `state` bit-fields (direction, default verb) change on actions and need filtering. The hatch in room 1 is not a flag: it shows as a door change (`doors` in the diff).
9. **Item names.** Easier. Names and looks are data (`ItemData::name`, `objectTextualDescription`).
10. **Foreign names.** Not applicable (English floppy). The gap is room names: they are file codes (`C1`), and 61 of 126 rooms share names.
11. **No TTS call.** Same. `Talk::speak` is the one chokepoint, and it knows the speaker.
12. **Headless.** Same. Use a real window.
13. **Data files.** Easier. The English floppy has one data file (`queen.1`) and a hardcoded table: no `--extrapath`.

## Measured in the first native runs

- **First playable room is 70, not 1.** Joe's hotel room. Rooms 1 to 5 (the plane and the river) come later in the story. A fresh start takes about 9 minutes to reach it through the intro (the MCP gives Queen a 15 minute start cap for this).
- **Commands are pushed events.** `Command::_state` and `grabSelectedNoun` are private, so verbs go in as verb key, mouse move and click. Each click point is checked with `findZoneForPos` and `findObjectNumber` so it cannot land on a neighbour.
- **Skip is refused in a menu.** In the choice phase `skip` acts as the right click that ends the conversation and produced a second diff. It now returns one `A11Y_ERR` and the menu stays open. Use `choose`.
- **Busy drops are not echoed.** A command sent while the engine is busy is dropped without an `A11Y_CMD` echo, so wait for the phase to return to control before sending, and treat silence as a drop, not a stall.
- **One line per command holds.** Exactly one `A11Y_DIFF` or at least one `A11Y_ERR` per command is an engine-independent test; the player's own `parseA11yLine` read Queen output unchanged.
- **Survey jump.** `room N` works only with `GHOSTLIGHT_SURVEY=1` in the engine's environment, and refuses rooms 7 and 95 and rooms whose files are missing. The `queen` server entry sets it; the MCP `room` tool sends it.
- **Transport.** Lines go out through `logMessage(kError, ...)`, which lands on stderr; the native transport already reads stderr as well as stdout.
