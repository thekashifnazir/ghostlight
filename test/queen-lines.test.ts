// Game 2 (Flight of the Amazon Queen): the engine/queen layer speaks the same
// line format as the Drascula layer, so the player's own parser reads it.
//
// The fixture is a real native run recorded by Claude Code on 14 Nov 2026
// (engine/queen built queen-only on ScummVM ad351d1e9d, commands written to the
// command file): from a save in room 5, walk the path to room 3, jump to room 1
// (survey-only `room`), open the hatch, walk through it to room 2, come back,
// talk to Sparky and pick two options.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseA11yLine, splitA11yLines } from "../src/engine/a11y-lines.js";
import type { EngineEvent } from "../src/engine/adapter.js";

function load(name: string): { raw: string[]; events: EngineEvent[] } {
  const url = new URL(`../src/fixtures/${name}`, import.meta.url);
  const raw = readFileSync(url, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("A11Y"))
    .flatMap((l) => splitA11yLines(l));
  const events = raw.map((l) => parseA11yLine(l)).filter((e): e is EngineEvent => e !== null);
  return { raw, events };
}

/** Group the events after each A11Y_CMD up to the next one. */
function byCommand(events: EngineEvent[]): { cmd: string; events: EngineEvent[] }[] {
  const out: { cmd: string; events: EngineEvent[] }[] = [];
  for (const e of events) {
    if (e.type === "cmd") out.push({ cmd: e.cmd, events: [] });
    else if (out.length > 0) out[out.length - 1]!.events.push(e);
  }
  return out;
}

describe("queen layer: lines the player can read", () => {
  const { raw, events } = load("queen-opening.a11y.log");

  it("every recorded line parses with the player's parser", () => {
    expect(raw.length).toBeGreaterThan(40);
    expect(events.length).toBe(raw.length);
  });

  it("every command gets exactly one diff or at least one error, never both", () => {
    const groups = byCommand(events);
    expect(groups.length).toBeGreaterThanOrEqual(10);
    for (const g of groups) {
      const diffs = g.events.filter((e) => e.type === "diff");
      // A command dropped while the engine is busy is not echoed (same as the
      // Drascula layer), so its "busy: commands dropped" error lands after the
      // previous command's diff. Those are counted in their own test below.
      const errs = g.events.filter((e) => e.type === "error" && !e.message.startsWith("busy"));
      const ok = (diffs.length === 1 && errs.length === 0) || (diffs.length === 0 && errs.length > 0);
      expect(ok, `${g.cmd}: ${diffs.length} diffs, ${errs.length} errors`).toBe(true);
      if (diffs.length === 1 && diffs[0]!.type === "diff") {
        expect(diffs[0]!.diff.cmd).toBe(g.cmd);
      }
    }
  });

  it("commands sent while the engine is busy are each refused once, not run", () => {
    const busy = events.filter((e) => e.type === "error" && e.message.startsWith("busy"));
    // The recording sent look 99, fly 3 and state while the Sparky menu was busy.
    expect(busy.length).toBe(3);
  });

  it("skip while a dialogue menu is open is refused and keeps the menu", () => {
    const skip = byCommand(events).find((g) => g.cmd === "skip")!;
    expect(skip.events.some((e) => e.type === "diff")).toBe(false);
    expect(skip.events.some((e) => e.type === "error")).toBe(true);
  });

  it("opening the hatch in room 1 turns it into an exit to room 2, and walking through it gets there", () => {
    const groups = byCommand(events);
    const open = groups.find((g) => g.cmd === "open 6")!;
    const openDiff = open.events.find((e) => e.type === "diff");
    expect(openDiff && openDiff.type === "diff" && JSON.stringify(openDiff.diff)).toContain('"toRoom":2');

    const walk = groups.find((g) => g.cmd === "walk 6")!;
    const room = walk.events.find((e) => e.type === "room");
    expect(room && room.type === "room" && room.state.room).toBe(2);
  });

  it("talking to Sparky offers numbered choices in visible order", () => {
    const choices = events.filter((e) => e.type === "choices");
    expect(choices.length).toBeGreaterThan(0);
    for (const c of choices) {
      if (c.type !== "choices") continue;
      expect(c.choices.map((x) => x.n)).toEqual(c.choices.map((_, i) => i + 1));
    }
  });
});
