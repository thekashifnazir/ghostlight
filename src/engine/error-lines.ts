// Map raw engine A11Y_ERR text to a plain, helpful player line.
//
// A playtest found raw engine errors reaching the player's live region, with
// internal hotspot and item numbers in them: "object 171 is not in this room",
// "object 53 is not in this room or inventory". These are the engine's own
// A11Y_ERR lines (engine/a11y.cpp), developer diagnostics, not player output.
// screen-reader-output.md is explicit: raw engine diagnostics are internal
// context, and no number the engine uses internally should ever be spoken.
//
// This module is the one place that turns an A11Y_ERR message into what the
// player hears. It is pure (no DOM, no console) so it is trivially testable;
// the caller (main.ts) logs the raw text for debugging and announces the
// mapped line. Any message with no specific mapping falls back to a generic,
// number-free line rather than leaking the raw text.

/** What the player should hear and do about one engine error. */
export interface MappedError {
  /**
   * The plain, number-free line to announce in the live region. Never contains
   * an engine object/item number or an `A11Y_` prefix.
   */
  line: string;
  /**
   * True when the error means the player's room model is out of step with the
   * engine's — the player tried to act on an object the engine says is not in
   * the room, so the list the player is reading from no longer matches engine
   * truth. The caller re-requests the engine's room state and re-reads the
   * room so the two are back in sync. False for errors that carry no such
   * implication (a bad save slot, an unknown verb).
   */
  resync: boolean;
}

/** The line shown when an object the player acted on is no longer in the room. */
const GONE_LINE = "That isn't here any more. Press L to hear the room.";

/** The generic fallback for any engine error we do not have a specific line for. */
const GENERIC_LINE = "That didn't work. Press L to hear the room.";

/**
 * Map one raw engine A11Y_ERR message (the text AFTER the `A11Y_ERR ` prefix,
 * which `parseA11yLine` has already stripped) to a player-facing line.
 *
 * The messages that reach a player mid-play are the "not in this room"
 * families, emitted when a verb or `use` targets a hotspot/item the engine no
 * longer has in the current room or inventory (engine/a11y.cpp). Each carries
 * an internal number we must never speak. We detect these regardless of the
 * exact number and map them to a single number-free line, and flag the two
 * that mean the room model drifted so the caller can re-sync:
 *
 *   - "object <n> is not in this room"               -> drifted room model
 *   - "object <n> is not in this room or inventory"  -> drifted room model
 *   - "<n> is a verb slot, not an inventory item …"  -> bad target, no re-sync
 *   - "item <n> is not in the inventory"             -> bad item, no re-sync
 *
 * Fix C adds the busy watchdog's two lines (engine/a11y.cpp runBusyWatchdog),
 * mapped to plain player lines with no re-sync:
 *   - "busy: engine not accepting commands" -> "The game is busy. Trying to
 *     move on."
 *   - "busy: commands dropped"              -> "The game didn't respond. Press
 *     L to hear where you are."
 *
 * Everything else (a malformed command, an unknown verb, a bad save slot) maps
 * to a generic number-free line and never re-syncs.
 */
export function mapEngineError(message: string): MappedError {
  const text = message.trim();

  // "object <n> is not in this room" / "... or inventory": the player acted on
  // a hotspot the engine says is not present. It covers both the verb-on-object
  // form ("object <n> is not in this room or inventory", a11y.cpp) and the walk
  // form ("object <n> is not in this room"). The list the player is reading was
  // built from an earlier room state, so it has drifted from engine truth —
  // re-request the engine's room state and re-read the room.
  if (/^object\s+\d+\s+is not in this room(\s+or inventory)?$/i.test(text)) {
    return { line: GONE_LINE, resync: true };
  }

  // "item <n> is not in the inventory": the player tried to use/act on an item
  // they are not carrying. The inventory, not the room list, is stale here; a
  // plain "you aren't carrying that" is clearer than re-reading the room.
  if (/^item\s+\d+\s+is not in the inventory$/i.test(text)) {
    return {
      line: "You aren't carrying that any more. Press Tab for your inventory.",
      resync: false,
    };
  }

  // "busy: engine not accepting commands" / "busy: commands dropped": the Fix C
  // busy watchdog (engine/a11y.cpp). The engine wedged so A11Y_PHASE busy would
  // otherwise be permanent; the watchdog reports it in two stages. Map each to a
  // plain, number-free player line. Neither re-syncs the room model (the room is
  // unchanged; the watchdog is about the engine not responding, not a drifted
  // object list) — the second line itself tells the player to press L.
  if (/^busy:\s*engine not accepting commands$/i.test(text)) {
    return { line: "The game is busy. Trying to move on.", resync: false };
  }
  if (/^busy:\s*commands dropped$/i.test(text)) {
    return {
      line: "The game didn't respond. Press L to hear where you are.",
      resync: false,
    };
  }

  // Everything else: a number-free generic line. This also catches the
  // argument-shape errors ("verb needs an object number…", "use takes…") and
  // unknown verbs ("no handler for command: fly"), none of which a player using
  // list mode can trigger, but which must never leak their raw text either.
  return { line: GENERIC_LINE, resync: false };
}
