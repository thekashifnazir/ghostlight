# Design: save-progress

## Overview

A player should be able to stop and come back. Three facts from the current build frame this design:

1. **The save path is in-memory.** `boot.ts` launches with `--savepath=/tmp`, and `/tmp` is Emscripten's MEMFS, wiped on every reload. The engine *does* save — `save <slot>` runs ScummVM's own `saveGame(slot, desc)` and emits `A11Y_SAVED {"slot":N,"chapter":C,"room":R}` — but the file it writes lives in MEMFS and is gone on reload (engine-a11y-layer `dispatchSave`, boot.ts `launchArguments`).
2. **The engine loads only at launch.** There is no in-game load command. `a11y.cpp` is explicit: "the loading half (R9.2) is the engine's own `--save-slot=<n>` launch path … there is no `load` command here — a run resumes partway through by launching with the slot." The native MCP transport already proves this: a slot becomes `--save-slot=N` in argv. So in the browser, **loading a slot means booting the wasm with that slot in its launch arguments.**
3. **FS is a global, not `Module.FS`.** ScummVM's Emscripten build exposes MEMFS as `globalThis.FS`; `live-adapter.ts` already resolves it through `resolveFS()`. The persistence layer reads FS the same way.

So the feature has two independent problems — **persist the save files** and **reload the engine onto a chosen slot** — plus a thin UI layer (save/load keys, autosave, continue-or-new onboarding, failure announcements) over the top. None of it needs an engine change: the engine already saves to the save path and already loads a slot at launch; the gap is entirely on the browser side (where the save path points and whether the page relaunches with a slot).

### What this design does not touch

- The `engine/` patch and the A11Y contract — frozen (engine-a11y-layer spec). This design confirms the engine already has what the feature needs (save to path + launch-time load) and proposes **no** `engine/` change (Requirement 5.4 condition is not met).
- The `EngineAdapter` interface, the A11Y types in `adapter.ts`, and `parseA11yLine` — frozen. The adapter already carries `{verb:"save", slot}` and a `saved` event.
- `src/main.ts` and `src/ui/controller.ts` — edited only in the final implementation task, additively (new keys, onboarding branch, wiring).
- `packs/`, `scripts/`, hosting config — untouched; deploy is a separate last task waiting for Kash.

## Decision: how saves survive a reload

The requirement offers two shapes (Requirement 1): **(A) mount an IndexedDB-backed folder (IDBFS) at the save path**, or **(B) copy save files to IndexedDB after each `A11Y_SAVED` and back before boot.** This design picks **(A), an IDBFS mount at a dedicated save folder, with an explicit `FS.syncfs` after each save.** Reasoning:

- **One filesystem, no second serializer.** With IDBFS the save files are ordinary files the engine reads and writes through its normal save path; persistence is a single `FS.syncfs(false, cb)` call that flushes MEMFS → IndexedDB. Option B would re-implement, in page JavaScript, reading each save file out of MEMFS, keying it in IndexedDB, and writing it back before boot — a second copy of ScummVM's save I/O that can drift from what the engine actually wrote (multi-file saves, metadata, naming).
- **The command-file hazard is avoidable, and is the reason not to persist `/tmp` wholesale.** `boot.ts` already warns that the save path must never be `/home/web_user`, because Emscripten auto-persists `$HOME` as IDBFS and would then write **every queued command** (`a11y-cmd.txt`) to IndexedDB. The lesson is not "avoid IDBFS" but "do not put the command file on an IDBFS mount." So we **split the paths**: keep `--savepath` pointing at a folder that holds *only* the save files and is IDBFS-mounted, and keep the command file on plain MEMFS. See "Path split" below (Requirement 1.4).
- **`syncfs` is explicit and testable.** IDBFS does not auto-flush; a write lands in IndexedDB only on `FS.syncfs(false)`. Doing that sync deliberately after each observed `A11Y_SAVED` (and after the autosave) gives a precise commit point to assert on and to detect failure at (Requirement 1.2, 4.3), rather than relying on Emscripten's opaque auto-persist timing.

Option B's one notional advantage — not caring where the command file lives — is exactly the hazard we already know how to handle by splitting the paths, so it buys nothing here.

### Path split

```
--savepath = /saves      (IDBFS, mounted + synced; holds ONLY Drascula save files)
command file = /tmp/a11y-cmd.txt   (plain MEMFS, never persisted — R1.4)
```

`boot.ts` today hard-codes `--savepath=/tmp` and the command file at `/tmp/a11y-cmd.txt` (via `COMMAND_FILE` in `live-adapter.ts`). This design changes the **save path only** to a dedicated IDBFS folder and leaves the command file where it is on MEMFS, so the two never share a mount.

> Open point for the design review: whether to keep the literal command-file constant `/tmp/a11y-cmd.txt` as-is (simplest, already proven) or move it under an explicit non-persistent folder for symmetry. The engine resolves the command file as `<savepath>/a11y-cmd.txt` (`commandFileNode()` in `a11y.cpp`). **This means `--savepath` and the command file are coupled in the engine: the engine reads commands from `<savepath>/a11y-cmd.txt`.** So the command file cannot simply stay at `/tmp` while the save path moves to `/saves` — the engine would look for commands under `/saves`. This is the crux the design review must resolve; see the two candidate resolutions below. No code is written until it is resolved.

#### Candidate resolutions for the savepath/command-file coupling (design-review decision)

The engine reads **both** the save files and the command file from `--savepath` (`saveGame` writes to the save path; `commandFileNode()` reads `<savepath>/a11y-cmd.txt`). We cannot persist the save files without also persisting the folder the command file sits in — unless we separate them. Two ways, to be chosen at review:

- **R1 — IDBFS at the single save path, command file accepted on it, synced only for saves.** Mount IDBFS at `/saves`, launch `--savepath=/saves`. The command file lives at `/saves/a11y-cmd.txt` on the IDBFS mount, but we **only ever call `FS.syncfs(false)` after a save** (never after a command write), so commands are never flushed to IndexedDB. Simple, one mount; the cost is the command file technically sits on an IDBFS mount (unflushed). Satisfies R1.4 in effect (commands never reach the store) but not in letter (the file is on the mount).
- **R2 — IDBFS at the save path, command file redirected off it.** Requires the engine to read the command file from a path **other** than `<savepath>`. Today it does not; `commandFileNode()` hard-codes `<savepath>/a11y-cmd.txt`. This is the one place the feature *might* need an `engine/` change (Requirement 5.4): a way to point the command file at a fixed non-persistent path (e.g. an env/Conf key `a11y_cmdpath`, defaulting to the current behaviour). **The design's recommendation is to prefer R1 and make no engine change**, because R1 already guarantees commands never reach the persistent store (the only thing R1.4 actually cares about), and keeps `engine/` frozen. R2 is documented only so the review can see the trade-off and the exact engine gap if it chose otherwise.

**Decided (review):** R1 (single IDBFS mount at `/saves`, sync only on save), no engine change.

#### The stale-command hazard and command-file hygiene (decided)

`syncfs` operates on the **whole mount**, not a single file. So even with "sync only on save", whatever sits in `/saves/a11y-cmd.txt` at the moment of `syncfs(false)` is flushed to IndexedDB, and the next boot's `syncfs(true)` would restore it — the engine could then replay a **stale command** at launch. R1.4 ("do not persist the command file") must therefore be enforced actively, not just by "only syncing on save":

- In `persistence.init()`, **after** `syncfs(true)` populates MEMFS from IndexedDB and **before** the engine boots, **delete `/saves/a11y-cmd.txt`** if present, so no restored command file survives into the launch.
- In `persistence.commit()`, **truncate `/saves/a11y-cmd.txt` to empty before `syncfs(false)`**, so the copy that reaches IndexedDB is empty and a later restore yields nothing to replay.

Both are small, deliberate `FS` operations with unit tests (task 2). With them, R1.4 holds in letter as well as substance: the command file is never persisted with any content.

## Architecture

```
Page load (main.ts)
  │
  ├─ Persistence.init()           ── mount IDBFS at /saves, syncfs(true) to load IndexedDB → MEMFS
  │     └─ if IDBFS unavailable → in-memory session, announce "progress will not be saved" (R1.5)
  │
  ├─ Persistence.hasSave()        ── is there a loadable slot on the mount?
  │     ├─ yes → onboarding offers Continue / New game (R3.1)
  │     └─ no  → start gate starts a new game as today (R3.6)
  │
  └─ start gate first gesture
        ├─ Continue → boot(saveSlot = latest)   ── LiveAdapter(slot) → boot.ts adds --save-slot=N
        └─ New game → boot()                     ── current flow, no slot

In session (controller + main.ts)
  ├─ save key  → adapter.send({verb:"save", slot: MANUAL_SLOT})
  │               └─ on `saved` event: Persistence.commit() (syncfs false) → announce "Saved" (R2.3)
  │                  └─ no `saved` within timeout → announce save failed (R4.1)
  ├─ room change (applyRoom / room-change diff) → adapter.send({verb:"save", slot: AUTOSAVE_SLOT})
  │               └─ on `saved`: Persistence.commit() silently (no spoken line; autosave is quiet)
  └─ load key  → reload the engine onto the latest slot (see "Loading" below) → announce "Loaded: <room>" (R2.4)
```

### The one invariant kept

The read path (A11Y lines → `parseA11yLine` → EngineEvent → model/UI) is unchanged. Saving is one new command through the existing adapter (`save`), and the only new engine-facing behaviour is **which slot the boot launches with** — handled by passing a slot into `LiveAdapter` → `boot.ts` launch args. No new decode, no new event type.

## Components

### 1. `src/engine/persistence.ts` (new) — the IDBFS save store (Requirement 1)

A small module that owns the persistent save folder. It depends only on the Emscripten `FS` global (resolved the same way `live-adapter.ts` does) and IDBFS, not on the model or UI.

Responsibilities and shape:

- **`init(): Promise<PersistenceResult>`** — create the save directory (`FS.mkdir('/saves')` if absent), mount IDBFS there (`FS.mount(IDBFS, {}, '/saves')`), and `FS.syncfs(true, cb)` to populate MEMFS from IndexedDB (loading earlier sessions' saves). Resolve to `{ available: true }` on success. On any failure (no IDBFS, blocked storage, old browser) resolve to `{ available: false, reason }` — **never throw**, so the page still boots as an in-memory session (R1.5).
- **`commit(): Promise<boolean>`** — `FS.syncfs(false, cb)` to flush MEMFS → IndexedDB. Returns `false` on failure so the caller can announce it (R1.2, R4.3). A no-op returning `true` when the store is unavailable (in-memory session), so callers need no special-casing.
- **`hasSave(): boolean`** and **`latestSlot(): number | undefined`** — inspect the save folder for Drascula save files and return whether any loadable slot exists and which is the most recent. ScummVM names saves predictably per target (`drascula.NNN`); the module reads the directory listing through `FS.readdir`/`FS.stat` (mtime for "most recent"). This is the one place that knows the engine's save-file naming; it is the page's read-only view of the folder, not a reimplementation of save I/O.
- **Slot constants** live here and are the single source of truth: `AUTOSAVE_SLOT` and the `MANUAL_SLOT` range. ScummVM convention (confirmed in `dispatchSave`) is slot 0 = autosave, slots ≥ 1 = manual; the engine already rejects `save 0` as a manual save. So **`AUTOSAVE_SLOT = 0`** (written only by the autosave path) and **manual saves use a slot ≥ 1** (e.g. `MANUAL_SLOT = 1` for the single quick-save this feature needs). This mechanically guarantees R2.6: the autosave slot and the manual slot are different numbers, so neither path can overwrite the other.

> Design note (ordering — refined during implementation): the mount + `syncfs(true)` must be visible to the engine **before** the engine's `main()` reads the save path at launch (R1.3), but the Emscripten `FS` global does not exist until `scummvm.js` has instantiated the wasm. So the mount cannot be done by a plain `await persistence.init()` call before `adapter.start()` — at that point there is no `FS` to mount on. The correct hook is Emscripten's **`Module.preRun`**, which runs *after* FS is set up and *before* `main()`. `main.ts` therefore pushes the mount+populate step onto `window.Module.preRun` before boot; it runs synchronously enough for the launch to see the restored `/saves`. `persistence.init(fs)` keeps taking an injectable FS for tests, and gains a `preRunMount(fs)` the `preRun` hook calls with the real global.
>
> This splits persistence into two phases: (1) a **pre-boot probe** that answers "does a save exist?" for onboarding *without* an Emscripten FS (the onboarding choice is shown before boot), done by reading IndexedDB directly; and (2) the **in-`preRun` mount + populate** that makes the saves available to the launching engine. See "Pre-boot save probe" below.

#### Pre-boot save probe (onboarding needs "does a save exist?" before FS exists)

The Continue / New game choice is shown on the start gate **before** the engine boots, so it cannot use the Emscripten FS (which does not exist yet). IDBFS stores each mounted folder as an IndexedDB database named after the mountpoint (`/saves`) with a `FILE_DATA` object store keyed by absolute path. The probe opens that database read-only and checks whether any key under `/saves/` matches a Drascula save-file name (`drascula.NNN`), ignoring the command file. It returns `{ hasSave, latestSlot }` or, on any error / no database, `{ hasSave: false }` — so a first visit, a cleared store, or a browser without IndexedDB all fall through to a plain new game (R3.6). This probe is read-only and does not create the database. `persistence.ts` exposes it as `probeSaves(): Promise<{hasSave; latestSlot?}>`; after boot, the mounted-FS `hasSave()`/`latestSlot()` are the authoritative versions used by the load key.

### 2. `src/engine/boot.ts` — launch-args changes (Requirement 1.3, 5.1, 5.2)

Two additive changes to the already-proven boot:

- **Save path → `/saves`.** `launchArguments()` changes `--savepath=/tmp` to `--savepath=/saves` (the IDBFS mount). Per the recommended resolution R1, the command file then resolves to `/saves/a11y-cmd.txt`; `persistence.commit()` is only ever called after a save, so the command file is never flushed to IndexedDB (R1.4 in substance). `COMMAND_FILE` in `live-adapter.ts` is updated to match the engine's `<savepath>/a11y-cmd.txt` resolution.
- **Optional `--save-slot=N`.** `BootOptions` gains an optional `saveSlot?: number`; when set, `launchArguments()` appends `--save-slot=<n>` so the engine loads that slot at launch (R5.1). When absent, the args are byte-identical to today (a new game). This mirrors the native MCP transport, where a slot becomes `--save-slot=N` in argv.

`LiveAdapter` gains an optional constructor `saveSlot` it forwards to `bootEngine` (alongside the existing `baseUrl`), so `main.ts` can boot either fresh or onto a slot without a second boot path (R5.2).

### 3. Save, load and autosave wiring in `src/main.ts` + `src/ui/controller.ts` (Requirements 2, 4) — final task, additive

#### Keys (Requirement 2.1, screen-reader-output rule)

Taken keys (from `controller.ts`): arrows, Enter, Escape, Tab, Backspace, F1, G, H, L, R, Shift+R, V, S, N, P, M, `/`. Free and mnemonic:

- **Save key: `C`** — mnemonic for "checkpoint" (keep-your-progress). `S` is taken by sonar scan, so save cannot use `S`. `C` is unused.
- **Load key: `O`** — "restore"/"open a save". `R` is repeat and `L` is read-room, both taken, so load cannot use the obvious letters; `O` is unused and reads as "open my saved game".

> Open point for the design review: the `C`/`O` choice is defensible but arbitrary. The review may prefer a different unused pair (e.g. `C` save / `X` load, or function keys). The constraint the implementation must honour is only that the pair is unused in `controller.ts` and documented in `HELP_TEXT`. The exact letters are a review decision; the design does not hard-commit them beyond "two currently-unused keys, each announced."

Both keys route through `controller.handleKey`'s existing single-update path. Each produces exactly **one** coherent live-region line (screen-reader-output: one key press, one update). Both new keys are added to `HELP_TEXT` in `main.ts` and the save/load pair is mentioned in onboarding only if judged core (the design leans: F1 help yes, onboarding line optional).

#### Save (Requirement 2.2, 2.3, 4.1, 4.4)

`controller` gets a `save()` hook wired by `main.ts`. On the save key it calls `adapter.send({verb:"save", slot: MANUAL_SLOT})`. The engine answers with a `saved` event (parsed from `A11Y_SAVED`); `main.ts`'s existing `case "saved"` handler is the natural place, refined to:

1. call `persistence.commit()`;
2. on commit success announce **"Saved."** (R2.3) — replacing today's `Saved in slot {slot}` line;
3. on commit failure announce **"Progress can't be saved in this browser, so it'll be lost when you close the page."** (R4.3).

**Detecting a save that never completes (R4.1).** The engine does *not* emit `A11Y_ERR` on a failed `saveGame` (it only warns to ScummVM's own log — confirmed in `dispatchSave`). So the page cannot rely on an error event. The `save()` hook arms a short timeout when it sends the command; the matching `saved` event cancels it. If the timeout fires with no `saved`, the player announces the save failed (R4.1, R4.4 — never say "Saved" unless it completed). The timeout is a page-side watchdog, the only way to turn a silent engine failure into a spoken line.

#### Autosave (Requirement 2.5, 2.6)

`main.ts` already has the one place a room change is known: `applyRoom` (full room state) and the room-change branch of `applyDiff`. On a room change the player sends `adapter.send({verb:"save", slot: AUTOSAVE_SLOT})` and, on the resulting `saved`, calls `persistence.commit()` **without** a spoken "Saved" line — autosave is quiet so it does not clobber the room announcement (screen-reader-output: one key press/one update; a room entry's own line must be the one the player hears). Because `AUTOSAVE_SLOT = 0` and manual saves use slot ≥ 1, the autosave and manual slots are distinct by construction (R2.6).

> Guard: the autosave must fire on a genuine room change, not on the very first room during a *continue* load (which would immediately overwrite the autosave the player just loaded from). The design gates the first autosave so a continue-boot's first room does not trigger an autosave write before the player has moved.

#### Load (Requirement 2.4, 4.2, 5.1)

Because the engine loads only at launch, the load key **re-boots the engine onto the latest slot**. The design's load path:

1. Resolve `persistence.latestSlot()`.
2. Re-run the boot onto that slot. The cleanest reuse (R5.2) is to construct a fresh `LiveAdapter(undefined, baseUrl, slot)` and `start()` it, re-subscribing the same event routing — the same flow `main.ts` uses at startup, just with a slot. The engine's `--save-slot=N` loads the save and emits the loaded room's `A11Y` room state, which the existing `room` routing reads and announces.
3. The player announces **"Loaded: <room name>"** once the loaded room state arrives (R2.4), using the pack's room name.

> Open point for the design review: whether an in-place engine re-boot (loading `scummvm.js` a second time in the same page) is reliable, or whether a load is better done by writing the chosen slot to the persistent store and triggering a **page reload** (`location.reload`) that boots onto that slot through the same continue path as Requirement 3. A full page reload is the most robust ("the engine loads only at launch" taken literally — a reload *is* a launch) and reuses exactly one boot path; an in-place re-boot avoids the reload flash but risks wasm/`scummvm.js` re-instantiation issues. The design leans toward **page-reload-based load** for robustness and single-path reuse, but flags it for the review to confirm against the live build's actual re-instantiation behaviour. Either way the load announcement and failure handling are identical.

**Detecting a load that failed (R4.2).** As with save, a boot that never reaches a room state is the failure signal; `bootEngine` already rejects on a timeout with a clear message. The load path catches that rejection and announces the load failed (R4.2, R4.5), leaving the session usable.

### 4. Onboarding: continue or new game (Requirement 3) — final task, additive

The player spec owns the start gate DOM and the `main.ts` gesture handler. This spec adds, additively:

- **On load, `persistence.init()` then `persistence.hasSave()`.** When a save exists, the start gate presents a two-option choice (Continue / New game) instead of the single start control (R3.1). Both options are real keyboard-focusable controls (keyboard-only, R3.2), and the choice text is announced in the live region so a screen-reader user hears it (R3.3), consistent with how the gate text is already announced. Speech input, where present, feeds the same choice on the same terms as the rest of the start screen (R3.2).
- **Continue** boots with `saveSlot = latestSlot()` (R3.4). **New game** boots with no slot, leaving the save in place (R3.5). When no save exists, the gate is exactly today's single start control starting a new game (R3.6).
- The audio-context-on-first-gesture rule (player spec R13.4) is preserved: whichever option the player activates is the gesture that creates the AudioContext and then calls `adapter.start()`.

## Data flow: a save round-trip

```
player presses C (save key)
  → controller.save() → adapter.send({verb:"save", slot:1})  + arm watchdog
  → LiveAdapter.send: FS.writeFile('/saves/a11y-cmd.txt', 'save 1\n')
  → engine poll runs saveGame(1, "ghostlight ch1 room62") → writes /saves/drascula.001
  → engine emits A11Y_SAVED {"slot":1,"chapter":1,"room":62}
  → parseA11yLine → {type:"saved", slot:1} → main.ts case "saved"
  → cancel watchdog → persistence.commit() (FS.syncfs(false)) → IndexedDB now holds drascula.001
  → commit ok → live.announce("Saved.")
```

A load round-trip (page-reload variant): record "load latest" intent, `location.reload()`, and on the next page load the continue path boots `--save-slot=<latest>`; the loaded room's `A11Y` state is read and announced as "Loaded: <room>".

## Error handling

- **IDBFS unavailable** (`persistence.init`): resolve `{available:false}` and keep the in-memory session (R1.5). `commit()` is then a no-op returning `true` so save/autosave callers do not special-case it. The honest notice — **"Progress can't be saved in this browser, so it'll be lost when you close the page."** — is announced the moment the player first presses the save key, by the save manager (`SAVE_UNAVAILABLE_LINE`), rather than clobbering the first room announcement with a proactive line at init (screen-reader-output: one coherent update per action). Autosave stays silent when unavailable. So the save key never promises "Saved." it cannot keep (R4.4): in the unavailable state it states the reality instead (R1.5, R4.3).
- **Save never completes** (no `saved` within the watchdog window): announce the save failed (R4.1).
- **`syncfs` commit fails**: announce progress may not be saved (R4.3); do not announce "Saved" (R4.4).
- **Load/boot never reaches a room** (`bootEngine` timeout rejects): announce the load failed, leave the session usable (R4.2, R4.5).

## Testing strategy

- **Round-trip property (R6.1).** With fast-check, drive the replay adapter to a known state (room, flags, inventory), model a save as capturing that state and a load as restoring it, and assert the restored state equals the saved state for arbitrary reachable states. This tests the save/load **contract** (what is captured must come back) against the replay adapter, with no live engine (R6.4). The engine's own save fidelity is the engine spec's concern; here we assert the page round-trips the state it is responsible for.
- **Autosave-never-overwrites-manual property (R6.2).** A fast-check property over arbitrary sequences of manual saves and room-change autosaves asserting that the autosave slot number and every manual slot number are disjoint, so no sequence lets an autosave land on a manual slot (or a manual save on the autosave slot). This follows mechanically from `AUTOSAVE_SLOT = 0` vs manual ≥ 1, and the property pins it so a future slot-numbering change cannot silently break it.
- **Playwright continue-after-reload (R6.3).** Reach a second room (drive the keyboard through a door, as the live/replay suites do), reload the page, choose Continue on the onboarding, and assert the live region shows the second room — same room, survived the reload. Runs in the live project (it needs a real engine + IDBFS) or against a harness that fakes IDBFS; kept out of the replay suite so that suite stays green without a build, consistent with the web-build Playwright split.
- **Persistence unit behaviour.** `init` failure path resolves `{available:false}` without throwing; `commit` returns `false` on a rejected `syncfs`; `hasSave`/`latestSlot` read the directory correctly — tested with an injected fake `FS`/IDBFS, the same injection style the live-adapter and native-transport tests use.

## Open questions for the design review

1. **Savepath/command-file coupling** — **Decided: R1** (single IDBFS mount at `/saves`, sync only on save, no engine change), with the command-file hygiene above (delete on init, truncate before commit) to close the stale-command hazard.
2. **Load mechanism** — **Decided: page-reload-based load** (reboot with `--save-slot`, single boot path, most robust).
3. **Key letters** — **Decided: `C` (save) / `O` (load)**, both added to `HELP_TEXT`.
4. **In-memory / save wording** — **Decided:** a completed save announces **"Saved."**; when the store is unavailable, announce **"Progress can't be saved in this browser, so it'll be lost when you close the page."** (so the player is never told their progress is safe when it is not — R4.4).

## Licensing and boundaries

- `src/engine/persistence.ts`, the `boot.ts`/`live-adapter.ts` additions, and the `main.ts`/`controller.ts` wiring are new project code, MIT, taking nothing from GPL engine sources (R7.1).
- No `engine/` change is proposed (R5.4 condition not met under the recommended R1); `packs/` and `scripts/` are untouched (R7.3).
- Hosting/deploy of the result is a separate final task that waits for Kash and is not part of building the feature (R7.4).
