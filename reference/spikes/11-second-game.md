# Spike 11: which second game? (8 Nov 2026)

Headless kiro-cli 3.1.0 research run by Claude Code, read-only (`--no-interactive --trust-tools=fs_read`), 94 s, exit 0. Raw answer below, tool-progress lines stripped. Engine-patch effort figures are Kiro's estimates, not measured.

# Second-game feasibility: sky vs queen vs lure for the Ghostlight a11y layer

**What Drascula's hooks require** (from `engine/a11y.h/.cpp`, `hooks.patch`): a *room-entry* hook that reads per-room object arrays (number, name, rect, walk-to, door, dest) → `A11Y`; a *per-action diff* over objects/inventory/flags; an *inventory list* with id+name+look; a *verb dispatch* that replays the engine's own click path; a *text chokepoint* (Drascula's `centerText`) → `A11Y_TEXT`; a *conversation hook* that lists four options and injects a selection; a *skip* path via the frame pump; and a *command file* read once per main-loop frame. The engine must expose hotspot names **as data**, and offer a single per-frame place to poll.

## sky (Beneath a Steel Sky)
- **Main-loop poll / command file:** `sky.cpp:go()` while-loop (the `_skyLogic->engine()` loop). Skip/line via `handleKey()` → `kSkyActionSkipLine` → `_skyMouse->logicClick()`.
- **Hotspot names/positions:** *not available as data.* Sky is a compiled bytecode VM: everything is `Compact` structs addressed by numeric ids and `_scriptVariables[838]`. Hover text comes from `Text::fnPointerText`/`logicCursor` computed from `MOUSE_LIST` at a cursor position — there is **no room table of named objects with rects**. You would have to reverse the mouse-list/grid (`grid.cpp`, `mouse.cpp` `pointerEngine`) to synthesise names. This breaks Drascula's core premise.
- **Dialogue choices:** `Logic::fnChooser`/`choose()` — script-driven option list in script vars, no clean four-string table.
- **Verb model:** no verb bar at all; it's a context "look/use/pick" icon system driven by `getInteractIcon` (`mouse.h`), totally unlike Drascula's `kVerb*`.
- **Hard bits:** verb-less icon UI, script-VM state (no flag array), text is Huffman-packed (`hufftext.cpp`). Intro is skippable (`fnSkipIntroCode`).
- **Engine-patch effort: ~12–16 days.** Most of it is building a names/rects layer the engine doesn't have.

## queen (Flight of the Amazon Queen)
- **Main-loop poll / command file:** `queen.cpp:run()` while-loop; natural poll point beside `_command->updatePlayer()` / `update(true)`. Skip = `_input` cutaway handling (`input.cpp`).
- **Hotspot names/positions: available as data.** `logic.h`: `ObjectData{name,x,y,room,state,...}`, `Box *_objectBox`, `objectName(objNum)`, `roomName()`, `verbName(Verb)`, `objectTextualDescription()`, `roomData(room)` gives the first object number per room. This is almost a one-to-one match to Drascula's room arrays.
- **Dialogue choices: a clean 4-option table.** `talk.cpp:selectSentence()` lays out up to 4 `_talkString[i]` with `talkZone[i]` (`talk.cpp:~1180–1260`); `TalkSelected` persists per-option used-state. Inject by setting the selected zone, mirroring Drascula's `onConverseFrame`/`applyChoose`.
- **Verb model:** classic verb bar (`command.h` `VERB_PANEL_COMMAND_FIRST..LAST`, `CmdState`, `grabSelectedNoun()` at `command.cpp:590`, `executeCurrentAction()`). Dispatch by filling `CmdState` and calling `executeCurrentAction()` — analogous to Drascula's `checkAction` replay, slightly cleaner (verb+noun are explicit).
- **Text chokepoint:** `makeJoeSpeak()`/`makePersonSpeak()` (`command.cpp:524`, `talk.cpp`) plus `Talk::speak()` (`talk.cpp:511`). Two or three capture points rather than one, but all textual.
- **Hard bits:** the Pinnacle-room chooser (`handlePinnacleRoom`) and timed cutscenes (`cutaway.cpp`); both are skippable/observable. Few pixel hunts.
- **Engine-patch effort: ~5–7 days.**

## lure (Lure of the Temptress)
- **Main-loop poll:** `game.cpp:Game::execute()` (not shown here but single loop); `Room::update()`/`checkCursor()` (`room.cpp`) each frame.
- **Hotspot names/positions: available as data, keyed by id.** `Room::checkRoomHotspots()` (`room.cpp:163`) walks `res.hotspotData()` with `startX/startY/widthCopy/height` and `entry->nameId`; `Hotspot::getName()`/`nameId()`. So names+rects exist, but hotspots are a global list filtered by `roomNumber` across four id ranges — more work to enumerate per room than Drascula's indexed arrays.
- **Dialogue choices:** `TalkDialog`/`Room::setTalkDialog` + `PopupMenu::Show` (`menu.h`). Conversations and verbs **both** route through `PopupMenu` (`menu.cpp`), a modal mouse-driven popup, not a flat 4-string list; harder to enumerate and inject than Queen's zone table.
- **Verb model:** `Action` enum via `Hotspot::doAction(Action, HotspotData*)` with per-verb methods (`doGet/doOperate/doTalkTo/...`). Rich and replayable, but the player picks verbs from the `PopupMenu`, so you must bypass the popup and call `doAction()` directly.
- **Hard bits:** NPCs are autonomous (scheduled `npcSchedule`, pathfinding, `fights.cpp`), so state is less deterministic between frames; real-time follower/NPC movement complicates the "settle after each command" model. Copy-protection dialog at boot (`lure.cpp:go()`), skippable via config.
- **Engine-patch effort: ~8–11 days.**

## Ranked recommendation
1. **queen** — data model (named objects + boxes + room table + verb/noun command state + a flat 4-option dialogue table) maps onto Drascula's hooks almost field-for-field; lowest risk and effort.
2. **lure** — names and a real verb table exist, but the global hotspot list, `PopupMenu`-mediated verbs/dialogue, and autonomous real-time NPCs add friction.
3. **sky** — a script-VM with no named-hotspot/rect data and a verb-less icon UI; it violates the pack's premise and needs a names layer built from scratch.

**Biggest risk for queen:** the "settle after each command" contract. Queen's `run()` loop interleaves `changeRoom`, `JWM_EXECUTE` and `update(true)`, and actions complete through walk + `executeCurrentAction()` + cutaways rather than returning synchronously like Drascula's `checkAction`. Getting one coherent `A11Y_DIFF` per command (especially across cutaways and room changes) is where the real engineering sits.
