# Design: pack

## Overview

This spec turns the `reference/pack-draft/` v0.1 draft into a stable v1 accessibility pack format and tools, all under `packs/`. The deliverables are a JSON Schema and a format document, a TypeScript validator, a coverage checker against the census, property-based tests, and the Drascula chapter 1 to 2 pack moved to `packs/drascula-en.json` and reviewed against the pack-writing steering.

The pack supplies words; the engine (another spec) supplies live state. This spec writes no engine code and never touches `engine/`, `scripts/`, or `vendor/`. It reads `reference/census.json` and `reference/pack-draft/` as source, and `.kiro/steering/pack-writing.md` as the review rules.

### Design principles

- **Schema first, code second.** As much as can be expressed in JSON Schema lives in `schema.json`. The validator adds only the cross-reference rules a schema cannot state (graph acyclicity, id existence, flag ranges, `(id, chapter)` uniqueness). This keeps the format self-describing and readable by any JSON Schema tool.
- **The census is ground truth, read-only.** Coverage is defined by the census, not by the pack. The checker never edits the census; it is produced by the engine spike and consumed here.
- **Fail with the whole list.** The validator and checker collect every error and report them together, so a pack author fixes a batch at once rather than one-per-run.
- **The pack is data, not code.** Nothing in the pack or the tools makes a network call. Reading the schema, the pack and the census is all local file I/O.
- **Words carry no spoilers.** The format separates descriptions (what is there) from hints (what to do), and the schema plus the pack-writing review keep that line.

### Where the code lives

```
packs/
  schema.json             JSON Schema 2020-12, format v1
  FORMAT.md               human-readable format document (v1)
  drascula-en.json        the Drascula chapters 1-2 pack
  tools/
    src/
      types.ts            TypeScript types mirrored from the schema
      load.ts             read + parse pack / schema / census (local files only)
      validate.ts         schema check + cross-reference checks
      coverage.ts         census coverage + exit-graph check
      hints.ts            milestone hint-selection rule (pure function)
      cli.ts              `validate` and `check-coverage` entry points
    test/
      validate.test.ts    unit + property tests for the validator
      coverage.test.ts    unit + property tests for the checker
      hints.test.ts       property tests for the no-spoiler invariant
      gen.ts              fast-check arbitraries (packs, conditions, progress states)
    package.json          MIT, deps: ajv, fast-check, a TS test runner
    tsconfig.json
    README.md             how to run validate and check-coverage
```

All of this is under `packs/`. No file under `engine/`, `scripts/`, or `vendor/` is created or edited.

## Format v1

Format v1 is the v0.1 draft promoted to stable, with these deliberate changes:

- `formatVersion` moves from the `0.x` pattern to `1.x`. The schema `$id` and `title` are updated to say v1.
- From v1, changes within the major version are additive only; readers ignore unknown fields, and `x-` prefixed fields remain allowed for experiments (carried from the draft).
- Field meanings are unchanged from the draft; the draft already matches what the census and the engine spec emit. Rooms, exits, objects, items, text fixes, chapters, cutscenes, conditions and milestones keep their shapes.

The format document (`FORMAT.md`) is the draft `FORMAT.md` rewritten for v1: it drops the "draft, breaking changes allowed" language, states the v1 stability promise, and keeps the hotspot-API alignment table, the per-section field rules, and the writing rules. It stays in step with `schema.json` field for field (Requirement 1.8).

### Schema shape (unchanged in structure from the draft)

Top-level required keys: `format`, `formatVersion`, `game`, `pack`, `rooms`. Optional: `textFixes`, `chapters`, `items`, `cutscenes`, `milestones`, plus `$schema` and `x-` fields.

Key `$defs` carried from the draft:

- `slug`, `numKey` (string of digits), `text` (non-empty, no em dash), `note`.
- `room` (requires `chapters`, `name`, `short`, `long`, `seen`, `exits`, `objects`), `exit` (requires `label`, `to`), `object` (requires `name`, `type`).
- `item` (requires `id`, `chapters`, `name`, `description`).
- `textFix` (requires `from`, `to`, `context`, `reason`).
- `chapter` (requires `name`, `startRoom`, `summary`).
- `cutscene` (requires `chapter`, `trigger`, `hasDialogue`, `description`, `seen`).
- `condition` (at least one key; `chapter`, `room`, `flags`, `has`, `lacks`, `all`, `any`, `not`, `milestone`).
- `milestone` (requires `id`, `chapter`, `title`, `recap`, `hints`; `oneOf` `when` or `end`; `hints` requires all three tiers).

The em-dash ban (Requirement 1.7) is the `text` def's `"not": { "pattern": "—" }`, applied to every spoken field. Length bounds (Requirement 2.5) are the `maxLength` on `name`, `label`, `short` and `title`.

## Validator (`validate.ts`)

The validator runs in two stages and collects all errors before exiting.

### Stage 1: schema validation

Uses Ajv with the 2020-12 dialect. Compiles `schema.json`, validates the pack, and maps each Ajv error to a `{ path, message }` record keyed by the JSON pointer (Requirement 5.1). A failure here does not stop stage 2; both stages run so the author sees every problem at once.

### Stage 2: cross-reference checks

Rules the schema cannot express (Requirement 5.2):

| Check | Rule | Requirement |
|---|---|---|
| Item uniqueness | each `(item.id, chapter)` across `items` is unique | 3.1 |
| `after` ids exist | every id in any milestone `after` is a defined milestone | 4.5 |
| No `after` cycles | the `after` graph is a DAG (depth-first with a visiting set) | 4.6 |
| `milestone` refs exist | every `condition.milestone` id is a defined milestone | 4.7 |
| Flag range | every flag index in any `condition.flags` is 0 to 49 | 6.1, 6.2 |
| Per-chapter flags | a milestone `when.flags` index is in range for that milestone's chapter | 6.4 |

Flag discovery: conditions nest (`all`/`any`/`not`), so a small recursive walk collects every `flags` key and every `milestone` ref from a condition tree, then checks them. The same walk is reused by the coverage checker.

### Exit status and output

`validate` collects schema errors and cross-reference errors into one list. Empty list is success (exit 0); a non-empty list prints every error with its path and exits non-zero (Requirement 5.3). No first-error short-circuit.

## Coverage checker (`coverage.ts`)

The checker compares a pack to the census for the covered chapters (`pack.coverage.chapters`).

### Inputs from the census

- `chapters.<n>`: the rooms in chapter `n`.
- `roomChapters.<room>`: which chapters a room appears in.
- `rooms.<room>.objects[]`: each with `num`, `door`, `toRoom` (for doors), `visible`.
- `exitGraph.<room>`: the rooms reachable from a room.
- `doorGates`: `(chapter, doorObject, flag)` triples; the flags here are real flags for the covered chapters (Requirement 6.3).

### Checks

1. **Room presence** (Requirement 7.2). For each census room in a covered chapter, the pack has a `rooms.<room>` whose `chapters` include that chapter. Missing rooms are reported.
2. **Hotspot presence** (Requirement 7.3). For each census object number in a covered room, that number is a key under the pack room's `exits` or `objects`. The pack carries one entry per number even when the engine shares a number across several hotspots (Requirement 2.4), so the check is on the set of numbers.
3. **Door destinations** (Requirement 7.4). For each census door (`door: 1` with `toRoom`), the pack has an `exits` entry for that number and its `to` equals the census `toRoom`. A mismatch is allowed only when the pack entry carries a `note` documenting a chapter-specific override (for example the inn's curtained doorway, engine data room 63 but `to: null` in chapter 1 because it runs the bedtime cutscene).
4. **Stale entries** (Requirement 7.5). Any pack room, hotspot number or exit that the census does not have for a covered chapter is reported, so the pack cannot drift ahead of or behind the census.
5. **Exit-graph agreement** (Requirement 7.6). Every pack exit `to` (when not `null`) is checked against `exitGraph.<room>`. A destination the graph does not list is reported. A `to: null` exit must carry a note saying it ends a chapter or runs a scene; otherwise it is reported.

The override mechanism is the entry's `note` field. The checker treats a door-destination or `to: null` difference as resolved only when a note is present; this keeps real coverage gaps loud while letting the handful of documented engine quirks through.

### Exit status and output

The checker collects every gap (missing room, missing hotspot, wrong or undocumented destination, stale entry) and exits non-zero if the list is non-empty, printing all gaps (Requirement 7.7).

## Hint-selection rule (`hints.ts`)

The no-spoiler invariant (Requirement 4, 8.4) lives in one pure function so it can be property-tested in isolation and reused by the hints/ghost spec later.

```
offeredMilestones(pack, progress) -> Milestone[]
  progress = { chapter, reached: Set<milestoneId> }
  a milestone m is offered iff:
    - m is not in progress.reached, and
    - every id in m.after is in progress.reached
  (prefer by current room, then file order, is a presentation concern,
   not part of the invariant)
```

The function depends only on the `after` graph and the reached set, not on live flags, so the invariant "no hint fires for a milestone ahead of the player" is a statement about this function: it never returns a milestone whose `after` are unmet, and never returns one already reached. The runtime latching of `when`/`end` into the reached set belongs to the hints/ghost spec; here we only need the set to reason about ordering.

## Testing strategy

Tests are TypeScript + fast-check, under `packs/tools/test/`. They touch nothing outside `packs/` and `reference/` (the latter read-only).

### Example-based tests

- The real `drascula-en.json` validates clean (schema + cross-reference).
- The real pack passes coverage against the real census for chapters 1 and 2.
- Known-bad fixtures fail: an out-of-range flag, a missing hint tier, an `after` cycle, a dangling `after` id, a door `to` that disagrees with the census and has no note.

### Property-based tests (the three invariants)

1. **Coverage invariant** (Requirement 8.2). Over the real pack and census, assert every census room, hotspot and door in chapters 1 and 2 has an entry. This is a property over the census data: for all covered rooms and all their object numbers, the pack has the key.
2. **Real-flags invariant** (Requirement 8.3). Walk every condition in every milestone; assert every flag index is 0 to 49 and in range for that milestone's chapter. Generators also build conditions with random flag indices and assert the validator flags out-of-range ones.
3. **No-spoiler invariant** (Requirement 8.4, 8.5). A fast-check arbitrary builds a random `after`-consistent reached set (a downward-closed set over a generated DAG of milestones) and a current chapter. Assert `offeredMilestones` returns only milestones whose `after` are all reached and that are not themselves reached. Shrinking gives a minimal counterexample if the rule is ever wrong.

### Generators (`gen.ts`)

- `arbMilestoneGraph`: a small DAG of milestone ids with `after` edges, plus hint tiers and a chapter.
- `arbReachedSet`: a downward-closed subset of a graph's nodes (if a node is reached, so are all its `after`), so generated progress states are always consistent.
- `arbCondition`: nested `all`/`any`/`not` trees with `flags`, `has`, `lacks`, `room`, `chapter`, `milestone`, used to test the condition walk and the flag-range check.
- `arbMalformedFragment`: deliberately invalid pieces (out-of-range flag, both `when` and `end`, missing a hint tier, cyclic `after`) to assert the validator rejects them (Requirement 8.6).

### Tooling

- Ajv (2020-12) for schema validation.
- fast-check for properties.
- A TypeScript test runner (Vitest or node:test with tsx); the tasks phase picks one and pins it. Current Ajv and fast-check API details are confirmed via the Context7 power when the tools are built, so the glue uses real, current APIs.

## Pack migration and review

1. **Move.** Copy `reference/pack-draft/drascula-en.json` to `packs/drascula-en.json`. The draft stays in place as the reference record (Requirement 9.1); it is not deleted or edited.
2. **Upgrade.** Set `formatVersion` to the v1 value, point `$schema` at `packs/schema.json`, and bump `pack.version` to mark the content revision (Requirement 9.5). No field shapes change.
3. **Validate.** Run the validator until clean (Requirement 9.2).
4. **Cover.** Run the coverage checker for chapters 1 and 2; resolve every gap or attach a documented override note (Requirement 9.3). The known quirks (inn doorway `to: null`, the chapter-1 street door that is a door in data but switched off) become documented notes, not silent omissions.
5. **Review.** Read the pack against `.kiro/steering/pack-writing.md`: British English, plain short sentences, no em dashes (also enforced by the schema), concrete left-to-right positions, lower-case item names unless proper nouns, spoiler-free descriptions, and three fresh hint tiers per milestone (Requirement 9.4, 9.6).

## Licensing and process

- Everything here is under `packs/` and carries the repo's MIT licence (Requirement 10.1, 10.3). No `engine/`, `scripts/`, or `vendor/` file is touched.
- No key or secret appears in the pack or the tools (Requirement 10.4).
- After each phase and each task, a dated entry is appended to `docs/kiro-process.md` and committed, and the `docs/kiro-features.md` row for property-based testing (fast-check) is updated when those tests first land (Requirement 10.5, per the process-log steering).

## Open questions deferred to later specs

- Runtime latching of `when`/`end` into the reached set, and evaluating `flags`/`has`/`lacks` against live engine state, belong to the hints/ghost spec. This spec only defines the data and the ordering rule.
- Speaker names from text colours, and the sonar's use of positions, are other specs. The pack carries no positions (those are live engine data).
- Chapters 3 to 6 coverage is a stretch goal; the format and the checker already handle arbitrary covered-chapter lists, so no format change is needed to add them later.
