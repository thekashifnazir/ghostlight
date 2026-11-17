# Design: sonar (hear the room's layout)

> **Descoped, 17 Nov 2026: the sonar tones.** Sonar is text only now. Kash had meant to drop the tones, because more sound on top of the music, the ghost voice and the screen reader would annoy players. On 17 Nov the tone code was found still in, wired to an audio context that was never set, so it had played nothing on the live site since 7 Nov. The audio layer (`src/sonar/audio.ts`) and the M (mute) key were removed. S, N and P keep the text: the summary line and each step's name, direction and distance. The requirements below about pings, sound, stop and mute are kept as the original design record.

## Overview

Sonar turns the room state the player already holds into sound and text that tell a blind player where everything is. It has three layers:

1. **A pure mapping** (`src/sonar/mapping.ts`): room state plus hotspot list in, an ordered array of `Ping` values out. Each `Ping` carries which thing it is, its kind, its pan, its pitch, its distance attenuation and band, its onset offset, and a ready-made text equivalent. No Web Audio, DOM, timers or engine access — this is the part the property tests pin down.
2. **A thin audio layer** (`src/sonar/audio.ts`): takes `Ping` values and an `AudioContext` and schedules synthesised sound (oscillator + stereo panner + lowpass + gain per ping), plus a stop that cancels everything at once and a mute flag. No game knowledge; it only knows how to voice a `Ping`.
3. **A controller** (`src/sonar/sonar.ts`): holds the current room state and hotspot list, the step cursor and the mute state, and exposes `scan()`, `next()`, `prev()`, `toggleMute()` and `stop()`. It writes text to the player's existing `LiveRegion` and voices pings through the audio layer. This is the single object `main.ts` wires in and the player's controller calls.

Only the final task touches `src/main.ts` and `src/ui/controller.ts`, additively: `main.ts` builds a `Sonar`, keeps it fed with the current room state and hotspot list on every room/diff, and passes it to the controller; the controller gains four key cases (S, N, P, M) that call the sonar methods and consume the key. Everything else is new files under `src/sonar/` and `test/`.

Sonar reuses, never duplicates, the player's building blocks: the `RoomState`/`RoomObject` types and `Hotspot` shape, the single polite `LiveRegion`, the audio-context lifecycle already created at the start gate, and the controller's stop-audio-on-every-key step. It reads the pack indirectly, through the hotspot names and kinds the player already resolved; sonar itself does no pack lookups.

## Architecture

```
main.ts
  ├─ holds currentRoomState (RoomState) + currentList (Hotspot[])   ← already tracked
  ├─ new Sonar(live, () => audioContext)                            ← built once
  │     on each applyRoom/applyDiff: sonar.setRoom(state, currentList)
  └─ Controller({ ..., sonar })
         S → sonar.scan()
         N → sonar.next()
         P → sonar.prev()
         M → sonar.toggleMute()
         (stopAudio() at top of handleKey already stops sonar via sonar.stop())

src/sonar/
  ├─ mapping.ts   pure: (RoomState, Hotspot[]) → Ping[]            ← property-tested
  ├─ audio.ts     thin: schedule Ping[] on an AudioContext, stop, mute
  └─ sonar.ts     Sonar: setRoom / scan / next / prev / toggleMute / stop
```

### Why a pure mapping separate from audio

The spike's 28 checks all assert on a log of what *would* be scheduled (thing, type, pan, frequency, cutoff, onset), not on sound you cannot hear in CI. Splitting the mapping out makes that the natural test surface: the property tests assert on `Ping[]` directly, with no audio graph, no fake `AudioContext`, and no timing. The audio layer then has one job — voice a `Ping` the way the spike's `earcon()`/`cue()` did — and is exercised by a small offline-render or mocked-node test rather than by the property suite.

## Components

### `Ping` and the mapping (`src/sonar/mapping.ts`)

```ts
export type PingKind = "person" | "object" | "exit";
export type DistanceBand = "near" | "mid" | "far";
export type Direction = "left" | "ahead" | "right";

export interface Ping {
  num: number;            // engine hotspot number, for identity in tests
  name: string;           // final spoken name from the hotspot
  kind: PingKind;         // person | object | exit (hotspot npc → person)
  centreX: number;        // rect centre x, the sort key (engine coords)
  pan: number;            // -1..1, tanh(dx / PAN_SCALE)
  freq: number;           // Hz, from centre y: base * 2^((100 - cy)/100)
  cutoff: number;         // Hz lowpass, closes with distance
  gain: number;           // 0..1, drops a little with distance
  onset: number;          // seconds from scan start (index * GAP)
  distance: number;       // px from hero centre, for the band and tests
  band: DistanceBand;     // near | mid | far
  direction: Direction;   // from pan sign, for the text
  text: string;           // "DOOR, exit, left, near" — the text equivalent
}

export function buildPings(state: RoomState, list: Hotspot[]): Ping[];
```

`buildPings` is the whole mapping and the whole pure surface:

- **Select.** Take the hotspots whose engine object in `state.objects` is `visible`. The hotspot list is already visible-only in practice, but sonar re-checks `visible` against the room state so "exactly one ping per visible thing, none for invisible" is true by construction regardless of how the list was built. One ping per hotspot number.
- **Order.** Sort ascending by rect centre x (`rect[0] + rect[2]/2`), then by rect centre y for ties. This is the single source of left-to-right order; pan, onset and the "N of M" index all follow this array.
- **Pan.** `dx = centreX - hero.x`; `pan = tanh(dx / PAN_SCALE)` with `PAN_SCALE ≈ 120` (the spike's value). `tanh` keeps pan in the open interval (-1, 1) ⊂ [-1, 1], is strictly increasing in `dx`, and never saturates several far-right things onto +1 the way a clamped linear pan would. Because centre x is the sort key and `tanh` is monotonic, pan is non-decreasing across the array (R1.4).
- **Pitch.** `freq = BASE_FREQ * 2^((100 - cy) / 100)` where `cy` is rect centre y; higher in the room (smaller y) → higher pitch, about an octave either way across the 200-px height.
- **Distance.** `distance = hypot(centreX - hero.x, cy - hero.y)`. A nearer thing gets a higher `cutoff` (brighter) and slightly higher `gain`; a further thing a lower cutoff and gain. `band` is `near`/`mid`/`far` from distance thresholds, and is what the text uses.
- **Timbre.** `kind` selects the waveform/rhythm in the audio layer (object = one short sine blip; exit = two rising notes; person = a buzzy sawtooth with vibrato), so kind is distinguishable beyond pitch (R1.7).
- **Onset.** `onset = index * GAP` with `GAP ≈ 0.3 s`, so pings are heard distinctly and 10 things take under 3 s.
- **Text.** `direction` from pan sign with a dead-band around zero → "left"/"ahead"/"right"; `text` composes name, kind, direction and band, e.g. `"DOOR, exit, left, near"`. The step announcement appends "N of M".

The mapping imports only the adapter types and the `Hotspot` type. Constants (`PAN_SCALE`, `BASE_FREQ`, `GAP`, distance thresholds) are named exports so the tests and any future settings can reference them.

### The audio layer (`src/sonar/audio.ts`)

```ts
export class SonarAudio {
  constructor(ctx: AudioContext);
  play(pings: Ping[]): void;   // schedule each ping at ctx.currentTime + onset
  playOne(ping: Ping): void;   // a single ping now (step)
  stop(): void;                // cancel + disconnect every scheduled node at once
  setMuted(muted: boolean): void;
}
```

Each ping builds a small graph: an `OscillatorNode` (waveform by kind) → `GainNode` (short attack/decay envelope scaled by `ping.gain`) → `BiquadFilterNode` lowpass at `ping.cutoff` → `StereoPannerNode` at `ping.pan` → destination. Exit pings schedule two notes a fifth apart; person pings add a small vibrato via a second oscillator on the frequency param. `stop()` keeps references to every node started since the last `stop()`/`play()` and calls `stop(now)`/`disconnect()` on them, so a key press kills a scan mid-flight (R5.1). When muted, `play`/`playOne` are no-ops. The layer never touches the live region or the room; it is given finished `Ping` values.

The audio layer does not own the `AudioContext`; `main.ts` already creates one at the start gate (and may fail to, if audio is unavailable). `Sonar` is handed a `getContext()` that returns the context or `undefined`, and only constructs `SonarAudio` lazily when a context first exists. With no context, `scan`/`step` still write text (R5.5).

### The sonar controller (`src/sonar/sonar.ts`)

```ts
export interface SonarDeps {
  live: LiveRegion;                       // the player's single polite region
  getContext: () => AudioContext | undefined;
}

export class Sonar {
  setRoom(state: RoomState, list: Hotspot[]): void;  // refresh + reset cursor
  scan(): void;        // play pings, then summary line
  next(): void;        // advance cursor, one ping, announce
  prev(): void;        // retreat cursor, one ping, announce
  toggleMute(): void;  // flip mute, announce new state
  stop(): void;        // stop all sonar sound now
}
```

- `setRoom` stores the state and list, recomputes nothing eagerly (pings are built per action), and resets the step cursor to before-the-first so the next `next()` starts at index 0 (R3.6, R2.6).
- `scan()` builds the pings, voices them through the audio layer (unless muted or no context), and schedules the summary line after the last ping's onset. The summary counts total and per kind: `"10 things, left to right: 3 people, 4 objects, 3 exits"`. Empty room → one "nothing here" line, no pings (R2.5). The summary is written as text regardless of mute/audio (R2.3). A pending summary is tracked so `stop()` can suppress it (R5.2).
- `next()`/`prev()` move the cursor with wrap, voice that one ping, and announce `ping.text + ", N of M"`. Empty room → one "nothing to step through" line, no ping (R3.5).
- `toggleMute()` flips a boolean, forwards it to the audio layer, and announces `"Sonar sound off"` / `"Sonar sound on"` (R5.3).
- `stop()` calls the audio layer's `stop()` and clears any pending summary timer (R5.1, R5.2). The controller already calls `stopAudio()` at the top of every key handler; wiring `stopAudio` to also call `sonar.stop()` gives R5.1 and R6.4 for free, so pressing any key — including a sonar key — stops a scan before the new action.

Direction/distance words come straight from the `Ping` fields, so the text layer stays trivial and matches what the sound encodes.

## Keys and the controller seam

The controller (`src/ui/controller.ts`) currently binds, in list mode: arrows, Enter, V, Tab, Backspace, R, L, H, F1, Escape. Free letters include S, N, P, M — the proposed sonar keys — and none appear in any of the three `handle*Key` switches. The final task adds four cases to `handleListKey` (sonar is a list-mode overlay; menus keep their own keys):

```
case "s": case "S": this.d.sonar.scan();       return true;
case "n": case "N": this.d.sonar.next();        return true;
case "p": case "P": this.d.sonar.prev();        return true;
case "m": case "M": this.d.sonar.toggleMute();  return true;
```

Each returns `true`, so the key is consumed and never reaches the engine input (R6.3). `stopAudio()` already runs at the top of `handleKey`, so the stop-on-key rule (R6.4) holds without new code once `stopAudio` also stops sonar. `sonar` is added to `ControllerDeps` as a new required dependency; this is the only change to the controller's shape. The help text in `main.ts` gains a sentence describing S/N/P/M (R6.5).

`main.ts` builds the `Sonar` once (passing the `LiveRegion` and a `getContext` that returns the start-gate audio context), calls `sonar.setRoom(state, currentList)` at the end of `applyRoom` and after each list rebuild/update in `applyDiff`, and passes `sonar` into the `Controller` deps. All additive: no existing line is removed, only new calls added alongside the existing `list.rebuild`/`list.update` calls.

## Data flow for a scan

1. Player presses **S**. `keydown` → `controller.handleKey("s")`.
2. `handleKey` runs `stopAudio()` → `sonar.stop()` (any prior scan dies), then routes to `handleListKey` → `sonar.scan()`.
3. `scan()` reads the stored `RoomState` + `Hotspot[]`, calls `buildPings` → ordered `Ping[]`.
4. If not muted and a context exists, `SonarAudio.play(pings)` schedules every ping at `ctx.currentTime + onset`.
5. A timer at the last onset + a small gap writes the summary line to the live region (text always, independent of audio).
6. Any key before the scan ends → `stop()` cancels the remaining nodes and the summary timer, optionally announces "Stopped".

## Error handling and edge cases

- **No audio context** (start gate failed, or `scan` before start): `SonarAudio` is never constructed; `scan`/`step` write text only (R5.5). The summary timer is a plain `setTimeout`, so text still lands.
- **Empty room / all invisible**: `buildPings` returns `[]`; `scan` and `step` write a single explanatory line and play nothing (R2.5, R3.5).
- **Hero missing from state**: the adapter always carries `hero`; some diff-rebuilt states in `main.ts` currently pass `hero: {x:0, y:0}`. Sonar treats that as a valid origin — pans are then absolute-ish from the top-left — and the room state carries a real hero on every `A11Y` room line, so `setRoom` after a full room state is correct. No crash on a zero hero.
- **Mute during a scan**: mute stops *future* pings being scheduled; an in-flight scan is ended by the normal stop-on-key. Muting itself is a key press, so the scan stops anyway (R5.1).
- **Duplicate centre x**: ties break by centre y, so the order and the pan non-decrease are still total and deterministic.
- **Live region contention**: sonar uses the same `LiveRegion.announce`, which replaces content (newest wins), so a step announcement during a scan replaces the pending summary rather than queuing (R5.6).

## Testing strategy

Property tests with **fast-check** on the pure mapping (`test/sonar/mapping.property.test.ts`), generating random rooms (random visible/invisible objects with random rects and hero positions) and asserting the invariants directly on `buildPings` output:

- **Ordering:** pings are always sorted by centre x (non-decreasing), ties by centre y — the array is in left-to-right order for every input.
- **Pan range:** every ping's pan is within [-1, 1].
- **Pan monotonic in x:** for any two pings, a larger centre x never has a smaller pan (non-decreasing), so stereo order matches list order and nothing hard-clips to one side.
- **Exactly one ping per visible thing, none for invisible:** the set of ping `num`s equals the set of visible object numbers in the input; no invisible object's number appears; counts match.
- Plus: pan sign matches the side of the hero (left of hero → pan ≤ 0, right → pan ≥ 0); higher things (smaller centre y) have higher `freq`; nearer things have higher `cutoff`; `text` contains the name, the kind word, the direction word and the band word.

Example-based unit tests (`test/sonar/sonar.test.ts`) drive `Sonar` with a fake `LiveRegion` and a fake/absent context:

- Scan on a room → summary line with correct total and per-kind counts; empty room → the "nothing here" line and no pings.
- `next`/`prev` → correct `text + "N of M"`, wrap at both ends, cursor reset after `setRoom`.
- `toggleMute` → announces off/on; while muted, scan/step still announce text and schedule no audio.
- `stop` → suppresses a pending summary; with no context, everything still announces.

A thin audio test (`test/sonar/audio.test.ts`) renders a couple of pings through an `OfflineAudioContext` (as the spike did) or a mocked node graph, asserting each ping is louder in the ear its pan points to and that `stop()` disconnects scheduled nodes. This is the closest check to "it sounds right" that runs headless.

Playwright/axe-core coverage for the keys and live region is added in the player spec's UI suite once sonar is wired; this spec's tests stay at the module level so sonar is proven before it touches `main.ts`.

All code lives under `src/sonar/` and `test/sonar/`. Nothing is copied from `reference/`; this design is written from what spike 09 proved (the pan formula, the pitch and distance mappings, the 300 ms onset gap, the summary and step wording, the stop/mute rules), re-expressed against the player's real types and `LiveRegion`.
