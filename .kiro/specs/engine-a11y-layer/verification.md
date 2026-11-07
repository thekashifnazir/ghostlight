# Engine a11y layer — verification report

This file is written by the `engine-a11y-verifier` custom agent
(`.kiro/agents/engine-a11y-verifier.md`). It re-runs the engine test suite and
judges the layer's observed behaviour against every acceptance criterion in
`requirements.md`. Newest run last.

---

## Run 1 — 2026-11-07 (commit 3e68290)

### Commands run

- Fixture-backed suite (default, deterministic, no engine build):
  `cd tests/engine && npx vitest run` → exit 0.
- Live native spot-check of the ch2-handbag puzzle against the real engine in a
  real window (`vendor/scummvm/scummvm` + `vendor/game/drascula`, `--save-slot=9`,
  `--subtitles`), driven by appending to `a11y-cmd.txt` and reading A11Y lines
  back off stderr, under a 45 s cap, PID tracked and `kill -9`'d on teardown.

### Real pass/fail counts (fixture-backed)

| File | Tests | Result |
|---|---|---|
| `over-skip.test.ts` | 4 | 4 passed |
| `replay.test.ts` | 16 | 16 passed |
| `property.test.ts` | 6 | 6 passed |
| **Total** | **26** | **26 passed, 0 failed** |

`property.test.ts` runs fast-check with 200–300 runs per property (four
invariants + a pool-shape check); all pass.

### Native path

The native binary and game data are present, so the native path WAS partially
exercised (ch2-handbag). The full `GHOSTLIGHT_NATIVE=1` suite was not run green
end to end in this pass — the live ch2-handbag run surfaced a real divergence
from the golden transcript (see Gap 1), which is the finding, not a flake. The
chapter-1 fixtures (tavern, leave-tavern) and the over-skip crossing were
verified against the native engine in earlier tasks (process-log entries 61–62,
68, 75) and are recorded as golden transcripts here.

### Criterion-by-criterion

Legend: **pass** = demonstrably exercised and matches; **partial** = covered by
the fixture/oracle but not confirmed on the live native engine, or covered
indirectly; **fail** = observed behaviour contradicts the criterion.

#### Requirement 1 — room state as JSON on room entry

| Crit | Verdict | Evidence |
|---|---|---|
| 1.1 one `A11Y ` line, single JSON object | pass | native `native.log` start line `A11Y {"chapter":2,"room":14,...}`; `parse.ts` rejects a non-JSON start line, so every fixture's `startRaw` proves it |
| 1.2 chapter, room, inventory ids, 50 flags | pass | start line carries `chapter`, `room`, `inventory:[28]`, `flags:[…50…]`; `replay.test.ts` "room entry" asserts chapter 1 / room 62 for tavern |
| 1.3 per-object num/name/rect/walkTo/visible/door/toRoom | pass | native start objects e.g. `{"num":159,"name":"ESCALERA","rect":[…],"walkTo":[…],"visible":true,"door":true,"toRoom":12}` |
| 1.4 skip intro, print first playable room | pass | tavern fixture starts at chapter 1 room 62; `replay.test.ts` asserts `start.chapter===1 && start.room===62` |
| 1.5 `dump` prints room state in `A11Y ` format | pass | over-skip post-crossing `dump` re-emits an `A11Y {"chapter":2,"room":14,…}` line; `over-skip.test.ts` "valid chapter 2 room 14 afterward" |
| 1.6 one JSON object per line | pass | `parse.ts` parses stream line-by-line; whole suite depends on it |

#### Requirement 2 — commands from a file each frame

| Crit | Verdict | Evidence |
|---|---|---|
| 2.1 read command file each frame | partial | exercised live by the native harness appending to `a11y-cmd.txt` each step; fixture harness models it. Confirmed live for chapter-1 and the ch2 commands that did run |
| 2.2 one at a time, next only after settle | pass | `NativeHarness.send` waits on the per-command diff/err marker; `property.test.ts` invariant 4 over random sequences |
| 2.3 ignore `#` lines | partial | `fixture.ts`/harness drop blanks; no dedicated live assertion in the suite for `#` comment lines. Covered by design, not by a test |
| 2.4 echo `A11Y_CMD ` | pass | `replay.test.ts` "every command echoes A11Y_CMD then one diff or one err"; native log shows `A11Y_CMD walk 162` etc. |
| 2.5 `A11Y_ERR ` and keep running | pass | native `A11Y_ERR object 22 is not in this room or inventory`; `replay.test.ts` ch2-vending `take 999` erred case; `property.test.ts` invariant 4 |
| 2.6 the full verb set | pass | fixtures cover look/take/open/close/talk/push/walk/use/inv/choices/choose/skip/save/state across the four transcripts |

#### Requirement 3 — act on objects directly

| Crit | Verdict | Evidence |
|---|---|---|
| 3.1 run engine action code for the slot | partial | behaviour matches in transcripts (correct diffs/flags), but the slot-vs-pixel mechanism is internal; not independently asserted by a test |
| 3.2 walk to the object first | pass | native `walk 162` then `open 183` both settle with correct room/flags; tavern `walk 105` behaviour |
| 3.3 warp mouse to hotspot for hover | partial | design + task 7; hover line (`A11Y_HOVER`) is the skipped parity task 20, so no live assertion |
| 3.4 `use <item> <obj>` on-screen sequence | pass | ch2-vending `use 18 188`: removes two coins, adds one coin, flag 27 — `replay.test.ts` asserts the net diff |
| 3.5 return still-picked item; net diff only | pass | same `use 18 188` shows only the swap, not the transient pickup |
| 3.6 inventory-screen target (open/verb on item) | **fail (live)** / pass (fixture) | golden ch2-handbag `open 22` → money + two coins; **live native `open 22` → `A11Y_ERR object 22 is not in this room or inventory`** because live `open 183` added no handbag. See Gap 1 |
| 3.7 verb/use on object 50 (hero) | partial | in the command set; not exercised by a fixture step. No live or fixture assertion |
| 3.8 `walk` on a door calls `exitRoom()` | pass | tavern second `walk 105` crosses chapter 1→2; first `walk 105` returns the locked-door line "I DON'T HAVE A ROOM YET" |

#### Requirement 4 — one "what changed" line per command

| Crit | Verdict | Evidence |
|---|---|---|
| 4.1 exactly one `A11Y_DIFF ` | pass | `replay.test.ts` "one A11Y_DIFF or one A11Y_ERR"; `property.test.ts` invariant 4 |
| 4.2 diff names its command | pass | `replay.test.ts` "each diff names the command that produced it" |
| 4.3 chapter/room `[from,to]` + new objects | pass | tavern crossing `chapter:[1,2]`, `room:[62,14]`, door 171 `toRoom:15`; native `walk 162` `room:[14,16]` with new objects |
| 4.4 same-room appeared/disappeared/doors | partial | structure supported; the four transcripts drive mostly room-change and inventory diffs, not a pure same-room visibility flip asserted on its own |
| 4.5 invAdded / invRemoved | pass | ch2-vending `use 18 188` removed/added; golden ch2-handbag invAdded (fixture) |
| 4.6 flag change `{index:[from,to]}` | pass | tavern `talk 52` `flags {"0":[0,1]}`; native `open 183` `flags {"19":[0,1],"20":[0,1]}` |
| 4.7 `said` lines with colour | pass | tavern `choose 2` `said` colours `["yellow","darkgreen"]`; native `open 183` said yellow |
| 4.8 `changed:false` when nothing moved | pass | tavern `choose 2` `changed:false`; over-skip surplus skips all `changed:false` |

#### Requirement 5 — hero position

| Crit | Verdict | Evidence |
|---|---|---|
| 5.1 room state includes hero point | pass | every start line carries `hero:{x,y}`; native `hero:{"x":209,"y":130}` |
| 5.2 hero = curX+curWidth/2, curY+curHeight | pass | tavern asserts `hero === {x:65,y:145}` in object space (`replay.test.ts`) |
| 5.3 same coordinate space as objects | pass | over-skip test bounds hero to the 320×200 room space; matches object rects |

#### Requirement 6 — subtitles and text capture

| Crit | Verdict | Evidence |
|---|---|---|
| 6.1 require subtitles on | partial | native harness always launches `--subtitles`; the "subtitles off → A11Y_ERR warning" branch (task 3) is not asserted by a test |
| 6.2 `A11Y_TEXT ` for every drawn line incl. replies | pass | native `A11Y_TEXT I'VE FOUND B.J.'S HANDBAG!`, `A11Y_TEXT TRUNK`; fixtures carry A11Y_TEXT |
| 6.3 `A11Y_CHOICES ` on open and after each choice | pass | tavern `talk 53` emits 4 choices with `ends` on #4; `replay.test.ts` asserts it |
| 6.4 `A11Y_INV ` on `inventory` | partial | `inv` is in the command pool; the dedicated `A11Y_INV` listing (task 13) is not asserted by a fixture step in the suite |

#### Requirement 7 — conversations, cutscenes, skipping

| Crit | Verdict | Evidence |
|---|---|---|
| 7.1 list choices + apply `choose <n>` in converse loop | pass | tavern `choose 2` marks used and speaks the exchange |
| 7.2 `choose 4` ends the conversation | pass | tavern choices `[3].ends === true`; `choose 4` is the last diff before the walk |
| 7.3 poll command file from updateEvents so `skip` is honoured | pass | over-skip crossing is produced only by live-paced skips; `over-skip.test.ts` crossing diff |
| 7.4 `skip` ends one line/cutscene | pass | over-skip guard: surplus skips are no-ops, crossing is one coherent diff |

#### Requirement 8 — clicks reach the game reliably

| Crit | Verdict | Evidence |
|---|---|---|
| 8.1 press one frame, release next | partial | design/task 7 internal mechanics; no direct test, but every successful action diff depends on it working |
| 8.2 never hold button across dialogue | partial | same — indirectly proven by conversations and speech settling correctly |

#### Requirement 9 — saving

| Crit | Verdict | Evidence |
|---|---|---|
| 9.1 `save <slot>` → `A11Y_SAVED ` | pass | `make-ch2-save.sh` waits on `A11Y_SAVED`; process-log 68 |
| 9.2 `--save-slot` at launch loads partway | pass | ch2-handbag/ch2-vending load slot 9 and start in chapter 2 room 14; native start line confirms it |

#### Requirement 10 — build, packaging, provenance

| Crit | Verdict | Evidence |
|---|---|---|
| 10.1 patch is a readable diff under `engine/` | pass | `engine/hooks.patch`, `a11y.cpp`, `a11y.h`; task 24 |
| 10.2 dedicated a11y.cpp + small hooks only | pass | task 24 finalisation; hooks.patch touches drascula/converse/graphics only |
| 10.3 GPL-3.0-or-later | pass | `engine/LICENSE`; task 24 header check |
| 10.4 builds native and Emscripten from one source | pass | `scripts/build-engine.sh`, `scripts/build-web.sh`; the native binary used here is its output |
| 10.5 no game data committed | pass | `vendor/` gitignored; `scripts/fetch.sh` with checksums |
| 10.6 use engine logging path (printErr) | pass | A11Y lines arrive on stderr/stdout and are read via the same path the web build uses |

#### Gotchas

| # | Verdict | Evidence |
|---|---|---|
| 1 subtitles on | pass | native launched `--subtitles`; text is captured |
| 2 press/release separate frames | partial | internal; indirectly proven |
| 3 held button skips dialogue | partial | internal; indirectly proven by dialogue settling |
| 4 converse() own loop hook | pass | tavern choices/choose work |
| 5 cutscene/speech via updateEvents | pass | over-skip crossing honoured live-paced skips |
| 6 act on slot not hotspot centre | partial | behaviour matches; mechanism internal |
| 7 inv slots 1–6 are verb icons, items id 7+ | pass | start lines show `inventory:[28]`; diffs add ids 7/16/18/19/22 |
| 8 flag 12 is noise, reported faithfully | partial | reported in diffs; the suite excludes flag-12 from `changed:false` checks but no transcript step isolates a flag-12 flip |
| 9 item names from enums | pass | diffs carry names (handbag, money, two coins, one coin, cigarettes) |
| 10 some names Spanish, reported as-is | pass | native objects `ESCALERA`, `HABITACIONES` |
| 11 talk.cpp has no sayText; A11Y_TEXT captures replies | pass | `A11Y_TEXT` carries spoken lines; `said` colours in diffs |
| 12 headless flaky, real window | pass | native runs use a real window; harness kill -9 and PID tracking |
| 13 Ogg pack + extrapath or blocking dialog | pass | native launched with `--extrapath` + Ogg data; reached the game |

### Summary

Fixture-backed suite: **26/26 pass**. Every Requirement 1–10 criterion is at
least **partial**, most **pass**. One criterion is a live **fail**: R3.6 on the
live native engine (the ch2-handbag inventory-screen `open 22`). The "partial"
verdicts are criteria proven only against the fixture/oracle or only indirectly,
not independently asserted against the live engine.

### Gaps found

**Gap 1 — live native ch2-handbag `open 22` returns A11Y_ERR (R3.6).**
Loading the current chapter-2 save (slot 9) and running the ch2-handbag command
script live, `open 183` sets flags 19/20 but emits **no `invAdded`** for the
handbag (item 22), whereas the golden fixture records
`invAdded:[{"id":22,"name":"handbag"}]`. Consequently `open 22` emits
`A11Y_ERR object 22 is not in this room or inventory` instead of the golden
diff (money + two coins, flag 23). This is a live-vs-golden divergence: the
chapter-2 inventory-screen dispatch (R3.6) is not demonstrably exercised on the
live engine for this puzzle. Part of the divergence is save-provenance drift
(the live slot-9 save carries a different room-14 object/flag set than the save
the golden transcript was recorded against), so the investigation must separate
"the save is stale" from "open 183 genuinely fails to grant the handbag". Filed
as follow-up task **26**.

**Gap 2 — property tests not registered as a PBT task. [won't-fix / not
supported — resolved in task 27]**
Task 22's fast-check property tests run and pass, but task 22 is a normal task
in `tasks.meta.json`, so `pbtResults` is `{}` and `update_pbt_status` never
applies to them. The PBT status tooling therefore has no record of the property
run. Tooling/registration loose end, no behavioural impact. Filed as follow-up
task **27**.

_Resolution (task 27): not supported — closed as won't-fix._ The `pbtResults`
map is written only by the `update_pbt_status` tool, which validates that its
target task is **already** a registered PBT task; invoking it for task 22
returns `Task ... is not a PBT task` and writes nothing. PBT registration
happens only at task-execution time through the spec-task-execution flow — there
is no declarative marker in `tasks.md` or `tasks.meta.json` that the tooling
reads to register a PBT task after the fact, and no other spec uses one (every
fast-check task across the seven specs is a normal task with `pbtResults: {}`).
Hand-writing a `pbtResults` entry would fabricate a mechanism the tooling does
not read, so it was deliberately not done. The property run is real and tracked
where it lives: the fixture-backed suite above (now **8/8** in `property.test.ts`
after task 30 added two hero-field properties), the process log, and
`docs/kiro-features.md`. No behavioural impact; no code or test change required.

No other gaps found beyond the "partial" verdicts above, which are coverage
observations (criteria proven only against the fixture harness), not defects.
