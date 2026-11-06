# Requirements: player (accessible web page)

## Introduction

The player is the web page a blind or low-vision person uses to play Drascula. It loads the game (through the engine a11y layer), lets the player find things and act on them with the keyboard alone, and reads back what happened as text to their own screen reader. The accessibility consultant who pointed us at the reference games asked for one thing above all: a complete, ordered hotspot list that goes strictly in visual order, with duplicates named uniquely, refreshed when the room changes. That list is the primary way to play. Typed plain-English commands are an optional shortcut, not the main mode.

The page never reads the game's pixels. It talks to the engine only through the `A11Y` line contract defined by the engine a11y layer, behind an adapter. A second adapter replays recorded `A11Y` logs, so the whole player can be built and tested before the web build exists. Words that the engine cannot supply (room names and descriptions, exit labels, spoken object names, item names, text fixes) come from the accessibility pack, which the player reads but does not edit.

Scope is the interaction model and the page: the ordered hotspot list, interact/examine/verb-menu keys, the canvas highlight for a sighted co-player, inventory with an active item, the reading keys (repeat, read room, help), the ARIA live region, the engine adapter boundary and the replay adapter, the plain-English parser as an optional shortcut, and the tests. Sonar, the ghost and graded hints, and the engine patch itself are other specs.

Requirements use EARS (Easy Approach to Requirements Syntax). Terms:

- **hotspot**: a thing the player can focus in the list: a room object, a person (NPC), or an exit. Built from the engine's `A11Y` room state, with words from the pack.
- **visual order**: strictly left to right by the hotspot rectangle's left edge, then top to bottom by its top edge when left edges tie. This is the order the list cycles in.
- **focused hotspot**: the one hotspot the list is currently on. Exactly one is focused whenever the list is non-empty.
- **active item**: an inventory item the player has picked up to use. At most one at a time.
- **live region**: the single polite ARIA `role=log` region that every functional line is written to as text.
- **engine adapter**: the boundary the player talks to the engine through. It consumes `A11Y` lines and exposes room state, diffs, text, choices and inventory; it accepts the command verbs. It has two implementations: a live adapter (the real engine) and a replay adapter (recorded logs).
- **pack**: the accessibility pack JSON for this game and language (`drascula-en.json`), read for words only.

## Requirements

### Requirement 1: Build an ordered hotspot list from room state

**User story:** As a blind player, I want every thing, person and exit in the room held in one ordered list, so that I can reach all of them by cycling, not by pixel hunting.

#### Acceptance criteria

1. WHEN the engine adapter reports room state THEN the player SHALL build a hotspot list containing every visible room object, every person, and every exit the engine reports for that room.
2. THE player SHALL order the hotspot list strictly in visual order: ascending by each hotspot rectangle's left edge, and for equal left edges, ascending by its top edge.
3. THE player SHALL include each visible hotspot in the list exactly once.
4. WHERE several engine hotspots share one hotspot number, the player SHALL represent them as a single list entry, matching the pack's one-entry-per-number rule.
5. WHEN the room or chapter changes THEN the player SHALL rebuild the hotspot list from the new room state and SHALL discard the previous list.
6. WHEN objects appear or disappear within the current room THEN the player SHALL update the hotspot list so that it continues to contain every currently visible hotspot exactly once, keeping visual order.
7. WHILE the hotspot list is non-empty, the player SHALL keep exactly one hotspot focused.

### Requirement 2: Cycle the list with Left and Right

**User story:** As a blind player, I want Left and Right to step through every hotspot in order, telling me which one of how many I am on, so that I always know where I am in the room.

#### Acceptance criteria

1. WHEN the player presses Right THEN the player SHALL move focus to the next hotspot in visual order.
2. WHEN the player presses Left THEN the player SHALL move focus to the previous hotspot in visual order.
3. WHEN focus moves past the last hotspot on Right THEN the player SHALL wrap to the first hotspot, and WHEN focus moves before the first hotspot on Left THEN the player SHALL wrap to the last hotspot.
4. WHEN focus changes THEN the player SHALL announce the focused hotspot's spoken name and its position in the list as "N of M" (for example "3 of 7").
5. WHERE two or more hotspots would share the same spoken name, the player SHALL give each a unique spoken name so the player can tell them apart (for example "left door", "middle door", "right door").
6. WHEN the hotspot list is rebuilt after a room change THEN the player SHALL focus the first hotspot in visual order.

### Requirement 3: Interact and examine on separate keys

**User story:** As a blind player, I want one key to interact with the focused thing and another to examine it, so that acting and inspecting never get confused.

#### Acceptance criteria

1. WHEN the player presses Up or Enter on a focused hotspot THEN the player SHALL interact with it: first auto-walk to it, then carry out the default action for its kind.
2. WHERE the focused hotspot is an exit, interacting SHALL walk through the exit (the engine `walk` on a door).
3. WHERE the focused hotspot is an object or person, interacting SHALL carry out the engine's primary action for that hotspot by acting on the object slot, not on a pixel.
4. WHEN the player presses Down on a focused hotspot THEN the player SHALL examine it (the engine `look`), without walking unless the engine's own look requires it.
5. WHEN an interact or examine is issued THEN the player SHALL send it to the engine adapter as a command targeting that hotspot's number, never as a pixel click.

### Requirement 4: A small verb menu for the other verbs

**User story:** As a blind player, I want a short menu for open, close, talk and push, so that Drascula's less common verbs are reachable without extra always-on keys.

#### Acceptance criteria

1. WHEN the player opens the verb menu on a focused hotspot THEN the player SHALL present a menu offering open, close, talk and push.
2. WHEN the player chooses a verb from the menu THEN the player SHALL send that verb to the engine adapter targeting the focused hotspot's number, auto-walking first as interact does.
3. THE verb menu SHALL be operable with the keyboard alone, SHALL announce each option as focus moves, and SHALL use roving focus on real menu items rather than relying on `aria-activedescendant`.
4. WHEN the player cancels the verb menu THEN the player SHALL close it, return focus to the hotspot list on the same focused hotspot, and announce the return.
5. WHEN the verb menu closes after a verb is chosen THEN the player SHALL return focus to the hotspot list.

### Requirement 5: Highlight the focused hotspot on the canvas

**User story:** As a sighted co-player watching alongside, I want the focused hotspot shown on screen, so that I can follow what the blind player is doing.

#### Acceptance criteria

1. WHEN a hotspot is focused THEN the player SHALL draw a visible highlight around that hotspot's rectangle, positioned over the game canvas.
2. WHEN focus moves to another hotspot THEN the player SHALL move the highlight to the newly focused hotspot's rectangle.
3. WHERE the focused hotspot's rectangle is outside the visible canvas area, the player SHALL keep the highlight indicating the focused hotspot so a sighted co-player can still follow it.
4. THE highlight SHALL be decorative only: it SHALL carry no functional information that is not already in the live region, and the canvas SHALL remain `aria-hidden`.
5. WHEN the hotspot list is empty THEN the player SHALL show no highlight.

### Requirement 6: Inventory with an active item

**User story:** As a blind player, I want Tab to open my inventory, pick an item active, and use it on a hotspot or another item, so that item puzzles work without a mouse.

#### Acceptance criteria

1. WHEN the player presses Tab THEN the player SHALL open the inventory, listing the carried items by their pack names, operable with the keyboard alone.
2. WHEN the player chooses an item in the inventory THEN the player SHALL make it the active item and announce it.
3. WHILE an item is active, WHEN the player interacts with a focused hotspot THEN the player SHALL send `use <activeItem> <hotspot>` to the engine adapter.
4. WHILE an item is active, WHEN the player chooses another inventory item as the target THEN the player SHALL send `use <activeItem> <targetItem>` to the engine adapter.
5. WHEN the player presses Backspace THEN the player SHALL cancel the current step: clear the active item if one is set, otherwise close the inventory, and announce the cancellation.
6. WHEN the engine adapter reports an item gained THEN the player SHALL announce "Received X" using the item's pack name.
7. WHEN the engine adapter reports an item lost or used up THEN the player SHALL announce that it is no longer carried, using the item's pack name.

### Requirement 7: Reading keys

**User story:** As a blind player, I want keys to repeat the last line, read the whole room, and get help, so that I can re-hear and orient myself at any time.

#### Acceptance criteria

1. WHEN the player presses the repeat key THEN the player SHALL write the most recent functional line to the live region again.
2. WHEN the player presses the read-room key THEN the player SHALL read the room: its name, its description from the pack, the things and people present, and the exits.
3. WHEN the player presses F1 THEN the player SHALL read the list of controls to the live region.
4. THE repeat, read-room and help keys SHALL work in every play state where the hotspot list is active.

### Requirement 8: Read the room from the pack on entry

**User story:** As a blind player, I want each room announced by name and description when I arrive, so that I build a mental map the reference games never gave me.

#### Acceptance criteria

1. WHEN a room is entered THEN the player SHALL read the room's name and its short description from the pack, then the things and people present, then the exits.
2. WHERE the pack has no name or description for the entered room THEN the player SHALL fall back to a plain description built from the engine's reported hotspots, and SHALL still announce the room.
3. WHEN reading the things, people and exits THEN the player SHALL use the pack's spoken names and exit labels, applying the pack's text fixes to raw engine strings.
4. WHERE the pack gives an exit a destination label THEN the player SHALL speak that label rather than a bare "door".

### Requirement 9: All output to one live region, interrupting

**User story:** As a blind player, I want every functional line spoken as text that interrupts rather than piles up, so that I hear what matters now and never wait out stale narration.

#### Acceptance criteria

1. THE player SHALL write every functional line to a single ARIA live region as text: room name and description, things and people, exits, focus changes, the engine's replies, what each action changed, choices, errors, received items, and help.
2. THE live region SHALL be a polite `role=log` region, and the game canvas SHALL be `aria-hidden` so nothing functional exists only as pixels.
3. WHEN a new functional line is produced THEN the player SHALL replace the live region's content so the new line interrupts rather than queues behind earlier lines.
4. THE player SHALL NOT place any functional information only in audio, colour, canvas position, or the canvas, without the same information being present as text in the live region.
5. WHEN speech or audio is playing, WHEN the player presses a key or focus changes THEN the player SHALL stop that speech or audio.

### Requirement 10: Talk to the engine only through an adapter

**User story:** As the player, I want all engine contact behind one adapter following the `A11Y` line contract, so that the real engine and a replay of recorded logs are interchangeable.

#### Acceptance criteria

1. THE player SHALL obtain all game state, text, choices and inventory from the engine adapter, and SHALL send all commands through it, never reading the game canvas or the engine's internals directly.
2. THE engine adapter SHALL consume the `A11Y` line contract defined by the engine a11y layer: `A11Y` room state, `A11Y_DIFF`, `A11Y_TEXT`, `A11Y_CHOICES`, `A11Y_INV`, `A11Y_CMD`, `A11Y_ERR`, `A11Y_SAVED`.
3. THE engine adapter SHALL accept the command verbs the engine a11y layer supports: `look`, `take`, `open`, `close`, `talk`, `push`, `walk`, `use`, `inventory`, `choices`, `choose`, `skip`, `save`.
4. THE player SHALL depend only on the engine adapter interface, so that the live adapter and the replay adapter are interchangeable without changing player logic.

### Requirement 11: A replay adapter for recorded logs

**User story:** As a developer, I want a replay adapter that plays recorded `A11Y` logs, so that the player can be built, run and tested before the web build exists.

#### Acceptance criteria

1. THE replay adapter SHALL implement the same engine adapter interface as the live adapter.
2. WHEN given a recorded `A11Y` log THEN the replay adapter SHALL parse its lines into the same room state, diffs, text, choices and inventory the live adapter would expose.
3. WHEN the player sends a command through the replay adapter THEN the replay adapter SHALL advance the recorded log to the response that follows that command, so a recorded session plays back as the player drives it.
4. WHERE a command does not match the next recorded response THEN the replay adapter SHALL surface a clear mismatch rather than inventing engine behaviour.
5. THE player SHALL run end to end against the replay adapter with no live engine present.

### Requirement 12: Typed plain-English commands as an optional shortcut

**User story:** As a player who prefers typing, I want plain-English commands as a shortcut, so that I can act without cycling the list, while the list stays the main way to play.

#### Acceptance criteria

1. THE player SHALL accept typed plain-English commands as an optional shortcut, and SHALL keep the ordered hotspot list as the primary way to play.
2. WHEN a typed phrase names one currently visible hotspot THEN the player SHALL map it to that hotspot and act on it.
3. THE player SHALL NOT map a typed phrase to a hotspot that is not currently present.
4. WHERE a typed phrase matches more than one visible hotspot equally THEN the player SHALL ask the player to choose rather than guess.
5. WHERE a typed phrase matches no visible hotspot THEN the player SHALL say so and list what is present, rather than sending a command for an absent thing.
6. THE typed-command path SHALL act through the same engine adapter and produce the same announcements as acting from the list.

### Requirement 13: Keyboard only, stable focus

**User story:** As a player who cannot use a mouse, I want everything reachable and operable with the keyboard alone from the start screen on, so that no step needs a pointer.

#### Acceptance criteria

1. THE player SHALL make every control, including the start screen, reachable and operable with the keyboard alone.
2. THE player SHALL require no mouse for any action.
3. THE player SHALL keep focus stable and predictable: after an action, focus returns to the hotspot list unless the player opened the inventory or a menu.
4. WHEN the start screen is shown THEN the player SHALL place keyboard focus on its start control, and the page SHALL create the audio context only after a user key press.

### Requirement 14: Accessibility and interaction tests

**User story:** As the project, I want the player covered by UI, accessibility and property tests, so that the interaction model stays correct and accessible as it grows.

#### Acceptance criteria

1. THE player SHALL be tested with Playwright for the keyboard interaction model (list cycling, interact, examine, verb menu, inventory and active item, reading keys), driven against the replay adapter.
2. THE player SHALL be checked with axe-core for accessibility violations across the start screen, in-room play, the verb menu open, and the inventory open.
3. THE player SHALL have a fast-check property asserting that, for any room state, the hotspot list contains every visible hotspot exactly once and in visual order.
4. THE player SHALL have a fast-check property asserting that a typed phrase naming one visible object maps to that object and never to an absent one.
5. THE player SHALL run its Playwright and property tests without a live engine, using the replay adapter and recorded logs.

### Requirement 15: Boundaries and reuse

**User story:** As the project, I want the player kept to its own folders and the shared format honoured, so that it does not disturb the engine, packs or scripts, and stays reusable.

#### Acceptance criteria

1. THE player SHALL live under `src/` and SHALL NOT edit `engine/`, `packs/` or `scripts/`.
2. THE player SHALL read the pack as published, treating it as read-only words it renders.
3. THE player source SHALL be MIT-licensed, taking nothing from GPL engine sources.
4. THE player SHALL NOT copy code from `reference/`; it is built from the proven interaction model, not the spike's throwaway page.

## Known gotchas to carry into design and tasks

From spike 07 and the accessibility consultant's feedback (6 Nov). Each must be handled or explicitly accounted for.

1. **Visual order must match what a sighted player sees.** The reference mod's focus order did not match the train's visual layout. Order strictly left to right, then top to bottom, from the engine's hotspot rectangles.
2. **Focusing off-screen must still show the highlight.** In the reference games, focusing an off-screen thing did not move the camera, which broke co-play. Keep the focused hotspot indicated on the canvas.
3. **Room descriptions are the differentiator.** The reference games have none. Always read the pack's room name and description on entry.
4. **Duplicates need unique spoken names.** Confusing in the reference games. Derive position words (left, middle, right) from hotspot x for same-named hotspots.
5. **Speech interrupts, never queues.** Replace the live region's content so a room description followed at once by a diff does not pile up; stop audio on key or focus change.
6. **Some engine names are Spanish or ALL CAPS.** Apply the pack's `textFixes` and spoken names; the engine reports raw strings.
7. **Typing must not leak to the game.** Keydown, keyup and keypress in the page UI must not reach the engine's own input, so typed letters never fire a game hotkey.
8. **Start gate needs a user gesture.** The audio context must be created after a key press on the start screen, per browser autoplay policy.
9. **`aria-activedescendant` listboxes are patchy in VoiceOver.** The verb menu uses roving real focus on menu items; the list's single-focus model is announced explicitly on every move.
10. **Screen readers may merge or drop fast polite updates.** Interrupting (replacing content) and keeping each functional line self-contained reduces the chance a room description plus an immediate diff is lost.
