import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineEvent } from "../src/engine/adapter.js";
import { LiveAdapter } from "../src/engine/live-adapter.js";
import type { ScummvmBootModule } from "../src/engine/boot.js";

// installReader wraps Module.printErr. A listener exception must never escape
// printErr: Emscripten's stderr TTY only clears its buffer AFTER printErr
// returns, so an error thrown out of here strands the current line and glues
// the next engine line onto it, wedging the player "busy" forever. These tests
// pin that a throwing listener is caught and does not stop later events.

describe("LiveAdapter.installReader error isolation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers a second event when a listener throws on the first", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const adapter = new LiveAdapter();
    const seen: EngineEvent[] = [];
    let calls = 0;
    adapter.onEvent((e) => {
      calls += 1;
      // Throw on the first event only; the reader must carry on to the second.
      if (calls === 1) throw new Error("listener boom");
      seen.push(e);
    });

    const module: ScummvmBootModule = {} as ScummvmBootModule;
    adapter.installReader(module);

    // Two A11Y lines in one printErr string. They are split into two events,
    // the first of which makes the listener throw.
    module.printErr!("A11Y_TEXT first line\nA11Y_TEXT second line");

    expect(calls).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ type: "text", line: "second line" });
    // The thrown error was logged with the raw line for context.
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]).toContain("A11Y_TEXT first line");
  });

  it("isolates a throwing listener from a second listener on the same event", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const adapter = new LiveAdapter();
    adapter.onEvent(() => {
      throw new Error("first listener boom");
    });
    const second = vi.fn();
    adapter.onEvent(second);

    const module: ScummvmBootModule = {} as ScummvmBootModule;
    adapter.installReader(module);
    module.printErr!("A11Y_TEXT only line");

    // The second listener still ran despite the first throwing.
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0][0]).toEqual({ type: "text", line: "only line" });
  });
});
