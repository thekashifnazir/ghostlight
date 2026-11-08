# transport-settle — requirements

A bugfix spec. The drascula-mcp native transport (`mcp/src/native.ts`) sometimes
never sees a command settle, so the MCP call hangs for the full hard cap and the
surveyor's run stalls. Kiro Crew's surveyor saw `talk 53` time out after 60 s
from save slot 10, while the identical call settled at once by hand earlier.
This is the same class of defect as the earlier no-op `skip` timeout: a command
whose terminal A11Y marker the transport never matches.

Scope is strictly `mcp/`, `engine/`, and `tests/engine/`.

## Reproduce first (before any change)

See `design.md` → "Reproduction" for the harness and the recorded before/after
numbers. The reproduction ran two fifty-iteration sweeps of the surveyor's
sequence (`talk 53`, `choose 3`, `choose 4`) from a fresh start, counting
timeouts and settle times, plus a deterministic unit reproduction of the hang.

## Requirements (EARS)

### R1 — No settle hang from stream interleaving

1.1 WHEN the engine prints a line on stderr (its A11Y lines) while the child is
also writing on stdout (startup banner, debug chatter), the transport SHALL
parse each stream's lines independently, so a partial line on one stream never
corrupts a line on the other.

1.2 WHEN an A11Y line is split across two chunks on the same stream, the
transport SHALL reassemble it from that stream's carry.

1.3 WHEN a command's terminal marker (A11Y_DIFF, A11Y_ERR, or A11Y_CHOICES for a
`talk`/`choices`) is emitted, the transport SHALL match it and settle the
command, regardless of unrelated stdout/stderr traffic around it.

### R2 — A `choose` surfaces its diff so flags need no `state`

2.1 WHEN a non-ending `choose` settles, the transport SHALL settle on that
choose's A11Y_DIFF (which carries the committed flags), not on the re-presented
A11Y_CHOICES that the engine emits just before it.

2.2 WHEN a non-ending `choose` re-presents the option list, the transport SHALL
still carry that A11Y_CHOICES in the result's events, so nothing is lost.

2.3 WHEN an ending `choose` (option 4) settles, the transport SHALL settle on its
A11Y_DIFF (emitted at conversation end).

2.4 The engine SHALL include every changed progress flag in each `choose`'s
A11Y_DIFF and in the conversation-end diff, so a caller reading the choose
replies sees a flag commit without a follow-up `state` round-trip.

### R3 — `talk`/`choices` keep settling on choices

3.1 WHEN a `talk` opens a conversation, the transport SHALL settle on the
A11Y_CHOICES (the talk's own diff is deferred and arrives out of order after a
later `choose`, so waiting for it would deadlock).

3.2 WHEN a `choices` command re-lists the options, the transport SHALL settle on
the A11Y_CHOICES.

### R4 — A true non-settle returns a clear, fast error

4.1 WHEN a command produces no A11Y output for about 10 s (engine genuinely
stalled), the transport SHALL return a clear error naming the command and the
last A11Y line seen, rather than 60 s of silence.

4.2 WHEN a command is still producing A11Y output (an echo, a drawn line, a
choices refresh), the transport SHALL NOT time it out — the ~10 s cap is a
quiet-period (inactivity) cap, reset on every A11Y line, so a legitimately slow
command (a multi-second conversation reply, a paced cutscene) is never cut off.

4.3 WHEN the engine is booting on start(), the transport SHALL allow a longer cap
(unchanged 60 s) so a cold boot is not mistaken for a hang.

### R5 — Tests and builds stay green

5.1 The engine tests (`tests/engine/`) and the MCP tests (`mcp/`) SHALL pass.

5.2 The native and web engine SHALL build. (No engine source changed in this
fix — see design — so the rebuild verifies the build still works and the wasm is
unchanged. Nothing is deployed.)
