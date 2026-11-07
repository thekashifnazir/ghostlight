# Tasks: description-variants

These tasks implement the design. Each cites the requirements it covers. Work spans `packs/` (schema, tools, format document, data) and `src/` (player resolver, pack reader, main wiring). Only the final task edits `src/main.ts`. This spec authors no code under `engine/`, `scripts/`, or `vendor/`, and adds no engine flags. Reuse the existing `Condition` shape in `packs/schema.json` and the pure evaluator in `src/hints/reached.ts`; do not define a second condition evaluator. Follow the process-log rule: log and commit (with explicit paths) after each task.

- [x] 1. Add the describable union to the schema
  - In `packs/schema.json`, add a `descriptionVariant` `$def` (required `when` referencing `#/$defs/condition` and `text` referencing `#/$defs/text`, optional `note`, `additionalProperties: false` with the `^x-` allowance) and a `describable` `$def` as a `oneOf` of a plain `#/$defs/text` and an object with required `default` (text) and `variants` (array, `minItems: 1`, items `descriptionVariant`).
  - Add a `shortDescribable` variant of the def that applies `maxLength: 300` to both the plain-string branch and the object form's `default` and variant `text`, so the current `short` cap is preserved.
  - Point `$defs.room.properties.short` at `shortDescribable`, `$defs.room.properties.long` at `describable`, and `$defs.object.properties.description` at `describable`.
  - Confirm a plain-string pack still validates (the `oneOf` string branch) and that unknown keys on a variant or description object are rejected except `x-`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 2. Document variants in FORMAT.md
  - In `packs/FORMAT.md`, under the room and object sections, document the describable union: the plain-string form (common case), the object form (`default` plus an ordered `variants` list), each variant as `when` + `text` (+ optional `note`), first match wins, default applies when none match, and `when` is the same `Condition` used by `milestone.when` and `exits.opensWhen`.
  - State the additive-only stability promise: existing plain-string packs remain valid.
  - Add a worked example using the room 5 church window (boarded default, opened-when-flag-8 variant), walking the schema field by field so document and schema agree.
  - _Requirements: 1.1, 1.4, 1.6_

- [x] 3. Types for describable in the pack tools
  - In `packs/tools/src/types.ts`, add `DescriptionVariant { when: Condition; text: string; note?: string }`, `VariantList { default: string; variants: DescriptionVariant[] }`, and `Describable = string | VariantList`.
  - Change `Room.short`, `Room.long`, and the object `description` type to `Describable` (description stays optional), matching the schema.
  - Add an `isVariantList(d): d is VariantList` discriminator helper.
  - Confirm `tsc --noEmit` passes for the tools package with the new types.
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 4. Validate variant conditions in the cross-reference stage
  - In `packs/tools/src/validate.ts`, add a pass in `validateCrossRefs` that, for each room, inspects `short`, `long`, and each object's `description`; when a value is the object form, run each variant's `when` through the existing `checkConditionFlags` (which uses `walkCondition`, so nested `all`/`any`/`not` are covered).
  - Use precise paths, for example `/rooms/5/short/variants/0/when`, `/rooms/5/long/variants/1/when`, `/rooms/5/objects/213/description/variants/0/when`.
  - For room description variants, pass a chapter for the flag-range message (the room's first covered chapter); the 0 to 49 bound itself is chapter-independent.
  - Collect every error into the existing list without short-circuiting.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 5. Keep coverage agnostic to description shape
  - In `packs/tools/src/coverage.ts`, add a local `hasDescription(d: Describable | undefined): boolean` helper (true for a non-empty string or an object-form value) and use it anywhere coverage reasons about description presence; leave room, hotspot, door and exit-graph checks otherwise unchanged.
  - Confirm the checker compiles against the new `Describable` types and that behaviour is identical for plain-string and object-form descriptions.
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 6. Validator and coverage tests for variants
  - Under `packs/tools/test/`, add tests: a variant `when` with flag 50 reports one range error at the variant path; a variant `when` with an unknown milestone reports one unknown-milestone error at the variant path; a nested `any`/`all` inside a variant `when` with a bad flag is caught; a pack with valid variants reports no new errors; and `drascula-en.json` with the room 5 variants added (fixture or the real pack) passes coverage with no new gaps.
  - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3_

- [ ] 7. The pure resolver
  - Add `src/model/variants.ts` with a pure `resolveDescription(d, state, reached)` that returns `d` when it is a string, otherwise returns the first variant whose `when` holds (evaluated with `evaluate` from `src/hints/reached.ts` against the `EngineHintState` and reached set), otherwise the `default`.
  - Define the player-side `Describable` type locally (import `Condition` from the pack tools types as `reached.ts` does), so the player does not depend on pack-tools runtime.
  - Guarantee exactly one return per call path; never zero, never more than one.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 8. Property test for single selection
  - Add a fast-check suite (player test setup) that generates arbitrary `EngineHintState` and reached sets and asserts: resolving any description yields exactly one string; with no matching variant the result is `default`; a plain-string description resolves to itself; and with two overlapping always-true-together variants the earlier one wins.
  - _Requirements: 2.4, 2.6, 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 9. State-aware accessors in the pack reader
  - In `src/model/pack.ts`, change the `short`, `long`, and object `description` fields of the local interfaces to the player-side `Describable` type.
  - Add `roomShortFor(room, state, reached)`, `roomLongFor(room, state, reached)`, and `objectDescriptionFor(room, num, state, reached)` that read the raw `Describable` and return `resolveDescription(value, state, reached)` when present, `undefined` when absent (so engine fallback is preserved). Replace the plain-string accessors with these `*For` accessors and update the small number of in-tree callers (controller examine path, any look-around reader) to pass the state and reached set.
  - Keep `objectDescriptionFor` scoped to objects and NPCs; exits still fall back to `exitLabel`.
  - Add unit tests for the accessors' plain, single-variant and overlapping cases.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 2.5_

- [ ] 10. Add the church-window variants to the pack
  - In `packs/drascula-en.json`, change room 5's `short` and `long` to the object form: keep the current boarded-window wording as `default`, and add one variant each with `when: { "flags": { "8": 1 } }` describing the window as forced open with the way into the church available, following pack-writing rules (plain British English, no em dashes, left-to-right positioning, no spoilers about how it opened or what to do next).
  - Run the validator and coverage checker against the updated pack and confirm no new errors.
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 11. Wire resolution and re-announce into main.ts (only this task edits src/main.ts)
  - In `src/main.ts`, make `readRoom()` and the long-description read use the state-aware accessors, passing the running `hintState` and the reached set obtained from the hint engine (exposed via a getter on the hint engine; wire the controller's examine path to the state-aware object accessor through its existing deps).
  - In `applyDiff`, on the same-room path (no `diff.room`, no `diff.chapter`): capture the resolved `short` and `long` (and reached set) before folding the diff, fold as today, recompute the resolved `short` and `long` after, and if either changed, call `readRoom()` exactly once after `announceSaid(diff)` and the inventory announcements.
  - Do not re-announce on the room/chapter-change path (it already announces once); ensure at most one re-announce per diff even when both short and long change.
  - Verify with the player's replay/test harness: entering or opening the church window in room 5 (flag 8 set via a same-room diff) re-announces the room once; an unrelated same-room diff does not re-announce; a room change still announces exactly once.
  - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 7.5_
