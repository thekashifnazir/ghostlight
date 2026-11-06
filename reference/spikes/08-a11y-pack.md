# Spike 08: an accessibility pack format, with Drascula as test data (throwaway)

**Result, 6 Nov 2026.** A versioned JSON format for per-game accessibility data ([FORMAT.md](FORMAT.md), [schema.json](schema.json)), and a pack that fills it for Drascula chapters 1 and 2 ([drascula-en.json](drascula-en.json)). Both pass a schema check and a coverage check against spike 05's census. Every room description was written from the room's actual background picture, decoded from the game data.

This is the "metadata format and test data for a game" that ScummVM's developer asked for in April 2021 before blind access could go further (lists.scummvm.org/pipermail/scummvm-tracker/2021-April/028790.html).

## Run it

```bash
# decode backgrounds and cutscene frames to look at (outputs in out/, gitignored)
python3 -I spikes/08-a11y-pack/tools/alg2png.py spikes/05-game-census/out/packet spikes/08-a11y-pack/out 62 63 1 2 3 4 5 6 7 8 9 10 12 14 15 16 17 18 19 --scale 3
python3 -I spikes/08-a11y-pack/tools/bin2png.py spikes/05-game-census/out/packet spikes/08-a11y-pack/out/anim AG.BIN LEV.BIN GAF.BIN BJB.BIN BES.BIN RAP.BIN --frames 3

# check the pack
python3 spikes/08-a11y-pack/tools/validate.py spikes/08-a11y-pack/drascula-en.json          # schema (jsonschema) + cross-references
python3 -I spikes/08-a11y-pack/tools/check_coverage.py spikes/05-game-census/census.json spikes/08-a11y-pack/drascula-en.json
```

`validate.py` uses `jsonschema` when it's importable (it is in the user site-packages here, so run it without `-I`); under `-I` it says the schema step was skipped and still runs the stdlib cross-checks. `annotate_fn.py` is a reading aid: it prints an engine function with every `talk*(N)` resolved to its English line.

## The format in brief

One file per game and language, keyed by ScummVM engine id, game id and language. Sections:

- `rooms.<n>`: `name`, `short` (1–2 sentences, list mode), `long` (describe the room), `seen` (written from the picture or not), `exits.<hotspot>` (`label`, `to`, `direction`, optional `opensWhen`), `objects.<hotspot>` (`name`, `type` object/exit/npc, optional `description`).
- `items[]`: `id`, `chapters` (ids are reused per chapter), `name`, `description`.
- `textFixes[]`: raw engine string to replacement, by context (hotspot / dialogue), optional rooms.
- `cutscenes.<id>`: audio description, trigger, `hasDialogue`, `seen`.
- `milestones[]`: `when` condition on (chapter, room, flags, inventory, other milestones), `after` dependencies, a past-tense `recap`, and three hint tiers (nudge, clue, answer). `end: true` marks the step that finishes a chapter.

`type` maps one to one onto `Graphics::HotspotType` from ScummVM's hotspot API (PR #7135, merged 13 July 2026): `object` = `kHotspotObject`, `exit` = `kHotspotExit`, `npc` = `kHotspotNPC`. The closest thing already in ScummVM is macs2's hard-coded `(scene, hotspot) → type, name` C++ table (`engines/macs2/hotspot_names.cpp`); the pack is that table as data, plus descriptions, items, cutscenes and hints.

## Decisions

- **Key on the engine's own hotspot number, per room.** `HotspotInfo` has a position, a name and a type but no id, so there's nothing stable to key on in the generic API. Drascula's object numbers are stable in the data but not unique across rooms (103 is the blackboard in room 62 and the vending machine in room 63).
- **No positions in the pack.** They're live engine data. The pack only has words.
- **One entry per hotspot number.** Room 18 has four garlic hotspots under one number; list mode should say "garlic" once.
- **Exits and objects are separate maps,** but an object can still be `type: "exit"` for something that looks like a way out but isn't an engine door (room 62's stairs, which chapter 1 switches off).
- **`to: null` with a note** where walking through runs a cutscene or ends a chapter instead of going to the room in the data (room 62's curtained doorway, room 19's well).
- **Conditions are a small AND-by-default object** with `all`/`any`/`not`, checked by JSON Schema. Flag conditions only mean something within one chapter because Drascula resets and reuses all 50 flags per chapter, so a milestone is evaluated only in its own chapter and counts as reached in any later one.
- **Hints hang off milestones,** not rooms. The next hint is the first unreached milestone whose `after` are all reached, preferring one whose `rooms` include where you are.
- **Hint text is our own,** written from the engine code (`rooms.cpp`, `animation.cpp`, `converse.cpp`, talk sequences in `staticdata.h`), not from any walkthrough.

## Coverage (from `check_coverage.py`, 6 Nov 2026)

| What | Covered |
|---|---|
| Rooms, chapters 1–2 | **19 / 19** |
| Hotspots (unique per room) | **103 / 103** (40 doors, 63 other) |
| (chapter, item id) pairs | **18 / 18** (17 distinct ids) |
| Cutscenes (`animation_*`) | **25 / 25** |
| Door gates (`doors[]` table) with a matching `opensWhen` | **7 / 7** |
| Milestones | 25 (3 in chapter 1, 22 in chapter 2), each with 3 hint tiers and a recap |
| Text fixes | 23 (13 Spanish, 4 spelling, 4 clarity, 2 dialogue typos); 21 game-wide hotspot names, some for later chapters |
| Flags the milestones read | ch1: 1 of 5 touched; ch2: 19 of 41. The rest are animation, door and talk-state flags |

Negative test: a copy with six planted faults (missing hotspot, em dash, unknown `after`, duplicate item, unknown field, missing gate) failed both tools with all six reported.

## Seen versus unseen

- **Rooms: 19 / 19 seen.** `.ALG` backgrounds are a 128-byte header, PCX-style RLE (byte ≥ 0xC0 is a run of `b & 0x3F`) and a 768-byte palette (`graphics.cpp loadPic()`, `decodeRLE()`). All 19 decoded first time. Only 16 distinct pictures: rooms 62 and 14 (the bar), 63 and 15 (back room), and 1 and 5 (church front) share files. Room 5 uses a smaller hero sprite and a walk strip behind the fence, so its text says so. Characters standing in rooms (the blind man, Von Braun) are sprites, not in the backgrounds.
- **Cutscenes: 9 / 25 seen.** `.BIN` animations are a frame count then RLE frames, later frames XORed onto the previous screen, palette 6-bit (`animate()`, `showFrame()`, `mixVideo()`). Keyframes of the six chapter 1 ending animations show the hero waking up with B.J. in the bedroom and a caped figure carrying her off. Chapter 2 scenes are sprite sheets (`an*.alg`), which show the window climb, the sickle swing, the speaker cage, the shove on the cigarette machine and the jump into the well. The other 16 are written from code and dialogue and marked `seen: false`, kept short so they don't invent visuals.

## Found along the way

- **Spike 05 over-counts silent cutscenes.** It counted `talk*()` calls only. `animation_3_1`, `_11_2` and `_13_2` play dialogue through talk sequences. In chapters 1–2 that's 6 silent scenes, not 9.
- **Engine destinations aren't always where you end up.** Room 62's door 105 says room 63 but ends chapter 1; door 104 is a door in the data but chapter 1 disables it (`isDoor[7] = 0`); the well says room 20 but goes there via a cutscene and a chapter change.
- **Room 3's LAPIDA hotspot has a 0,0,0,0 rectangle,** so it can never be hovered or clicked. Kept, with a note.
- **Flag 33 has two meanings.** Talking to the blind man twice sets it (`animation_4_2`), and so does learning Von Braun's recipe. The recipe milestone also checks flag 22 so the blind man doesn't trigger it.
- **Flag 38 is cleared after the brew is made** (talk sequence 31), so "all ingredients" uses `any` with flag 36. Runtimes should latch milestones.
- **The crucifix is optional in chapter 2:** chapter 3 starts you with it anyway.
- Spike 07's web player already reads these field names (`player.js` lines 49–67), so this file should drop in. Not run together yet.

## Open questions for an upstream ScummVM proposal

1. **A stable hotspot id in `HotspotInfo`.** Add an engine-native `id` (and the current room or scene id) so packs and screen readers can key on something. Without it a pack has to be engine-specific about how it finds hotspots.
2. **A generic way to expose progress state.** Milestones read engine variables (Drascula's 50 flags and inventory). Is that an `Engine` virtual (`getAccessibilityState()` returning named integer vars and an inventory list), or does each engine evaluate pack conditions itself?
3. **Cutscene ids.** Drascula's are C++ function names, which aren't stable if the engine is refactored. Key on the resource name (`RAP.BIN`) or a per-engine table of string ids?
4. **Where packs live.** In-tree next to engine data (`dists/` or `devtools/create_*`), or as a downloadable add-on like icons and shaders? Who reviews text?
5. **One file or two per language.** Hotspot numbers, exits, flags and milestones are language-neutral; only the words change. Split structure from text (gettext-style) so a translator only touches strings?
6. **Licence for the text.** Original writing about a freeware game. CC BY 4.0 for packs, GPL for the schema and tools? Undecided; the file says "undecided draft".
7. **Are hints in scope for ScummVM?** PR #7135 itself opened by asking whether visual hotspot markers change how games are played. Graded hints may be more contentious; they could be an optional section or a separate file.
8. **Overlap with existing fixes.** ScummVM engines already patch some strings in code; should `textFixes` replace that, sit alongside it, or stay accessibility-only?
9. **Room numbers that mean different places per chapter.** Not needed for Drascula, likely needed elsewhere. A `variants` list keyed by chapter or a condition?

## Not done

- Not loaded by any engine build. The format is checked by tools only, and spike 07 has only seen a fixture of it.
- Chapters 3 to 6 (38 more rooms, about 22 more item meanings, 18 more cutscenes).
- 16 cutscene descriptions written without seeing the frames; the sprite sheets for most are in the packet (`an*.alg`) and decode with `alg2png.py`.
- Nobody blind has heard any of this text yet.
- Descriptions and hints are a first draft for review, written by AI under direction.
