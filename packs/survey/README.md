# Pack coverage survey

The pack data path: turn the engine's own room state into accepted entries in
`packs/drascula-en.json`. Four stages plus a coverage report, all human-gated at
stage 3. See `.kiro/specs/pack-coverage/` for the full spec.

This tooling is Apache-2.0, like the rest of `packs/tools/`. The pack *data*
(`drascula-en.json`) is CC BY 4.0. Room screenshots are game art and are **not
committed** (`packs/survey/**/screenshot.png` is gitignored); the repo never
holds game data.

## The split with the Kiro Crew surveyor

Crew plays the game and finds bugs (prose reports + saved checkpoints). This
pipeline owns the pack data path: it reads Crew's checkpoints and the census,
and produces dumps, drafts, a review list and merged pack entries. The two meet
only at the checkpoint files and the census. This pipeline never edits Crew's
reports, never commits save files, and never fabricates a dump for a room it did
not actually enter.

## Stages

1. **survey** (`survey.ts`) — drives the `drascula-mcp` native transport from a
   Crew checkpoint to each reachable room in a chapter, through the documented
   MCP tools only. Writes a dump per room. **Needs the native engine and the
   committed transport-settle fix; see "Blocked until" below.**
2. **dump** (part of `survey.ts`) — per reached room writes
   `packs/survey/<room>/`:
   - `state.json` — the engine `state` snapshot (chapter, room, hero, objects
     with hotspot numbers and rectangles, inventory, all 50 flags).
   - `verbs.json` — which of look/take/open/close/talk/push/walk the engine
     answered per hotspot, and the game's own look text, verbatim.
   - `meta.json` — checkpoint slot, date, engine build, and each hotspot's door
     flag and census destination.
   - `screenshot.png` — a picture of the room (gitignored, game art).
3. **draft** (`draft.ts`) — a pure transform: reads each room's dump and
   screenshot and proposes a room name, short and long description, exit labels
   and object names into `packs/survey/draft-<chapter>.json`. Never writes the
   pack. Each description carries a `provenance` ("drafted by Kiro from a
   screenshot", or from game text only) so a reviewer knows it is a
   machine-authored proposal and what to check by eye.
4. **review** (produced from the draft) — `packs/survey/review-<chapter>.json`,
   one reviewable unit per room-description, per exit and per object, each with
   a `status` and the carried `provenance`.
5. **merge** (`merge.ts`) — a pure transform: reads the review list and writes
   only `accepted` units into `packs/drascula-en.json`, keyed on the engine's
   hotspot numbers. Saving the pack fires the `pack-validate-on-save` hook; the
   merge is complete only when the validator and the coverage checker pass. The
   hook is never bypassed.

The coverage report and its test live in `packs/tools/` (`coverage-report.ts`,
`test/pack-coverage.test.ts`), built on the existing census coverage checker.

## Reviewing (stage 3)

Kash or Claude Code opens `packs/survey/review-<chapter>.json` and sets each
unit's `status`:

- `accepted` — merge this text into the pack.
- `rejected` — leave it out.
- `pending` (default) — not yet reviewed; left out of the merge.

Each unit shows its `provenance`. For a unit that already has an accepted pack
entry (`alreadyCovered: true`), the existing text is shown and the unit starts
`pending`, so proven chapter 1 and chapter 2 text is replaced only if you
explicitly accept the redraft.

Only `accepted` units merge. Review is entry by entry: accept a room
description while rejecting one wrong object name if you like.

## Save path

The survey uses its own save path `/tmp/ghostlight-pack-coverage`, distinct from
the engine chat (`/tmp/ghostlight-engine`), the player chat, the MCP server
(`/tmp/ghostlight-mcp`) and Crew (`ghostlight-crew/.saves/`). It copies a Crew
checkpoint into its own save path before loading, so it reads Crew's saves but
never writes them.

## Reachability

A room counts as reachable if it has a walkable in-edge in the census exit
graph (`reference/census.json`, `exitGraph`) for the target chapter, OR it is a
cutscene-only room reached from a checkpoint saved inside it. Rooms 56, 57 and
102 are cutscene-reached: 102 has no exit-graph edge at all. The survey walks
the graph for walkable rooms and loads a checkpoint for cutscene-only rooms.

## Chapter order

Chapter 2 is the pilot: Crew has chapter 2 checkpoints, and every chapter 2 room
already has an accepted pack entry, so the pipeline's output can be compared to
known-good text before it is trusted. Chapters 3 to 6 are the real coverage gain
(rooms 13, 20, 21–44, 45–57, 58–61, 102), added to `pack.coverage.chapters` only
once their reachable rooms are fully described with accepted entries.

## Blocked until transport-settle commits

Stages 1 and 2 (`survey.ts`, the dump) and the chapter 2 pilot and chapter 3–6
runs drive the real native engine. They are blocked until the native transport's
single-command settle fix (the quiet-period inactivity cap in `mcp/src/native.ts`
that replaces the flat 60 s timeout) is committed to `main`. An unattended,
checkpoint-to-room survey issues many commands per room with no human watching,
so it is only viable once a stalled command fails fast and carries its last
A11Y line. The pure-transform stages (draft, review list, merge, coverage
report and test) do not need the engine and are built and tested without it.
