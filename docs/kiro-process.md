# Building Ghostlight in Kiro: process log

Dated entries, newest last. Each: what was asked, what Kiro did, credits and time, what went wrong, what was learned.
Inputs from the prep phase (Claude Code, before Kiro credits) are in `reference/`; nothing in `src/` comes from there.

## 01 · 6 Nov 2026 · Repo created and seeded
Private repo with an MIT licence at the root and GPL-3.0 in `engine/` (the ScummVM patch). `reference/` holds the design, spike findings, game census, draft pack and research. Next: P1, Kiro reads `reference/` and plays the project back without writing code.

## 02 · 6 Nov 2026 · Play-back (P1)
Asked Kiro to read everything in `reference/` and play the project back with no code. It read the design, process log, spike results, research and pack format (it skimmed the spike notes through `spike-results.md` and the census through the spike notes). The play-back was accurate: audience, the screen-reader-first rule, the one loop, architecture, what the spikes proved, the MIT/GPL split, core vs stretch, risks. It noted there's no `src/` or `.kiro/` yet. It didn't do the "what's wrong or missing" part of the prompt, only restated the known risks. It offered to draft specs and steering together; declined, to keep each step small and reviewable.
Files changed: none (read-only play-back, as asked). Time: about 10 minutes of reading and one written play-back. Credits: not recorded for this turn; add from Kiro usage if needed.
What was learned: the design docs are detailed enough to seed steering and specs directly. The one thing to watch is that a pure play-back prompt can drift into restating risks instead of surfacing new gaps, so future "review" prompts should ask explicitly for contradictions and missing pieces.

## 03 · 6 Nov 2026 · Foundation steering and the process-log hook (P2)
What was asked: generate the foundation steering files (product, tech, structure) from `reference/design.md`, add three more (accessibility always-on, pack-writing on `packs/**`, process-log always-on), and create one agent hook that checks the process log has an entry when a spec task finishes.
What Kiro did: wrote six steering files and one hook. `product.md`, `tech.md` and `structure.md` are distilled from the design doc. `accessibility.md` carries the hard rules (every functional line to an ARIA live region as text, nothing meaningful only on the canvas, keyboard only, voice is interruptible flavour, credit ScummVM's existing TTS and hotspot markers honestly). `pack-writing.md` uses `inclusion: fileMatch` on `packs/**` (plain British English, no em dashes, left/right positions, no spoilers, three-tier hints in our own words). `process-log.md` requires a dated entry after every spec phase and every task, then a commit and push. The hook (`.kiro/hooks/process-log-on-task.json`) fires on `PostTaskExec` and adds a missing entry; set `enabled: true` so it shows in the hooks panel.
Files changed: `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `.kiro/steering/structure.md`, `.kiro/steering/accessibility.md`, `.kiro/steering/pack-writing.md`, `.kiro/steering/process-log.md`, `.kiro/hooks/process-log-on-task.json`.
Time: about 20 minutes.
What went wrong or surprised you: the `createHook` tool wrote the hook without an `enabled` field, so it had to be added by hand to make the panel show it as on. Worth noting the process-log steering and the hook overlap on purpose: the steering tells Kiro to log per phase or task, and the hook is a backstop at task completion, so the hook will sometimes find an entry already there and do nothing.
What was learned: steering splits cleanly along "always true" (accessibility), "true for these files" (pack-writing), and "process we must not skip" (process-log). Keeping the accessibility rules short and absolute makes them easy to apply in later specs. Also: the repo currently commits to `main`; a working branch is not set up, so pushes go to `main` as the established pattern here.

## 04 · 6 Nov 2026 · ElevenLabs power installed (P2b)
What was asked: finish P2b: mark the ElevenLabs power as in use for generating the ghost's lines, add a row for a future custom "ScummVM Access" power, record this install, update the process-log steering and tech.md, then commit and push.
What Kiro did: installed the ElevenLabs power (6 Nov) for generating the ghost's hint lines with the Alice voice ("ASMR British Whisper") on `eleven_v4`, as decided in spike 06. Updated `kiro-features.md`: the Powers row is now split into the ElevenLabs power (in use) and a planned custom "ScummVM Access" power that will bundle the pack-writing steering, `drascula-mcp`, the pack validator hook and the map-a-room workflow near the end of the build. Added a steering rule to update `kiro-features.md` whenever a feature is first used, noted that pushing straight to `main` is fine in this repo, and added an API-key handling note to `tech.md`.
Files changed: `docs/kiro-features.md`, `docs/kiro-process.md`, `.kiro/steering/process-log.md`, `.kiro/steering/tech.md`.
Time: about 15 minutes.
What went wrong or surprised you: nothing of note. The ElevenLabs key is not in the repo; it stays in a gitignored `.env`, which is now written into `tech.md` as a rule.
What was learned: splitting the single Powers row into "installed and in use" versus "planned custom bundle" makes the feature table read as a timeline, which suits the Technological Implementation write-up. The custom power is the natural home for the transferable method once the pieces exist.
