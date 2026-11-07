# ScummVM Access plugin

Make a ScummVM point-and-click adventure playable by blind and low-vision people, using the method Ghostlight built for *Drascula: The Vampire Strikes Back*.

The idea is a split: the **engine** reports live state (which room you are in, the hotspot numbers and positions, inventory ids, progress flags), and a per-game **accessibility pack** supplies the words (names and descriptions for rooms, exits and objects, item names, text fixes, cutscene descriptions, and progress milestones with graded hints). A player types plain English, their own screen reader reads back what happened, and an authored ghost gives spoiler-graded hints that know where they are stuck.

This plugin bundles everything needed to produce that pack for a new game. It follows the [Agent Plugins v1.0.0](https://agent-plugins.org/) specification.

## What is in the box

```
plugin.json              manifest (agent-plugins v1.0.0)
README.md                this file
mcp.json                 registers the drascula game-as-tools MCP server (replay transport by default)
skills/
  pack-writing/
    SKILL.md             rules for every line of text a player hears
  engine-gotchas/
    SKILL.md             the Drascula engine findings as a new-engine checklist, plus the survey loop
packs/
  FORMAT.md              the pack format, field by field, with examples
  schema.json            JSON Schema 2020-12 for the pack
  tools/                 the validator (validate + check-coverage), MIT, no network
```

The MCP server itself (`drascula-mcp`) lives in the Ghostlight repo under `mcp/` and is referenced, not copied; the pack validator and format are copied in so the plugin is self-contained for authoring and validation.

## Skills

Compatible clients load a skill on demand when the task matches its description. Each `SKILL.md` carries agent-plugins frontmatter (`name`, `description`) and says when to use it.

- **pack-writing** — load when writing or reviewing the **text** of a pack: room names and descriptions, exit labels, spoken object and item names, text fixes, cutscene descriptions, recaps, or hint tiers. The file to read before authoring any line a player will hear.
- **engine-gotchas** — load when adapting a **new engine**, debugging one, or **surveying** a game through the MCP server. It carries the thirteen Drascula findings as the checklist a new engine must answer, and the end-to-end survey-write-validate-coverage loop.

Load neither for a pure validation run (just run the validator).

## Configure the MCP server

`mcp.json` registers a `drascula` stdio server that defaults to the **replay** transport (`DRASCULA_MCP_TRANSPORT=replay`, `DRASCULA_MCP_FIXTURE=tavern`), which plays recorded fixtures and needs no native build. Each engine verb is one tool; a call issues the command and returns the parsed room state or action diff as JSON.

The plugin does not bundle the server (it is single-sourced in the Ghostlight repo). The config runs it from a **drascula-mcp checkout** that you provide, resolved against the client-managed data directory `${PLUGIN_DATA}`:

```json
"command": "npx",
"args": ["-y", "tsx", "src/server.ts"],
"cwd": "${PLUGIN_DATA}/drascula-mcp"
```

`${PLUGIN_DATA}` is an absolute path the client expands at launch; there are no repo-relative paths, so the config is portable to any install location.

### Point it at a drascula-mcp checkout

1. Get the server. Either clone the Ghostlight repo and use its `mcp/` directory, or copy that directory out on its own:

   ```sh
   git clone https://github.com/thekashifnazir/ghostlight
   # the server is ghostlight/mcp
   ```

2. Put (or symlink) it at `drascula-mcp` inside the plugin's data directory, so `cwd` resolves to the checkout. The data directory is the absolute path the client reports for this plugin's `${PLUGIN_DATA}`:

   ```sh
   # <PLUGIN_DATA> is the client-managed data path for the scummvm-access plugin
   ln -s "$PWD/ghostlight/mcp" "<PLUGIN_DATA>/drascula-mcp"
   ```

3. Install the server's dependencies once (the config runs `src/server.ts` with `tsx`):

   ```sh
   npm --prefix "<PLUGIN_DATA>/drascula-mcp" install
   ```

If you prefer a different location, change `cwd` in `mcp.json` to any absolute path or a `${PLUGIN_DATA}`/`${PLUGIN_ROOT}`-rooted path that points at your checkout. Only `command` (`npx`) is a bare executable; everything else resolves from `cwd`, so nothing assumes the Ghostlight repo layout.

Switch to the live game only when a native ScummVM build exists: set `DRASCULA_MCP_TRANSPORT=native` (it spawns the build under its own save path with `--subtitles`). Keep replay as the default so the survey works offline and in CI.

## Make another ScummVM game accessible

The pack format, validator, pack-writing rules and survey loop are engine-agnostic. The Drascula pieces are the worked example. The full adapt-a-new-game loop (survey through the MCP server, learn the engine seams, write the pack, validate, check coverage) lives in the **engine-gotchas** skill. In short:

### 1. Survey the game through the MCP server

Drive the game by command (replay transport, no native build needed) and record, for every room, exactly what the engine reports: the room number, each hotspot's number, position and type, every exit and its destination, inventory ids, and which flags change on which actions. That raw census is the input to the pack.

### 2. Learn the engine's seams

Read the **engine-gotchas** skill. The thirteen Drascula findings double as the questions a new engine must answer before its pack can be trusted: where the main loop reads input, whether conversations and cutscenes run their own loops, how to act on an object without a pixel click, where names and descriptions live in engine data (and which are localised or wrong), the one chokepoint every drawn line passes through, and which launch flags the build needs.

### 3. Write the pack

Create `packs/<gameId>-<lang>.json`, keyed on the survey. `FORMAT.md` documents every section with examples. Follow the **pack-writing** skill for the prose: plain short sentences, no em dashes, screen-relative positions, descriptions that never solve puzzles, and milestone hints in three tiers (nudge, clue, answer) written fresh, never copied from a walkthrough.

### 4. Validate

```sh
cd packs/tools
npm install
npm run validate -- ../../packs/<gameId>-<lang>.json
```

The validator runs schema validation (Ajv, JSON Schema 2020-12) plus the cross-reference checks the schema cannot express: item `(id, chapter)` uniqueness, milestone `after` ids exist with no cycles, referenced milestone ids exist, and flag indices in range. It reports every error, not just the first, and exits non-zero on any error. It reads local files only and makes no network calls. It resolves the bundled `packs/schema.json` by default; pass an explicit schema path as the second argument to validate against another copy.

### 5. Check coverage (optional, when you have a census)

```sh
npm run check-coverage -- ../../packs/<gameId>-<lang>.json path/to/census.json
```

With a machine-readable census (rooms, hotspots, doors and the exit graph), `check-coverage` confirms the pack covers every census room, hotspot and door for the covered chapters, that door destinations agree, and that there are no stale entries. See `packs/tools/src/types.ts` for the `Census` type.

## Licensing

The pack format, validator and this plugin are MIT. A ScummVM engine patch that adds the accessibility layer is a modification of GPL code and stays GPL-3.0-or-later; it is not part of this plugin. Game data is never bundled.
