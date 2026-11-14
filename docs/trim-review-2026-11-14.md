# Trim review, 14 November 2026

Read-only review. Nothing in the repo was changed apart from this file. The goal was to find code that can go without losing behaviour.

## Short version

- The project is mostly tight. I found about 2,800 lines that could go across engine, player, tools, scripts and tests. About 750 of those are high confidence.
- Most of the saving is not in the shipped player. It is in duplicated test and tool plumbing: a second line parser, three separate engine drivers, a drifted copy of the pack tools, and tests that test a TypeScript copy of C++ code.
- The engine layer has one clearly dead piece (a synthetic click state machine that nothing triggers) and one abstraction with a single user (the control probe).
- Engine line count is inflated by comments, not code. Of the 6,095 lines in the four engine source files, 2,725 are comment lines (a11y.h is 785 comment lines out of 1,058). I am not proposing a comment rewrite, but it explains the 6,571 figure.
- Before the 28 Nov recording I would only cut TypeScript that no shipped file imports. Anything that needs a wasm rebuild should wait.

Line counts below include comments, to match how the sizes were measured. Confidence is my confidence that the cut loses no behaviour.

## Findings, ranked by lines saved times confidence

| # | Where | Cut or merge | Lines | Confidence | When |
|---|---|---|---|---|---|
| 1 | `powers/scummvm-access/packs/tools/`, `packs/schema.json`, `packs/FORMAT.md` in the power | Drifted copy of `packs/tools`. Generate it at package time or point the power at `packs/` | about 680 code, about 1,750 with schema, format doc and lockfile | high that it is a duplicate, medium on removal | after 1 Dec |
| 2 | `tests/engine/src/lines.ts`, `parse.ts`, `native.ts` | Second A11Y parser and third engine driver. Reuse `src/engine/a11y-lines.ts` and the MCP native transport | about 400 | medium | after 1 Dec |
| 3 | `tests/engine/watchdog-decision.test.ts`, `walk-overshoot.test.ts` | Tests of a TypeScript copy of two C++ functions. They never run engine code | 426 | medium | any time |
| 4 | `test/save-roundtrip.prop.test.ts` + `src/engine/save-snapshot.ts` | Module nothing in the player imports, plus its only test | 202 (72 src) | high | safe now |
| 5 | `packs/tools/src/coverage-report.ts` + `packs/tools/test/pack-coverage.test.ts` | Not wired into the CLI. One function has no caller at all | 164 (88 src) | high | safe now |
| 6 | `engine/a11y.cpp:2413-2484`, `engine/a11y.h:216-235, 636-639, 848-870` | Dead synthetic click state machine | about 125 | high | after 1 Dec (needs rebuild) |
| 7 | `engine/a11y.cpp` repeated helpers (list below) | Five copies of verb splitting, two of word splitting, two of said JSON, and so on | about 110 | medium-high | after 1 Dec |
| 8 | `scripts/make-ch2-save.sh`, `over-skip-crossing.sh`, `make-gated-door-save.sh`, `ch2-exit-street.sh` | Same 35 to 40 line preamble in each. Move to one sourced lib, as `sr-vm-lib.sh` already does for the screen-reader scripts | about 120 | medium-high | any time |
| 9 | `test/hints-cache-key.test.ts` + `src/hints/cache.ts:50-79` | `cacheKeyNode` and `cacheKeyWeb` exist only for one test | 88 (30 src) | high | safe now |
| 10 | `engine/a11y.h:44-83, 905-910, 1037-1053`, `engine/a11y.cpp:206, 223, 2536-2578` | `A11yControlProbe` interface with one implementer. `awaitingChoice()` is never called | about 80 | high for `awaitingChoice`, medium-high for folding the rest | after 1 Dec |
| 11 | `engine/a11y.cpp` and `engine/queen/a11y.cpp` | Same `emitLine`, `jsonEscape`, `emitPhase`, `commandFileNode`, `readCommandFile` in both. One shared header | about 75 | medium | after 1 Dec |
| 12 | `src/model/pack.ts:19-86` | Pack types declared a second time. `packs/tools/src/types.ts` already has them and `main.ts` already imports it | about 60 | medium-high | after 28 Nov |
| 13 | `src/engine/status.ts` quiet-period fallback, bare `A11Y_SAVED N`, `WARNING:` unwrap, `A11Y_HOVER`/`A11Y_SAY` | Fallbacks for old recordings and for lines the engine never emits | about 115 | medium-low | after 1 Dec |
| 14 | `engine/a11y.cpp:95-121, 2839-2950` | `CrossChapterDiff` copies `Snapshot` field by field, twice | about 55 | medium | after 1 Dec, do not touch before |
| 15 | Small dead bits (list below) | One-line wrappers, unused exports, a branch that does the same thing both ways | about 130 | high | mostly safe now |
| 16 | `mcp/src/config.ts` flag parsing | Every option is both a flag and an env var. Only tests pass flags | about 40 | medium-low | after 1 Dec |
| 17 | `engine/a11y.cpp:1911-1922, 1989-2007` | `walk <x> <y>`. Nothing in the repo sends it | about 45 | medium-low | leave |

Total if everything went: about 2,800 lines (about 3,900 if you count the power's schema, format doc and lockfile). High-confidence subset: about 750 lines (rows 4, 5, 6, 9, 10 and 15).

By area: engine about 490 of 6,571. Player about 330 of 9,476. Tools about 130 of 2,697, plus the power copy. Scripts about 120. Tests about 1,100 of 15,696.

## 1. Dead code

### Synthetic click state machine (row 6)

`synthClick()` is defined at `engine/a11y.cpp:2448` and declared public at `engine/a11y.h:229`. Nothing calls it. That means `_clickState` never leaves `kClickIdle`, `stepClick()` at `a11y.cpp:2594` never does anything, and `clickSettled()` at `a11y.cpp:2600` is always true. The verbs moved to direct dispatch (`checkAction`, `exitRoom`) and `applyChoose` does its own press, so the click model is left over from an earlier design.

Cut: `synthClick`, `clickSettled`, `stepClick`, the `ClickState` enum, `_clickState`, the two calls in `poll()`, and the 35-line design comment at `a11y.cpp:2413-2447`.

Risk: none in logic, because the code path cannot run. The practical risk is that it needs a wasm rebuild and a re-host. Covered by the native runs in `tests/engine` (`GHOSTLIGHT_NATIVE=1`) and the `test/live` Playwright specs.

### Modules only tests use

- `src/engine/save-snapshot.ts` (72 lines). Its header says "The page uses this to..." but no file under `src/` imports it. Only `test/save-roundtrip.prop.test.ts` (130 lines) does, and that test checks a JSON round trip of the module itself, not a real save.
- `packs/tools/src/coverage-report.ts` (88 lines). `formatCoverageReport` at line 70 has no caller anywhere. `buildCoverageReport` at line 43 is called only by `packs/tools/test/pack-coverage.test.ts`. The CLI (`packs/tools/src/cli.ts`) uses `coverage.ts`, not this. Note: `docs/kiro-features.md` cites the coverage report as evidence for the sandbox row, so update that line if this goes.
- `src/hints/cache.ts:50-79`. `cacheKeyNode` and `cacheKeyWeb` are "kept so the unit test can prove the paths agree". The generator and the player both call `cacheKey`. The Node fallback inside `cacheKey` (lines 46-47) is also unreachable on Node 20 and later, and the repo pins Node 26.

### Small dead bits (row 15)

- `src/engine/replay-adapter.ts:138-141` `replayFromLog`: no caller.
- `tests/engine/src/fixture.ts:101` `loadsSave`: no caller.
- `engine/queen/a11y.cpp:83-89` and `engine/queen/a11y.h:72-75` `lastOutputMs()`: "read by the busy watchdog the command side will add". The command side exists and has no watchdog. Nothing reads it.
- `src/main.ts:220-228`: `if (params.has("live")) return new LiveAdapter(...); return new LiveAdapter(...)`. Both branches are identical, so `?live` does nothing. The README links still carry it, which is harmless.
- `src/main.ts:1060-1062` `announceText`, `1301-1303` `announceSaid`, `712-714` `returnToList`: one-line wrappers left from before the narrator was split out.
- `src/main.ts:940-942` and `997-999`: `voiceHold` and `cmd` cases that do nothing. `A11Y_VHOLD` is emitted by the engine (`a11y.cpp:3410`), parsed (`a11y-lines.ts:214`), typed (`adapter.ts:140`) and then dropped. Nothing consumes it.
- `src/main.ts:1157`: a cast to read `diff.hero`, which the `Diff` type already has.
- `src/model/pack.ts:187-195` `roomShort` and `roomLong`: only `test/pack.test.ts` calls them. The player uses `roomShortFor` and `roomLongFor`.
- `engine/a11y.cpp:517-527`: `onRoomEntry()` and `dump()` are both just `emitRoomState()`.
- `engine/a11y.cpp:1737-1744, 1753` and `1785-1789`: `runVerbOnItemSlot` and `useItemOnItemSlot` re-check that the item is held. Their only callers (`a11y.cpp:1166` and `1380`) already checked. The `(void)slot` line is a sign of it.
- `engine/a11y.cpp:1208-1215` `itemInInventory`: same as `slotForItem(id) >= 0`.
- `mcp/src/replay.ts:149` `toCommandResult`: exported but only used in its own file. Drop the `export`.

Risk for this group: low. `tsc` and the existing unit tests catch the TypeScript ones. The three engine ones need a rebuild, so batch them with row 6.

## 2. Duplication

### Three stacks read the same engine (rows 2 and 3)

The same job, "spawn or replay the engine, write the command file, parse A11Y lines", is done in several places:

| Job | Player | MCP | Engine tests | Scripts |
|---|---|---|---|---|
| Parse lines | `src/engine/a11y-lines.ts` | imports the player's | `tests/engine/src/parse.ts` + `lines.ts` (287 lines) | `scripts/record-fixtures.ts:52-66` |
| Drive native engine | none | `mcp/src/native.ts` (688) | `tests/engine/src/native.ts` (206) | `record-fixtures.ts` (455), `drive.sh` (249), four scenario scripts |
| Replay a recording | `replay-adapter.ts` | `mcp/src/replay.ts` wraps the player's | `tests/engine/src/fixture.ts`, `oracle.ts` | `replay.sh` |

The MCP server did this right: it imports the parser and serialiser from `src/engine/`. The engine test harness predates that and has its own parser with its own types (`kind` instead of `type`, no `A11Y_PHASE`, `A11Y_VTEXT`, `A11Y_VEND` or `A11Y_VHOLD` support at all, see `tests/engine/src/parse.ts:18-31`). So the engine tests cannot see four of the line types the player depends on.

Merge: make `tests/engine/src` import `parseA11yLine` and the `adapter.ts` types, and build `NativeHarness` on `NativeTransport`. Saves about 400 lines and closes the gap.

Risk: it is a rewrite of test plumbing. The README says two replay assertions in that suite are still failing, so do this when the engine spec is closed, not before the recording. Covered by its own suite (`npm --prefix tests/engine test`).

Also: `tests/engine/watchdog-decision.test.ts` (157 lines) and `walk-overshoot.test.ts` (269 lines) each contain "a line-for-line transliteration" of a C++ function and test the copy. They pass even if the C++ changes. They are useful as notes on the two bugs, but they do not protect the engine. Either delete them or keep them knowing that.

The same four recordings also exist twice in two formats: `src/fixtures/*.a11y.log` for the player and `tests/engine/fixtures/*.json` for the engine tests and MCP (`mcp/src/replay.ts:41-45` converts one to the other in memory). Not code, but one format would do.

### The power's copy of the pack tools (row 1)

`powers/scummvm-access/packs/tools/src/` holds six files copied from `packs/tools/src/`. Three are identical (`cli.ts`, `hints.ts`, `load.ts`). Three have drifted and are older: `coverage.ts` (181 vs 186 lines), `types.ts` (176 vs 200), `validate.ts` (181 vs 206). The bundled `schema.json` (233 vs 286) and `FORMAT.md` (185 vs 207) are also behind. So the power ships a validator that does not match the current pack format.

Merge: copy from `packs/` when the power is packaged, or reference `packs/` directly. If you want the smallest fix first, re-copy the five files so the power is at least current.

Risk: the power is a judged Kiro feature and has to install on its own, so do not remove the copy before judging. Re-syncing it is safe.

### Inside `engine/a11y.cpp` (row 7)

- Split a command into verb and argument: `883-899`, `2296-2303`, `3067-3070`, `3111-3114`, `3458-3469`. One helper.
- Split an argument into words: `1290-1304` and `1871-1885`. The Queen layer already has `splitWords` for this (`queen/a11y.cpp:726`).
- Serialise the `said` array: `768-786` and `2817-2827`.
- Inventory gained and lost loops: `696-713` and `716-733`, same body with the arrays swapped.
- Item JSON with name and look: `1540-1552` and `1560-1567`.
- Move the mouse to an object's centre: `1072-1078`, `1249-1255`.
- "Queue is drained, reset it": `2346-2349`, `2407-2410`, `2731-2734`, `3545-3548`.
- Inventory id loop: `425-432` in `takeSnapshot` and `479-493` in `buildRoomState`.
- Digit check at `1141-1146` when `parseInt` (`1847`) is in the same file.

About 110 lines. Mechanical, but the file is the core of the product, so do it after the recording and run the native suite and a live playthrough after.

### Drascula layer vs Queen layer (row 11)

These are the same in both files: `emitLine` (`a11y.cpp:141-159`, `queen/a11y.cpp:95-101`), `jsonEscape` (`166-184`, `106-124`, identical), `emitPhase` (`2515-2523`, `426-433`), `commandFileNode` and `readCommandFile` (`823-869`, `753-783`), and the `said` JSON. A small header with static inline functions, copied into both engine folders by the build scripts, would remove about 75 lines.

The rest of the two layers is properly different (Drascula calls engine methods directly, Queen pushes input events), so I would not try to share more than that.

Risk: both build scripts need one more copy line each. Medium.

### Pack types (row 12)

`src/model/pack.ts:19-86` declares `PackExit`, `PackObject`, `PackRoom`, `PackItem`, `TextFix`, `PackChapter`, `PackCutscene` and `PackData`. `packs/tools/src/types.ts` declares the same shapes, and `src/main.ts:34` already imports that file as `HintPack`. The same JSON is then cast twice (`main.ts:212` and `main.ts:472`). The two have already drifted: `TextFixContext` is `"hotspot" | "dialogue" | "item"` in one and `"hotspot" | "dialogue" | "any"` in the other.

Merge: have `pack.ts` import the tools types. Type-only change, so `tsc` and `test/pack.test.ts` cover it.

### Cross-chapter diff (row 14)

`CrossChapterDiff` (`a11y.cpp:95-121`) repeats every field of `Snapshot` (`a11y.h:246-267`) and splits `SaidLine` into three parallel arrays. `stashCrossChapterDiff` (`2839-2872`) and `emitPendingCrossChapterDiff` (`2882-2950`) then copy field by field in each direction. Holding a `Snapshot` and an `Array<SaidLine>` would save about 55 lines.

Risk: this is the chapter 1 to 2 crossing, the most fragile path in the engine (see the task 18 notes in `hooks.patch`). Covered by `tests/engine/over-skip.test.ts`, `ch2-exit-street.test.ts` and `scripts/make-ch2-save.sh`, all of which need the native binary. Do not touch before the recording.

### Scenario shell scripts (row 8)

`make-ch2-save.sh`, `over-skip-crossing.sh`, `make-gated-door-save.sh` and `ch2-exit-street.sh` each repeat the same path setup, binary and data checks, `cleanup` trap, engine launch, `app()` and `waitfor()`. The first two also share the whole "talk 52 with paced skips" block. One sourced `scripts/engine-lib.sh` saves about 120 lines. These scripts only make saves and fixtures for tests, so the demo does not depend on them.

## 3. Things ScummVM already does

I checked `vendor/scummvm` for each of these.

- **Text to speech.** The Drascula engine already calls `sayText` in 24 places and ScummVM has an Emscripten TTS backend (`backends/text-to-speech/emscripten`). The layer does not reimplement it. ScummVM's path speaks through the browser's speech synthesis, not the player's own screen reader, and `talk.cpp` never routes character replies through it. The `centerText` hook is the right call. No cut.
- **Word splitting.** `common/tokenizer.h` has `StringTokenizer`. The hand-written splitters at `a11y.cpp:1290-1304`, `1871-1885` and `queen/a11y.cpp:726-739` could use it. This is part of row 7.
- **JSON string escaping.** `Common::JSONValue::stringifyString` exists (`common/formats/json.cpp:1101`). Do not swap `jsonEscape` for it. It decodes UTF-8 and truncates the string on an invalid byte, and Drascula's text is not guaranteed UTF-8. Keep the 19-line escaper, just have one copy (row 11).
- **Debug console.** Queen's `Debugger::Cmd_Room` does the same three calls as the survey-only `room` command (`queen/a11y.cpp:1106-1153`). The console needs keyboard input in the game window, so it cannot be driven from the command file. Keep.
- **Hotspot tables.** Both layers read the engine's own arrays (`objectNum`, `_objectRect`, `Grid::objectBox`). Nothing is duplicated.
- **Item names.** `A11yLayer::itemName` (`a11y.cpp:1434-1475`) is a hand-typed table because the engine only has enum names. The pack's `items` list holds the same names and the player prefers the pack. The engine table is still what MCP and the surveyor see when there is no pack, so I would leave it. Low confidence, about 45 lines.
- **Saving.** Queen uses `saveGameState` and `canSaveGameStateCurrently`. Drascula calls `saveGame` directly. Fine.

## 4. Over-built parts

- **Control probe (row 10).** `A11yControlProbe` (`a11y.h:79-83`) is an interface "so the layer can be ported". There is one implementation, heap-allocated in the constructor. The Queen layer did not use it and works out its phase a different way. `awaitingChoice()` has no caller. Fold `playerInControl()` into `updateControlPhase()` and drop the interface, the nested class, `_probe`, and the comment block that plans Lure and Sky ports (`a11y.h:44-78`).
- **MCP config (row 16).** `mcp/src/config.ts` reads every setting from a flag and from an env var, and `--game` means "game id" or "path to game data" depending on its value (lines 141-145). `.kiro/settings/mcp.json` and `powers/scummvm-access/mcp.json` only set env vars. Only `mcp/test/config.test.ts` and `game-queen.test.ts` pass flags. Dropping the flag path saves about 40 lines plus tests. Low priority.
- **`walk <x> <y>` (row 17).** `walkPoint` and the two-coordinate branch of `dispatchWalk`. The player's `Command` type cannot express it, and no script, test or MCP tool sends it. It may be handy for manual debugging, so I would leave it.
- **`GHOSTLIGHT_PLAY_INTRO`** (`engine/hooks.patch:252`). Nothing defines it. Two lines.
- **Wire fields the player never reads.** `look` on `A11Y_INV` items (built by `itemLookLine`, `a11y.cpp:1485-1519`, and `lookText` in Queen), and `color` on said lines (`colorName`, `a11y.cpp:367-382`). No file under `src/ui`, `src/model` or `src/main.ts` reads either. They do reach MCP agents as raw data, so I would keep them. About 120 lines, low confidence.
- **Not a cut, but check it:** both engines emit a `doors` array in `A11Y_DIFF` when a door opens or closes (`a11y.cpp:654-668`, `queen/a11y.cpp:551-561`). The player's `Diff` type has no `doors` field and `applyDiff` in `main.ts` does not read it. Either the player should use it or the engines can stop sending it.

## 5. Leftovers and stale comments

- `src/engine/status.ts:454-481` quiet-period timer and `engineTruth` flag: a fallback for recordings made before `A11Y_PHASE`. Six of the nine `src/fixtures` logs still have no phase lines, so it is still live. Re-record those six and the fallback (about 80 lines with its comments) can go. Covered by `test/status.test.ts`.
- `src/engine/a11y-lines.ts:227-238` and `tests/engine/src/parse.ts:108-117`: accept a bare `A11Y_SAVED N` "for older recorded logs". No fixture has that form. Only a unit test does.
- `src/engine/a11y-lines.ts:102-111`: strips a `WARNING:` wrapper. The engine writes through `logMessage`, not `warning()`, and no fixture has a wrapped line. Likely a spike leftover. Low confidence, so I would leave it.
- `A11Y_HOVER` and `A11Y_SAY`: listed and ignored in `a11y-lines.ts:39-40, 242-244`, `tests/engine/src/parse.ts:26-27` and `scripts/record-fixtures.ts:59-60`. Neither engine layer emits them.
- `scripts/build-engine.sh:264, 292` and `scripts/build-web.sh:181, 205`: branches for "hooks.patch has no diff hunks yet (placeholder)". Both patches have hunks.
- `reference/spikes/10-nvda-vm/*`: seven small spike scripts, replaced by `scripts/sr-*.sh`. `reference/spikes/queen/queen-probe.patch` (715 lines) is the probe the Queen layer was built from. Reference only, but both are tracked.

Stale comments (the code no longer does what they say):

- `src/engine/adapter.ts:107-109` and `src/engine/status.ts:38-41` say the `control` phase means `canSaveGameStateCurrently()` is true. `engine/a11y.h:47-52` explains at length that it is not used for that.
- `src/engine/adapter.ts:44, 46`: "ids 7+" and "All 50 engine flags" are Drascula only. Queen has 211.
- `src/engine/save-snapshot.ts:11-15`: says the page uses the module. It does not.
- `src/main.ts:220-223`: says `?live` opts in to the real engine. It is the default.
- `engine/queen/a11y.h:1` says "(read side)". `engine/queen/a11y.cpp:478` says "There is no command file yet". Both predate the Queen command side.
- `engine/a11y.h:66-76`: says Queen's choice signal will come from "a new hook at talk.cpp:1265". The Queen layer went a different way.
- `README.md` Tests section: "155 tests across 24 files, re-counted 7 November". There are 77 test files under `test/` now. The README also describes one game.
- `engine/hooks.patch:1-120`: a 120-line header that repeats what the comments inside each hunk already say. Not wrong, just said twice.

## What I would not cut before the 28 Nov recording

- **Anything in `engine/`.** Rows 6, 7, 10, 11, 14 and the engine items in row 15. Each needs a wasm rebuild and a re-host, and the README says the hosted build already lags the patch. One rebuild after the recording, with all of them batched, is the cheap way to do it.
- **Row 14, the cross-chapter diff, in particular.** It is the path with the most history of bugs.
- **Row 13, the status fallback.** It needs six fixtures re-recorded, and the readiness signal is what the Playwright and screen-reader checks wait on.
- **Row 2, the engine test harness.** A harness rewrite the week before a recording removes the safety net at the wrong time.
- **Row 1, removing the power's copy.** It is judging evidence. Re-syncing it is fine.
- **Row 12, pack types.** Small and type-only, but it touches the file every room description goes through. After the recording.

Safe now, because no shipped file imports them: row 4 (`save-snapshot.ts`), row 5 (`coverage-report.ts`), row 9 (`cacheKeyNode`/`cacheKeyWeb`), and the TypeScript items in row 15 (`replayFromLog`, `loadsSave`, the `?live` branch, the three wrappers, `roomShort`/`roomLong`). About 500 lines with their tests. Run `npm test`, `npx tsc --noEmit` and `npm --prefix packs/tools test` after.

## How I checked

- Listed every `export` under `src`, `mcp/src`, `packs/tools/src`, `packs/survey`, `tests/engine/src` and `scripts`, and searched for each name in production files and test files separately.
- Read `engine/a11y.cpp`, `engine/a11y.h`, `engine/queen/a11y.cpp`, both `hooks.patch` files and `src/main.ts` in full. Read the adapters, parser, status tracker, MCP transports and config, and the engine test harness. Skimmed the rest of `src/ui`, `src/hints`, `src/sonar` and `packs/survey` by export and member use only, so there may be more small things there.
- Compared the power's files to `packs/` with `cmp`.
- Checked `vendor/scummvm` for the TTS backends, `StringTokenizer` and `JSONValue::stringifyString`.
- I did not run the test suites or build anything. Line savings are estimates from the ranges listed.
