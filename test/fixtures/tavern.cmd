# tavern.cmd — chapter 1, room 62 (the tavern) command script.
#
# Used by the engine-a11y-layer replay checkpoints. At the task-6 checkpoint
# (reader + room state, before verb dispatch) the verbs below are echoed as
# A11Y_CMD and then answered with A11Y_ERR "no handler" — that is expected and
# correct for this checkpoint. `dump`/`state` already have a handler and
# re-emit the full A11Y room state. Later checkpoints (tasks 12, 18) run richer
# scripts once dispatch, diffs and conversations land; task 21 turns the full
# spike scripts into regression fixtures.
#
# Blank lines and lines beginning with `#` are ignored by the reader (R2.3).

# Re-print the room we start in (tavern). Same A11Y format as room entry (R1.5).
dump

# A few verbs on tavern objects (bartender 52, phone 28). Echoed as A11Y_CMD;
# no handler yet at this checkpoint, so each gets one A11Y_ERR and the layer
# keeps running (R2.4, R2.5).
look 52
take 100
talk 52

# The low-level state command, to confirm a second dump round-trips cleanly.
state
