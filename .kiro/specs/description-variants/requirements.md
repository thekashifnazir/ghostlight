# Requirements: description-variants

## Introduction

This spec adds conditional description variants to the accessibility pack format and the web player.

The need comes from tester feedback. A blind gamers' community moderator and accessibility consultant, who co-hosts the Games for Blind Gamers Discord, pointed out that a room can change in a way a sighted player sees at a glance but a blind player never hears about. When a secret passage opens, a window is forced, or a gate is unbarred, the picture changes but the pack's one fixed room description keeps describing the old state. A blind player is then told the window is still boarded up after they have just prised it open. The "what changed" diff line announces the single action, but the standing description the player can re-read on room entry or on examine is stale.

Today the pack gives each room one `short` and one `long` description, and each object one `description`. These are static strings. This spec lets a room's `short` and `long`, and an object's `description`, carry a list of variants, each guarded by a condition on engine flags or inventory, with the existing static string kept as the default when no variant matches. The condition reuses the pack's existing `Condition` shape (the one `milestone.when` and `exits.opensWhen` already use, defined in `packs/schema.json`), so authors and the validator reuse the semantics they already know.

The player picks the first matching variant on room entry and on examine. When a diff changes which variant a room's description resolves to, without a room change, the player re-announces the room once so the blind player hears the new state at the moment it changes.

The first real use of the feature is one chapter 1 or 2 event already present in the pack's milestones: the church window behind the fence (room 5), which opens a way into the church when engine flag 8 is set (milestone `ch2.church`).

### Scope boundaries

- **Owns (pack side):** the variant addition to `packs/schema.json`, the matching rules in the validator (`packs/tools/src/validate.ts`) and the coverage checker (`packs/tools/src/coverage.ts`) and their types (`packs/tools/src/types.ts`), the `packs/FORMAT.md` documentation of variants, and the variant data added to `packs/drascula-en.json` for the chosen event.
- **Owns (player side):** condition-aware description resolution in the pack reader (`src/model/pack.ts`), a small resolver/selection module under `src/model/`, and the re-announce-on-variant-change behaviour. Only the final task edits `src/main.ts`.
- **Reuses, does not redefine:** the `Condition` shape in `packs/schema.json`, and the pure condition evaluator in `src/hints/reached.ts` (`evaluate(cond, state, reached)`) together with the complete running state folded by `src/hints/fold.ts` (`EngineHintState`, `foldDiff`).
- **Never touches:** `engine/`, `scripts/`, `vendor/`. This spec authors no engine code and no build or fetch scripts. It does not add new engine flags; it reads the flags the engine already reports.

### Terms

- **variant:** an alternative description string guarded by a `when` condition. Attached to a room's `short`, a room's `long`, or an object's `description`.
- **default description:** the plain string form of `short`, `long`, or `description` that applies when no variant's condition matches. Backward compatible: a pack with no variants behaves exactly as today.
- **resolve:** given a complete engine state (all flags, full inventory, chapter, room) and the reached milestone set, choose the one description that applies: the first matching variant in document order, or the default when none match.
- **complete engine state:** the folded full state the player already maintains for hints (`EngineHintState`: chapter, room, all 50 flags, full inventory), not the sparse diff delta.
- **re-announce:** the player speaking the room again (name, resolved short, hotspots) through the live region, exactly as room entry does, triggered by a variant change within the same room.

Requirements use EARS (Easy Approach to Requirements Syntax).

## Requirements

### Requirement 1: A description field can carry variants

**User story:** As a pack author, I want a room's short and long descriptions and an object's description to carry condition-guarded variants with a default, so that I can describe a room or object differently once the game state changes without losing the original wording.

#### Acceptance criteria

1. THE schema SHALL allow a room's `short`, a room's `long`, and an object's `description` to be either the current spoken text string (the default-only form) or an object that carries a `default` spoken text string and a `variants` array.
2. WHERE a description is the object form, the schema SHALL require a `default` spoken text string and a `variants` array of at least one variant.
3. WHERE a variant is defined, the schema SHALL require a `when` condition and a spoken text string (`text`), and SHALL allow an optional author `note`.
4. THE `when` condition on a variant SHALL be the pack's existing `Condition` definition, so that `chapter`, `room`, `flags`, `has`, `lacks`, `all`, `any`, `not`, and `milestone` all carry their existing meaning.
5. THE variant `text` and the `default` string SHALL be subject to the same spoken-text rules as any other description, including the em-dash ban and the non-empty rule.
6. WHERE a pack uses only plain strings for every description, the schema SHALL accept it unchanged, so that existing packs and the default-only form remain valid.
7. THE schema SHALL forbid unknown keys on a description object and on a variant, except the `x-` experiment prefix the format already permits.

### Requirement 2: Resolving one description from state

**User story:** As the web player, I want exactly one description chosen for any game state, so that the player always hears a single, correct description and never an ambiguous or empty one.

#### Acceptance criteria

1. WHEN the player resolves a description against a complete engine state and the reached milestone set THEN it SHALL evaluate each variant's `when` in document order and choose the first whose condition holds.
2. WHEN no variant's condition holds THEN the player SHALL choose the `default` string.
3. WHEN a description is the plain-string (default-only) form THEN the player SHALL choose that string without evaluating any condition.
4. FOR ANY flag state and inventory, resolving a description SHALL yield exactly one string: never zero, never more than one.
5. THE resolver SHALL evaluate variant conditions with the same evaluator the hint core uses (`src/hints/reached.ts`), passing the same complete folded state (`EngineHintState`) and reached set, so that variant and milestone semantics never drift apart.
6. WHERE two variants' conditions both hold, the player SHALL choose the earlier one in document order, so that selection is deterministic regardless of overlap.

### Requirement 3: The player reads the resolved description on entry and on examine

**User story:** As a blind player, I want the room description I hear on entering a room, and the object description I hear when I examine something, to reflect the current game state, so that I am never told a window is boarded after I have opened it.

#### Acceptance criteria

1. WHEN the player announces a room on entry THEN the short description it speaks SHALL be the resolved `short` for the current complete state.
2. WHEN the player reads the long description (the fuller look-around) THEN it SHALL be the resolved `long` for the current complete state.
3. WHEN the player examines an object that has a description THEN the authored text it speaks SHALL be the resolved `description` for the current complete state.
4. WHERE a room or object has only a plain-string description, the player SHALL behave exactly as it does today, with no change to the announced text.
5. THE resolution SHALL use the running complete state the player already maintains for hints, not the sparse diff, so that conditions on unchanged flags evaluate correctly.

### Requirement 4: Re-announcing the room when a variant changes

**User story:** As a blind player, I want to hear the room again the moment its description changes because of something I did, so that a passage opening or a window being forced is announced, not silently left in a stale description.

#### Acceptance criteria

1. WHEN a diff is applied that does not change the room or chapter, AND the resolved `short` or `long` for the current room changes from before the diff to after it, THEN the player SHALL re-announce the room once.
2. THE re-announce SHALL speak the room exactly as room entry does (name, resolved short, current hotspots) through the existing live region, so that the player hears a complete, current picture.
3. WHEN a diff changes the room or chapter THEN the player SHALL announce the new room as it already does, and SHALL NOT additionally re-announce for a variant change, so that a room change produces exactly one room announcement.
4. WHEN a diff does not change which variant resolves THEN the player SHALL NOT re-announce the room, so that unrelated actions stay quiet.
5. THE re-announce SHALL happen at most once per diff, even when both `short` and `long` change, so that the player never hears the room twice for one action.
6. THE re-announce SHALL follow the engine's own reply for that diff in the live region so the player still hears what the action said, and the newest spoken line is the current room picture.

### Requirement 5: The validator checks variants

**User story:** As a pack author, I want the validator to check variant conditions the same way it checks every other condition, so that a bad flag reference or milestone reference in a variant is caught before the pack ships.

#### Acceptance criteria

1. WHEN the validator runs its cross-reference stage THEN it SHALL walk every variant `when` condition in rooms (`short`, `long`) and objects (`description`) through the existing condition walk, so that flag indices and milestone references in variants are checked.
2. IF a variant `when` references a flag index outside the engine's range (0 to 49) THEN the validator SHALL report an error naming the path to that variant.
3. IF a variant `when` references a milestone id that does not exist THEN the validator SHALL report an error naming the path to that variant.
4. THE validator SHALL collect every variant error alongside existing errors and SHALL NOT short-circuit on the first.
5. WHERE a room description's variant `when` uses `flags`, the validator SHALL treat the flag index against the room's chapter range exactly as it does for a milestone `when` in that chapter, so that variants and milestones are held to the same flag-range rule.

### Requirement 6: Coverage keeps working with variants

**User story:** As a pack author, I want the coverage checker to keep passing for a pack that uses variants, so that adding variants does not falsely report a room or hotspot as uncovered.

#### Acceptance criteria

1. WHERE a room's `short` or `long` is the object form, the coverage checker SHALL treat the room as having a description present, so that an existing covered room is not reported as missing a description because it gained variants.
2. WHERE an object's `description` is the object form, the coverage checker SHALL treat the object as described, so that a described hotspot stays described after gaining variants.
3. THE coverage checker's room, hotspot, door and exit-graph checks SHALL behave identically whether descriptions are plain strings or the object form, so that variants change nothing about coverage results.

### Requirement 7: One real event uses variants

**User story:** As a blind player of Drascula, I want at least one place in chapters 1 and 2 where opening a passage changes what I hear, so that the feature is proven on a real event, not only in tests.

#### Acceptance criteria

1. THE pack SHALL add description variants for one chapter 1 or 2 event that is already represented in the pack's milestones, where the room's state visibly changes (for example a passage or window opening).
2. WHERE the chosen event is the church window behind the fence (room 5, opened when engine flag 8 is set, milestone `ch2.church`), the room's `short` and `long` SHALL carry a variant whose `when` holds once the window is open, describing the window as forced open and the way into the church as available, with the boarded-up wording kept as the default.
3. THE variant text SHALL follow the pack-writing steering rules (plain British English, no em dashes, left-to-right positioning, no spoilers), and SHALL name only what is there without saying how the player opened it or what to do next.
4. THE pack with the added variants SHALL pass the validator and the coverage checker with no new errors.
5. WHEN the player enters room 5 with flag 8 set, or forces the window while standing in room 5 THEN it SHALL hear the opened-passage description, and before flag 8 is set it SHALL hear the boarded-up default.

### Requirement 8: Property-based proof of single selection

**User story:** As a maintainer, I want a property test proving the resolver picks exactly one description for any flag state and falls back to the default, so that the single-selection and backward-compatibility guarantees hold across the whole state space, not just the cases I thought of.

#### Acceptance criteria

1. THE property test SHALL generate arbitrary complete engine states (chapter, room, flag values, inventory) and assert that resolving any description yields exactly one string.
2. THE property test SHALL assert that when no variant's condition holds for the generated state, the resolved string is the `default`.
3. THE property test SHALL assert that a plain-string (default-only) description always resolves to that string regardless of state.
4. THE property test SHALL assert that when more than one variant could match, the resolver returns the earliest matching variant in document order.
5. THE property tests SHALL run with the pack tools' existing test runner and fast-check, under `packs/tools/test/`, and the player resolver's tests SHALL run with the player's existing test setup.
