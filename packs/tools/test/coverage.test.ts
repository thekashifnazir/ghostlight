import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadCensus, loadPack } from "../src/load.js";
import { checkCoverage } from "../src/coverage.js";
import type { Pack } from "../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(HERE, "..", "..", "drascula-en.json");
const CENSUS = resolve(HERE, "..", "..", "..", "reference", "census.json");

const census = loadCensus(CENSUS);

function freshPack(): Pack {
  return loadPack(PACK);
}

describe("coverage: the real pack", () => {
  it("fully covers census chapters 1 and 2", () => {
    const result = checkCoverage(freshPack(), census);
    expect(result.gaps).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("coverage: the invariant (every census room, hotspot, door covered)", () => {
  it("for every covered room, every census hotspot number has a pack entry", () => {
    const pack = freshPack();
    const covered = new Set(pack.pack.coverage.chapters);
    for (const [roomKey, censusRoom] of Object.entries(census.rooms)) {
      const chapters = census.roomChapters[roomKey] ?? [];
      if (!chapters.some((c) => covered.has(c))) continue;
      const packRoom = pack.rooms[roomKey];
      expect(packRoom, `room ${roomKey} present`).toBeDefined();
      const keys = new Set([
        ...Object.keys(packRoom!.exits),
        ...Object.keys(packRoom!.objects),
      ]);
      for (const obj of censusRoom.objects) {
        expect(
          keys.has(String(obj.num)),
          `room ${roomKey} hotspot ${obj.num} (${obj.name})`,
        ).toBe(true);
      }
    }
  });
});

describe("coverage: gaps are reported", () => {
  it("reports a missing hotspot", () => {
    const pack = freshPack();
    delete pack.rooms["62"]!.objects["52"]; // remove the bartender
    const result = checkCoverage(pack, census);
    expect(result.ok).toBe(false);
    expect(result.gaps.some((g) => g.kind === "missing-hotspot")).toBe(true);
  });

  it("reports a wrong door destination with no note", () => {
    const pack = freshPack();
    const exit = pack.rooms["62"]!.exits["106"]!;
    exit.to = 999;
    delete exit.note;
    const result = checkCoverage(pack, census);
    expect(result.ok).toBe(false);
    expect(
      result.gaps.some(
        (g) => g.kind === "door-destination" || g.kind === "exit-graph",
      ),
    ).toBe(true);
  });

  it("reports a stale hotspot the census does not have", () => {
    const pack = freshPack();
    pack.rooms["62"]!.objects["777"] = {
      name: "phantom",
      type: "object",
      description: "not in the census",
    };
    const result = checkCoverage(pack, census);
    expect(result.ok).toBe(false);
    expect(result.gaps.some((g) => g.kind === "stale-hotspot")).toBe(true);
  });

  it("reports a to:null exit that has no note", () => {
    const pack = freshPack();
    const exit = pack.rooms["62"]!.exits["105"]!;
    delete exit.note;
    const result = checkCoverage(pack, census);
    expect(result.ok).toBe(false);
    expect(result.gaps.some((g) => g.kind === "null-exit-no-note")).toBe(true);
  });
});
