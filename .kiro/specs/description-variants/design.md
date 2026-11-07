# Design: description-variants

## Overview

Description variants let one pack description change with game state while keeping backward compatibility with the plain-string form. The design touches three layers, in order of dependency:

1. **Format** (`packs/schema.json`, `packs/FORMAT.md`, `packs/tools/src/types.ts`): a description value becomes "a spoken string, or an object with a `default` string and a `variants` array". Each variant carries a `when` condition (the existing `Condition`) and a `text` string.
2. **Tooling** (`packs/tools/src/validate.ts`, `packs/tools/src/coverage.ts`): the validator walks variant conditions through the same cross-reference checks it already runs for `milestone.when` and `exits.opensWhen`; the coverage checker reads a description's presence through a small accessor so the object form counts as present.
3. **Player** (`src/model/variants.ts`, `src/model/pack.ts`, `src/main.ts`): a pure resolver chooses one string from a description value given a complete engine state and the reached set, reusing the hint core's `evaluate`. The pack reader's description accessors become state-aware. `main.ts` re-announces the room once when a diff changes the resolved short or long.

The guiding constraint from the requirements and the project's accessibility rules: resolution is deterministic (exactly one string for any state, first match wins, default on no match), and every functional line still reaches the player's screen reader as text, now kept current as state changes.

The feature is additive. A pack that uses only plain strings validates, covers and resolves exactly as before, because the plain string is treated as "default, no variants".

## The shared condition shape, reused not redefined

The pack already defines a recursive `Condition` in `packs/schema.json` (`$defs.condition`) with `chapter`, `room`, `flags`, `has`, `lacks`, `all`, `any`, `not`, and `milestone`. It is already used by `milestone.when` and `exits.opensWhen`. A variant's `when` is a `{ "$ref": "#/$defs/condition" }`, so no new condition semantics are introduced.

On the player side, that shape already has one pure evaluator: `evaluate(cond, state, reached)` in `src/hints/reached.ts`, which takes an `EngineHintState` (complete folded flags + inventory + chapter + room, from `src/hints/fold.ts`) and the reached milestone set. The resolver reuses this evaluator verbatim. This is deliberate: variant selection and milestone reaching then share one definition of "does this condition hold", so they can never drift.

## Format design

### Description value shape

A description value (room `short`, room `long`, object `description`) becomes a union:

- **Plain form** (unchanged, the default-only case): a spoken `text` string.
- **Object form:**
  ```json
  {
    "default": "<spoken text>",
    "variants": [
      { "when": { /* condition */ }, "text": "<spoken text>", "note": "<optional>" }
    ]
  }
  ```

The order of `variants` is significant: the player picks the first whose `when` holds. The author writes the more specific or later-game states first when they would otherwise overlap.

### Schema changes (`packs/schema.json`)

Add one reusable `$def`, `describable`, expressing the union, and reference it from the three fields:

```json
"describable": {
  "oneOf": [
    { "$ref": "#/$defs/text" },
    {
      "type": "object",
      "required": ["default", "variants"],
      "additionalProperties": false,
      "patternProperties": { "^x-": {} },
      "properties": {
        "default": { "$ref": "#/$defs/text" },
        "variants": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/descriptionVariant" }
        }
      }
    }
  ]
},
"descriptionVariant": {
  "type": "object",
  "required": ["when", "text"],
  "additionalProperties": false,
  "patternProperties": { "^x-": {} },
  "properties": {
    "when": { "$ref": "#/$defs/condition" },
    "text": { "$ref": "#/$defs/text" },
    "note": { "$ref": "#/$defs/note" }
  }
}
```

Then, in `$defs.room.properties`, change `short` and `long` from `{ "$ref": "#/$defs/text", ... }` to `{ "$ref": "#/$defs/describable" }`. The `maxLength: 300` on `short` is kept by applying it inside the plain branch and the `default`/variant `text`; because `maxLength` on a plain string branch is the simplest place to keep it, the design keeps `short`'s 300-cap by wrapping the `describable` used for `short` so both the plain string and the `default`/`text` carry `maxLength: 300`. A `shortDescribable` variant of the def (identical but with `maxLength: 300` on the string branches) keeps the cap; `long` uses the uncapped `describable`.

In `$defs.object.properties`, change `description` from `{ "$ref": "#/$defs/text" }` to `{ "$ref": "#/$defs/describable" }` (uncapped, matching today's uncapped object description).

`$defs.text` already carries the em-dash ban and `minLength: 1`, so every variant `text` and every `default` inherits the spoken-text rules (Requirement 1.5). `additionalProperties: false` with the `^x-` allowance keeps unknown keys out while permitting experiments (Requirement 1.7).

### Types (`packs/tools/src/types.ts`)

Mirror the schema. Introduce:

```ts
export interface DescriptionVariant { when: Condition; text: string; note?: string; }
export interface VariantList { default: string; variants: DescriptionVariant[]; }
export type Describable = string | VariantList;
```

Change `Room.short`, `Room.long`, and `PackObject.description` to `Describable` (object `description` stays optional). A small helper `isVariantList(d): d is VariantList` (object with a `default` and `variants`) distinguishes the two forms; the tooling and the player both use the same discriminator logic (duplicated per layer since the player does not import pack-tools runtime, only types).

### FORMAT.md

Document the `describable` union under the room and object sections: the plain-string form stays the common case, the object form carries `default` plus an ordered `variants` list, each variant is `when` + `text` (+ optional `note`), first match wins, default applies when none match, and `when` is the same condition used by milestones and `opensWhen`. Add a worked example using the room 5 church window. State the additive-only promise: existing plain-string packs are still valid.

## Tooling design

### Validator (`packs/tools/src/validate.ts`)

`validateCrossRefs` already has `walkCondition` (collects flag indices and milestone refs through `all`/`any`/`not`) and `checkConditionFlags` (ranges flags, checks milestone refs, with an optional chapter for the flag-range message). Both are reused unchanged.

Add a pass that, for each room, inspects `short`, `long`, and each object's `description`:

- When the value is the object form, iterate `variants` and call `checkConditionFlags(variant.when, path, room.chapter-ish)` for each.
- The path is precise, e.g. `/rooms/5/short/variants/0/when`, `/rooms/5/long/variants/1/when`, `/rooms/5/objects/213/description/variants/0/when`.
- For room descriptions, pass a chapter for the flag-range message. A room may list several `chapters`; the design passes the room's first covered chapter (or omits the chapter note when ambiguous) purely for the human-readable message. The flag-range bound (0 to 49) is chapter-independent, so correctness does not depend on this choice; it only improves the message (Requirement 5.5).

Because `checkConditionFlags` runs through `walkCondition`, nested `all`/`any`/`not` inside a variant `when` are covered for free. All errors are pushed to the same `errors` array, so there is no short-circuit (Requirement 5.4). Schema validation (stage 1) already rejects malformed variant objects before cross-refs run.

### Coverage checker (`packs/tools/src/coverage.ts`)

Coverage checks presence of rooms, hotspots, doors and exit-graph agreement. It does not currently read description text, but the types change means `room.short`/`room.long` and `object.description` may now be objects. To keep coverage agnostic to description shape, add a tiny local helper `hasDescription(d: Describable | undefined): boolean` that returns true for a non-empty string or an object-form value, and use it only where coverage reasons about description presence (if anywhere). If coverage never inspects description text today, the only change is that the types compile against `Describable`; the checks run unchanged (Requirement 6.3). Either way, a described room or object stays "present" (Requirements 6.1, 6.2).

## Player design

### The resolver (`src/model/variants.ts`, new, pure)

A single pure function, with no I/O and no dependency on the DOM:

```ts
import { evaluate } from "../hints/reached.js";
import type { EngineHintState } from "../hints/fold.js";

export type Describable = string | { default: string; variants: Array<{ when: Condition; text: string }> };

export function resolveDescription(
  d: Describable,
  state: EngineHintState,
  reached: ReadonlySet<string>,
): string {
  if (typeof d === "string") return d;
  for (const v of d.variants) {
    if (evaluate(v.when, state, reached)) return v.text;
  }
  return d.default;
}
```

Properties this guarantees directly:

- Exactly one string returned for any input: the function has one return per path and always returns (Requirement 2.4).
- First match in document order (Requirements 2.1, 2.6).
- Default on no match (Requirement 2.2).
- Plain string returns itself without evaluating any condition (Requirements 2.3, 3.4).

The resolver imports the hint core's `evaluate` so variant and milestone condition semantics are one implementation (Requirement 2.5). The `Condition` type is imported from the pack tools types, matching how `reached.ts` already imports it.

### Pack reader (`src/model/pack.ts`)

The reader's description accessors currently return the raw string. They become state-aware by taking the complete state and reached set and delegating to the resolver. To keep the reader's current callers working and to make the change explicit, the design adds state-aware accessors rather than overloading the existing ones:

```ts
roomShortFor(room, state, reached): string | undefined
roomLongFor(room, state, reached): string | undefined
objectDescriptionFor(room, num, state, reached): string | undefined
```

Each reads the raw `Describable` (whatever the pack holds, now possibly the object form), and when present returns `resolveDescription(value, state, reached)`; when absent returns `undefined` so callers keep their existing engine fallback. The `PackData`/`PackRoom`/`PackObject` interfaces in `pack.ts` change `short`, `long`, and `description` from `string` to the local `Describable` type. The existing plain-string accessors (`roomShort`, `roomLong`, `objectDescription`) are either removed in favour of the `*For` accessors or kept returning the default form for any non-variant caller; the design prefers replacing them with the `*For` accessors and updating the small number of callers, so there is one path and no stale plain-string lookups. This keeps the memory of the examine/look flow intact: `objectDescriptionFor` still covers only objects and NPCs, exits still fall back to `exitLabel`.

### main.ts wiring (the only task that edits main.ts)

`main.ts` already maintains `hintState` (an `EngineHintState` seeded from each full room state and folded forward on each diff) and the reached set is available through the hint engine. The wiring:

1. **A reached set for the resolver.** The resolver needs `reached`. `main.ts` already drives `hintEngine.onEngineState(hintState)`; the design exposes the current reached set from the hint engine (a getter that returns the tracker's latched set) so `main.ts` can pass it to the pack accessors. Where a reached set is not yet available for a given description (variants that use only `flags`/`has` need no milestones), an empty set is a safe argument because `evaluate` treats a `milestone` leaf as unmet when the id is absent; the church-window variant keys on flag 8, so it does not depend on the reached set at all.
2. **`readRoom()` becomes state-aware.** It calls `pack.roomShortFor(state.room, hintState, reached)` instead of `pack.roomShort(state.room)`. The long-description read (the look-around path) calls `roomLongFor` similarly. Examine (in the controller) calls `objectDescriptionFor`. Because the controller resolves examine text, `main.ts` passes the resolver-aware accessors (or the state + reached) into the `Controller` through its existing `pack` + `currentRoom` deps; the controller change is small and does not itself count as a `main.ts` edit, but the dependency wiring that hands it state lives in `main.ts`.
3. **Re-announce on variant change.** In `applyDiff`, for the same-room path (no `diff.room` and no `diff.chapter`):
   - Before folding the diff, compute `beforeShort = roomShortFor(state.room, hintStateBefore, reachedBefore)` and `beforeLong = roomLongFor(...)`.
   - Fold the diff onto `hintState` as today, and update the reached set.
   - Compute `afterShort` / `afterLong` with the new state and reached set.
   - After `announceSaid(diff)` and the inventory announcements, if `afterShort !== beforeShort || afterLong !== beforeLong`, call `readRoom()` exactly once.

   This re-announce comes after the engine's own reply so the newest spoken line is the current room picture (Requirement 4.6), happens at most once even if both strings changed (Requirement 4.5), and is skipped entirely on the room/chapter-change path, which already calls `readRoom()` once (Requirements 4.3, 4.4). Because the room/chapter path returns early today, the same-room re-announce block only runs when the room did not change.

   The reached set "before" and "after" matters because a diff that sets a flag can both reach a milestone and flip a variant that keys on that milestone; capturing `reachedBefore`/`reachedAfter` keeps the comparison honest. For the church-window case the variant keys on flag 8 directly, so the diff that sets flag 8 flips `short`/`long` and triggers the single re-announce.

### Why compare resolved strings, not conditions

The re-announce trigger compares the resolved `short`/`long` strings before and after the diff, not the conditions. This is simpler and exactly correct: the player only needs to re-announce when the text the player would hear actually changes. Comparing strings also means a diff that moves between two variants resolving to the same text (unlikely but possible) correctly stays quiet (Requirement 4.4), and a diff that changes a flag unrelated to any variant leaves both strings equal and stays quiet.

## Data design: the church window (room 5)

Room 5 ("Behind the church fence") in `packs/drascula-en.json` describes the church front from behind the iron fence, with a boarded window. Exit 136 ("boarded window", to room 6) already carries `opensWhen: { "flags": { "8": 1 } }` and a note saying it works once flag 8 is set. Milestone `ch2.church` ("Got into the church") has `when: { "flags": { "8": 1 } }` and the recap "You prised the boards off a church window and climbed in."

So flag 8 is the authored signal that the window is open. The data change makes room 5's `short` and `long` into the object form:

- **`short` default (unchanged wording):** the boarded-window description that exists today.
- **`short` variant** `when: { "flags": { "8": 1 } }`: the same view but the window is now forced open and leads into the church, with the way in available. Boards lie broken; the way back to the cemetery is still on the right. No spoiler about how it was opened.
- **`long` default / variant:** same split, longer wording.

Text follows pack-writing rules: plain British English, no em dashes, left-to-right positioning, names only what is there. The variant does not say "use the iron spike" or "go inside now"; that is hint territory. Optionally, the object `213` ("other window") is left as a plain string; only the room `short`/`long` change, which is the minimum that proves the feature on a real event and matches the "secret passage opening" feedback. The milestone `ch2.church` is referenced by id only in prose here; the variant keys on flag 8, not on the milestone, because flag 8 is the direct engine signal and avoids any ordering dependency on when the milestone latches.

## Testing strategy

### Property test (pack tools, `packs/tools/test/`)

Using fast-check with the existing test runner:

- **Generators:** an arbitrary `EngineHintState` (chapter, room, an array of 50 small integers for flags, an inventory of arbitrary ids) and an arbitrary reached set.
- **Single selection:** for a fixed object-form description with several overlapping variants, `resolveDescription` returns a value that is a string, and is either one of the variant texts or the default, for every generated state (Requirement 8.1).
- **Default on no match:** build a description whose variants all key on flag values the generator is constrained not to produce, and assert the result equals `default` (Requirement 8.2).
- **Plain string:** for any generated state, a plain-string description resolves to itself (Requirement 8.3).
- **First match wins:** with two variants whose conditions both hold (for example `chapter: 2` and `room: 5`, both satisfied by a constrained state), assert the result is the first variant's text (Requirement 8.4).

The resolver under test is the player's `src/model/variants.ts` pure function. Since the pack tools and the player both need the same evaluator, the property test imports the resolver and the evaluator directly; if cross-package import is awkward, the resolver's tests live with the player and the pack-tools property test exercises an equivalent copy. The design's preference is a single resolver under `src/model/` tested by a fast-check suite that runs in the player's test setup, plus the pack-tools validator tests for the variant cross-ref checks.

### Validator tests (pack tools)

- A pack with a variant `when` referencing flag 50 reports one range error at the variant's path.
- A pack with a variant `when` referencing a non-existent milestone reports one unknown-milestone error at the variant's path.
- A pack with valid variants reports no new errors.
- A nested `any`/`all` inside a variant `when` with a bad flag is caught (proves the walk recurses).

### Coverage test (pack tools)

- The existing `drascula-en.json` with the room 5 variants added passes coverage with no new gaps (Requirement 6).

### Player resolver and re-announce

- Unit test `resolveDescription` for the plain, single-variant, and overlapping-variant cases.
- A focused test (or the end-to-end replay harness already used by the player) that, on a same-room diff setting flag 8 in room 5, the player re-announces the room once, and that a same-room diff not touching any variant flag does not re-announce. This exercises the `applyDiff` wiring added in the final task.

## Backward compatibility and risks

- **Additive schema change.** Every current description is a plain string, which the `oneOf` still accepts, so `drascula-en.json` and any other pack validate unchanged (Requirement 1.6).
- **`maxLength` on `short`.** Keeping the 300-cap across the plain string and the object form's `default`/`text` needs the `shortDescribable` variant of the def; the risk is forgetting the cap on the variant `text`. The schema design puts the cap on both string branches of `shortDescribable`.
- **Reached set availability.** Passing an empty reached set is safe for flag/inventory-only variants; milestone-keyed variants need the real set. The church example uses flag 8, avoiding the dependency, and the design still wires the real reached set through for correctness of any future milestone-keyed variant.
- **Double announcement.** The early return on the room/chapter path and the single `readRoom()` call in the same-room path guard against announcing twice (Requirements 4.3, 4.5).
- **Evaluator drift.** Reusing `src/hints/reached.ts` `evaluate` is the single safeguard against variant and milestone semantics diverging (Requirement 2.5).
