# Design: player (accessible web page)

## Overview

The player is a small, framework-free web page (HTML + TypeScript, no build framework needed) that makes Drascula playable by keyboard and screen reader. It reads the engine's `A11Y` lines through an adapter, turns room state into an ordered hotspot list, lets the player cycle and act on that list with a handful of keys, draws a highlight on the canvas for a sighted co-player, and writes every functional line as text to one polite live region that interrupts. Words the engine cannot give (room names, descriptions, spoken names, exit labels, item names, text fixes) come from the accessibility pack, read-only.

The design is built around two seams so the player can exist before the web build does:

- **Engine adapter seam.** All engine contact is behind an `EngineAdapter` interface that speaks the `A11Y` line contract. A `ReplayAdapter` plays recorded `A11Y` logs; a `LiveAdapter` (stubbed here, completed by the web player hosting work) drives the real wasm build. The player depends only on the interface.
- **Pure core.** The parts worth property-testing (hotspot list building and ordering, duplicate naming, the typed-phrase matcher) are pure functions over plain data, with no DOM or engine dependency, so fast-check can hammer them directly.

This spec authors the page, the interaction model, the adapters, the parser and the tests. It does not touch `engine/`, `packs/` or `scripts/`, and it copies nothing from `reference/`.

### Where the code lives

All player code lives under `src/`, MIT-licensed:

```
src/
  index.html            start gate, hidden canvas, live region, inventory + verb-menu containers
  main.ts               wiring: pick adapter, load pack, boot, own the keyboard
  engine/
    adapter.ts          EngineAdapter interface + the shared A11Y line types
    a11y-lines.ts       pure parser: A11Y log line -> typed event (room state, diff, text, choices, inv)
    replay-adapter.ts   ReplayAdapter: plays a recorded A11Y log, advances on command
    live-adapter.ts     LiveAdapter: stub boundary for the real wasm build (completed elsewhere)
  model/
    hotspot-list.ts     pure: room state (+ pack) -> ordered, de-duplicated, uniquely-named hotspots
    naming.ts           pure: unique spoken names for duplicates (position words from x)
    parser.ts           pure: typed phrase + visible hotspots + inventory -> match | ambiguous | none
    pack.ts             pack reader: names, descriptions, exit labels, item names, textFixes (read-only)
  ui/
    live-region.ts      the one polite role=log region; interrupt-replace writes
    list-mode.ts        focus state, Left/Right cycling, announcements
    verb-menu.ts        roving-focus menu for open/close/talk/push
    inventory.ts        inventory view, active item, Backspace cancel
    highlight.ts        canvas overlay rectangle for the focused hotspot
    controller.ts       maps key events to intents; routes intents to adapter + UI
  fixtures/
    *.a11y.log          recorded A11Y logs used by the replay adapter in tests
test/
  *.spec.ts             Playwright specs (driven through the replay adapter)
  *.prop.test.ts        fast-check property tests over the pure core
  axe.spec.ts           axe-core checks across key states
```

`vendor/` and the real wasm build are out of scope here; the `LiveAdapter` is a typed stub so `main.ts` compiles and the seam is real, and the web player spec completes it.

### Design principles

- **The list is the game.** Left/Right over a complete, strictly-ordered list is the primary mode. Typed commands and (later) sonar sit beside it, never replace it.
- **One line in, one line out of the live region.** Every functional line replaces the region's content so the newest thing interrupts. No queue, no pile-up.
- **Pure where it matters.** Ordering, de-duplication, naming and matching are pure functions, so properties are cheap to assert and the DOM is thin.
- **Adapter, not engine.** The player never sees pixels or engine internals. Swapping the live engine for recorded logs changes one line in `main.ts`.
- **Pack supplies words, never behaviour.** The pack is read-only input; the player renders it and applies its text fixes, and never writes it.

## Architecture

```
  keyboard ──► ui/controller.ts ──intent──► EngineAdapter.send(command)
     ▲               │                           │
     │               │ focus/active-item         │  (ReplayAdapter | LiveAdapter)
     │               ▼                           ▼
     │        ui/list-mode.ts            A11Y lines in  ── engine/a11y-lines.ts ──► typed events
     │        ui/verb-menu.ts                                           │
     │        ui/inventory.ts                                           ▼
     │        ui/highlight.ts  ◄──focused hotspot rect──  model/hotspot-list.ts (room state + pack)
     │               │                                                  │
     └────────────── ui/live-region.ts  ◄── announcements ◄────────────┘
                     (one polite role=log, interrupt-replace)

  model/pack.ts  ──words──► hotspot-list, list-mode, inventory, live-region
  model/parser.ts ──typed phrase + visible hotspots──► intent (optional shortcut)
```

The controller owns the keyboard and the current mode (list, verb menu, inventory, typed box). It turns keys into intents, asks the model for the target hotspot, sends a command through the adapter, and feeds the adapter's resulting events back into the UI and the live region.

## Components

### `engine/adapter.ts` — the seam (R10)

```ts
export type HotspotKind = "object" | "npc" | "exit";

export interface RoomObject {      // one entry per engine hotspot number
  num: number;
  name: string;                    // raw engine name (pack overrides downstream)
  rect: [number, number, number, number];  // x, y, w, h
  walkTo: [number, number];
  visible: boolean;
  door: boolean;
  toRoom?: number;
}

export interface RoomState {
  chapter: number;
  room: number;
  hero: { x: number; y: number };
  objects: RoomObject[];
  inventory: number[];
  flags: number[];
}

export interface Diff {
  cmd: string;
  chapter?: [number, number];
  room?: [number, number];
  objects?: RoomObject[];
  appeared?: RoomObject[];
  disappeared?: RoomObject[];
  invAdded?: { id: number; name: string }[];
  invRemoved?: { id: number; name: string }[];
  flags?: Record<string, [number, number]>;
  said?: { color: string; text: string }[];
  changed: boolean;
}

export interface Choice { n: number; text: string; used?: boolean; ends?: boolean; }
export interface InvItem { id: number; name: string; look?: string; }

export type EngineEvent =
  | { type: "room"; state: RoomState }
  | { type: "diff"; diff: Diff }
  | { type: "text"; line: string }
  | { type: "choices"; choices: Choice[] }
  | { type: "inv"; items: InvItem[] }
  | { type: "cmd"; cmd: string }
  | { type: "error"; message: string }
  | { type: "saved"; slot: number };

export type Command =
  | { verb: "look" | "take" | "open" | "close" | "talk" | "push" | "walk"; target: number }
  | { verb: "use"; item: number; target: number }      // target: hotspot num or item id
  | { verb: "inventory" }
  | { verb: "choices" }
  | { verb: "choose"; n: number }
  | { verb: "skip" }
  | { verb: "save"; slot: number };

export interface EngineAdapter {
  start(): Promise<void>;
  send(cmd: Command): void;
  onEvent(listener: (e: EngineEvent) => void): () => void;  // returns an unsubscribe
}
```

The `A11Y`/`A11Y_DIFF`/… shapes mirror the engine a11y layer's data formats exactly, so the live adapter and the replay adapter produce identical `EngineEvent`s.

### `engine/a11y-lines.ts` — pure line parser (R10.2, R11.2)

A pure function `parseA11yLine(line: string): EngineEvent | null` that strips ScummVM's `WARNING: ` prefix and trailing `!`, dispatches on the prefix (`A11Y`, `A11Y_DIFF`, `A11Y_TEXT`, `A11Y_CHOICES`, `A11Y_INV`, `A11Y_CMD`, `A11Y_ERR`, `A11Y_SAVED`), and parses the JSON payload into the typed event. `A11Y_HOVER` and `A11Y_SAY` are ignored (the game's own TTS stays off so it never talks over the screen reader). Both adapters use this parser, so they cannot drift.

### `engine/replay-adapter.ts` — recorded logs (R11)

Implements `EngineAdapter` over a recorded `A11Y` log (an array of lines, each a fixture in `src/fixtures/`). On `start()` it emits events up to and including the first room state. On `send(cmd)` it:

1. Expects the log's next `A11Y_CMD` to match the command it would serialise (same verb and target). If it does not, it emits an `error` event describing the mismatch and does not invent behaviour (R11.4).
2. Otherwise emits every event up to and including the next `A11Y_DIFF` (and any interleaved `A11Y_TEXT`/`A11Y_CHOICES`/`A11Y_INV`), i.e. the engine's full response to that command.

This lets a recorded session play back as the player drives it, with no live engine (R11.3, R11.5). Fixtures are recorded from the engine a11y layer's own replay transcripts (tavern, leave-tavern, ch2 handbag, ch2 vending machine), copied in as logs, not generated by this spec.

### `engine/live-adapter.ts` — real engine stub (R10)

A typed stub implementing `EngineAdapter` that documents how it will write `/tmp/a11y-cmd.txt` via `FS.writeFile` and read `Module.printErr` lines through `parseA11yLine`, deferred to the web player spec. It exists so the seam is real and `main.ts` compiles against the interface, not so this spec ships a working wasm boot.

### `model/hotspot-list.ts` — the ordered list (R1, R2, pure)

```ts
export interface Hotspot {
  num: number;            // engine hotspot number (the pack key)
  kind: HotspotKind;      // object | npc | exit
  name: string;           // final spoken name (pack + unique-duplicate suffix)
  rect: [number, number, number, number];
  toRoom?: number;
}

export function buildHotspotList(state: RoomState, pack: Pack): Hotspot[];
```

Steps, all pure:

1. Take every `object` with `visible === true`; split into exits (`door === true` or pack `type: "exit"`) and objects/people.
2. Resolve each name: pack `objects.<num>.name` / `exits.<num>.label` if present, else the engine name with `textFixes` applied, else a fallback (`item <num>`).
3. Determine kind: `exit` for doors and pack exits, `npc` where the pack says `type: "npc"`, else `object`.
4. Sort strictly by `rect[0]` (left edge) ascending, then `rect[1]` (top edge) ascending. This is the single source of visual order; the property test pins it.
5. Pass to `naming.ts` to make duplicate spoken names unique.

De-duplication by hotspot number happens upstream in the room state already (the engine reports one entry per number per the pack rule), so the list is one entry per number by construction; the builder asserts uniqueness of `num`.

### `model/naming.ts` — unique duplicate names (R2.5, gotcha 4)

```ts
export function uniquifyNames(hotspots: Hotspot[]): Hotspot[];
```

Groups hotspots by resolved base name. For a group of size one, the name is unchanged. For a group of size two or more, it assigns position words from each hotspot's rect left edge within the group: two become "left"/"right", three become "left"/"middle"/"right", more fall back to "first", "second", … The prefix is prepended to the base name ("left door"). Order within a group follows visual order, so the words match the screen.

### `model/parser.ts` — typed shortcut matcher (R12, pure)

```ts
export type Match =
  | { kind: "hotspot"; hotspot: Hotspot; verb?: EngineVerb }
  | { kind: "item"; item: InvItem; verb?: EngineVerb }
  | { kind: "use"; item: InvItem; target: Hotspot | InvItem }
  | { kind: "fixed"; action: "repeat" | "readRoom" | "help" | "inventory" | "skip" | "choices" | "cancel" }
  | { kind: "choice"; n: number }
  | { kind: "ambiguous"; options: Hotspot[] }
  | { kind: "none"; present: string[] };

export function parsePhrase(
  phrase: string,
  visible: Hotspot[],
  inventory: InvItem[],
  context: { inConversation: boolean; pendingChoice: boolean }
): Match;
```

Rules mirror the proven spike model but are rebuilt clean: fixed phrases first (help, repeat, inventory, exits/what's here, skip, choices, cancel), then verb phrases mapping lead words to the seven engine verbs with `on/with/in/to` splitting item from target, then a bare name. Name matching scores each visible hotspot (and carried item) per word and takes the top score; a tie returns `ambiguous` so the controller asks rather than guesses (R12.4); no candidate returns `none` with the present names listed (R12.5). Crucially the candidate set is exactly the currently visible hotspots and carried items, so a phrase can never resolve to an absent thing (R12.3) — the second property test pins this.

### `model/pack.ts` — pack reader (R8, R15.2)

Loads `drascula-en.json`, validates `formatVersion` major is `1`, and exposes read-only lookups: `roomName(room)`, `roomShort(room)`, `roomLong(room)`, `exitLabel(room, num)`, `exitTo(room, num)`, `objectName(room, num)`, `objectType(room, num)`, `itemName(id, chapter)`, and `applyTextFixes(raw, context, room)`. Unknown rooms/objects return `undefined` so callers fall back to engine data (R8.2). The pack is never written.

### `ui/live-region.ts` — the one region (R9)

A single `div role="log" aria-live="polite" aria-atomic="true"`. `announce(text)` replaces its text content (not append), so each functional line interrupts rather than queues (R9.3, gotcha 5). Keeps the last announced line for the repeat key (R7.1). The canvas is `aria-hidden="true"` (R9.2). A small helper composes the room-entry announcement (name, short description, things and people, exits) and the "N of M" focus announcement.

### `ui/list-mode.ts` — cycling and focus (R1.7, R2)

Holds the current `Hotspot[]` and focused index. `next()`/`prev()` move with wrap (R2.3) and announce "name, N of M" (R2.4). `rebuild(list)` replaces the list and focuses index 0 (R2.6, R1.5). `current()` gives the focused hotspot for interact/examine/verb-menu/highlight. Exactly one focused while non-empty (R1.7); none when empty.

### `ui/verb-menu.ts` — open/close/talk/push (R4)

A `role="menu"` with four `role="menuitem"` buttons and roving real focus (not `aria-activedescendant`, gotcha 9), each announced on focus. Choosing a verb sends `{verb, target: focusedNum}` and closes, returning focus to the list (R4.5). Cancel (Backspace/Escape) closes and returns focus, announcing the return (R4.4).

### `ui/inventory.ts` — active item (R6)

Tab opens a keyboard-operable list of carried items by pack name (R6.1). Choosing an item sets it active and announces it (R6.2). With an item active: interacting on a focused hotspot sends `use item target` (R6.3); choosing another item sends `use item item2` (R6.4). Backspace clears the active item if set, else closes the inventory, announcing the cancel (R6.5). On `invAdded` it announces "Received X"; on `invRemoved` it announces the item is no longer carried (R6.6, R6.7), both via the item's pack name.

### `ui/highlight.ts` — canvas overlay (R5)

An absolutely-positioned overlay element over the (aria-hidden) canvas. `show(rect)` positions a visible border rectangle over the focused hotspot's rect, scaled from engine coordinates to the canvas's displayed size; `hide()` when the list is empty (R5.5). When the focused rect is off the visible area, the highlight is clamped to the edge with a direction marker so a sighted co-player can still tell where focus is (R5.3). The overlay is `aria-hidden` and purely decorative (R5.4): it carries nothing not already in the live region.

### `ui/controller.ts` — keys to intents (R3, R7, R13)

Owns the keyboard. Stops `keydown`/`keyup`/`keypress` propagation inside the page UI so typed keys never reach the engine's own input (gotcha 7). Key map while the list is active:

| Key | Intent |
|---|---|
| Left / Right | `list.prev()` / `list.next()` |
| Up / Enter | interact with focused hotspot (auto-walk + default action, or `use activeItem target`) |
| Down | examine focused hotspot (`look`) |
| (verb-menu key) | open verb menu on focused hotspot |
| Tab | open inventory |
| Backspace | cancel (clear active item, else close inventory/menu) |
| repeat key | re-announce last line |
| read-room key | read the whole room |
| F1 | read help |
| Escape | `skip` |

Interact resolves the default action by kind: exit → `walk`; object/person → the engine's primary action for that hotspot (R3.2, R3.3). Every interact/examine/verb targets the hotspot number, never a pixel (R3.5). After any action, focus returns to the list unless the inventory or a menu is open (R13.3).

### `main.ts` — wiring and the start gate (R13.4, gotcha 8)

Sets up `window.Module` (hidden canvas, `printErr`) before anything engine-related, shows the start gate with a focused start button, and only on the first key press creates the audio context and calls `adapter.start()`. Chooses the adapter: `ReplayAdapter` when a `?replay=<fixture>` (or test flag) is set, else `LiveAdapter`. Loads the pack, subscribes to adapter events, and feeds them to the model and UI:

- `room` → `buildHotspotList` → `list.rebuild` → read the room (R8), show highlight.
- `diff` → apply visibility changes to the list (R1.6), announce `said` lines and inventory changes, re-read room on room change.
- `text`/`choices`/`error`/`saved` → announce.

## Handling engine events

| Event | Player response |
|---|---|
| `room` | build + order the hotspot list; focus first; read room name, description, things/people, exits; show highlight |
| `diff` with `room`/`chapter` | rebuild list for the new room; announce the change and `said`; re-read the room |
| `diff` with `appeared`/`disappeared` | update the list in place, keeping order and single-focus; announce |
| `diff` with `invAdded`/`invRemoved` | announce "Received X" / "no longer carried"; refresh inventory |
| `diff` `said` | announce each line as text |
| `diff` `changed:false` | announce that nothing changed |
| `text` | announce the drawn line |
| `choices` | announce numbered choices (with "already said" / "ends the conversation"); enter choice context |
| `inv` | populate the inventory view with pack names |
| `error` | announce the plain-English problem; stay in place |
| `saved` | announce saved |

## Accessibility model

- One polite `role=log` live region carries every functional line; writes replace content so the newest interrupts (R9.1, R9.3).
- Canvas is `aria-hidden`; the highlight overlay is decorative and also `aria-hidden` (R5.4, R9.2).
- List focus is a single-selection model announced in full ("name, N of M") on every move, which does not depend on `aria-activedescendant` support (gotcha 9); the verb menu and inventory use roving real focus on buttons.
- All speech/audio stops on any key or focus change (R9.5): the controller calls a global `stopAudio()` at the top of every key handler.
- Keyboard reaches everything including the start screen (R13); focus returns to the list after actions (R13.3).
- ALL-CAPS game text is kept as written but may be sentence-cased before speaking if screen-reader testing shows it reads badly (a one-line change isolated in `live-region.ts`), per the spike caveat.

## Testing strategy

All tests run with no live engine, through the `ReplayAdapter` over recorded fixtures (R14.5).

- **Playwright (`test/*.spec.ts`)** drives the page via the replay adapter (`?replay=tavern` etc.) and asserts the interaction model from the live region's text and focus: start-screen keyboard start; room read on entry; Left/Right cycling with "N of M" and wrap; unique duplicate names ("left/middle/right door"); Up/Enter interact (walk + act); Down examine; verb menu open, choose, cancel, focus return; Tab inventory, make active, use on hotspot, use on item, Backspace cancel; "Received X"; repeat, read-room, F1; typed shortcut mapping a visible name and refusing an absent one.
- **axe-core (`test/axe.spec.ts`)** across start screen, in-room play, verb menu open, inventory open — zero violations (R14.2).
- **fast-check (`test/*.prop.test.ts`)** over the pure core:
  - For any generated `RoomState`, `buildHotspotList` returns a list whose `num`s are exactly the visible hotspots, each once, and whose order is non-decreasing by `(rect.left, rect.top)` (R14.3). A generator produces random objects with overlapping and equal rects to exercise ties.
  - For any generated set of visible hotspots and any phrase built from one hotspot's name, `parsePhrase` returns that hotspot; for any phrase built from a name not in the set, it never returns a hotspot (returns `none` or `ambiguous`) (R14.4).
  - Supporting properties: `uniquifyNames` yields distinct names within every duplicate group; `rebuild` always leaves exactly one focused index in range for a non-empty list.
- **Current web APIs** (ARIA live-region behaviour, `aria-activedescendant` vs roving focus, axe-core and fast-check and Playwright usage) are confirmed against up-to-date docs via the Context7 power while building, so the glue uses real, current APIs.

## Boundaries (R15)

- All code under `src/` and `test/`; nothing in `engine/`, `packs/` or `scripts/` is edited.
- The pack is read-only input (`model/pack.ts` only reads).
- MIT-licensed; no GPL engine source is copied in. The `LiveAdapter` only describes the `FS.writeFile`/`printErr` glue; it does not vendor engine code.
- Nothing is copied from `reference/`; the interaction model is rebuilt from the proven patterns, and fixtures are recorded `A11Y` logs, not the spike's page.

## Deferred to other specs

- The real wasm boot and hosting, completing `LiveAdapter` (web player / demo-and-hosting specs).
- Sonar on the focused hotspot (sonar spec).
- The ghost and graded hints keyed on milestones (hints/ghost spec).
- Speaker names from text colours (hints/ghost spec and pack).
- Save/load UI from the page beyond passing `save` through the adapter.
