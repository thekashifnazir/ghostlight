# Requirements: sonar (hear the room's layout)

> **Descoped, 17 Nov 2026: the sonar tones.** Sonar is text only now. Kash had meant to drop the tones, because more sound on top of the music, the ghost voice and the screen reader would annoy players. On 17 Nov the tone code was found still in, wired to an audio context that was never set, so it had played nothing on the live site since 7 Nov. The audio layer (`src/sonar/audio.ts`) and the M (mute) key were removed. S, N and P keep the text: the summary line and each step's name, direction and distance. The requirements below about pings, sound, stop and mute are kept as the original design record.

## Introduction

Sonar lets a blind player hear where everything in the room is. The ordered hotspot list (player spec) already lets a player cycle every thing, person and exit one at a time and hear its name. Sonar adds the spatial picture the list cannot give: where each thing sits left to right and near to far, as sound, from the same room state the engine already sends. A scan plays one short synthesised ping per visible thing, left to right, panned by its x, with timbre carrying its kind and pitch its height, then drops one summary line into the live region. Stepping with next and previous plays one ping and announces that thing's name, direction and distance. Every ping has a text equivalent, any key stops sound at once, and a mute toggle turns the sound off while the text keeps working.

Sonar reads the room state the player already holds (the `RoomState` from the engine adapter: objects with rectangles and visibility, and the hero's position) plus the ordered hotspot list (for names and kinds). It synthesises every sound with the Web Audio API; there are no audio files to load or license. It writes every functional line to the same single polite live region the rest of the player uses, so the player's own screen reader reads it at the player's own speed. The sonar modules under `src/sonar/` are pure where they can be: room state in, pings out, and a thin audio layer that schedules those pings on an `AudioContext`. Sweep mode (a virtual cursor roamed over the room with a continuous tone) is proven in the spike and kept as an optional stretch task at the end; the core deliverable is scan, step and the text equivalents.

The spike `reference/spikes/09-sonar.md` proved this end to end on real Drascula room data (chapter 1 room 62, chapter 2 room 14) with Web Audio alone, 28 of 28 headless checks passing. This spec is written from what the spike proved, not copied from it; nothing in `src/` is copied from `reference/`.

Requirements use EARS (Easy Approach to Requirements Syntax). Terms:

- **room state**: the engine adapter's `RoomState` — chapter, room, hero `{x, y}`, and `objects[]` each with a hotspot number, rect `[x, y, w, h]` and `visible` flag — all in the 320x200 engine coordinate space.
- **visible thing**: a room object, person or exit whose engine object has `visible === true`. Only visible things are sonified.
- **hotspot**: a list entry built by the player (`Hotspot`), carrying the final spoken name, the `kind` (`object`, `npc`, `exit`), the rect and the hotspot number. Sonar takes names and kinds from here so it matches the list exactly.
- **kind**: `person` (npc), `object`, or `exit`, the three timbres a ping can carry. Sonar maps the hotspot `npc` kind to `person`.
- **ping**: one scheduled sound for one visible thing, described by a pure value (which thing, kind, pan, pitch, distance attenuation, onset time) and a matching text equivalent (name, direction, distance).
- **pan**: the stereo position of a ping, a number in the closed range -1 (hard left) to +1 (hard right), derived from the thing's x relative to the hero.
- **live region**: the single polite ARIA `role=log` region the player already owns (`LiveRegion`), to which every functional sonar line is written as text.
- **scan**: playing one ping per visible thing in left-to-right order, followed by one summary line in the live region.
- **step**: moving a sonar cursor to the next or previous visible thing, playing its single ping and announcing its name, direction and distance.
- **the controller**: the player's keyboard controller (`src/ui/controller.ts`), which already owns the keys Left, Right, Up, Down, Enter, Escape, Tab, Backspace, F1, H, L, R and V.

## Requirements

### Requirement 1: Map room state to ordered pings (pure)

**User story:** As a blind player, I want each visible thing turned into one ping placed left to right and near to far from where I stand, so that the sounds I hear form a picture of the room.

#### Acceptance criteria

1. WHEN sonar is given a room state and the room's hotspot list THEN sonar SHALL produce exactly one ping for each visible thing and no ping for any thing that is not visible.
2. THE sonar mapping SHALL order the pings strictly left to right, ascending by each thing's rect centre x, and for equal centre x ascending by rect centre y.
3. WHEN sonar places a thing THEN it SHALL derive the ping's pan from the thing's rect centre x relative to the hero's x, with a thing left of the hero panned left (negative) and a thing right of the hero panned right (positive).
4. THE sonar mapping SHALL keep every ping's pan within the closed range -1 to +1, and SHALL make pan non-decreasing as a thing's centre x increases, so the left-to-right order is preserved in the stereo field and nothing hard-clips several things onto one side.
5. WHEN sonar places a thing THEN it SHALL set the ping's pitch from the thing's rect centre y, so that a thing higher in the room is higher in pitch and a thing lower is lower.
6. WHEN sonar places a thing THEN it SHALL set the ping's distance attenuation from the distance between the thing's centre and the hero, so that a thing further from the hero is quieter, duller, or later than a thing nearer, and SHALL carry that distance as a near/mid/far band in the ping's text equivalent.
7. WHEN sonar places a thing THEN it SHALL set the ping's timbre from the thing's kind, so that person, object and exit are distinguishable by more than pitch alone.
8. THE sonar mapping module SHALL be pure: room state and hotspot list in, ping values out, with no Web Audio, DOM, timers or engine access.

### Requirement 2: Scan the room on one key

**User story:** As a blind player, I want one key to sweep the whole room as sound and then tell me what is here, so that I get the layout at a glance and a count I can act on.

#### Acceptance criteria

1. WHEN the player presses the scan key THEN sonar SHALL play one ping per visible thing in left-to-right order, separated in time so that each ping is heard distinctly.
2. WHEN a scan's pings have finished THEN sonar SHALL write one summary line to the live region giving the total count and the per-kind counts, for example "10 things, left to right: 3 people, 4 objects, 3 exits".
3. THE scan summary line SHALL be written as text to the live region independently of whether audio is playing, so a muted or audio-less player still receives it.
4. WHEN the scan summary is written THEN sonar SHALL schedule it so that it does not overlap the pings (it follows the last ping), and SHALL not queue a new announcement behind a long scan.
5. WHILE the room has no visible things, WHEN the player presses the scan key THEN sonar SHALL write a single line stating the room is empty and SHALL play no pings.
6. WHEN the room state changes (room change, or things appearing or disappearing) THEN a subsequent scan SHALL reflect the current visible things, because it is computed from the current room state and hotspot list.

### Requirement 3: Step through things with next and previous

**User story:** As a blind player, I want to step to the next or previous thing and hear just its ping and its details, so that I can browse the room's layout one thing at a time.

#### Acceptance criteria

1. WHEN the player presses the next key THEN sonar SHALL move its cursor to the next visible thing in left-to-right order, play that one thing's ping, and announce its name, direction and distance and its position as "N of M".
2. WHEN the player presses the previous key THEN sonar SHALL move its cursor to the previous visible thing in left-to-right order, play that one thing's ping, and announce its name, direction and distance and its position as "N of M".
3. WHEN stepping past the last thing on next THEN sonar SHALL wrap to the first thing, and WHEN stepping before the first thing on previous THEN sonar SHALL wrap to the last thing.
4. THE step announcement SHALL state direction in words derived from pan (for example "left", "ahead", "right") and distance in words derived from the distance band (for example "near", "mid", "far"), so a one-ear or speaker-only player still gets the position.
5. WHILE the room has no visible things, WHEN the player presses the next or previous key THEN sonar SHALL write a single line stating there is nothing to step through and SHALL play no ping.
6. WHEN the hotspot list is rebuilt after a room change THEN sonar SHALL reset its step cursor so the next step starts from the first thing.

### Requirement 4: Every ping has a text equivalent

**User story:** As a blind player who may have audio off or be on a device with no stereo, I want every ping to have a matching line of text, so that I never miss information that was only in the sound.

#### Acceptance criteria

1. WHEN sonar produces a ping THEN it SHALL also produce a text equivalent carrying that thing's name, kind, direction and distance band.
2. WHEN sonar announces a stepped thing THEN the line SHALL be the ping's text equivalent, written to the live region.
3. THE sonar feature SHALL place no functional information in sound alone; the summary and every step line SHALL be complete as text on their own.
4. WHEN sonar writes to the live region THEN it SHALL use the player's single polite live region so the line is read by the player's own screen reader, replacing the previous line rather than queuing behind it.

### Requirement 5: Stop, mute and repeat

**User story:** As a blind player, I want to stop the sound instantly, mute it entirely, and still have every control work as text, so that the sound is never something I am trapped inside.

#### Acceptance criteria

1. WHEN the player presses any key during a scan or a ping THEN sonar SHALL stop all scheduled and playing sonar sound immediately, cancelling the remainder of a scan.
2. WHEN a scan is cancelled THEN sonar SHALL suppress the pending summary line and MAY write a short "stopped" line instead.
3. WHEN the player presses the mute key THEN sonar SHALL toggle sonar sound off and on, and SHALL announce the new state as text.
4. WHILE sonar sound is muted, WHEN the player scans or steps THEN sonar SHALL still write the summary and step text equivalents to the live region and SHALL play no pings.
5. WHERE no audio context is available, sonar SHALL remain fully usable: scan and step SHALL still produce their text equivalents in the live region.
6. THE sonar feature SHALL schedule a newer announcement in place of a pending one rather than queuing it behind a long scan, so the live region always reflects the latest action.

### Requirement 6: Keys do not clash with the controller

**User story:** As a blind player, I want sonar's keys to be free keys that do not collide with the controls I already use, so that adding sonar does not break list mode or the menus.

#### Acceptance criteria

1. THE sonar feature SHALL use only keys that the controller does not already bind; the controller already uses the arrow keys, Enter, Escape, Tab, Backspace, F1, H, L, R and V.
2. THE sonar feature SHALL bind scan, step-next, step-previous and mute to free keys, proposed as S (scan), N (next), P (previous) and M (mute), each confirmed against the controller's current bindings before use.
3. WHEN a sonar key is pressed THEN the controller SHALL route it to sonar and SHALL consume the key so it does not reach the engine's own input.
4. THE sonar key handling SHALL run the controller's existing stop-audio step on every key press, so pressing a sonar key (or any other key) stops a scan in progress before the new action starts.
5. WHERE a sonar key is added, the help text SHALL describe it so the new controls are discoverable as text.

### Requirement 7: Sweep mode (optional stretch)

**User story:** As a blind player exploring a room in detail, I want to roam a virtual cursor over the room and hear a continuous tone track the nearest thing, so that I can probe the layout freely beyond the fixed list.

#### Acceptance criteria

1. WHERE sweep mode is built, WHEN the player toggles sweep on THEN sonar SHALL present a virtual cursor over the 320x200 room moved by the arrow keys, with a continuous synthesised tone whose pitch rises as the cursor nears the nearest thing's edge and whose pan follows the cursor's x.
2. WHERE sweep mode is built, WHEN the cursor enters or leaves a thing THEN sonar SHALL play a distinct tick and, on entering, announce that thing's name and kind as text.
3. WHERE sweep mode is built, it SHALL remain fully optional and off by default, SHALL not change any core scan or step behaviour, and SHALL obey the same stop, mute and text-equivalent rules as the rest of sonar.
