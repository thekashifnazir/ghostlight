# Tasks: sonar (hear the room's layout)

All new modules live under `src/sonar/`; tests sit flat in `test/` with the repo's `sonar-*.test.ts` / `sonar-*.prop.test.ts` naming. Do not edit `engine/`, `packs/` or `scripts/`. Reuse the player's existing types (`RoomState`, `RoomObject`, `Hotspot`), the single `LiveRegion`, and the start-gate audio context; do not duplicate them. Build and test each module before it is wired in, so sonar is proven before it touches `src/main.ts`. Only the final task edits `src/main.ts` and `src/ui/controller.ts`, and only additively. Copy nothing from `reference/`. Confirm current Web Audio and fast-check APIs via the Context7 power as each is first used. Use `task_status` to tick each task as it is completed.

- [x] 1. Define the `Ping` type and the pure mapping
  - Create `src/sonar/mapping.ts` with the `Ping`, `PingKind`, `DistanceBand` and `Direction` types and named constants (`PAN_SCALE`, `BASE_FREQ`, `GAP`, distance thresholds).
  - Implement `buildPings(state, list)`: select visible things (re-checking `visible` against the room state, one per hotspot number), sort by rect centre x then centre y, and set pan (`tanh(dx / PAN_SCALE)`), pitch (`BASE_FREQ * 2^((100 - cy)/100)`), distance attenuation (cutoff and gain dropping with distance), distance band, onset (`index * GAP`), direction from pan sign, and the composed `text` equivalent.
  - Keep the module pure: adapter and hotspot types in, `Ping[]` out, no Web Audio, DOM, timers or engine access.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 4.1_

- [x] 2. Property-test the mapping with fast-check
  - Create `test/sonar-mapping.prop.test.ts` generating random rooms (random visible and invisible objects, random rects within 320x200, random hero position).
  - Assert the invariants on `buildPings` output: pings are always ordered by centre x (ties by centre y); every pan is within -1..1; pan is non-decreasing as centre x increases; the set of ping numbers equals the set of visible object numbers and contains no invisible one; pan sign matches the hero side; higher things have higher `freq`; nearer things have higher `cutoff`; `text` contains the name, kind word, direction word and band word.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 4.1_

- [ ] 3. Build the thin audio layer
  - Create `src/sonar/audio.ts` with `SonarAudio`: `play(pings)` schedules each ping at `ctx.currentTime + onset` as oscillator → gain (envelope × `ping.gain`) → lowpass (`ping.cutoff`) → stereo panner (`ping.pan`), with timbre by kind (object blip, exit two rising notes, person buzzy sawtooth with vibrato); `playOne(ping)` voices a single ping now; `stop()` cancels and disconnects every scheduled node at once; `setMuted(muted)` makes `play`/`playOne` no-ops while muted.
  - Keep it free of game and DOM knowledge: finished `Ping` values and an `AudioContext` in, scheduled sound out.
  - _Requirements: 1.5, 1.6, 1.7, 5.1, 5.4_

- [ ] 4. Test the audio layer headless
  - Create `test/sonar-audio.test.ts` rendering a couple of pings through an `OfflineAudioContext` (or a mocked node graph): assert each ping is louder in the ear its pan points to, and that `stop()` disconnects scheduled nodes so a scan can be cancelled mid-flight.
  - _Requirements: 1.3, 5.1_

- [ ] 5. Build the `Sonar` controller
  - Create `src/sonar/sonar.ts` with `Sonar` taking `{ live, getContext }`: `setRoom(state, list)` stores state and resets the step cursor; `scan()` builds pings, voices them (unless muted or no context) and schedules the summary line after the last onset ("N things, left to right: A people, B objects, C exits", empty room → one "nothing here" line, no pings); `next()`/`prev()` move the cursor with wrap, voice one ping and announce `text + ", N of M"` (empty room → one "nothing to step through" line); `toggleMute()` flips mute, forwards it to the audio layer and announces the new state; `stop()` stops all sonar sound and suppresses a pending summary.
  - Construct `SonarAudio` lazily only when a context first exists; write all text through the player's `LiveRegion.announce` so the newest line replaces the previous one.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.2, 4.3, 4.4, 5.2, 5.3, 5.5, 5.6_

- [ ] 6. Test the `Sonar` controller
  - Create `test/sonar-controller.test.ts` driving `Sonar` with a fake `LiveRegion` and a fake or absent context: scan summary has the right total and per-kind counts; empty room gives the "nothing here" line and no pings; `next`/`prev` give the right `text + "N of M"` and wrap at both ends and reset after `setRoom`; `toggleMute` announces off/on and, while muted, scan/step still announce text and schedule no audio; `stop` suppresses a pending summary; with no context everything still announces as text.
  - _Requirements: 2.2, 2.3, 2.5, 3.1, 3.2, 3.3, 3.5, 3.6, 4.2, 4.3, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 7. Wire sonar into the player (additive; the only task that edits `main.ts` and `controller.ts`)
  - In `src/ui/controller.ts`, add `sonar: Sonar` to `ControllerDeps` and four cases to `handleListKey` — S → `scan()`, N → `next()`, P → `prev()`, M → `toggleMute()` — each returning `true` so the key is consumed; confirm none of S, N, P, M already appears in any `handle*Key` switch before adding them.
  - In `src/main.ts`, build the `Sonar` once (passing the existing `LiveRegion` and a `getContext` returning the start-gate audio context), call `sonar.setRoom(state, currentList)` at the end of `applyRoom` and after each list rebuild/update in `applyDiff`, pass `sonar` into the `Controller` deps, make the shared `stopAudio` also call `sonar.stop()`, and add a sentence to the help text describing S/N/P/M.
  - If a diff carries a hero position, update `state.hero` before calling `sonar.setRoom` (the engine chat will add an optional `hero` field to `A11Y_DIFF`; until then the diff carries no hero and sonar keeps using the last full room state). Add a `hero` to `PlayerState` seeded from each full room state so the diff-rebuilt states pass the real hero instead of `{x:0, y:0}`.
  - Make only additive changes: no existing line removed, only new calls and cases added alongside the existing ones. Verify the player still builds and the existing player tests still pass.
  - _Requirements: 4.4, 5.1, 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 8. (Optional, stretch) Sweep mode
  - Add `src/sonar/sweep.ts`: a virtual cursor over the 320x200 room moved by the arrow keys while sweep is on, a continuous synthesised tone whose pitch rises as the cursor nears the nearest thing's edge and whose pan follows the cursor's x, a distinct tick on entering/leaving a thing and a name+kind announcement on entering.
  - Keep sweep off by default and fully optional: it must not change any core scan or step behaviour, and must obey the same stop, mute and text-equivalent rules.
  - Wire a free toggle key additively (the spike used W) only if it does not clash with the controller's bindings at that time, and test the pure parts (cursor movement, nearest-thing selection) with fast-check.
  - _Requirements: 7.1, 7.2, 7.3_
