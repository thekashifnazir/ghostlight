# Requirements: hints and ghost

## Introduction

When a blind or low-vision player gets stuck in Drascula, they press one key and the ghost gives them a hint for where they actually are. Hints come in three tiers: a nudge that points at the area of the problem, a clue that names the place and the thing, and an answer that gives the exact action in game verbs. Each tier is text in the live region first, and a bonus whisper from the ghost on top. The player hears the next tier up each time they ask, starting at the nudge, and the ghost never hints at a puzzle the player has not reached.

The hint content already exists in the accessibility pack: every milestone carries a `recap` and a `hints` object with `nudge`, `clue` and `answer` strings, keyed on progress conditions (chapter, flags, inventory, room). The pack tools already expose `offeredMilestones(pack, progress)`, which, given the set of reached milestones, returns the milestones whose hints may be offered now (not reached, all `after` prerequisites reached). This spec builds on that: it works out which milestones are reached from the engine's live flags and inventory, latches them, picks the single milestone to hint at, tracks which tier the player is on, and plays the chosen tier.

The spec also adds the ghost's voice. A build-time script generates one audio file per hint line with ElevenLabs (voice Alice, model `eleven_v4`) through the ElevenLabs power, into a content-addressed cache so that an unchanged line is never regenerated. At play time the text always goes to the live region, the audio is optional and interruptible, and a missing audio file falls back to text silently.

Scope is: the pure hint-selection modules under `src/hints/` (folding diffs into a full engine state, reached-set derivation and latching, milestone selection, tier progression); the voice generation script `scripts/gen-voice.ts` and its cache; and the playback path (live region first, optional interruptible audio, silent text fallback). The one hint key is wired into the existing player (`src/ui/controller.ts` and `src/main.ts`) as a small additive change. The player spec is complete, so this spec changes only those two player files, and does not edit `packs/`.

A note on engine state: a full room state (`A11Y`) carries all 50 flags and the full inventory, but a diff (`A11Y_DIFF`) carries only the flags that changed (a sparse map) and the items gained or lost (deltas). The hint core needs a complete flag array and inventory to evaluate milestone conditions, so this spec keeps a running copy folded forward from the last room state across each diff.

Requirements use EARS (Easy Approach to Requirements Syntax). Terms:

- **milestone**: a progress point in the pack, with an id, a `when` condition, optional `after` prerequisites, optional `rooms`, an `optional` flag, an `end` flag, a `recap`, and a `hints` object of three tiers. Defined by the pack, read-only.
- **reached set**: the set of milestone ids the player has already achieved, derived from the engine's live state and latched so a milestone stays reached once reached.
- **offered milestones**: the milestones whose hints may be offered now, as returned by the pack tools' `offeredMilestones(pack, progress)`: not in the reached set, and with every `after` prerequisite in the reached set.
- **target milestone**: the single offered milestone the ghost will hint at next, chosen by the selection rule.
- **tier**: one of the three hint strings for a milestone, in order: `nudge`, then `clue`, then `answer`.
- **progress**: the chapter and reached set passed to `offeredMilestones`, in the shape the pack tools define (`{ chapter, reached }`).
- **live region**: the single polite ARIA `role=log` region the player already owns, that every functional line is written to as text.
- **ghost audio**: the optional pre-recorded whisper of a hint line, layered on top of the text, interruptible on any key.
- **hint cache**: the content-addressed store of generated ghost audio, keyed by a hash of the line text, the voice id and the model id.

## Requirements

### Requirement 1: Derive the reached set from live engine state

**User story:** As a blind player, I want the game to know which puzzles I have already solved from my actual progress, so that the ghost only ever helps me with what is still ahead of me.

#### Acceptance criteria

1. WHEN given the engine's current chapter, flags and inventory and the pack THEN the hint core SHALL evaluate each milestone's `when` condition against that state and treat a milestone as currently satisfied when its condition holds.
2. THE hint core SHALL evaluate a milestone's `when` condition using the same condition semantics the pack defines (chapter, room, flags, `has`, `lacks`, and the `all`/`any`/`not` combinators), so a milestone counts as satisfied only when its full condition holds.
3. WHEN a milestone has been satisfied at any point THEN the hint core SHALL keep it in the reached set for the rest of the session, even if the engine's live flags later no longer satisfy its `when` condition (the reached set is latched).
4. THE hint core SHALL build the reached set additively from updates, so each engine state update can only add newly satisfied milestones and never remove a previously reached one.
5. THE hint core SHALL expose the reached set and the current chapter as the `progress` value (`{ chapter, reached }`) that `offeredMilestones` consumes.

### Requirement 2: Select the one milestone to hint at

**User story:** As a blind player, I want the ghost to hint at the thing I am most likely stuck on right now, so that one key press gives me a useful hint without me choosing from a list.

#### Acceptance criteria

1. WHEN the player asks for a hint THEN the hint core SHALL call the pack tools' `offeredMilestones(pack, progress)` to get the milestones whose hints may be offered, importing that function from the pack tools rather than reimplementing it.
2. THE hint core SHALL NOT select a milestone that is not in the offered set, so it never hints at a milestone that is reached or whose `after` prerequisites are not all reached.
3. WHERE the offered set is non-empty THEN the hint core SHALL choose exactly one target milestone from it by a deterministic rule.
4. WHERE one or more offered milestones list the player's current room in their `rooms` THEN the hint core SHALL prefer an offered milestone whose `rooms` include the current room over one that does not.
5. WHERE the room preference does not single out one milestone THEN the hint core SHALL prefer a required milestone over an `optional` one, and otherwise break ties by the pack's milestone order.
6. WHERE the offered set is empty THEN the hint core SHALL report that there is no hint to give rather than inventing one, and the player SHALL tell the player there is nothing to hint at right now.

### Requirement 3: Three tiers, in order, from the nudge up

**User story:** As a blind player, I want my first ask to give a gentle nudge and each further ask to give more, so that I can get just enough help and not have a puzzle spoiled before I want it.

#### Acceptance criteria

1. WHEN the player asks for a hint on a target milestone for the first time THEN the hint core SHALL give the `nudge` tier.
2. WHEN the player asks again for the same target milestone THEN the hint core SHALL give the next tier in order: `clue` after `nudge`, then `answer` after `clue`.
3. WHEN the player asks again after the `answer` tier for the same target milestone THEN the hint core SHALL repeat the `answer` tier every time, for as many further asks as the player makes, rather than advancing past it or ever withholding the answer. There is no "exhausted" or cut-off state: a player who keeps pressing the hint key keeps hearing the answer.
4. THE hint core SHALL NOT give the `clue` or `answer` tier before the `nudge` has been given for that milestone, and SHALL NOT jump to `answer` without having given the `nudge` and `clue` first, unless the player explicitly asks for the answer (see Requirement 4).
5. WHEN the target milestone changes between asks (because the player progressed, or the selection rule now prefers a different milestone) THEN the hint core SHALL reset the tier to `nudge` for the new target milestone.
6. THE hint core SHALL track the tier per milestone, so returning to an earlier-hinted milestone continues from the tier already reached for it rather than from the start.

### Requirement 4: Asking straight for the answer

**User story:** As a blind player who just wants to move on, I want a way to ask for the answer directly, so that I am not forced through the nudge and clue when I have decided I want the solution.

#### Acceptance criteria

1. WHEN the player explicitly asks for the answer THEN the hint core SHALL give the `answer` tier for the target milestone directly, without requiring the `nudge` and `clue` first.
2. WHEN the player has been given the answer directly THEN the hint core SHALL mark that milestone's tier as `answer`, so a later plain ask repeats the answer rather than stepping back to the nudge. Asking for the answer again, directly or plainly, SHALL give the answer again every time; the direct-answer path has no cut-off either.
3. THE direct-answer path SHALL still obey the no-spoiler rule: it SHALL give the answer only for a milestone in the offered set, never for a milestone ahead of the player.

### Requirement 5: Text first, in the live region

**User story:** As a blind player, I want every hint as text through my own screen reader, so that a hint is complete on its own and never depends on audio I may have turned off.

#### Acceptance criteria

1. WHEN a hint tier is given THEN the player SHALL write that tier's text to the live region as a functional line, before any audio is played.
2. THE hint text in the live region SHALL be complete on its own, carrying the full hint without relying on the ghost audio.
3. WHEN there is no milestone to hint at THEN the player SHALL write a plain line to the live region saying there is nothing to hint at right now.
4. THE hint line SHALL go to the same single polite `role=log` live region the player already uses for every other functional line, replacing its content so the hint interrupts rather than queues.

### Requirement 6: The ghost whisper, optional and interruptible

**User story:** As a blind player, I want the ghost's hints whispered in a distinct voice on top of the text, and I want to be able to stop or skip that audio at any time, so that the flavour never traps me at the recording's speed.

#### Acceptance criteria

1. WHEN a hint tier is given AND ghost audio is enabled AND an audio file exists for that line THEN the player SHALL play the ghost whisper for that line after writing the text.
2. THE ghost audio SHALL be on by default and the player SHALL provide a way to turn it off, after which hints are text only.
3. WHEN the player presses any key OR focus changes WHILE ghost audio is playing THEN the player SHALL stop that audio immediately, through the existing `stopAudio` hook the controller already calls at the top of every key handler.
4. THE ghost audio SHALL never carry functional information that is not already in the live region text, so a player with audio off loses nothing functional.
5. WHERE ghost audio is enabled but no audio file exists for the given line THEN the player SHALL fall back to text only, silently, without an error to the player.

### Requirement 7: One hint key, added without disturbing the player

**User story:** As a blind player, I want a single dedicated key to ask the ghost for help, so that help is always one press away and does not collide with the keys I already use to play.

#### Acceptance criteria

1. THE player SHALL bind asking for a hint to one key that `src/ui/controller.ts` does not already use (the existing list-mode keys are the arrows, Enter, V, Tab, Backspace, R, L, F1 and Escape, and F1 reads the controls).
2. WHEN the player presses the hint key in a play state where the hotspot list is active THEN the player SHALL ask the hint core for the next tier for the current chapter, reached set and room, and present the result per Requirements 5 and 6.
3. THE hint key handler SHALL go through the same controller path as the other keys, so it stops the key reaching the engine's own input and stops any playing audio first.
4. THE change to the player SHALL be additive and small: it SHALL add the hint key and its wiring to `src/ui/controller.ts` and `src/main.ts` only, and SHALL NOT change the existing key bindings, the live region, or any other player behaviour.
5. THE help text read by F1 SHALL be updated to mention the new hint key, so a player discovering the controls learns that the ghost can help.

### Requirement 8: Generate the ghost voice with ElevenLabs

**User story:** As the project, I want every hint line voiced once by the chosen ghost voice and cached, so that the whisper is consistent, the cost is paid once, and regeneration only happens when a line actually changes.

#### Acceptance criteria

1. THE project SHALL provide a build-time script `scripts/gen-voice.ts` that reads every hint line from the pack (the `nudge`, `clue` and `answer` of every milestone) and generates an audio file for each through the ElevenLabs power.
2. THE script SHALL generate with the ghost voice Alice (voice id `nbk2esDn4RRk4cVDdoiE`) and model `eleven_v4`, matching the voice decision recorded in the spike.
3. THE script SHALL write each generated file into a hint cache keyed by a hash of the line text, the voice id and the model id, so the cache entry is content-addressed.
4. THE hint cache SHALL live under `src/` (where Vite's bundler can resolve it), so that the cached audio is served in dev and copied into the built `dist/`, because the project's Vite config has `root: "src"` and `publicDir: false` and therefore never serves a top-level `public/` folder. The script SHALL NOT edit `vite.config.ts`.
5. THE hint cache files SHALL be committed to the repository, because the hint lines are the project's own authored content, not game data.
6. WHEN a line already has a cache entry for the current text, voice and model THEN the script SHALL skip regenerating it, so an unchanged line is never regenerated and only new or changed lines cost credits.
7. WHEN a line's text, the voice id, or the model id changes THEN the hash changes and the script SHALL generate a new cache entry for it.
8. THE playback path SHALL look up a line's audio by the same hash of text, voice and model, so a line written to the live region resolves to its cached audio when one exists.
9. THE script SHALL support a `--dry-run` mode that prints the number of hint lines and their total character count, grouped so the cost can be estimated, and SHALL NOT call ElevenLabs or write any audio in that mode.
10. THE script SHALL perform real generation (calling ElevenLabs) only when run without `--dry-run`, so the paid run is explicit and deliberate.

### Requirement 9: The ElevenLabs key is read from .env and never leaked

**User story:** As the project, I want the API key loaded from a local file and never printed or committed, so that a secret is never exposed in logs, output or the repository.

#### Acceptance criteria

1. THE voice script SHALL read the ElevenLabs API key from the local `.env` file at runtime, and `.env` SHALL remain gitignored.
2. THE voice script SHALL NOT print, log, or write the key value to any output, and SHALL refer to the key by name only.
3. THE voice script SHALL NOT commit the key or write it into any file that is committed.
4. WHERE the key is missing from `.env` THEN the script SHALL fail with a clear message that names the key by name and does not print any value.

### Requirement 10: Property tests for the no-spoiler and ordering invariants

**User story:** As the project, I want the hint rules covered by property tests, so that the no-spoiler guarantee and the tier order hold as the pack and code grow.

#### Acceptance criteria

1. THE hint core SHALL have a fast-check property asserting that, for any reachable progress state, the selected target milestone is never a milestone ahead of the player: it is always in the offered set, so it is not reached and all its `after` prerequisites are reached.
2. THE hint core SHALL have a fast-check property asserting that, for any sequence of plain asks on a fixed target milestone, the tiers come out in order `nudge`, `clue`, `answer` and then stay at `answer`, and never skip a tier.
3. THE hint core SHALL have a fast-check property asserting that a direct-answer ask only ever returns the `answer` of a milestone in the offered set.
4. THE project SHALL have a test asserting that after running the voice generation, every hint line in the pack (every tier of every milestone) has a cache entry under the hash of its text, voice and model.
5. THE property tests SHALL run against the real pack's milestones and conditions, and SHALL NOT require a live engine or network access.

### Requirement 11: Fold diffs into a complete engine state

**User story:** As the project, I want a complete flag array and inventory maintained across diffs, so that milestone conditions are evaluated against the player's true current state and not against the sparse deltas a diff carries.

#### Acceptance criteria

1. THE hint core SHALL provide a pure function in `src/hints/` that, given the previous complete engine state and one diff, returns the next complete engine state.
2. WHEN a diff carries changed flags (the sparse `flags` map of `[from, to]` entries) THEN the fold SHALL apply each changed flag's new value onto a copy of the previous full 50-flag array, leaving unchanged flags as they were.
3. WHEN a diff carries `invAdded` THEN the fold SHALL add those item ids to the inventory, and WHEN a diff carries `invRemoved` THEN the fold SHALL remove those item ids, producing the full current inventory.
4. WHEN a diff carries a chapter or room change THEN the fold SHALL update the chapter and room on the returned state.
5. THE fold SHALL be pure: it SHALL NOT mutate the previous state it is given, and it SHALL return a new complete state the hint core can pass to `onEngineState`.
6. WHEN a full room state (`A11Y`) arrives THEN the player SHALL reset the running copy to that state's full flags and inventory, so the running copy re-syncs with the engine's ground truth on every room entry.

## Known gotchas to carry into design and tasks

1. **Latch, do not re-derive each ask.** A milestone's `when` can stop holding once the player moves on (a flag may be transient, or the player leaves the milestone's rooms). Reached must be latched, or a solved puzzle could become offered again and the ghost would hint at something already done.
2. **`offeredMilestones` takes a reached set, not live flags.** The pack tools' function is pure over `{ chapter, reached }`. This spec's job is to turn live flags and inventory into that reached set and latch it, then hand it to the imported function. Do not reimplement the offered-set logic.
3. **Optional milestones must not block.** An `optional` milestone that is never reached must not stop a later required milestone being offered. The `after` graph already handles prerequisites; the selection rule must still deprioritise optional milestones so the ghost steers the player down the main path.
4. **Tier per milestone, not one global tier.** If the player asks about milestone A, progresses, then later gets stuck on B, B starts at its own nudge. Returning to A continues from A's tier. Track tier keyed by milestone id.
5. **Text before audio, always.** Write the live region line first, then attempt audio. A missing file, disabled audio, or an audio error must never cost the player the text.
6. **Interrupt reuses the existing hook.** The controller already calls `stopAudio()` at the top of every key handler for the player spec's sonar/ghost placeholder. Wire the ghost audio's stop into that same hook rather than adding a second interrupt path.
7. **Content-addressed cache or stale audio.** If the cache were keyed by milestone id and tier, editing a hint's words would keep the old whisper. Key by a hash of the actual text (plus voice and model) so changing the words changes the file.
8. **Never leak the key.** The script loads the key from `.env` by name and must never echo it, even in an error. Errors name the key, not its value.
9. **Diffs are deltas, not snapshots.** A diff's `flags` is a sparse map of only the flags that changed, and its `invAdded`/`invRemoved` are deltas; only a full room state carries all 50 flags and the full inventory. Evaluating conditions against a diff alone would see most flags as absent. Fold each diff forward onto a running full copy, and re-sync that copy from every room state.
10. **The cache must live under `src/`.** With `root: "src"` and `publicDir: false` in the Vite config, a top-level `public/ghost/` is never served in dev or built into `dist/`. Put the cache under `src/` and reference it as a bundled asset (for example `import.meta.glob('./ghost/*.mp3', { query: '?url', eager: true })`) so Vite emits hashed URLs for dev and the build, without touching `vite.config.ts`.
11. **Dry-run before the paid run.** Real ElevenLabs generation costs credits and is gated on Kash's go-ahead. The script defaults nothing to a paid call: `--dry-run` reports line and character counts only, and generation happens solely on an explicit non-dry run.
