# Spike 05: how big is Drascula? (throwaway)

**Result, 6 Nov 2026.** Read-only census of the English freeware release, from the game data and the ScummVM engine source. No build, no engine run.

| What | Count |
|---|---|
| Room files (`*.ald`) | **57**, across 6 chapters (2 / 17 / 2 / 21 / 10 / 5) |
| Hotspots | **270** (163 things, 107 exits), 251 unique (room, object) pairs |
| Unique hotspot names | 97 non-door names, 26 door names |
| Room-to-room exits | **103** directed edges |
| Inventory | **no text names in the game at all.** 18 item ids in use (7–23, 28); about 39 (chapter, id) meanings to name, because chapters 4–6 reuse ids for different things |
| Progress flags | **42 of 50 used** (0–41; 42–49 never referenced). Reset to 0 at every chapter start, so 106 (chapter, flag) pairs. 188 write sites, 294 reads |
| English text | **763 strings, 36,243 characters** (corrects the earlier 774 / ~37,400, which counted 11 lip-sync code strings) |
| Conversation menus | 13 files, 52 choices, 2,004 characters (duplicates of `_text` lines, same voice file numbers) |
| Cutscenes | **43** `animation_*` functions (4 / 21 / 2 / 6 / 5 / 5), 181 `talk*()` calls inside them, **19 with no dialogue at all** |
| Timed puzzles, deaths, mazes | **None found** |

## Method

```bash
python3 -I spikes/05-game-census/census.py .     # from the repo root; needs 7z (p7zip from brew)
```

- `Packet.001` is ARJ. `7z` (Homebrew p7zip) extracts all 1,145 files into `out/packet/` (gitignored). Treated as untrusted data: decoded and parsed, never run.
- `.ald`, `.cal` and other text resources are bytewise NOT (`resource.cpp`, `TextResourceParser::getLine`: `c = ~readByte()`, empty lines skipped). In the data, `§` (0xA7) stands for a space.
- Room parser mirrors `rooms.cpp` `enterRoom()`. Chapter 2 rooms have extra fields. The script tries both layouts and keeps the one that consumes the file exactly (56 of 57 exact; room 2, the map screen, has 2 unused trailing lines).
- Chapter membership: walk door destinations from each chapter's start room (`runCurrentChapter()`: 62, 14, 20, 21, 45, 58), plus literal `enterRoom(N)` calls tagged with that chapter. A door into the other file layout is a chapter hand-off (room 19's WELL leads to chapter 3's room 20).
- Flags: every `flags[N]` in `engines/drascula/*.cpp`, plus `toggleDoor(N, …)`, the `doors[]` gate table, `talkSequences` `kSetFlag`/`kClearFlag`, and `roomPreUpdates`/`roomUpdates` in `staticdata.h`. Chapter from the nearest enclosing `currentChapter == N` test, else the function name (`animation_X_<chapter>`), else the room the `room_N`/`update_N` handler belongs to, else a hand-read override (6 helper functions).
- Text: `devtools/create_drascula/staticdata.h`, block 0 of each `[NUM_LANGS]` table. Block 0 is English: `kEnglish = 0` in `drascula.h`, and `_text[1]` reads "THAT'S THE SECOND BIGGEST DOOR I'VE SEEN IN MY LIFE" (block 1 is Spanish). Every table's entry count matches its `NUM_*` constant.

Outputs: `census.json` (rooms with every hotspot, exit graph, door gates, items per chapter, every flag event with file and line, text tables, animations) and `out/summary.md` (the full tables, regenerated each run; copied below).

## Chapters at a glance

| Ch | Rooms | Things | Exits | Flags touched | Items held or found | Cutscenes |
|---|---|---|---|---|---|---|
| 1 | 62, 63 (inn) | 10 | 4 | 5 | 1 (phone) | 4 |
| 2 | 1–10, 12, 14–19 (village, inn, church, cemetery) | 58 | 36 | 41 | 17 | 21 |
| 3 | 13, 20 (cave) | 1 | 3 | 4 | 7 (start inventory) | 2 |
| 4 | 21–24, 26–31, 34–44 (castle) | 55 | 40 | 29 | 17 | 6 |
| 5 | 45, 49–57 (towers, lab) | 22 | 18 | 15 | 13 | 5 |
| 6 | 58–61, 102 (inn again, pendulum) | 17 | 6 | 12 | 4 | 5 |

Chapters 2 and 4 are most of the game: 38 of 57 rooms, 70 of 106 (chapter, flag) pairs, 27 of 43 cutscenes.

## Exit graph

```
ch1  62->63  63->62
ch2  1->2,3  2->1,3,4,17  3->1,2,5  4->2,10  5->3,6  6->5,7  7->6,19  8->10,12  9->10
     10->4,9,12  12->8,10,14  14->12,15,16  15->14  16->14  17->2,18  18->17  19->7,20(ch3)
ch3  13->20  20->13,20
ch4  21->22,23  22->21  23->21,24  24->23,26,27  26->24  27->24,28,29,31,34  28->27  29->27,30
     30->29  31->27  34->27,35,36  35->34  36->34,37  37..43 a straight corridor  43->44  44->34
ch5  45->49,50,51,52  49->45  50->45,53  51->45,54  52->45,55  53->50  54->51  55->52  56<->57 (reached by cutscene)
ch6  58->59  59->58,60  60->59,61  61->60  102 (pendulum, reached by cutscene, no exits)
```

Room 2 (chapter 2) is a map screen: its four hotspots are exits named CHURCH, VILLAGE, CEMENTERY, HUT. Room 10 is the same idea: SUBURBS, LODGING, BLIND-ALLEY.

## Names

- Non-door names repeat a lot: DOOR x9 (non-exit doors), WINDOW x7, POSTER x7, BIN, TRUNK, AJO, BOX x4. Several objects have 2–4 hotspots under one number (4 x AJO in room 18, 4 x DOOR in room 27, 2 x BALCONY), so a room list should de-duplicate by object number.
- **Exit names are never shown to a sighted player.** `checkObjects()` only names hotspots with `isDoor == 0`. The door names in the data are internal and half Spanish: DOOR x48, SALIDA x14, PUERTA x13, P x6, ESCALERA(S) x4, CAMINO, HABITACIONES, ARBOLITO, PASADIZO. We have to write every exit label ourselves (107 hotspots, 103 edges), and the rooms have no names either (57 to write).
- **Some visible names are Spanish or misspelt in the English release** and would be read out as is: LAPIDA (room 3), AJO (room 18), CHIMENEA (room 31), GRILLETES (room 102), CEMENTERY, TAPESTRIE, GRAFFITTI, RETABLUM, CYPRES, DRASKIS, lower-case "door" (rooms 1, 4). A small rename table fixes this.
- 6 hotspots start hidden and appear later (CRUCIFIX room 6, BRANCH 22, DRASKIS 23, LUBRICANT 35, TOWER-4 45, a DOOR in 20). Many more toggle by flag in `updateVisible()`.

## Items

The game has no inventory names. `iconName[]` only holds the 6 verbs (`interface.cpp showMenu()`); items are icons. Names below come from the engine enums, the hotspot the item is picked up from, and its "look" line (room 200 rows in `roomActions`). The full per-chapter list is in the tables below.

- **Chapters 1–3** (one id set): money, leaves, crucifix, spike, earplugs, book ("Sleeping Beauty"), bubble gum, sickle, tissues, cigarettes, candle, two coins, one coin, reefer, handbag, ear with earplug, phone. Id 21 (`kItemKey`) is defined but never used.
- **Chapter 4** (new id set): key, "draskis" (fang-shaped chips), crucifix, Elvis wig, axe, flour, deodorant (from LUBRICANT), stake, brain, cloak, a second key, branch, rope, reefer, rope tied to branch (combined in the inventory), coin, phone.
- **Chapter 5** reuses ids 8, 12, 16 for bone, screws and plug. **Chapter 6** gives 20 and 21 new meanings (20 is picked up in the pendulum room; 21 is "A TRANSILVANIAN SCOTCH ON THE ROCKS").
- Several look lines are jokes, not descriptions ("IT'S MARGARET'S THATCHERS DEODORANT"), so they can't stand in for a name.

## Flags and hints

Progress-aware hints can key on **(chapter, flags, inventory, room)**:

- All 50 flags are reset at each chapter start, so flag N means different things in different chapters (each of flags 0–14 is used in 3 to 6 chapters). Hints have to be keyed per chapter.
- Most visible progress is flag-driven: `updateVisible()` (hotspots appearing and vanishing), `updateDoor()` and the `doors[]` table (18 doors in chapters 2 and 4 that only work while their flag is 1), `toggleDoor()` (open and shut is a flag, 43 call sites), and the `roomPreUpdates` table.
- Not everything is in flags. Inventory is the other half of the state (who holds what). A few things are set directly: `visible[3] = 1` in room 53, `objName` renames, Drascula's TV flicker (`flag_tv`), and which conversation choices have been asked (local to `converse()`, lost when the menu closes).
- Chapter 1 sets only 4 flags; its progress is mostly conversation sequences (`talkSequences`).

## Text and voice

| Bucket | Strings | Characters |
|---|---|---|
| Character dialogue (other characters + the hero's lines in cutscenes) | 408 | 22,636 |
| Look/action responses | 231 | 8,984 |
| Conversation choices | 54 | 2,311 |
| Hero lines not found by literal index (probably computed indices) | 49 | 1,648 |
| Intro narration (`_texthis`) | 4 | 478 |
| System and menu (`_textsys`, `_textverbs`, `_textmisc`) | 17 | 186 |
| **Total** | **763** | **36,243** |

The split of the hero's `_text` lines is by where the index is used: `roomActions` and `rooms.cpp` count as responses; `animation.cpp`, `talkSequences` and phone calls count as dialogue; `.cal` voice numbers count as choices. Approximate: some `rooms.cpp` handlers play short conversations. To pre-record all English speech, budget about 36,000 characters, plus our own text (room names, exit labels, item names, audio description).

## Cutscenes

43 functions in `animation.cpp`; 181 `talk*()` calls inside them. Another 5 `animate("*.bin")` calls and a long phone call (room 59) live in `rooms.cpp`. The packet holds 33 `.BIN` animations.

19 cutscenes have **no dialogue**, so a blind player gets music and sound effects only: `animation_3_1`, `_2_2`, `_7_2`, `_11_2`, `_13_2`, `_14_2`, `_25_2`, `_34_2`, `_35_2`, `_2_3`, `_6_3`, `_castle` (chapter 4 intro), `_8_4`, `_5_5`, `_12_5`, `_12_5_frankenstein`, `_5_6`, `_6_6`, `_19_6`. These are the audio-description list.

## Blockers and risks for blind play

No hard blockers found: no timers, no death or game-over state in the engine code, no maze, no colour puzzle. `getTime()` is only used for animation frame pacing and walking. The pendulum (room 102) looks like a timed threat but the code is a plain frame loop. Things the layer has to handle:

1. **Exits and rooms have no names a player ever sees.** We write ~57 room names and ~103 exit labels.
2. **Inventory items have no names.** We write ~39.
3. **Spanish and misspelt hotspot names** in the English data (above). A rename table.
4. **"Use X on myself"** is a real target: the hero is object 50, hit by hovering his sprite, not a room hotspot. In chapter 4, room 26, using the wig, draskis, flour or cloak on yourself is a puzzle step (`animation_5_4`, the disguise); elsewhere it gets joke replies. The command layer needs a "me" target.
5. **Combining items in the inventory** (chapter 4 branch + rope). Needs "use X with Y" on the inventory screen.
6. **Doors that must be opened first** (43 `toggleDoor` call sites, chapters 2 and 4) and doors that only work once visible (chapters 3 and 5). "Go to X" has to open then walk, or say it's shut.
7. **Already-asked conversation choices are shown by colour only** (white vs green in `converse.cpp`). ScummVM's TTS reads the text, not the state.
8. **Walking triggers events**: room 13 runs the vampire cutscene when the hero passes x > 55; room 60 places Drascula by position. Fine for "go to" commands, but narration should expect it.
9. **Visual-only cues**: rooms 4 and 6 darken and brighten by position (no gameplay effect); room 55's detector door bounces you back with only an animation and a sound.
10. **Chapter 4 corridor** (rooms 36–43): 8 empty rooms in a row. Not a maze, but 8 identical "you're in a corridor" turns. Worth a "walk to the end" shortcut.

## Caveats

- Static reading only. Chapter attribution is a heuristic (enclosing `if` tests); 3 call sites needed the function-name fallback and 6 helper functions a hand-read override. A run through the game with the spike 02 dump would confirm.
- "Items held or found" counts ids with a pick-up or add in that chapter's code, plus the start inventory. Chapter 3 has "look" lines for all 17 chapter 1–3 ids, but you only hold the 7 you start with.
- Text classification of the hero's lines is approximate (see above). Totals are exact.
- Rooms 11, 25, 32, 33 and 46–48 have no files; numbers aren't contiguous.
- `census.json` includes the game's English text (from GPL source) and room data (freeware, redistributable with the readme).

## Full tables (snapshot of out/summary.md, 6 Nov 2026)

### Rooms per chapter

| Ch | Rooms | Hotspots | Non-door hotspots | Door hotspots | Unique object numbers |
|---|---|---|---|---|---|
| 1 | 2 | 14 | 10 | 4 | 14 |
| 2 | 17 | 94 | 58 | 36 | 89 |
| 3 | 2 | 4 | 1 | 3 | 4 |
| 4 | 21 | 95 | 55 | 40 | 82 |
| 5 | 10 | 40 | 22 | 18 | 39 |
| 6 | 5 | 23 | 17 | 6 | 23 |
| all | 57 | 270 | 163 | 107 | 251 |

#### Chapter 1 (start room 62)

| Room | Objects | Doors | Exits to | Object names (door names in brackets) |
|---|---|---|---|---|
| 62 | 7 | 3 | 63 | BARTENDER, DRUNKARD, PIANIST, SKULL, BIN, POSTER, BLACKBOARD, [DOOR], [DOOR], [DOOR] |
| 63 | 3 | 1 | 62 | [DOOR], MACHINE, CURTAIN, PAPERS |

#### Chapter 2 (start room 14)

| Room | Objects | Doors | Exits to | Object names (door names in brackets) |
|---|---|---|---|---|
| 1 | 3 | 2 | 2, 3 | door, WINDOW, WINDOW, [SALIDA], [SALIDA] |
| 2 | 0 | 4 | 1, 3, 4, 17 | [CHURCH], [VILLAGE], [CEMENTERY], [HUT] |
| 3 | 8 | 3 | 1, 2, 5 | [SALIDA], [CAMINO], TOMB, LAPIDA, TOMBSTONE, TOMBSTONE, PANTHEON, [SALIDA], PIKE, PLANT, BUGS |
| 4 | 5 | 2 | 2, 10 | [SALIDA], [SALIDA], BARREL, CASTLE, FOREST, POSTER, door |
| 5 | 2 | 2 | 3, 6 | [SALIDA], [WINDOW], WINDOW, MOON |
| 6 | 5 | 2 | 5, 7 | [WINDOW], [DOOR], DRAWER, CLOSET, CRUCIFIX (hidden), CANDELABRUM, STATUE |
| 7 | 2 | 2 | 6, 19 | [DOOR], [DOOR], RETABLUM, CANDLE |
| 8 | 1 | 2 | 10, 12 | [SALIDA], BIN, [SALIDA] |
| 9 | 2 | 1 | 10 | [SALIDA], DOOR, BLIND-MAN |
| 10 | 0 | 3 | 4, 9, 12 | [SUBURBS], [LODGING], [BLIND-ALLEY] |
| 12 | 3 | 3 | 8, 10, 14 | [SALIDA], BALCONY, BALCONY, LAMP, [DOOR], [ARC] |
| 14 | 9 | 3 | 12, 15, 16 | [ESCALERA], [HABITACIONES], [DOOR], BARTENDER, PIANIST, DRUNKARD, PIANO, POSTER, SKULL, POSTER, BLACKBOARD, BIN |
| 15 | 3 | 1 | 14 | [ESCALERAS], MACHINE, PAPERS, CURTAIN |
| 16 | 5 | 1 | 14 | [DOOR], TRUNK, BED, CLOSET, WINDOW, MIRROR |
| 17 | 0 | 2 | 2, 18 | [SALIDA], [DOOR] |
| 18 | 9 | 1 | 17 | [DOOR], GRAFFITTI, BOOK, DIPLOMA, DIPLOMA, AJO, AJO, AJO, AJO, V.BRAUN |
| 19 | 1 | 2 | 7, 20 | [DOOR], [WELL], CYPRES |

#### Chapter 3 (start room 20)

| Room | Objects | Doors | Exits to | Object names (door names in brackets) |
|---|---|---|---|---|
| 13 | 1 | 1 | 20 | [DOOR], VAMPIRE |
| 20 | 0 | 2 | 13, 20 | [DOOR], [DOOR] |

#### Chapter 4 (start room 21)

| Room | Objects | Doors | Exits to | Object names (door names in brackets) |
|---|---|---|---|---|
| 21 | 3 | 2 | 22, 23 | [ARBOLITO], [DOOR], ROPE, TOWER, DOOR |
| 22 | 3 | 1 | 21 | [SALIDA], BRANCH (hidden), MAGPIE, KEY |
| 23 | 5 | 2 | 21, 24 | [DOOR], [DOOR], DRASKIS (hidden), SPEAKER, SPEAKER, TABLE, PICTURE |
| 24 | 2 | 3 | 23, 26, 27 | [DOOR], [DOOR], [ESCALERAS], TAPESTRIE, TAPESTRIE |
| 26 | 8 | 1 | 24 | [DOOR], WIG, IGOR, CALENDAR, WINDOW, SHELF, DRAWERS, BOOK, PORTRAIT |
| 27 | 6 | 5 | 24, 28, 29, 31, 34 | [ESCALERAS], [DOOR], [DOOR], [DOOR], [DOOR], WEST-WING, PICTURE, DOOR, DOOR, DOOR, DOOR |
| 28 | 9 | 1 | 27 | [SALIDA], BOX, BOX, DRAWER, TRUNK, BARREL, BOX, BOX, DRAWER, TRUNK |
| 29 | 6 | 2 | 27, 30 | [DOOR], [DOOR], OVEN, SHIELD, SAUCEPAN, BIN, DRAWERS, SAUCEPAN |
| 30 | 4 | 1 | 29 | [DOOR], CLOSET, FRIDGE, STILL-LIFE, THINGS |
| 31 | 4 | 1 | 27 | [DOOR], AXE, T.V., WINDOW, CHIMENEA |
| 34 | 1 | 3 | 27, 35, 36 | [DOOR], [CLOSET], [SHELF], TORCH |
| 35 | 3 | 1 | 34 | [PASADIZO], BRAINS, CLOAK, LUBRICANT (hidden) |
| 36 | 0 | 2 | 34, 37 | [PUERTA], [PUERTA] |
| 37 | 0 | 2 | 36, 38 | [P], [P] |
| 38 | 0 | 2 | 37, 39 | [P], [P] |
| 39 | 0 | 2 | 38, 40 | [P], [P] |
| 40 | 0 | 2 | 39, 41 | [PUERTA], [PUERTA] |
| 41 | 0 | 2 | 40, 42 | [PUERTA], [PUERTA] |
| 42 | 0 | 2 | 41, 43 | [DOOR], [DOOR] |
| 43 | 0 | 2 | 42, 44 | [PUERTA], [PUERTA] |
| 44 | 1 | 1 | 34 | [DOOR], POSTER |

#### Chapter 5 (start room 45)

| Room | Objects | Doors | Exits to | Object names (door names in brackets) |
|---|---|---|---|---|
| 45 | 0 | 4 | 49, 50, 51, 52 | [TOWER-1], [TOWER-2], [TOWER-3], [TOWER-4] |
| 49 | 5 | 2 | 45 | [DOOR], [DOOR], WEREWOLF, POSTER, DESK, DIPLOMA, WINDOW |
| 50 | 0 | 3 | 45, 53 | [DOOR], [DOOR], [DOOR] |
| 51 | 0 | 2 | 45, 54 | [PUERTA], [PUERTA] |
| 52 | 0 | 2 | 45, 55 | [PUERTA], [PUERTA] |
| 53 | 5 | 1 | 50 | [PUERTA], FRUSKYNSTEIN, WALL-PLUG, PLUG, ON/OFF, INDIFIBULATOR |
| 54 | 5 | 1 | 51 | [DOOR], DOOR, LOCK, BONE, SKELETON, DOOR |
| 55 | 4 | 1 | 52 | [DOOR], SCREWS, CAMERA, DETECTOR, DOOR |
| 56 | 3 | 1 | 57 | [DOOR], COFFIN, CLOCK, TABLE |
| 57 | 0 | 1 | 56 | [DOOR] |

#### Chapter 6 (start room 58)

| Room | Objects | Doors | Exits to | Object names (door names in brackets) |
|---|---|---|---|---|
| 58 | 1 | 1 | 59 | TORCH, [DOOR] |
| 59 | 3 | 2 | 58, 60 | B.J., [CLOSET], TRUNK, MIRROR, [DOOR] |
| 60 | 6 | 2 | 59, 61 | BARTENDER, DRASCULA, [DOOR], [DOOR], PIANO, SKULL, POSTER, FANS |
| 61 | 3 | 1 | 60 | PAPERS, CURTAIN, MACHINE, [DOOR] |
| 102 | 4 | 0 | - | PENDULUM, HACKER, HACKER, GRILLETES |

Unique non-door names: 97 (from 163 hotspots). Unique door names: 26 (from 107 door hotspots).

Repeated non-door names: DOOR x9, WINDOW x7, POSTER x7, BIN x4, TRUNK x4, AJO x4, BOX x4, BARTENDER x3, SKULL x3, MACHINE x3, PAPERS x3, CURTAIN x3, CLOSET x3, DIPLOMA x3, DRAWER x3, door x2, HACKER x2, BALCONY x2, PIANIST x2, DRUNKARD x2, PIANO x2, BLACKBOARD x2, MIRROR x2, BOOK x2, SPEAKER x2, TABLE x2, PICTURE x2, TAPESTRIE x2, DRAWERS x2, BARREL x2, SAUCEPAN x2, TOMBSTONE x2, TORCH x2

Door names: DOOR x48, SALIDA x14, PUERTA x13, P x6, ESCALERAS x3, CLOSET x2, WINDOW x2, SUBURBS x1, LODGING x1, BLIND-ALLEY x1, ARC x1, ESCALERA x1, HABITACIONES x1, WELL x1, CHURCH x1, VILLAGE x1, CEMENTERY x1, HUT x1, ARBOLITO x1, CAMINO x1, SHELF x1, PASADIZO x1, TOWER-1 x1, TOWER-2 x1, TOWER-3 x1, TOWER-4 x1

### Items per chapter

#### Chapter 1: 1 item ids seen, 1 acquired in this chapter (incl. start inventory)

| Id | Enum | Acquired here | Picked up from | Look text |
|---|---|---|---|---|
| 28 | kItemPhone | yes |  | THIS IS THE MOBILE PHONE I GOT LAST CHRISTMAS |

#### Chapter 2: 17 item ids seen, 17 acquired in this chapter (incl. start inventory)

| Id | Enum | Acquired here | Picked up from | Look text |
|---|---|---|---|---|
| 7 | kItemMoney | yes |  | IT'S A LOT OF MONEY THAT CAN'T BE MISSING IN ANY VALUABLE ADVENTURE |
| 8 | kItemLeaves | yes | PLANT (room 3) | THOSE ARE STRANGE LEAVES. THEY MUST HAVE BROUGHT THEM FROM SOUTH AMERICA OR AROUND THERE |
| 9 | kItemCross | yes | CRUCIFIX (room 6) | THAT'S A BEAUTIFUL WOODEN CRUCIFIX. THE ICON DOESN'T REALLY SHOW THE FULL EXTENT OF IT'S BEAUTY |
| 10 | kItemSpike | yes | PIKE (room 3) | IT'S A QUITE CONVENTIONAL SPIKE |
| 11 | kItemEarplugs | yes |  | THEY ARE CUTE, THOUGH THEY ARE COVERED WITH A LITTLE BIT OF WAX |
| 12 | kItemBook | yes | BOOK (room 18) | "SLEEPING BEAUTY" FROM TCHAIKOVSKY, OR CHOIFRUSKY, OR WHATEVER IT IS |
| 13 | kItemBubbleGum | yes | BARREL (room 4) | VERY TEMPTING |
| 14 | kItemSickle | yes | BLIND-MAN (room 9) | THAT'S A VERY NICE SICKLE. I WONDER WHERE THE HAMMER IS |
| 15 | kItemTissues | yes | BIN (room 8) | LOOK! A PACKET OF KLEENEX, AND ONE'S STILL UNUSED |
| 16 | kItemCigarettes | yes | MACHINE (room 15) | TOBACCO MANUFACTURERS WARN ABOUT HEALTH BEING SERIOUSLY DAMAGED BY SANITARY AUTHORITIES |
| 17 | kItemCandle | yes | CANDLE (room 7) | AN ABSOLUTELY NORMAL CANDLE, INCLUDING WAX AND EVERYTHING |
| 18 | kItemTwoCoins | yes |  | THESE TWO SHINY COINS REALLY GLITTER! |
| 19 | kItemOneCoin | yes | MACHINE (room 15) | THIS SHINY COIN REALLY GLITTERS! |
| 20 | kItemReefer | yes |  |  |
| 22 | kItemHandbag | yes | TRUNK (room 16) |  |
| 23 | kItemEarWithEarPlug | yes |  | THEY ARE CUTE, THOUGH THEY ARE COVERED WITH A LITTLE BIT OF WAX |
| 28 | kItemPhone | yes |  | THIS IS THE MOBILE PHONE I GOT LAST CHRISTMAS |

#### Chapter 3: 17 item ids seen, 7 acquired in this chapter (incl. start inventory)

| Id | Enum | Acquired here | Picked up from | Look text |
|---|---|---|---|---|
| 7 | kItemMoney |  |  | IT'S A LOT OF MONEY THAT CAN'T BE MISSING IN ANY VALUABLE ADVENTURE |
| 8 | kItemLeaves |  |  | THOSE ARE STRANGE LEAVES. THEY MUST HAVE BROUGHT THEM FROM SOUTH AMERICA OR AROUND THERE |
| 9 | kItemCross | yes |  | THAT'S A BEAUTIFUL WOODEN CRUCIFIX. THE ICON DOESN'T REALLY SHOW THE FULL EXTENT OF IT'S BEAUTY |
| 10 | kItemSpike |  |  | IT'S A QUITE CONVENTIONAL SPIKE |
| 11 | kItemEarplugs | yes |  | THEY ARE CUTE, THOUGH THEY ARE COVERED WITH A LITTLE BIT OF WAX |
| 12 | kItemBook |  |  | "SLEEPING BEAUTY" FROM TCHAIKOVSKY, OR CHOIFRUSKY, OR WHATEVER IT IS |
| 13 | kItemBubbleGum |  |  | VERY TEMPTING |
| 14 | kItemSickle | yes |  | THAT'S A VERY NICE SICKLE. I WONDER WHERE THE HAMMER IS |
| 15 | kItemTissues |  |  | LOOK! A PACKET OF KLEENEX, AND ONE'S STILL UNUSED |
| 16 | kItemCigarettes |  |  | TOBACCO MANUFACTURERS WARN ABOUT HEALTH BEING SERIOUSLY DAMAGED BY SANITARY AUTHORITIES |
| 17 | kItemCandle |  |  | AN ABSOLUTELY NORMAL CANDLE, INCLUDING WAX AND EVERYTHING |
| 18 | kItemTwoCoins |  |  | THESE TWO SHINY COINS REALLY GLITTER! |
| 19 | kItemOneCoin | yes |  | THIS SHINY COIN REALLY GLITTERS! |
| 20 | kItemReefer | yes |  | WITH THIS I WILL BE IMMUNE AGAINST VAMPIRE BITES |
| 22 | kItemHandbag | yes |  | IT LOOKS LIKE MY GRANDMOTHER'S HANDBAG  |
| 23 | kItemEarWithEarPlug |  |  | THEY ARE CUTE, THOUGH THEY ARE COVERED WITH A LITTLE BIT OF WAX |
| 28 | kItemPhone | yes |  | THIS IS THE MOBILE PHONE I GOT LAST CHRISTMAS |

#### Chapter 4: 17 item ids seen, 17 acquired in this chapter (incl. start inventory)

| Id | Enum | Acquired here | Picked up from | Look text |
|---|---|---|---|---|
| 7 | kItemKey2 | yes | KEY (room 22) | A COMPLETELY NORMAL KEY |
| 8 |  | yes | DRASKIS (room 23) | HEY, THEY'RE FANG-LIKE FRENCH FRIES! I LOVE IT! |
| 9 | kItemCross2 | yes |  |  |
| 10 |  | yes | WIG (room 26) | THIS IS THE ONE AND ONLY WIG THAT ELVIS USED WHEN HE WENT BALD |
| 11 |  | yes | AXE (room 31) | THAT'S  A GREAT AXE, IT'S A SHAME THERE IS NO VAMPIRE'S HEAD AROUND HERE, HUH? |
| 12 |  | yes | CLOSET (room 30) | IT'S FLOUR, BUT DON'T ASK ME ANY COMMERCIAL NAMES |
| 13 |  | yes | LUBRICANT (room 35) | IT'S MARGARET'S THATCHERS DEODORANT...HA, HA, HA...!! |
| 14 |  | yes | CLOSET (room 34) | YOU FAITHFUL SHARP-POINTED STAKE, FROM THE MOST NOBLE TRANSILVANIAN OAK TREE |
| 15 |  | yes | BRAINS (room 35) | IT'S QUITE A NICE BRAIN |
| 16 |  | yes | CLOAK (room 35) | THAT'S A PRETTY CUTE CLOAK |
| 17 |  | yes |  | A COMPLETELY NORMAL KEY |
| 18 |  | yes | BRANCH (room 22) | JUST LIKE ALL THE BRANCHES FROM ANY TREE IN THE WORLD, THERE IS NOTHING SPECIAL. |
| 19 | kItemRope2 | yes | ROPE (room 21) |  |
| 20 | kItemReefer2 | yes |  | WITH THIS I WILL BE IMMUNE AGAINST VAMPIRE BITES |
| 21 |  | yes |  | A ROPE TIED TO A BRANCH OR THE OTHER WAY AROUND, HOWEVER YOU WANT TO PUT IT... |
| 22 | kItemOneCoin2 | yes |  | THIS SHINY COIN REALLY GLITTERS! |
| 28 | kItemPhone2 | yes |  | THIS IS THE MOBILE PHONE I GOT LAST CHRISTMAS |

#### Chapter 5: 13 item ids seen, 13 acquired in this chapter (incl. start inventory)

| Id | Enum | Acquired here | Picked up from | Look text |
|---|---|---|---|---|
| 7 | kItemKey2 | yes |  | A COMPLETELY NORMAL KEY |
| 8 |  | yes | BONE (room 54) | IT IS VERY STIFF, JUST LIKE MY BOSS |
| 9 | kItemCross2 | yes |  |  |
| 10 |  | yes |  |  |
| 11 |  | yes |  | THAT'S  A GREAT AXE, IT'S A SHAME THERE IS NO VAMPIRE'S HEAD AROUND HERE, HUH? |
| 12 |  | yes | SCREWS (room 55) |  |
| 13 |  | yes |  | IT'S MARGARET'S THATCHERS DEODORANT...HA, HA, HA...!! |
| 14 |  | yes |  | A VERY SHARP STAKE |
| 15 |  | yes |  | IT'S QUITE A NICE BRAIN |
| 16 |  | yes | PLUG (room 53) |  |
| 17 |  | yes |  | A COMPLETELY NORMAL KEY |
| 20 | kItemReefer2 | yes |  | WITH THIS I WILL BE IMMUNE AGAINST VAMPIRE BITES |
| 28 | kItemPhone2 | yes |  | THIS IS THE MOBILE PHONE I GOT LAST CHRISTMAS |

#### Chapter 6: 4 item ids seen, 4 acquired in this chapter (incl. start inventory)

| Id | Enum | Acquired here | Picked up from | Look text |
|---|---|---|---|---|
| 9 | kItemCross2 | yes |  |  |
| 20 | kItemReefer2 | yes | HACKER (room 102) | DAMN, I HAVE TO CUT MY NAILS! |
| 21 |  | yes |  | A TRANSILVANIAN SCOTCH ON THE ROCKS |
| 28 | kItemPhone2 | yes |  | THIS IS THE MOBILE PHONE I GOT LAST CHRISTMAS |

### Flags

Distinct flags touched per chapter: ch1: 5, ch2: 41, ch3: 4, ch4: 29, ch5: 15, ch6: 12

| Flag | Chapters | Set in (chapter: functions) | Reads |
|---|---|---|---|
| 0 | 1,2,3,4,5,6 | 1: talkSequence 3; 2: room_6; 3: animation_2_3; 4: room_21, room_23; 5: animation_1_5; 6: animation_1_6, animation_6_6 | 23 |
| 1 | 2,3,4,5,6 | 2: room_6; 3: animation_2_3, animation_6_3, runCurrentChapter; 4: room_23, room_24; 5: animation_12_5; 6: activatePendulum, animation_6_6, talk_pen | 16 |
| 2 | 2,3,4,5,6 | 2: room_6; 3: animation_6_3; 4: animation_5_4, room_24, room_26; 5: room_53; 6: animation_6_6 | 12 |
| 3 | 2,3,5,6 | 2: room_3; 3: animation_6_3; 5: room_53; 6: animation_5_6 | 6 |
| 4 | 2,4,5,6 | 2: animation_4_2; 4: room_29, room_30; 5: room_53 | 8 |
| 5 | 1,2,4,5,6 | 2: exitRoom; 4: room_27, room_31; 6: animation_9_6 | 15 |
| 6 | 4,5,6 | 4: room_27; 5: animation_5_5; 6: room_60 | 9 |
| 7 | 2,4,5,6 | 2: room_8; 4: animation_8_4; 5: talkSequence 4; 6: room_60 | 10 |
| 8 | 2,4,5,6 | 2: animation_5_2; 4: room_34; 5: room_55; 6: room_58 | 11 |
| 9 | 2,5,6 | 2: animation_4_2, animation_6_2; 5: room_53; 6: room_59 | 3 |
| 10 | 2,4,5,6 | 2: room_6; 4: room_21; 5: animation_14_5; 6: talkSequence 14 | 5 |
| 11 | 1,2,4,5,6 | 1: animation_4_1; 2: animation_12_2, animation_26_2, exitRoom; 4: room_23; 5: animation_14_5; 6: room_59 | 20 |
| 12 | 1,2,4,5 | 1: update_62_pre; 2: talkSequence 13, update_14_pre; 4: room_26; 5: room_54 | 13 |
| 13 | 1,2,4,5 | 1: talk_drunk; 2: talk_drunk; 4: room_31; 5: room_54 | 6 |
| 14 | 2,4,5 | 2: animation_20_2; 4: room_35; 5: room_54 | 9 |
| 15 | 2,4 | 2: animation_20_2, room_17; 4: room_35 | 4 |
| 16 | 2,4 | 2: room_12, runCurrentChapter; 4: room_30 | 3 |
| 17 | 2,4 | 2: room_16, runCurrentChapter; 4: room_35 | 5 |
| 18 | 2,4 | 2: animation_20_2, talkSequence 22; 4: animation_1_4, room_23, room_30, room_35 | 18 |
| 19 | 2,4 | 2: room_16, talk_trunk; 4: room_30 | 4 |
| 20 | 2,4 | 2: room_16; 4: animation_1_4 | 2 |
| 21 | 2,4 | 2: animation_20_2, animation_23_2, animation_24_2; 4: animation_1_4 | 3 |
| 22 | 2,4 | 2: animation_27_2; 4: room_30 | 8 |
| 23 | 2,4 | 2: checkAction; 4: room_27 | 7 |
| 24 | 2,4 | 2: animation_14_2, animation_20_2, animation_24_2, animation_25_2; 4: room_22 | 2 |
| 25 | 2,4 | 2: animation_23_2; 4: room_34 | 5 |
| 26 | 2,4 | 2: room_15; 4: room_22 | 11 |
| 27 | 2,4 | 2: room_15, runCurrentChapter; 4: room_22 | 5 |
| 28 | 2,4 | 2: room_18; 4: room_21 | 4 |
| 29 | 2,4 | 2: exitRoom, room_17, room_18; 4: animation_5_4, animation_7_4 | 7 |
| 30 | 2,4 | 2: animation_23_2; 4: animation_7_4, room_26 | 3 |
| 31 | 2 | 2: animation_23_2 | 1 |
| 32 | 2 | 2: animation_23_2 | 1 |
| 33 | 2 | 2: animation_4_2, talkSequence 29 | 4 |
| 34 | 2 | 2: room_4 | 6 |
| 35 | 2 | 2: room_7 | 7 |
| 36 | 2 | 2: talkSequence 31 | 3 |
| 37 | 2 | 2: animation_7_2 | 7 |
| 38 | 2 | 2: animation_7_2, room_15, room_4, room_7, room_8, talkSequence 31 | 4 |
| 39 | 2 | 2: animation_26_2 | 5 |
| 40 | 2 | 2: talkSequence 17 | 2 |
| 41 | 2 | 2: talkSequence 13 | 1 |

Never referenced: 42, 43, 44, 45, 46, 47, 48, 49

### Text volume (English block)

| Table | Speaker | Non-empty strings | Characters |
|---|---|---|---|
| _text | protagonist (John Hacker) | 446 | 17370 |
| _textd | Drascula (+ blind man from 68) | 64 | 4246 |
| _textb | drunk | 14 | 802 |
| _textbj | B.J. | 28 | 2249 |
| _texte | skeleton (talk_mus) | 23 | 1104 |
| _texti | Igor | 32 | 1654 |
| _textl | werewolf | 30 | 2014 |
| _textp | pianist | 19 | 558 |
| _textt | bartender | 24 | 1346 |
| _textvb | Von Braun | 62 | 4236 |
| _textsys | system prompts | 4 | 79 |
| _texthis | intro history narration | 4 | 478 |
| _textd1 | lip-sync codes (not text) | 11 | 1139 |
| _textverbs | verb names | 6 | 25 |
| _textmisc | misc labels | 7 | 82 |

| Bucket | Strings | Characters |
|---|---|---|
| character dialogue | 408 | 22636 |
| look/action responses | 231 | 8984 |
| conversation choices | 54 | 2311 |
| unreferenced (by literal index) | 49 | 1648 |
| system/menu | 17 | 186 |
| intro narration | 4 | 478 |

CAL conversation files: 13 files, 52 phrases, 2004 chars, 15 identical to a _text line

### Animations (animation.cpp)

Per chapter: ch1: 4, ch2: 21, ch3: 2, ch4: 6, ch5: 5, ch6: 5 (total 43)

| Function | Chapter | Lines | talk calls | animate() calls |
|---|---|---|---|---|
| animation_1_1 | 1 | 326 | 26 | 11 |
| animation_2_1 | 1 | 183 | 10 | 6 |
| animation_3_1 | 1 | 10 | 0 | 0 |
| animation_4_1 | 1 | 38 | 9 | 0 |
| animation_2_2 | 2 | 37 | 0 | 0 |
| animation_4_2 | 2 | 76 | 20 | 0 |
| animation_14_2 | 2 | 30 | 0 | 0 |
| animation_16_2 | 2 | 79 | 2 | 0 |
| animation_20_2 | 2 | 32 | 12 | 0 |
| animation_23_2 | 2 | 102 | 10 | 0 |
| animation_25_2 | 2 | 30 | 0 | 0 |
| animation_27_2 | 2 | 21 | 4 | 0 |
| animation_29_2 | 2 | 18 | 5 | 0 |
| animation_31_2 | 2 | 20 | 1 | 0 |
| animation_35_2 | 2 | 32 | 0 | 0 |
| animation_2_3 | 3 | 63 | 0 | 0 |
| animation_6_3 | 3 | 32 | 0 | 0 |
| animation_castle | 4 | 29 | 0 | 0 |
| animation_7_4 | 4 | 15 | 1 | 0 |
| animation_1_5 | 5 | 43 | 12 | 0 |
| animation_5_5 | 5 | 81 | 0 | 0 |
| animation_12_5 | 5 | 111 | 0 | 3 |
| animation_12_5_frankenstein | 5 | 32 | 0 | 0 |
| animation_14_5 | 5 | 25 | 2 | 0 |
| animation_1_6 | 6 | 81 | 25 | 1 |
| animation_5_6 | 6 | 21 | 0 | 1 |
| animation_6_6 | 6 | 26 | 0 | 2 |
| animation_9_6 | 6 | 78 | 12 | 2 |
| animation_19_6 | 6 | 17 | 0 | 0 |
| animation_12_2 | 2 | 32 | 2 | 0 |
| animation_26_2 | 2 | 60 | 6 | 0 |
| animation_11_2 | 2 | 10 | 0 | 0 |
| animation_13_2 | 2 | 14 | 0 | 0 |
| animation_24_2 | 2 | 51 | 2 | 0 |
| animation_34_2 | 2 | 29 | 0 | 0 |
| animation_36_2 | 2 | 17 | 6 | 0 |
| animation_7_2 | 2 | 58 | 0 | 0 |
| animation_5_2 | 2 | 38 | 1 | 0 |
| animation_6_2 | 2 | 43 | 3 | 0 |
| animation_1_4 | 4 | 58 | 7 | 0 |
| animation_5_4 | 4 | 30 | 2 | 1 |
| animation_6_4 | 4 | 27 | 1 | 0 |
| animation_8_4 | 4 | 19 | 0 | 0 |
