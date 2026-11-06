# Kiro features in Ghostlight

One row per Kiro feature. Each earns its place for a reason, or it is not used. Update this file whenever a feature is first used (see the process-log steering rule). Status values: planned, in use, done, dropped.

| Feature | Planned use in Ghostlight | Why it earns its place | Status | Evidence path |
|---|---|---|---|---|
| Specs (spec-driven) | One spec per area (engine a11y layer, web player, pack format + Drascula pack, hints + ghost, sonar, survey crew, demo + hosting), each requirements → design → tasks in EARS | Complex, multi-part build; specs give control, review gates and a paper trail for Technological Implementation | planned | `.kiro/specs/` |
| Vibe coding | One throwaway task done by vibe coding (no spec) to compare against the spec-driven path | Shows an honest comparison: where a spec pays off and where it is overhead | planned | `docs/kiro-process.md` (the comparison entry) |
| Steering: always | product, tech, structure, accessibility, process-log | Rules that hold for every interaction: the accessibility hard rules and the process discipline | in use | `.kiro/steering/{product,tech,structure,accessibility,process-log}.md` |
| Steering: fileMatch | pack-writing on `packs/**` | Pack prose rules only matter when editing packs; scoping keeps context lean | in use | `.kiro/steering/pack-writing.md` |
| Steering: manual | engine gotchas file, pulled in with `#` when touching the patch | Dense, situational notes that would be noise if always on | planned | `.kiro/steering/engine-gotchas.md` |
| Steering: auto | a steering file activated on demand when a request matches its description | Context that should appear for matching requests without the user naming it | planned | `.kiro/steering/` (auto-inclusion file, TBD) |
| Hooks: file save | validate pack against schema on save; run parser and pack tests on save; rebuild wasm on engine patch save | Fast feedback; stops a broken pack or patch from lingering | planned | `.kiro/hooks/` |
| Hooks: task done | PostTaskExec hook that checks the process log has an entry for the finished task and adds one if missing | Backstop so the process log is never skipped | in use | `.kiro/hooks/process-log-on-task.json` |
| Hooks: pre-tool-use | block commits that contain keys; block writes into `vendor/` | Cheap guardrails against the two most likely mistakes (leaked key, edited vendored code) | planned | `.kiro/hooks/` |
| Custom agents | A verifier agent that re-runs checks and compares behaviour with the spec; a pack-reviewer agent that checks pack text for spoilers and style | Verification and prose review are repeatable, rule-bound jobs worth isolating | planned | `.kiro/agents/` |
| MCP servers | Our own `drascula-mcp` (the game as tools) plus Playwright for UI checks; an ElevenLabs MCP server to generate the ghost's lines | The game-as-tools server is the core dev/survey/test surface; ElevenLabs over MCP keeps voice generation in the loop and out of ad-hoc scripts | planned | `.kiro/settings/mcp.json`, `drascula-mcp/` |
| Property-based tests | Parser (any phrase naming exactly one visible object maps to it, never to an absent object); pack (every census room/object/door has an entry, milestone conditions refer to real flags); hints (never fire ahead of the player) | These are universal invariants; examples would miss edge cases | planned | `src/` and `packs/` test dirs |
| Powers: ElevenLabs | Generate the ghost's lines with the Alice voice on `eleven_v4` (installed 6 Nov) | Consolidated docs + tools for the voice job, in the loop rather than an ad-hoc script | in use | `docs/kiro-process.md` (install entry), ghost line generation |
| Powers: Context7 | Look up current docs for Emscripten, Web Audio, ARIA, Playwright and fast-check (installed 6 Nov) | Uses real, current APIs instead of guessing from memory, which matters for the wasm glue, sonar and tests | in use | `docs/kiro-process.md` (install entry) |
| Powers: ScummVM Access (custom) | A custom power we build near the end, bundling the pack-writing steering, `drascula-mcp`, the pack validator hook and the map-a-room workflow | Packages the whole "make a ScummVM game accessible" method into one installable unit so it transfers to other games | planned | custom power definition (TBD) |
| Kiro CLI / headless | Overnight survey runs and the full-chapter replay test | Long, unattended runs that should not hold a UI session open | planned | survey + replay scripts |
| Kiro Web / cloud sessions | Evaluate for running the survey or replay off the local machine | Only if a run is too long or costly to keep local; not core | planned | TBD |
| Kiro Crew | The survey crew that plays the game through `drascula-mcp`, drafts room names/descriptions and proposes milestones, with a human approving every entry | The "Crew beyond writing code" use; it is how the pack method transfers to other games | planned | separate public repo (Best Kiro Crew App) |
| Local sandbox | The survey crew runs inside the local sandbox | Keeps autonomous, repeated game-driving and file writes contained during long runs | planned | sandbox config + survey crew |
| Workflows | The recipe for mapping a new room or new game: capture → draft → human approve → validate | Turns the survey method into a repeatable, documented procedure | planned | `.kiro/` workflow definition |
| Memory | Pack-writing conventions remembered across sessions | Keeps pack prose consistent over many sessions without re-stating the rules | planned | Kiro memory |
| Autopilot | Default mode for end-to-end task runs; supervised mode for risky or review-heavy changes | Autopilot for throughput, supervised for the accessibility- and licence-sensitive edits | planned | `docs/kiro-process.md` |

## Notes

- Claude Code stays on research, spikes and outside verification. App code, specs and steering are written in Kiro so they show in `.kiro/`.
- Measure the credit cost of one Kiro Crew run before committing to it; billing is not documented.
- "Evidence path" is where a judge can see the feature in use once it is built.
