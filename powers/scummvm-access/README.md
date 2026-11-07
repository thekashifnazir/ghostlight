# ScummVM Access power

Make a ScummVM point-and-click adventure playable by blind and low-vision people, using the method Ghostlight built for *Drascula: The Vampire Strikes Back*.

The idea is a split: the **engine** reports live state (which room you are in, the hotspot numbers and positions, inventory ids, progress flags), and a per-game **accessibility pack** supplies the words (names and descriptions for rooms, exits and objects, item names, text fixes, cutscene descriptions, and progress milestones with graded hints). A player types plain English, their own screen reader reads back what happened, and an authored ghost gives spoiler-graded hints that know where they are stuck.

This power bundles everything needed to produce that pack for a new game.

## What is in the box

```
POWER.md                 manifest + when-to-load rules
README.md                this file
mcp.json                 registers the drascula game-as-tools MCP server (replay transport by default)
steering/
  pack-writing.md        rules for every line of text a player hears
  engine-gotchas.md      the Drascula engine findings, reusable as a new-engine checklist
packs/
  FORMAT.md              the pack format, field by field, with examples
  schema.json            JSON Schema 2020-12 for the pack
  tools/                 the validator (validate + check-coverage), MIT, no network
```

The MCP server itself lives in the Ghostlight repo under `mcp/` and is referenced, not copied; the pack validator and format are copied in so the power is self-contained for authoring and validation.

## Make another ScummVM game accessible

The pack format, validator, pack-writing rules and survey loop are engine-agnostic. The Drascula pieces are the worked example. To adapt a new game:

### 1. Survey the game through the MCP server

The `drascula` server in `mcp.json` runs over the **replay transport by default**, so an agent can drive the game by command without a native build. Each verb (`look`, `take`, `open`, `close`, `talk`, `push`, `walk`, `use`, `inventory`, `choices`, `choose`, `skip`, `save`) is one tool; a call issues the command and returns the parsed room state or action diff as JSON.

Walk the game room by room and record, for every room, exactly what the engine reports: the room number, each hotspot's number, position and type, every exit and its destination, inventory ids, and which progress flags change on which actions. That raw census is the input to the pack. (For a native build of a different game, point a `native`-transport server at its binary; keep replay as the default so surveys run offline and in CI.)

### 2. Learn the engine's seams

Read `steering/engine-gotchas.md`. The thirteen Drascula findings double as the questions a new engine must answer before its pack can be trusted: where the main loop reads input, whether conversations and cutscenes run their own loops, how to act on an object without a pixel click, where names and descriptions live in engine data (and which are localised or wrong), the one chokepoint every drawn line passes through, and which launch flags the build needs. Answer those for the new engine, in its own accessibility layer, before relying on the survey.

### 3. Write the pack

Create `packs/<gameId>-<lang>.json`, keyed on the survey. `FORMAT.md` documents every section (`game`, `pack`, `textFixes`, `chapters`, `rooms`, `items`, `cutscenes`, `milestones`) with examples. Follow `steering/pack-writing.md` for the prose: plain short sentences, no em dashes, screen-relative positions (left, middle, right), descriptions that never solve puzzles, and milestone hints in three tiers (nudge, clue, answer) written fresh, never copied from a walkthrough.

Key facts from the format:

- Numeric engine ids are JSON object keys, so strings of digits (`"62"`).
- The pack keys on the engine's own per-room hotspot number, because ScummVM's `HotspotInfo` has no id.
- Progress `flags` are the engine's own variables (indices 0 to 49 for Drascula); a flag condition only means something inside one chapter when the engine resets them per chapter.
- Milestones carry exactly one of `when` (a condition) or `end: true` (chapter-finishing step), plus three hint tiers and a past-tense `recap`.

### 4. Validate

```sh
cd packs/tools
npm install
npm run validate -- ../../../path/to/packs/<gameId>-<lang>.json
```

The validator runs schema validation (Ajv, JSON Schema 2020-12) plus the cross-reference checks the schema cannot express: item `(id, chapter)` uniqueness, milestone `after` ids exist with no cycles, referenced milestone ids exist, and flag indices in range. It reports every error, not just the first, and exits non-zero on any error. It reads local files only and makes no network calls.

By default the validator resolves the schema bundled here (`packs/schema.json`). Pass an explicit schema path as the second argument to validate against another copy.

### 5. Check coverage (optional, when you have a census)

If you build a machine-readable census of the game (rooms, hotspots, doors and the exit graph), `check-coverage` confirms the pack covers every census room, hotspot and door for the covered chapters, that door destinations agree, and that there are no stale entries:

```sh
npm run check-coverage -- ../../../path/to/packs/<gameId>-<lang>.json ../../../path/to/census.json
```

The census format is the coverage ground truth; for Drascula it lives in the Ghostlight repo. A new game supplies its own census in the same shape (see `packs/tools/src/types.ts` for the `Census` type).

## Licensing

The pack format, validator and this power are MIT. A ScummVM engine patch that adds the accessibility layer is a modification of GPL code and stays GPL-3.0-or-later; it is not part of this power. Game data is never bundled.
