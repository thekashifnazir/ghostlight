# Tasks: pack

These tasks implement the design. Each cites the requirements it covers. All work lives under `packs/`; `reference/census.json`, `reference/pack-draft/` and `.kiro/steering/pack-writing.md` are read-only inputs. No task creates or edits any file under `engine/`, `scripts/`, or `vendor/`. Follow the process-log rule: log and commit after each task.

- [x] 1. Promote the schema to v1
  - Copy `reference/pack-draft/schema.json` to `packs/schema.json`.
  - Change `formatVersion` to the `1.x` pattern (`^1\.[0-9]+$`), update `$id` and `title` to say v1, and keep the `x-` extension allowance and the em-dash ban in the `text` def.
  - Confirm the top-level required keys (`format`, `formatVersion`, `game`, `pack`, `rooms`) and every `$def` (room, exit, object, item, textFix, chapter, cutscene, condition, milestone) carry over unchanged in structure.
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.5, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4_

- [x] 2. Write the v1 format document
  - Copy `reference/pack-draft/FORMAT.md` to `packs/FORMAT.md` and rewrite it for v1: drop the "draft, breaking changes allowed" language, state the v1 additive-only stability promise, keep the hotspot-API alignment table and every per-section field rule.
  - Walk the document against `packs/schema.json` field by field so the two agree exactly.
  - _Requirements: 1.2, 1.8, 2.6, 3.5_

- [x] 3. Tooling skeleton under packs/tools
  - Create `packs/tools/package.json` (MIT licence; deps: ajv, fast-check, and a TS test runner), `packs/tools/tsconfig.json`, and a `packs/tools/README.md` with how to run `validate` and `check-coverage`.
  - Confirm `npm install` and a no-op `tsc --noEmit` succeed, and that nothing outside `packs/` is created.
  - Confirm current Ajv (2020-12) and fast-check APIs via the Context7 power before pinning versions.
  - _Requirements: 5.4, 8.1, 10.1, 10.3_

- [x] 4. Types and loaders
  - Write `packs/tools/src/types.ts` mirroring the schema (Pack, Room, Exit, Object, Item, TextFix, Chapter, Cutscene, Condition, Milestone).
  - Write `packs/tools/src/load.ts` to read and parse the schema, a pack, and `reference/census.json` as local files only, with no network calls.
  - _Requirements: 5.4, 5.5_

- [ ] 5. Schema-validation stage
  - Write `packs/tools/src/validate.ts` stage 1: compile `packs/schema.json` with Ajv (2020-12) and validate a pack, mapping each error to `{ path, message }` keyed by JSON pointer.
  - Collect all schema errors; do not short-circuit on the first.
  - _Requirements: 5.1, 5.3_

- [ ] 6. Condition walk and cross-reference checks
  - Add a recursive condition walk that collects every `flags` key and every `milestone` ref from a condition tree (through `all`/`any`/`not`).
  - Implement stage 2 checks: `(id, chapter)` item uniqueness; `after` ids exist; no `after` cycles (DFS with a visiting set); `condition.milestone` refs exist; flag indices in 0 to 49; a milestone `when.flags` index in range for that milestone's chapter.
  - Merge stage 1 and stage 2 errors into one list; exit 0 when empty, non-zero with the full list otherwise.
  - _Requirements: 4.5, 4.6, 4.7, 5.2, 5.3, 6.1, 6.2, 6.4_

- [ ] 7. Coverage checker
  - Write `packs/tools/src/coverage.ts`: read the census and a pack, take `pack.coverage.chapters`, and check room presence, hotspot presence (set of `num` per room), door destinations (`to` equals census `toRoom` unless a documented `note` overrides), stale entries, and exit-graph agreement (including `to: null` must carry a note).
  - Treat `doorGates` flag numbers as real flags for the covered chapters.
  - Collect every gap; exit non-zero with the full list when any room, hotspot or door is uncovered.
  - _Requirements: 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [ ] 8. Hint-selection rule
  - Write `packs/tools/src/hints.ts` with a pure `offeredMilestones(pack, progress)` returning milestones that are not yet reached and whose every `after` is reached.
  - Keep it independent of live flags; it reasons only over the `after` graph and the reached set.
  - _Requirements: 4.5, 8.4_

- [ ] 9. CLI entry points
  - Write `packs/tools/src/cli.ts` exposing `validate <pack>` and `check-coverage <pack> <census>`, wiring stages 1 and 2 and the coverage checker, each exiting with the right status and printing all errors.
  - _Requirements: 5.3, 7.7_

- [ ] 9a. Validate-on-save hook for packs
  - Create a shell-command agent hook (`.kiro/hooks/pack-validate-on-save.json`, `enabled: true` so it shows in the hooks panel) that runs the pack validator whenever a file under `packs/` is saved (`PostFileSave`, matcher on `packs/`).
  - Confirm the hook command invokes the `validate` CLI against `packs/drascula-en.json`.
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 10. Move and upgrade the Drascula pack
  - Copy `reference/pack-draft/drascula-en.json` to `packs/drascula-en.json`; leave the draft untouched.
  - Set `formatVersion` to v1, point `$schema` at `packs/schema.json`, and bump `pack.version` for the content revision. Change no field shapes.
  - _Requirements: 9.1, 9.5, 10.2_

- [ ] 11. Validate and cover the Drascula pack
  - Run the validator on `packs/drascula-en.json` until it is clean (schema + cross-reference).
  - Run the coverage checker for chapters 1 and 2; resolve every gap or attach a documented override note (inn curtained doorway `to: null`, the chapter-1 street door switched off in data, any shared-number hotspots).
  - _Requirements: 9.2, 9.3_

- [ ] 12. Pack-writing review
  - Read `packs/drascula-en.json` against `.kiro/steering/pack-writing.md`: British English, plain short sentences, no em dashes, concrete left-to-right positions, lower-case item names unless proper nouns, spoiler-free descriptions, three fresh hint tiers per milestone in the pack's own words.
  - Fix any text that breaks a rule; confirm no key or secret is present.
  - _Requirements: 9.4, 9.6, 10.4_

- [ ] 13. fast-check generators
  - Write `packs/tools/test/gen.ts`: `arbMilestoneGraph` (small DAG with `after` edges, hint tiers, chapter), `arbReachedSet` (downward-closed over a graph), `arbCondition` (nested `all`/`any`/`not` with flags, has, lacks, room, chapter, milestone), and `arbMalformedFragment` (out-of-range flag, both `when` and `end`, missing hint tier, cyclic `after`).
  - _Requirements: 8.1, 8.5, 8.6_

- [ ] 14. Validator tests
  - Write `packs/tools/test/validate.test.ts`: the real pack validates clean; known-bad fixtures fail (out-of-range flag, missing hint tier, `after` cycle, dangling `after` id, both `when` and `end`).
  - Property test: generated malformed fragments are rejected; the real-flags invariant holds for every milestone condition in the real pack (flag indices in range for the milestone's chapter).
  - _Requirements: 8.1, 8.3, 8.6, 6.1, 6.2, 6.4_

- [ ] 15. Coverage tests
  - Write `packs/tools/test/coverage.test.ts`: the real pack passes coverage against the real census for chapters 1 and 2; a fixture with a missing hotspot, a wrong door destination with no note, and a stale entry each fail.
  - Property test the coverage invariant: for all covered rooms and all their census object numbers, the pack has the key.
  - _Requirements: 8.1, 8.2, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 16. No-spoiler hint tests
  - Write `packs/tools/test/hints.test.ts`: property test that `offeredMilestones` over a generated `after`-consistent reached set never returns a milestone whose `after` are unmet or that is already reached.
  - Include the real pack's milestones as one generated graph source.
  - _Requirements: 8.4, 8.5, 4.5_

- [ ] 17. Green run and feature-table update
  - Run the full test suite and both CLI commands against the real pack and census; confirm all green and both exit 0.
  - Update the property-based-testing (fast-check) row in `docs/kiro-features.md` with the evidence path, as part of the logging pass.
  - _Requirements: 8.1, 9.2, 9.3, 10.5_
