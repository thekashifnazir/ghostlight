# Queen probe (throwaway spike)

A small patch to ScummVM's Queen engine (Flight of the Amazon Queen). It prints plain `PROBE ...` lines on stdout, covering what a Ghostlight-style screen-reader layer would need. The point is to judge cheaply whether the Drascula method transfers. This is not product code.

- `queen-probe.patch`: unified diff against stock ScummVM `ad351d1e9d64912c61b4049fe608d003e639b4cc` (the commit of `ghostlight/vendor/scummvm`). Only touches `engines/queen`.
- `samples/rooms-all.txt`: full batch output, all 126 rooms (floppy DOS English).
- `samples/drive-*.txt`: live hooks exercised by the built-in test driver (talk, exit, open door).

## Apply and build

```sh
git -C <scratch scummvm> checkout ad351d1e9d64912c61b4049fe608d003e639b4cc
git -C <scratch scummvm> apply /Users/kash/Code/showcase/spikes/queen/probe/queen-probe.patch
cd <scratch scummvm>
./configure --disable-all-engines --enable-engine=queen
make -j10
```

What the patch changes:

- adds `engines/queen/probe.cpp` and `engines/queen/probe.h`
- adds `probe.o` to `engines/queen/module.mk`
- adds 3 read-only accessors to `logic.h` (`numRooms`, `numNames`, `numDescriptions`) and 1 to `grid.h` (`objectBox`)
- adds one-line hook calls in `queen.cpp` (3), `talk.cpp` (2) and `logic.cpp` (1)

Checked on 12 Nov 2026: `git apply --check` is clean on a pristine checkout, the build has no warnings or errors, it links, and it runs.

## Run

Use a real window. Under `SDL_VIDEODRIVER=dummy` the stock binary never reaches the engine: the OpenGL manager fails with "Could not load any graphics mode" and `--gfx-mode=surfacesdl` fails with an "SDL_BlitSurface failed" error. Ghostlight hit the same thing (its gotcha 12). The probe itself needs nothing beyond the engine's own frames. Mute the audio with `SDL_AUDIODRIVER=dummy`.

```sh
GAME=/Users/kash/Code/showcase/spikes/queen/game/FOTAQ_Floppy
RUN="./scummvm --config=/tmp/qp/scummvm.ini --savepath=/tmp/qp --path=$GAME queen"

# batch: jump to each room the way the debugger's `room` command does, dump it, then quit
QUEEN_PROBE_ROOMS=all  SDL_AUDIODRIVER=dummy $RUN 2>/dev/null | grep ^PROBE   # 126 rooms, ~150 s
QUEEN_PROBE_ROOMS=1-20,73 SDL_AUDIODRIVER=dummy $RUN 2>/dev/null | grep ^PROBE

# static: data-only dump, no room jumps (fallback if a jump ever hangs)
QUEEN_PROBE_ROOMS=all QUEEN_PROBE_STATIC=1 SDL_AUDIODRIVER=dummy $RUN 2>/dev/null | grep ^PROBE

# test driver: jump to room 1, right-click object 2 (Sparky, default verb "talk to"),
# pick option 1 at the first N menus (default 3), then right-click out of the conversation
QUEEN_PROBE_ROOMS=1 QUEEN_PROBE_CLICK=2 QUEEN_PROBE_PICKS=1 SDL_AUDIODRIVER=dummy $RUN 2>/dev/null | grep ^PROBE

# live: no env vars, play normally; the probe prints as you go
SDL_AUDIODRIVER=dummy $RUN 2>/dev/null | grep ^PROBE
```

Rooms 7 (the jungle pinnacle, a mouse-only chooser that waits for a click) and 95 (the logo room, which plays the whole intro) get a static dump only. So do rooms the data lists but this version doesn't ship (90-94, `I1`-`I5`, not on the floppy). Jumping into those would assert in `Resource::loadFile`.

## Output

```
PROBE ROOM 1 "C1" objects=6 mode=live joe=150,130
PROBE OBJ 6 g=6 "hatch" active=1 image=5 box=205,38,237,101 walkto=206,111 exit=closed->2 "C2" defaultVerb="open" hit=6 look="It looks nice"
PROBE AREA 4 box=185,62,201,111 obj=6
PROBE VERBS 1="open" 2="close" 3="move" 5="give" 6="use" 7="pick up" 8="talk to" 9="look at" 10="walk to"
PROBE INV slots=1,2,0,0
PROBE ITEM 1 "bat" defaultVerb="use" look="This was my lucky bat when I played in the Majors"
PROBE ROOM_END 1
PROBE ACTION room=1                       (command starts: JWM_EXECUTE branch)
PROBE TEXT room=1 speaker="SPARKY" "..."  (every spoken/subtitle line)
PROBE CHOICES n=4 room=1 / PROBE OPT <digit key> slot=<i> "<text>" / PROBE CHOICES_END
PROBE DIFF settled room=3->4 changes=1 / PROBE D gs[168] 0->1 / PROBE D obj ... / PROBE D item ... got / PROBE DIFF_END
```

Field notes:

- **OBJ number** is the room-relative noun, the same number `Grid::findObjectNumber` returns. `g` is the global object index.
- **active**: 1 means `name>0` (hover shows the name, clickable), 0 means hidden, -1 means deleted.
- **box** is in room coordinates. Subtract `Display::horizontalScroll()` for screen coordinates.
- **exit=open|closed->room**: from `entryObj` (more than 0 is an open exit, less than 0 is a closed door).
- **hit** is the noun the engine would select for a click at the box centre. It's an occlusion check.
- **look** is the default first description from the data, with the `*NN` speech-animation codes stripped. A scripted LOOK AT can override it at run time. `PROBE TEXT` shows what was actually said.
- **DIFF** shows `gs[]` (the 211 game-state words), object name/image/entryObj/state changes in any room, and items gained or lost. It's printed once per command, at the next idle frame (`settled`), at each dialogue menu (`at-choices`), or when a new click interrupts a running command (`superseded`).

## What the run showed (12 Nov 2026, floppy DOS English, queen.1 md5 979a3395...)

- 126 rooms, 792 objects, 100 items, 325 names, 724 descriptions. `all` ran clean in about 150 s, exit 0.
- 602 objects are active at game start. Every object resolves to a name (no "?").
- 213 objects are exits: 195 open, 18 closed doors. Every exit gives its target room as data.
- 142 objects have no description text, and 230 more use the generic "I don't see anything special".
- **Room names aren't player-facing.** `roomName()` returns the backdrop file code (`C1`, `J2`, `R3`). Spoken room names (about 120) would have to be written by hand, the same gap Drascula has.
- **61 of 126 rooms have duplicate active names** (two "path", two "lily pad", two "inside airplane"). The screen-reader layer needs to tell them apart, by exit target or position.
- `hit` disagrees with the object in only 2 cases, both inactive, so overlapping boxes are rarely a problem.
- Test driver results:
  - **Talk:** ACTION, the TEXT lines, one CHOICES menu per level (digit key N picks the Nth non-empty option, slot numbers kept), and a final `settled` DIFF.
  - **Exit** (C3 "path"): ACTION, a ROOM 4 dump, then exactly one DIFF `3->4` (`gs[168] 0->1`).
  - **Open hatch:** one DIFF, `entry=-8->8` (closed door becomes an open exit) plus image and state changes.

## Mapping: Ghostlight/Drascula need -> Queen source (stock line numbers)

| Ghostlight need (Drascula) | Queen source | Confidence |
|---|---|---|
| Room-entry hook, `A11Y` room state | Run loop `queen.cpp:360-378`. Room changes go through `changeRoom()` at `queen.cpp:365`, but cutaways also call `changeRoom()` directly (`cutaway.cpp:931`). The probe detects a room change at the idle frame (`queen.cpp:375-376`) by comparing `currentRoom()`, so it catches both. | High (tested on 126 rooms) |
| Per-room objects (number, name, rect) | `Logic::roomData(room)` (`logic.h:86`) gives the first global object. Then `ObjectData` (`structs.h:185`), `Logic::objectName` (`logic.cpp:400`) and the box in `Grid::_objectBox` (zones set in `grid.cpp:126`). | High |
| Visible/active | `ObjectData::name` sign (the same test as `command.cpp:690` and `grid.cpp:137`), plus `image` for whether it's drawn | High |
| Door/exit plus destination room | `ObjectData::entryObj`; the walk-to exit logic is at `command.cpp:529-541` (`objectData(entryObj)->room`) | High (an opened door shows in the diff) |
| Look/description text | `objectTextualDescription(od->description)` (`logic.cpp:405`); series and scripted looks go through `command.cpp:1238` / `:287` | Medium. Defaults only; capture actual looks via TEXT. |
| Verbs | `enum Verb` (`defs.h:293`), `Logic::verbName` (`logic.cpp:415`), default verb `State::findDefaultVerb` (`state.h:102`) | High |
| Inventory list | `ItemData::name>0` over `itemData(1..n)` (`structs.h:315`), visible slots from `findInventoryItem` (`logic.cpp:860`) | High |
| Text chokepoint, `A11Y_TEXT` | `Talk::speak` (`talk.cpp:511`) handles Joe, NPCs, dialogue and cutaways (via `makePersonSpeak`, `logic.cpp:816`) and gives the speaker name. Hover text is `CmdText`, `command.cpp:1293`. | High. One chokepoint, better than Drascula. |
| Choice menu, `A11Y_CHOICES` | `Talk::selectSentence` (`talk.cpp:1182`) with `_talkString[1..4]`. Digit keys select at `talk.cpp:1317`. A single remaining option auto-runs without a menu (`talk.cpp:173`). | High (tested) |
| Command injection (`look 52` and so on) | Push ordinary events: a keymapper verb action (`kActionOpen`, `kActionLook` and the rest in `queen.h:42`, mapped at `input.cpp:33-40`), then a mouse move and click at the box centre. Right-click runs the default verb. Choices take `kActionInvSlotN` (`input.cpp:119`). The probe driver proves the right-click and digit paths. | Medium-high. Verb+click and use-item-on-object weren't tested. |
| Before/after diff, `A11Y_DIFF` | Snapshot at the `JWM_EXECUTE` branch (`queen.cpp:370-372`), diff at the next idle frame | High for simple commands (tested). See the risks below. |
| Room jump for batch/fixtures | `Debugger::Cmd_Room` (`debug.cpp:177`): `joePos(0,0)`, `newRoom`, `entryObj(roomData+1)` | High (126/126). Rooms 7 and 95 and the missing 90-94 are excluded. |
| Special chooser | `Logic::handlePinnacleRoom` (`logic.cpp:1183`) is hover-driven and mouse-only. The probe prints its destinations as `PROBE CHOICES pinnacle`. | Medium. Injection needs a mouse move and click. |

## The "one settled diff per command" risk: what I found

It's better than the earlier desk study feared. `Command::executeCurrentAction` (`command.cpp:179`) is synchronous. It runs Joe's walk, the scripts, every cutaway and the whole conversation in nested `update()` loops, and returns only when the action is finished. Exit room changes are deferred: the command sets `newRoom` and the run loop performs the change on its next pass. So the run loop's idle branch is a natural single settle point, and it comes after any chain of room changes.

In practice: exit, door and talk each gave exactly one coherent diff, and the exit diff arrived after the new room's dump. The real edges:

1. **A walk can be interrupted.** `Walk::animateJoe` calls `update(true)` with player input live (`walk.cpp:126-132`), so a click mid-walk replaces the command. The probe prints `superseded`. An injector must send commands only at idle and must stop real clicks from reaching the game while one is running.
2. **A conversation is one command.** Choices are asked inside the nested `selectSentence` loop. The layer has to emit and answer from that hook (Ghostlight already does this for Drascula's converse), and should emit the pending diff when the menu opens.
3. **Diff noise.** A raw diff is `gs[]` words plus object `state` bit-fields (direction, default verb, on/off). It needs a translation layer so the player hears something like "hatch is now open, leads to C2", not `state=0x513->0x403`. That's the same kind of work as Drascula's flag handling.

## Top risks

1. **Authored content gaps.** Room names are only file codes (126 rooms). 61 rooms have duplicate object names. 372 objects have no or generic look text. The data plumbing is easy; the writing is the cost.
2. **Input isolation during long synchronous commands.** Walks accept new clicks, cutaways can be skipped, and right-click quits a conversation (`input.cpp:79`). The layer must own input or an injected command can be superseded halfway.
3. **Non-menu interaction modes.** The pinnacle chooser is hover-driven, the journal (save/load) is a separate UI, and inventory scrolling shows only 4 slots. Use-item-on-object and give flows weren't tested here. These need their own injectors, much like Drascula's special cases.
