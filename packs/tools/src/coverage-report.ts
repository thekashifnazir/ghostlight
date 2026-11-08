// Coverage report (pack-coverage spec, Requirement 5): a human-readable summary
// built ON TOP of the existing census coverage checker (coverage.ts). No second
// checker, no engine run. Reads the pack and census only.
//
// The report answers two questions per chapter:
//   - rooms reachable vs rooms with a pack entry, naming each missing room;
//   - described-room hotspots with no name/label (objects without names).
// Both come straight from checkCoverage's gaps, so the report can never drift
// from the checker the test and the merge step already trust.
//
// Cutscene-only rooms (56, 57, 102) are census rooms in their chapters
// (roomChapters), so checkCoverage already scopes them when their chapter is
// covered; room 102 has no exit-graph edge but is still a census room. The
// report counts them as reachable like any other census room in the chapter
// (Requirement 5.5); it does not fork the checker.

import type { Census, Pack } from "./types.js";
import { checkCoverage, type CoverageGap } from "./coverage.js";

/** Census rooms that fall in a given chapter. */
function censusRoomsInChapter(census: Census, chapter: number): number[] {
  return Object.keys(census.roomChapters)
    .filter((r) => (census.roomChapters[r] ?? []).includes(chapter))
    .map(Number)
    .sort((a, b) => a - b);
}

export interface ChapterCoverage {
  chapter: number;
  reachableRooms: number[];
  describedRooms: number[];
  missingRooms: number[];
  /** Objects/exits in a described room with no name/label. */
  hotspotsWithoutNames: { room: number; message: string }[];
}

export interface CoverageReport {
  claimedChapters: number[];
  chapters: ChapterCoverage[];
  ok: boolean;
}

export function buildCoverageReport(pack: Pack, census: Census): CoverageReport {
  const { gaps } = checkCoverage(pack, census);
  const claimed = pack.pack.coverage.chapters.slice().sort((a, b) => a - b);

  const byRoomKind = (kind: CoverageGap["kind"]) =>
    gaps.filter((g) => g.kind === kind);
  const missingRoomSet = new Set(byRoomKind("missing-room").map((g) => g.room));
  const missingHotspots = byRoomKind("missing-hotspot");

  const chapters: ChapterCoverage[] = claimed.map((chapter) => {
    const reachableRooms = censusRoomsInChapter(census, chapter);
    const describedRooms = reachableRooms.filter(
      (r) => pack.rooms[String(r)] !== undefined && !missingRoomSet.has(r),
    );
    const missingRooms = reachableRooms.filter(
      (r) => pack.rooms[String(r)] === undefined || missingRoomSet.has(r),
    );
    const hotspotsWithoutNames = missingHotspots
      .filter((g) => reachableRooms.includes(g.room))
      .map((g) => ({ room: g.room, message: g.message }));
    return { chapter, reachableRooms, describedRooms, missingRooms, hotspotsWithoutNames };
  });

  return { claimedChapters: claimed, chapters, ok: gaps.length === 0 };
}

/** Format the report as plain text for a terminal or a log. */
export function formatCoverageReport(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push(`Coverage report — claimed chapters: ${report.claimedChapters.join(", ") || "(none)"}`);
  for (const c of report.chapters) {
    lines.push("");
    lines.push(
      `Chapter ${c.chapter}: ${c.describedRooms.length}/${c.reachableRooms.length} rooms described.`,
    );
    if (c.missingRooms.length) {
      lines.push(`  Reachable but not described: ${c.missingRooms.join(", ")}`);
    }
    for (const h of c.hotspotsWithoutNames) {
      lines.push(`  Object without a name: ${h.message}`);
    }
  }
  lines.push("");
  lines.push(report.ok ? "All claimed chapters are fully covered." : "Coverage gaps found (see above).");
  return lines.join("\n");
}
