// A door that opens in the current room (A11Y_DIFF "doors") becomes an exit
// with its destination, and the player names it when the game said nothing.
// The diff is the real "open 6" line from the Queen opening fixture.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseA11yLine } from "../src/engine/a11y-lines.js";
import type { Diff, RoomState } from "../src/engine/adapter.js";
import { buildHotspotList } from "../src/model/hotspot-list.js";
import { Pack } from "../src/model/pack.js";
import { applySameRoomChanges, hasSameRoomChanges, openedDoors } from "../src/model/same-room.js";

const lines = readFileSync(new URL("../src/fixtures/queen-opening.a11y.log", import.meta.url), "utf8")
  .split("\n")
  .map((l) => parseA11yLine(l));

function diffFor(cmd: string): Diff {
  const e = lines.find((x) => x?.type === "diff" && x.diff.cmd === cmd);
  if (!e || e.type !== "diff") throw new Error(`no diff for ${cmd}`);
  return e.diff;
}

function room1(): RoomState {
  const d = diffFor("room 1");
  return { chapter: 1, room: 1, hero: { x: 150, y: 130 }, objects: d.objects ?? [], inventory: [], flags: [] };
}

// The Queen pack has no entry for room 1, so the engine's door flag decides.
const queenPack = new Pack(
  JSON.parse(readFileSync(new URL("../packs/queen-en.json", import.meta.url), "utf8")),
);

describe("same-room door changes", () => {
  it("the hatch is an object before it opens", () => {
    const list = buildHotspotList(room1(), queenPack);
    expect(list.find((h) => h.num === 6)?.kind).toBe("object");
  });

  it("opening the hatch turns it into an exit to room 2", () => {
    const diff = diffFor("open 6");
    expect(hasSameRoomChanges(diff)).toBe(true);
    const state = room1();
    const objects = applySameRoomChanges(state.objects, diff);
    const hatch = buildHotspotList({ ...state, objects }, queenPack).find((h) => h.num === 6);
    expect(hatch?.kind).toBe("exit");
    expect(hatch?.toRoom).toBe(2);
  });

  it("reports the opened door so the player can say it, since the game said nothing", () => {
    const diff = diffFor("open 6");
    expect(diff.said ?? []).toEqual([]);
    expect(openedDoors(diff)).toEqual([6]);
  });

  it("appeared and disappeared still work as before", () => {
    const state = room1();
    const gone = state.objects[0]!;
    const objects = applySameRoomChanges(state.objects, { cmd: "x", changed: true, disappeared: [gone] });
    expect(objects.some((o) => o.num === gone.num)).toBe(false);
    expect(hasSameRoomChanges({ cmd: "x", changed: false })).toBe(false);
  });
});
