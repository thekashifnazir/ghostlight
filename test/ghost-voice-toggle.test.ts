import { describe, expect, it, vi } from "vitest";
import type { EngineAdapter } from "../src/engine/adapter.js";
import type { Inventory } from "../src/ui/inventory.js";
import type { ListMode } from "../src/ui/list-mode.js";
import type { LiveRegion } from "../src/ui/live-region.js";
import type { Pack } from "../src/model/pack.js";
import type { Sonar } from "../src/sonar/sonar.js";
import type { VerbMenu } from "../src/ui/verb-menu.js";
import { Controller } from "../src/ui/controller.js";
import { GhostAudio } from "../src/hints/audio.js";

// The G key toggles the ghost voice (hints-and-ghost R6.2). Before this, nobody
// called GhostAudio.setEnabled, so the ghost audio could not be turned off.
// These tests pin the wiring main.ts uses: G flips a flag, calls
// GhostAudio.setEnabled, and announces the new state to the live region, while
// the text hints (askHint) are never suppressed.

/** A LiveRegion stand-in recording announced lines; `last` is the newest. */
class FakeLive {
  lines: string[] = [];
  announce(text: string): void {
    this.lines.push(text);
  }
  get last(): string | undefined {
    return this.lines[this.lines.length - 1];
  }
}

/** A minimal AudioContext stand-in (gain + destination only). */
function fakeCtx(): AudioContext {
  return {
    createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() })),
    destination: {},
  } as unknown as AudioContext;
}

/**
 * Build a controller whose toggleGhostVoice mirrors main.ts: it flips an
 * on/off flag, pushes it to the real GhostAudio, and announces the result.
 */
function harness() {
  const live = new FakeLive();
  const ghostAudio = new GhostAudio(fakeCtx(), {});
  const setEnabled = vi.spyOn(ghostAudio, "setEnabled");

  let ghostVoiceOn = true;
  const toggleGhostVoice = (): void => {
    ghostVoiceOn = !ghostVoiceOn;
    ghostAudio.setEnabled(ghostVoiceOn);
    live.announce(ghostVoiceOn ? "Ghost voice on." : "Ghost voice off.");
  };

  const askHint = vi.fn();

  const controller = new Controller({
    adapter: { send: vi.fn() } as unknown as EngineAdapter,
    pack: {} as unknown as Pack,
    currentRoom: () => 62,
    list: { current: () => undefined } as unknown as ListMode,
    verbMenu: { isOpen: () => false } as unknown as VerbMenu,
    inventory: { isOpen: () => false } as unknown as Inventory,
    live: live as unknown as LiveRegion,
    showHighlight: () => {},
    readRoom: () => {},
    readHelp: () => {},
    stopAudio: () => {},
    askHint,
    toggleGhostVoice,
    sonar: { stop: () => {} } as unknown as Sonar,
  });

  return { controller, live, ghostAudio, setEnabled, askHint };
}

describe("ghost voice toggle (G)", () => {
  it("G turns the ghost voice off, announcing the new state", () => {
    const { controller, live, setEnabled } = harness();
    const consumed = controller.handleKey("G");
    expect(consumed).toBe(true);
    expect(setEnabled).toHaveBeenLastCalledWith(false);
    expect(live.last).toBe("Ghost voice off.");
  });

  it("lowercase g toggles it too", () => {
    const { controller, live, setEnabled } = harness();
    controller.handleKey("g");
    expect(setEnabled).toHaveBeenLastCalledWith(false);
    expect(live.last).toBe("Ghost voice off.");
  });

  it("toggles back on when pressed again", () => {
    const { controller, live, ghostAudio, setEnabled } = harness();
    controller.handleKey("G"); // off
    controller.handleKey("G"); // on
    expect(setEnabled).toHaveBeenLastCalledWith(true);
    expect(ghostAudio.isEnabled()).toBe(true);
    expect(live.last).toBe("Ghost voice on.");
  });

  it("does not suppress text hints: asking for a hint still works when off", () => {
    const { controller, askHint } = harness();
    controller.handleKey("G"); // ghost voice off
    controller.handleKey("h"); // ask for a hint
    expect(askHint).toHaveBeenCalledTimes(1);
  });
});
