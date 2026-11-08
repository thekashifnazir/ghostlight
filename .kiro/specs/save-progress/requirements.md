# Requirements: save-progress

## Introduction

Today a player cannot stop and come back. The browser build launches with `--savepath=/tmp`, and `/tmp` is Emscripten's in-memory MEMFS, so every save file disappears the moment the tab reloads. There is also no key to save and no key to load: the engine supports `save <slot>` (it writes a standard Drascula save and emits `A11Y_SAVED`), but nothing in the page ever sends it, and the engine's only way to load is the launch-time `--save-slot=<n>` path — there is no in-game load command.

This spec makes progress survive a reload. It gives save files a home that outlives the tab, binds a save key and a load key that do not clash with the controller's existing keys, autosaves on every room change into a reserved slot, and offers "continue or new game" on page load when a save exists. Every one of those actions is announced as text in the live region, and a save or load that fails is announced too — never silently dropped.

The engine contract and the `A11Y` line format are frozen (engine-a11y-layer spec). Loading a slot means relaunching the wasm with `--save-slot=<n>`, because the engine has no mid-session load. This spec touches the browser boot and persistence (`src/engine/`) and, only in its final implementation task and only additively, the page wiring in `src/main.ts` and the key routing in `src/ui/controller.ts`. It does not change `engine/` unless the design first shows the engine is missing something it needs. Hosting/deploy of the result is a separate, final task that waits for Kash.

Requirements use EARS (Easy Approach to Requirements Syntax). Terms:

- **save file**: the standard Drascula save ScummVM's `saveGame(slot, desc)` writes under the engine's save path, loadable by `--save-slot=<slot>`.
- **save path**: the directory the engine launches with (`--savepath=<dir>`); the command file `a11y-cmd.txt` and the save files both live here. Today it is `/tmp` (MEMFS, non-persistent).
- **persistent store**: the browser's IndexedDB, which survives a tab reload and a browser restart on the same origin.
- **manual slot**: a numbered save slot the player writes with the save key (slot ≥ 1).
- **autosave slot**: one reserved slot the player never writes by hand, overwritten automatically on every room change.
- **A11Y_SAVED**: the engine line (`A11Y_SAVED {"slot":N,"chapter":C,"room":R}`) emitted when a `save <slot>` completes; the adapter surfaces it as a `saved` event carrying at least the slot.
- **live region**: the single polite ARIA `role=log` region every functional line is written to as text (player spec, accessibility steering).
- **onboarding**: the start screen flow the player meets on page load before the first room.

## Requirements

### Requirement 1: Saves survive a reload

**User story:** As a blind player, I want my saved progress to still be there after I close the tab and come back, so that I never have to replay from the start because the browser forgot.

#### Acceptance criteria

1. THE player SHALL keep save files in a persistent store so that a save written in one session is present after the tab is reloaded or the browser is restarted on the same origin.
2. WHEN the engine writes a save file THEN the player SHALL ensure that save is committed to the persistent store, not only to in-memory MEMFS.
3. WHEN the engine boots THEN the player SHALL make any save files already in the persistent store available to the engine's save path before the engine reads them, so that a launch with `--save-slot=<n>` can load a save written in an earlier session.
4. THE player SHALL NOT make the engine's command file (`a11y-cmd.txt`) persistent, because every queued command would otherwise be written to the persistent store; only the save files are persisted.
5. WHERE the persistent store is unavailable (private browsing, blocked storage, or an older browser), the player SHALL keep running as a normal in-memory session and SHALL announce that progress will not be saved, rather than failing to boot.

### Requirement 2: A save key, a load key, and an autosave

**User story:** As a blind player, I want a key to save, a key to load, and an automatic save whenever I move rooms, so that I can stop at will and never lose more than the current room.

#### Acceptance criteria

1. THE player SHALL bind a save key and a load key that do not clash with the keys the controller already uses: arrows, Enter, Escape, Tab, Backspace, F1, G, H, L, R, Shift+R, V, S, N, P, M, and `/`.
2. WHEN the player presses the save key THEN the player SHALL save to a manual slot through the engine adapter (`save <slot>`).
3. WHEN a save completes THEN the player SHALL announce "Saved" in the live region.
4. WHEN the player presses the load key THEN the player SHALL load the most recent available save, and WHEN the load completes THEN the player SHALL announce "Loaded" together with the name of the room the player lands in (for example "Loaded: tavern").
5. WHEN the player enters a different room THEN the player SHALL autosave into the reserved autosave slot.
6. THE player SHALL NOT let an autosave overwrite a manual slot, and SHALL NOT let a manual save overwrite the autosave slot.
7. THE save key, load key and autosave SHALL send commands only through the engine adapter, never by reading or writing the game canvas.

### Requirement 3: Continue or new game on page load

**User story:** As a blind player returning to the page, I want to be asked whether to continue where I left off or start fresh, so that I can resume without hunting for a load key before the game has even started.

#### Acceptance criteria

1. WHEN the page loads AND a save exists in the persistent store THEN the onboarding SHALL offer a choice between continuing from the save and starting a new game.
2. THE continue-or-new-game choice SHALL be operable with the keyboard alone and SHALL be offered by speech input on the same terms as the rest of the start screen, consistent with the keyboard-only and speech rules.
3. THE onboarding SHALL announce the choice as text in the live region so a screen-reader user hears it, not only as on-screen markup.
4. WHEN the player chooses to continue THEN the player SHALL boot into the saved position (the most recent available save).
5. WHEN the player chooses a new game THEN the player SHALL boot a fresh game from the start, leaving the existing save in place.
6. WHERE no save exists in the persistent store THEN the onboarding SHALL start a new game as it does today, without offering the choice.

### Requirement 4: A failed save or load is never silent

**User story:** As a blind player, I want to be told when a save or load does not work, so that I never believe my progress is safe when it is not, or sit waiting for a load that failed.

#### Acceptance criteria

1. WHEN a save is requested but does not complete THEN the player SHALL announce that the save failed in the live region.
2. WHEN a load is requested but does not complete THEN the player SHALL announce that the load failed in the live region.
3. WHEN committing a save to the persistent store fails THEN the player SHALL announce that progress may not be saved, rather than reporting success.
4. THE player SHALL NOT report "Saved" or "Loaded" unless the save or load actually completed.
5. THE player SHALL recover from a failed save or load by leaving the player usable and the current session intact, rather than leaving the page stuck.

### Requirement 5: Loading maps to the engine's launch-time load

**User story:** As the project, I want loading to use the engine's real load path, so that the feature rests on the frozen engine contract rather than inventing a command the engine does not have.

#### Acceptance criteria

1. THE player SHALL treat loading a save as a launch of the engine with that save's slot (`--save-slot=<n>`), because the engine has no in-session load command.
2. WHERE loading requires the engine to boot or re-boot with the chosen slot THEN the design SHALL describe that boot path, and the player SHALL reuse the existing boot flow rather than a second one.
3. THE player SHALL depend only on the engine adapter and the boot module for saving and loading, and SHALL NOT read the game's internals.
4. WHERE the design finds the engine cannot load the way this feature needs (for example it cannot be relaunched with a slot in the browser), the design SHALL state exactly what the engine is missing before any `engine/` change is proposed; no `engine/` change is made unless the design shows it is needed first.

### Requirement 6: Tests

**User story:** As the project, I want save and load covered by property and end-to-end tests, so that round-tripping progress keeps working as the player grows.

#### Acceptance criteria

1. THE player SHALL have a fast-check property asserting that saving and then loading round-trips the room, the flags and the inventory: the state after a load equals the state that was saved.
2. THE player SHALL have a fast-check property asserting that an autosave never overwrites a manual slot (and that a manual save never overwrites the autosave slot).
3. THE player SHALL have a Playwright check that reaches a second room, reloads the page, continues from the save, and lands in the same room.
4. THE property tests SHALL run without a live engine, consistent with the player spec's replay-based test setup.

### Requirement 7: Boundaries and additive wiring

**User story:** As the project, I want this feature kept to its own area and wired in without disturbing the player, so that it does not regress the existing interaction model.

#### Acceptance criteria

1. THE save, load and persistence logic SHALL live under `src/` (engine/persistence modules), MIT-licensed, taking nothing from GPL engine sources.
2. THE player SHALL edit `src/main.ts` and `src/ui/controller.ts` only in the final implementation task, and only additively: a new save key, a new load key, an onboarding branch, and the wiring to the new persistence and boot behaviour, without removing or changing existing keys or behaviour.
3. THE player SHALL NOT edit `engine/`, `packs/` or `scripts/` unless Requirement 5.4's condition is met and the design shows an `engine/` change is required first.
4. THE hosting/deploy of the result SHALL be a separate final task that waits for Kash, and SHALL NOT be done as part of building the feature.
