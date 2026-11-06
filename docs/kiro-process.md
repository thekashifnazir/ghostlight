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

## 05 · 6 Nov 2026 · Context7 power installed
What was asked: add a Context7 power row to `kiro-features.md`, log the install, then author the engine-a11y-layer spec (requirements, design, tasks only, no code).
What Kiro did: installed the Context7 power (6 Nov) so Kiro can look up current docs for Emscripten, Web Audio, ARIA, Playwright and fast-check rather than guessing APIs from memory. Marked it in use in the feature table.
Files changed: `docs/kiro-features.md`, `docs/kiro-process.md`.
Time: a few minutes (the spec itself is logged separately).
What went wrong or surprised you: nothing.
What was learned: Context7 pairs naturally with the areas that lean on external APIs we do not control: the wasm glue (Emscripten FS and Module), sonar (Web Audio), the live region (ARIA), and the test stack (Playwright, fast-check). Worth reaching for before writing any of those.

## 06 · 6 Nov 2026 · Spec authored: engine a11y layer
What was asked: create the engine-a11y-layer spec (requirements, design, tasks) for a readable GPL patch to ScummVM's Drascula engine that prints room state as JSON on entry, accepts file commands each frame, prints one "what changed" line per command, and adds the hero position. Take requirements from spikes 02 and 04 including every gotcha, use EARS, and write no code.
What Kiro did: read spikes 02 and 04 in full. Wrote `requirements.md` (10 EARS requirements plus a 13-item gotcha checklist), `design.md` (architecture, hook points, command dispatch table, JSON formats for `A11Y`/`A11Y_DIFF`/`A11Y_CHOICES`/`A11Y_INV`, the synthetic-click model, settling, build config, testing strategy) and `tasks.md` (19 tasks, each citing requirements and gotchas). Stopped at tasks.md; no code.
Files changed: `.kiro/specs/engine-a11y-layer/requirements.md`, `.kiro/specs/engine-a11y-layer/design.md`, `.kiro/specs/engine-a11y-layer/tasks.md`, `docs/kiro-features.md` (Context7 row), `docs/kiro-process.md`.
Time: about 35 minutes.
What went wrong or surprised you: nothing broke. The subtle part was settling: a single `walk` out of the tavern crosses into chapter 2 via a cutscene, so the design had to make clear that one command can produce one diff that spans a chapter and room change. The gotchas split cleanly into "the engine layer must handle" (subtitles, click framing, direct object actions, conversation and cutscene loops) versus "report faithfully, fix downstream" (flag 12 noise, Spanish names).
What was learned: every gotcha from the spikes maps to a specific acceptance criterion or task, so the spike findings carried straight into testable requirements. Carrying the gotchas as an explicit checklist in requirements.md keeps them from being lost when tasks are picked up later.

## 07 · 6 Nov 2026 · Spec revised and approved: engine a11y layer
What was asked: revise the engine-a11y-layer design and tasks before approval: keep our engine code in `engine/` (a11y.cpp, a11y.h, hooks.patch) applied onto a pinned `vendor/` ScummVM checkout via `scripts/build-engine.sh` (never hand-edit vendor); add an early `scripts/fetch.sh` task (pinned clone plus sha256-checked Drascula freeware data); replace the diff unit-test task with TypeScript + fast-check property tests against the real engine; run replay on the native build in a real window; add tavern-replay checkpoints after the reader+room-state, core dispatch and diff milestones; and finish with a verifier custom agent run against requirements.md.
What Kiro did: updated `design.md` (new "Where the code lives" and "Fetch and build" sections, native-build testing, four property invariants, verifier agent as the final step) and rewrote `tasks.md` to 24 tasks with the fetch script first, the engine/build-script layout second, three replay checkpoints (tasks 6, 12, 18), property-based tests (task 22) and the verifier agent (task 24). Committed the spec with the four process screenshots in `docs/screenshots/`.
Files changed: `.kiro/specs/engine-a11y-layer/design.md`, `.kiro/specs/engine-a11y-layer/tasks.md`, `docs/screenshots/*` (four PNGs), `docs/kiro-process.md`.
Time: about 20 minutes.
What went wrong or surprised you: nothing. Noted for the build phase that property-based tests drive a full native engine run per generated sequence, so the run count will need a cap.
What was learned: splitting fetch (reproducible vendor) from build (apply our engine/ sources) keeps the GPL patch a clean, reviewable artifact and the game data out of git. Checkpoints tied to the tavern replay give cheap go/no-go gates between dispatch milestones.
