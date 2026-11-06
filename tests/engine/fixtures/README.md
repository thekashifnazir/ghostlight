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
build, and that fully headless SDL is flaky (gotcha 12). Until the native
harness is wired, these fixtures stand in for the engine so the regression and
property tests are real and runnable today. The `EngineHarness` seam means the
same tests will run against the native build unchanged once it is available; the
fixtures then double as the golden transcript the native run is checked against
(the spec's "assert the sequence of `A11Y_DIFF` lines").

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
