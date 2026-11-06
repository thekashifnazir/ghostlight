---
inclusion: always
---

# Accessibility rules

These are hard rules. They apply to every spec, every task, every piece of UI and output. When a design choice conflicts with one of these, the rule wins.

## Every functional line is text in a live region

- Every functional line goes to the player's own screen reader as text, through an ARIA live region. This is the default and it must be complete on its own.
- A line is functional if the player needs it to play: room description, what is here, exits, the game's reply, what an action changed, choices, errors, hints, recaps.
- Use a polite `role=log` region for the running narration. Do not rely on audio, colour, position or the canvas to carry any functional meaning.

## Nothing has meaning only on the canvas

- The game canvas is `aria-hidden`. Nothing a player must know may exist only as pixels.
- If the engine shows it on screen, the player hears it as text: objects, exits, inventory, dialogue, cutscenes, state changes.

## Keyboard only

- Everything is reachable and operable with the keyboard alone, including the start screen. No mouse is needed anywhere.
- Typed plain-English commands always work. List mode (arrow keys, Enter for an action menu) is an alternative, not the only way. Speech input is optional and feeds the same parser.
- Keep focus stable. Provide "repeat last" and "interrupt" on a key press.

## Pre-recorded voice is flavour, and interruptible

- Pre-recorded voice (the ghost, and any voiced dialogue or cutscenes) is a bonus layered on top of text that already works alone. It is on by default and easy to turn off.
- All speech and audio must be interruptible and stoppable on a key press or focus change. Never trap the player at the recording's speed.
- Never put functional information only in audio the player cannot speed up or interrupt.

## Credit ScummVM honestly

- Do not claim ScummVM's existing work as ours. ScummVM already has hover-name speech (since May 2025) and visual hotspot markers in some engines (since Jul 2026).
- Say plainly what we build on. Ghostlight's new work is the accessibility pack format and data, the "what changed" layer, graded progress-aware hints, sonar, and the full typed/keyboard web player with the player's own screen reader.

## The ghost is authored help

- The ghost gives authored, spoiler-graded hints in three tiers, keyed on real progress. It never reveals a puzzle the player has not reached, and it is not an AI playing the game for the player.
