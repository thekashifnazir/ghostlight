// fast-check arbitraries for the pack tools' property tests.
import fc from "fast-check";
import type { Condition, Hints, Milestone, Pack } from "../src/types.js";

/** A valid dotted milestone id, e.g. "ch2.handbag". */
export const arbMilestoneId: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,6}$/),
    fc.array(fc.stringMatching(/^[a-z0-9-]{1,6}$/), { minLength: 1, maxLength: 2 }),
  )
  .map(([head, tail]) => [head, ...tail].join("."));

export const arbHints: fc.Arbitrary<Hints> = fc.record({
  nudge: fc.constant("A gentle nudge."),
  clue: fc.constant("A more specific clue."),
  answer: fc.constant("The exact action."),
});

/**
 * A small DAG of milestones: ids are unique, and each milestone's `after` only
 * points at milestones earlier in the list, so the graph is acyclic by
 * construction. Returns the milestones in topological (list) order.
 */
export const arbMilestoneGraph: fc.Arbitrary<Milestone[]> = fc
  .uniqueArray(arbMilestoneId, { minLength: 1, maxLength: 8 })
  .chain((ids) =>
    fc
      .tuple(
        ...ids.map((_, i) =>
          // each node picks a subset of earlier nodes as prerequisites
          fc.subarray(ids.slice(0, i)),
        ),
      )
      .map((afters) =>
        ids.map(
          (id, i): Milestone => ({
            id,
            chapter: 2,
            title: `Milestone ${id}`,
            after: afters[i]!.length ? afters[i] : undefined,
            when: { chapter: 2 },
            recap: `You reached ${id}.`,
            hints: {
              nudge: "A gentle nudge.",
              clue: "A more specific clue.",
              answer: "The exact action.",
            },
          }),
        ),
      ),
  );

/**
 * A downward-closed subset of a graph's nodes: if a node is in the set, all of
 * its `after` prerequisites are too. These are the only progress states a
 * latching runtime can actually produce.
 */
export function arbReachedSet(
  milestones: Milestone[],
): fc.Arbitrary<Set<string>> {
  const byId = new Map(milestones.map((m) => [m.id, m]));
  return fc.subarray(milestones.map((m) => m.id)).map((picked) => {
    const reached = new Set<string>();
    const add = (id: string): void => {
      if (reached.has(id)) return;
      reached.add(id);
      for (const dep of byId.get(id)?.after ?? []) add(dep);
    };
    for (const id of picked) add(id);
    return reached;
  });
}

/** A condition tree whose flag indices are all in range (0 to 49). */
export const arbValidCondition: fc.Arbitrary<Condition> = fc.letrec<{
  cond: Condition;
}>((tie) => ({
  cond: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.record({ chapter: fc.integer({ min: 0, max: 6 }) }),
    fc.record({
      flags: fc.dictionary(
        fc.integer({ min: 0, max: 49 }).map(String),
        fc.integer({ min: 0, max: 1 }),
        { minKeys: 1, maxKeys: 3 },
      ),
    }),
    fc.record({ has: fc.array(fc.integer({ min: 7, max: 30 }), { minLength: 1, maxLength: 3 }) }),
    fc.record({ not: tie("cond") }),
    fc.record({ all: fc.array(tie("cond"), { minLength: 1, maxLength: 3 }) }),
    fc.record({ any: fc.array(tie("cond"), { minLength: 1, maxLength: 3 }) }),
  ),
})).cond;

/** A condition guaranteed to contain at least one out-of-range flag index. */
export const arbOutOfRangeFlagCondition: fc.Arbitrary<Condition> = fc
  .integer({ min: 50, max: 200 })
  .map((bad) => ({ flags: { [String(bad)]: 1 } }));

export type MalformedKind =
  | "out-of-range-flag"
  | "missing-hint-tier"
  | "both-when-and-end"
  | "cyclic-after"
  | "dangling-after";

/** A minimal pack carrying exactly one deliberate defect, tagged by kind. */
export const arbMalformedPack: fc.Arbitrary<{ kind: MalformedKind; pack: Pack }> =
  fc
    .constantFrom<MalformedKind>(
      "out-of-range-flag",
      "missing-hint-tier",
      "both-when-and-end",
      "cyclic-after",
      "dangling-after",
    )
    .map((kind) => ({ kind, pack: buildMalformedPack(kind) }));

function basePack(): Pack {
  return {
    format: "scummvm-a11y-pack",
    formatVersion: "1.0",
    game: { engine: "drascula", gameId: "drascula", language: "en" },
    pack: { version: "1.0.0", updated: "2026-11-06", coverage: { chapters: [2] } },
    rooms: {
      "14": {
        chapters: [2],
        name: "Test room",
        short: "A test room.",
        long: "A longer test room description.",
        seen: false,
        exits: {},
        objects: {},
      },
    },
    milestones: [],
  };
}

function goodMilestone(id: string, after?: string[]): Milestone {
  return {
    id,
    chapter: 2,
    title: `Milestone ${id}`,
    ...(after ? { after } : {}),
    when: { chapter: 2 },
    recap: `You reached ${id}.`,
    hints: { nudge: "n", clue: "c", answer: "a" },
  };
}

function buildMalformedPack(kind: MalformedKind): Pack {
  const pack = basePack();
  switch (kind) {
    case "out-of-range-flag": {
      const m = goodMilestone("ch2.one");
      m.when = { flags: { "99": 1 } };
      pack.milestones = [m];
      break;
    }
    case "missing-hint-tier": {
      const m = goodMilestone("ch2.one");
      // drop the answer tier
      (m.hints as Partial<Milestone["hints"]>).answer = undefined;
      delete (m.hints as { answer?: string }).answer;
      pack.milestones = [m];
      break;
    }
    case "both-when-and-end": {
      const m = goodMilestone("ch2.one");
      m.end = true; // now has both when and end
      pack.milestones = [m];
      break;
    }
    case "cyclic-after": {
      const a = goodMilestone("ch2.a", ["ch2.b"]);
      const b = goodMilestone("ch2.b", ["ch2.a"]);
      pack.milestones = [a, b];
      break;
    }
    case "dangling-after": {
      pack.milestones = [goodMilestone("ch2.one", ["ch2.ghost"])];
      break;
    }
  }
  return pack;
}
