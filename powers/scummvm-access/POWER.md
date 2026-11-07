---
name: "scummvm-access"
displayName: "ScummVM Access"
description: "Make a ScummVM point-and-click adventure playable by blind and low-vision people: an accessibility pack format and validator, the pack-writing and engine-gotchas method, and the game-as-tools MCP server for surveying a game by command."
keywords: ["scummvm", "accessibility", "a11y", "adventure game", "pack", "pack format", "screen reader", "blind", "drascula", "hotspot", "milestone", "hints", "survey", "mcp"]
author: "Ghostlight"
---

# ScummVM Access

This power packages the whole "make a ScummVM game accessible" method into one unit: the pack format (schema + validator), the prose and engine rules the method runs on, and the game-as-tools MCP server used to survey a game by command instead of by pixel.

It is engine-agnostic. The bundled schema, validator, pack-writing rules and survey loop apply to any ScummVM game; the Drascula pieces (the MCP server's command set, the engine-gotchas notes) are the first worked example and the template for the next game.

## What this power gives you

- **Pack format** — `packs/schema.json` (JSON Schema 2020-12) and `packs/FORMAT.md` describe the per-game accessibility file: names and descriptions for rooms, exits and objects, item names, text fixes, cutscene descriptions, and progress milestones with graded hints. The engine supplies live state; the pack supplies words.
- **Validator** — `packs/tools/` runs schema validation plus the cross-reference checks the schema cannot express (item `(id, chapter)` uniqueness, milestone `after` graphs with no cycles, flag ranges, referenced-id existence). No network, local files only.
- **Pack-writing rules** — `steering/pack-writing.md`: voice, position, no-spoilers, the three hint tiers, recaps and accuracy flags for every line of text in a pack.
- **Engine gotchas** — `steering/engine-gotchas.md`: the thirteen hard-won findings the Drascula a11y patch lives with, the template for what to check when adapting a new engine.
- **Game-as-tools MCP server** — `mcp.json` registers `drascula` over the **replay transport by default**, so an agent can survey the game by issuing engine commands (look, take, open, talk, walk, use, inventory, choices, choose, skip, save) and reading back parsed state, with no native build present.

## How Kiro uses this power

1. Kiro loads this `POWER.md` into context.
2. Kiro infers the task from the prompt.
3. Kiro retrieves only the steering file that matches, and uses the MCP server and validator as the task needs.

Do not load both steering files by default. Load the minimum for the task.

## When to load each steering file

- Load `steering/pack-writing.md` only when writing or reviewing the **text** in a pack: room names and descriptions, exit labels, spoken object and item names, text fixes, cutscene descriptions, recaps, or hint tiers. This is the file to read before authoring any line a player will hear.
- Load `steering/engine-gotchas.md` only when adapting a **new engine** or debugging one: wiring an accessibility layer into an engine's main loop, conversation loop or cutscene loop, deciding how to act on objects, or working out why commands or text are not coming through. It is the Drascula checklist, reusable as the shape of what a new engine's survey must answer.

Load neither for a pure validation run (just run the validator) or for a survey session that only drives the MCP server.

## Using the MCP server (survey a game)

The `drascula` server in `mcp.json` defaults to the **replay** transport (`DRASCULA_MCP_TRANSPORT=replay`), which plays recorded fixtures and needs no native build. Each verb is one tool; a call issues the command and returns the parsed room state or action diff as JSON. Use it to walk a game room by room and record what the engine reports (rooms, hotspot numbers and positions, exits and destinations, inventory ids, progress flags) — the raw material a pack turns into words.

Switch to the live game only when a native ScummVM build exists: set `DRASCULA_MCP_TRANSPORT=native` (it spawns the build under its own save path with `--subtitles`). Keep replay as the default so the survey works offline and in CI.

## Validating a pack

```sh
cd packs/tools
npm install
npm run validate -- ../../packs/<gameId>-<lang>.json
```

The validator resolves `packs/schema.json` by default (one level up from `packs/tools/`), reports every error rather than the first, and exits non-zero on any error. See `README.md` for the full walkthrough of adapting a new game.

## Available steering files

- `steering/pack-writing.md`
- `steering/engine-gotchas.md`
