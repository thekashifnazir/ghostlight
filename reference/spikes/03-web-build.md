# Spike 03: ScummVM web build runs Drascula, page JS reads and drives it (throwaway)

**Result, 6 Nov 2026: works, first try.** ScummVM's own Emscripten port, built with only the Drascula engine plus the spike 02 patch, boots straight into room 62 (the tavern) in headless Chrome. Every `A11Y` line comes out on the browser console. Page JavaScript sends commands by writing the command file into the Emscripten file system. `verb 1` then `click 52` gave back `A11Y_TEXT I CAN'T SEE ANYTHING IN PARTICULAR`.

![room 62 in the browser](room62.png) ![after look at bartender](after-look.png)

Wall time from fresh source to a working test: about 10 minutes (emsdk download 30 s, configure about 1 min, wasm build 21 s).

## The mechanism

**Reading.** `warning()` goes to stderr. In the Emscripten build stderr goes to `Module.printErr`, which the stock shell sends to `console.error`. Every line arrives as `WARNING: A11Y ...!` (ScummVM adds the `WARNING: ` prefix and a trailing `!`). Cheapest hook: set `Module.printErr` in our own page (or wrap `console.error`, which is what `drive.mjs` does) and filter on `A11Y`. No engine change needed.

**Writing.** `FS` is a plain global in the generated `scummvm.js`, so page JS can call:

```js
FS.writeFile('/tmp/a11y-cmd.txt', 'verb 1\n');
```

with the game launched with `--savepath=/tmp`. The patch polls that file each frame, runs the command and empties it. `/tmp` is in-memory. Don't point savepath at `$HOME` (`/home/web_user`): that's mounted as IndexedDB with auto-persist, so every command would be written to IndexedDB.

**Launching.** The stock shell reads ScummVM arguments from the URL fragment:

```
scummvm.html#--savepath=/tmp --subtitles -p /data/games/drascula drascula
```

**Game data.** No packing step. The port serves `/data` over plain HTTP: each folder needs an `index.json` listing (made by `dists/emscripten/build-make_http_index.py`), and files are fetched whole, on first open. Game goes in `build-emscripten/data/games/drascula/`. `drascula.dat` is copied into `/data` by `make dist-emscripten`, so no `--extrapath`.

Transcript (`a11y-transcript.txt`, debug lines trimmed):

```
A11Y {"reason":"enterRoom","chapter":1,"room":62,"objects":[{"num":52,"name":"BARTENDER",...
A11Y_CMD verb 1        -> A11Y_SAY Look
A11Y_CMD click 52      -> A11Y_SAY BARTENDER / A11Y_TEXT BARTENDER
                       -> A11Y_TEXT I CAN'T SEE ANYTHING IN PARTICULAR
```

## How to run it

```bash
cd vendor
mkdir scummvm-web && git -C scummvm archive HEAD | tar -x -C scummvm-web   # same commit as vendor/scummvm (ad351d1e)
cd scummvm-web && git init -q && git apply ../../spikes/02-room-dump/drascula-state.patch

# emsdk 4.0.10 into dists/emscripten (build.sh wants wget, which macOS doesn't have, so fetch it by hand)
cd dists/emscripten && curl -sSLO https://github.com/emscripten-core/emsdk/archive/refs/tags/4.0.10.tar.gz \
  && mv 4.0.10.tar.gz emsdk-4.0.10.tar.gz && tar -xf emsdk-4.0.10.tar.gz && (cd emsdk-4.0.10 && ./emsdk install 4.0.10) && cd ../..

# configure (build.sh activates emsdk). Ogg and Vorbis must be asked for, or configure says no
./dists/emscripten/build.sh configure --disable-all-engines --enable-engine=drascula --disable-debug \
  --enable-ogg --enable-vorbis --enable-zlib

# build by hand: build.sh's make step uses nproc, missing on macOS, so it would fall back to -j1
source dists/emscripten/emsdk-4.0.10/emsdk_env.sh
emmake make -j16 && emmake make dist-emscripten

# add the game and re-index
mkdir -p build-emscripten/data/games/drascula && cp -R ../game/drascula/* build-emscripten/data/games/drascula/
python3 dists/emscripten/build-make_http_index.py build-emscripten/data

cd build-emscripten && python3 -m http.server 8765 --bind 127.0.0.1 &

# drive it (needs playwright-core and Google Chrome; no browser download)
node spikes/03-web-build/drive.mjs <outdir> [--strict-audio] [--headed]
```

## Sizes and timing

| Thing | Raw | Brotli |
|---|---|---|
| `scummvm.wasm` (Drascula only) | 10.6 MB | 2.5 MB |
| `scummvm.js` | 0.23 MB | 0.05 MB |
| `translations.dat` | 3.7 MB | 0.96 MB |
| `Packet.001` (game data) | 32.8 MB | 32.6 MB (already compressed) |
| Ogg music, 31 tracks | 35 MB | fetched one at a time when a track plays |
| Whole folder | 87 MB | |

- **First load fetched 49.9 MB in 20 requests** (`first-load-downloads.json`): the wasm, `Packet.001`, `translations.dat`, themes and one music track.
- **Boot to room 62: 1.2–1.5 s** on localhost, across 3 runs (intro skipped by the patch). Over a real network it'll be dominated by the 33 MB `Packet.001` download.
- **Audio:** the AudioContext came up `running` with no gesture in automated Chrome, headless and in a real window, even with `--autoplay-policy=document-user-activation-required`. Automation may get around the policy, so don't trust that. The SDL3 glue in `scummvm.js` resumes a suspended context on the first `keydown`, `mousedown` or `touchstart`, so for a real visitor expect silence until their first key or click. For a blind player, a "press any key to start" step does that.

## Blockers and gotchas

- **`Packet.001` is 32.8 MB, over Cloudflare's 25 MiB per-file limit for Workers static assets and Pages.** Kash's default stack can't serve it as-is. Options: put it in R2 behind the Worker, or split it (the HTTP file system fetches whole files; no range requests yet).
- `build.sh` assumes Linux: `wget` for emsdk and `nproc` for make. Worked around above.
- Without `--enable-ogg --enable-vorbis`, configure finds neither and the music pack won't play.
- Web MIDI permission error in the console (`requestMIDIAccess`). Harmless.
- The page itself isn't accessible: a canvas and a textarea. The real build ships its own shell page around `scummvm.js`.
- ScummVM's text-to-speech uses the Web Speech API on the web (`Found 201 voices` in the console). Not tested what it says.

## Next

1. Our own shell page: `Module.printErr` to an aria-live region, a text box that writes `a11y-cmd.txt`, start on a keypress.
2. Strip the `A11YDBG` lines, add a JS entry point (exported function) if file polling gets in the way.
3. Hosting test: `Packet.001` from R2, wasm and the rest from Workers static assets, timed on a real connection.
4. Try `--disable-translation` and drop the unused themes to cut first load.
