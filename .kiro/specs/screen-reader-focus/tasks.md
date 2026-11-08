# Tasks: screen-reader-focus (Bugfix)

Decisions (locked): (1) a single `#game` wrapper with `role="application"`, `aria-label="Ghostlight game"`, `tabindex="-1"`, keeps DOM focus for the whole session; the live region and transcript stay outside it. (2) MIDI prompt is killed by **hiding `navigator.requestMIDIAccess`** in `main.ts` before the module loads (page-only, deploy-free, reversible — see design R4). (3) tab title is pinned to **"Ghostlight: Drascula"** with a `MutationObserver` on `<title>`. (4) menus go silent on navigation; the roving `role=menuitem` button carries the item name plus `aria-posinset`/`aria-setsize`, so the screen reader reads it once. Scope: `src/index.html`, `src/main.ts`, `src/ui/verb-menu.ts`, `src/ui/inventory.ts`, `test/`. No `engine/` change, no deploy. Coordinate with `save-progress` task 7 (the only other editor of `main.ts`/`controller.ts`): finish this first, or that task rebases onto it. This spec does not edit `controller.ts`.

- [x] 1. Add the `#game` application element in `src/index.html` (R1.1, R1.4)
  - Wrap the existing `#stage` (canvas, highlight, verb menu, inventory, command box) in `<div id="game" role="application" aria-label="Ghostlight game" tabindex="-1">`.
  - Keep `#live-region` and `#transcript` OUTSIDE `#game` (the live region must stay a polite `role=log` the reader observes, not part of the application surface).
  - Simplify the static `<title>` to `Ghostlight: Drascula` so the pre-boot tab already matches the pinned title. Leave the `<h1>` and start-gate copy unchanged.
  - _Requirements: 1.1, 1.4, 5.1_

- [x] 2. Focus the game element on Start and after every overlay closes (R1.2, R1.5, R2)
  - In `src/main.ts` `boot()`, resolve `#game` once and add `focusGame()` using `gameEl.focus({ preventScroll: true })` — silent, no live-region write (R1.5, R2.6).
  - In `startPlaying()`, call `focusGame()` right after `startGate.hidden = true`, replacing the `startButton.focus()`-as-final-focus path (R1.2, R2.3).
  - Change the shared `returnToList` from a no-op to call only `focusGame()`, so the verb menu, inventory and command box all return focus to `#game` on close (R2.1, R2.2, R2.4). Add nothing that announces a line.
  - Confirm keys still route through the document-level capturing `keydown` listener regardless of which descendant holds focus (read-only check; no handler change) (R1.3, R2.5).
  - _Requirements: 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. Hide `navigator.requestMIDIAccess` before the module loads (R4)
  - At the top of `boot()` in `src/main.ts`, before `window.Module` is wired and before any adapter can load `scummvm.js`, replace `navigator.requestMIDIAccess` with a rejecting stub guarded by a try/catch, with the one-line reason comment from the design (build-flag vs page-hide choice) (R4.3).
  - Verify the music path is untouched: it plays through SDL audio at the launch `--music-volume`, and sonar/earcons/ghost use Web Audio — so no functional audio is removed (R4.2).
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 4. Pin the tab title to "Ghostlight: Drascula" (R5)
  - Add `GHOSTLIGHT_TITLE` and a `pinTitle()` in `src/main.ts` that sets the title and installs a `MutationObserver` on `<title>` resetting it whenever the engine changes it, guarded by `document.title !== GHOSTLIGHT_TITLE` to avoid an observer loop (R5.2, R5.3).
  - Call `pinTitle()` in `startPlaying()` just before `adapter.start()`, so it is armed before the engine boots and overwrites the title (R5.1).
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 5. Add the manual focus-mode reminder to onboarding and F1 (R3)
  - Append one short conditional clause naming NVDA+Space and JAWS Insert+Z to `ONBOARDING_TEXT` and to `HELP_TEXT` (before the build line) in `src/main.ts` (R3.1, R3.2, R3.3).
  - Keep the onboarding line short; it is spoken on the first room appended to the room reading.
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 6. Make the inventory menu speak once (R6)
  - In `src/ui/inventory.ts`: `openMenu()` live line becomes the menu name and count only (drop the first item's name); keep the empty-inventory line (R6.1, R6.5).
  - `next()`/`prev()`: drop the `announceCurrent()` live-region write; roving focus already moves to the button the reader reads (R6.2).
  - In `render()`/`focusCurrent()`: set `aria-setsize` (item count) and `aria-posinset` (index+1) on each `role=menuitem` button so the reader announces "N of M" itself; keep the "(active)" suffix in the button text (R6.3).
  - Remove the now-unused private `announceCurrent()`; confirm the command box's `runFixed("cancel")` calls `list.announceCurrent()` (the list, not the inventory), so nothing external depends on inventory's `announceCurrent()`.
  - Keep `chooseCurrent()` result lines ("… is now active…", "Using X on Y.", "… is already active.") as action announcements (R6.4).
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 7. Make the verb menu speak once (R6)
  - In `src/ui/verb-menu.ts`: `openOn()` live line becomes the menu name only ("Actions for <target>."), dropping the first verb label; the focused Open button is read by the reader (R6.1).
  - `next()`/`prev()`: drop the `announce(VERBS[i].label)` live-region write (R6.2).
  - Set `aria-setsize=4` and `aria-posinset` on each `role=menuitem` button (R6.3).
  - Keep `cancel()` and `chooseCurrent()` result lines unchanged (R6.4).
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 8. Vitest: menus speak once (R7.4)
  - Add a unit test (e.g. `test/menu-focus.test.ts`) with a jsdom element and a captured announce log for both `VerbMenu` and `Inventory`: assert the open line and navigation produce live lines with the menu name and count but NOT the focused item/verb name, and that `chooseCurrent()` still logs its action result. Assert each button carries `aria-posinset`/`aria-setsize`.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.4_

- [x] 9. Playwright: focus mode, Escape, and no MIDI prompt (R7.1, R7.2, R7.3)
  - Add `test/screen-reader-focus.spec.ts` in the replay suite (boots via `?replay=tavern`):
    - after Start, `document.activeElement` is `#game` and its role is `application` (R7.1);
    - after Tab (opens inventory) then Escape, the active element is `#game` again (R7.2);
    - with an `addInitScript` spy wrapping `navigator.requestMIDIAccess` before page scripts run, after load+boot the spy was never invoked / the page left a rejecting stub, so no permission prompt could fire (R7.3).
  - Use the `ch2-vending` fixture if the inventory must be non-empty for the Tab-open path; otherwise `tavern`.
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 10. Run the full suites and verify green (R7.5)
  - Run the vitest unit/property suite and the replay Playwright suite; fix any assertion that pinned an exact onboarding/help string (they assert substrings, so this is a verification, not an expected change). Confirm axe, hints and sonar suites still pass.
  - Note in the process log that the live NVDA VM re-check is Claude Code's follow-up after the next deploy — this spec does not deploy.
  - _Requirements: 7.5_
