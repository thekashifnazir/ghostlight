// Stage 6 (merge): a pure transform from a review list to the pack.
// Spec: .kiro/specs/pack-coverage, Requirement 4.
//
// Writes ONLY `accepted` units into packs/drascula-en.json, keyed on the
// engine's own hotspot numbers, under `exits` or `objects` by the hotspot's
// door flag (the review unit's kind). Appends accepted textFix suggestions.
// Grows pack.coverage.chapters only when every reachable room in a chapter has
// an accepted, merged entry (the caller passes the reachable set). Never
// overwrites an already-covered entry unless its unit is accepted (4.6), and
// never bypasses the validator (the caller runs it after saving; this transform
// only produces the new pack object).
//
// This is a pure function: review list + current pack + reachable sets in, new
// pack object + a merge summary out. The CLI writes the file (firing the
// pack-validate-on-save hook) and then runs the validator and coverage checker.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

import type { Pack, Room, Exit, RoomObject, TextFix } from "../tools/src/types.js";
import type { ReviewList, ReviewUnit } from "./types.js";

export interface MergeSummary {
  accepted: number;
  roomsTouched: number[];
  chaptersNowCovered: number[];
  textFixesAdded: number;
  /** Units skipped because an already-covered entry was not re-accepted. */
  keptExisting: number;
}

/** Deep-clone a pack so the merge never mutates the caller's object. */
function clonePack(pack: Pack): Pack {
  return JSON.parse(JSON.stringify(pack)) as Pack;
}

/** Ensure a room shell exists in the pack before writing its parts. */
function ensureRoom(pack: Pack, room: number, chapters: number[]): Room {
  const key = String(room);
  if (!pack.rooms[key]) {
    pack.rooms[key] = {
      chapters: chapters.slice(),
      name: "",
      short: "",
      long: "",
      seen: false,
      exits: {},
      objects: {},
    };
  }
  return pack.rooms[key]!;
}

/**
 * The pure transform. `reachableByChapter` maps a chapter to the set of census
 * rooms reachable in it, so a chapter is only added to coverage once every one
 * of those rooms has a pack entry after the merge.
 */
export function mergeAccepted(
  pack: Pack,
  review: ReviewList,
  reachableByChapter: Record<number, number[]>,
): { pack: Pack; summary: MergeSummary } {
  const next = clonePack(pack);
  const accepted = review.units.filter((u) => u.status === "accepted");
  const roomsTouched = new Set<number>();
  let textFixesAdded = 0;
  let keptExisting = 0;

  // Count units that correspond to an already-covered entry and were NOT
  // accepted: those keep the existing text untouched (4.6).
  keptExisting = review.units.filter(
    (u) => u.alreadyCovered && u.status !== "accepted",
  ).length;

  for (const u of accepted) {
    roomsTouched.add(u.room);
    if (u.kind === "room") {
      const p = u.proposed as {
        name: string;
        short: string;
        long: string;
        seen: boolean;
        chapters: number[];
      };
      const room = ensureRoom(next, u.room, p.chapters);
      room.name = p.name;
      room.short = p.short;
      room.long = p.long;
      room.seen = p.seen;
      room.chapters = p.chapters;
    } else if (u.kind === "exit") {
      const room = ensureRoom(next, u.room, [review.chapter]);
      room.exits[String(u.hotspot)] = u.proposed as Exit;
    } else if (u.kind === "object") {
      const room = ensureRoom(next, u.room, [review.chapter]);
      const obj = u.proposed as RoomObject & {
        textFixSuggestion?: { from: string; to: string; reason: TextFix["reason"] };
      };
      const { textFixSuggestion, ...objectEntry } = obj;
      room.objects[String(u.hotspot)] = objectEntry as RoomObject;
      if (textFixSuggestion && textFixSuggestion.to) {
        next.textFixes ??= [];
        next.textFixes.push({
          from: textFixSuggestion.from,
          to: textFixSuggestion.to,
          context: "hotspot",
          rooms: [u.room],
          reason: textFixSuggestion.reason,
        });
        textFixesAdded++;
      }
    }
  }

  // Grow coverage.chapters only for a chapter whose every reachable room now
  // has a pack entry (4.4). Never shrink an existing coverage claim.
  const covered = new Set(next.pack.coverage.chapters);
  const chaptersNowCovered: number[] = [];
  for (const [chStr, reachable] of Object.entries(reachableByChapter)) {
    const ch = Number(chStr);
    if (covered.has(ch)) continue;
    const complete = reachable.every((r) => next.rooms[String(r)] !== undefined);
    if (complete && reachable.length > 0) {
      covered.add(ch);
      chaptersNowCovered.push(ch);
    }
  }
  next.pack.coverage.chapters = [...covered].sort((a, b) => a - b);

  return {
    pack: next,
    summary: {
      accepted: accepted.length,
      roomsTouched: [...roomsTouched].sort((a, b) => a - b),
      chaptersNowCovered: chaptersNowCovered.sort((a, b) => a - b),
      textFixesAdded,
      keptExisting,
    },
  };
}

// --- CLI ------------------------------------------------------------------

function main(argv: string[]): number {
  const chapterArg = argv[0];
  if (!chapterArg) {
    console.error("Usage: tsx merge.ts <chapter> [reviewPath] [packPath] [censusPath]");
    return 2;
  }
  const chapter = Number(chapterArg);
  const here = resolve(import.meta.dirname);
  const reviewPath = resolve(argv[1] ?? join(here, `review-${chapter}.json`));
  const packPath = resolve(argv[2] ?? resolve(here, "..", "drascula-en.json"));
  const censusPath = resolve(argv[3] ?? resolve(here, "..", "..", "reference", "census.json"));

  if (!existsSync(reviewPath)) {
    console.error(`merge: no review list at ${reviewPath}; run review.ts and accept entries first.`);
    return 1;
  }
  const review = JSON.parse(readFileSync(reviewPath, "utf8")) as ReviewList;
  const pack = JSON.parse(readFileSync(packPath, "utf8")) as Pack;
  const census = JSON.parse(readFileSync(censusPath, "utf8")) as {
    roomChapters: Record<string, number[]>;
  };

  // Reachable-by-chapter from the census: every census room in a chapter.
  // (Reachability of cutscene-only rooms is handled by the survey; for the
  // coverage claim here, a census room in the chapter must have a pack entry.)
  const reachableByChapter: Record<number, number[]> = {};
  for (const [roomStr, chs] of Object.entries(census.roomChapters)) {
    for (const ch of chs) {
      (reachableByChapter[ch] ??= []).push(Number(roomStr));
    }
  }

  const { pack: next, summary } = mergeAccepted(pack, review, reachableByChapter);
  next.pack.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(packPath, JSON.stringify(next, null, 2) + "\n");
  console.log(
    `merge: ${summary.accepted} accepted unit(s) into rooms ${summary.roomsTouched.join(", ") || "(none)"}; ` +
      `textFixes +${summary.textFixesAdded}; kept ${summary.keptExisting} existing; ` +
      `chapters now covered: ${summary.chaptersNowCovered.join(", ") || "(unchanged)"}.`,
  );

  // Run the validator and coverage checker; the merge is complete only when
  // both pass (4.5). Never bypass them.
  try {
    const toolsDir = resolve(here, "..", "tools");
    execFileSync(
      "node_modules/.bin/tsx",
      ["src/cli.ts", "validate", packPath, resolve(here, "..", "schema.json")],
      { cwd: toolsDir, stdio: "inherit" },
    );
    execFileSync(
      "node_modules/.bin/tsx",
      ["src/cli.ts", "check-coverage", packPath, censusPath],
      { cwd: toolsDir, stdio: "inherit" },
    );
  } catch {
    console.error("merge: validator or coverage checker FAILED; the merge is not complete. See errors above.");
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
