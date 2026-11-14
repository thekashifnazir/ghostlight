---
name: "pack-writing"
description: "Write and review the text in a ScummVM accessibility pack: room names and descriptions, exit labels, spoken object and item names, text fixes, cutscene descriptions, recaps, and graded hints. Use when authoring or reviewing any line of text a player will hear."
license: "GPL-3.0-or-later"
compatibility: "Writing or reviewing accessibility-pack text (packs/<gameId>-<lang>.json). Pairs with the scummvm-access pack schema and validator."
metadata:
  author: "Ghostlight"
  version: "1.0.0"
---

# Pack writing

## Overview

Rules for all text in accessibility packs: room names and descriptions, exit labels, spoken object names, item names, text fixes, cutscene descriptions, recaps, and hints. The engine supplies live state (which room you are in, hotspot numbers and positions, inventory ids, progress flags); the pack supplies the words. This skill governs the prose, not the structure. For the field-by-field format see the pack schema and `FORMAT.md` bundled with this power.

Load this skill before authoring or reviewing any line a player will hear. For a pure validation run, just run the validator; for adapting a new engine, use the `engine-gotchas` skill instead.

## Prerequisites Checklist

- [ ] You are writing or reviewing the text content of a pack, not its structure
- [ ] You know the pack's language and region (for example `-en` is British English)
- [ ] You have the room's or scene's actual picture when you intend to set `seen: true`

## Voice and style

- Plain, short sentences. British English for `-en` packs.
- No em dashes. Use a full stop, a comma, or a semicolon instead.
- Concrete over atmospheric: "the door is on the left" beats "a foreboding portal".
- Lower case for item names unless a proper noun, because they are spoken mid-sentence ("You picked up the handbag").

## Position

- Say where things are relative to the screen: left, middle, right, foreground, back wall.
- In a long room description, go left to right so the player builds a stable mental map.

## No spoilers in descriptions

- Room and object descriptions name what is there. They never solve puzzles.
- A description does not say what is hidden, what an item is used with, or what to do next. That belongs only in hints, graded by tier.
- Translate any foreign text visible in the picture (for example leftover Spanish hotspot names) via `textFixes`.

## Hints: three tiers, our own words

- Every milestone has all three tiers, always.
  - **nudge:** points at the area of the problem without naming the object or the action.
  - **clue:** names the place and the thing, but not the exact action.
  - **answer:** the exact action in game terms, using only verbs the player has (look, take, open, close, talk, push, use).
- Hints are written fresh for the pack in our own words. Never copy published walkthroughs.
- A hint is keyed on real progress and is only offered when its prerequisites are reached and the milestone is not yet done. Never hint at a puzzle the player has not reached.

## Recaps

- `recap` is past tense, second person: "You found B.J.'s handbag in a trunk upstairs." Used for "previously" and "what have I done?".

## Accuracy

- Set `seen: true` only when the text was written from the room's or scene's actual picture, `false` when from object names and game text only.
- Every hotspot the engine can report for a covered room needs an entry in `exits` or `objects`. The coverage checker enforces this against the census.

## Troubleshooting

### A hotspot name reads as Spanish or is wrong in the engine data
The engine reports names as-is. Do not edit the engine. Add a label override through the pack's `textFixes` so the player hears the corrected word.

### The coverage checker reports a hotspot with no pack entry
Every hotspot the engine can report for a covered room must appear in `exits` or `objects`. Add the missing entry rather than narrowing coverage.
