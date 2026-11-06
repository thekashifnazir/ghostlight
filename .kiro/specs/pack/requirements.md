# Requirements: pack

## Introduction

The pack spec defines the accessibility pack format and the first pack. The engine supplies live state (room number, hotspot numbers and positions, inventory ids, progress flags); the pack supplies the words a blind player needs: room names and descriptions, exit labels, spoken object names, item names, fixes for bad engine strings, cutscene audio description, and progress milestones with graded hints. This is the data-file answer to the 2021 ScummVM tracker comment that a hotspot metadata format and test data for one game come first. Drascula chapters 1 and 2 are that first test data.

This spec delivers four things, all living under `packs/`:

1. **Format v1.** A documented JSON pack format with a JSON Schema (2020-12) and a human-readable format document, promoted from the `reference/pack-draft/` v0.1 draft to a stable v1.
2. **A TypeScript validator.** Schema validation plus the cross-reference rules a schema cannot express (milestone `after` graphs, flag references, item `(id, chapter)` uniqueness, text-fix targets).
3. **A coverage checker.** Checks a pack against `reference/census.json`: every census room, hotspot and door in the covered chapters has a pack entry, and every exit destination lines up with the census exit graph.
4. **The Drascula chapter 1 to 2 pack**, at `packs/drascula-en.json`, carried over from the draft, re-validated, and reviewed against the pack-writing steering.

Property-based tests (TypeScript + fast-check) back the validator and checker with the three invariants the project cares about: every census room, hotspot and door has an entry; every milestone condition refers to real flags; and no milestone hint fires for a milestone ahead of the player.

### Scope boundaries

- **Owns:** everything under `packs/` (the schema, the format document, the validator and checker source and their tests, and `drascula-en.json`).
- **Reads, never writes:** `reference/census.json` and `reference/pack-draft/` (the source material), and `.kiro/steering/pack-writing.md` (the review rules).
- **Never touches:** `engine/`, `scripts/`, `vendor/`. This spec authors no engine code, no build or fetch scripts, and never edits the pinned ScummVM checkout. It consumes the census that another spec produced; it does not regenerate it.

### Terms

- **census:** `reference/census.json`. Ground truth for which rooms exist, which chapters they appear in, each room's objects (with `num`, `door`, `toRoom`), the exit graph, door gates, chapter start rooms, and animation (cutscene) names.
- **covered chapters:** the chapters listed in `pack.coverage.chapters`. For `drascula-en.json` that is `[1, 2]`.
- **hotspot number:** the engine's own per-room object number (census `rooms.<room>.objects[].num`), used as the JSON object key under a room's `exits` or `objects`.
- **flag:** one of the engine's 50 per-chapter progress variables. Flags reset at each chapter start and the numbers are reused, so a flag reference only means something inside one chapter.
- **milestone:** a progress step with an `id`, a `chapter`, a reach condition (`when`) or an `end` marker, optional `after` prerequisites, and three graded hint tiers (nudge, clue, answer).
- **reached:** a milestone is reached once its `when` holds in its chapter (or the chapter ends, for an `end` milestone), and it stays reached in every later chapter (latched).

Requirements use EARS (Easy Approach to Requirements Syntax).

## Requirements

### Requirement 1: A stable v1 pack format with a schema

**User story:** As a pack author and as the web player, I want a documented, versioned pack format with a machine-readable schema, so that packs can be validated and read with confidence across games and languages.

#### Acceptance criteria

1. THE pack format SHALL be defined by a JSON Schema (`packs/schema.json`) written to JSON Schema draft 2020-12.
2. THE format SHALL be documented in a human-readable format document (`packs/FORMAT.md`) that describes every top-level section, every field, and the writing rules.
3. WHERE a pack declares its format, it SHALL carry `format: "scummvm-a11y-pack"` and a `formatVersion` string, and the schema SHALL constrain `formatVersion` to the `1.x` range.
4. THE schema SHALL define the sections `game`, `pack`, `textFixes`, `chapters`, `rooms`, `items`, `cutscenes`, and `milestones`, and SHALL require at least `format`, `formatVersion`, `game`, `pack`, and `rooms`.
5. WHERE a reader encounters a field it does not know that is prefixed `x-`, the schema SHALL permit it, so that experiments do not break validation.
6. WHEN a document presents a numeric engine id as a key THEN the schema SHALL require it to be a string of digits (for example `"62"`).
7. THE schema SHALL forbid em dashes in any spoken text field, so that the no-em-dash writing rule is enforced mechanically.
8. THE format document and the schema SHALL agree: every field named in one SHALL exist in the other with the same meaning.

### Requirement 2: Rooms, exits and objects

**User story:** As the web player, I want each covered room to carry a name, a short and long description, its exits and its objects, so that the player hears where they are, what is here, and where they can go.

#### Acceptance criteria

1. WHERE a room is defined, the schema SHALL require `chapters`, `name`, `short`, `long`, `seen`, `exits`, and `objects`.
2. WHERE an exit is defined, the schema SHALL require a spoken `label` and a `to` destination (a room number, or `null` when walking through ends a chapter or runs a scene), and SHALL allow an optional `direction` and an optional `opensWhen` condition.
3. WHERE an object is defined, the schema SHALL require a spoken `name` and a `type` of `object`, `exit`, or `npc`, and SHALL allow an optional `description`.
4. WHEN several engine hotspots share one number THEN the pack SHALL carry one entry per number, and a reader SHALL de-duplicate on the number.
5. THE room `name`, object `name`, and exit `label` SHALL be length-bounded by the schema so that spoken labels stay short.
6. WHERE a description is written, it SHALL name what is present without solving any puzzle, per the pack-writing rules.

### Requirement 3: Items, text fixes, chapters and cutscenes

**User story:** As the web player, I want inventory names, string fixes, chapter summaries and cutscene descriptions in the pack, so that the player hears correct, English, spoiler-free text throughout.

#### Acceptance criteria

1. WHERE an item is defined, the schema SHALL require `id`, `chapters`, `name`, and `description`, and the validator SHALL require each `(id, chapter)` pair to be unique across the items list.
2. WHERE a text fix is defined, the schema SHALL require `from`, `to`, `context` (`hotspot`, `dialogue`, or `any`), and `reason` (`spanish`, `typo`, `spelling`, or `clarity`), and SHALL allow a `match` of `exact` (default) or `substring` and a `rooms` restriction.
3. WHERE a chapter is defined, the schema SHALL require `name`, `startRoom`, and a `summary` spoken as "previously" at the next chapter's start.
4. WHERE a cutscene is defined, it SHALL be keyed by the engine's animation function name and SHALL require `chapter`, `trigger`, `hasDialogue`, `description`, and `seen`.
5. WHERE text is marked `seen: true`, it SHALL have been written from the actual picture or frames; `false` SHALL mean it was written from object names and game text only.

### Requirement 4: Conditions and milestones with graded hints

**User story:** As the ghost hint engine, I want progress milestones with conditions and three graded hint tiers, so that hints are keyed on the player's real progress and never spoil a puzzle the player has not reached.

#### Acceptance criteria

1. WHERE a condition is defined, the schema SHALL allow `chapter`, `room`, `flags`, `has`, `lacks`, `all`, `any`, `not`, and `milestone`, and SHALL require at least one key, with all present keys holding together (AND).
2. WHERE a milestone is defined, the schema SHALL require `id`, `chapter`, `title`, `recap`, and `hints`, and the `id` SHALL be a dotted lower-case string (for example `ch2.handbag`).
3. WHERE a milestone defines its reach, it SHALL carry exactly one of `when` (a condition) or `end: true`; the schema SHALL reject a milestone that has both or neither.
4. WHERE a milestone defines hints, the schema SHALL require all three tiers: `nudge`, `clue`, and `answer`.
5. WHERE a milestone lists `after` prerequisites, the validator SHALL require every listed id to be a milestone defined in the same pack.
6. THE validator SHALL reject a cycle in the `after` graph, so that a milestone can never depend on itself directly or transitively.
7. WHERE a condition or milestone refers to a `milestone` id, the validator SHALL require that id to exist in the pack.

### Requirement 5: TypeScript validator

**User story:** As a pack author, I want a validator that catches both schema errors and cross-reference errors, so that a bad pack fails loudly before it ships.

#### Acceptance criteria

1. WHEN the validator runs on a pack THEN it SHALL first check the pack against `packs/schema.json` and SHALL report every schema violation with its JSON path.
2. WHEN the validator runs THEN it SHALL check the cross-reference rules the schema cannot express: `(id, chapter)` item uniqueness (R3.1), `after` ids exist (R4.5), no `after` cycles (R4.6), referenced `milestone` ids exist (R4.7), and every flag referenced by a condition is a valid flag index for the engine (R6).
3. WHEN the validator finds no errors THEN it SHALL exit with a success status; WHEN it finds any error THEN it SHALL exit with a failure status and a list of all errors found, not just the first.
4. THE validator SHALL be written in TypeScript and SHALL run without touching `engine/`, `scripts/`, or `vendor/`.
5. WHERE the validator reads the schema and the pack, it SHALL treat both as data and SHALL make no network calls.

### Requirement 6: Milestone conditions refer to real flags

**User story:** As the ghost hint engine, I want every flag a milestone condition names to be a real engine flag, so that a condition can actually be evaluated against live state.

#### Acceptance criteria

1. THE validator SHALL know the engine's flag range (the 50 per-chapter progress flags, indices `0` to `49`).
2. WHEN a condition names a flag index outside that range THEN the validator SHALL report it as an error.
3. WHERE the census records door gates as `(chapter, doorObject, flag)` triples, the checker SHALL treat those flag numbers as real flags for the covered chapters and SHALL not report a pack condition that uses them as unknown.
4. WHEN a milestone's `when` condition uses `flags` THEN the validator SHALL confirm each flag index is in range for the milestone's own chapter, because flags are per-chapter.

### Requirement 7: Coverage checker against the census

**User story:** As a pack author, I want a checker that compares the pack to the census, so that no room, hotspot or door in the covered chapters is left without words.

#### Acceptance criteria

1. WHEN the checker runs THEN it SHALL read `reference/census.json` and the pack, and SHALL consider only the chapters in `pack.coverage.chapters`.
2. WHEN a census room belongs to a covered chapter THEN the checker SHALL require a matching `rooms.<room>` entry in the pack whose `chapters` include that chapter.
3. WHEN a census room object has a hotspot number THEN the checker SHALL require that number to appear as a key under that room's `exits` or `objects` in the pack.
4. WHEN a census object is a door (`door: 1` with a `toRoom`) THEN the checker SHALL require a pack `exits` entry for that number, and the entry's `to` SHALL equal the census `toRoom`, unless the pack entry carries a documented override note explaining a chapter-specific difference.
5. WHEN the pack defines a room, hotspot or exit that the census does not have for a covered chapter THEN the checker SHALL report it, so that stale entries are caught.
6. WHEN the pack's exit destinations are compared to the census `exitGraph` THEN the checker SHALL report any destination the exit graph does not support, except where a `to: null` exit is documented as ending a chapter or running a scene.
7. THE checker SHALL exit with a failure status WHEN any room, hotspot or door in a covered chapter is uncovered, and SHALL list every gap.

### Requirement 8: Property-based tests

**User story:** As the project, I want property-based tests that assert the pack's structural guarantees over generated inputs, so that the validator and checker hold for cases a fixed example would miss.

#### Acceptance criteria

1. THE tests SHALL use fast-check and SHALL run in TypeScript, without touching `engine/`, `scripts/`, or `vendor/`.
2. THE tests SHALL assert that for the Drascula pack, every census room, hotspot and door in the covered chapters has a pack entry (the coverage invariant).
3. THE tests SHALL assert that every milestone condition in the pack refers only to flags in the valid range for that milestone's chapter (the real-flags invariant).
4. THE tests SHALL assert that no milestone's hint is offered for a milestone that is ahead of the player: for any reachable progress state, a milestone is offered only when all its `after` prerequisites are reached and the milestone itself is not yet reached (the no-spoiler invariant).
5. WHERE the no-spoiler invariant is tested, the tests SHALL generate progress states (reached-milestone sets consistent with the `after` graph) with fast-check and SHALL assert that the hint-selection rule never returns a milestone whose prerequisites are unmet or that is already reached.
6. WHERE a generator builds a pack fragment, the tests SHALL also assert the validator rejects deliberately malformed fragments (out-of-range flags, missing hint tiers, `after` cycles, dangling `after` ids).

### Requirement 9: The Drascula chapter 1 to 2 pack

**User story:** As a judge and as a blind player, I want the Drascula chapters 1 and 2 pack present, valid, covered and well written, so that it is the working first pack and the proof the format carries a real game.

#### Acceptance criteria

1. THE pack SHALL live at `packs/drascula-en.json`, carried over from `reference/pack-draft/drascula-en.json`, and the draft SHALL be left untouched as the reference record.
2. THE pack SHALL declare `pack.coverage.chapters` of `[1, 2]` and SHALL validate clean against `packs/schema.json` and the validator.
3. THE pack SHALL pass the coverage checker against `reference/census.json` for chapters 1 and 2, with any census-versus-pack difference either resolved or carried as a documented override note.
4. THE pack text SHALL be reviewed against `.kiro/steering/pack-writing.md`: British English, plain short sentences, no em dashes, concrete over atmospheric, left-to-right positions, lower-case item names unless proper nouns, spoiler-free descriptions, and three hint tiers per milestone written in the pack's own words.
5. WHERE the pack was upgraded from `formatVersion` 0.1 to the v1 format, the upgrade SHALL be recorded, and `pack.version` SHALL be set to reflect the content revision.
6. THE pack SHALL NOT be assembled by copying any published walkthrough; hint text SHALL be the pack's own words.

### Requirement 10: Layout, licensing and the process log

**User story:** As the project, I want the pack work laid out, licensed and logged the way the repo rules require, so that it is reusable and the Kiro process is visible.

#### Acceptance criteria

1. THE pack, schema, format document, validator, checker and tests SHALL live under `packs/`, with no file created or edited under `engine/`, `scripts/`, or `vendor/`.
2. THE pack file SHALL be named `<gameId>-<lang>.json` (`drascula-en.json`), and all its text SHALL be in that language.
3. THE validator and checker and their tests SHALL carry the repo's MIT licence, as everything outside `engine/` does.
4. THE pack SHALL NOT contain any API key or secret.
5. WHEN a spec phase or a task in this spec completes THEN a dated entry SHALL be appended to `docs/kiro-process.md` and committed, per the process-log steering.
