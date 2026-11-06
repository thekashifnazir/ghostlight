import { describe, expect, it } from "vitest";
import type { Pack } from "../packs/tools/src/types.js";
import {
  GHOST_MODEL_ID,
  GHOST_VOICE_ID,
  HintEngine,
} from "../src/hints/engine.js";
import { cacheKey } from "../src/hints/cache.js";
import { ProgressTracker } from "../src/hints/progress.js";
import type { EngineHintState } from "../src/hints/fold.js";

function state(partial: Partial<EngineHintState> = {}): EngineHintState {
  return {
    chapter: 2,
    room: 14,
    flags: new Array(50).fill(0),
    inventory: [],
    ...partial,
  };
}

// Two milestones in chapter 2: `handbag` (offered first), then `money` gated
// behind it. Flag 20 reaches handbag; flag 23 reaches money.
const pack = {
  milestones: [
    {
      id: "ch2.handbag",
      chapter: 2,
      title: "handbag",
      rooms: [14],
      when: { flags: { "20": 1 } },
      recap: "",
      hints: {
        nudge: "Look around the vending area.",
        clue: "The handbag is in the machine.",
        answer: "Open the machine, then take the handbag.",
      },
    },
    {
      id: "ch2.money",
      chapter: 2,
      title: "money",
      after: ["ch2.handbag"],
      when: { flags: { "23": 1 } },
      recap: "",
      hints: {
        nudge: "You need money.",
        clue: "Check the handbag for coins.",
        answer: "Look in the handbag to find the money.",
      },
    },
  ],
} as unknown as Pack;

function makeEngine(): { engine: HintEngine; tracker: ProgressTracker } {
  const tracker = new ProgressTracker(pack);
  const engine = new HintEngine(pack, tracker);
  return { engine, tracker };
}

describe("HintEngine.ask", () => {
  it("returns none when nothing is offered", async () => {
    const { engine } = makeEngine();
    // Reach every milestone, so the offered set is empty.
    engine.onEngineState(state({ flags: flagsWith({ 20: 1, 23: 1 }) }));
    const r = await engine.ask(14);
    expect(r.kind).toBe("none");
  });

  it("gives the nudge, then clue, then answer for the offered target", async () => {
    const { engine } = makeEngine();
    engine.onEngineState(state()); // chapter 2, nothing reached yet

    const r1 = await engine.ask(14);
    expect(r1).toMatchObject({
      kind: "hint",
      milestoneId: "ch2.handbag",
      tier: "nudge",
      text: "Look around the vending area.",
    });
    // The audio key is the content hash of the tier text.
    if (r1.kind === "hint") {
      expect(r1.audioKey).toBe(
        await cacheKey(r1.text, GHOST_VOICE_ID, GHOST_MODEL_ID),
      );
    }

    expect(await tierOf(engine.ask(14))).toBe("clue");
    expect(await tierOf(engine.ask(14))).toBe("answer");
    expect(await tierOf(engine.ask(14))).toBe("answer"); // clamped
  });

  it("moves to the next milestone once the first is reached, resetting to nudge", async () => {
    const { engine } = makeEngine();
    engine.onEngineState(state());
    await engine.ask(14); // nudge for handbag
    await engine.ask(14); // clue for handbag

    // Reach the handbag; money becomes the offered target.
    engine.onEngineState(state({ flags: flagsWith({ 20: 1 }) }));
    const r = await engine.ask(14);
    expect(r).toMatchObject({
      kind: "hint",
      milestoneId: "ch2.money",
      tier: "nudge",
    });
  });
});

describe("HintEngine.askAnswer", () => {
  it("gives the answer directly for an offered milestone", async () => {
    const { engine } = makeEngine();
    engine.onEngineState(state());
    const r = await engine.askAnswer(14);
    expect(r).toMatchObject({
      kind: "hint",
      milestoneId: "ch2.handbag",
      tier: "answer",
      text: "Open the machine, then take the handbag.",
    });
  });

  it("returns none when nothing is offered", async () => {
    const { engine } = makeEngine();
    engine.onEngineState(state({ flags: flagsWith({ 20: 1, 23: 1 }) }));
    expect((await engine.askAnswer(14)).kind).toBe("none");
  });
});

/** The tier of a hint result, failing the test if it was `none`. */
async function tierOf(p: Promise<import("../src/hints/engine.js").HintResult>) {
  const r = await p;
  if (r.kind !== "hint") throw new Error("expected a hint, got none");
  return r.tier;
}

/** A 50-flag array with the given indices set. */
function flagsWith(set: Record<number, number>): number[] {
  const flags = new Array(50).fill(0);
  for (const [i, v] of Object.entries(set)) flags[Number(i)] = v;
  return flags;
}
