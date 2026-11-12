// The pack writer (pack-coverage spec, Requirement 4): merge.ts writes the pack
// through serializePack, which must leave the real pack byte-for-byte unchanged
// when nothing is merged, and change only the merged room's lines when one room
// is merged.
//
// These tests need packs/drascula-en.json to already be in the stable layout
// (run `tsx packs/survey/format-pack.ts` once, in its own commit). Until then
// the byte-for-byte tests fail, which is the point: they are the guard that the
// file and the writer agree.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { mergeAccepted } from "../../survey/merge.js";
import { MAX_INLINE, serializePack } from "../../survey/serialize-pack.js";
import type { ReviewList } from "../../survey/types.js";
import type { Pack } from "../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(HERE, "..", "..", "drascula-en.json");

const text = readFileSync(PACK, "utf8");
const pack = (): Pack => JSON.parse(text) as Pack;

const emptyReview: ReviewList = { chapter: 3, generated: "test", units: [] };

describe("serializePack: the real pack", () => {
  it("round-trips drascula-en.json byte for byte", () => {
    expect(serializePack(JSON.parse(text))).toBe(text);
  });

  it("is deeply equal to the parsed pack once re-parsed", () => {
    expect(isDeepStrictEqual(JSON.parse(serializePack(pack())), pack())).toBe(true);
  });

  it("is idempotent", () => {
    const once = serializePack(pack());
    expect(serializePack(JSON.parse(once))).toBe(once);
  });
});

describe("serializePack: layout rules", () => {
  it("writes short values on one line and long ones across lines", () => {
    const out = serializePack({ a: { b: 1, c: [1, 2] }, long: { s: "x".repeat(MAX_INLINE) } });
    expect(out).toBe(
      [
        "{",
        '  "a": { "b": 1, "c": [1, 2] },',
        '  "long": {',
        `    "s": "${"x".repeat(MAX_INLINE)}"`,
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("writes empty containers as {} and []", () => {
    expect(serializePack({ a: {}, b: [] })).toBe('{ "a": {}, "b": [] }\n');
  });

  it("escapes strings so the text stays valid JSON", () => {
    const value = { q: 'say "hi"\nthen\\go' };
    expect(JSON.parse(serializePack(value))).toEqual(value);
  });
});

describe("merge writer", () => {
  it("merging zero rooms leaves the file byte-for-byte unchanged", () => {
    const { pack: merged, summary } = mergeAccepted(pack(), emptyReview, {});
    expect(summary.accepted).toBe(0);
    expect(serializePack(merged)).toBe(text);
  });

  it("merging one room changes only that room's lines", () => {
    const before = pack();
    const room = before.rooms["63"]!;
    const review: ReviewList = {
      chapter: 3,
      generated: "test",
      units: [
        {
          key: "room:63",
          kind: "room",
          room: 63,
          status: "accepted",
          provenance: "drafted by Kiro from game text only",
          alreadyCovered: true,
          proposed: {
            name: `${room.name} (merge test)`,
            short: room.short,
            long: room.long,
            seen: room.seen,
            chapters: room.chapters,
          },
        },
      ],
    };

    const { pack: merged, summary } = mergeAccepted(before, review, {});
    expect(summary.roomsTouched).toEqual([63]);
    const after = serializePack(merged);

    // Drop the lines both texts share at the start and at the end; what is left
    // in the middle is the diff.
    const a = text.split("\n");
    const b = after.split("\n");
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (
      tail < a.length - head &&
      tail < b.length - head &&
      a[a.length - 1 - tail] === b[b.length - 1 - tail]
    ) {
      tail++;
    }
    const removed = a.slice(head, a.length - tail);
    const added = b.slice(head, b.length - tail);

    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(removed[0]).toContain(`"name": "${room.name}"`);
    expect(added[0]).toContain("(merge test)");
  });
});
