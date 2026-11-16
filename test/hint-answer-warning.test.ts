// @vitest-environment jsdom
// After a clue, the player hears that the next H gives the answer, so they
// choose how much is spoiled (prior art, 16 Nov). The warning is never part of
// the hint text, which keys the ghost's recording.
import { describe, expect, it } from "vitest";
import { ANSWER_NEXT, speakHint } from "../src/ui/hint-speech.js";

function deps(opts: { willPlay: boolean; readVoiced?: boolean; reject?: boolean }) {
  const announced: string[] = [];
  const recorded: string[] = [];
  const played: { key: string; onEnded?: () => void }[] = [];
  return {
    announced,
    recorded,
    played,
    d: {
      live: {
        announce: (t: string) => void announced.push(t),
        record: (t: string) => void recorded.push(t),
        interrupt: () => true,
      },
      audio: {
        willPlay: () => opts.willPlay,
        play: (key: string, onEnded?: () => void) => {
          played.push({ key, onEnded });
          return opts.reject ? Promise.reject(new Error("x")) : Promise.resolve();
        },
      },
      readVoicedLines: opts.readVoiced ?? false,
      noHintText: "Nothing.",
      recordStatus: () => {},
      logVoiced: () => {},
    },
  };
}
const hint = (tier: "nudge" | "clue" | "answer") =>
  ({ kind: "hint", milestoneId: "m", tier, text: "Look behind the bar.", audioKey: "k" }) as const;

describe("the answer warning after a clue", () => {
  it("text hint: the clue ends with the warning", () => {
    const t = deps({ willPlay: false });
    speakHint(hint("clue"), t.d);
    expect(t.announced).toEqual([`Look behind the bar. ${ANSWER_NEXT}`]);
    expect(t.played[0].key).toBe("k"); // same recording key as before
  });

  it("voiced clue: nothing over the ghost; the warning follows once it has finished", () => {
    const t = deps({ willPlay: true });
    speakHint(hint("clue"), t.d);
    expect(t.announced).toEqual([]);
    expect(t.recorded).toEqual(["Look behind the bar."]);
    t.played[0].onEnded?.();
    expect(t.announced).toEqual([ANSWER_NEXT]);
  });

  it("voiced clue that fails to play: the text and the warning are read", async () => {
    const t = deps({ willPlay: true, reject: true });
    speakHint(hint("clue"), t.d);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.announced).toEqual([`Look behind the bar. ${ANSWER_NEXT}`]);
  });

  it("no warning after a nudge or an answer", () => {
    for (const tier of ["nudge", "answer"] as const) {
      const t = deps({ willPlay: false });
      speakHint(hint(tier), t.d);
      expect(t.announced).toEqual(["Look behind the bar."]);
      const v = deps({ willPlay: true });
      speakHint(hint(tier), v.d);
      expect(v.played[0].onEnded).toBeUndefined();
    }
  });
});
