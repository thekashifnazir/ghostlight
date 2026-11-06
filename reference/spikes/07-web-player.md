# Spike 07: an accessible web player (throwaway)

**Result, 6 Nov 2026: the interaction model works end to end in headless Chrome, 34 of 34 checks pass.** A plain HTML page (no framework, no build step) loads the ScummVM web build with the spike 04 command layer, reads every `A11Y` line, and says what happened in a polite live region. You play by typing plain words ("look at the bartender", "door", "talk to the drunkard", "1", "bye") or by arrowing through a list of things and picking an action. The canvas is `aria-hidden`; nothing depends on it. axe-core finds no violations on the start screen, in the game, or with the action menu open.

**Not tested with a real screen reader.** Everything below was checked with Playwright and axe, not with VoiceOver, NVDA or JAWS, and not by a blind player. See "Screen-reader caveats".

![start screen](screenshot-1-gate.png) ![room 62](screenshot-2-room62.png) ![action menu](screenshot-3-menu.png)

## How to run it

```bash
# 1. Web build with the spike 04 patch (vendor/scummvm-web has no commits, so reset the engine from the native tree's git)
cd vendor/scummvm-web
rm -rf engines/drascula && git -C ../scummvm archive ad351d1e engines/drascula | tar -x -C .
git apply ../../spikes/04-items-doors/drascula-a11y.patch
source dists/emscripten/emsdk-4.0.10/emsdk_env.sh
emmake make -j16 && emmake make dist-emscripten        # already configured with --enable-ogg --enable-vorbis (spike 03)
cd ../..

# 2. Serve the page and the build from one origin (the engine fetches /data by absolute path)
node spikes/07-web-player/serve.mjs 8770               # then open http://127.0.0.1:8770/

# 3. Headless test (installs into the gitignored out/ folder)
npm i --prefix spikes/07-web-player/out playwright-core axe-core
node spikes/07-web-player/test.mjs                     # needs Google Chrome; add --headed for a window
```

The rebuild took 10 s (only `engines/drascula` and the link). Configure from spike 03 already had Ogg and Vorbis on (`USE_VORBIS` in `config.h`), so no reconfigure. The wasm has every spike 04 output tag (`A11Y_DIFF`, `A11Y_INV`, `A11Y_CHOICES`, `A11Y_ERR`...).

## Files

| File | What |
|---|---|
| `index.html` | The page: start gate, command box, listbox of things, action menu, live log, hidden canvas |
| `player.js` | Reads `A11Y` lines, keeps room/inventory/conversation state, parser, announcements, list mode |
| `serve.mjs` | Static server: this folder first, then `vendor/scummvm-web/build-emscripten`; `/pack.json` is `spikes/08-a11y-pack/drascula-en.json` if it exists |
| `test.mjs` | Playwright run: 34 checks, axe in 3 states, screenshots, transcript |
| `transcript.txt` | What was typed and what the live region said, plus the check results |
| `axe-*.json` | axe-core results (WCAG 2.0/2.1 A and AA plus best practice) |

## How it works

- **Loading.** The page sets its own `window.Module` (canvas, `printErr`) and only then adds `scummvm.js`. The stock pre-js reads ScummVM's arguments from the URL fragment, so the page sets `#--savepath=/tmp --subtitles -p /data/games/drascula drascula` first.
- **Start gate.** "Press any key to start" with a focused Start button. The engine script loads after that key press, so the AudioContext is created after a user gesture. With Chrome's real-visitor policy (`--autoplay-policy=document-user-activation-required`) it came up `running`. Spike 03 warned automation may get round the policy, so that's a hint, not proof.
- **Reading.** `Module.printErr` gets each line, strips ScummVM's `WARNING: ` prefix and trailing `!`, and dispatches on the tag. `A11Y_SAY` (ScummVM's own TTS) and `A11Y_HOVER` are ignored; the game's TTS is off by default (`tts_enabled`), so no second voice.
- **Writing.** Commands are appended to `/tmp/a11y-cmd.txt`, not overwritten, in case the engine hasn't read the previous one. Page JS and the engine share one thread, so read-then-write can't race the engine's read.
- **Keys.** Keydown, keyup and keypress inside the game UI stop propagating, so typing doesn't reach SDL's window and document listeners. In the test run the engine logged 14 `A11Y_CMD` lines, exactly the commands the page sent (`out/console.txt`). That shows typed text didn't turn into engine commands; it doesn't prove no game hotkey fired.
- **What gets said.**
  - Room entry: "You're in room 62. You can see: bartender, drunkard, pianist, skull, bin, poster and blackboard. Exits: left door, middle door and right door."
  - After each command, from `A11Y_DIFF`: what was said ("I CAN'T SEE ANYTHING IN PARTICULAR"), and in conversations with a speaker ("You say: HI BOSS, HOW ARE YOU?", "The drunkard says: I'M HERE, DRINKING"), items ("You picked up the cigarettes.", "You no longer have the two coins."), things appearing or going, a new room or chapter. Flags are never spoken.
  - Conversation choices, numbered, with "(already said)" and "(ends the conversation)".
  - Errors in plain English ("You aren't carrying that.", "You're in a conversation. Type a choice number...").
  - Long speech: if a command is still running after 2.5 s, lines are read as they appear instead of waiting for the end (the chapter 1 bartender talk is about 90 s). The diff then skips lines already read.
- **Same-name objects** get a position word from their hotspot's x position: room 62's three DOORs become left, middle and right door. Spanish names left in the English data are fixed (ESCALERA to stairs, HABITACIONES to rooms, and so on).

## The parser

Plain rules, no model. In order:

1. **A pending question.** After "Which door? 1, left door, an exit. 2, middle door..." a number or a matching word ("left") answers it. Anything else is a new command.
2. **In a conversation.** A number is `choose n`; "bye", "goodbye", "leave" pick the choice that ends it. Other verbs get "You're in a conversation..." and are not sent (the engine would queue them until the talk ends).
3. **Fixed phrases.** help; repeat / again / pardon; inventory / what have I got / what am I carrying; where can I go / exits; what's here / look around / where am I; skip (also Escape); choices; cancel / never mind; save.
4. **Verb phrases.** A table of regexes maps lead words to the seven engine verbs: look at / examine / read, take / get / pick up, open, close / shut, talk to / speak to / ask, push / press / move, go through / go to / walk / enter / exit, and use / put / give / insert with "on / with / in / to" splitting item from target.
5. **A name on its own** looks at a thing or goes through an exit.

**Matching names.** Candidates are visible room objects, carried items (names from `A11Y_INV`) and yourself ("me", "myself"). Each word of the phrase scores 3 for an exact or plural match ("coins" for "two coins") and 2 for a prefix of 3+ letters ("bart"); filler words are dropped; words that match nothing ("far") don't rule a candidate out. Top score wins. Ties ask "Which door?" with numbered options; position words (left, middle, right, first, second) narrow first. "use" looks only in the inventory for the first noun ("You aren't carrying the skull. Try taking it first.") and asks "Use the phone on what?" if there's no target.

## Test results (6 Nov 2026, `node test.mjs`)

34/34 pass. Full log in `transcript.txt`. The main run loads `/?nopack` so its wording doesn't depend on spike 08. Highlights:

```
(presses Enter on the start screen)
  [live] You're in room 62. You can see: bartender, drunkard, pianist, skull, bin, poster and blackboard. Exits: left door, middle door and right door. Type help for commands.
> look at the bartender                      (sent: look 52)
  [live] I CAN'T SEE ANYTHING IN PARTICULAR
> door
  [live] Which door? 1, left door, an exit. 2, middle door, an exit. 3, right door, an exit. Type a number.
> 2
  [live] I DON'T HAVE A ROOM YET
> inventory
  [live] You're carrying: phone (THIS IS THE MOBILE PHONE I GOT LAST CHRISTMAS).
> talk to the drunkard
  [live] Choose what to say. 1: HI BOSS, HOW ARE YOU? 2: AND HOW IS THE FAMILY? 3: THIS IS QUITE GROOVY, HUH? 4: I'D BETTER NOT SAY ANYTHING (ends the conversation). Type a number.
> 1
  [live] You say: HI BOSS, HOW ARE YOU?
  [live] The drunkard says: I'M HERE, DRINKING
> bye
  [live] Choose what to say. 1: HI BOSS, HOW ARE YOU? (already said). 2: ... (the list after choice 1, arriving once the drunkard finished)
  [live] You say: I'D BETTER NOT SAY ANYTHING.
  [live] The conversation is over.
(Tab to the list, Down, "s" to jump to skull, Enter, Down to "Take", Enter)
  [live] I HAVE THE HABIT OF NOT TOUCHING THINGS THAT HAVE BEEN ALIVE
> go through the right door
  [live] You're in room 63. You can see: machine, curtain and papers. Exits: door.
> door
  [live] You're in room 62. ...
```

Also checked: start button focused on load; focus lands in the command box after boot; "go through the far door" asks which; "what's here", "where can I go", "repeat"; "look at the phone" (inventory item, `look 28`); "use phone on pianist" sends `use 28 54`; an unknown noun says "There's no xyzzy here" and lists what is; Tab from the command box reaches the listbox; arrows and type-ahead move `aria-activedescendant`; Enter opens a `role=menu` with focus on "Look at"; "Take" sends `take 100` and focus goes back to the list. axe: 0 violations at the gate (25 rules passed), with the menu open (37) and in game (36). The choice list read after choice 1 comes late because the engine only prints it when the reply finishes; a fast typist hears it after they've moved on. The first axe run caught the scrollable log not being keyboard reachable; it's now `tabindex=0` and after the list in tab order.

## Gaps

- **Room names are "room 62".** The game has none (spike 05). Spike 08 had its format draft (`FORMAT.md`, `schema.json`) but no `drascula-en.json` when this finished. The player reads that format if it's there (`rooms.<n>.name` and `short`, `exits.<num>.label`, `objects.<num>.name`, `items[]` by id and chapter, `textFixes`), and three checks prove it with a made-up fixture served through Playwright: room name and short text on entry, pack labels for exits and objects, "look at the barman" matching a pack name, and a pack item name in the inventory. Not tried against the real pack. Add `?nopack` to the URL to ignore it.
- **Exit destinations aren't spoken** without a pack ("left door", not "door to the back room"). With a pack, the exit's `label` is used as written.
- **Left, middle, right** come from hotspot x on screen. That's where it's drawn, not necessarily what a sighted player would call it.
- **Speakers.** Only "you" (yellow text) versus "the person you're talking to". Lines read live (over 2.5 s) have no colour, so in a conversation they're guessed: a line that matches a choice is you, anything else is them. Outside conversations, non-yellow lines are "Someone says". Fix: put the colour (or speaker) on `A11Y_TEXT` in the patch.
- **Conversation end** is a guess: the choice marked `ends`, or no new `A11Y_CHOICES` within 2 s of a choice.
- **Game text is ALL CAPS**, kept as the game wrote it.
- **Parser limits:** no "it" or "them", one command per line, no "take all", fixed synonym lists. Chapter 4–6 items without an engine name come out as "item N".
- **Loading** says "Loading the game" once. No progress on the 50 MB first load.
- **Only Chrome**, headless and via automation. No Safari or Firefox, no mobile.
- Untested here: save and load from the page, the chapter 2 puzzle chain, cutscene skip timing on the web build.

## Screen-reader caveats (not tested)

- **Live region behaviour.** The log is `role=log` with `aria-live=polite`; each announcement is a new paragraph. Real screen readers may queue, merge or drop fast updates (a room description followed at once by a diff), and may cut a long polite message when the user types. Needs VoiceOver (Safari and Chrome), NVDA and JAWS (Chrome, Firefox) checks.
- **Typing while it talks.** In NVDA and JAWS the command box should put them in focus mode, so typed letters go to the box, not browse-mode shortcuts. Not checked.
- **`aria-activedescendant` listbox.** VoiceOver's support has been patchy historically. The menu uses real focus on buttons with `role=menuitem`, which is more widely supported.
- **ALL CAPS text.** Some voices spell out short all-caps words or read them with odd stress. Sentence-casing the game text before speaking is a one-line change if it's a problem.
- **"Repeat"** adds a new paragraph with the same text; screen readers that ignore identical consecutive live updates might stay silent.
- **ScummVM's own TTS** is off (`tts_enabled` default); if it's ever on, it speaks through Web Speech on top of the screen reader.
- None of this has been tried by a blind player, so it says nothing yet about whether the model is pleasant or fast to play.
