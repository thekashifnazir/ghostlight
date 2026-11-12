# Ghostlight (working name): design

Kiroween 2026 entry, Resurrection category. Written 6 Nov 2026 from the brainstorm and spikes 02 to 06 in this repo. Deadline Fri 4 Dec 2026, 14:00 PT (22:00 UK). If NS27 accepts Kash, the deadline moves to Wed 2 Dec.

"Ghostlight" is a placeholder name (a ghost light is the lamp left burning on an empty stage). Kash picks the final name.

## 1. Intent

Old point-and-click adventure games lock out blind and low-vision players: you have to see the screen and hunt for pixels with a mouse. Ghostlight brings one back so they can play it: the freeware **Drascula: The Vampire Strikes Back** (1996), running in ScummVM. Room contents, exits, inventory and progress come straight from the game engine. The player types or speaks what to do. Their own screen reader tells them what happens. A ghost character gives hints that know where they're stuck.

**Why this, for this hackathon:**
- Resurrection asks to "bring your favorite dead technology back to life". Last year's Resurrection winner (Faxi) brought old tech back for people modern tech leaves out. A joke reskin of the same tech (GhostFax) won nothing.
- Potential Impact is a fifth of the score and asks "How useful, intuitive, and accessible is it? Would someone actually use this?"
- No 2025 entry touched game accessibility or ScummVM (744 entries checked).
- In 2021 ScummVM's developer closed a blind-access request saying hotspots aren't exposed and someone first needs "a metadata format and test data for a game". Ghostlight's accessibility pack format is that, with Drascula as the first test data.
- The judges include Kiro Ambassadors. Dustin Ellis builds migration tools that give old apps a new home. Sergio wants real end users, tests and step gates. Both want "breadth" of Kiro features and **one complete solution, not 150 bells and whistles**.

## 2. Who it's for

- **Primary:** blind players who use a screen reader (NVDA, JAWS, VoiceOver), want to play the same classic games sighted friends grew up with, and don't want them dumbed down.
- **Secondary:** low-vision players (object list instead of pixel hunting), motor-impaired players (no precise mouse needed), and anyone stuck on an infuriating 1990s puzzle (hints).
- **Not for:** sighted speedrunners, or players wanting an AI to play for them.

What these players ask for (research file, 6 Nov): everything spoken and interruptible; **their own screen reader at their own speed**; sound cues; audio description; the same game as everyone else; agency, not a sterile menu; one item at a time with details on demand; repeat last; graded hints, not walkthroughs; typed input always works.

## 3. Goals

1. A blind player can play Drascula chapters 1 and 2 start to finish in a web browser with their own screen reader, no mouse, no sighted help.
2. Every room tells you where you are, what's here and where you can go. Every action tells you what changed.
3. Hints from the ghost come in three tiers (nudge, clue, answer) and are based on the player's actual progress in the game.
4. The accessibility data lives in a documented, reusable pack format, with Drascula as the first pack.
5. The build uses a wide range of Kiro features, each for a reason, and the write-up shows it.
6. A judge can open a link and play, and a 2:30 to 3:00 video with voiceover shows it end to end.

## 4. Non-goals

- Chapters 3 to 6 fully playable. Stretch only. The pack format must allow them; the demo covers chapters 1 and 2.
- A second game. Stretch only (see section 10).
- A live conversational voice agent as the main way to play. Optional demo extra at most.
- Mobile apps, accounts, multiplayer, saves in the cloud.
- Changing the game's puzzles or story.

## 5. Anti-goals (fail even if it technically works)

- Functional information only in a pre-recorded voice the player can't speed up or interrupt.
- Anything that only works if you can see the canvas.
- An AI that plays the game for you, or hints that spoil puzzles you haven't reached.
- A feature list so long the value isn't clear in 10 seconds.
- Claiming ScummVM's existing work as ours (hover-name speech since May 2025, visual hotspot markers since Jul 2026). Say plainly what we build on.
- Publishing the hackathon's ElevenLabs key or any key in the repo.

## 6. What's already proven (spikes, 6 Nov)

| Spike | Result |
|---|---|
| 02 | Our ScummVM build runs Drascula. A patch prints each room as JSON: objects, hotspot rectangles, walk-to points, doors and destinations, inventory, 50 progress flags |
| 03 | ScummVM's web (Emscripten) build runs Drascula in Chrome, boot to the first room in about 1.5 s. Page JS reads engine output via `Module.printErr` and sends commands via `FS.writeFile`. wasm 10.6 MB, game data 33 MB (one file, over Cloudflare's 25 MiB static-asset limit) |
| 04 | A command layer (`look/take/open/close/talk/push/walk/use/inv/choices/choose/skip/save`) played chapter 1 to the end and chapter 2's first puzzles with no mouse. One "what changed" line after each action |
| 05 | Census: 57 rooms over 6 chapters, 270 hotspots, 42 progress flags used, 763 English lines (36,243 characters), 43 cutscenes (19 with no dialogue). No timers, mazes, deaths or colour puzzles. The game never shows room names, exit names or item names |
| 06 | Ghost voice picked: ElevenLabs "Alice, ASMR British Whisper" on `eleven_v4`, audio tags work. Whole voice job about $8 at $0.08 per 1,000 characters |

Still running when this was written: an accessible web player page (spike 07), the pack format and chapter 1 to 2 data (spike 08), sonar pings (spike 09). Their results feed the specs, not this document's decisions.

## 7. The product

### 7.1 One loop

1. **Arrive:** "The tavern. A bartender, a drunkard, a pianist. Three doors." (room name and short description from the pack; objects from the engine).
2. **Act:** the player types or says "look at the bartender", "use the coins on the machine", "go through the back door".
3. **Hear what happened:** the game's own reply ("I CAN'T SEE ANYTHING IN PARTICULAR") plus what changed ("You picked up the cigarettes.").
4. **Stuck?** "Ghost, help." The ghost whispers a nudge. Ask again for a clue, then the answer.

### 7.2 Output

- **Every functional line goes to the player's screen reader** through an ARIA live region, in text. This is the default and it must be complete on its own.
- **Pre-recorded voice is flavour**, on by default and easy to turn off. **Core:** the ghost's hints only. **Stretch:** the game's English dialogue voiced (the English release is text only; the licence allows modified versions with a notice).
- **Cutscene descriptions:** text descriptions for the chapter 1 and 2 cutscenes (25 of the game's 43) are core, sent to the live region. Voicing them is stretch.
- **Sound cues** (synthesised, no audio files): a short earcon on room entry, on a successful action, on an error, and per object type.
- **Sonar:** a key plays each object and exit in turn, panned by position. Prototype in spike 09; include if it tests well.
- **Repeat last** and **interrupt** on a key press.

### 7.3 Input

- **Typed commands** in plain English, always available. A parser maps words to the command layer using the room's object names and the pack's spoken names. Ambiguity gets a numbered question ("Which door: 1, the front door; 2, the back door; 3, the stairs?").
- **List mode:** arrow keys move through what's here, Enter opens an action menu. For players who prefer it, and for motor-impaired players.
- **Speech input:** the browser's built-in speech recognition, optional, feeding the same parser.
- Keyboard only. No mouse needed anywhere, including the start screen.

### 7.4 The ghost

- An in-game character with its own voice (Alice, Eleven v4, with tags like `[sighs]`), so a hint never sounds like the narrator or the screen reader.
- Hints are **written by us, tiered, keyed on progress milestones** (conditions on chapter, flags, inventory and room). The ghost never reveals a puzzle the player hasn't reached.
- Each hint is also sent as text to the live region. The audio is a bonus.
- Positioned against Sony's "AI Generated Ghost Player" patent (published Apr 2025): ours is authored, spoiler-graded help, not an AI playing for you.

### 7.5 The accessibility pack

A versioned JSON file per game and language: room names and descriptions, exit labels, spoken-name overrides (including Spanish leftovers like ESCALERA), item names and descriptions, cutscene audio descriptions, progress milestones and hints. A JSON Schema validates it. Spike 08 drafts v0. The format should line up with ScummVM's `getHotspotPositions()` types (object, exit, NPC) so it could be proposed upstream.

### 7.6 How the pack gets made: the survey crew

A **Kiro Crew** "survey crew" plays the game through our MCP server (section 8), visits rooms, captures each room's objects and background image, drafts names and descriptions, and proposes milestones from flag changes. A human approves every entry before it goes in the pack. This is the "Crew beyond writing code" use the judges talked about, and it's how the method transfers to other games.

**Backup (my call):** the chapter 1 and 2 pack is on the critical path, so it doesn't wait on the crew. Spike 08's hand-drafted pack is the starting point. If a crew run is too costly or its drafts are poor, the crew is shown on a few rooms and the rest of the pack is written and approved by hand.

**How it's entered (from the rules):** one Ghostlight submission. The crew app sits in its own public GitHub repo (same GitHub account), linked in the Best Kiro Crew App field with a description of its features. It isn't a second submission.

## 8. Architecture

```
Browser
 ├─ Ghostlight page (HTML + TS, no framework needed)
 │   ├─ live region, command box, list mode, sonar, ghost audio player
 │   ├─ parser: words → commands, using engine state + pack
 │   └─ pack loader + hint engine (milestones → hint tiers)
 └─ ScummVM web build (wasm) with our Drascula a11y patch
     ├─ emits A11Y / A11Y_DIFF / A11Y_TEXT lines (Module.printErr)
     └─ reads commands from /tmp/a11y-cmd.txt (FS.writeFile)

Hosting: Cloudflare (Pages or Workers static assets) for the page and wasm;
         R2 for the 33 MB game data file. ~$0.

Dev and survey only:
 ├─ native ScummVM build with the same patch
 └─ MCP server "drascula-mcp": tools look/take/open/close/talk/push/walk/use/
    inventory/choices/choose/skip/save/state, wrapping the command file + log.
    Used by Kiro (testing), the survey crew (Kiro Crew) and Playwright checks.
```

- **Engine patch:** C++ in a ScummVM fork, kept as a small, readable patch on `engines/drascula`. Plain enough to propose upstream later, but upstream is not a deadline goal.
- **Licence (Kash, 6 Nov):** the submission repo is **MIT**, so the player, parser, pack format and tools can be reused by anyone. The ScummVM engine patch in `engine/` stays GPL-3.0-or-later (it modifies GPL code, and an upstream ScummVM contribution must be GPL), and so does the built wasm. The game data isn't committed; a script fetches it from ScummVM's official downloads with checksums. The hosted copy keeps the game's readme and notes that it's modified.

## 9. Kiro use (each for a reason)

| Kiro feature | Used for |
|---|---|
| Specs (requirements → design → tasks, EARS) | One spec per area: engine a11y layer, web player, pack format + Drascula pack, hints and ghost, sonar, survey crew, demo and hosting |
| Steering | product, tech, structure, accessibility rules (always: "never meaning only on canvas", "every line to the live region"), pack-writing style (fileMatch on `packs/**`) |
| Hooks | Shell (free): validate pack against schema on save; run parser and pack tests on save; rebuild wasm on engine patch save. PreToolUse: block commits that contain keys, block writes into `vendor/` |
| Custom agent | A verifier agent that re-runs checks and compares behaviour with the spec, the in-Kiro version of what Claude Code did for Surfdeck |
| Property-based tests | Parser: any phrase naming exactly one visible object maps to that object; never maps to an object not in the room. Pack: every census room/object/door has an entry; every milestone condition refers to real flags. Hints never fire for a milestone ahead of the player |
| MCP | Our own `drascula-mcp` server (the game as tools), plus Playwright for UI checks |
| Kiro Crew | The survey crew (7.6), in its own repo for the Best Kiro Crew App prize. Measure the credit cost of one run first; billing isn't documented |
| Workflows | The recipe for mapping a new room or a new game: capture → draft → human approve → validate |
| CLI / headless | Overnight survey runs and the full-chapter replay test |
| Memory | Pack-writing conventions remembered across sessions |

Claude Code stays on research, spikes and outside verification. App code, specs and steering are written in Kiro, so they show in `.kiro/`.

## 10. Stretch, in order

1. Chapters 3 to 6 in the pack.
2. Audio description of the 19 dialogue-free cutscenes, voiced.
3. Fully voiced English dialogue (763 lines).
4. A second freeware ScummVM game on a different engine (Beneath a Steel Sky or Lure of the Temptress) to prove the pack format transfers.
5. Generic fallback for games with no adapter: sweep the cursor and capture the hover names ScummVM's own TTS already produces in 17 engines. Labelled lower confidence.
6. One-switch scanning input.

## 11. Constraints

- Solo. Four weeks from 8 Nov (Flip the Switch ends 7 Nov). H Company hackathon takes Sat 28 Nov.
- 4,000 Kiro credits once the resubmitted request is approved; until then, Kash's own plan. Estimated build use 600 to 1,200 credits; Crew is the unknown.
- Public GitHub repo, open-source licence visible in About, `/.kiro` committed and not gitignored, working URL, video under 3 minutes on YouTube with voiceover and no copyrighted music, Kiro write-up.
- Claim limits from the hackathonideas repo: code is "AI-generated under my direction"; no claims about blind players' needs without a source; no employer IP.
- No real blind tester is lined up yet. Outreach to a screen-reader game modder and a blind accessibility writer is Kash's call; until then, decisions rest on the published research.

## 12. Decided by Kash

Resurrection category; old games made playable for blind players; Drascula (not Football Manager); ghost hints in a separate character voice; Alice on Eleven v4; pre-recorded lines, not a live agent, for cost and simplicity; generic version as a stretch goal only after Drascula works; Kiro Crew involved.

**Added 6 Nov (Kash, after the builder check):**
- **Rebuild in Kiro.** New public repo; Kiro writes the specs from what the spikes proved, then builds. The spikes stay in this private repo as reference, and the write-up says so. Better story for Technological Implementation.
- **Screen readers: all three must work.** VoiceOver (Mac, Safari and Chrome) locally; NVDA and JAWS (Chrome) in Windows VMs under Parallels.
- **No Kiro plan.** Kiro work starts when the 4,000-credit grant arrives. Until then, prep, spikes and research continue in Claude Code in this repo.

## 13. My calls (check these)

- Functional output goes to the screen reader; pre-recorded voice is flavour only. (From the research: blind players say pre-recorded speech limits speed and quality.)
- Web-first, hosted on Cloudflare with R2 for the game data.
- Demo scope is chapters 1 and 2.
- ~~GPL-3.0 for the submission repo~~ Changed by Kash: MIT, with the engine patch GPL.
- The survey crew is the Kiro Crew piece, in a separate repo.
- Placeholder name "Ghostlight".

## 14. Builder calls already made

- ScummVM's own text-to-speech is off by default, so it doesn't talk over the player's screen reader.
- Saves stay in the browser.
- Text colours in the game map to speaker names in the pack (yellow is the hero).
- Plan to the earlier Wed 2 Dec deadline, to be safe.
- Eligibility: the rules require the project to be built during the submission period (30 Oct to 4 Dec). The spikes date from 6 Nov, so they're inside it either way.

## 15. Left to the builder

Page layout and styling (keep it high contrast and simple), parser internals, how the MCP server talks to the native build, earcon sounds, test framework choices, how specs are split into tasks.
