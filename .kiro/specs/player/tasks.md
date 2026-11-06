# Tasks: player (accessible web page)

All code lives under `src/` and `test/`. Do not edit `engine/`, `packs/` or `scripts/`. The pack is read-only. Copy nothing from `reference/`. Build and test against the replay adapter so the player works before the web build exists. Confirm current Web, ARIA, axe-core, fast-check and Playwright APIs via the Context7 power as each is first used.

- [x] 1. Scaffold the player project under `src/`
  - Create `src/` with a TypeScript project (package.json, tsconfig, vite or esbuild dev server, vitest for unit/property tests, Playwright and axe-core as dev deps), MIT-licensed, no framework.
  - Add `src/index.html` with the start gate (focused start button), a hidden `aria-hidden` canvas, the single `role=log aria-live=polite` live region, and empty containers for the inventory and verb menu.
  - Verify the project builds and serves an empty page with no console errors.
  - _Requirements: 13.1, 13.4, 15.1, 15.3, 9.2_

- [x] 2. Define the engine adapter interface and A11Y types
  - Create `src/engine/adapter.ts` with `EngineAdapter`, `RoomState`, `RoomObject`, `Diff`, `Choice`, `InvItem`, `EngineEvent`, `Command` exactly matching the engine a11y layer's data formats.
  - Keep it dependency-free so both adapters and the model import the same types.
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 3. Write the pure A11Y line parser
  - Create `src/engine/a11y-lines.ts` with `parseA11yLine(line)` that strips the `WARNING:` prefix and trailing `!`, dispatches on `A11Y`/`A11Y_DIFF`/`A11Y_TEXT`/`A11Y_CHOICES`/`A11Y_INV`/`A11Y_CMD`/`A11Y_ERR`/`A11Y_SAVED`, parses the JSON payload into a typed `EngineEvent`, and ignores `A11Y_HOVER`/`A11Y_SAY`.
  - Unit-test it line by line, including malformed lines returning `null`.
  - _Requirements: 10.2, 11.2_

- [x] 4. Build the replay adapter and record fixtures
  - Add recorded `A11Y` log fixtures under `src/fixtures/` (tavern, leave-tavern, ch2 handbag, ch2 vending machine), copied as plain log text, not generated here.
  - Create `src/engine/replay-adapter.ts` implementing `EngineAdapter`: `start()` emits up to the first room state; `send(cmd)` matches the next `A11Y_CMD` and emits through the next `A11Y_DIFF`, surfacing a clear mismatch `error` when a command does not match the recorded response.
  - Unit-test replay of a fixture: start yields a room state; a matching command yields its diff; a mismatching command yields an `error`.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 5. Add the live adapter stub
  - Create `src/engine/live-adapter.ts` implementing `EngineAdapter` as a typed stub that documents the `FS.writeFile('/tmp/a11y-cmd.txt', …)` write path and the `Module.printErr` read path through `parseA11yLine`, with the actual wasm boot deferred to the web player spec.
  - Confirm it type-checks against the interface so the seam is real.
  - _Requirements: 10.1, 10.4_

- [x] 6. Implement the pack reader
  - Create `src/model/pack.ts` loading `packs/drascula-en.json` read-only, rejecting an unknown major `formatVersion`, and exposing `roomName`, `roomShort`, `roomLong`, `exitLabel`, `exitTo`, `objectName`, `objectType`, `itemName`, and `applyTextFixes(raw, context, room)`, with `undefined` for unknown ids.
  - Unit-test lookups and text-fix application against the real pack (read-only), including the fallback when a room or object is absent.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 15.2_

- [ ] 7. Build the ordered hotspot list (pure)
  - Create `src/model/hotspot-list.ts` with `buildHotspotList(state, pack)`: take visible objects, resolve names and kinds via the pack with text fixes and fallbacks, split exits from objects/people, and sort strictly by rect left edge then top edge.
  - Assert one entry per engine hotspot number.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 8. Make duplicate names unique (pure)
  - Create `src/model/naming.ts` with `uniquifyNames(hotspots)` that groups by base name and assigns position words (left/middle/right, then first/second/…) from rect left edge in visual order, prepending them to the base name.
  - Wire it into `buildHotspotList` as the final step.
  - _Requirements: 2.5_

- [ ] 9. Property tests for list order and duplicate naming
  - Add `test/hotspot-list.prop.test.ts`: a fast-check generator of `RoomState` with overlapping and equal rects; assert the list's `num`s equal exactly the visible hotspots each once, and order is non-decreasing by (left, top).
  - Add a property that `uniquifyNames` yields distinct names within every duplicate group.
  - _Requirements: 14.3, 1.3, 2.5_

- [ ] 10. Build the live region
  - Create `src/ui/live-region.ts` owning the one `role=log` region: `announce(text)` replaces content (interrupt, not append), keeps the last line for repeat, and composes the room-entry announcement (name, short, things/people, exits) and the "N of M" focus line.
  - Unit-test that announce replaces rather than appends and that repeat returns the last line.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 7.1_

- [ ] 11. Implement list mode (focus and cycling)
  - Create `src/ui/list-mode.ts`: hold the hotspot list and focused index; `next`/`prev` with wrap and "name, N of M" announcement; `rebuild(list)` focusing index 0; `current()` for the focused hotspot; exactly one focused while non-empty, none when empty.
  - Unit/property-test that `rebuild` leaves one in-range focused index for any non-empty list.
  - _Requirements: 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.6_

- [ ] 12. Implement the canvas highlight
  - Create `src/ui/highlight.ts`: an aria-hidden overlay that `show(rect)` positions over the focused hotspot (scaled engine→canvas), clamps to the edge with a direction marker when off-screen, and `hide()` when the list is empty; carries no functional info.
  - Wire highlight updates to list focus changes.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 13. Implement the verb menu
  - Create `src/ui/verb-menu.ts`: a `role=menu` with open/close/talk/push as roving-focus `role=menuitem` buttons, each announced on focus; choosing sends the verb for the focused hotspot and returns focus to the list; cancel closes and returns focus with an announcement.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 14. Implement inventory and the active item
  - Create `src/ui/inventory.ts`: Tab opens a keyboard list of carried items by pack name; choosing sets the active item and announces it; with an item active, interacting on a hotspot sends `use item target` and choosing another item sends `use item item2`; Backspace clears the active item else closes the inventory; announce "Received X" on `invAdded` and "no longer carried" on `invRemoved`.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [ ] 15. Implement the typed-phrase parser (pure, optional shortcut)
  - Create `src/model/parser.ts` with `parsePhrase(phrase, visible, inventory, context)`: fixed phrases, then verb phrases with on/with/in/to splitting, then a bare name scored against only the currently visible hotspots and carried items; return `hotspot`/`item`/`use`/`fixed`/`choice`/`ambiguous`/`none` and never a hotspot that is not present.
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [ ] 16. Property test for the typed-phrase matcher
  - Add `test/parser.prop.test.ts`: generate a set of visible hotspots; a phrase from one present name resolves to that hotspot; a phrase from a name not in the set never resolves to a hotspot (returns `none` or `ambiguous`).
  - _Requirements: 14.4, 12.2, 12.3_

- [ ] 17. Build the controller and key map
  - Create `src/ui/controller.ts`: own the keyboard, stop key events from reaching the engine input, map keys to intents (Left/Right cycle, Up/Enter interact, Down examine, verb-menu key, Tab inventory, Backspace cancel, repeat, read-room, F1, Escape skip), resolve interact by kind (exit→walk, object/person→primary action, or `use activeItem target`), send commands through the adapter targeting hotspot numbers, and return focus to the list after actions.
  - Call a global `stopAudio()` at the top of every key handler.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.1, 7.2, 7.3, 7.4, 9.5, 13.2, 13.3_

- [ ] 18. Wire main.ts: boot, event routing, room reading
  - Create `src/main.ts`: set up `window.Module` first, show the start gate, create the audio context and call `adapter.start()` on the first key press, pick `ReplayAdapter` (via `?replay=`) or `LiveAdapter`, load the pack, subscribe to adapter events, and route them: `room`→build list, focus first, read the room, show highlight; `diff`→apply visibility/inventory changes, announce `said`, re-read on room change; `text`/`choices`/`inv`/`error`/`saved`→announce.
  - Verify an end-to-end play run against a replay fixture with no live engine.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 11.5, 13.4, 1.5, 1.6_

- [ ] 19. Playwright interaction tests through the replay adapter
  - Add `test/*.spec.ts` driving the page with `?replay=<fixture>`: start-screen keyboard start; room read on entry; Left/Right cycling with "N of M" and wrap; unique duplicate door names; Up/Enter interact; Down examine; verb menu open/choose/cancel with focus return; Tab inventory, make active, use on hotspot and on item, Backspace cancel; "Received X"; repeat, read-room, F1; typed shortcut mapping a visible name and refusing an absent one.
  - _Requirements: 14.1, 14.5, and the interaction requirements they exercise (2, 3, 4, 6, 7, 12)_

- [ ] 20. axe-core accessibility checks across key states
  - Add `test/axe.spec.ts` running axe-core on the start screen, in-room play, verb menu open, and inventory open; assert zero violations; fix any that appear.
  - _Requirements: 14.2, 9.1, 9.2_

- [ ] 21. Final verification against requirements
  - Run the full test suite (vitest properties, Playwright, axe) against the replay adapter; confirm the hotspot-list and parser properties hold, the interaction model passes, and axe is clean.
  - Walk each requirement and confirm it is met or explicitly note what the LiveAdapter defers to the web player spec.
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 10.4, 11.5_
