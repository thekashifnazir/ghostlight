# Requirements: screen-reader-focus (Bugfix)

## Introduction

This is a bugfix spec. Spike 10 (`reference/spikes/10-nvda-vm.md`) drove the live site with NVDA in a Windows VM and JAWS behaviour was reasoned from the same cause. It found that on Windows the player is unplayable out of the box: after Start, keyboard focus sits on `<body>`, so NVDA (and JAWS) stay in **browse mode** and intercept every game key — Right moved NVDA's review cursor, Down read the next line of the page, `L` ran NVDA's "next list" quick-nav. The game received nothing. Only after the user manually pressed NVDA+Space (focus mode) did every key work. Our Mac VoiceOver testing missed this because VoiceOver does not intercept keys the same way.

Four smaller defects rode along: Chrome pops a "Control and reprogram MIDI devices" permission prompt at boot (ScummVM's Web MIDI probe); the tab title changes from "Ghostlight …" to the game's own DOS title once ScummVM boots; menus speak every item twice (the live region announces the item, then the focused menu button is read again by the screen reader); and Escape from a menu drops focus back to the document.

The fix makes the page put a screen reader into focus mode on its own and keep it there, removes the surprise MIDI prompt, keeps the "Ghostlight" tab title, and stops the double-speak in menus. Scope is the web player only: `src/main.ts`, `src/index.html` and `src/ui/`. No engine change, no deploy. Claude Code re-runs the NVDA VM check afterwards.

This spec coordinates with the `save-progress` spec, whose task 7 is the only other work that edits `src/main.ts` and `src/ui/controller.ts`. This spec finishes first, or `save-progress` rebases onto it.

Requirements use EARS (Easy Approach to Requirements Syntax). Terms:

- **game element**: the single focusable element the page keeps keyboard focus on while playing, carrying `role="application"` and an `aria-label` of "Ghostlight game". `role="application"` tells NVDA and JAWS to switch to focus mode on their own, so the browser's virtual cursor stops eating game keys.
- **focus mode / browse mode**: NVDA and JAWS run in browse mode by default (arrows navigate the page; many single letters are quick-nav commands). On an element with `role="application"` they switch to focus mode, passing keystrokes straight to the page. JAWS's manual toggle is Insert+Z; NVDA's is NVDA+Space.
- **live region**: the single polite `role=log` region every functional line is written to as text (see `src/ui/live-region.ts`).
- **menu**: the verb menu (`src/ui/verb-menu.ts`) or the inventory list (`src/ui/inventory.ts`), each a `role=menu` with roving focus on `role=menuitem` buttons.
- **transient overlay**: a menu, the command box, or the start gate — any UI that temporarily takes focus and then closes.

## Requirements

### Requirement 1: Put the screen reader into focus mode on Start

**User story:** As a blind player on Windows using NVDA or JAWS, I want the game to take focus mode by itself when I start, so that my arrow keys and letter keys reach the game instead of being eaten by the screen reader's browse mode.

#### Acceptance criteria

1. THE page SHALL provide a single game element that is keyboard-focusable, carries `role="application"`, and has an `aria-label` of "Ghostlight game".
2. WHEN the player starts the game (the start gate is dismissed) THEN the page SHALL move keyboard focus to the game element.
3. WHEN keyboard focus is on the game element THEN the page SHALL continue to route game keys through the existing single key-handling path, so no game key behaves differently than before this fix.
4. THE game element SHALL NOT expose the game canvas or any engine-drawn text to assistive technology; the canvas stays `aria-hidden` and the game element carries no readable content of its own beyond its label.
5. WHEN the page sets focus on the game element it SHALL NOT scroll, re-announce, or otherwise disturb the live-region line being read.

### Requirement 2: Keep focus on the game element after a transient overlay closes

**User story:** As a blind player, I want focus to return to the game after I close a menu, the command box, or dismiss onboarding, so that my screen reader stays in focus mode and the next key still reaches the game.

#### Acceptance criteria

1. WHEN a menu closes (chosen or cancelled) THEN the page SHALL return keyboard focus to the game element.
2. WHEN the command box closes (sent or Escape) THEN the page SHALL return keyboard focus to the game element.
3. WHEN the start gate is dismissed THEN the page SHALL move focus to the game element rather than leaving it on the dismissed start control or dropping it to the document.
4. WHEN Escape is pressed to leave a transient overlay THEN focus SHALL land on the game element and NOT on the document body.
5. WHILE no transient overlay is open, the page SHALL keep keyboard focus on the game element.
6. WHEN focus returns to the game element after an overlay closes it SHALL NOT emit an extra live-region line; the last spoken line stays the overlay's own result (screen-reader-output: one key press, one update).

### Requirement 3: Tell the player how to force focus mode manually

**User story:** As a blind player whose screen reader did not switch automatically, I want a one-line reminder of the manual shortcut, so that I can recover without guessing.

#### Acceptance criteria

1. THE onboarding line spoken on the first room SHALL include one short instruction naming the manual focus-mode shortcut for NVDA and JAWS, worded so it is skippable noise to players who do not need it.
2. THE F1 help text SHALL include the same manual focus-mode instruction.
3. THE instruction SHALL name NVDA+Space and JAWS Insert+Z.

### Requirement 4: No surprise MIDI permission prompt at boot

**User story:** As a blind player, I do not want Chrome to ask about controlling MIDI devices when the game boots, because an unexpected permission dialog is confusing and off-putting with a screen reader.

#### Acceptance criteria

1. WHEN the engine boots THEN the browser SHALL NOT present a "Control and reprogram MIDI devices" permission request as a result of the engine's Web MIDI probe.
2. THE page SHALL prevent the probe without removing any functional audio the player relies on; sonar, earcons and the ghost voice play through the page's own Web Audio graph and SHALL be unaffected.
3. THE chosen mechanism SHALL be documented in the code with a one-line reason for the choice between a build flag and hiding `navigator.requestMIDIAccess`.

### Requirement 5: Keep the "Ghostlight" tab title

**User story:** As a blind player, I want the browser tab to keep saying "Ghostlight" so that when the window gets focus my screen reader announces the right thing, not the game's DOS title.

#### Acceptance criteria

1. WHEN ScummVM changes the document title to the game's own title THEN the page SHALL set the title back to "Ghostlight: Drascula".
2. THE restored title SHALL survive the engine's title change at boot (the page sets it after, or re-asserts it so the engine's change does not win).
3. THE page SHALL NOT depend on polling a timer indefinitely; it SHALL restore the title through a bounded, deterministic mechanism.

### Requirement 6: Menus speak once, not twice

**User story:** As a blind player, I want a menu item announced once when I land on it, not once by the live region and again by my screen reader reading the focused button, so that the readout is not doubled.

#### Acceptance criteria

1. WHEN a menu opens THEN the live-region line SHALL give the menu name and the item count only, and SHALL NOT include the focused item's name (the focused `role=menuitem` button carries the item name, which the screen reader reads).
2. WHEN focus moves to a different item within an open menu THEN the page SHALL NOT write the item's name to the live region; the focused button's own text is what the screen reader reads.
3. THE menu item buttons SHALL carry their item name as their accessible name, so focus-mode screen readers read it exactly once on focus.
4. WHERE a menu action produces a functional result (an item made active, a verb chosen, a cancel), that result SHALL still be announced in the live region as a complete line (this is not an item-focus announcement and is unaffected by 6.1 and 6.2).
5. THE inventory empty case ("Your inventory is empty.") and the count-bearing open line SHALL remain functional lines in the live region.

### Requirement 7: Regression coverage proves the fix

**User story:** As a maintainer, I want automated checks that would fail if any of these regressions came back, so that the fix stays fixed.

#### Acceptance criteria

1. A Playwright check SHALL assert that after Start the document's active element has `role="application"`.
2. A Playwright check SHALL assert that after opening a transient overlay with Tab and closing it with Escape, the active element is the game element again.
3. A Playwright check SHALL assert that no MIDI permission request is made while the page loads and boots.
4. A unit check SHALL assert that a menu's open and item-focus live-region lines carry the menu name and count but not the focused item's name, while an action result line is still announced.
5. THE existing player, hints, sonar and axe Playwright suites and the vitest unit/property suites SHALL continue to pass unchanged.
