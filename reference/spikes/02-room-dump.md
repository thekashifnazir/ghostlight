# Spike 02: read the room, and act on it (throwaway)

**Result, 6 Nov 2026: works.** On entering a room, the patched Drascula engine prints one JSON line to the log: chapter, room, every object (number, name, hotspot rectangle, walk-to point, visible, door and destination room), inventory item IDs, and the 50 progress flags.

First room (`room62.json`, the tavern): bartender, drunkard, pianist, skull, bin, poster, blackboard, and three doors to room 63. Inventory IDs 1–6 and 28. No flags set yet.

## How to run it

```bash
cd vendor/scummvm && git apply ../../spikes/02-room-dump/drascula-state.patch && make -j16 && cd ../..
O=spikes/02-room-dump/out; mkdir -p $O
SDL_AUDIODRIVER=dummy ./vendor/scummvm/scummvm -d2 --extrapath=vendor/scummvm/dists/engine-data \
  --config=$O/scummvm.ini --savepath=$O -p vendor/game/drascula drascula 2>&1 | grep "A11Y {"
```

It opens a real window. The patch also always skips the intro.

## What we learned

- Fully headless (SDL dummy video) is flaky: OpenGL fails, then the surface renderer fails intermittently. A real window works every time. For automation later: the web build, or a virtual display on Linux.
- The build needs **Ogg** audio (`drascula-audio-2.0.zip`). Without MP3 support (no libmad) the MP3 pack triggers a "missing CD audio" dialog that blocks a headless run.
- The engine data file `drascula.dat` comes from `dists/engine-data` (pass `--extrapath`).
- A `[drascula]` key in the ini file wasn't visible to `ConfMan.hasKey` when launched with `-p ... drascula`. Not chased; the spike just hard-codes the intro skip.

## Still open

- Dump on every change, not just room entry: object picked up, door opened, flag set.
- Inventory names: IDs only so far. The names live in the engine's text tables.

## Part 2: acting without a mouse (6 Nov 2026, works)

The patched engine reads commands from `<savepath>/a11y-cmd.txt` each frame:

- `verb <n>`: 1 look, 2 take, 3 open, 4 close, 5 talk, 6 move
- `click <objnum>`: move the cursor to the centre of that object's hotspot and click
- `dump`: print the room state

It logs three kinds of line: `A11Y_CMD` (command received), `A11Y_SAY` (what ScummVM's own text-to-speech would speak) and `A11Y_TEXT` (every line of on-screen text, including what characters say).

Result (`actions-transcript.txt`):

```
A11Y_CMD verb 1          -> A11Y_SAY Look
A11Y_CMD click 52        -> A11Y_TEXT I CAN'T SEE ANYTHING IN PARTICULAR
A11Y_CMD verb 2
A11Y_CMD click 100       -> A11Y_TEXT I HAVE THE HABIT OF NOT TOUCHING THINGS THAT HAVE BEEN ALIVE
```

**Run with `--subtitles`.** Without it the game draws no text, and nothing comes back.

**Two gotchas fixed on the way:**
- A press and release in the same frame never reached the game. The press is now set on the next frame.
- A button left held down skips every line of dialogue. The release is now queued straight after the press, the way a real click works.

**Finding:** in the code read on 6 Nov, Drascula's ScummVM text-to-speech speaks hover names, verbs and conversation choices (`interface.cpp`, `graphics.cpp`, `converse.cpp`), but `talk.cpp` has no `sayText` call. So what characters say back, the answer to "what happened?", isn't spoken. The `A11Y_TEXT` hook catches it.
