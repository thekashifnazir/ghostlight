# Game 2 brief: Flight of the Amazon Queen, opening rooms 1 to 5

Reference for a headless Kiro build. Written 14 Nov 2026 by Claude Code from source reads only (nothing built or run here). Scope: rooms 1 to 5 (C1 to C5) playable by screen reader through the existing adapter seam. Not the whole game.

Paths: `G` = /Users/kash/Code/showcase/ghostlight, `S` = /Users/kash/Code/showcase/spikes/queen, `Q` = `G/vendor/scummvm/engines/queen` (stock ScummVM ad351d1e, the commit the probe patch targets). Queen line numbers are stock. Anything not read in source is tagged **unconfirmed**.

Spike inputs (outside the repo): `S/probe/queen-probe.patch` (715 lines, adds `probe.cpp` 540 lines + `probe.h`), `S/probe/README.md` (Queen source map, risks), `S/probe/samples/` (rooms-all + 3 driven runs), `S/pack/queen-en.draft.json` (313 lines, re-validated today against both `G/packs/schema.json` and the Power's copy: valid), `S/pack/NOTES.md`, `S/pack/flags.md`. Game data: `S/game/FOTAQ_Floppy/queen.1` (22,677,657 bytes, floppy DOS English) and `S/download/FOTAQ_Floppy.zip` + `.sha256`.

## 1. The A11Y line contract and its Queen source

Contract: parser `G/src/engine/a11y-lines.ts:128-236`, types `G/src/engine/adapter.ts:13-134`. Drascula emitter: `G/engine/a11y.cpp` (namespace `Drascula`, 3401 lines).

| Line | Fields the player expects | Queen source (probe line / engine) | Gap |
|---|---|---|---|
| `A11Y {json}` room state | `chapter, room, hero{x,y}, objects[], inventory[], flags[]` (adapter.ts:38-48) | `PROBE ROOM` + `PROBE OBJ` (probe `dumpRoom`). room = `Logic::currentRoom()` (logic.h:67). hero = Joe bob 0 `x,y` (probe prints `joe=`). | chapter, flags: see below. hero is likely a foot point (joe=150,130 equals obj 1 walkto in `drive-talk-sparky.txt`), **unconfirmed** |
| `objects[]` | `num, name, rect[x,y,w,h], walkTo[x,y], visible, door, toRoom?` (adapter.ts:20-35; Drascula `objectJson` a11y.cpp:328-350) | num = room-relative noun 1..`Grid::objMax(room)`; global = `Logic::roomData(room)+num` (logic.h:86). name = `Logic::objectName(abs(od->name))` (logic.cpp:400). rect = `Grid::_objectBox` (probe adds `Grid::objectBox()`), convert x1,y1,x2,y2 to x,y,w,h. walkTo = `ObjectData` x,y (structs.h:185). visible = `od->name > 0` (same test as command.cpp:690). door/toRoom = `od->entryObj != 0`, dest `objectData(abs(entryObj))->room` (command.cpp:529-541) | Closed doors: `entryObj < 0` (18 in the game, room 1 hatch is one). Proposal: `door:true` only when `entryObj > 0`; opening shows up as a door change (below) |
| `inventory[]` | real item ids | `ItemData::name > 0` over `itemData(1..itemDataCount())` (structs.h:315, logic.h:88-89). Probe `PROBE INV` / `PROBE ITEM` | Ids start at 1 (bat=1, journal=2). Journal is the save/load UI: exclude it or keep it but block `use 2` |
| `flags[]` | "all 50 engine flags" (adapter.ts:46) | `Logic::gameState(0..210)` (logic.h:120, `GAME_STATE_COUNT=211` logic.h:234). Probe `PROBE D gs[i]` | See flags proposal below |
| `A11Y_DIFF {json}` | `cmd, chapter?, room?, objects?, appeared?, disappeared?, hero?, invAdded?, invRemoved?, flags?, said?, changed` (adapter.ts:54-85) | Snapshot in `onBeforeAction` (queen.cpp:372 JWM_EXECUTE branch), emit at next `onIdle` (queen.cpp:375). Probe `emitDiff`: gs words, object name/image/entryObj/state, items | Drascula also emits `doors` (a11y.cpp:639-648) but `Diff` has no `doors` field and src never reads it. Queen's hatch opening is exactly a `doors` change (`entry=-8->8`, `drive-open-hatch.txt`) |
| `A11Y_TEXT line` | plain text | `Talk::speak` (talk.cpp:511, hook after the empty check at :541). Covers Joe, NPCs, dialogue, cutaways, look replies (`makeJoeSpeak` logic.cpp:850 -> `makePersonSpeak` :816). Probe `PROBE TEXT speaker=` | Speaker name is available; put it in `said[].color` (player never reads `.color`; grep of src found no use) |
| `A11Y_VTEXT line` | voiced text, player hides SR echo | Floppy has no speech: always `A11Y_TEXT`. Talkie only (`Resource::isCD()` resource.h:62): clip starts per segment in `Talk::speakSegment` -> `Sound::playSpeech` (talk.cpp:797, sound.cpp:270); ends when `!isSpeechActive()` (talk.cpp:757-760, sound.h:137) or on skip `stopSpeech()` (talk.cpp:751-755). A sentence is several segments, each its own `.SB` file, and `speechSfxExists` is known only after `playSpeech` (sound.cpp:301-306) | Ship floppy: no VTEXT needed. Existing bug either way: `A11Y_VTEXT` is missing from `A11Y_PREFIXES` (a11y-lines.ts:26-40), so a glued VTEXT line is not split |
| `A11Y_CHOICES {"choices":[{n,text,used?,ends?}]}` | | `Talk::selectSentence` (talk.cpp:1182) with `_talkString[1..4]`, empty = not offered. Probe `PROBE CHOICES/OPT n slot=` (n = visible order, slot kept). One option left auto-runs with no menu (talk.cpp:161-181) | `n` must be visible order (digit N picks Nth non-empty, talk.cpp:1316-1324). `used`: `TalkSelected` (structs.h:555) **unconfirmed**. `ends`: Drascula hardcodes option 4 (a11y.cpp:2101); Queen has no fixed exit slot, omit `ends` |
| `A11Y_INV {"items":[{id,name,look?}]}` | | `PROBE ITEM id name look`; look = `objectTextualDescription` (logic.cpp:405) | Only 4 slots shown (`_inventoryItem[4]` logic.h:357); list all carried, not the 4 visible |
| `A11Y_PHASE control/busy/choice` | (adapter.ts:104-113) | control = idle branch reached this frame (queen.cpp:373-375) and `!input()->cutawayRunning()` (input.h:65) and no a11y command in flight. busy otherwise. choice = inside `selectSentence` | Reuse the stale-stamp probe pattern (`DrasculaControlProbe` a11y.cpp:2529-2544) |
| `A11Y_CMD`, `A11Y_ERR` | echo / error text | Game-agnostic. Subtitles check: Queen defaults on (queen.cpp:75-76) and forces on when speech is off (queen.cpp:93-95) | none |
| `A11Y_SAVED {"slot"}` | | `QueenEngine::saveGameState` when `canLoadOrSave()` (queen.cpp:168-169) | none |
| `A11Y_GAME_END`, `A11Y_EXIT` | | Out of scope (not reachable in rooms 1-5) | Do not emit |

**Chapters.** Queen has none. Proposal: constant `chapter: 1` everywhere, pack `coverage.chapters: [1]` (the draft already does this). Harmless to `G/src/hints/select.ts:27-34` (sequential-chapter filter) and `crossing-skip.ts` (never fires).

**Flags.** 211 `gs[]` words. Proposal: report all 211 in `flags[]` verbatim (the player does not fix the length except `G/src/main.ts:456` `new Array(50)` and comments; `hints/fold.ts` copies arrays, `hints/reached.ts:42-44` indexes). Raise the validator cap per engine (`FLAG_MAX = 49` at `G/packs/tools/src/types.ts:200` and Power copy `powers/scummvm-access/packs/tools/src/types.ts:176`). Seen in rooms 1-5 so far: `gs[168] 0->1` on C3->C4 (`drive-exit-path.txt`). Noise words: **unknown**, needs a survey. The hatch state is not a gs word (`S/pack/flags.md` room 1), so milestones for it need a door-state condition or a `has`/room condition instead.

## 2. The 13 Drascula gotchas, answered for Queen

Source: `G/powers/scummvm-access/skills/engine-gotchas/SKILL.md:29-41`.

1. **Subtitles on.** Different, easier. Default on and forced on with speech off (queen.cpp:75-76, 93-95). The speak hook (talk.cpp:541) sits before the draw (`if (_vm->subtitles())` talk.cpp:894, :959), so capture should not depend on it: **unconfirmed** by test. Still pass `--subtitles`.
2. **Press/release on separate frames.** Different. `Input::delay` latches `LBUTTONDOWN`/`RBUTTONDOWN` into `_mouseButton` (input.cpp:72-80, no BUTTONUP case); `Command::updatePlayer` reads then clears it (command.cpp:324-325). One pushed down event is enough, but the cursor must be moved first because selection reads `getMousePos()` (command.cpp:575). Probe `pushRightClick` does move, down, up.
3. **Held button skips dialogue.** Different hazard: a right button while `_dialogueRunning` sets `_talkQuit` and ends the conversation (input.cpp:77-79). Never send a right-click outside idle. Line skip is `kActionSkipText` -> `VERB_SKIP_TEXT` (input.cpp:110-111, talk.cpp:751-755).
4. **Conversations run their own loop.** Same. `Talk::talk` -> `selectSentence` nested loop (talk.cpp:1201-1330). But that loop calls `_vm->update()` (talk.cpp:1266), so one hook in `QueenEngine::update` reaches it. `choose n` = push `kActionInvSlotN` (input.cpp:119-130 -> `VERB_DIGIT_n`, matched at talk.cpp:1316-1324).
5. **Cutscenes and speech own loops, shared pump.** Same shape. Walk (walk.cpp:126-134), talk (talk.cpp:740-745) and cutaways all call `QueenEngine::update()` (queen.cpp:128), which calls `Input::delay` (input.cpp:51). Speech waits call `input()->delay(10)` directly (sound.cpp:289-291). Hook `QueenEngine::update` for the throttled skip read. Cutaway skip = `kActionSkipCutaway`, honoured only when `_canQuit` (input.cpp:131-139; set by cutaway.cpp:85-87, talk.cpp:379-381).
6. **Act on objects directly, not centres.** Different, milder. Selection is by cursor position through the grid (`grabCurrentSelection` command.cpp:574-596). Probe `hit` disagrees with the object in only 2 game-wide cases, both inactive. Plan: verb key (`kActionOpen` etc., `_verbActions` input.cpp:31-40) then click at the box centre minus `Display::horizontalScroll()`; refuse with `A11Y_ERR` if `Grid::findObjectNumber` at that point is not the target. Direct `grabSelectedNoun` (command.cpp:690) is private: **unconfirmed** as a path.
7. **Inventory slots 1-6 are verbs.** Different. Verbs are panel zones, not item ids; items are 1..100 (`PROBE INIT items=100`). Using an item needs it in the 4 visible slots (scroll, `VERB_SCROLL_UP/DOWN` defs.h). Journal (item 2) opens save/load (`useJournal`, command.cpp:309, :504).
8. **Flag 12 noise.** Unknown. Only one gs change observed. Object `state` bit-fields (direction, default verb) change on actions and need filtering (probe README "Diff noise").
9. **Item names never on screen.** Different, easier. Names and looks are data (`ItemData::name`, `objectTextualDescription`), and hover text shows them.
10. **Spanish object names.** Not applicable (English floppy). Related gaps: room names are file codes (`roomName()` gives C1..C5), and 61 of 126 rooms have duplicate names (rooms 2-5 all do, `S/pack/flags.md`).
11. **No `sayText` in talk.** Same. No `sayText`/TTS call anywhere in `Q/*.cpp` (grep). Single text chokepoint `Talk::speak`, better than Drascula.
12. **Headless native is flaky.** Same. SDL dummy video never reaches the engine (`S/probe/README.md` "Run").
13. **Ogg pack and `--extrapath`.** Different, easier. English floppy version `PEM10` uses a hardcoded table (resource.cpp:157-160), so no `queen.tbl`, no `--extrapath`, one data file. Music is AdLib/MIDI; web build with the default OPL emulator: **unconfirmed**.

## 3. Hook points

Probe hooks (all one-liners, stock line numbers):

| File | Function | Where | Probe call |
|---|---|---|---|
| queen.cpp | `QueenEngine::run` | after `_logic->start()` :353 | `Probe::init` |
| queen.cpp | `QueenEngine::run` | JWM_EXECUTE branch before `executeCurrentAction()` :372 | `onBeforeAction` (snapshot) |
| queen.cpp | `QueenEngine::run` | idle branch before `update(true)` :375 | `onIdle` (room change, diff flush) |
| talk.cpp | `Talk::speak` | after empty-sentence check :541 | `onSpeak(speaker, sentence)` |
| talk.cpp | `Talk::selectSentence` | before `while (rezone)` :1199 | `onChoices(o1..o4)` |
| logic.cpp | `Logic::handlePinnacleRoom` | after `displayRoom` :1186 | `onPinnacle` (room 7, out of scope) |

Plus accessors `numRooms/numNames/numDescriptions` (logic.h:89) and `Grid::objectBox` (grid.h:93), and `probe.o` in module.mk.

What the product layer needs beyond the probe:

- **Command file poll.** Drascula: `readCommandFile` (a11y.cpp:820-859) reads `<savepath>/a11y-cmd.txt` (`commandFileNode` :811-814), queues lines, truncates; `poll()` (:2546) runs once per main-loop frame; `onUpdateEvents` (:3339-3399) drains only `skip`, throttled to 250 ms. The page writes the file with `FS.writeFile` (`G/src/engine/live-adapter.ts:195`). Queen equivalent: same file and code; run commands from the idle branch (queen.cpp:375); drain `skip` and service `choices`/`choose` from a new hook at the top of `QueenEngine::update` (queen.cpp:128), which every nested loop including the choice menu calls.
- **Dispatch by events.** Commands become pushed events (probe `pushAction`/`pushRightClick`, `g_system->getEventManager()->pushEvent`): verb action, mouse move, click. `use item target`: `kActionUse`, inventory slot key (after scrolling), click target. `walk` = a click on an empty point with no verb selected (command.cpp:592-595 walks). `push` -> `VERB_MOVE`. `give` has no player verb (adapter.ts:137-144): **gap**, out of scope for rooms 1-5 unless the draft needs it.
- **Input isolation.** A walk accepts new clicks mid-command (walk.cpp:126-132; probe prints `superseded`). Send only at idle; drop queued non-skip commands while busy.
- **Startup.** Fresh start plays the intro (room 95 per probe README). Expect `skip` to be needed; whether `--save-slot` skips it: **unconfirmed**.

## 4. Changes outside the engine to run two games

- `G/scripts/build-web.sh:52` `GAME_SRC=vendor/game/drascula`; `:126-145` copies `a11y.*` into `engines/drascula` only; `:147-158` patches drascula `module.mk`; `:160-170` applies one `engine/hooks.patch`; `:211` `--enable-engine=drascula`; `:235` `/data/games/drascula`. Proposal: one wasm, `--enable-engine=drascula,queen`, a second layer dir `engine/queen/` (own namespace `Queen`, own `hooks.patch`), data under `/data/games/queen`.
- `G/scripts/build-engine.sh:58, 212, 218, 293` same Drascula-only flow (native).
- `G/scripts/fetch.sh:23-40, 128` Drascula zips only. Queen zip and sha256 already in `S/download/`; source URL **unconfirmed**.
- `G/src/engine/boot.ts:125` `args.push("-p", "/data/games/drascula", "drascula")`; comments :26, :101, :192.
- `G/src/main.ts:38` static `import packJson from "../packs/drascula-en.json"`, `:196` `loadBundledPack`, `:225` title, `:456` 50-flag init, `:1324` title comment. `G/src/index.html:6, :300` Drascula title and copy.
- `G/src/engine/persistence.ts:51` `SAVE_FILE_RE = /^drascula\.(\d+)$/`, `:55` `drascula.NNN`. Queen saves are `queen.sNN` (queen.cpp:280, metaengine.cpp:121), max slot 99 (metaengine.cpp:77). `AUTOSAVE_SLOT = 99` (:42) is still legal but the comment's "999" reasoning is Drascula's.
- `G/src/ui/controller.ts:577` generic-look phrase `"anything in particular"`; Queen's is `"I don't see anything special"` (230 objects, probe README).
- `G/src/engine/adapter.ts:44, 46` comments (7+, 50 flags, flag 12). No code depends on item id 7 or `flags[12]` (grep).
- `G/src/engine/a11y-lines.ts:26-40` add `A11Y_VTEXT` to the splitter list.
- `G/src/sonar/mapping.ts:109` 320x200 room; Queen rooms 1-5 are 320 wide, 150 tall, no scroll (draft NOTES), fine.
- `G/src/model/hotspot-list.ts:71-80` keeps first entry per hotspot number: fine (Queen numbers are unique per room; duplicate names are the issue, handled by its rule 4).
- Packs: `G/packs/` has only `drascula-en.json`. Move `S/pack/queen-en.draft.json` to `G/packs/queen-en.json`. Schema: `chapters` required on rooms/items (schema.json:85, :134) with placeholder `[1]`; `textFixes.reason` enum includes `spanish` (:156); no object-state condition (:183-195).
- Fixtures and tools: replay fixtures `G/src/fixtures/*.a11y.log` are all Drascula; `G/scripts/record-fixtures.ts:47, 127` and `G/mcp/src/config.ts:45`, `native.ts:187` hardcode drascula.

## 5. Task list for Kiro, smallest first

Zero-credit checks Claude Code can run: `npm run typecheck`, `npm test` (vitest), `npm run build`, `npm run test:e2e` (playwright) in `G`; `npm test` and `npm run validate -- <pack>` in `G/packs/tools`; `npm test` in `G/mcp` and `G/tests/engine`. Claude Code can also run native and web builds and record fixtures at zero credits.

| # | Task | Files | Proof | CC verifies free? |
|---|---|---|---|---|
| 0 | (Claude Code, not Kiro) copy spike into repo: draft pack to `packs/queen-en.json`, probe patch to `reference/spikes/queen/`, game data to `vendor/game/queen` (gitignored) | file moves | validator passes | yes |
| 1 | Add `A11Y_VTEXT` to `A11Y_PREFIXES` + a glued-line test | `src/engine/a11y-lines.ts:26`, `test/a11y-lines.test.ts` | `npm test` | yes |
| 2 | Validator flag cap per engine (queen 0-210), same in Power copy | `packs/tools/src/types.ts:200`, `validate.ts:80`, Power copies | `packs/tools npm test`, validate queen pack with a gs[168] condition | yes |
| 3 | Game config module (`?game=queen`): id, title, launch args, data dir, save-file pattern, generic look phrase, flag count, pack | new `src/engine/game.ts`; `boot.ts:125`, `persistence.ts:51-56`, `controller.ts:577`, `main.ts:38,196,225,456`, `index.html:6` | `npm run typecheck && npm test` (all existing Drascula tests stay green) + new unit test for queen save names and args | yes |
| 4 | Player reads `diff.doors` (closed door becomes exit) | `adapter.ts:54-85`, room model apply in `main.ts` | new parser + model test | yes |
| 5 | Queen layer, read side: `A11Y`, `A11Y_DIFF`, `A11Y_TEXT`, `A11Y_CHOICES`, `A11Y_PHASE`, `A11Y_INV`, start from `probe.cpp` | new `engine/queen/a11y.cpp`, `a11y.h`, `engine/queen/hooks.patch` (6 hooks + 2 accessors) | native build in a scratch tree, then every emitted line parses with `parseA11yLine` (tiny node script) | yes |
| 6 | Queen layer, command side: command file, verbs via pushed events, `use`, `walk`, `inventory`, `choices`/`choose`, `skip`, `save`, `state`; update() hook | `engine/queen/a11y.cpp`, `hooks.patch` | scripted native run C1 open hatch -> C2 -> C3 -> C4 -> C5 gives one `A11Y_DIFF` per `A11Y_CMD` | yes (real window) |
| 7 | Build both engines | `scripts/build-web.sh`, `build-engine.sh`, `fetch.sh` | `scripts/build-web.sh` produces one wasm; `?game=queen&live` boots to C1 | yes |
| 8 | (Claude Code) record `src/fixtures/queen-opening.a11y.log` from task 6 binary | `record-fixtures.ts:47,127` param | fixture replays | yes |
| 9 | Replay test for Queen opening (room list, hatch, exits, Sparky choices) | new `test/queen-replay.test.ts` | `npm test` | yes |
| 10 | Pack polish: room names, exit labels, duplicate names, milestones and hints for rooms 1-5 | `packs/queen-en.json` | validator; `check-coverage` against a census from `rooms-all.txt` | yes |
| 11 | Power additions (section 6) | `powers/scummvm-access/...` | Power validator / file review | yes |

## 6. What the Power is missing for a new engine

- `mcp.json` registers only `drascula` (cwd `${PLUGIN_DATA}/drascula-mcp`, env `DRASCULA_MCP_*`). The MCP server hardcodes the game (`G/mcp/src/config.ts:45`, `native.ts:187`) and has only Drascula fixtures. A survey of Queen through it is impossible today.
- `engine-gotchas/SKILL.md` is the Drascula record. It lists the questions (:45-52) but no worked second answer, and its prerequisites assume the drascula server (:24).
- No probe pattern. The cheapest real survey tool was the throwaway probe (room dump of all 126 rooms in about 150 s), and it is not in the Power.
- Format is Drascula-shaped (draft NOTES "Format fit"): required `chapters`, flag cap 49, no object-state condition, `spanish` reason.
- `steering/` is empty.

Smallest additions that would genuinely guide game 2:
1. `skills/engine-gotchas/queen.md` (or a section): section 2 of this brief as the second worked answer, about 40 lines.
2. `skills/engine-probe/SKILL.md`: the probe method (one-line hooks at run loop, speak chokepoint, choice menu; `PROBE` lines; batch room jump via the engine debugger, `Cmd_Room` debug.cpp:177), about 50 lines, pointing at a copy of the probe patch under `reference/`.
3. Generalise the MCP config: `GHOSTLIGHT_GAME=queen` selecting game path, id and fixture in `mcp/src/config.ts`, and a second `mcp.json` entry. About 30 lines, optional for rooms 1-5.
4. FORMAT.md note: chapterless engines use `[1]`; flags are the engine's own variable array with an engine-specific range.

## 7. Rough size per task

Scale: a headless Kiro fix touching one file cost about 2-7 credits in this project. Credit ranges below are extrapolated from that, **unconfirmed**.

| # | Lines touched | Files | Credit guess |
|---|---|---|---|
| 1 | 5-20 | 2 | 2-4 |
| 2 | 15-40 | 4 | 3-7 |
| 3 | 100-180 | 7 + test | 10-20 |
| 4 | 30-60 | 2 + test | 3-7 |
| 5 | 600-900 new (probe.cpp is 540) + 30 patch | 3 | 20-40 |
| 6 | 400-700 | 2 | 20-40 |
| 7 | 60-120 | 3 | 5-10 |
| 9 | 60-120 | 1 | 3-7 |
| 10 | 200-400 JSON | 1 | 8-15 |
| 11 | 120-180 | 3-4 | 5-10 |

Total about 80-160 credits. Tasks 5 and 6 are most of it; splitting each into two sessions (state lines first, then diff; verbs first, then use/choose/skip) keeps each run near one file and inside the 2-7 band per step.

## Biggest risks

1. One coherent `A11Y_DIFF` per command when a walk can be superseded (walk.cpp:126-132) and right-click ends talk (input.cpp:77-79). The layer must own input.
2. Event-based dispatch (cursor + key) instead of Drascula's direct `checkAction`. Verb+click and use-item were not tested by the probe.
3. Opening flow: the intro on fresh start and room 2's scripted move to room 3 (no engine exit, flags.md room 2) are untested through commands.
4. Hint conditions: the hatch state is not a flag, and the validator caps flags at 49.
