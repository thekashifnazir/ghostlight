import { describe, expect, it } from "vitest";
import { mapEngineError } from "../src/engine/error-lines.js";

// The exact raw A11Y_ERR messages the engine emits (engine/a11y.cpp), after
// parseA11yLine has stripped the `A11Y_ERR ` prefix. These are the lines an
// uninformed playtest heard spoken verbatim, numbers and all.
const RAW_ERRORS = [
  "object 171 is not in this room",
  "object 53 is not in this room or inventory",
  "object 999 is not in this room or inventory",
  "object 22 is not in this room",
  "item 28 is not in the inventory",
  "7 is a verb slot, not an inventory item (items are id 7+)",
  "cannot use item 28 on itself",
  "target 90 is not a room object, an inventory item, or the hero (50)",
  "no handler for command: fly",
  "no conversation is open",
  "verb needs an object number, e.g. `look 52`",
  "object must be a number, got: banana",
  "save slot must be 1 or greater, got: 0",
  "use needs a target: `use <item> on <object>`",
  "walk needs a target: `walk <object>` or `walk <x> <y>`",
];

describe("mapEngineError", () => {
  it("never leaks an engine number or an A11Y_ prefix in the announced line", () => {
    for (const raw of RAW_ERRORS) {
      const { line } = mapEngineError(raw);
      // The headline requirement: no `object <digits>` and no `A11Y_` token
      // ever reaches the player.
      expect(line).not.toMatch(/object\s+\d+/i);
      expect(line).not.toMatch(/A11Y_/);
      // And no bare internal number at all (e.g. "item 28", "target 90").
      expect(line).not.toMatch(/\b\d+\b/);
    }
  });

  it("maps 'object N is not in this room' to the plain 'gone' line and asks to re-sync", () => {
    const r = mapEngineError("object 171 is not in this room");
    expect(r.line).toBe("That isn't here any more. Press L to hear the room.");
    expect(r.resync).toBe(true);
  });

  it("maps 'object N is not in this room or inventory' the same way and re-syncs", () => {
    const r = mapEngineError("object 53 is not in this room or inventory");
    expect(r.line).toBe("That isn't here any more. Press L to hear the room.");
    expect(r.resync).toBe(true);
  });

  it("maps 'item N is not in the inventory' to an inventory line and does not re-sync", () => {
    const r = mapEngineError("item 28 is not in the inventory");
    expect(r.line).toMatch(/aren't carrying/i);
    expect(r.resync).toBe(false);
  });

  it("falls back to a generic number-free line for any other error, no re-sync", () => {
    const r = mapEngineError("no handler for command: fly");
    expect(r.line).toBe("That didn't work. Press L to hear the room.");
    expect(r.resync).toBe(false);
    // The raw text (and its 'fly' verb) is not echoed to the player.
    expect(r.line).not.toContain("fly");
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const r = mapEngineError("  OBJECT 42 IS NOT IN THIS ROOM  ");
    expect(r.resync).toBe(true);
    expect(r.line).not.toMatch(/\d/);
  });

  // Fix C: the busy watchdog's two escalation lines (engine/a11y.cpp
  // runBusyWatchdog) must map to the exact plain player lines the brief names,
  // and never re-sync the room model.
  it("maps 'busy: engine not accepting commands' to the trying-to-move-on line", () => {
    const r = mapEngineError("busy: engine not accepting commands");
    expect(r.line).toBe("The game is busy. Trying to move on.");
    expect(r.resync).toBe(false);
  });

  it("maps 'busy: commands dropped' to the didn't-respond line", () => {
    const r = mapEngineError("busy: commands dropped");
    expect(r.line).toBe(
      "The game didn't respond. Press L to hear where you are.",
    );
    expect(r.resync).toBe(false);
  });

  it("maps the busy lines case-insensitively and with surrounding whitespace", () => {
    expect(mapEngineError("  BUSY: ENGINE NOT ACCEPTING COMMANDS ").line).toBe(
      "The game is busy. Trying to move on.",
    );
    expect(mapEngineError("Busy:   commands dropped").line).toBe(
      "The game didn't respond. Press L to hear where you are.",
    );
  });

  it("does not leak a number or an A11Y_ prefix in either busy line", () => {
    for (const raw of ["busy: engine not accepting commands", "busy: commands dropped"]) {
      const { line } = mapEngineError(raw);
      expect(line).not.toMatch(/\b\d+\b/);
      expect(line).not.toMatch(/A11Y_/);
    }
  });
});
