# Requirements: Pack coverage

## Introduction

Today `packs/drascula-en.json` describes 19 rooms: both chapter 1 rooms (62, 63) and all 17 chapter 2 rooms (1 to 10, 12, 14 to 19). The census (`reference/spikes/05-game-census.md`, `reference/census.json`) lists 57 rooms across 6 chapters. Every room a player can reach must have a name, a short and long description, labelled exits and named objects in the pack, not just today's 19. The chapters still missing are 3 (rooms 13, 20), 4 (21 to 44), 5 (45, 49 to 57) and 6 (58 to 61, 102).

This spec owns the **pack data path**: a repeatable pipeline that turns the engine's own room state into accepted pack entries. It does not change how the game is played, how the player speaks, or how the engine reports state. It drives the existing `drascula-mcp` native transport from saved checkpoints to each reachable room, dumps the engine's raw room state and a screenshot, drafts names and descriptions from that evidence into a separate draft file, puts each draft entry through a human review that accepts entry by entry, merges only accepted entries into the pack through the existing pack validator hook, and reports coverage that a test can check.

The pipeline is proven on **chapter 2 first**, because the Kiro Crew surveyor already has chapter 2 checkpoints and chapter 2 rooms already have accepted pack entries. Chapter 2 is therefore the pilot: the dump, draft, review and merge steps run against rooms whose correct answers already exist, so the pipeline can be checked against known-good data before it is trusted to add new rooms in chapters 3 to 6.

### Relationship to the Kiro Crew surveyor

The Kiro Crew surveyor (`ghostlight-crew`) and this spec do different jobs on the same game, and the boundary is firm:

- **Crew plays and finds bugs.** The surveyor plays the game room by room as a blind player would, reports what a blind player could not get past (`reports/room-62.md`, `reports/room-63.md`, `reports/bug-open-held-item.md`, `reports/run-2026-11-08-chapter2.md`), and produces the saved checkpoints this pipeline starts from. Crew output is prose reports and save files, not pack JSON.
- **This spec owns the pack data path.** It consumes Crew's checkpoints and produces pack entries. It never plays for coverage's sake beyond reaching each room, never edits Crew's reports, and never commits save files. Crew's bug reports are inputs this spec must respect (for example the held-item target rejection), not problems this spec fixes.

The two meet only at the checkpoint files and the census. This spec reads checkpoints; Crew writes them. Neither edits the other's folders.

### Dependency

This spec is **requirements, design and tasks only**. No code is written here, and **no task may begin until the transport-settle bugfix has committed** to the Ghostlight repo. The native transport's single-command settle (the quiet-period inactivity cap that replaces the 60 s silent timeout) is what makes an unattended, checkpoint-driven survey run possible: the Crew run of 8 Nov 2026 stalled because a missed settle cost 60 s of silence per command and the driver could not tell slow from hung. Until that fix is on `main`, the survey script cannot be built or trusted. Tasks record this as a hard precondition.

### Terms

- **reachable room**: a census room that a player can enter during normal play. The census exit graph plus cutscene-reached rooms (56, 57, 102) defines reachability per chapter.
- **checkpoint**: a ScummVM save slot produced by the Crew surveyor or by this pipeline, from which the native transport can load a game partway through (`start { slot }`).
- **dump**: the per-room evidence this pipeline captures: the engine's raw room-state snapshot (chapter, room, hero, objects with hotspot numbers and rectangles, inventory, all 50 flags), which verbs the engine answered for each hotspot, the game's own look texts, and a screenshot of the room.
- **draft entry**: a proposed pack room entry (name, short, long, exit labels, object names) written to a draft file, never straight into the pack.
- **accepted entry**: a draft entry a human reviewer (Kash or Claude Code) has marked accepted. Only accepted entries may be merged.
- **the pack**: `packs/drascula-en.json`.
- **the validator**: the pack tools in `packs/tools/` (schema validation, cross-reference checks, and the census coverage checker), and the `pack-validate-on-save` hook that runs the validator whenever a file under `packs/` is saved.
- **the census**: `reference/census.json`, the machine-readable room, hotspot and exit-graph data the coverage checker already reads.

Requirements use EARS (Easy Approach to Requirements Syntax).

## Requirements

### Requirement 1: A survey script that drives drascula-mcp native from checkpoints

**User story:** As a pack author, I want a script that loads a checkpoint and drives the real engine to each reachable room, so that I collect first-hand room state instead of guessing from the census.

#### Acceptance criteria

1. THE survey script SHALL drive the game through the existing `drascula-mcp` native transport and its tools (`start`, `state`, `look`, `walk`, `take`, `open`, `close`, `talk`, `push`, `use`, `inventory`, `choices`, `choose`, `skip`, `save`, `stop`), and SHALL NOT read pixels, hand-write the engine command file, or re-implement the command serialiser or the A11Y parser.
2. WHEN the survey script starts a run THEN it SHALL load a named checkpoint via the `start` tool's `slot` argument so the session begins partway through, rather than from the game's opening.
3. THE survey script SHALL walk from the loaded room to each reachable room in the target chapter using the census exit graph to choose moves, and SHALL record which rooms it reached and which it could not.
4. WHEN the survey script cannot reach a room (a locked door, a missing checkpoint, a cutscene-only room, or a Crew-reported blocker) THEN it SHALL record the room as unreached with the reason, and SHALL continue with the remaining rooms rather than aborting the run.
5. WHERE a command does not settle within the transport's quiet-period cap THE survey script SHALL record the stall against the command and room and continue, treating a non-settling command as a failed step rather than hanging the run.
6. THE survey script SHALL use its own save path (for example `/tmp/ghostlight-pack-coverage`) distinct from the engine, player and Crew save paths, so it never shares the command file or saves with another chat, and SHALL stop its session on completion or failure.
7. THE survey script SHALL NOT delete, overwrite or commit any Crew checkpoint or save file; it reads checkpoints and writes only its own dumps and screenshots.
8. THE survey script SHALL be driven against chapter 2 first, using the Crew chapter 2 checkpoints, before it is run on any other chapter.

### Requirement 2: Dump the engine's raw room state and a screenshot per room

**User story:** As a pack author, I want the engine's own raw room state and a picture of each room saved to disk, so that drafting and review have concrete, re-checkable evidence.

#### Acceptance criteria

1. FOR each room the survey script reaches THE survey script SHALL write a dump to `packs/survey/<room>/` containing the engine's room-state snapshot: chapter, room number, hero position, every object with its hotspot number and rectangle, the inventory, and all 50 progress flags.
2. THE dump SHALL record, per hotspot, which target verbs the engine answered (which of `look`, `take`, `open`, `close`, `talk`, `push`, `walk` produced a diff rather than an error) and the game's own look text for that hotspot where one was produced.
3. THE dump SHALL record each hotspot's door flag and census destination so a later step can label exits and check destinations against the census.
4. THE survey script SHALL save a screenshot of the room to `packs/survey/<room>/` alongside the room-state dump. THE screenshot is game art and SHALL be gitignored (`packs/survey/**/screenshot.png`); only the `state`, `verbs` and `meta` dumps and the drafts are committed, so the repo never holds game data.
5. THE dump SHALL record the checkpoint slot, the date, and the engine build it was taken from, so a reader knows the provenance of the evidence.
6. THE dump SHALL be stored as data the draft and report steps read as local files; it SHALL NOT embed any API key or the contents of `.env`.
7. THE raw engine look texts in the dump SHALL be preserved verbatim; any Spanish or misspelt names are recorded as the engine reported them, for a later text-fix decision, not silently corrected in the dump.

### Requirement 3: Draft names and descriptions into a separate draft file

**User story:** As a pack author, I want proposed room names and descriptions written to a draft file from the dump and screenshot, so that nothing reaches the pack without review.

#### Acceptance criteria

1. FOR each surveyed room THE draft step SHALL propose a room `name`, a `short` description, a `long` description, an exit `label` for every door hotspot, and an object `name` for every non-door hotspot, derived from that room's dump and screenshot.
2. THE draft step SHALL write every proposal to a draft file separate from `packs/drascula-en.json`, and SHALL NOT write any proposal directly into the pack.
3. THE draft text SHALL follow the pack writing rules (pack-writing steering): plain British English, no em dashes, concrete left-to-right positioning, no puzzle solutions in descriptions, lower case object and item names unless a proper noun, and a translated label for any Spanish or misspelt engine name rather than the raw string.
4. WHERE a room's proposal is written from the room's actual screenshot THE draft step SHALL mark it `seen: true`; WHERE it is written from object names and game text only THE draft step SHALL mark it `seen: false`.
4a. THE draft step SHALL mark each proposed description with a provenance of "drafted by Kiro from a screenshot" (or, when no screenshot was available, from object names and game text only), so a reviewer knows the text is a machine-authored proposal from the picture, not human-written, and knows what to check by eye.
5. THE draft step SHALL carry each proposed exit's census destination and each hotspot's engine number through to the draft, so the review and merge steps key on the engine's own hotspot numbers.
6. THE draft step SHALL NOT invent a hotspot the dump did not report, and SHALL list every hotspot the dump reported so the reviewer sees the full room.
7. WHERE a room already has an accepted pack entry (every chapter 2 and chapter 1 room) THE draft step SHALL mark the proposal as already-covered, so review and merge default to leaving the existing entry unchanged rather than overwriting proven text.

### Requirement 4: An approval step that accepts entries one by one

**User story:** As a reviewer (Kash or Claude Code), I want a review list I accept entry by entry, so that only text I have approved ever enters the pack.

#### Acceptance criteria

1. THE approval step SHALL present a review list in which each draft entry (a room, or a single exit or object within a room) can be independently marked accepted or not accepted by a human reviewer.
1a. THE review list SHALL carry each entry's provenance ("drafted by Kiro from a screenshot", or from game text only when no screenshot was available), so the reviewer sees that the text is a machine-authored proposal and knows to check it by eye against the picture.
2. THE merge step SHALL merge into the pack only entries marked accepted, and SHALL leave every not-accepted and unreviewed entry out of the pack.
3. WHEN an entry is accepted and merged THE merge step SHALL write it into `packs/drascula-en.json` keyed by the engine's own hotspot numbers, under the room's `exits` or `objects` as the hotspot's door flag dictates.
4. THE merge step SHALL update `pack.coverage.chapters` to include a chapter only once every reachable room in that chapter has an accepted, merged entry, so coverage claims match accepted data.
5. WHEN the pack file is saved after a merge THE existing `pack-validate-on-save` hook SHALL run the validator, and the merge SHALL be considered complete only when the validator and the coverage checker pass; a merge that fails validation SHALL be reported with the validator's errors and SHALL NOT be claimed as covered.
6. THE approval step SHALL preserve an existing accepted pack entry unless the reviewer explicitly accepts a replacement for it, so proven chapter 1 and chapter 2 text is never overwritten by a redraft without a reviewer's decision.
7. THE approval and merge steps SHALL NOT bypass, disable or weaken the validator hook or the coverage checker to force an entry through.

### Requirement 5: A coverage report a test can check

**User story:** As a pack author, I want a coverage report of rooms reachable versus described and objects without names, so that a test can fail when the pack falls behind the reachable game.

#### Acceptance criteria

1. THE coverage report SHALL list, per chapter, the census rooms reachable versus the rooms with an accepted pack entry, and SHALL name every reachable room that has no pack entry.
2. THE coverage report SHALL list every hotspot the census reports for a described room that has no `name` (objects) or `label` (exits) in the pack.
3. THE coverage report SHALL be derived from the pack and the census only (no live engine run), reusing the existing census coverage checker (`packs/tools/src/coverage.ts`) rather than a second, divergent checker.
4. THERE SHALL be a test that reads the pack and the census and fails when a chapter claimed in `pack.coverage.chapters` has a reachable room or a described-room hotspot that is not covered.
5. WHERE a reachable room is reached only by a cutscene (56, 57, 102) THE coverage report SHALL count it as reachable, so coverage is measured against every room a player ends up in, not only those with a walkable exit edge.
6. THE coverage test SHALL pass today for the current pack (chapters 1 and 2 fully covered) and SHALL fail if a later chapter is claimed in coverage before its rooms are described.

### Requirement 6: Chapter 2 first, then the remaining chapters

**User story:** As a pack author, I want the whole pipeline proven on chapter 2 before new rooms are added, so that I trust the dump, draft, review and merge against data whose correct answers already exist.

#### Acceptance criteria

1. THE pipeline SHALL be run end to end on chapter 2 first, using the Crew chapter 2 checkpoints, before any chapter 3 to 6 room is surveyed.
2. WHEN the chapter 2 run produces drafts for rooms that already have accepted pack entries THEN the drafts SHALL be comparable against the existing entries, so the pipeline's output can be judged against known-good text before it is trusted for new rooms.
3. WHERE the chapter 2 run reveals a Crew-reported blocker that stops a room being reached (for example the held-item target rejection blocking the chapter 2 chain to room 20) THE run SHALL record the blocker as the reason the room is unreached and SHALL NOT fabricate a dump for a room it did not actually enter.
4. AFTER chapter 2 is proven THE pipeline SHALL be applied to the remaining reachable chapters (3, 4, 5, 6) so that every reachable room gains an accepted pack entry, with each chapter added to `pack.coverage.chapters` only when its rooms are fully described.
5. THE pipeline SHALL NOT claim a chapter as covered on the strength of a dump alone; coverage follows accepted, merged, validator-passing entries, per Requirement 4 and Requirement 5.
