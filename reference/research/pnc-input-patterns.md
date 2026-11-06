# How accessible point-and-clicks handle input (6 Nov 2026)

Prompted by a blind player on the Games for Blind Gamers Discord, who pointed at these as good examples. Researched from public pages (itch, Steam, brokgame.com/accessibility.php, BROK 1.3.0 devlog, caniplaythat.com and access-ability.uk reviews, Lirin111's GitHub READMEs and release notes). The BROK AudioGames thread and Steam reviews didn't load.

| Game | Finding things | Actions | Inventory | Speech |
|---|---|---|---|---|
| A Crisis of Fae (jam, PowerQuest) | K starts accessible mode; arrow keys step through scene elements (a list) | Enter interact, Backspace look | Tab; "Use With" mode, Backspace cancels | NVDA recommended. Complaints: stuck in options, silent toolbar, dialogue responses not read, K mode resets on room change |
| BROK the InvestiGator (built in, Lirin consulted) | Walk with the stick, prompt when near; D-pad jumps to nearest in a direction; hold X reads all left to right | Separate keys; Alt to pick up | Not documented | Recorded TTS clips, or text to clipboard for NVDA. **Complaint: directional jumping misses things; players wanted a plain ordered cycle; duplicate names confusing.** Extras: room-entry descriptions with positions, repeat keys, wall vibration, positional audio, skippable puzzles, hints |
| Loco Motive + Lirin's mod (MelonLoader, Tolk) | v1.0 Tab through every object; v1.1 Left/Right cycles hotspots nearest first; Enter auto-walks | Up use, Down examine | Left/Right browse, Up make active, Down combine, Enter use on world, Shift+Enter examine | Tolk (NVDA/JAWS/SAPI). F1 lists controls, F2 toggles subtitles. List refreshes when objects appear; "Received X" spoken; safe puzzle has its own keys. v1.4.0 went controller-only (keyboard glitches, likely mod vs game input) |
| The Drifter mod (same author) | Stick movement, hotspots announced when near | | Bumpers cycle; combine wheel | Direct NVDA; stresses interrupting speech and quick post-action announcements |

**Answer to "what does arrow keys mean?":** none of these use typed commands. The list (Left/Right cycling every hotspot) is the pattern blind players asked for; spatial movement (BROK) drew the complaint that things get missed.

**Patterns to copy (for the player spec):**
1. Complete, ordered hotspot list: Left/Right cycles, ordered left to right or nearest first, "3 of 7", unique names for duplicates, refresh on change.
2. Activate = auto-walk + act. Interact and examine on separate keys; a verb menu for Drascula's other verbs (open, close, talk, push).
3. Inventory: make an item active, use it on a hotspot or another item; Backspace cancels; announce "Received X".
4. Speech interrupts, never queues. Keys: repeat last line, read whole room, F1 help.
5. Room-entry description with positions. Visual puzzles get their own keys with spoken instructions. Accessible mode remembers its state across rooms.

**Our design call:** list mode with Left/Right is the primary way to play. Sonar becomes a "where is it" helper on the focused item, not the main navigation. Typed commands stay as an optional shortcut.

**Person worth knowing:** Lirin111 made the Loco Motive and The Drifter mods and consulted on BROK's blind access.


## Player feedback, 6 Nov 21:49 (Discord, blind player who recommended these games)

- Loco Motive mod: **focus order did not match the visual order** of things in the train. Keep the list strictly left to right (then top to bottom).
- **Focusing something off-screen did not move the camera**, a problem when playing alongside someone sighted. Show the focused hotspot on the canvas (a highlight) and keep it in view, so a sighted co-player can follow. Also useful in the demo video.
- **Neither game has room descriptions**, "which would have been helpful". Our pack descriptions are a real differentiator.
- A Crisis of Fae lists its known bugs on its itch page.
