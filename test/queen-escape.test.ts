// Game 2: the first puzzle of Flight of the Amazon Queen needs one carried item
// used on another (the two sheets make a sheet rope). The fixture is a real
// native run recorded by Claude Code on 14 Nov 2026 from a save in room 70
// (engine/queen built on ScummVM ad351d1e9d): use 52 51 before carrying either
// sheet, pick 8, use 52 52, pick 11, use 52 51, use 53 14 (tie it to the
// radiator), use 14 (climb down to room 71).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseA11yLine, splitA11yLines } from "../src/engine/a11y-lines.js";
import type { EngineEvent } from "../src/engine/adapter.js";

const raw = readFileSync(new URL("../src/fixtures/queen-escape.a11y.log", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.startsWith("A11Y"))
  .flatMap((l) => splitA11yLines(l));
const events = raw.map((l) => parseA11yLine(l)).filter((e): e is EngineEvent => e !== null);

function after(cmd: string, nth = 0): EngineEvent[] {
  const starts = events.flatMap((e, i) => (e.type === "cmd" && e.cmd === cmd ? [i] : []));
  const i = starts[nth]!;
  const next = events.findIndex((e, j) => j > i && e.type === "cmd");
  return events.slice(i + 1, next < 0 ? undefined : next);
}
const diffOf = (es: EngineEvent[]) => es.find((e) => e.type === "diff");
const errOf = (es: EngineEvent[]) => es.find((e) => e.type === "error");

describe("queen layer: item on item (the room 70 escape)", () => {
  it("every recorded line parses with the player's parser", () => {
    expect(events.length).toBe(raw.length);
  });

  it("refuses an item that isn't carried, and an item on itself", () => {
    const first = after("use 52 51", 0);
    expect(diffOf(first)).toBeUndefined();
    expect(errOf(first)).toBeDefined();
    const self = after("use 52 52");
    expect(diffOf(self)).toBeUndefined();
    expect(JSON.stringify(errOf(self))).toContain("on itself");
  });

  it("combines the two sheets into the sheet rope in one diff", () => {
    const d = diffOf(after("use 52 51", 1));
    expect(d && d.type === "diff").toBe(true);
    const s = JSON.stringify(d);
    expect(s).toContain('"invAdded":[{"id":53');
    expect(s).toMatch(/"invRemoved":\[[^\]]*"id":51[^\]]*"id":52/);
  });

  it("ties the rope to the radiator, then climbing down reaches room 71", () => {
    expect(JSON.stringify(diffOf(after("use 53 14")))).toContain('"invRemoved":[{"id":53');
    const room = after("use 14").find((e) => e.type === "room");
    expect(room && room.type === "room" && room.state.room).toBe(71);
  });
});
