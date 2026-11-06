# ScummVM accessibility pack, format v0.1 (draft)

A per-game JSON file that supplies what an engine can't: names for rooms and exits, short and long room descriptions, spoken names for hotspots, item names, fixes for bad strings, audio description for cutscenes, and progress milestones with graded hints. The engine supplies live state (room number, hotspot numbers and positions, inventory ids, progress flags). The pack supplies words.

It answers the 2021 ScummVM tracker comment that hotspots "are not exposed via some API yet" and that a metadata format and test data for one game come first (lists.scummvm.org/pipermail/scummvm-tracker/2021-April/028790.html). The first test data is `drascula-en.json` (chapters 1 and 2).

Machine-readable rules: [schema.json](schema.json) (JSON Schema 2020-12). Cross-reference rules the schema can't express are in `tools/validate.py`.

## How it lines up with ScummVM's hotspot API

ScummVM merged a hotspot display API on 13 July 2026 (PR #7135, `engines/engine.h`, `graphics/hotspot_renderer.h`):

```cpp
enum HotspotType { kHotspotDefault, kHotspotObject, kHotspotExit, kHotspotNPC };
struct HotspotInfo { Common::Point position; Common::U32String name; HotspotType type; };
virtual void getHotspotPositions(Common::Array<Graphics::HotspotInfo> &hotspots);
```

| Engine API | Pack |
|---|---|
| `HotspotInfo.position` | Not in the pack. Positions are live engine data. |
| `HotspotInfo.name` | `rooms.<room>.objects.<num>.name` or `exits.<num>.label`; `textFixes` for raw engine strings |
| `HotspotInfo.type` | `type`: `object` = `kHotspotObject`, `exit` = `kHotspotExit`, `npc` = `kHotspotNPC`. Everything under `exits` is `exit`. |
| (none) | Hotspot key. `HotspotInfo` has no id, so the pack keys on the engine's own per-room hotspot number. See open questions. |

The macs2 engine already hard-codes a `(scene, hotspot) → type, name` table in C++ (`engines/macs2/hotspot_names.cpp`). The pack is the data-file version of that table, plus the things a blind player needs on top.

## File

One file per game, engine and language: `<gameid>-<lang>.json`, for example `drascula-en.json`. All text in the file is in that language.

```json
{
  "$schema": "schema.json",
  "format": "scummvm-a11y-pack",
  "formatVersion": "0.1",
  "game": { "engine": "drascula", "gameId": "drascula", "language": "en", "platform": "dos", "title": "...", "variant": "..." },
  "pack": { "version": "0.1.0", "updated": "2026-11-06", "coverage": { "chapters": [1, 2] }, "speechLocale": "en-GB" },
  "textFixes": [],
  "chapters": {},
  "rooms": {},
  "items": [],
  "cutscenes": {},
  "milestones": []
}
```

- `game.engine` and `game.gameId` are ScummVM's ids (the engine name and the detection `gameid`). `game.language` is ScummVM's language code. `game.variant` is free text for which release the numbers were taken from.
- `formatVersion` is the format; `pack.version` is this file's content (semver). A reader rejects a major `formatVersion` it doesn't know.
- Numeric ids are JSON object keys, so they're strings of digits (`"62"`).

## Rooms

```json
"rooms": {
  "16": {
    "chapters": [2],
    "name": "Guest bedroom",
    "short": "One or two sentences for list mode.",
    "long": "A fuller paragraph for 'describe the room': what's where, left to right.",
    "seen": true,
    "exits":   { "163": { "label": "door to the stairs", "to": 14, "direction": "left" } },
    "objects": { "183": { "name": "trunk", "type": "object", "description": "A wooden chest under the window." } }
  }
}
```

| Field | Rule |
|---|---|
| `chapters` | Chapters the room appears in. Room numbers that mean different places in different chapters aren't handled in v0 (Drascula doesn't need it). |
| `name` | Short, no article: "Guest bedroom". |
| `short` | 1–2 sentences. Said on entering a room in list mode. |
| `long` | Said on "describe the room". Concrete: what's on the left, middle, right. No puzzle answers. |
| `seen` | `true` if written from the room's actual picture, `false` if from object names and game text only. |
| `note` | Optional, for maintainers. Never spoken. |
| `exits` | Keyed by hotspot number. `label` (spoken), `to` (destination room number, or `null` when walking through ends a chapter or runs a scene), optional `direction` (`left`, `right`, `ahead`, `back`, `up`, `down`), optional `opensWhen` (a condition, below) for exits that only work in some states, optional `note`. |
| `objects` | Keyed by hotspot number. `name` (spoken, replaces the engine's label), `type` (`object`, `exit`, `npc`), optional `description`, optional `note`. Use `type: "exit"` here for something that looks like a way out but isn't an engine door. |

Several engine hotspots can share one number (four garlic bunches in Drascula's room 18). The pack has one entry per number, and a list mode should de-duplicate the same way.

Every hotspot the engine can report for a covered room should have an entry in `exits` or `objects`. `tools/check_coverage.py` checks this against the census.

## Items

```json
"items": [ { "id": 22, "chapters": [2, 3], "name": "B.J.'s handbag", "description": "A lady's handbag." } ]
```

Drascula reuses inventory ids for different things in later chapters, so an item entry says which chapters it covers. `(id, chapter)` must be unique (validator). Names are lower case unless a proper noun, because they're spoken mid-sentence ("You picked up the handbag").

## Text fixes

```json
"textFixes": [
  { "from": "ESCALERA", "to": "stairs", "context": "hotspot", "rooms": [14], "reason": "spanish" },
  { "from": "DON'T DE AFRAID", "to": "DON'T BE AFRAID", "context": "dialogue", "match": "substring", "reason": "typo" }
]
```

Applied to raw engine strings before they are spoken or shown. `match` is `exact` (default, whole string) or `substring`. `context` is `hotspot` (names and labels), `dialogue` (anything said or a conversation choice) or `any`. `rooms` limits it; leave it out for game-wide. `reason`: `spanish`, `typo`, `spelling`, `clarity`. Per-hotspot `name`s in `rooms` win over text fixes.

## Chapters

```json
"chapters": { "1": { "name": "The inn", "startRoom": 62, "summary": "One or two sentences, spoken as 'Previously' at the start of the next chapter." } }
```

## Cutscenes

```json
"cutscenes": {
  "animation_2_1": { "chapter": 1, "trigger": "...", "hasDialogue": true, "description": "Audio description.", "seen": true }
}
```

Keyed by an engine-specific id. For Drascula that's the `animation_*` function name, which is also what a hook in the engine would report. `description` is the audio description, spoken before the scene's own dialogue (or instead of silence when `hasDialogue` is false). `seen` as for rooms: `true` if written from the scene's frames, `false` if from the code and its dialogue only.

## Conditions

Used by milestones and by `exits.*.opensWhen`. Every key present must hold (AND).

```json
{ "chapter": 2, "room": [14, 62], "flags": { "23": 1, "36": 0 }, "has": [22], "lacks": [7],
  "all": [ ... ], "any": [ ... ], "not": { ... }, "milestone": "ch2.money" }
```

| Key | Holds when |
|---|---|
| `chapter` | current chapter equals it |
| `room` | current room equals it, or is in the list |
| `flags` | each listed progress flag has that value |
| `has` / `lacks` | every listed inventory id is / isn't held |
| `all` / `any` / `not` | the usual |
| `milestone` | that milestone has been reached |

`flags` are the engine's own progress variables. Drascula resets all 50 at each chapter start and reuses the numbers, so a flag condition only means something inside one chapter.

## Milestones and hints

```json
{
  "id": "ch2.handbag",
  "chapter": 2,
  "title": "Found B.J.'s handbag",
  "after": ["ch2.start"],
  "when": { "flags": { "20": 1 } },
  "rooms": [14, 16],
  "recap": "You found B.J.'s handbag in a trunk upstairs.",
  "hints": { "nudge": "...", "clue": "...", "answer": "..." }
}
```

- `when` is evaluated only while the current chapter is the milestone's `chapter`. A milestone counts as reached in every later chapter.
- `end: true` (instead of `when`) marks the step that finishes a chapter. It's reached when the chapter changes.
- `after` lists milestones that must be reached first. Hints are offered for a milestone only when all of its `after` are reached and it isn't reached yet.
- `rooms` (optional) says where the hint is most relevant. When several milestones are open, prefer one whose `rooms` include the current room, then the first in file order.
- `optional: true` for steps the chapter can be finished without.
- `recap`: past tense, second person. Used for "previously" and "what have I done?".
- `hints`: three tiers, always all three.
  - `nudge` points at the area of the problem without naming the object or action.
  - `clue` names the place and thing, not the exact action.
  - `answer` gives the exact action in game terms (verbs the player has: look, take, open, close, talk, push, use).
- Runtimes should latch milestones once reached: some games clear a flag later (Drascula clears flag 38 once the brew is made).

Hint text is written fresh for the pack. Never copy published walkthroughs.

## Writing rules

- Plain, short sentences. British English for `-en` packs. No em dashes.
- Concrete over atmospheric: "the door is on the left" beats "a foreboding portal".
- Descriptions never solve puzzles. A room description names what's there; it doesn't say what's hidden or what to use it with.
- Say where things are relative to the screen (left, middle, right, foreground, back wall).
- Translate any foreign text visible in the picture.

## Versioning

- `formatVersion` "0.x": breaking changes allowed between minor versions while it's a draft.
- From "1.0": additive fields only within a major version; readers ignore unknown fields (the schema allows extra `x-` prefixed fields for experiments).
