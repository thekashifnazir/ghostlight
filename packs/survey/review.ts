// Stage 5 (review list): a pure transform from a draft to a review list.
// Spec: .kiro/specs/pack-coverage, Requirement 4.
//
// One reviewable unit per room-description, per exit and per object, each with
// a `status` (pending/accepted/rejected), the `provenance` carried from the
// draft, and `alreadyCovered`. The reviewer (Kash or Claude Code) edits the
// status in place; only `accepted` units merge (stage 6). An already-covered
// unit starts `pending` showing the existing text, so proven chapter 1 and 2
// text is replaced only if a reviewer explicitly accepts the redraft (4.6).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Draft, DraftRoom, ReviewList, ReviewUnit } from "./types.js";

/** Build the review units for one draft room: the room, then its exits/objects. */
export function unitsForRoom(r: DraftRoom): ReviewUnit[] {
  const units: ReviewUnit[] = [];

  units.push({
    key: `room:${r.room}`,
    kind: "room",
    room: r.room,
    status: "pending",
    provenance: r.provenance,
    alreadyCovered: r.alreadyCovered,
    proposed: { name: r.name, short: r.short, long: r.long, seen: r.seen, chapters: r.chapters },
    ...(r.existing ? { existing: r.existing } : {}),
  });

  for (const [num, exit] of Object.entries(r.exits)) {
    units.push({
      key: `exit:${r.room}:${num}`,
      kind: "exit",
      room: r.room,
      hotspot: Number(num),
      status: "pending",
      provenance: r.provenance,
      alreadyCovered: r.alreadyCovered,
      proposed: exit,
      ...(r.existing && (r.existing as { exits?: Record<string, unknown> }).exits
        ? { existing: (r.existing as { exits?: Record<string, unknown> }).exits?.[num] }
        : {}),
    });
  }

  for (const [num, obj] of Object.entries(r.objects)) {
    units.push({
      key: `object:${r.room}:${num}`,
      kind: "object",
      room: r.room,
      hotspot: Number(num),
      status: "pending",
      provenance: r.provenance,
      alreadyCovered: r.alreadyCovered,
      proposed: obj,
    });
  }

  return units;
}

/** The pure transform: Draft -> ReviewList. */
export function buildReviewList(draft: Draft): ReviewList {
  const units = draft.rooms.flatMap(unitsForRoom);
  return {
    chapter: draft.chapter,
    generated: new Date().toISOString().slice(0, 10),
    units,
  };
}

// --- CLI ------------------------------------------------------------------

function main(argv: string[]): number {
  const chapterArg = argv[0];
  if (!chapterArg) {
    console.error("Usage: tsx review.ts <chapter> [draftPath] [outPath]");
    return 2;
  }
  const chapter = Number(chapterArg);
  const here = resolve(import.meta.dirname);
  const draftPath = resolve(argv[1] ?? join(here, `draft-${chapter}.json`));
  const outPath = resolve(argv[2] ?? join(here, `review-${chapter}.json`));

  if (!existsSync(draftPath)) {
    console.error(`review: no draft at ${draftPath}; run draft.ts first.`);
    return 1;
  }
  const draft = JSON.parse(readFileSync(draftPath, "utf8")) as Draft;
  const list = buildReviewList(draft);
  writeFileSync(outPath, JSON.stringify(list, null, 2) + "\n");
  console.log(`review: wrote ${list.units.length} unit(s) to ${outPath}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
