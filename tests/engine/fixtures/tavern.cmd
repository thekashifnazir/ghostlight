# tavern.cmd — chapter 1, room 62 (the tavern) command script.
#
# Used by the engine-a11y-layer replay checkpoints (scripts/replay.sh).
#
# At the task-6 checkpoint (reader + room state, before verb dispatch) every
# verb below answered with A11Y_ERR "no handler" — that was expected then.
# Tasks 8-11 added the real dispatch, so at the task-12 checkpoint these verbs
# now RUN the engine's own logic (verify2()/checkAction()/exitRoom()), not the
# "no handler" stub. This script exercises that real dispatch end to end:
#
#   * look / take / push / open / close on tavern objects
#   * look 50 and use <item> on 50 (the hero / self, object 50)
#   * a verb on an inventory item (the inventory-screen path)
#   * use <item> on <object>, with the item returned when it does not apply
#   * a free-point walk
#   * deliberately bad targets, to confirm A11Y_ERR still fires
#   * a door, exercising the engine's own exitRoom() door path (R3.8)
#
# Room 62 objects (live engine numbers from this build): 52 BARTENDER,
# 53 DRUNKARD, 54 PIANIST, 100 SKULL, 101 BIN, 102 POSTER, 103 BLACKBOARD,
# 104 DOOR (the inn door — never opens in chapter 1), 105/106 DOOR -> room 63.
# Inventory starts with the phone, item 28.
#
# Door 105 in chapter 1 is a good R3.8 door-path check: with the unlock flag
# clear, walking it runs the engine's exitRoom(), which returns the game's own
# "I DON'T HAVE A ROOM YET" text and stays in the room — correct game behaviour,
# not an A11Y_ERR, and poll() finds the room unchanged. (Once that flag is set
# via `talk 52`, the same `walk 105` runs the chapter 1 -> 2 crossing cutscene,
# after which poll() re-emits a fresh A11Y room-state line for the new room —
# but that cutscene only ends on `skip`, which lands in task 16. So the live
# room-change re-emit is left to the task-18 checkpoint, once skip/diffs exist;
# here the door PATH is exercised without a cutscene that cannot settle yet.)
#
# NOTE: A11Y_DIFF, text capture, conversations, inventory listing, cutscene
# skipping and saving land in tasks 13-19, so there is no A11Y_DIFF line yet
# and `talk`/`choose`/`choices`/`inventory`/`skip`/`save` are deliberately NOT
# used here — `talk` would open an un-settleable conversation/cutscene and the
# rest would still be "no handler". The way a change shows at this checkpoint is
# the room-state A11Y re-emit on a room change, plus `dump`.
#
# Blank lines and lines beginning with `#` are ignored by the reader (R2.3).

# Re-print the room we start in (tavern). Same A11Y format as room entry (R1.5).
dump

# --- verbs on room objects (real dispatch now, task 8) ----------------------
# Each is echoed as A11Y_CMD and runs the engine's own action for the object
# slot (verify2()/checkAction()), not the old "no handler" stub.
look 102
look 52
take 101
push 53
open 105
close 105

# --- the hero / self, object 50 (task 11) -----------------------------------
look 50

# --- a verb on an inventory item (inventory-screen path, task 11) -----------
# The phone (item 28) is in the inventory; `look 28` opens the inventory
# screen, runs the look-at-item action, and closes it again.
look 28

# --- use <item> on <object>, with item return (task 10) ---------------------
# Using the phone on the bartender does not apply, so the phone must be
# returned to the inventory (R3.5): the `dump` below should still list item 28.
use 28 on 52

# --- use <item> on 50 (the hero / self, task 11) ----------------------------
use 28 on 50

# Confirm the phone is still held after the non-applying uses above.
dump

# --- a free-point walk (task 9) ---------------------------------------------
# Walk the hero to a floor point; the engine clamps it to the walkable area.
walk 120 140

# --- deliberately bad targets (confirm A11Y_ERR still fires, R2.5) ----------
# 999 is not a room object, the hero, or an inventory item.
look 999
# `walk door` is not a number: a clear malformed-target error, not atoi() 0.
walk door
# use an item that is not in the inventory.
use 77 on 52

# --- the door path: locked door returns text, not an error (R3.8) -----------
# With the unlock flag still clear, walking door 105 runs the engine's own
# exitRoom(): it says "I DON'T HAVE A ROOM YET" and stays in the room — correct
# game behaviour, not an A11Y_ERR. poll() finds the room unchanged, so no new
# A11Y line follows. This confirms the door dispatch reaches exitRoom() and a
# locked door behaves as the game intends without hanging the queue.
walk 105

# Re-print the room, to confirm we are still in the tavern and the queue has
# drained cleanly after the door path (R1.5).
dump
