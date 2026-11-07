# tavern.cmd — chapter 1, room 62 (the tavern) full-loop command script.
#
# Used by the engine-a11y-layer replay checkpoints (scripts/replay.sh).
#
# By the task-18 checkpoint every piece of the loop exists: A11Y_DIFF (task 17),
# text capture (14), conversations (15), cutscene/speech skip (16) and the
# snapshot diff that carries a chapter/room change (17). This script drives the
# WHOLE loop end to end in one real-window run, in the order the game allows:
#
#   room-state A11Y on entry  ->  a look that SAYS a line and reports a
#   changed:false diff with that `said` text  ->  a conversation (talk opens
#   A11Y_CHOICES, choose <n> replies, choose 4 ends it)  ->  a state-changing
#   command (talk 52 sets progress flag 0, changed:true)  ->  a real door room
#   change through the chapter 1 -> 2 crossing (walk 105 + skip, one coherent
#   room-change A11Y_DIFF)  ->  a bad command (A11Y_ERR, no diff).
#
# Each dispatched game command echoes as A11Y_CMD and then produces EXACTLY ONE
# A11Y_DIFF *or* at least one A11Y_ERR, never both and never neither (task 17 /
# R4.1 / R2.5). Flag 12 flips on its own on many actions; the layer reports it
# faithfully but does not count it as `changed` (gotcha 8).
#
# Room 62 objects (live engine numbers from this build): 52 BARTENDER,
# 53 DRUNKARD, 102 BOTTLE, 105 DOOR -> room 63 (the way out to chapter 2).
# Inventory starts with the phone, item 28.
#
# NOTE: this stays a readable, reusable SMOKE script. Task 21 formalises the
# four spike scripts (tavern/leave-tavern/ch2-handbag/ch2-vending-machine) into
# regression fixtures that assert the full A11Y_DIFF sequence; the golden
# transcript for this run lives in tavern.json. Keep the two in step.
#
# Blank lines and lines beginning with `#` are ignored by the reader (R2.3).

# --- room state on entry (R1.5) ---------------------------------------------
# Re-print the room we start in (the tavern), same A11Y format as room entry.
dump

# --- a look that says a line + changed:false diff with `said` text (R4.7/4.8) -
# look 102 (the wine bottle) runs the engine's own look action: it SPEAKS a
# line (captured as A11Y_TEXT, then carried in the diff's `said` with its
# colour), and nothing in the world moves, so the A11Y_DIFF is changed:false.
# Flag 12 may flip here; it is reported but not counted as a change (gotcha 8).
look 102

# --- a conversation: open choices, reply, end (task 15, R7.1/R7.2/R6.3) ------
# talk 53 (the drunkard) opens the conversation: an A11Y_CHOICES line lists the
# four option phrases (option 4 carries "ends":true). choose 2 clicks option 2,
# the drunkard replies (A11Y_TEXT for both the player line and the reply, both
# in the diff's `said` with colours), and the option list re-opens with option 2
# now "used":true. choose 4 is the goodbye line and ends the conversation.
talk 53
choose 2
choose 4

# --- a state-changing command: changed:true with a flag move (R4.6) ----------
# talk 52 (the bartender), the chapter-1 progression: the bartender exchange
# sets progress flag 0 from 0 to 1 (this is what unlocks the way out). The diff
# reports flags {"0":[0,1]}, the spoken lines under `said`, and changed:true.
talk 52

# --- a real door room change: the chapter 1 -> 2 crossing (R3.8 + R4.3) ------
# Now that flag 0 is set, walking door 105 runs the engine's own exitRoom(),
# which plays the chapter 1 -> 2 crossing cutscene (animation_2_1) and enters
# chapter 2. That cutscene runs its own loop, so a queued `skip` is honoured
# from the updateEvents() hook to abort it and return control (task 16). poll()
# then builds ONE coherent room-change A11Y_DIFF: chapter [1,2], room [62,14],
# with the NEW room's objects (doors carrying their toRoom). This is the real
# door transition the task-12 and task-17 checkpoints deferred to here — the
# room-change A11Y_DIFF path proven on a real in-game transition, not faked.
walk 105
skip

# --- a bad command: A11Y_ERR and NO diff (R2.5 / R4.1) -----------------------
# 999 is not a room object, the hero, or an inventory item, so dispatch cannot
# run it: one A11Y_ERR, and emitDiff() suppresses the A11Y_DIFF for the erring
# command (exactly one of diff XOR err per dispatched command). The layer keeps
# running and drains the queue cleanly.
look 999

# Re-print the (chapter-2) room we ended in, to confirm the queue drained
# cleanly and the crossing settled (R1.5).
dump
