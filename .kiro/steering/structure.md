# Structure

## Repository layout

```
/                      MIT licence (the submission)
.kiro/                 committed, not gitignored
  steering/            product, tech, structure, accessibility, pack-writing, process-log
  specs/               one spec per area (requirements → design → tasks)
  hooks/               agent hooks (JSON)
docs/
  kiro-process.md      dated process log, newest last (see process-log.md steering)
engine/                GPL-3.0 ScummVM fork + Drascula a11y patch
src/                   the player: page, parser, pack loader, hint engine (written in Kiro)
packs/                 accessibility packs, e.g. drascula-en.json, plus schema + tools
reference/             prep-phase inputs (design, spikes, census, draft pack, research) — reference only
```

## Rules

- `.kiro/` is committed and never gitignored. The Kiro work must be visible to judges.
- Nothing in `src/` is copied from `reference/`. The reference folder is the prep-phase record; Kiro writes specs and code from what the spikes proved.
- The engine patch lives under `engine/` and stays GPL-3.0-or-later. Everything else in the repo is MIT.
- Game data is never committed. A script fetches it from ScummVM's official downloads with checksums.
- No keys in the repo. Keys live in a local `.env` that is gitignored.

## Specs, one per area

Engine a11y layer; web player; pack format and Drascula pack; hints and ghost; sonar; survey crew; demo and hosting. Each spec goes through requirements → design → tasks, using EARS for requirements.

## Packs

- One file per game, engine and language: `<gameId>-<lang>.json`, for example `drascula-en.json`.
- The schema (`schema.json`, JSON Schema 2020-12) and cross-reference validators live alongside the packs.
- Pack writing follows pack-writing.md (active on `packs/**`).

## Naming

- Numeric engine ids are JSON object keys, so strings of digits (`"62"`).
- Milestone ids are dotted lower case, e.g. `ch2.handbag`.
- Cutscenes are keyed by the engine's `animation_*` function name.

## Process log

After every spec phase finished and every task completed, append a dated entry to `docs/kiro-process.md` and commit. See process-log.md.
