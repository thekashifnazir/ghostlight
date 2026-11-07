# Pack writing

Rules for all text in accessibility packs (room names and descriptions, exit labels, spoken object names, item names, text fixes, cutscene descriptions, recaps and hints). The engine supplies live state; the pack supplies words.

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
