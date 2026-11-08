# Tasks: save-progress

Review decisions (locked): (1) **R1** — one IDBFS mount at `/saves`, no engine change, with command-file hygiene (delete `a11y-cmd.txt` after `syncfs(true)` in init, truncate it before `syncfs(false)` in commit) to prevent a stale command replaying at launch; (2) **load = reboot with `--save-slot`** (page-reload-based); (3) keys **`C`** (save) / **`O`** (load), both in F1 help; (4) wording: a completed save says **"Saved."**, and an unavailable store says **"Progress can't be saved in this browser, so it'll be lost when you close the page."**. Only task 7 edits `src/main.ts` and `src/ui/controller.ts`, additively. No `engine/` change is planned; task 0 is a gate that must pass before proceeding.

- [x] 0. Confirm no `engine/` change is needed (Requirement 5.4, 5.1)
  - Re-read `engine/a11y.cpp` `dispatchSave` and `commandFileNode`, and confirm the engine already (a) writes saves to `--savepath` and (b) loads a slot at launch via `--save-slot=<n>`, so the browser side alone can satisfy the feature under resolution R1.
  - Confirm `commandFileNode()` resolves the command file as `<savepath>/a11y-cmd.txt`, so moving `--savepath` to `/saves` also moves the command file there — the fact R1 relies on (sync only on save, so commands never persist).
  - If the review chose R2 (redirect the command file) instead of R1, STOP and record exactly what `engine/` needs before any further task; do not edit `engine/` without that being written down first.
  - _Requirements: 5.1, 5.4, 7.3_

- [x] 1. Add the IDBFS save store `src/engine/persistence.ts` (Requirement 1)
  - Create `Persistence` with `init()`, `commit()`, `hasSave()`, `latestSlot()` and the slot constants (`AUTOSAVE_SLOT = 0`, manual slot ≥ 1), resolving the Emscripten `FS` the same way `live-adapter.ts`'s `resolveFS()` does.
  - `init()`: mkdir `/saves` if absent, mount IDBFS there, `syncfs(true)` to load IndexedDB → MEMFS; then **delete `/saves/a11y-cmd.txt` if present** (before boot) so a command file restored from IndexedDB cannot replay a stale command at launch; resolve `{available:true}` on success and `{available:false, reason}` on any failure — never throw (R1.4, R1.5).
  - `commit()`: **truncate `/saves/a11y-cmd.txt` to empty** (if present), then `syncfs(false)` to flush MEMFS → IndexedDB, so the command file never reaches the store with content; return `false` on failure; return `true` as a no-op when the store is unavailable (R1.2, R1.4, R4.3).
  - `hasSave()`/`latestSlot()`: read the save folder via `FS.readdir`/`FS.stat`, recognise ScummVM's Drascula save-file names, return whether a loadable slot exists and the most recent one (R3.1, R2.4).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.6_

- [x] 2. Unit-test `persistence.ts` with an injected fake FS/IDBFS (Requirement 1, 4)
  - Inject a fake `FS`/IDBFS (same style as the live-adapter and native-transport tests). Assert: `init` resolves `{available:false}` without throwing when mount/syncfs rejects; `commit` returns `false` on a rejected `syncfs(false)` and `true` as a no-op when unavailable; `hasSave`/`latestSlot` read the directory and pick the most recent slot correctly.
  - Command-file hygiene: assert `init` **deletes `/saves/a11y-cmd.txt`** after `syncfs(true)` (a command file present on the restored mount is gone before boot), and `commit` **truncates `/saves/a11y-cmd.txt` to empty before `syncfs(false)`** (the content flushed to the store is empty) — so no stale command can be replayed at launch (R1.4).
  - _Requirements: 1.4, 1.5, 4.3, 2.6_

- [x] 3. Point boot at `/saves` and support a launch slot in `src/engine/boot.ts` (Requirement 1.3, 5)
  - Change `launchArguments()` `--savepath=/tmp` → `--savepath=/saves`; update `COMMAND_FILE` in `live-adapter.ts` to the engine's `<savepath>/a11y-cmd.txt` (i.e. `/saves/a11y-cmd.txt`) so the engine and page agree (R1.4 holds because `commit()` runs only on save, never on a command write).
  - Add optional `saveSlot?: number` to `BootOptions`; when set, append `--save-slot=<n>` to the launch args; when absent, the args are byte-identical to today (R5.1).
  - Add an optional `saveSlot` to `LiveAdapter` and forward it to `bootEngine` alongside `baseUrl` (R5.2), so one boot path serves both a fresh start and a load.
  - _Requirements: 1.3, 1.4, 5.1, 5.2, 5.3_

- [x] 4. Round-trip property test: save then load restores room, flags, inventory (Requirement 6.1)
  - With fast-check and the replay adapter, drive to arbitrary reachable states (room, flags, inventory), model save = capture that state and load = restore it, and assert the restored state equals the saved state. No live engine (R6.4).
  - _Requirements: 6.1, 6.4_

- [x] 5. Property test: autosave never overwrites a manual slot (Requirement 6.2)
  - fast-check over arbitrary sequences of manual saves and room-change autosaves, asserting the autosave slot number and every manual slot number stay disjoint, so no sequence lands an autosave on a manual slot or a manual save on the autosave slot. No live engine (R6.4).
  - _Requirements: 6.2, 2.6, 6.4_

- [x] 6. Save/load/autosave manager in `src/engine/` (Requirement 2, 4) — no main.ts/controller.ts edits yet
  - Build the save/load/autosave behaviour as a self-contained unit (e.g. `src/engine/save-manager.ts`) that `main.ts`/`controller.ts` will call in task 7, so this task writes and tests the logic without touching the two player files.
  - Save: send `{verb:"save", slot: MANUAL_SLOT}` and arm a watchdog; on the matching `saved` event cancel the watchdog and `persistence.commit()`; on commit success signal "Saved", on commit failure signal "progress may not be saved", on watchdog timeout signal "save failed" (R2.2, R2.3, R4.1, R4.3, R4.4).
  - Autosave: on a room change send `{verb:"save", slot: AUTOSAVE_SLOT}` and `commit()` on its `saved`, with no spoken line; gate the first autosave so a continue-boot's first room does not immediately overwrite the loaded autosave (R2.5, R2.6).
  - Load (page-reload-based, decided): resolve `latestSlot()`, record the "continue from slot N" intent, and `location.reload()`; the continue path on the next page load boots `--save-slot=N`. On the loaded room state signal "Loaded: <room>"; on a boot timeout signal "load failed" and leave the session usable (R2.4, R4.2, R4.5, R5.1).
  - Unit-test each path (save ok / commit fail / timeout; autosave quiet + first-room gate; load success + failure) with injected fakes.
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1_

- [x] 7. Wire keys, onboarding and announcements into `src/main.ts` and `src/ui/controller.ts` — additive, the only task that edits these files (Requirements 2, 3, 4, 7.2)
  - `controller.ts`: add the save key **`C`** and the load key **`O`** to the list-mode key routing, each calling a new injected hook (`save()`, `load()`) through the existing single-update path; add nothing that removes or changes an existing key (R2.1, R7.2).
  - `main.ts`: wire `controller`'s `save()`/`load()` to the task-6 manager; refine the existing `case "saved"` to drive the manager's commit + announcement, replacing the current `Saved in slot {slot}` with the manager's line (**"Saved."** / failure) (R2.3, R4.1, R4.3, R4.4); route room changes (in `applyRoom` and the room-change branch of `applyDiff`) into the autosave path (R2.5).
  - `main.ts`: call `persistence.init()` on load, before `adapter.start()`; when `hasSave()`, present the Continue / New game onboarding (keyboard-focusable, choice announced in the live region, speech on the same terms), boot Continue with `saveSlot = latestSlot()` and New game with no slot; when no save, keep today's single start control (R3.1–R3.6); preserve the audio-context-on-first-gesture rule.
  - Announce the in-memory notice from `init` when the store is unavailable: **"Progress can't be saved in this browser, so it'll be lost when you close the page."** (R1.5, R4.3).
  - Add both new keys (**`C`** save, **`O`** load) to `HELP_TEXT` in `main.ts`, and to the onboarding line only if judged core; verify neither key collides with the taken set in `controller.ts` (screen-reader-output rule).
  - _Requirements: 2.1, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.3, 4.4, 7.2_

- [x] 8. Playwright: continue after reload lands in the same room (Requirement 6.3)
  - Add a Playwright check (in the live project / IDBFS-capable harness, kept out of the replay suite like the web-build live check) that drives the keyboard to a second room, reloads the page, chooses Continue, and asserts the live region shows that second room — same room, survived the reload.
  - _Requirements: 6.3_

- [ ] 9. Deploy the result (Requirement 7.4) — separate final task, WAITS FOR KASH
  - Do not start until Kash asks. Deploy the save-progress build to the Cloudflare hosting (web-build spec's `web/` Worker + R2 flow). IDBFS is browser-side and needs no hosting change beyond shipping the new build; confirm the deployed `?live` page saves and continues across a reload on the hosted origin.
  - _Requirements: 7.4_
