# Design: screen-reader-focus (Bugfix)

## Root cause

On Windows, NVDA and JAWS start every web page in **browse mode**: the screen reader owns a virtual cursor, arrow keys move that cursor, and many single letters are quick-nav commands (`L` = next list, `H` = next heading, and so on). Keys in browse mode never reach the page's `keydown` handler. The player's whole control scheme — arrows to cycle hotspots, `L` to read the room, `H` for a hint — is therefore swallowed before `Controller.handleKey` ever runs.

Spike 10 confirmed this directly: after Start, `document.activeElement` was `<body>`, and only after a manual NVDA+Space (the browse/focus toggle) did every key work. VoiceOver on macOS does not gate keystrokes this way, which is why Mac testing never saw it.

The fix is the standard one for a keyboard-driven web app that is not a document: give the play surface `role="application"` and keep real DOM focus on it. NVDA and JAWS switch to **focus mode** automatically when focus enters an `application` element, and in focus mode they pass keystrokes straight through. Keeping focus there — through menu open/close, the command box, onboarding and Escape — keeps the screen reader in focus mode for the whole session.

The other four defects are independent and small; each is fixed at its own site.

## Scope and coordination

Files this spec touches: `src/index.html`, `src/main.ts`, `src/ui/verb-menu.ts`, `src/ui/inventory.ts`, and new test files under `test/`. It does **not** touch `engine/`, does not deploy, and does not add a new runtime dependency.

`Controller.handleKey` is read but not changed: keys already flow through one path (the document-level capturing `keydown` listener in `main.ts`), and that path is unaffected by where focus sits as long as the element is inside the document. The only `src/ui/controller.ts` edits in flight belong to `save-progress` task 7; this spec leaves `controller.ts` alone, so the two specs do not collide. This spec finishes first; if not, `save-progress` rebases onto it.

## The game element (R1, R2)

### Markup

A new focusable element wraps the stage region in `src/index.html`:

```html
<div id="game" role="application" aria-label="Ghostlight game" tabindex="-1">
  … existing #stage, canvas, highlight, menus, command box …
</div>
```

- `tabindex="-1"` makes it programmatically focusable without adding it to the Tab order (the player never needs to Tab to it; the page focuses it directly).
- `role="application"` is the switch that moves NVDA and JAWS into focus mode. The canvas inside stays `aria-hidden`, and the element has no readable content of its own beyond its label, so the screen reader announces only "Ghostlight game, application" when focus enters, then falls silent until the live region speaks (R1.4).
- The live region and transcript stay **outside** `#game`. The live region must remain a polite `role=log` the screen reader observes; it is not part of the application surface and must not inherit `role=application`.

### Focusing it

`main.ts` resolves `#game` once in `boot()` and exposes a single helper:

```ts
const gameEl = doc.getElementById("game") as HTMLElement;
const focusGame = (): void => {
  // preventScroll so focusing never scrolls the page or disturbs a line being
  // read (R1.5). No live-region write here — focus is silent (R2.6).
  gameEl.focus({ preventScroll: true });
};
```

`focusGame()` is called:

- in `startPlaying()`, right after `startGate.hidden = true`, replacing the current `startButton.focus()` path (R1.2, R2.3);
- from the menus' and command box's `returnToList` callback, so every overlay close lands focus back on the game element (R2.1, R2.2, R2.4).

`returnToList` already exists in `main.ts` and is passed to the verb menu, inventory and command box. Today it is a deliberate no-op (the list stays the active mode and re-announcing would clobber the result line). We extend it to call `focusGame()` and nothing else, so focus returns without a second announcement (R2.6):

```ts
const returnToList = (): void => {
  // Keep the screen reader in focus mode: focus the application element after
  // any overlay closes. Silent — the overlay's own result is the last line.
  focusGame();
};
```

Because `focusGame()` writes no live-region line, R2.6 holds: the last spoken line stays the menu's "Cancelled" / the engine's result.

### Why focus does not need to move per-key

While a menu is open, roving focus sits on a `role=menuitem` button **inside** `#game`; focus is still within the application subtree, so NVDA/JAWS stay in focus mode and the menu's own arrow handling works. When the menu closes we move focus back up to `#game`. Between actions, focus rests on `#game` (R2.5). The document-level capturing `keydown` listener catches keys regardless of which descendant holds focus, so no per-key focus juggling is needed.

### Why not focus the canvas

The canvas is `aria-hidden` and SDL gives it `id="canvas"`; focusing it could invite the engine's own key handling and would give the screen reader nothing to announce. A dedicated wrapper with a real label is cleaner and keeps the canvas purely decorative.

## Manual focus-mode reminder (R3)

Two one-line additions, no logic:

- `ONBOARDING_TEXT` in `main.ts` gains a trailing clause. It must stay short (it is spoken on the first room, appended to the room reading). New wording, for review:
  > "If keys don't work, press NVDA+Space, or JAWS Insert+Z."
- `HELP_TEXT` gains the same sentence near the end, before the build line.

Both name NVDA+Space and JAWS Insert+Z (R3.3). The clause is phrased as a conditional ("if keys don't work") so players whose reader already switched can ignore it (R3.1).

## MIDI probe suppression (R4)

**Decision: hide `navigator.requestMIDIAccess` before the module loads, in `main.ts`.** Reasons, recorded in the code:

- It is a page-only change in the files this spec already owns, needs no wasm rebuild, and is immediately testable with the replay page and in Playwright. A `build-web.sh` MIDI-off flag would require rebuilding and redeploying the 10 MB wasm, which this spec explicitly does not do, and would be unverifiable until the next deploy.
- ScummVM's MPU-401/Web MIDI backend only probes when `navigator.requestMIDIAccess` exists. Replacing it with a function that rejects (or deleting it) makes the probe a no-op, so Chrome never raises the permission UI (R4.1). The game's music already plays through the SDL audio backend at the launch `--music-volume`, independent of Web MIDI, and our own cues use Web Audio — so nothing functional is lost (R4.2).

Implementation, run in `boot()` before `window.Module` is wired and before the adapter can load `scummvm.js`:

```ts
// Stop ScummVM's Web MIDI probe so Chrome never pops a "Control and reprogram
// MIDI devices" permission prompt at boot (spike 10). We hide the API on the
// page rather than rebuilding the wasm with a MIDI-off flag: this is a page-
// only, deploy-free fix in the files this spec owns, and the game's music
// still plays through SDL audio while our cues use Web Audio, so no functional
// audio is lost. Reversible — a later build flag could replace it.
try {
  const nav = navigator as Navigator & { requestMIDIAccess?: unknown };
  if (typeof nav.requestMIDIAccess === "function") {
    Object.defineProperty(nav, "requestMIDIAccess", {
      configurable: true,
      value: () => Promise.reject(new Error("Web MIDI disabled by Ghostlight")),
    });
  }
} catch {
  /* navigator frozen or API absent: nothing to suppress. */
}
```

It must run before `adapter.start()` (which loads `scummvm.js`); `boot()` runs it at the very top, so the engine never sees the real API. Returning a rejecting promise (rather than deleting the property) keeps the engine's feature-detection happy if it `typeof`-checks and then calls — it simply fails to get a port, with no UI.

## Keep the tab title (R5)

ScummVM sets `document.title` to the game's DOS title once the engine boots. The page re-asserts its own title after boot:

```ts
const GHOSTLIGHT_TITLE = "Ghostlight: Drascula";

// Keep the tab saying "Ghostlight" after ScummVM overwrites document.title with
// the game's DOS title at boot (spike 10), so a screen reader announces the
// right thing when the window gets focus. A MutationObserver on <title> resets
// it whenever the engine changes it — deterministic and bounded (it reacts to
// the engine's own write), not a polling timer (R5.3).
function pinTitle(): void {
  document.title = GHOSTLIGHT_TITLE;
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  const obs = new MutationObserver(() => {
    if (document.title !== GHOSTLIGHT_TITLE) document.title = GHOSTLIGHT_TITLE;
  });
  obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
}
```

A `MutationObserver` is deterministic (it fires on the engine's own title mutation) and bounded (it does nothing until the title changes), satisfying R5.2 and R5.3 without an open-ended polling loop. `pinTitle()` is called in `startPlaying()` just before `adapter.start()`, so it is armed before the engine can change the title. The guard `document.title !== GHOSTLIGHT_TITLE` prevents an infinite observer loop (our own set does not re-trigger a correction).

The static `<title>` in `index.html` is also simplified to "Ghostlight: Drascula" so the pre-boot tab already matches (today it is the longer "Ghostlight — Drascula, by keyboard and screen reader"). The `<h1>` and start-gate copy are unchanged.

## Menus speak once (R6)

Today both menus announce the focused item to the live region **and** move roving DOM focus to a `role=menuitem` button whose text is the same item name. In focus mode the screen reader reads the newly focused button, so the item is spoken twice (live line, then button). The fix: the live region gives the **menu name and count only**; the focused button carries the item name and is read by the screen reader exactly once.

### Inventory (`src/ui/inventory.ts`)

- `openMenu()`: the live line becomes the menu name and count without the first item's name:
  > "Inventory, 3 items." (was "Inventory, 3 items. coins, 1 of 3.")
  The empty case ("Your inventory is empty.") is unchanged (R6.5).
- `next()` / `prev()`: drop the `announceCurrent()` live-region write. Roving focus already moves to the target button (`focusCurrent()`), whose text the screen reader reads. The private `announceCurrent()` and the public `announceCurrent()` used by the command box's cancel path are reviewed: the command box `runFixed("cancel")` calls `list.announceCurrent()` (the list, not the inventory), so inventory's `announceCurrent()` has no external caller once `next`/`prev` stop calling it, and is removed. The button text already encodes the "(active)" suffix, so the active item reads correctly on focus.
- `chooseCurrent()` result lines ("… is now active…", "Using X on Y.", "… is already active.") stay — they are action results, not focus announcements (R6.4).

The menu-name-and-count line should still convey position implicitly: with roving focus the screen reader reads "coins, 1 of 3" style position from the button if the button exposes it. To keep the "N of M" position a focus-mode user expects, each button's accessible name includes its position via `aria-setsize`/`aria-posinset` on the `role=menuitem`, which NVDA and JAWS announce as "N of M" natively — so we do not bake "N of M" into the visible text and do not write it to the live region. Buttons get `aria-setsize` = item count and `aria-posinset` = index+1.

### Verb menu (`src/ui/verb-menu.ts`)

- `openOn()`: the live line becomes the menu name only:
  > "Actions for trunk." (was "Actions for trunk. Open.")
  The first button (Open) is focused and read by the screen reader.
- `next()` / `prev()`: drop the `announce(VERBS[i].label)` live-region write; the focused button's label is read instead. Buttons get `aria-setsize` = 4 and `aria-posinset`.
- `cancel()` and `chooseCurrent()` results are unchanged action lines (R6.4).

### Why position moves to ARIA

Putting `aria-setsize`/`aria-posinset` on the roving buttons lets the screen reader say "1 of 3" itself, matching what browse-mode users and the list mode already hear, without a second live-region line. This keeps "one key press, one update" (screen-reader-output rule): the one update is the screen reader reading the focused button; the live region stays quiet on pure navigation within a menu.

## Testing (R7)

### Playwright — `test/screen-reader-focus.spec.ts` (replay suite)

These run in the existing replay-based suite (`test/*.spec.ts`, `playwright.config.ts`), because focus, MIDI and title are page behaviours that need no wasm build. A fixture (`tavern`) boots the page via `?replay=`.

- **R7.1 focus after Start:** after dismissing the start gate, assert `document.activeElement` resolves to `#game` and that element's `role` is `application`.
- **R7.2 Escape returns focus:** press Tab (opens inventory) — focus is on a menu button inside `#game`; press Escape — assert the active element is `#game` again.
- **R7.3 no MIDI prompt:** install a page init script that wraps `navigator.requestMIDIAccess` with a spy before any page script runs, load and boot, and assert the spy was never called (equivalently, assert the page's own suppression left a rejecting stub in place). A permission prompt can only arise from a real `requestMIDIAccess` call, so proving the call never reaches a live API proves no prompt.

### Vitest — extend `test/` menu unit tests

- **R7.4 menu speaks once:** construct a `VerbMenu` and an `Inventory` with a captured announce log and a jsdom element; assert the open line and navigation produce live-region lines with the menu name and count but **not** the focused item's name, while `chooseCurrent()` still logs its action result. Assert each menu button carries `aria-posinset`/`aria-setsize`.

### Full suites (R7.5)

Run the whole vitest suite and the replay Playwright suite; both stay green. The onboarding and F1 text assertions in `interaction.spec.ts` must be updated only if they assert the exact `ONBOARDING_TEXT`/`HELP_TEXT` string — they assert substrings, so the appended clause does not break them, but this is verified.

## What this design deliberately does not do

- It does not change `Controller.handleKey` or any key binding, so no screen-reader-output "new key" obligations arise (no new keys).
- It does not add ScummVM TTS or touch the engine.
- It does not deploy. Claude Code re-runs the NVDA VM check on the live site after the next deploy, which is a separate step owned elsewhere.
