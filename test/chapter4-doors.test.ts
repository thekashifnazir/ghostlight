import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RoomObject, RoomState } from "../src/engine/adapter.js";
import { buildHotspotList } from "../src/model/hotspot-list.js";
import { loadPack, type PackData } from "../src/model/pack.js";

// Three chapter 4 doors were listed as objects (pack data review, 16 Nov): the
// door at the far left of the landing's row (116, room 27), the torch room's
// closet (120) and shelf (122, room 34). Each is locked or hidden at first, so
// the engine dump said door 0, but each becomes a door in play (rooms.cpp's
// doors table and updateDoor). As objects, Enter looked at them instead of
// walking through, and the room's Exits line never named them. The pack's
// type wins over the engine's door flag, so the pack has to list them as exits.

function realPack() {
  const url = new URL("../packs/drascula-en.json", import.meta.url);
  return loadPack(JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as PackData);
}

function obj(num: number, name: string, x: number, door: boolean, toRoom?: number): RoomObject {
  return { num, name, rect: [x, 60, 30, 60], walkTo: [x, 140], visible: true, door, ...(toRoom ? { toRoom } : {}) };
}

function state(room: number, objects: RoomObject[]): RoomState {
  return { chapter: 4, room, hero: { x: 160, y: 140 }, objects, inventory: [], flags: [] };
}

describe("chapter 4 doors that open in play are exits", () => {
  const pack = realPack();

  it.each([
    [27, 116, 31, "door at the far left of the row"],
    [34, 120, 35, "closet"],
    [34, 122, 36, "shelf"],
  ])("room %i hotspot %i leads to room %i as '%s'", (room, num, to, label) => {
    expect(pack.objectType(room, num)).toBe("exit");
    expect(pack.exitLabel(room, num)).toBe(label);
    expect(pack.exitTo(room, num)).toBe(to);
  });

  it("the torch room lists the closet and shelf as exits, locked or open", () => {
    for (const open of [false, true]) {
      const list = buildHotspotList(
        state(34, [
          obj(122, "SHELF", 86, open, open ? 36 : undefined),
          obj(146, "TORCH", 149, false),
          obj(120, "CLOSET", 182, open, open ? 35 : undefined),
          obj(119, "DOOR", 236, true, 27),
        ]),
        pack,
      );
      const exits = list.filter((h) => h.kind === "exit").map((h) => h.name);
      expect(exits).toEqual(["shelf", "closet", "door on the right to the landing"]);
      expect(list.find((h) => h.num === 146)?.kind).toBe("object");
    }
  });
});
