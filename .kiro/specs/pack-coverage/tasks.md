# Tasks: Pack coverage

Each task is a single, reviewable commit. The engine-driving tasks (2, 3, 8, 9) share a hard precondition: **the transport-settle bugfix must be committed to `main` first.** That fix landed in commit `06d81ac` (transport-settle), so the precondition now holds; tasks 2, 3, 8 and 9 are unblocked. The pure-transform tasks (4, 5, 6, 7) and the scaffolding (1) need no engine and are done. Stay inside `packs/` (and `packs/tools/` for the test), use the pipeline's own save path, and commit only your own paths.

- [x] 1. Confirm the transport-settle precondition and scaffold the survey tree
  - Verified the transport-settle fix is on `main` (commit `06d81ac`): the native transport settles on a quiet-period inactivity cap (not a flat 60 s) and a `choose` resolves on its own diff so a committed flag is visible without a follow-up `state`.
  - Create `packs/survey/` with a `README.md` describing the four stages and the chapter 2 pilot, and the pipeline's own save path `/tmp/ghostlight-pack-coverage` (distinct from engine, player, MCP and Crew save paths).
  - Confirm, from `reference/census.json`, how reachability is represented (exit graph plus cutscene-only rooms 56, 57, 102) so stages 1 and 5 agree on which rooms count as reachable.
  - _Requirements: 1.6, dependency (transport-settle), 5.5_

- [ ] 2. Survey script: drive drascula-mcp native from a checkpoint to each reachable room
  - Write `packs/survey/survey.ts` that launches `drascula-mcp` with the native transport and the pipeline's own save path, and drives only through the documented MCP tools (`start { slot }`, `state`, `look`, `walk`, etc.); never touch the command file, serialiser or parser directly.
  - Load a Crew checkpoint by copying it into the pipeline's save path and calling `start { slot }`; walk the census exit graph for the target chapter, reaching each unvisited neighbour via `walk <doorHotspot>` and confirming the room change.
  - Record a reached/unreached verdict per census room; a door that does not open or a command that does not settle is a recorded blocked edge or failed step with its reason, and the walk continues (never hang, never abort).
  - Stop the session on completion or failure; read Crew checkpoints but never write, delete or commit them.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [ ] 3. Dump: write the engine's raw room state and a screenshot per reached room
  - For each reached room write `packs/survey/<room>/state.json` (the MCP `state` snapshot: chapter, room, hero, objects with hotspot numbers and rectangles, inventory, all 50 flags), `verbs.json` (which of look/take/open/close/talk/push/walk the engine answered, plus the game's own look text verbatim), and `meta.json` (checkpoint slot, date, engine build, per-hotspot door flag and census destination).
  - Capture `screenshot.png` of the room against the native window; if capture fails, still write the dump and record that the room's draft must be `seen: false`. The screenshot is game art: add `packs/survey/**/screenshot.png` to `.gitignore` so only the state/verbs/meta dumps and drafts are committed.
  - Keep raw engine text verbatim (Spanish and misspelt names preserved for a later text-fix decision); write no `.env` content or key into any dump.
  - _Requirements: 2.1, 2.2, 2.3, 2.4 (incl. screenshot gitignore), 2.5, 2.6, 2.7_

- [x] 4. Draft step: propose names and descriptions into a separate draft file
  - Write `packs/survey/draft.ts` that reads each `packs/survey/<room>/` dump and screenshot and emits `packs/survey/draft-<chapter>.json`, keyed on the engine's hotspot numbers: room `name`/`short`/`long`, an exit `label` and census `to` per door hotspot, an object `name` (and optional `description`) per non-door hotspot.
  - Follow pack-writing steering (plain British English, no em dashes, concrete left-to-right positioning, no puzzle answers, lower-case names unless proper nouns); propose a translated label plus a `textFixes` suggestion for any Spanish or misspelt engine name, never the raw string.
  - Set `seen: true` only from a screenshot, else `seen: false`; mark each description's `provenance` ("drafted by Kiro from a screenshot", or from game text only); never invent a hotspot the dump lacks; list every hotspot the dump reported; mark a room that already has an accepted pack entry `alreadyCovered: true` and carry the existing text alongside the proposal.
  - Never write into `packs/drascula-en.json`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.4a (provenance), 3.5, 3.6, 3.7_

- [x] 5. Approve step: a review list accepted entry by entry
  - Produce `packs/survey/review-<chapter>.json` from the draft, one reviewable unit per room-description, per exit and per object, each with a `status` of `pending` / `accepted` / `rejected`, the `provenance` carried from the draft ("drafted by Kiro from a screenshot", or from game text only) so the reviewer knows to check it by eye, and keyed by room and hotspot number.
  - An already-covered unit starts `pending` showing the existing pack text, so it is replaced only if the reviewer explicitly accepts the redraft; proven chapter 1 and chapter 2 text is never overwritten silently.
  - Document in `packs/survey/README.md` how Kash or Claude Code sets statuses and that only `accepted` units merge.
  - _Requirements: 4.1, 4.1a (provenance in review list), 4.6_

- [x] 6. Merge step: accepted entries into the pack through the validator hook
  - Write `packs/survey/merge.ts` that reads `review-<chapter>.json` and writes only `accepted` units into `packs/drascula-en.json`, keyed on the engine's hotspot numbers, under `exits` or `objects` by the hotspot's door flag; append accepted `textFixes`.
  - Grow `pack.coverage.chapters` to include a chapter only when every reachable room in it has an accepted, merged entry.
  - After writing, let the `pack-validate-on-save` hook run; treat the merge as complete only when the validator and `check-coverage` pass, report validator errors on failure, and never bypass or weaken the hook or the coverage checker.
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.7_

- [x] 7. Coverage report and test (reuse the census checker)
  - Add a report that summarises, per chapter, census rooms reachable vs rooms with a pack entry (naming each reachable room with no entry) and described-room hotspots with no `name`/`label`, built on `packs/tools/src/coverage.ts` — no second checker, no engine run.
  - Count cutscene-only rooms (56, 57, 102) as reachable; confirm against `census.json` whether the existing checker already scopes them, and add only a reporting note if it does not (do not fork the checker).
  - Add `packs/tools/test/pack-coverage.test.ts` (Vitest, `pack` spec prefix) that fails when a chapter claimed in `pack.coverage.chapters` has a reachable room or a described-room hotspot with no coverage; it must pass for the current pack (chapters 1 and 2) and fail if a later chapter is claimed before its rooms are described.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 8. Chapter 2 pilot run end to end
  - Run survey → dump → draft → review → merge on chapter 2 using the Crew chapter 2 checkpoints, before any chapter 3 to 6 room is surveyed.
  - Compare the chapter 2 drafts against the existing accepted chapter 2 pack entries to judge the pipeline's output against known-good text; where a Crew-reported blocker stops a room being reached (for example the held-item target rejection blocking the chain to room 20), record the room as unreached with the reason and do not fabricate its dump.
  - Confirm the coverage test still passes and the pack still validates after the pilot (no regression to the proven chapter 1 and 2 data).
  - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [ ] 9. Extend to the remaining reachable chapters
  - Apply the proven pipeline to chapters 3, 4, 5 and 6 as checkpoints become available, surveying each reachable room, drafting, reviewing and merging accepted entries.
  - Add each chapter to `pack.coverage.chapters` only when its reachable rooms are fully described with accepted, validator-passing entries; never claim a chapter on the strength of a dump alone.
  - Keep the coverage test green at each step, so every reachable room gains an accepted pack entry and coverage claims always match accepted data.
  - _Requirements: 6.4, 6.5, 5.6_
