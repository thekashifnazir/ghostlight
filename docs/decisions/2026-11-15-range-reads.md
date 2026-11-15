# Decision: don't add ranged game-data reads before the freeze (15 Nov 2026)

**Decision (Kash, 15 Nov):** skip. Ghostlight keeps loading each game file whole. The change is proven and kept here, ready for later.

## The question

QuestAloud (the bring-your-own-game carry-on) needed ScummVM to read game files in byte ranges, so that a player's 1 GB CD game doesn't get read into memory. There, it cut memory growth from +1,945 MB to +264 MB with an 800 MB file the game never uses. Would the same change help Ghostlight's hosted games?

## What we checked

1. **Hosting.** Neither live path answers HTTP Range requests today. Drascula's Packet.001 comes from R2 through the Worker, and Queen's queen.1 comes from static assets, and both return 200 with the whole file. Ranged reads would need:
   - the Worker to answer Range with 206
   - queen.1 moved to R2
2. **A dry run on a throwaway copy.** We applied ScummVM's ranged http-fs patch (from QuestAloud), the Worker Range support and the build and deploy changes, then rebuilt the wasm. All suites passed on the range build: unit 549, replay 70/70, local live 16/16.
3. **Measured** to the first room, local Chrome:

| | Before | After |
|---|---|---|
| Drascula renderer memory | 594 MB | 545 MB |
| Queen renderer memory | 566 MB | 502 MB |
| Drascula game data downloaded | 37.2 MB | 27.4 MB |
| Queen game data downloaded | 27.3 MB | 7.2 MB |
| Drascula load at 10 Mbps, 40 ms latency | 43.9 s | 41.3 s |

## Why we skipped it

- **The memory win wasn't real for Ghostlight.** An early estimate of "1,200 MB down to 550 MB" compared the whole browser's memory with the renderer's alone. Measured like for like, the saving is about 10%. Ghostlight's games are small enough that whole-file loading costs little.
- **The real gain is download size.** Queen's game data drops by 74%, and Drascula starts about 2.6 s sooner on a slow link. That's useful, but modest.
- **The cost lands right before the freeze:**
  - a wasm rebuild
  - a new ScummVM backend patch
  - Worker changes
  - moving queen.1 to R2

  All of it would come less than two weeks before the 27 Nov build freeze, for a site that has to stay stable for judging until 29 Jan.

## What we kept

- The verified 8-file change: [`2026-11-15-range-reads.patch`](2026-11-15-range-reads.patch), against main `10e9418`. It covers the ScummVM http-fs patch, the build script, the Worker Range support and its test, and the deploy and source-page updates.
- QuestAloud keeps the ranged reads, because there they matter: player-owned CD games run to 1 GB and more.
- ScummVM's own source marks whole-file reads in its web filesystem as a TODO. So this is a small, self-contained change worth raising with the ScummVM team.

Measured and dry-run by Claude Code on 15 Nov; no Kiro credits spent, nothing deployed. Full log: hackathonideas `c418c83`.
