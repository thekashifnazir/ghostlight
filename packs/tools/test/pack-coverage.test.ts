// Stage 5 test (pack-coverage spec, Requirement 5.4/5.6). Reads the pack and
// the census and fails when a chapter claimed in pack.coverage.chapters has a
// reachable room or a described-room hotspot with no coverage. Passes today
// (chapters 1 and 2 fully covered); fails if a later chapter is claimed before
// its rooms are described. Built on the existing census checker via the
// coverage report — no second checker, no engine run.
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadCensus, loadPack } from "../src/load.js";
import { buildCoverageReport } from "../src/coverage-report.js";
import type { Pack } from "../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(HERE, "..", "..", "drascula-en.json");
const CENSUS = resolve(HERE, "..", "..", "..", "reference", "census.json");

const census = loadCensus(CENSUS);

function freshPack(): Pack {
  return loadPack(PACK);
}

describe("pack-coverage: claimed chapters are fully described", () => {
  it("every claimed chapter has no reachable-but-undescribed room", () => {
    const report = buildCoverageReport(freshPack(), census);
    const offenders = report.chapters.flatMap((c) =>
      c.missingRooms.map((r) => `chapter ${c.chapter} room ${r}`),
    );
    expect(offenders, `undescribed reachable rooms: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every claimed chapter has no described-room hotspot without a name", () => {
    const report = buildCoverageReport(freshPack(), census);
    const offenders = report.chapters.flatMap((c) =>
      c.hotspotsWithoutNames.map((h) => h.message),
    );
    expect(offenders, `hotspots without names: ${offenders.join("; ")}`).toEqual([]);
  });

  it("reports the report as ok for the current pack (all six chapters)", () => {
    const report = buildCoverageReport(freshPack(), census);
    expect(report.claimedChapters).toEqual([1, 2, 3, 4, 5, 6]);
    expect(report.ok).toBe(true);
  });

  it("counts cutscene-only rooms 56, 57 and 102 as reachable when their chapter is claimed", () => {
    // Claim chapters 5 and 6 on a copy; the report must list 56/57 (ch5) and
    // 102 (ch6) among the reachable rooms, proving they are in scope even with
    // no walkable exit edge (102's exit graph is empty).
    const pack = freshPack();
    pack.pack.coverage.chapters = [5, 6];
    const report = buildCoverageReport(pack, census);
    const ch5 = report.chapters.find((c) => c.chapter === 5)!;
    const ch6 = report.chapters.find((c) => c.chapter === 6)!;
    expect(ch5.reachableRooms).toContain(56);
    expect(ch5.reachableRooms).toContain(57);
    expect(ch6.reachableRooms).toContain(102);
  });

  it("fails a chapter claimed before its rooms are described", () => {
    // Claim chapter 4 (rooms 21, 22, ...) without describing them: the report
    // must flag them as missing, i.e. the guard rail trips. The real pack now
    // describes some chapter 4 rooms, so drop them here to keep the test
    // independent of how far the drafting has got.
    const pack = freshPack();
    delete pack.rooms["21"];
    delete pack.rooms["22"];
    pack.pack.coverage.chapters = [1, 2, 3, 4];
    const report = buildCoverageReport(pack, census);
    const ch4 = report.chapters.find((c) => c.chapter === 4)!;
    expect(ch4.missingRooms).toContain(21);
    expect(ch4.missingRooms).toContain(22);
    expect(report.ok).toBe(false);
  });
});
