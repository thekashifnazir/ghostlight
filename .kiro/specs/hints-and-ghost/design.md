# Design: hints and ghost

## Overview

This spec adds the ghost's help to the finished player. The player already turns engine state into an ordered hotspot list and writes every functional line to one polite live region. On top of that, this spec gives the player a single hint key: press it and the ghost tells you, in three tiers (nudge, clue, answer), what to do about the thing you are most likely stuck on right now. The hint is text in the live region first, and an optional whisper from the ghost on top.

All the hint content already lives in the pack. Every milestone carries a `when` condition (on chapter, flags, inventory and room), optional `after` prerequisites, optional `rooms`, an `optional` flag, and a `hints` object with `nudge`, `clue` and `answer` strings. The pack tools already expose `offeredMilestones(pack, { chapter, reached })`, which returns the milestones whose hints may be offered: not reached, all `after` prerequisites reached. This spec's work is the layer around that function:

- **Diff folding.** A full room state carries all 50 flags and the full inventory, but a diff carries only the flags that changed and the items gained or lost. Fold each diff onto a running full copy so the hint core always evaluates against a complete, current flag array and inventory.
- **Reached-set derivation and latching.** Turn that complete flags-and-inventory state into the `reached` set `offeredMilestones` wants, and latch it so a solved puzzle stays solved.
- **Selection.** Pick the one target milestone from the offered set, preferring the current room and the main path.
- **Tier progression.** Track which tier each milestone is on, step nudge → clue → answer on each ask, support asking straight for the answer.
- **Voice.** A build-time script generates one audio file per hint line with ElevenLabs into a content-addressed cache, and a thin playback path plays the cached whisper after the text, interruptibly.

The design keeps the hint core pure (plain data in, a hint decision out, no DOM, no engine, no network), so the no-spoiler and tier-order invariants are cheap to property-test. The only player files this spec edits are `src/ui/controller.ts` and `src/main.ts`, and the only new runtime key is the hint key.

### Where the code lives

New code lives under `src/hints/` (the pure core and the playback glue) and `scripts/` (the generator), MIT-licensed. The pack and its tools are read-only inputs.

```
src/
  hints/
    fold.ts             pure: previous full state + diff -> next full state (apply sparse flags + inv deltas)
    reached.ts          pure: full engine state (flags/inventory/chapter/room) + pack -> satisfied milestone ids
    progress.ts         ProgressTracker: latches the reached set across updates, exposes { chapter, reached }
    select.ts           pure: offeredMilestones(...) -> the one target milestone (room/main-path rule)
    tiers.ts            pure: tier state per milestone; next tier, direct answer, reset on target change
    engine.ts           HintEngine: ties reached+select+tiers into ask() / askAnswer() -> HintResult
    cache.ts            pure: hash(text, voice, model) -> cache key / file name (shared by script + playback)
    audio.ts            GhostAudio: resolve a cached file (import.meta.glob), play, stop, enabled flag
    ghost/              the generated hint cache (content-addressed .mp3), under src/ so Vite serves + builds it; committed
scripts/
  gen-voice.ts          build-time: every pack hint line -> ElevenLabs (Alice, eleven_v4) -> src/hints/ghost/; --dry-run counts only
test/
  hints-fold.test.ts           unit: diffs fold onto the running full state; previous state not mutated
  hints-select.prop.test.ts    fast-check: target is never ahead of the player
  hints-tiers.prop.test.ts     fast-check: tiers come in order and stay at answer
  hints-cache.test.ts          every pack hint line has a cache entry after generation
```

The hint cache lives at `src/hints/ghost/` rather than a top-level `public/ghost/`, because the Vite config sets `root: "src"` and `publicDir: false`, so a top-level `public/` is never served in dev or copied into `dist/`. Under `src/`, the audio is referenced as a bundled asset (`import.meta.glob('./ghost/*.mp3', { query: '?url', eager: true })`), which Vite resolves to hashed URLs for both dev and the build without any config change. The files are committed, since the hint lines are the project's own authored content.

`src/ui/controller.ts` and `src/main.ts` get a small additive change: the hint key, and the wiring of a `HintEngine` plus `GhostAudio` into the existing controller and boot, including folding each diff into the running full state before calling `onEngineState`. Nothing else in `src/` changes, and `packs/` is not touched.

### Design principles

- **Build on `offeredMilestones`, do not reimplement it.** This spec imports the pack tools' function and feeds it a latched reached set. The no-spoiler guarantee is that function's invariant; this spec's job is to hand it an honest `reached` set and never pick outside its result.
- **Pure core, thin glue.** Reached derivation, selection and tier progression are pure functions over plain data. The DOM-facing and audio-facing glue is thin and untested by properties; the properties hammer the pure core.
- **Text is the hint; audio is flavour.** The live region line is written first and is complete alone. Audio is best-effort on top and may be absent, disabled, or interrupted with no functional loss.
- **Latch reached.** A milestone, once satisfied, stays reached for the session, because a `when` condition can stop holding after the player moves on.
- **Content-addressed audio.** The cache key is a hash of the line text, the voice id and the model id, so editing a hint's words changes the file and the old whisper is never reused.

## Architecture

```
  hint key ─► ui/controller.ts ─► HintEngine.ask(state) ─► HintResult { text, line audio key }
                                     │                         │
                                     │                         ├─► LiveRegion.announce(text)   (always, first)
                                     │                         └─► GhostAudio.play(key)        (optional, interruptible)
                                     │
                     ┌───────────────┼────────────────────────────┐
                     ▼               ▼                             ▼
             reached.ts        select.ts (imports            tiers.ts
          satisfied ids    offeredMilestones from       tier state per
          from live state     packs/tools/hints)         milestone id
                     │               ▲
                     ▼               │
             progress.ts  ───────────┘
          latched { chapter, reached }

  build time:  scripts/gen-voice.ts ─► for each pack hint line ─► cache.ts key(text, voice, model)
                                         │  if not cached:
                                         └► ElevenLabs power (Alice, eleven_v4) ─► public/ghost/<key>.mp3
```

On every engine event, `main.ts` keeps a running full engine state: a room event resets it to that state's full flags and inventory; a diff event folds onto it via `foldDiff` (apply the sparse changed flags, add/remove the inventory deltas, update chapter and room). That complete state feeds the `ProgressTracker`, which latches reached milestones. On a hint key press, the controller asks the `HintEngine`, which selects the target, advances the tier, and returns a `HintResult`; `main.ts` writes the text then plays the audio.

## Components

### `src/hints/fold.ts` (pure)

`foldDiff(prev, diff): EngineHintState` takes the previous complete state and one `Diff` and returns the next complete state, without mutating `prev` (Requirement 11).

- `EngineHintState` is `{ chapter: number; room: number; flags: number[]; inventory: number[] }` — a full 50-flag array and the full inventory.
- Flags: copy `prev.flags`, then for each `[index, [from, to]]` in the diff's sparse `flags` map, set `flags[index] = to`. Unchanged flags keep their previous value (Requirement 11.2).
- Inventory: copy `prev.inventory`, add each `invAdded` id not already present, remove each `invRemoved` id (Requirement 11.3).
- Chapter/room: if the diff carries a `chapter` or `room` change, take its `to` value; otherwise keep `prev`'s (Requirement 11.4).
- Returns a new object; `prev` is untouched (Requirement 11.5). A room state re-sync (resetting the running copy to a full `RoomState`'s flags and inventory) is done in `main.ts` directly from the room event (Requirement 11.6), since that is a straight copy, not a fold.

This exists because a diff is a delta: its `flags` map lists only changed flags and its inventory fields are deltas, so evaluating conditions against a diff alone would read most flags as absent (gotcha 9). The fold reconstructs the full current state the hint core needs.

### `src/hints/reached.ts` (pure)

`satisfiedMilestones(pack, state, reached): Set<string>` evaluates each milestone's `when` condition against the complete engine state and returns the ids whose condition currently holds.

- `state` is the `EngineHintState` produced by `foldDiff` (or a room re-sync): `{ chapter, room, flags, inventory }`.
- Condition evaluation mirrors the pack's `Condition` semantics exactly: `chapter` equality; `room` equality or membership; `flags` map (each flag index equals the given value); `has` (all item ids present in inventory); `lacks` (none present); and the `all` / `any` / `not` combinators, plus `milestone` (satisfied when that milestone id is already reached — resolved against the latched set by the tracker, not here). A condition with multiple keys is an AND of them.
- This function is stateless: it reports what holds *now*. Latching is the tracker's job.

A small, self-contained condition evaluator lives here (the player's `pack.ts` reader does not expose one, and this spec does not edit it). The evaluator is written against the pack's documented `Condition` shape and is covered by the property tests through real milestone conditions.

### `src/hints/progress.ts` — `ProgressTracker`

Holds the latched reached set and the current chapter.

- `update(state)`: compute `satisfiedMilestones(pack, state)` (passing the current latched set so `when.milestone` references resolve), union the result into the latched reached set (add only, never remove), and record `state.chapter`. Because `when.milestone` can depend on another milestone being reached, `update` iterates to a fixed point within the call so a chain of same-tick satisfactions all latch.
- `progress(): { chapter, reached }`: the exact value `offeredMilestones` consumes, with `reached` as a `ReadonlySet<string>`.
- The tracker never removes an id, satisfying Requirement 1.3 and 1.4 (latched, additive).

### `src/hints/select.ts` (pure)

`selectTarget(pack, progress, room): Milestone | undefined`:

1. `const offered = offeredMilestones(pack, progress)` — imported from `packs/tools/src/hints.ts`, not reimplemented (Requirement 2.1, gotcha 2).
2. If `offered` is empty, return `undefined` (Requirement 2.6).
3. Otherwise choose deterministically:
   - Prefer milestones whose `rooms` include `room` (Requirement 2.4).
   - Within that, prefer required over `optional` (Requirement 2.5, gotcha 3).
   - Break remaining ties by the milestone's index in `pack.milestones` (file order), which `offeredMilestones` preserves.
   - Return the first after this stable ordering.

Because the returned milestone is always an element of `offered`, it is never reached and never has an unmet `after` prerequisite. That is the no-spoiler invariant (Requirement 2.2, 10.1).

### `src/hints/tiers.ts` (pure)

Tier state per milestone id, so each milestone progresses independently (gotcha 4).

- Tier order: `["nudge", "clue", "answer"]`.
- `nextTier(state, milestoneId)`: if the milestone has no recorded tier, return `nudge` and record it; otherwise return the next tier up, clamped at `answer` (asking again after `answer` repeats `answer`, Requirement 3.3). Never skips a tier (Requirement 3.4, 10.2).
- `answerTier(state, milestoneId)`: return `answer` and record the milestone's tier as `answer`, so a later plain ask repeats the answer rather than stepping back (Requirement 4.1, 4.2).
- The tier state is a plain `Map<string, Tier>` the caller owns; the functions are pure transformations returning the chosen tier and the updated map. Resetting on a target change (Requirement 3.5) is simply that a new milestone id has no recorded tier, so `nextTier` returns `nudge`.

### `src/hints/engine.ts` — `HintEngine`

Ties the three together behind two calls the controller uses.

- Constructed with the loaded `pack` and a `ProgressTracker`.
- `onEngineState(state)`: forwards to `tracker.update(state)` so reached stays current. Called by `main.ts` on each room/diff update.
- `ask(room): HintResult`: `target = selectTarget(pack, tracker.progress(), room)`; if undefined, return `{ kind: "none" }`; else `tier = nextTier(...)`; return `{ kind: "hint", milestoneId, tier, text: target.hints[tier] }` with the audio cache key computed from the text.
- `askAnswer(room): HintResult`: same selection; if a target exists, `tier = answerTier(...)` and return the `answer` text. Still only ever for an offered milestone (Requirement 4.3, 10.3).
- `HintResult` carries the text and the cache key (from `cache.ts`) so `main.ts` has everything to write text then resolve audio.

### `src/hints/cache.ts` (pure, shared)

`cacheKey(text, voiceId, modelId): string` returns a stable hash (hex of a SHA-256 over a canonical join of the three, using Node's `crypto` in the script and the Web Crypto / a small bundled hash in the browser — the same algorithm both sides, verified by a unit test that the two agree). `cacheFileName(key)` returns `<key>.mp3`. Both the generator and the playback path import this module, so they always agree on where a line's audio lives (Requirement 8.3, 8.8, gotcha 7). The files sit at `src/hints/ghost/<key>.mp3`.

### `src/hints/audio.ts` — `GhostAudio`

The playback glue and the target of the existing `stopAudio` hook.

- `enabled` flag, defaulting to on (Requirement 6.2). A toggle method turns it off; when off, `play` is a no-op.
- A build-time URL map: `import.meta.glob('./ghost/*.mp3', { query: '?url', eager: true })` gives a record of `./ghost/<key>.mp3` → hashed asset URL, resolved by Vite for both dev and the built `dist/` (Requirement 8.4, gotcha 10). `play` looks up the URL for `cacheFileName(key)` in that map.
- `play(key)`: if disabled, return. If the glob map has no URL for the key (no cached file), do nothing (silent text-only fallback, Requirement 6.5). Otherwise fetch/decode that URL and play it through the audio context created at the start gate; any playback failure is also silent.
- `stop()`: stop any playing whisper immediately. `main.ts` passes `() => ghostAudio.stop()` as the controller's `stopAudio`, replacing the current no-op placeholder, so every key press and focus change already interrupts the ghost (Requirement 6.3, gotcha 6).
- Carries no functional data; it only plays a file whose text is already in the live region (Requirement 6.4).

### `scripts/gen-voice.ts`

Build-time generator, run by hand or in a build step, never in the browser.

- Loads the pack via the pack tools' `loadPack`, collects every milestone's `hints.nudge`, `hints.clue` and `hints.answer`.
- **`--dry-run`** (Requirement 8.9, 8.10, gotcha 11): print the number of hint lines and the total character count (and a per-tier or per-chapter breakdown so the ~$0.08-per-1,000-character cost can be estimated), then exit. No ElevenLabs call, no file written. This is the default-safe mode Kash runs before approving the paid run.
- **Real run** (no `--dry-run`): for each line, compute `cacheKey(text, "nbk2esDn4RRk4cVDdoiE", "eleven_v4")`; if `src/hints/ghost/<key>.mp3` exists, skip it (Requirement 8.6); else call the ElevenLabs power to synthesize the line with voice Alice and model `eleven_v4`, and write the bytes to that file (Requirement 8.1, 8.2, 8.7).
- Reads the API key from `.env` by name (via a dotenv load), fails with a clear named-key message if absent, and never prints the value (Requirement 9). The ElevenLabs power is invoked for the actual synthesis; the script passes the key by name to it and logs only line counts and skip/generate decisions, never text-to-key mappings that could expose the secret.
- Prints a summary: how many lines, how many skipped (cached), how many generated. No key, ever.

### Player changes (additive)

`src/ui/controller.ts`:

- Add one case to `handleListKey` for the hint key. The free key is **`h` / `H`** — the existing list-mode bindings are arrows, Enter, `v`/`V`, Tab, Backspace, `r`/`R`, `l`/`L`, F1 and Escape, and `h` is unused (Requirement 7.1). `H` is a natural mnemonic for "hint" and "help from the ghost" while F1 keeps the control list.
- The case calls a new injected dep `askHint()` (and, optionally, the controller exposes the hint via the same list path so audio/interrupt already apply). `stopAudio()` at the top of `handleKey` already runs first, so pressing `H` while a whisper plays stops it (Requirement 7.3).
- `ControllerDeps` gains `askHint: () => void`. No existing binding changes (Requirement 7.4).

`src/main.ts`:

- Build a `ProgressTracker` and `HintEngine` from the loaded pack; build a `GhostAudio` on the audio context created at the start gate.
- Keep a running `EngineHintState` (`hintState`). Replace the `stopAudio` no-op with `() => ghostAudio.stop()`.
- In `applyRoom`, reset `hintState` to the room state's full `flags` and `inventory` (plus chapter/room), then call `hintEngine.onEngineState(hintState)` (Requirement 11.6). In `applyDiff`, set `hintState = foldDiff(hintState, diff)` then call `hintEngine.onEngineState(hintState)` (Requirement 11.1–11.5). This is why the fold matters: `applyDiff` currently rebuilds the hotspot list with `flags: []`, so the hint core cannot read flags off that path — the running `hintState` carries them instead.
- Add `askHint` to the controller deps: `const r = hintEngine.ask(state.room); live.announce(r.kind === "none" ? NO_HINT_TEXT : r.text); if (r.kind === "hint") ghostAudio.play(r.audioKey);` — text first, audio optional (Requirement 5, 6.1).
- Extend `HELP_TEXT` to mention the hint key (Requirement 7.5).

These are the only player edits, and they are additive.

## Data flow

1. On a `room` event, `main.ts` resets the running `hintState` to that room's full flags and inventory; on a `diff` event, it sets `hintState = foldDiff(hintState, diff)`. Either way it then calls `hintEngine.onEngineState(hintState)`, and the tracker latches any newly satisfied milestone into `reached`.
2. Player presses `H`. Controller's `handleKey` runs `stopAudio()` (stops any whisper), routes to `handleListKey`, which calls `askHint()`.
3. `askHint()` calls `hintEngine.ask(room)`: `selectTarget` runs `offeredMilestones(pack, tracker.progress())`, picks the target by the room/main-path rule, and `nextTier` advances that milestone's tier.
4. `main.ts` writes the tier text to the live region (interrupting), then, if a target existed and audio is on, plays the cached whisper for that text's cache key; a missing file is silent.
5. Any next key press or focus change interrupts the whisper via the same `stopAudio` → `ghostAudio.stop()` path.

## Testing strategy

- **No-spoiler property** (`hints-select.prop.test.ts`): fast-check generates reachable progress states (a chapter and a subset of milestone ids closed under `after`, plus a room); assert `selectTarget`'s result, when defined, is in `offeredMilestones(...)`, hence not reached and with all `after` prerequisites reached (Requirement 10.1). Run against the real pack's milestones (Requirement 10.5).
- **Tier-order property** (`hints-tiers.prop.test.ts`): for any number of plain asks on a fixed target, the emitted tiers are a prefix of `nudge, clue, answer` followed by repeated `answer`, never skipping (Requirement 10.2); and a direct-answer ask only ever yields a milestone's `answer` for an offered milestone (Requirement 10.3).
- **Fold unit test** (`hints-fold.test.ts`): a diff's sparse changed flags land on the right indices of a full copy with the rest unchanged; `invAdded`/`invRemoved` produce the right inventory; a chapter/room change is reflected; and the previous state passed in is not mutated (Requirement 11).
- **Cache-coverage test** (`hints-cache.test.ts`): after running the generator (or a mocked generator that writes empty files for the computed keys), assert every milestone tier in the real pack has a file at `src/hints/ghost/<cacheKey(text, voice, model)>.mp3` (Requirement 10.4). The ElevenLabs call is mocked so the test needs no key or network (Requirement 10.5).
- **Cache-key agreement unit test**: the Node and browser hash implementations in `cache.ts` produce the same key for the same inputs.
- No live engine and no network in any test; the pack is read-only input.

## Decisions and alternatives

- **Hint key `H`.** Free in the controller, mnemonic, and leaves F1 as the controls reader. Alternatives (`?`, a function key) are less discoverable or clash with typed input; `H` sits with the other letter shortcuts (`R`, `L`, `V`).
- **Latched reached set over re-deriving each ask.** Re-deriving from live flags each time would re-offer a solved puzzle once its transient flag clears (gotcha 1). Latching is the only correct option given `when` conditions are point-in-time.
- **Content-addressed cache over id+tier keys.** Keying by milestone id and tier would keep a stale whisper after a wording edit (gotcha 7). Hashing the text (plus voice and model) ties the file to the exact words.
- **Cache under `src/`, not `public/`.** The Vite config disables `publicDir` and roots at `src/`, so a top-level `public/ghost/` would be invisible in dev and absent from `dist/`. Putting the cache at `src/hints/ghost/` and resolving it through `import.meta.glob(... ?url)` lets Vite emit and serve it both places with no config edit. The files are committed because the lines are ours, not game data.
- **Fold diffs forward.** A diff is a delta (sparse flags, inventory adds/removes). Keeping a running full `hintState` reset on each room and folded on each diff is the only way the hint core sees all 50 flags; reading flags off `applyDiff`'s rebuild would see `flags: []`.
- **Dry-run gates the paid call.** The generator never calls ElevenLabs by default reflex; `--dry-run` reports counts so cost is known, and the real run is an explicit, deliberate invocation.
- **Pure core, imported `offeredMilestones`.** Reimplementing the offered-set rule here would risk drifting from the pack tools' invariant and the property tests that back it. Import it and only feed it a latched reached set (gotcha 2).
- **Selection prefers room then main path.** The current room is the strongest signal for what the player is stuck on; required-over-optional keeps the ghost steering down the critical path rather than toward a side errand (gotcha 3).
