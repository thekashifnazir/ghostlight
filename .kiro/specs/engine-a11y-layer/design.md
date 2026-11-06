# Design: engine a11y layer

## Overview

The engine a11y layer is a patch to ScummVM's Drascula engine that makes the game readable and drivable as text. It adds one new source file, `engines/drascula/a11y.cpp` (with a header), and small hooks in `drascula.cpp` (the main loop and room entry), `converse.cpp` (the conversation loop) and `graphics.cpp` (text drawing). It emits newline-delimited, prefixed log lines and reads a command file each frame. The same source builds natively and under Emscripten.

The layer is deliberately thin: it reuses the engine's own `verify2()`, `checkAction()`, `exitRoom()`, `walkToPoint()`, `removeObject()`, `chooseObject()` and save code rather than reimplementing game logic. Its job is to observe state, translate text commands into the engine's own calls, and report what changed.

### Design principles

- **Reuse engine code.** Every action routes through the same functions a mouse click would reach. This keeps behaviour identical to the real game and keeps the patch small and reviewable (Requirement 10).
- **Observe, do not reinterpret.** The layer reports flags, names and text exactly as the engine produces them, including Spanish names and flag 12 noise. Cleaning up is the pack's and the player's job, not the engine's.
- **One line in, one line out.** Each command produces exactly one `A11Y_DIFF`. State is a single `A11Y` line. Parsers can work line by line.
- **Same source, two targets.** No native-only or web-only code paths in the logic; only the I/O (reading the command file, emitting lines) touches platform surfaces, and both go through ScummVM's portable APIs.

## Architecture

```
            ┌─────────────────────────── Drascula engine (patched) ───────────────────────────┐
            │                                                                                  │
 room entry │   enterRoom() ──hook──► A11yLayer::onRoomEntry() ──► emit  A11Y {room state}      │
            │                                                                                  │
 each frame │   main loop ──hook──► A11yLayer::poll()                                           │
            │                         ├─ read <savepath>/a11y-cmd.txt                           │
            │                         ├─ dequeue one command (skip # lines)                     │
            │                         ├─ snapshot state                                         │
            │                         ├─ dispatch ──► engine's own verify2/checkAction/exitRoom │
            │                         ├─ wait until settled (walk/speech/cutscene done)         │
            │                         ├─ diff snapshot vs now                                   │
            │                         └─ emit A11Y_CMD, A11Y_DIFF, A11Y_TEXT, ...               │
            │                                                                                  │
 converse() │   conversation loop ──hook──► emit A11Y_CHOICES; apply choose <n>                 │
            │                                                                                  │
 updateEvents() (cutscene/speech) ──hook──► poll command file for a queued `skip`              │
            │                                                                                  │
 drawText() ──hook──► emit A11Y_TEXT                                                            │
            └──────────────────────────────────────────────────────────────────────────────────┘
                      emits via debug()/printErr  ──►  stderr (native) / Module.printErr (web)
                      reads commands from         ◄──  <savepath>/a11y-cmd.txt (FS.writeFile on web)
```

### Why a command file rather than a socket

The web build has no sockets, but it has an in-memory filesystem that page JavaScript writes with `FS.writeFile`. A file read each frame is the one mechanism that works identically on native and web, so the same code drives both. Output uses `printErr`, which the web page already receives as `console.error`/`Module.printErr`.

## Components

### A11yLayer (new: `a11y.cpp` / `a11y.h`)

Owns all a11y behaviour. Holds a reference to the `DrasculaEngine` so it can read state and call engine methods. Responsibilities:

- **State snapshot and diff.** Capture chapter, room, `visible[]`, door states, inventory, and `flags[NUM_FLAGS]` before a command; compare after; build the `A11Y_DIFF` object.
- **Command queue.** Read the command file, split into lines, drop `#` lines and blanks, keep a queue. Run one at a time; only dequeue the next when the current has settled.
- **Dispatch.** Map a command string to the engine calls below.
- **Emit.** Format and print the prefixed lines.

### Hook points

| File | Hook | Purpose |
|---|---|---|
| `drascula.cpp` | room entry (`enterRoom`) | emit `A11Y` room state (R1) |
| `drascula.cpp` | main loop (once per frame) | `poll()`: read + run one command, emit `A11Y_CMD`/`A11Y_DIFF` (R2, R4) |
| `drascula.cpp` | startup | skip intro, emit first room state (R1.4) |
| `converse.cpp` | conversation loop | emit `A11Y_CHOICES`, apply `choose` (R7.1, R7.2) |
| `drascula.cpp` | `updateEvents()` | poll for a queued `skip` during cutscenes/speech (R7.3) |
| `graphics.cpp` | text draw | emit `A11Y_TEXT` for every drawn line (R6.2) |

Hooks are kept to a few lines each; the work lives in `A11yLayer`.

## Command dispatch

| Command | Engine path |
|---|---|
| `look/take/open/close/talk/push <obj>` | set verb, `walkToPoint(obj)`, run `verify2()` body / `checkAction(obj)` for the object slot |
| `walk <obj>` | walk to the object; if it is a door, `exitRoom(slot)` |
| `use <item> <obj>` | `selectVerb(kVerbNone)`, `removeObject(item)`, `pickObject(item)`, run action for `obj`; return a still-held item afterwards |
| `<verb> <item>` / `use <item> <item2>` | open inventory screen (right-click equivalent), set `_menuScreen`, `checkAction(item)`, close screen |
| `<verb> 50` / `use <item> 50` | run the action against the hero (object 50) |
| `inventory` | emit `A11Y_INV`: ids, names (from `InventoryItems` enums), "look at it" line (pseudo-room 200) |
| `choices` | list the four conversation choices |
| `choose <n>` | in `converse()` loop, set the click state for line `n`; `4` ends the conversation |
| `skip` | raise the engine's `kActionSkip`, ending one line or the cutscene |
| `save <slot>` | engine save; emit `A11Y_SAVED` |
| `state` / `dump` | emit `A11Y` room state |
| `verb <0-6>` / `click <obj>` | low-level; `click` acts on the object slot directly, mouse warped for hover |

### Synthetic click model (R8)

A real click is a press then a release on a later frame. The layer models this with a tiny two-step: set the button down and warp the mouse to the object's hotspot on one frame, queue the release for the next. It never presses and releases in one frame (dropped) and never holds the button across dialogue (skips lines). Direct object actions do not depend on the pixel under the cursor; the warp exists only so the engine's hover name matches.

## Data formats

All a11y output is `PREFIX ` followed by, where noted, a single-line JSON object.

### `A11Y` room state (R1, R5)

```json
{
  "chapter": 1,
  "room": 62,
  "hero": { "x": 171, "y": 158 },
  "objects": [
    { "num": 52, "name": "BARTENDER", "rect": [x, y, w, h], "walkTo": [x, y], "visible": true, "door": false },
    { "num": 105, "name": "DOOR", "rect": [x, y, w, h], "walkTo": [x, y], "visible": true, "door": true, "toRoom": 63 }
  ],
  "inventory": [28],
  "flags": [0, 0, 0, ...]
}
```

- `hero` is `curX + curWidth/2`, `curY + curHeight` (R5.2), in the same space as `rect`/`walkTo` (R5.3).
- `inventory` lists real item ids (7+); verb slots 1 to 6 are excluded (gotcha 7).
- `flags` is all 50 entries, reported faithfully including flag 12 (gotcha 8).

### `A11Y_DIFF` (R4)

Fields present only when relevant:

```json
{
  "cmd": "open 183",
  "chapter": [1, 2],
  "room": [62, 14],
  "objects": [ ... new room's objects, doors carry toRoom ... ],
  "appeared": [ ... ], "disappeared": [ ... ], "doors": [ ... ],
  "invAdded": [ { "id": 22, "name": "handbag" } ],
  "invRemoved": [ { "id": 18, "name": "two coins" } ],
  "flags": { "19": [0, 1], "20": [0, 1] },
  "said": [ { "color": "yellow", "text": "I'VE FOUND B.J.'S HANDBAG!" } ],
  "changed": true
}
```

`changed: false` when nothing moved (R4.8). `room` change includes the new objects (R4.3); same-room visibility uses `appeared`/`disappeared` (R4.4).

### Other lines

- `A11Y_CMD <command>` — command received (R2.4).
- `A11Y_ERR <message>` — command could not run; keep going (R2.5).
- `A11Y_TEXT <line>` — a drawn text line (R6.2).
- `A11Y_CHOICES {"choices":[{"n":1,"text":"...","used":false}, ... {"n":4,"...","ends":true}]}` (R6.3).
- `A11Y_INV {"items":[{"id":28,"name":"phone","look":"THIS IS THE MOBILE PHONE..."}]}` (R6.4).
- `A11Y_SAVED <slot>` (R9.1).
- `A11Y_HOVER <name>`, `A11Y_SAY <tts>` — carried from the spikes for parity; not required by this spec but cheap to keep.

## Settling

A command is settled when control returns to the main loop with walking finished, speech over, and any triggered conversation or cutscene ended. The layer dequeues the next command only then (R2.2). Because conversations and cutscenes run their own loops, the diff is built after those loops return, so a single `walk` that crosses a chapter boundary (walk out, cutscene, enter chapter 2) yields one coherent diff with `chapter`, `room` and the new objects.

## Text colours and names

`said` carries the engine's text colour per line (yellow is the hero; others vary). Mapping colours to speaker names is a later spec; here the colour is passed through. Inventory names come from the `InventoryItems` enums and the item-look table; the engine reports room object names raw, including Spanish ones (the pack fixes labels, not this layer).

## Build and configuration

- **Subtitles on** is mandatory (R6.1, gotcha 1); the run scripts pass `--subtitles`, and the layer can assert it at startup and warn via `A11Y_ERR` if off.
- **Audio:** the Ogg pack plus `--extrapath` for `drascula.dat` (gotcha 13) to avoid the blocking CD-audio dialog.
- **Intro skip** at startup (R1.4), hard-coded as in the spike.
- **Savepath** is where the command file lives; launch with `--savepath=<dir> --subtitles`.
- **Native vs web:** native opens a real window (fully headless SDL is flaky, gotcha 12); the web build runs in the browser. Logic is identical; only window/driver differ.
- **Licence:** GPL-3.0-or-later for the patch and the built wasm (R10.3).

## Testing strategy

This spec authors no code, but the design is built to be testable:

- **Replay transcripts.** The spike command scripts (tavern, leave-tavern, ch2 handbag, ch2 vending machine) become fixtures: feed the command file, assert the sequence of `A11Y_DIFF` lines. These exercise room entry, verbs, `use item on object`, doors, conversations, flags and the chapter crossing.
- **Snapshot/diff unit checks.** Given two synthetic state snapshots, assert the diff object is correct for each field (room change, appeared/disappeared, inv, flags, said, `changed:false`).
- **Click model.** Assert press and release land on separate frames and the button is not held across a dialogue line.
- **Hero point.** Assert `hero` equals `curX + curWidth/2`, `curY + curHeight` for a known pose.
- **Gotcha guards.** A startup check that subtitles are on; a note that flag 12 is reported but flagged as noise for downstream.
- Current Emscripten FS, ARIA, Web Audio, Playwright and fast-check details are looked up via the Context7 power when the web player and tests are built, so the glue uses real APIs.

Automation uses the web build or a virtual display, not fully headless native SDL.

## Open questions deferred to later specs

- Speaker names from text colours (hints/ghost spec and pack).
- Flag-to-progress mapping for hints (hints/ghost spec).
- `use item on item` combinations (none occur in chapters 1 to 2; the path exists but is unexercised).
- Checking the `skip` poll timing under the web build (web player spec).
