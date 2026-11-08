---
name: "engine-gotchas"
description: "Adapt a new ScummVM engine to the accessibility method and survey a game by command: the thirteen Drascula engine findings as a new-engine checklist, plus the survey-write-validate loop for producing a pack. Use when wiring an accessibility layer into an engine, debugging why commands or text do not come through, or surveying a game through the drascula MCP server."
license: "Apache-2.0"
compatibility: "Adapting a ScummVM engine or surveying a game. Pairs with the bundled drascula MCP server (mcp.json) and the pack schema and validator."
metadata:
  author: "Ghostlight"
  version: "1.0.0"
---

# Engine gotchas and the survey loop

## Overview

Thirteen findings from the Drascula spikes that the accessibility patch has to live with, plus the loop for turning a game into a pack. The findings are the Drascula record, but they also read as a checklist for adapting any new engine: wiring an accessibility layer into an engine's main loop, conversation loop and cutscene loop, deciding how to act on objects, and finding out why commands or text do not come through. Each one must be handled in the patch or explicitly accounted for.

The method splits in two: the **engine** reports live state (room number, hotspot numbers and positions, exits and destinations, inventory ids, progress flags), and a per-game **accessibility pack** supplies the words. A player types plain English, their own screen reader reads back what happened, and an authored ghost gives spoiler-graded hints.

Load this skill when adapting a new engine or debugging one, or when surveying a game through the MCP server. For writing the text a player hears, use the `pack-writing` skill instead.

## Prerequisites Checklist

- [ ] You are adapting a new ScummVM engine, debugging one, or surveying a game
- [ ] The bundled `drascula` MCP server is registered (see `mcp.json` and the power README)
- [ ] For a new engine, you can read the engine's source and its accessibility layer

## The thirteen findings

1. **Subtitles must be on** (`--subtitles`), or no text is drawn and nothing comes back. The layer asserts this at startup and warns via `A11Y_ERR` if off.
2. **Press and release must be on separate frames.** A press and release in the same frame never reaches the game. The main loop reads `_leftMouseButton` once per frame and sees a single value.
3. **A held button skips dialogue.** Queue the release straight after the press, the way a real click works. Never hold the button across a dialogue line.
4. **Conversations run their own loop** (`converse()`), so the main loop does not see commands during them. A hook in that loop handles `choices` and `choose`. It is the only place those two commands can be serviced while a conversation is open.
5. **Cutscenes and speech run their own loops** too, but all call `updateEvents()`. The command file is polled from there so `skip` is honoured (throttled to about every 250 ms); non-`skip` commands wait for the main loop.
6. **Act on objects directly, not hotspot centres.** Clicking the hotspot centre breaks when the hero wins the hit test (chapter 2) or hotspots overlap. Pick the object slot and run the engine's own verify/`checkAction` code for it.
7. **Inventory slots 1 to 6 are the verb icons**, not items. Real items are id 7 and up. The phone is id 28. The room-state `inventory` and `A11Y_INV` list only real items.
8. **Flag 12 flips on its own** on many actions (an animation or timing flag). It is noise; mark it so a later layer can filter it. The engine layer still reports it faithfully, all 50 flags, verbatim.
9. **The game never names inventory items on screen.** Names come from the `InventoryItems` enums in `drascula.h` (two sets: chapters 1 to 3 and 4 to 6, the latter partial); descriptions come from the "look at item" table (pseudo-room 200 in `_roomActions`). Names and look lines are read from engine data, never fabricated.
10. **Some object names are Spanish** in the freeware data (`ESCALERA`, `HABITACIONES`, `ESCALERAS`). The engine reports them as-is; a label override belongs to the pack, not the patch.
11. **`talk.cpp` has no `sayText` call**, so ScummVM's own TTS does not speak character replies. `A11Y_TEXT` must capture them. `centerText()` is the one chokepoint every drawn line passes through.
12. **Fully headless native (SDL dummy video) is flaky.** A real window works natively; the web build or a virtual display is the path for automation. Interactive/replay checks run against a real window.
13. **The build needs the Ogg audio pack** and `--extrapath` for `drascula.dat`, or an MP3 pack triggers a blocking "missing CD audio" dialog. Launch with `--extrapath`, `--savepath` and `--subtitles`.

## Adapting a new engine

Treat the list above as the questions a new engine must answer before its pack can be trusted. For a new engine, work out, by surveying through the MCP server and reading the engine source:

- Where the main loop reads input, and how a command gets into it (the equivalent of the command file and the press/release-per-frame rule).
- Whether conversations, cutscenes and speech run their own loops, and which of them poll a shared `updateEvents()` you can hook.
- How an action is run on an object without a pixel click (the engine's own verify/check-action path).
- Where object and item names and descriptions live in engine data, and which are localised or wrong (candidates for `textFixes`).
- The one chokepoint every drawn line passes through, so spoken text can be captured.
- The launch flags the build needs (subtitles, extra data path, save path, audio pack) to run at all.

## Step-by-step: survey a game and produce a pack

### 1. Survey the game through the MCP server

The bundled `drascula` server runs over the **replay transport by default**, so an agent can drive the game by command without a native build. Each verb (`look`, `take`, `open`, `close`, `talk`, `push`, `walk`, `use`, `inventory`, `choices`, `choose`, `skip`, `save`) is one tool; a call issues the command and returns the parsed room state or action diff as JSON.

Walk the game room by room and record, for every room, exactly what the engine reports: the room number, each hotspot's number, position and type, every exit and its destination, inventory ids, and which progress flags change on which actions. That raw census is the input to the pack. For a native build of a different game, point a `native`-transport server at its binary; keep replay as the default so surveys run offline and in CI.

### 2. Learn the engine's seams

Answer the "Adapting a new engine" questions above for the target engine, in its own accessibility layer, before relying on the survey.

### 3. Write the pack

Create `packs/<gameId>-<lang>.json`, keyed on the survey. The bundled `FORMAT.md` documents every section (`game`, `pack`, `textFixes`, `chapters`, `rooms`, `items`, `cutscenes`, `milestones`) with examples. Follow the `pack-writing` skill for the prose. Key facts:

- Numeric engine ids are JSON object keys, so strings of digits (`"62"`).
- The pack keys on the engine's own per-room hotspot number, because ScummVM's `HotspotInfo` has no id.
- Progress `flags` are the engine's own variables (indices 0 to 49 for Drascula); a flag condition only means something inside one chapter when the engine resets them per chapter.
- Milestones carry exactly one of `when` (a condition) or `end: true` (chapter-finishing step), plus three hint tiers and a past-tense `recap`.

### 4. Validate

```sh
cd packs/tools
npm install
npm run validate -- ../../packs/<gameId>-<lang>.json
```

The validator runs schema validation (Ajv, JSON Schema 2020-12) plus the cross-reference checks the schema cannot express: item `(id, chapter)` uniqueness, milestone `after` ids exist with no cycles, referenced milestone ids exist, and flag indices in range. It reports every error, not just the first, exits non-zero on any error, reads local files only, and makes no network calls. It resolves the bundled `packs/schema.json` by default; pass an explicit schema path as the second argument to validate against another copy.

### 5. Check coverage (optional, when you have a census)

```sh
npm run check-coverage -- ../../packs/<gameId>-<lang>.json path/to/census.json
```

With a machine-readable census (rooms, hotspots, doors and the exit graph), `check-coverage` confirms the pack covers every census room, hotspot and door for the covered chapters, that door destinations agree, and that there are no stale entries. See `packs/tools/src/types.ts` for the `Census` type.

## Troubleshooting

### Commands or text do not come through
Walk findings 1 to 5 and 11: subtitles off, press/release in one frame, a held button, a command sent during a conversation or cutscene loop, or spoken text not captured at the one draw chokepoint are the usual causes.

### An action does not register on an object
See finding 6. Do not click the hotspot centre; pick the object slot and run the engine's own verify/`checkAction` path.

### The native build opens a "missing CD audio" dialog
See finding 13. Use the Ogg audio pack and launch with `--extrapath`, `--savepath` and `--subtitles`.
