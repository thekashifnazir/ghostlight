import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { InvItem } from "../src/engine/adapter.js";
import type { Hotspot } from "../src/model/hotspot-list.js";
import { parsePhrase } from "../src/model/parser.js";

const CTX = { inConversation: false, pendingChoice: false };

function hs(name: string, num: number): Hotspot {
  return {
    num,
    kind: "object",
    name,
    rect: [num * 10, 0, 5, 5],
    walkTo: [0, 0],
  };
}

// A pool of distinct one-word names to draw visible sets and absent names from.
const NAMES = [
  "bartender",
  "skull",
  "piano",
  "window",
  "trunk",
  "wardrobe",
  "mirror",
  "candle",
  "barrel",
  "statue",
  "gravestone",
  "chandelier",
];

describe("parsePhrase properties", () => {
  it("a phrase from a present name resolves to that hotspot (R12.2)", () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.constantFrom(...NAMES), { minLength: 1, maxLength: 6 })
          .chain((names) =>
            fc.record({
              names: fc.constant(names),
              pick: fc.integer({ min: 0, max: names.length - 1 }),
            }),
          ),
        ({ names, pick }) => {
          const visible = names.map((n, i) => hs(n, i + 1));
          const match = parsePhrase(names[pick], visible, [], CTX);
          // It must resolve to a hotspot, and specifically the chosen one.
          expect(match.kind).toBe("hotspot");
          if (match.kind !== "hotspot") throw new Error("kind");
          expect(match.hotspot.name).toBe(names[pick]);
        },
      ),
    );
  });

  it("a phrase from an absent name never resolves to a hotspot (R12.3)", () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.constantFrom(...NAMES), { minLength: 2, maxLength: 8 })
          .chain((names) =>
            fc.record({
              // Split the pool: some visible, at least one held out as absent.
              split: fc.integer({ min: 1, max: names.length - 1 }),
              names: fc.constant(names),
            }),
          ),
        ({ names, split }) => {
          const visible = names.slice(0, split).map((n, i) => hs(n, i + 1));
          const absent = names.slice(split);
          for (const absentName of absent) {
            const match = parsePhrase(absentName, visible, [], CTX);
            // Never a hotspot; none or ambiguous are the only acceptable
            // outcomes (ambiguous only among visible hotspots, never the absent
            // one).
            expect(match.kind === "hotspot").toBe(false);
            if (match.kind === "ambiguous") {
              for (const opt of match.options) {
                expect(opt.name).not.toBe(absentName);
              }
            }
          }
        },
      ),
    );
  });
});

describe("parsePhrase units", () => {
  const visible = [hs("left door", 1), hs("right door", 2), hs("skull", 3)];
  const inventory: InvItem[] = [
    { id: 13, name: "bubble gum" },
    { id: 9, name: "crucifix" },
  ];

  it("maps fixed phrases", () => {
    expect(parsePhrase("help", visible, [], CTX)).toEqual({
      kind: "fixed",
      action: "help",
    });
    expect(parsePhrase("where am i", visible, [], CTX)).toEqual({
      kind: "fixed",
      action: "readRoom",
    });
    expect(parsePhrase("inventory", visible, [], CTX)).toEqual({
      kind: "fixed",
      action: "inventory",
    });
  });

  it("maps a verb + name to a hotspot with the verb", () => {
    const m = parsePhrase("examine skull", visible, inventory, CTX);
    expect(m.kind).toBe("hotspot");
    if (m.kind !== "hotspot") throw new Error("kind");
    expect(m.hotspot.name).toBe("skull");
    expect(m.verb).toBe("look");
  });

  it("maps use X on Y to a use match against a visible hotspot", () => {
    const m = parsePhrase("use bubble gum on skull", visible, inventory, CTX);
    expect(m.kind).toBe("use");
    if (m.kind !== "use") throw new Error("kind");
    expect(m.item.id).toBe(13);
    expect("num" in m.target && m.target.num).toBe(3);
  });

  it("maps use X on Y2 to a use match against another item", () => {
    const m = parsePhrase("use bubble gum on crucifix", visible, inventory, CTX);
    expect(m.kind).toBe("use");
    if (m.kind !== "use") throw new Error("kind");
    expect(m.item.id).toBe(13);
    expect("id" in m.target && m.target.id).toBe(9);
  });

  it("returns ambiguous when a name matches more than one visible hotspot", () => {
    const m = parsePhrase("door", visible, inventory, CTX);
    expect(m.kind).toBe("ambiguous");
    if (m.kind !== "ambiguous") throw new Error("kind");
    expect(m.options).toHaveLength(2);
  });

  it("returns none with present names when nothing matches", () => {
    const m = parsePhrase("dragon", visible, inventory, CTX);
    expect(m.kind).toBe("none");
    if (m.kind !== "none") throw new Error("kind");
    expect(m.present).toContain("skull");
  });

  it("picks a conversation choice by number when a choice is pending", () => {
    const m = parsePhrase("2", visible, inventory, {
      inConversation: true,
      pendingChoice: true,
    });
    expect(m).toEqual({ kind: "choice", n: 2 });
  });
});

describe("parsePhrase split-word verbs vs use", () => {
  // A split word ("at", "to", "on") must not force the use branch for a plain
  // verb phrase. "look at X" / "talk to X" / "walk to X" resolve to the target
  // with the verb, while real use phrases still parse as use.
  const visible = [
    hs("bartender", 1),
    hs("drunk", 2),
    hs("stairs", 3),
    hs("machine", 4),
  ];
  const inventory: InvItem[] = [
    { id: 5, name: "coins" },
    { id: 7, name: "phone" },
  ];

  it("parses 'look at bartender' as a look on the bartender hotspot", () => {
    const m = parsePhrase("look at bartender", visible, inventory, CTX);
    expect(m.kind).toBe("hotspot");
    if (m.kind !== "hotspot") throw new Error("kind");
    expect(m.hotspot.name).toBe("bartender");
    expect(m.verb).toBe("look");
  });

  it("parses 'talk to drunk' as a talk on the drunk hotspot", () => {
    const m = parsePhrase("talk to drunk", visible, inventory, CTX);
    expect(m.kind).toBe("hotspot");
    if (m.kind !== "hotspot") throw new Error("kind");
    expect(m.hotspot.name).toBe("drunk");
    expect(m.verb).toBe("talk");
  });

  it("parses 'walk to stairs' as a walk on the stairs hotspot", () => {
    const m = parsePhrase("walk to stairs", visible, inventory, CTX);
    expect(m.kind).toBe("hotspot");
    if (m.kind !== "hotspot") throw new Error("kind");
    expect(m.hotspot.name).toBe("stairs");
    expect(m.verb).toBe("walk");
  });

  it("parses 'use coins on machine' as a use against the machine hotspot", () => {
    const m = parsePhrase("use coins on machine", visible, inventory, CTX);
    expect(m.kind).toBe("use");
    if (m.kind !== "use") throw new Error("kind");
    expect(m.item.id).toBe(5);
    expect("num" in m.target && m.target.num).toBe(4);
  });

  it("parses verbless 'phone on bartender' as a use against the bartender", () => {
    const m = parsePhrase("phone on bartender", visible, inventory, CTX);
    expect(m.kind).toBe("use");
    if (m.kind !== "use") throw new Error("kind");
    expect(m.item.id).toBe(7);
    expect("num" in m.target && m.target.num).toBe(1);
  });
});
