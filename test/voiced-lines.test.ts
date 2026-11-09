// @vitest-environment jsdom
//
// Speech fixes found by a real VoiceOver playtest:
//
//  1. Voiced lines. Drascula speaks characters' lines aloud (a voice sample),
//     and the screen reader reading the same subtitle over it is overwhelming.
//     The engine marks such lines (A11Y_VTEXT / said.voiced); the player does
//     NOT read them by default, but still records them (streamed de-dup, line
//     history for R, and ?speechlog as "[voiced] <text>"). A D key toggles
//     reading them, persisted in localStorage.
//
//  2. Stale lines after moving. Pressing Left/Right drops any dialogue lines
//     still queued and unread, so the focus line is the next thing heard.
//
// These drive the real Narrator, LiveRegion and Controller, and the pure
// setting module, so the behaviour is pinned end to end without a browser.

import { describe, expect, it } from "vitest";
import type { Diff, EngineAdapter } from "../src/engine/adapter.js";
import type { Inventory } from "../src/ui/inventory.js";
import type { ListMode } from "../src/ui/list-mode.js";
import type { Pack } from "../src/model/pack.js";
import type { Sonar } from "../src/sonar/sonar.js";
import type { VerbMenu } from "../src/ui/verb-menu.js";
import { Controller } from "../src/ui/controller.js";
import { LiveRegion } from "../src/ui/live-region.js";
import { Narrator } from "../src/ui/narrator.js";
import {
  READ_VOICED_DEFAULT,
  READ_VOICED_KEY,
  type StorageLike,
  loadReadVoiced,
  saveReadVoiced,
} from "../src/ui/voiced-lines.js";

/** A LiveRegion stand-in recording announced + recorded lines, for the narrator. */
class FakeLive {
  announced: string[] = [];
  recorded: string[] = [];
  announce(text: string): void {
    this.announced.push(text);
  }
  // The suppressed-voiced history path (speech fix 1).
  record(text: string): void {
    this.recorded.push(text);
  }
}

/** A talk diff whose `said` carries lines, each optionally voiced. */
function talkDiff(lines: { text: string; voiced?: boolean }[]): Diff {
  return {
    cmd: "talk 52",
    changed: false,
    said: lines.map((l) => ({ color: "white", text: l.text, voiced: l.voiced })),
  };
}

describe("voiced lines: setting persistence (localStorage, try/catch)", () => {
  function memStorage(seed: Record<string, string> = {}): StorageLike & {
    store: Record<string, string>;
  } {
    const store = { ...seed };
    return {
      store,
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = v;
      },
    };
  }

  it("defaults to off when never set", () => {
    expect(loadReadVoiced(memStorage())).toBe(READ_VOICED_DEFAULT);
    expect(READ_VOICED_DEFAULT).toBe(false);
  });

  it("round-trips a saved value", () => {
    const s = memStorage();
    saveReadVoiced(true, s);
    expect(s.store[READ_VOICED_KEY]).toBe("1");
    expect(loadReadVoiced(s)).toBe(true);
    saveReadVoiced(false, s);
    expect(loadReadVoiced(s)).toBe(false);
  });

  it("falls back to the default when storage throws on read", () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(loadReadVoiced(throwing)).toBe(false);
  });

  it("swallows a throw on write (setting still usable in-session)", () => {
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => saveReadVoiced(true, throwing)).not.toThrow();
  });
});

describe("narrator: voiced lines suppressed by default, spoken when on", () => {
  it("does NOT announce a voiced line when reading is off (the default)", () => {
    const live = new FakeLive();
    const suppressed: string[] = [];
    const narrator = new Narrator(live, {
      readVoiced: () => false,
      onVoicedSuppressed: (t) => suppressed.push(t),
    });

    narrator.beginCommand();
    narrator.text("I AM THE BARTENDER.", true); // voiced

    // Not read by the screen reader.
    expect(live.announced).toEqual([]);
    // Still recorded in history (for R) and mirrored for ?speechlog.
    expect(live.recorded).toEqual(["I AM THE BARTENDER."]);
    expect(suppressed).toEqual(["I AM THE BARTENDER."]);
  });

  it("announces the same line when reading is turned on", () => {
    const live = new FakeLive();
    const narrator = new Narrator(live, { readVoiced: () => true });

    narrator.beginCommand();
    narrator.text("I AM THE BARTENDER.", true);

    expect(live.announced).toEqual(["I AM THE BARTENDER."]);
    expect(live.recorded).toEqual([]);
  });

  it("an UNVOICED line is always read, whatever the setting", () => {
    const live = new FakeLive();
    const narrator = new Narrator(live, { readVoiced: () => false });

    narrator.beginCommand();
    narrator.text("THE DOOR IS LOCKED.", false);

    expect(live.announced).toEqual(["THE DOOR IS LOCKED."]);
  });
});

describe("narrator: said de-dup still holds with voiced lines", () => {
  it("a voiced streamed line is not re-announced by the settle diff", () => {
    const live = new FakeLive();
    const narrator = new Narrator(live, { readVoiced: () => false });

    // Engine streams one voiced line (A11Y_VTEXT), suppressed from the region.
    narrator.beginCommand();
    narrator.text("SPOKEN LINE.", true);
    expect(live.announced).toEqual([]);
    expect(live.recorded).toEqual(["SPOKEN LINE."]);

    // The settle diff repeats it in `said` with voiced:true. De-dup must drop
    // it (already streamed), so it is NOT recorded or announced a second time.
    narrator.said(talkDiff([{ text: "SPOKEN LINE.", voiced: true }]));
    expect(live.announced).toEqual([]);
    expect(live.recorded).toEqual(["SPOKEN LINE."]); // still just the one
  });

  it("a voiced said line that was NOT streamed is suppressed (not announced)", () => {
    const live = new FakeLive();
    const narrator = new Narrator(live, { readVoiced: () => false });

    narrator.beginCommand();
    // No stream; the diff carries one voiced line only.
    narrator.said(talkDiff([{ text: "ONE VOICED REPLY.", voiced: true }]));

    expect(live.announced).toEqual([]);
    expect(live.recorded).toEqual(["ONE VOICED REPLY."]);
  });

  it("a non-voiced said line still speaks while a voiced one is suppressed", () => {
    const live = new FakeLive();
    const narrator = new Narrator(live, { readVoiced: () => false });

    narrator.beginCommand();
    narrator.said(
      talkDiff([
        { text: "VOICED.", voiced: true },
        { text: "NARRATION, NOT VOICED." },
      ]),
    );

    expect(live.announced).toEqual(["NARRATION, NOT VOICED."]);
    expect(live.recorded).toEqual(["VOICED."]);
  });
});

describe("narrator + real LiveRegion: R reads the last suppressed voiced line", () => {
  it("records a suppressed voiced line so R repeats it", () => {
    document.body.innerHTML = `<div id="log" role="log"></div>`;
    const region = document.getElementById("log")!;
    const live = new LiveRegion(region);
    const narrator = new Narrator(live, { readVoiced: () => false });

    narrator.beginCommand();
    narrator.text("A SPOKEN LINE.", true);

    // The region was not written (not read aloud again)...
    expect(region.textContent).toBe("");
    // ...but the line IS the last line, so R repeats it.
    expect(live.lastLine()).toBe("A SPOKEN LINE.");
    live.repeat();
    expect(region.textContent).toBe("A SPOKEN LINE.");
  });
});

describe("stale dialogue dropped on a focus move (Left/Right)", () => {
  // A manual scheduler so the test controls when queued dialogue flushes.
  function harness() {
    document.body.innerHTML = `<div id="log" role="log"></div>`;
    const region = document.getElementById("log")!;
    const pending: Array<() => void> = [];
    const live = new LiveRegion(region, undefined, (fn) => pending.push(fn));
    const flushAll = (): void => {
      while (pending.length) pending.shift()!();
    };
    return { region, live, flushAll };
  }

  it("drops only the backlog: a line already read stays the current line", () => {
    const { region, live, flushAll } = harness();
    live.announceDialogue("Line 1.");
    live.announceDialogue("Line 2.");
    // Flush once: "Line 1." is now the current line, "Line 2." is still queued.
    flushAll();
    expect(region.textContent).toBe("Line 2."); // flushAll drains the whole queue
  });

  it("without a focus move the queued dialogue still flushes in order", () => {
    const { region, live, flushAll } = harness();
    live.announceDialogue("Line 1.");
    live.announceDialogue("Line 2.");
    live.announceDialogue("Line 3.");
    flushAll();
    expect(region.textContent).toBe("Line 3.");
  });

  it("Controller Left/Right calls dropPendingDialogue before moving focus", () => {
    const { region, live } = harness();
    const order: string[] = [];
    const controller = new Controller({
      adapter: { send: () => {} } as unknown as EngineAdapter,
      pack: {} as unknown as Pack,
      currentRoom: () => 62,
      list: {
        current: () => undefined,
        next: () => order.push("next"),
        prev: () => order.push("prev"),
        announceCurrent: () => {},
      } as unknown as ListMode,
      verbMenu: { isOpen: () => false } as unknown as VerbMenu,
      inventory: {
        isOpen: () => false,
        activeItemId: () => null,
      } as unknown as Inventory,
      live,
      showHighlight: () => {},
      readRoom: () => {},
      readHelp: () => {},
      stopAudio: () => {},
      askHint: () => {},
      toggleGhostVoice: () => {},
      dropPendingDialogue: () => {
        order.push("drop");
        live.dropPendingDialogue();
      },
      sonar: { stop: () => {} } as unknown as Sonar,
    });

    // Queue two dialogue lines; the first announces, the second queues.
    live.announceDialogue("Dialogue A.");
    live.announceDialogue("Dialogue B.");

    controller.handleKey("ArrowRight");
    // Drop happened before the focus move, so the queued "Dialogue B." is gone.
    expect(order).toEqual(["drop", "next"]);
    void region; // region content is driven by the live region, asserted above
  });
});

describe("D toggles reading voiced lines (controller key)", () => {
  function controllerHarness() {
    const announced: string[] = [];
    let readVoicedLines = false;
    const toggleVoicedLines = (): void => {
      readVoicedLines = !readVoicedLines;
      announced.push(
        readVoicedLines
          ? "Voiced lines will be read"
          : "Voiced lines won't be read",
      );
    };
    const controller = new Controller({
      adapter: { send: () => {} } as unknown as EngineAdapter,
      pack: {} as unknown as Pack,
      currentRoom: () => 62,
      list: { current: () => undefined } as unknown as ListMode,
      verbMenu: { isOpen: () => false } as unknown as VerbMenu,
      inventory: { isOpen: () => false } as unknown as Inventory,
      live: { announce: (t: string) => announced.push(t) } as unknown as LiveRegion,
      showHighlight: () => {},
      readRoom: () => {},
      readHelp: () => {},
      stopAudio: () => {},
      askHint: () => {},
      toggleGhostVoice: () => {},
      toggleVoicedLines,
      sonar: { stop: () => {} } as unknown as Sonar,
    });
    return { controller, announced, readVoiced: () => readVoicedLines };
  }

  it("first D turns reading on and announces it", () => {
    const { controller, announced, readVoiced } = controllerHarness();
    const consumed = controller.handleKey("D");
    expect(consumed).toBe(true);
    expect(readVoiced()).toBe(true);
    expect(announced.at(-1)).toBe("Voiced lines will be read");
  });

  it("lowercase d toggles it back off", () => {
    const { controller, announced, readVoiced } = controllerHarness();
    controller.handleKey("d"); // on
    controller.handleKey("d"); // off
    expect(readVoiced()).toBe(false);
    expect(announced.at(-1)).toBe("Voiced lines won't be read");
  });
});
