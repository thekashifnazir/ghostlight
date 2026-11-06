# Tech

## Architecture

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

## How the engine and page talk

- The engine patch emits lines through `Module.printErr` (seen as `console.error`): `A11Y` on room entry, `A11Y_DIFF` after each action, `A11Y_TEXT` for spoken text.
- Room entry reports objects, hotspot rectangles, walk-to points, doors and destinations, inventory, and progress flags.
- `A11Y_DIFF` after each action gives one line: room or chapter change, objects appearing, inventory with names, flags, and what was said.
- The page sends commands by writing `/tmp/a11y-cmd.txt` via `FS.writeFile`. Launch with `--savepath=/tmp --subtitles`.
- Command layer verbs: `look/take/open/close/talk/push/walk/use/inv/choices/choose/skip/save`. Verbs call the engine's own verify/`checkAction`/`exitRoom` code, not pixel clicks.

## Engine patch

- C++ in a ScummVM fork, kept as a small, readable patch on `engines/drascula`.
- Plain enough to propose upstream later, but upstream is not a deadline goal.
- The pack format lines up with ScummVM's hotspot API (`getHotspotPositions()`, `HotspotType` = object/exit/NPC, PR #7135) so it could be proposed upstream.
- `HotspotInfo` has no id, so packs key on the engine's own per-room hotspot number.

## Build and size facts (from spikes, 6 Nov)

- Engine-only native build in about 15 s; needs the Ogg audio pack and `--extrapath` for `drascula.dat`.
- Emscripten build boots to the first room in about 1.5 s in Chrome (localhost).
- wasm is 10.6 MB (2.5 MB brotli). First load about 49.9 MB, mostly `Packet.001` (32.8 MB), which is over Cloudflare's 25 MiB static-asset limit, so the game data goes on R2.

## Voice

- Ghost voice: ElevenLabs "Alice, ASMR British Whisper" on `eleven_v4`, audio tags work. About $8 for the whole job at $0.08 per 1,000 characters.
- Pre-recorded voice is flavour only (see accessibility.md). The ghost's hints are the core voiced content; game dialogue and cutscene voicing are stretch.

## Sound

- All sound cues and sonar are synthesised with Web Audio. No audio files.
- Earcons: room entry, successful action, error, and per object type.
- Sonar: a key plays each object and exit in turn, panned by position, pitch for height, lowpass for distance, then one summary line to a polite live region.

## Hosting and licensing

- Cloudflare (Pages or Workers static assets) for the page and wasm; R2 for the game data. Near zero cost.
- The submission repo is **MIT** so the player, parser, pack format and tools are reusable.
- The ScummVM engine patch in `engine/` stays **GPL-3.0-or-later** (it modifies GPL code), and so does the built wasm.
- The game data is not committed. A script fetches it from ScummVM's official downloads with checksums. The hosted copy keeps the game's readme and a notice that it is modified.

## API keys

- API keys (ElevenLabs and any other) live in a local `.env` that is gitignored. Scripts load the key from `.env` at runtime.
- Never print a key to logs or output, and never commit one. Reference keys by name, not value.

## Screen readers

All three must work: VoiceOver (Mac, Safari and Chrome); NVDA and JAWS (Chrome) on Windows.

## Testing

- Property-based tests for the parser, the pack and the hint engine.
- Playwright for UI checks, driven through the MCP server.
- axe-core for accessibility violations across key states.
- ScummVM's own text-to-speech stays off by default so it does not talk over the player's screen reader.

## Reference, not source

The `reference/` folder holds the prep-phase design, spike findings, census, draft pack and research. Nothing in `src/` is copied from there. Kiro writes the specs and the code from what the spikes proved.
