# Replay fixtures

Each fixture is a recorded run of the engine a11y layer: an initial `A11Y`
room-state line, then a list of command steps. Every step holds the command
sent and the ordered a11y lines it produced (the `A11Y_CMD` echo plus the single
`A11Y_DIFF` or `A11Y_ERR`, with any `A11Y_TEXT` / `A11Y_CHOICES` / `A11Y` /
`A11Y_INV` / `A11Y_SAVED` the command caused).

These four fixtures are transcribed from spike 04
(`reference/spikes/04-items-doors.md`), the recorded run where a text-command
script played chapter 1 start to finish and the first chapter-2 puzzle chain:

- `tavern.json` — chapter 1, rooms 62/63: inventory, verbs, the drunkard
  conversation, the bartender talk (flag 0), the locked door text, then out the
  door with the chapter 1 to 2 crossing (one coherent diff).
- `leave-tavern.json` — the door/cutscene/chapter crossing in isolation.
- `ch2-handbag.json` — chapter 2: up to room 16, open the trunk (handbag), open
  the handbag on the inventory screen (money, two coins).
- `ch2-vending-machine.json` — chapter 2: the vending machine, including the
  error/failure cases (`use 18 188` returns a coin, `push 188` yields the
  cigarettes).

## Why fixtures, for now

The spec says replay runs use the native build in a real window, not the web
build, and that fully headless SDL is flaky (gotcha 12). These fixtures stand in
for the engine so the regression and property tests are real and runnable today
with no engine build. The `EngineHarness` seam means the same tests run against
the native build unchanged (`GHOSTLIGHT_NATIVE=1`, see below); the fixtures
double as the golden transcript the native run is checked against (the spec's
"assert the sequence of `A11Y_DIFF` lines").

## Starting state: chapter 1 replays, chapter 2 loads a save (task 19)

How each fixture reaches its first room under the native harness is declared in
`src/fixture.ts` (`FIXTURE_START`):

- **Chapter-1 fixtures** (`tavern`, `leave-tavern`) start at the first playable
  room and REPLAY from the beginning — a fresh launch, no save.
- **Chapter-2 fixtures** (`ch2-handbag`, `ch2-vending-machine`) start partway
  through. Rather than replay all of chapter 1 (the drunkard conversation, the
  bartender talk, and the long `animation_2_1` crossing cutscene — minutes of
  paced skips), the native harness LOADS a saved game taken at the chapter-2
  start with `--save-slot` (engine-a11y-layer R9.2) and begins in chapter 2 room
  14 in about two seconds. Both chapter-2 fixtures share one save slot (9),
  since both begin in the same room; each fixture's own command script then
  drives its puzzle from there.

### Producing the chapter-2 save

The chapter-2 save is produced on demand, never committed: a Drascula save
embeds a graphics thumbnail (copyrighted game data), so it is regenerated rather
than checked in. To create it before a native run:

```sh
scripts/build-engine.sh                 # once, to build the native binary
scripts/make-ch2-save.sh /tmp/ghostlight-engine 9
GHOSTLIGHT_NATIVE=1 GHOSTLIGHT_SAVEPATH=/tmp/ghostlight-engine npm test
```

`make-ch2-save.sh` drives the real engine from the tavern through the chapter
1->2 crossing once and saves to the slot; the native harness then loads that
slot for every chapter-2 fixture. Without `GHOSTLIGHT_NATIVE`, the suite runs
fixture-backed and needs none of this.

## Format

```jsonc
{
  "label": "tavern",
  "start": { /* A11Y room-state object, no "kind" field */ },
  "steps": [
    { "cmd": "inv", "lines": [ /* raw-shaped line objects, see loader */ ] }
  ]
}
```

Lines are stored in a compact raw shape (prefix name plus payload) and expanded
by `src/fixture.ts` into the typed model so they share one parser contract with
a future native run.
