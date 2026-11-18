import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  Command,
  EngineAdapter,
  EngineEvent,
  RoomObject,
  RoomState,
} from "../src/engine/adapter.js";
import { parseA11yLine } from "../src/engine/a11y-lines.js";
import { buildHotspotList, type Hotspot } from "../src/model/hotspot-list.js";
import { loadPack, Pack, type PackData } from "../src/model/pack.js";
import type { Inventory } from "../src/ui/inventory.js";
import type { ListMode } from "../src/ui/list-mode.js";
import type { LiveRegion } from "../src/ui/live-region.js";
import type { Sonar } from "../src/sonar/sonar.js";
import type { VerbMenu } from "../src/ui/verb-menu.js";
import { Controller } from "../src/ui/controller.js";
import { Narrator } from "../src/ui/narrator.js";

// Regression for the live-engine (ghostlight.kashifnazir.com/?live) survey:
// examine was noisy on the A11Y_TEXT path, which bypassed the diff-path examine
// filter. These tests replay the EXACT lines the engine emitted and assert the
// live region speaks only the intended line(s):
//   - Down on the bartender: the pack description only; not the generic
//     "I CAN'T SEE ANYTHING IN PARTICULAR" A11Y_TEXT, not the "BARTENDER" hover
//     label.
//   - Down on doorway 105: the pack label only; not "Nothing happened." after
//     the look, not the stray "hacker" hover label (the hero's own drawn name).
//   - A conversation line the engine reports both as an A11Y_TEXT event and in
//     the diff's `said`: announced exactly once.
// The lines flow through the real parseA11yLine, the real Controller.examine
// (which arms the narrator via beginExamine), and the real Narrator — the same
// path main.ts wires, so live and this replay cannot drift.

function realPack(): Pack {
  const url = new URL("../packs/drascula-en.json", import.meta.url);
  const data = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as PackData;
  return loadPack(data);
}

/** A LiveRegion stand-in recording announced lines; `last` is the newest. */
class FakeLive {
  lines: string[] = [];
  /** How many times examine held its description for the engine's reply. */
  holds = 0;
  announce(text: string): void {
    this.lines.push(text);
  }
  holdForReply(): void {
    this.holds += 1;
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

// Room 62 (the inn bar) objects, mirroring the engine's raw A11Y objects: the
// bartender (npc 52), the two doors (105 curtained doorway, 106 stone arch).
// Raw names are the engine's ALL-CAPS hotspot names, as the live engine reports
// them; the pack overrides the spoken names.
const OBJECTS: RoomObject[] = [
  {
    num: 52,
    name: "BARTENDER",
    rect: [10, 100, 20, 40],
    walkTo: [10, 140],
    visible: true,
    door: false,
  },
  {
    num: 105,
    name: "DOOR",
    rect: [200, 60, 30, 70],
    walkTo: [200, 130],
    visible: true,
    door: true,
    toRoom: 63,
  },
  {
    num: 106,
    name: "ARC",
    rect: [300, 80, 30, 60],
    walkTo: [300, 140],
    visible: true,
    door: true,
    toRoom: 63,
  },
];

function room62(pack: Pack): { state: RoomState; list: Hotspot[] } {
  const state: RoomState = {
    chapter: 1,
    room: 62,
    hero: { x: 150, y: 150 },
    objects: OBJECTS,
    inventory: [],
    flags: new Array(50).fill(0),
  };
  return { state, list: buildHotspotList(state, pack) };
}

/**
 * Build the real narration path for room 62, focused on `num`. Returns the
 * controller (to issue the examine), the live recorder, and a `feed` that runs
 * one raw A11Y line through parseA11yLine and the same routing main.ts uses:
 * text events to narrator.text, diffs to narrator.said + maybeNothingHappened.
 */
function harness(num: number) {
  const pack = realPack();
  const live = new FakeLive();
  const adapter = new FakeAdapter();
  const { list } = room62(pack);
  const focused = list.find((h) => h.num === num);
  if (!focused) throw new Error(`no hotspot ${num} in room 62`);

  const narrator = new Narrator(live);
  narrator.setRoomLabels(
    list,
    OBJECTS.map((o) => o.name),
  );

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
    // The narrator stands in for the live region; examine's reply hold is a
    // LiveRegion timing concern, covered in voice-timing.test.ts.
    live: {
      announce: (text: string) => narrator.announce(text),
      holdForReply: () => live.holdForReply(),
    } as unknown as LiveRegion,
    beginExamine: () => narrator.beginExamine(),
    showHighlight: () => {},
    readRoom: () => {},
    readHelp: () => {},
    stopAudio: () => {},
    askHint: () => {},
    toggleGhostVoice: () => {},
    sonar: { stop: () => {} } as unknown as Sonar,
  });

  const feed = (raw: string): void => {
    const e = parseA11yLine(raw);
    if (!e) return;
    dispatch(e);
  };
  const dispatch = (e: EngineEvent): void => {
    switch (e.type) {
      case "text":
        narrator.text(e.line);
        break;
      case "diff": {
        const isLook = narrator.said(e.diff);
        narrator.maybeNothingHappened(e.diff, isLook);
        break;
      }
      default:
        break;
    }
  };

  return { controller, live, adapter, feed };
}

describe("examine on the live engine drops text-path noise", () => {
  it("bartender: speaks the pack description, not the generic line or hover label", () => {
    const { controller, live, adapter, feed } = harness(52);

    // Down examines the bartender: the pack description is announced up front
    // and `look 52` is sent.
    controller.handleKey("ArrowDown");
    expect(live.last).toBe("A big bald man in a vest, leaning on the bar.");
    expect(adapter.sent).toEqual([{ verb: "look", target: 52 }]);

    // The engine answers the look by DRAWING hover/examine text, which reaches
    // the player as A11Y_TEXT (not in the diff's `said`): first the generic
    // reply, then the "BARTENDER" hover label. Both are dropped during examine.
    feed("A11Y_TEXT I CAN'T SEE ANYTHING IN PARTICULAR");
    feed("A11Y_TEXT BARTENDER");
    // The look diff carries only the generic line in `said` and closes the
    // examine window.
    feed(
      'A11Y_DIFF {"cmd":"look 52","said":[{"color":"white","text":"I CAN\'T SEE ANYTHING IN PARTICULAR"}],"changed":false}',
    );

    expect(live.lines).toEqual([
      "A big bald man in a vest, leaning on the bar.",
    ]);
  });

  it("doorway 105: speaks the pack label, not 'Nothing happened.' or 'hacker'", () => {
    const { controller, live, adapter, feed } = harness(105);

    controller.handleKey("ArrowDown");
    expect(live.last).toBe("curtained doorway to the guest rooms");
    expect(adapter.sent).toEqual([{ verb: "look", target: 105 }]);

    // The engine draws its hover label for the hotspot under the cursor — here
    // the hero's own name, "hacker" (lower-case, from the _text table) — as an
    // A11Y_TEXT line. It is a hover echo, dropped during examine.
    feed("A11Y_TEXT hacker");
    // The look diff changed nothing and said nothing: "Nothing happened." must
    // NOT be announced for a look.
    feed('A11Y_DIFF {"cmd":"look 105","changed":false}');

    expect(live.lines).toEqual(["curtained doorway to the guest rooms"]);
    expect(live.lines).not.toContain("Nothing happened.");
    expect(live.lines).not.toContain("hacker");
  });
});

describe("hover/name labels never reach the live region, even outside an examine", () => {
  // The live survey saw "BARTENDER" (on the bartender) and "hacker" (on
  // doorway 105, the hero John Hacker under the warped cursor) reach the live
  // region AFTER the examine window had already closed — the engine keeps
  // drawing its hover label for whatever is under the cursor. These feed the
  // exact leaked lines with NO examine in flight and assert nothing is spoken.

  it("drops the 'BARTENDER' hover label with no examine armed", () => {
    const { live, feed } = harness(52);

    // No controller.handleKey("ArrowDown"): the examine window is closed.
    feed("A11Y_TEXT BARTENDER");

    expect(live.lines).toEqual([]);
  });

  it("drops the hero's 'hacker' hover label over doorway 105 with no examine armed", () => {
    const { live, feed } = harness(105);

    feed("A11Y_TEXT hacker");

    expect(live.lines).toEqual([]);
    expect(live.lines).not.toContain("hacker");
  });

  it("still announces real engine text outside an examine", () => {
    const { live, feed } = harness(52);

    // A multi-word line the engine composed is not a hover name and is kept.
    feed("A11Y_TEXT HE WINKS AT YOU.");

    expect(live.lines).toEqual(["HE WINKS AT YOU."]);
  });
});

describe("a conversation line reported as both text and said is spoken once", () => {
  it("de-duplicates the A11Y_TEXT event against the diff's said", () => {
    const { live, feed } = harness(52);

    // A talk reply: the engine draws the line (A11Y_TEXT when centerText runs),
    // then the command's diff carries the same line in `said`.
    const line = "WELCOME TO THE TAVERN, STRANGER.";
    feed(`A11Y_TEXT ${line}`);
    feed(
      `A11Y_DIFF {"cmd":"talk 52","said":[{"color":"white","text":"${line}"}],"changed":true}`,
    );

    expect(live.lines).toEqual([line]);
  });

  it("still speaks a talk line that only arrives in the diff said", () => {
    const { live, feed } = harness(52);

    const line = "HE IGNORES YOU COMPLETELY.";
    feed(
      `A11Y_DIFF {"cmd":"talk 52","said":[{"color":"white","text":"${line}"}],"changed":true}`,
    );

    expect(live.lines).toEqual([line]);
  });
});
