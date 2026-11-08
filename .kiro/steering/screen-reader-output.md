---
inclusion: auto
name: screen-reader-output
description: "Use when changing anything the player hears: live-region text, keys, hints, onboarding."
---

# Screen reader output

Hard rules for anything the player hears. These sit on top of accessibility.md
and apply to the web player's output layer: the live region, the keys, the
hints, and onboarding. When a design choice conflicts with a rule here, the
rule wins.

## One key press, one live-region update

- A single key press produces exactly one coherent live-region update, not a
  burst of separate announcements the screen reader queues up and reads in a
  row. Compose the line first, then announce once.
- "Repeat last" replays that one line verbatim. If an action has nothing to
  say, say nothing rather than emitting an empty update.

## Never leak hover labels or engine debug text

- The engine's hover-name speech and visual hotspot markers are ScummVM's own,
  not ours, and must never reach the player's live region. The canvas is
  `aria-hidden`; the decorative highlight marker lives in an aria-hidden element
  and is never read.
- Raw engine diagnostics (`A11Y`, `A11Y_DIFF`, `A11Y_TEXT`, any `printErr`
  line) are internal context, not player output. Only authored, functional text
  goes to the live region.

## Every sound has a text line

- Every sound cue, earcon and sonar sweep is paired with a functional text line
  in the live region. Nothing a player must know may exist only as audio.
- Sonar ends with one summary line to the polite region. Pre-recorded voice
  (the ghost) is flavour layered on text that already works alone, and is
  interruptible on a key press.

## New keys are checked and documented

- Every new key binding is checked against `src/ui/controller.ts` so it does not
  collide with an existing binding or a reserved key, and is handled through the
  same single-update path as the rest.
- Every new key is added to the F1 help text (`HELP_TEXT` in `src/main.ts`), and
  to the short onboarding line only if it belongs to the core loop.
