# Spike 04: items, doors, conversations and "what changed" (throwaway)

**Result, 6 Nov 2026: the core loop works.** With no mouse, a text command script played chapter 1 start to finish (tavern, back room, drunkard conversation, bartender, out the door, the cutscene skipped) and then the first real puzzle chain of chapter 2: go upstairs, open the trunk, find the handbag, open it in the inventory, go to the back room, put the two coins in the vending machine, push it, get the cigarettes. After every action one `A11Y_DIFF` line says what changed: room, objects, inventory, flags, and everything that was said.

The patch is `drascula-a11y.patch` (a `git diff` of `engines/drascula`, includes the spike 02 changes). It adds one new file, `engines/drascula/a11y.cpp`, plus small hooks in `drascula.cpp`, `converse.cpp` and `graphics.cpp`.

## How to run it

```bash
cd vendor/scummvm && git apply ../../spikes/04-items-doors/drascula-a11y.patch && make -j16 && cd ../..
printf 'inv\nlook 102\ntalk 53\nchoose 1\nchoose 4\nwalk 106\n' > /tmp/cmds.txt
spikes/04-items-doors/run.sh /tmp/cmds.txt 60            # opens a real window, kills it after 60 s
EXTRA=--save-slot=2 spikes/04-items-doors/run.sh /tmp/cmds.txt 60 spikes/04-items-doors/out/ch2   # start from a save
```

Commands can all go in one file. They are queued and run one at a time: the next starts only when the previous one has settled (walk finished, speech over, cutscene over). Lines starting `#` are ignored.

Saves made during the spike (gitignored): `out/ch2/drascula.001` (chapter 2 start, room 14), `.002` (handbag opened, room 16), `.003` (cigarettes, room 15).

## Command reference

| Command | Does |
|---|---|
| `look`/`take`/`open`/`close`/`talk`/`push <obj>` | Verb on a room object. Walks there, then the game's own `checkAction()` |
| `walk <obj>` | No verb: walk to an object, or go through a door (`exitRoom()`) |
| `use <item> <obj>` | Use an inventory item on a room object |
| `<verb> <item>`, `use <item> <item2>` | Target an inventory item (IDs 7–49): `open 22` opens the handbag on the inventory screen |
| `<verb> 50`, `use <item> 50` | Target yourself (the game's object 50) |
| `inv` | `A11Y_INV`: item IDs, names, and the game's own "look at it" line |
| `choices` / `choose <n>` | In a conversation: list the choices / pick 1–4 (4 always ends it) |
| `skip` | What Escape does: ends the current line or cutscene |
| `save <slot>` | Save the game; load with `--save-slot=<slot>` |
| `dump` | `A11Y {json}`: full room state (also printed on every room entry) |
| `verb <0-6>`, `click <obj>` | Low-level, from spike 02. `click` now acts on the object directly, no pixel hit test |

Output lines: `A11Y_DIFF {json}` after each action, `A11Y_CHOICES {json}` when a conversation opens and after each choice, `A11Y_INV`, `A11Y_TEXT` (every line of on-screen text), `A11Y_HOVER` (the name label by the cursor), `A11Y_SAY` (ScummVM's own TTS), `A11Y_CMD`, `A11Y_ERR`, `A11Y_SAVED`.

`A11Y_DIFF` fields: `cmd`; `chapter` and `room` as `[from, to]`, with the new room's `objects` (doors carry `toRoom`); in the same room, `appeared` / `disappeared` (from `visible[]`) and `doors`; `invAdded` / `invRemoved`; `flags` as `{"index": [from, to]}`; `said` (each line with its text colour); `changed`.

## How each part works

- **Use item on object.** On screen: right-click opens the inventory, clicking an item calls `removeObject()` (takes it out of its slot) then `chooseObject()` (it becomes the cursor: `takeObject = 1`, `pickedObject = item`), then clicking an object runs `verify2()` → `walkToPoint()` → `checkAction(obj)`. The command does the same calls: `selectVerb(kVerbNone)`, `removeObject(item)`, `pickObject(item)`, then the main loop runs the `verify2()` body for that exact object. When the action settles, a still-held item goes back into the inventory, as a right-click would, so the diff shows only what was gained or used up.
- **Inventory targets.** On the inventory screen a click on a slot ends in `checkAction(item)` with `_menuScreen` set (`checkMenuFlags()`). The command opens the screen the way a right-click does (loads the icon sheet, sets `_menuScreen`), calls `checkAction(item)`, and closes it again.
- **Doors.** `walk <door>` runs `exitRoom(slot)`, which walks there, plays any door animation and calls `enterRoom()`. Locked doors answer in text: door 105 says "I DON'T HAVE A ROOM YET" until you've talked to the bartender (flag 0).
- **Direct, not pixels.** Spike 02 clicked the centre of the hotspot. That breaks when the hero stands in front of an object (in chapter 2 the hero wins the hit test) or hotspots overlap. Now the command picks the object slot and the main loop runs the verify code for that slot. The mouse is still warped to the hotspot so hover speech stays right.
- **Conversations.** `converse()` runs its own loop, so the main loop doesn't see commands. A hook in that loop lists the four choices (text, whether used) and `choose n` sets the same state a click would: mouse inside that line's band, button down, release queued.
- **Skip.** Cutscenes and speech don't run the main loop either, but they all call `updateEvents()`. Every 250 ms that reads the command file; a `skip` at the front of the queue becomes the engine's `kActionSkip`.
- **Item names.** The game never names inventory items on screen. Names come from the engine's `InventoryItems` enums in `drascula.h` (two sets: chapters 1–3 and 4–6, the 4–6 set is partial), and the description from the game's own "look at item" table (pseudo-room 200 in `_roomActions`).

## Gotchas

- **Inventory slots 1–6 are the verbs.** `inventoryObjects[1..6] = 1..6` are the verb icons on the inventory screen. Real items are 7 and up. Spike 02's "inventory [1,2,3,4,5,6,28]" is really just the phone.
- **Some English object names are Spanish** in the freeware data: chapter 2's tavern has `ESCALERA` (stairs) and `HABITACIONES` (rooms), the back room `ESCALERAS`. A label override table will be needed.
- **Flag 12 flips on its own** on lots of actions (`look 103`, `use 28 50`, `talk 53`). Probably an animation or timing flag. Filter it out of what gets spoken.
- **The bartender's chapter 1 talk is long**: about 90 s of lines with no input. `skip` ends one line at a time.
- **`pgrep -f` in a wait loop matches itself** if the pattern appears in the loop's own command line. Wasted two background runs.
- Item-on-item (`use 18 19`) goes through the same path as the inventory screen but wasn't exercised: chapter 1–2 have no combinations this early.
- Still a real window, as in spike 02.

## Transcript excerpts

Full logs: `transcript-01-tavern.txt` (chapter 1 rooms 62 and 63, drunkard conversation, bartender), `transcript-02-leave-tavern.txt` (out the door, cutscene skipped, chapter 2), `transcript-03-ch2-handbag.txt`, `transcript-04-ch2-vending-machine.txt` (also the error cases).

```
A11Y_CMD talk 53
A11Y_CHOICES {"choices":[{"n":1,"text":"HI BOSS, HOW ARE YOU?","used":false},{"n":2,"text":"AND HOW IS THE FAMILY?","used":false},...,{"n":4,"text":"I'D BETTER NOT SAY ANYTHING.","used":false,"ends":true}]}
A11Y_CMD choose 2
A11Y_DIFF {"cmd":"choose 2","said":[{"color":"yellow","text":"AND HOW IS THE FAMILY?"},{"color":"darkgreen","text":"THEY ARE ALL DEAD, THANKS.  HIC...!"}],"changed":false}

A11Y_CMD walk 105
A11Y_DIFF {"cmd":"walk 105","said":[{"color":"yellow","text":"I DON'T HAVE A ROOM YET"}],"changed":false}
A11Y_CMD talk 52
A11Y_DIFF {"cmd":"talk 52","flags":{"0":[0,1]},"said":[{"color":"yellow","text":"YOU, BARTENDER...!!"},{"color":"maroon","text":"WHAT HAPPENED? WHAT'S THE MATTER?"},...]}
A11Y_CMD walk 105
A11Y_CMD skip
A11Y_DIFF {"cmd":"walk 105","chapter":[1,2],"room":[62,14],"objects":[{"num":159,"name":"ESCALERA","toRoom":12},{"num":162,"name":"HABITACIONES","toRoom":16},{"num":171,"name":"DOOR","toRoom":15},{"num":52,"name":"BARTENDER"},...],...}

A11Y_CMD walk 162
A11Y_DIFF {"cmd":"walk 162","room":[14,16],"objects":[{"num":163,"name":"DOOR","toRoom":14},{"num":183,"name":"TRUNK"},{"num":184,"name":"BED"},...]}
A11Y_CMD open 183
A11Y_DIFF {"cmd":"open 183","invAdded":[{"id":22,"name":"handbag"}],"flags":{"19":[0,1],"20":[0,1]},"said":[{"color":"yellow","text":"I'VE FOUND B.J.'S HANDBAG!"}],"changed":true}
A11Y_CMD open 22
A11Y_DIFF {"cmd":"open 22","invAdded":[{"id":7,"name":"money"},{"id":18,"name":"two coins"}],"flags":{"23":[0,1]},"said":[{"color":"yellow","text":"THERE IS A ONE THOUSAND BILL AND A COUPLE OF COINS"}],"changed":true}

A11Y_CMD use 18 188
A11Y_DIFF {"cmd":"use 18 188","invAdded":[{"id":19,"name":"one coin"}],"invRemoved":[{"id":18,"name":"two coins"}],"flags":{"27":[1,0]},"said":[{"color":"yellow","text":"THIS IS A TRICK! NOTHING CAME OUT!"}],"changed":true}
A11Y_CMD push 188
A11Y_DIFF {"cmd":"push 188","invAdded":[{"id":16,"name":"cigarettes"}],"flags":{"26":[0,1],"27":[0,1]},"said":[{"color":"yellow","text":"AT LAST!"}],"changed":true}
```

From a run whose log was overwritten (chapter 1, inventory and self targets):

```
A11Y_CMD look 28    -> said "THIS IS THE MOBILE PHONE I GOT LAST CHRISTMAS"
A11Y_CMD talk 28    -> said "HI THERE"
A11Y_CMD look 50    -> said "JESUS, AREN'T I JUST REALLY COOL MAN...!"
A11Y_CMD use 28 50  -> said "WHY?"
```

## Still open

- Speaker names instead of text colours (yellow is the hero; the others vary by character). The `talk_*` functions know who is speaking.
- Hiding flag noise, and mapping flags to progress for the ghost's hints.
- Room 63's machine and chapter 2's other characters: not tried.
- The web build (spike 03) needs this patch applied and the `skip` poll checked there.
