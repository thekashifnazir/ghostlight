// Game 2 hints: the Queen pack's room 70 milestones latch in order over a real
// native run of the escape (src/fixtures/queen-escape.a11y.log, recorded by
// Claude Code on 14 Nov 2026), and the always-on "worth a look" line follows.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseA11yLine, splitA11yLines } from "../src/engine/a11y-lines.js";
import type { EngineEvent } from "../src/engine/adapter.js";
import { HintEngine } from "../src/hints/engine.js";
import { foldDiff, type EngineHintState } from "../src/hints/fold.js";
import { ProgressTracker } from "../src/hints/progress.js";
import type { Pack } from "../packs/tools/src/types.js";

const pack = JSON.parse(readFileSync(new URL("../packs/queen-en.json", import.meta.url), "utf8")) as Pack;
const events = readFileSync(new URL("../src/fixtures/queen-escape.a11y.log", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.startsWith("A11Y"))
  .flatMap((l) => splitA11yLines(l))
  .map((l) => parseA11yLine(l))
  .filter((e): e is EngineEvent => e !== null);

describe("queen hints over the room 70 escape", () => {
  it("latches q.rope, q.tied and q.down in order, with the nudge first", () => {
    const tracker = new ProgressTracker(pack);
    const hints = new HintEngine(pack, tracker);
    const first = events.find((e) => e.type === "room");
    if (!first || first.type !== "room") throw new Error("no room state in the fixture");
    let state: EngineHintState = {
      chapter: first.state.chapter,
      room: first.state.room,
      flags: [...first.state.flags],
      inventory: [...first.state.inventory],
    };
    hints.onEngineState(state);
    expect(hints.worthALook(70, () => undefined)).toBe(`Worth a look: ${pack.milestones![0]!.hints.nudge}`);

    const order: string[] = [];
    for (const e of events) {
      if (e.type !== "diff") continue;
      state = foldDiff(state, e.diff);
      hints.onEngineState(state);
      for (const id of hints.reached()) if (!order.includes(id)) order.push(id);
    }
    expect(order).toEqual(["q.rope", "q.tied", "q.down"]);
    expect(state.room).toBe(71);
  });
});
