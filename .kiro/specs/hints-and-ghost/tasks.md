# Tasks: hints and ghost

New code lives under `src/hints/` (including the committed audio cache at `src/hints/ghost/`), `scripts/` and `test/`. Do not edit `packs/` or `vite.config.ts`; the pack is read-only input, and the cache lives under `src/` so Vite serves and builds it. Import `offeredMilestones` from the pack tools (`packs/tools/src/hints.ts`), do not reimplement it. Copy nothing from `reference/`. The pure core must have no DOM, engine or network dependency so fast-check can drive it directly. Only the final task touches the player, and only `src/ui/controller.ts` and `src/main.ts`, as a small additive change. Confirm current fast-check, Node `crypto`/Web Crypto and ElevenLabs power APIs via the relevant power as each is first used. Never print the ElevenLabs key. Real voice generation waits for Kash's go-ahead; `--dry-run` first.

- [x] 1. Fold diffs into a complete engine state (pure)
  - Create `src/hints/fold.ts` with `foldDiff(prev, diff): EngineHintState` where `EngineHintState` is `{ chapter, room, flags, inventory }` (full 50-flag array, full inventory). Apply the diff's sparse `flags` map onto a copy of `prev.flags`, add/remove `invAdded`/`invRemoved` on a copy of `prev.inventory`, take any `chapter`/`room` change's `to` value, and return a new object without mutating `prev`.
  - Add `test/hints-fold.test.ts`: changed flags land on the right indices with the rest unchanged; inventory deltas apply; chapter/room update; `prev` is not mutated.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 2. Reached-set derivation (pure)
  - Create `src/hints/reached.ts` with `satisfiedMilestones(pack, state, reached)` where `state` is the `EngineHintState` from `foldDiff` (or a room re-sync) and `reached` is the current latched set (for `when.milestone` references).
  - Implement a self-contained condition evaluator matching the pack's `Condition` semantics: `chapter`, `room` (equality or membership), `flags` map, `has`, `lacks`, `all`/`any`/`not`, `milestone`, with multiple keys combined as AND. Return the ids whose `when` holds now.
  - Unit-test the evaluator against each condition shape, including nested `all`/`any`/`not`.
  - _Requirements: 1.1, 1.2_

- [x] 3. Progress tracker with latching
  - Create `src/hints/progress.ts` with `ProgressTracker(pack)`: `update(state)` unions `satisfiedMilestones` into a latched reached set (add only, never remove), iterating to a fixed point so chained `when.milestone` satisfactions all latch in one call, and records the chapter; `progress()` returns `{ chapter, reached: ReadonlySet<string> }`.
  - Unit-test that a milestone stays reached after its `when` stops holding, and that updates never shrink the set.
  - _Requirements: 1.3, 1.4, 1.5_

- [x] 4. Target selection (pure), importing offeredMilestones
  - Create `src/hints/select.ts` with `selectTarget(pack, progress, room)`: call the imported `offeredMilestones(pack, progress)`, return `undefined` when empty, else pick one by preferring `rooms` including `room`, then required over `optional`, then pack/file order.
  - Unit-test the room preference, the optional deprioritisation, and the empty-set case.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 5. Tier progression (pure)
  - Create `src/hints/tiers.ts` holding tier state per milestone id: `nextTier(state, id)` returns `nudge` first then steps `clue`, `answer`, clamped at `answer`; `answerTier(state, id)` returns `answer` and records it; a new id starts at `nudge` (reset on target change); never skips a tier.
  - Unit-test the nudge→clue→answer→answer sequence, direct-answer recording, and per-id independence.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3_

- [x] 6. Cache key (pure, shared by script and playback)
  - Create `src/hints/cache.ts` with `cacheKey(text, voiceId, modelId)` (hex SHA-256 over a canonical join) and `cacheFileName(key)` → `<key>.mp3`, with one implementation usable from Node (the script) and the browser (playback) producing identical keys. Files live at `src/hints/ghost/`.
  - Unit-test that the Node and browser hash paths agree for the same inputs, and that changing any of text, voice or model changes the key.
  - _Requirements: 8.3, 8.8_

- [x] 7. HintEngine
  - Create `src/hints/engine.ts` with `HintEngine(pack, tracker)`: `onEngineState(state)` forwards to `tracker.update`; `ask(room)` selects the target and returns `{ kind: "none" }` or `{ kind: "hint", milestoneId, tier, text, audioKey }` using `nextTier` and `cacheKey`; `askAnswer(room)` uses `answerTier`, still only for an offered milestone.
  - Unit-test `ask` on a scripted progress sequence (none when nothing offered, correct text and key when offered) and `askAnswer` giving the answer directly for an offered milestone.
  - _Requirements: 2.6, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 5.2, 8.8_

- [x] 8. Ghost audio playback glue
  - Create `src/hints/audio.ts` with `GhostAudio(ctx)`: build a URL map with `import.meta.glob('./ghost/*.mp3', { query: '?url', eager: true })`; an `enabled` flag defaulting to on with a toggle; `play(key)` is a no-op when disabled, otherwise resolves `cacheFileName(key)` in the glob map and plays it, silently doing nothing if the key is absent from the map or playback fails; `stop()` stops immediately.
  - Unit-test that disabled `play` is a no-op, a key with no glob entry is silent (no throw), and `stop` is safe when nothing is playing.
  - _Requirements: 6.1, 6.2, 6.4, 6.5, 8.4_

- [-] 9. Voice generation script with dry-run
  - Create `scripts/gen-voice.ts`: load the pack via the pack tools, collect every milestone's `nudge`/`clue`/`answer`.
  - `--dry-run` mode: print the number of hint lines and their total character count (with a per-chapter or per-tier breakdown for cost estimation), make no ElevenLabs call and write nothing, then exit. This is the mode to run first.
  - Real mode (no `--dry-run`): compute each line's `cacheKey(text, "nbk2esDn4RRk4cVDdoiE", "eleven_v4")`, skip lines already present in `src/hints/ghost/`, and generate the rest through the ElevenLabs power (voice Alice, model `eleven_v4`), writing `<key>.mp3`.
  - Read the ElevenLabs key from `.env` by name; fail with a clear named-key message if missing; never print, log or write the key value. Print only counts (total, skipped, generated).
  - Run `--dry-run` and report the counts; do NOT run real generation until Kash gives the go-ahead. When approved, run it once to populate `src/hints/ghost/` and commit the files; confirm re-running skips everything.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.9, 8.10, 9.1, 9.2, 9.3, 9.4_

- [x] 10. Property tests for the invariants
  - Add `test/hints-select.prop.test.ts`: fast-check generates reachable progress (a chapter and an `after`-closed subset of milestone ids, plus a room); assert `selectTarget`'s defined result is always in `offeredMilestones(...)`, so never a milestone ahead of the player.
  - Add `test/hints-tiers.prop.test.ts`: for any count of plain asks on a fixed target, tiers are a prefix of `nudge, clue, answer` then repeated `answer`, never skipping; and a direct-answer ask only returns the `answer` of an offered milestone.
  - Run both against the real pack's milestones, with no live engine or network.
  - _Requirements: 10.1, 10.2, 10.3, 10.5_

- [x] 11. Cache-coverage test
  - Add `test/hints-cache.test.ts`: with the ElevenLabs call mocked (empty files written for computed keys, no key or network), run the generator over the real pack and assert every tier of every milestone has a file at `src/hints/ghost/<cacheKey(text, voice, model)>.mp3`.
  - _Requirements: 10.4, 10.5_

- [x] 12. Wire the hint key and diff fold into the player (additive)
  - Edit `src/ui/controller.ts`: add `askHint: () => void` to `ControllerDeps` and a single `case "h": case "H":` in `handleListKey` that calls `askHint()`. Change no existing binding. `stopAudio()` at the top of `handleKey` already runs first.
  - Edit `src/main.ts`: build a `ProgressTracker`, `HintEngine` and `GhostAudio`; keep a running `EngineHintState`; replace the `stopAudio` no-op with `() => ghostAudio.stop()`. In `applyRoom`, reset the running state to the room's full flags and inventory then call `hintEngine.onEngineState(state)`; in `applyDiff`, set the running state to `foldDiff(state, diff)` then call `hintEngine.onEngineState(state)`. Pass `askHint` to the controller (text to the live region first, then `ghostAudio.play` on a hint). Extend `HELP_TEXT` to mention the `H` hint key.
  - Verify an end-to-end run against a replay fixture: pressing `H` announces the nudge, then the clue, then the answer; a direct-answer path gives the answer; with nothing offered it says there is nothing to hint at; audio is silent when no file exists and stops on the next key; and the folded flags drive the reached set (a diff that sets a milestone's flag makes that milestone reached so the ghost no longer hints at it).
  - _Requirements: 5.1, 5.3, 5.4, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 11.6_

- [ ] 13. Final verification against requirements
  - Run the full test suite (the fold unit test, the two properties, the cache-coverage test, the other unit tests) with no live engine or network, and confirm the no-spoiler and tier-order invariants hold, diffs fold correctly, and every pack hint line is cached.
  - Confirm the player edits are limited to `src/ui/controller.ts` and `src/main.ts`, `packs/` is untouched, `vite.config.ts` is untouched, and the ElevenLabs key never appears in any output or committed file.
  - Walk each requirement and confirm it is met.
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 7.4, 9.2, 9.3, 11.1_
