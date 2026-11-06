# Spike 09: sonar pings and sweep mode (throwaway)

**Result, 6 Nov 2026: yes, room layout can be made audible from the room JSON alone.** One HTML file, plain JS and the Web Audio API, no build step, every sound synthesised (no audio files, nothing to license). Two modes on the real Drascula room data (chapter 1 room 62, chapter 2 room 14), keyboard only, every sound mirrored as text, a debug canvas for sighted viewers. 28 of 28 headless checks pass. Not heard by a blind player yet: that's the real test.

Code is AI-generated under Kash's direction.

## Run it

```bash
cd spikes/09-sonar
python3 -m http.server 8790 --bind 127.0.0.1     # then open http://127.0.0.1:8790/ and click the page once
```

Keys (focus is on the room view when the page loads):

| Key | Does |
|---|---|
| `S` | Sonar scan: one ping per thing, left to right, then one spoken summary ("10 things, left to right: 3 people, 4 objects, 3 exits. N for next.") |
| `N` / `P` | Next / previous thing: one ping, then its name and direction ("DOOR, exit to room 63, left, near. 1 of 10.") |
| `W` | Sweep mode on/off. Arrows move a virtual cursor over the 320x200 room (4 px, `Shift` 16 px) |
| `Enter` | In sweep: what's under the cursor, or "Nothing here. Nearest: BARTENDER, up." |
| `Esc` | Stop all sound now (cancels the rest of a scan, mutes the sweep tone) |
| `M` | Sweep tone on/off (ticks and names still work) |
| `R` | Repeat the last thing said |
| `H` | Debug: put the hero where the sweep cursor is |
| `1` / `2` | Room 62 (chapter 1) / room 14 (chapter 2) |

Tests:

```bash
npm i --prefix /some/tmp/dir playwright-core     # 1.65.0 used; nothing installed in the repo
PW=/some/tmp/dir/node_modules/playwright-core/index.mjs node spikes/09-sonar/test.mjs      # --no-video to skip the capture
```

Uses installed Google Chrome (`channel: 'chrome'`), headless, no autoplay flag: the first key press is the user gesture that starts audio. Writes `test-results.json` and `shots/`.

## Files

- `index.html`: the whole prototype.
- `rooms/room62.json`: copy of spike 02's dump. `rooms/room14.json`: the `A11Y {json}` line from `spikes/04-items-doors/transcript-02-leave-tavern.txt` line 32 (chapter 2 entry). `rooms/room62.png`: spike 03's screenshot, used as a dimmed backdrop (the overlay lines up with it).
- `test.mjs`, `test-results.json`: the checks and their last run.
- `shots/`: `01-scan-room62.png` (mid-scan, POSTER lit), `02-sweep-bartender-room62.png`, `03-scan-room14.png`, `04-sweep-room14.png`, `demo.webm` (about 17 s, no sound: scan, three steps, sweep to the bartender, Enter).

## How it sounds

**Sonar (S, N, P).** Each thing is placed relative to the hero:

- **Left-right:** `StereoPannerNode`, `pan = tanh(dx / 120)` where dx is hotspot centre x minus hero x. Monotonic, so left-to-right order survives, and it never hard-clips (a linear pan clamped at 1 would merge everything on the far right of room 62).
- **Height:** pitch. `freq = base * 2^((100 - cy) / 100)`, about an octave either way. POSTER (top of the room) 1102 Hz, SKULL (low) 616 Hz.
- **Distance:** a lowpass filter closes and the volume drops a bit as things get further away (cutoff 6365 Hz for the BIN 37 px away, 1117 Hz for the SKULL 228 px away).
- **Type, by timbre and rhythm, not only pitch:** object = one 90 ms sine blip (base 660 Hz); exit/door = two rising triangle notes a fifth apart, 140 ms (440 Hz); person = one 130 ms buzzy sawtooth with vibrato and a falling glide (330 Hz).
- Onsets 300 ms apart, so at least 160 ms of silence between pings. 10 things take 2.9 s.

**Sweep (W).** A quiet continuous sine follows the cursor: 200 Hz when the nearest hotspot edge is 100 px or more away, rising to 800 Hz at the edge, panned by the cursor's x on screen. Entering a hotspot: a bright noise tick, then that thing's type earcon, then its name. Leaving: a dull tick, no speech. Overlapping hotspots: the smallest wins. Found things are tracked (dashed outline until found, "found 1/10" on screen, and the scan summary says how many are left).

## What's tested (headless, `test.mjs`, 28/28 on 6 Nov)

You can't hear in CI, so the page logs every scheduled sound to `window.__sonarLog` (thing, type, pan, frequency, cutoff, start and end in AudioContext time) and the test asserts on that, on an offline render, and on the live region:

- Room 62 scan: 10 pings, ordered by hotspot centre x, pan values strictly increasing (-0.344 ... 0.955), pan sign matches the side of the hero, the right earcon type for each (3 people, 4 objects, 3 doors), min 0.16 s silence between pings, higher = higher pitch, further = lower cutoff.
- **Offline render** (`OfflineAudioContext`, the same graph): left/right RMS per ping. Every ping is louder in the ear its pan points to (DOOR at pan -0.34: L/R 1.77; SKULL at 0.95: L/R 0.04). This is the closest thing to listening.
- Speech never overlaps pings: the summary is set 37 ms after the last ping ends.
- `Esc` 0.7 s into a scan cancelled 7 of 10 pings and suppressed the summary; live region says "Stopped."
- `N`: "DOOR, exit to room 63, left, near. 1 of 10.", then "BIN, object, ahead, near. 2 of 10."
- Sweep from the hero to the bartender: tone rises 385 → 800 Hz on the way up, a tick on entering at y=82, live region "BARTENDER, person."; `Enter` gives "BARTENDER, person, right, mid, high."; leaving gives a low tick and no speech; `Enter` on the floor gives "Nothing here. Nearest: BARTENDER, up."
- Room 14 (chapter 2): 12 pings in pan order, ESCALERA read as STAIRS, sweep finds the bartender in his chapter 2 rect.
- Audio starts from a key press with no autoplay flag.

Not tested: how it actually sounds, whether anyone can use it, real screen readers (NVDA, JAWS, VoiceOver) with `role="application"`, headphones vs speakers.

## Design choices and what backs them

Backed by `research/2026-11-06-a11y-needs-and-features.md`:

- **Sound cues at all:** 77% of sight-loss gamers rate audio cues the most valued feature (RNIB for Activision, July 2024). Game Accessibility Guidelines list a sonar-style audio map as an advanced item.
- **The player's own screen reader, not ours:** names go to an `aria-live="polite"` region, never `speechSynthesis`, so they're read in the player's voice at the player's speed (gamesforblindgamers FAQ). Polite queues behind what the reader is saying instead of cutting it off. The region is cleared then refilled so `R` re-reads identical text.
- **Stop any time:** `Esc` cancels the rest of a scan and mutes the tone at once ("speech you can interrupt", forum.audiogames.net, afb.org). Also why speech is never queued behind a long scan: a newer announcement replaces a pending one.
- **One at a time, details on demand:** the scan speaks counts, not the whole list; `N`/`P` browse one thing, `Enter` gives detail.
- **Repeat last:** `R` (GAG: "Allow all narrative and instructions to be replayed").
- **Sweep with a rising tone and tracking what's unexplored:** gap 3 in the research (done in 3D by Surveyor; 2D point-and-click is a guess that nobody has).

Our choices, not sourced yet (tune with players):

- **Earcons 90–140 ms and never overlapping speech.** Short enough that 10 things take under 3 s, long enough to hear the type. Speech waits for the last earcon, and the sweep tone ducks while a name is read. Check against Brewster's earcon guidelines before quoting any of this.
- **Type by rhythm and timbre as well as pitch,** because pitch already carries height.
- **Direction in words too** ("left, near, high"): stereo doesn't help one-ear or speaker-only players, and it won't survive a mono video. A mono mode (pan → words or a left/right click count) is the next step.
- **Pan relative to the hero for sonar, but absolute screen x for the sweep cursor:** the sweep is about where the cursor is, the scan about where things are from you.
- **`role="application"`** on the room view so screen readers in browse mode pass the arrow keys through. Untested with a real reader.

## Data gaps found

- **No hero position in the JSON.** The patch dumps objects only. The engine has it: `curX, curY, curWidth, curHeight` in `engines/drascula/drascula.h` (lines 460, 465). Add to the `dumpRoom` format in `a11y.cpp`, and to each `A11Y_DIFF` after a walk:
  ```cpp
  s += Common::String::format(",\"hero\":[%d,%d]", curX + curWidth / 2, curY + curHeight);   // feet
  ```
  Until then the page reads `json.hero` if present, else a fallback: room 62's start position read off spike 03's screenshot (68,142), else (160,140), and `H` moves it.
- **No "kind".** Doors come from `door=1`; people are a hard-coded name list here. The a11y pack should carry `kind` per object.
- **Spanish names** (ESCALERA, HABITACIONES) need the pack's label table; the spike has a small one.

## Integrating into the web player later

1. Engine: the `hero` field above (minutes, plus a rebuild).
2. Make the sound code a module that takes the `A11Y` / `A11Y_DIFF` JSON (objects, hero) and the pack (kind, labels). `earcon()`, `cue()` and the sweep functions lift out as they are.
3. Sweep cursor ↔ engine: optionally warp the game's own mouse to the sweep cursor so ScummVM's hover label (`A11Y_HOVER`) and the game's hover text stay in step; and `Enter` could become "walk there / look".
4. Re-scan automatically when `A11Y_DIFF` says something appeared or a door changed, with one earcon for "new thing".
5. Share one speech queue with the rest of the player (game dialogue, ghost hints) so sonar never talks over them.
6. Settings: speed (onset gap), mono mode, tone volume, which types to include.

## Effort for the real build (guess)

About **2.5–3 days**, down from the research table's 3–4 because the sound design and tests exist: engine hero field 0.5 h; module port and wiring to live `A11Y` lines 0.5 day; mouse warp and hover sync 0.5–1 day; mono mode and settings 0.5 day; tuning with at least one blind tester 1 day (the part that matters). The judging video can use the debug view as is.
