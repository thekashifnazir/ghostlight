# Product

## What Ghostlight is

Ghostlight makes the 1996 point-and-click adventure *Drascula: The Vampire Strikes Back* playable by blind and low-vision people. The real game runs in ScummVM. Room contents, exits, inventory and progress come straight from the game engine. The player types or speaks what to do, their own screen reader reads back what happened, and a ghost character gives hints that know where they are stuck.

It is a Kiroween 2026 entry in the Resurrection category ("bring your favourite dead technology back to life"). The deadline is Friday 4 December 2026, 14:00 PT. Plan to the earlier Wednesday 2 December date to be safe.

"Ghostlight" is a placeholder name (a ghost light is the lamp left burning on an empty stage). The final name is Kash's call.

## Why this project

- Classic adventures lock out blind players: you have to see the screen and hunt for pixels with a mouse.
- No 2025 hackathon entry touched game accessibility or ScummVM.
- In 2021 a ScummVM developer closed a blind-access request saying hotspots are not exposed and someone first needs "a metadata format and test data for a game". Ghostlight's accessibility pack format is that, with Drascula as the first test data.

## Who it is for

- **Primary:** blind players who use a screen reader (NVDA, JAWS, VoiceOver), want to play the same classics sighted friends grew up with, and do not want them dumbed down.
- **Secondary:** low-vision players (object list instead of pixel hunting), motor-impaired players (no precise mouse), and anyone stuck on a hard 1990s puzzle.
- **Not for:** sighted speedrunners, or players wanting an AI to play the game for them.

## The one loop

1. **Arrive:** hear where you are, what is here, and where you can go.
2. **Act:** type or say plain English ("use the coins on the machine", "go through the back door").
3. **Hear what changed:** the game's own reply plus a line saying what changed ("You picked up the cigarettes.").
4. **Stuck?** Ask the ghost. Get a nudge, then a clue, then the answer, graded to actual progress.

## Goals

1. A blind player can play Drascula chapters 1 and 2 start to finish in a web browser with their own screen reader, no mouse, no sighted help.
2. Every room tells you where you are, what is here and where you can go. Every action tells you what changed.
3. Hints from the ghost come in three tiers (nudge, clue, answer), keyed on the player's actual progress.
4. The accessibility data lives in a documented, reusable pack format, with Drascula as the first pack.
5. A wide range of Kiro features is used, each for a reason, and the write-up shows it.
6. A judge can open a link and play, and a 2:30 to 3:00 video with voiceover shows it end to end.

## Non-goals

- Chapters 3 to 6 fully playable (stretch only; the format must allow them).
- A second game (stretch only).
- A live conversational voice agent as the main way to play (optional demo extra at most).
- Mobile apps, accounts, multiplayer, cloud saves.
- Changing the game's puzzles or story.

## Anti-goals (fail even if it technically works)

- Functional information only in a pre-recorded voice the player cannot speed up or interrupt.
- Anything that only works if you can see the canvas.
- An AI that plays the game for you, or hints that spoil puzzles the player has not reached.
- A feature list so long the value is not clear in 10 seconds.
- Claiming ScummVM's existing work as ours (hover-name speech, visual hotspot markers). Say plainly what we build on.
- Publishing any key in the repo.

## Scope for the demo

Chapters 1 and 2. Stretch goals, in order: chapters 3 to 6 in the pack; voiced cutscene descriptions; fully voiced English dialogue; a second ScummVM game; a generic fallback for games with no adapter; one-switch scanning input.
