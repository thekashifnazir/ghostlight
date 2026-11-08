import { describe, expect, it, vi } from "vitest";

// hints-and-ghost R5.1/R5.2 hardening: the hint TEXT must always reach the
// player even when the audio cache key cannot be computed. On a non-secure
// origin `crypto.subtle` is absent and cache.ts falls back to `node:crypto`,
// which cannot resolve in the browser, so `cacheKey` rejects. The engine must
// swallow that and still return the hint text (with an empty audio key), so H
// speaks the hint and only the optional whisper is skipped.
//
// We mock the cache module so `cacheKey` always throws, then assert
// `engine.ask()` still resolves with the tier text and `audioKey: ""`. This
// lives in its own file so the mock does not affect the real-key assertions in
// hints-engine.test.ts.
vi.mock("../src/hints/cache.js", () => ({
  cacheKey: vi.fn(async () => {
    throw new Error("no crypto available (simulated non-secure origin)");
  }),
}));

import { HintEngine } from "../src/hints/engine.js";
import { ProgressTracker } from "../src/hints/progress.js";
import type { Pack } from "../packs/tools/src/types.js";
import type { EngineHintState } from "../src/hints/fold.js";

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
  ],
} as unknown as Pack;

function state(): EngineHintState {
  return { chapter: 2, room: 14, flags: new Array(50).fill(0), inventory: [] };
}

describe("hint key failure: text still speaks when cacheKey throws", () => {
  it("ask() resolves with the tier text and an empty audio key", async () => {
    const tracker = new ProgressTracker(pack);
    const engine = new HintEngine(pack, tracker);
    engine.onEngineState(state());

    const r = await engine.ask(14);
    expect(r.kind).toBe("hint");
    if (r.kind === "hint") {
      // The text is present and complete — the player hears the hint.
      expect(r.text).toBe("Look around the vending area.");
      // The key failed, so it is empty; GhostAudio.play("") is a silent no-op.
      expect(r.audioKey).toBe("");
    }
  });

  it("askAnswer() also resolves with text despite the key failure", async () => {
    const tracker = new ProgressTracker(pack);
    const engine = new HintEngine(pack, tracker);
    engine.onEngineState(state());

    const r = await engine.askAnswer(14);
    expect(r.kind).toBe("hint");
    if (r.kind === "hint") {
      expect(r.tier).toBe("answer");
      expect(r.text).toBe("Open the machine, then take the handbag.");
      expect(r.audioKey).toBe("");
    }
  });
});
