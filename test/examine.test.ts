import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Command, Diff, EngineAdapter } from "../src/engine/adapter.js";
import type { Hotspot } from "../src/model/hotspot-list.js";
import { loadPack, Pack, type PackData } from "../src/model/pack.js";
import type { Inventory } from "../src/ui/inventory.js";
import type { ListMode } from "../src/ui/list-mode.js";
import type { LiveRegion } from "../src/ui/live-region.js";
import type { Sonar } from "../src/sonar/sonar.js";
import type { VerbMenu } from "../src/ui/verb-menu.js";
import {
  Controller,
  isGenericLookLine,
  suppressGenericLook,
} from "../src/ui/controller.js";

// The Crew survey (room 62, the inn bar) found examine (Down) only sent the
// engine `look`, so people and doors answered the stock "I can't see anything
// in particular" line, or nothing. Examine now announces the pack's authored
// description first — an object's/person's `description`, or an exit's `label`
// — and the generic engine reply is filtered out of the look diff so it never
// reaches the player. These tests pin that for the bartender (npc 52) and the
// stone arch door (exit 106) in room 62, using the real drascula-en pack.

function realPack(): Pack {
  const url = new URL("../packs/drascula-en.json", import.meta.url);
  const data = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as PackData;
  return loadPack(data);
}

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

/** An adapter stand-in recording the commands sent. */
class FakeAdapter {
  sent: Command[] = [];
  send(cmd: Command): void {
    this.sent.push(cmd);
  }
  start(): Promise<void> {
    return Promise.resolve();
  }
  onEvent(): () => void {
    return () => {};
  }
}

const bartender: Hotspot = {
  num: 52,
  kind: "npc",
  name: "bartender",
  rect: [10, 100, 20, 40],
  walkTo: [10, 140],
};

const arch: Hotspot = {
  num: 106,
  kind: "exit",
  name: "stone arch to the back room",
  rect: [300, 80, 30, 60],
  walkTo: [300, 140],
  toRoom: 63,
};

/**
 * Build a controller focused on `focused`, in room 62, with the real pack.
 * `announceSaid` mirrors main.ts: it runs the engine's look diff through
 * suppressGenericLook before announcing, so the test exercises the same seam
 * the player uses.
 */
function harness(focused: Hotspot) {
  const live = new FakeLive();
  const adapter = new FakeAdapter();
  const pack = realPack();
  const controller = new Controller({
    adapter: adapter as unknown as EngineAdapter,
    pack,
    currentRoom: () => 62,
    list: { current: () => focused } as unknown as ListMode,
    verbMenu: { isOpen: () => false } as unknown as VerbMenu,
    inventory: {
      isOpen: () => false,
      activeItemId: () => null,
    } as unknown as Inventory,
    live: live as unknown as LiveRegion,
    showHighlight: () => {},
    readRoom: () => {},
    readHelp: () => {},
    stopAudio: () => {},
    askHint: () => {},
    sonar: { stop: () => {} } as unknown as Sonar,
  });

  // Mirror of main.ts announceSaid: the look diff's spoken text, with the
  // generic no-info line filtered out, reaches the live region.
  const announceSaid = (diff: Diff): void => {
    for (const line of suppressGenericLook(diff)) live.announce(line.text);
  };

  return { controller, live, adapter, announceSaid };
}

describe("isGenericLookLine", () => {
  it("matches the engine's stock no-info reply, case-insensitively", () => {
    expect(isGenericLookLine("I CAN'T SEE ANYTHING IN PARTICULAR")).toBe(true);
    expect(isGenericLookLine("i can't see anything in particular.")).toBe(true);
  });

  it("does not match an authored description", () => {
    expect(
      isGenericLookLine("A big bald man in a vest, leaning on the bar."),
    ).toBe(false);
    expect(isGenericLookLine("stone arch to the back room")).toBe(false);
  });
});

describe("suppressGenericLook", () => {
  it("drops the generic line only from a look diff", () => {
    const lookDiff: Diff = {
      cmd: "look 52",
      said: [{ color: "white", text: "I CAN'T SEE ANYTHING IN PARTICULAR" }],
      changed: false,
    };
    expect(suppressGenericLook(lookDiff)).toEqual([]);
  });

  it("keeps engine text that adds something beyond the pack", () => {
    const lookDiff: Diff = {
      cmd: "look 52",
      said: [{ color: "white", text: "HE WINKS AT YOU." }],
      changed: false,
    };
    expect(suppressGenericLook(lookDiff)).toEqual([
      { color: "white", text: "HE WINKS AT YOU." },
    ]);
  });

  it("leaves non-look diffs untouched", () => {
    const talkDiff: Diff = {
      cmd: "talk 52",
      said: [{ color: "white", text: "I CAN'T SEE ANYTHING IN PARTICULAR" }],
      changed: false,
    };
    expect(suppressGenericLook(talkDiff)).toEqual(talkDiff.said);
  });
});

describe("examine in room 62 announces the pack description", () => {
  it("announces the bartender's authored description and still sends look", () => {
    const { controller, live, adapter } = harness(bartender);

    controller.handleKey("ArrowDown");

    expect(live.last).toBe("A big bald man in a vest, leaning on the bar.");
    expect(adapter.sent).toEqual([{ verb: "look", target: 52 }]);
  });

  it("suppresses the generic engine reply for the bartender", () => {
    const { controller, live, announceSaid } = harness(bartender);

    controller.handleKey("ArrowDown");
    // The engine's async look reply arrives as a diff carrying only the stock
    // no-info line.
    announceSaid({
      cmd: "look 52",
      said: [{ color: "white", text: "I CAN'T SEE ANYTHING IN PARTICULAR" }],
      changed: false,
    });

    // The generic line was filtered, so the pack description stands as the last
    // line the player hears.
    expect(live.lines).toEqual([
      "A big bald man in a vest, leaning on the bar.",
    ]);
  });

  it("announces the door's pack label and suppresses the generic reply", () => {
    const { controller, live, adapter, announceSaid } = harness(arch);

    controller.handleKey("ArrowDown");
    announceSaid({
      cmd: "look 106",
      said: [{ color: "white", text: "I CAN'T SEE ANYTHING IN PARTICULAR" }],
      changed: false,
    });

    expect(adapter.sent).toEqual([{ verb: "look", target: 106 }]);
    expect(live.lines).toEqual(["stone arch to the back room"]);
  });
});
