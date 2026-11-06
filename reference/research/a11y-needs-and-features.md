# Blind and low-vision needs, and extra features for old games

Two research passes, 6 Nov 2026 (subagents; sources saved in the session scratchpad, URLs below). Summary for decisions; check URLs before quoting anything publicly.

## What blind players ask for (ranked by how often and how strongly it comes up)

1. **Everything spoken, and speech you can interrupt.** Menus included; speech stops on a key press or a focus change (forum.audiogames.net/topic/47916, afb.org/aw/fall2023).
2. **Their own screen reader, at their own speed.** "For completely self-voiced games (e.g., using prerecorded speech), it's usually not that great because then you are limited by the speed and quality of the prerecorded lines" (gamesforblindgamers.github.io/wiki/other/faq). **So every functional line goes to the screen reader. Pre-recorded voice is flavour: the ghost, game dialogue, cutscene description.**
3. **Sound cues.** 77% rate audio cues the most valued feature (RNIB for Activision, July 2024, 250+ sight-loss gamers).
4. **Audio description of scenes.** 60% call it crucial (same report). Adventure was blind players' favourite genre in a 106-person survey (gaconf.com, 2020).
5. **The same games sighted friends play, not dumbed down** (RNIB; CHI 2025, arxiv 2502.09866).
6. **Agency, not a sterile menu.** "very, very sterile and very soulless" about a list menu (CHI 2024, arxiv 2403.10512). Lists as one mode, not the only one.
7. **Browse one item at a time, details on demand.** Don't read whole lists.
8. **Repeat last** (Game Accessibility Guidelines: "Allow all narrative and instructions to be replayed").
9. **Graded hints, not walkthroughs.** Copying a walkthrough "is kind of boring" (intfiction.org/t/ask-a-blind-person-anything-within-reason/80505).
10. **Skips for timed and visual-only bits, stable focus, typed commands always work** (speech input must be optional).

**Adventure blockers:** pixel hunting; objects that only appear after an action; inventory combining; minigames that break the format; visual-only puzzles (colours, mazes); scrolling rooms; OCR unreliable in games. Drascula not audited for these yet.

## Already exists (don't just rebuild)

- **Brandon Cole's 2013 design is our core loop** (brandoncole.net/?p=128): lists of objects, exits, inventory, combine submenus, per-game packs written by sighted helpers.
- **ScummVM closed that ticket in Apr 2021** saying hotspots "are not exposed via some API yet", and that someone first needs **a metadata format and test data for a game** (lists.scummvm.org/pipermail/scummvm-tracker/2021-April/028790.html).
- **The Drifter accessibility mod** (Feb to Mar 2026): point-and-click with NVDA speech for hotspots, inventory, combining, dialogue (github.com/Lirin111/the-drifter-accessibility-mod).
- **A 2026 wave of NVDA mods** (Resident Access HD with room lists and auto-walk, Phoenix Wright, the Prism library). Room lists alone aren't novel.
- **BROK the InvestiGator, Stories of Blossom:** built blind-accessible, with audio description, hints, repeat.
- **Sony's "AI Generated Ghost Player" patent** (published Apr 2025): an AI ghost that helps players through challenges. Position the ghost as authored, spoiler-graded hints, not an AI that plays for you.

## The gaps nobody is filling

1. **A per-game accessibility pack format for ScummVM, with Drascula as the first test data.** Exactly what the ScummVM developer asked for in 2021. The blind-accessible games list (updated 3 Nov 2026) has no classic ScummVM adventures. **This is the transferable part of the entry.**
2. **Graded hints that know your progress** from the engine's own flags, for old games.
3. **Two ways to explore:** a relaxed list mode and a "sweep" mode where a tone rises as the cursor nears a hotspot, tracking what's still unexplored. Done in 3D (Surveyor), not in 2D point-and-click (guess).
4. **Telling the player what an action changed:** new objects, exits, inventory (guess: not automated anywhere).
5. **Low vision in ScummVM:** hotspot highlight, bigger cursor, zoom that follows the cursor (guess: missing).

## ScummVM 2026.4.0 already has

TTS per engine (Drascula included, `tts_enabled`), launcher TTS on hover (keyboard PR #7951 open), visual hotspot markers in Touché/Macs2/Hollywood/Sky (not Drascula), subtitle speed and volumes, keymapper with a keyboard virtual mouse, save anywhere in Drascula, scalers and shaders (no high contrast, zoom or cursor size), Ctrl+F fast mode. Engine-specific helpers are a trend: Eye of the Beholder automap, Hopkins autopilot, M4 maze bypass.

## Extra features worth adding (ranked)

| Feature | Helps | Exists? | Effort (guess) | Video wow |
|---|---|---|---|---|
| **Sonar pings + earcons by type** (object / exit / person) | Blind | No (GAG advanced "sonar-style audio map"; TLOU2 Listen Mode) | 3–4 days | High |
| **Audio description of cutscenes** | Blind | Not in ScummVM; BROK has it | 2–3 days (~20 lines) | High |
| **One-switch scanning** over the same action list | Motor | No | 1–2 days | High |
| "What changed" after each action | Blind, cognitive | No | 1 day | Medium |
| Sound-effect and music captions (13 sound IDs, ~16 tracks counted) | Deaf/HoH | No ticket found | 0.5–1 day | Medium |
| "Previously..." recap from progress flags | Cognitive | No | 1–2 days | Medium |

**Skip:** zoom, large cursor, colour-blind or high-contrast shaders, live translation (RetroArch AI Service has it), simplified verbs (Drascula has 6), game speed, visual hotspot overlay (exists).
