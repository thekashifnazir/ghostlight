import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPack, Pack, type PackData } from "../src/model/pack.js";

function realPack(): Pack {
  const url = new URL("../packs/drascula-en.json", import.meta.url);
  const data = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as PackData;
  return loadPack(data);
}

describe("Pack reader", () => {
  const pack = realPack();

  it("reads room name and descriptions", () => {
    expect(pack.roomName(62)).toBe("Inn bar");
    expect(pack.roomShort(62)).toContain("stone tavern");
    expect(pack.roomLong(62)).toContain("chandelier");
  });

  it("reads exit labels and destinations", () => {
    expect(pack.exitLabel(62, 106)).toBe("stone arch to the back room");
    expect(pack.exitTo(62, 106)).toBe(63);
    // Door 105 in chapter 1 is a scripted doorway with to: null.
    expect(pack.exitTo(62, 105)).toBeNull();
  });

  it("reads object names, kinds and descriptions", () => {
    expect(pack.objectName(62, 52)).toBe("bartender");
    expect(pack.objectType(62, 52)).toBe("npc");
    expect(pack.objectName(62, 100)).toBe("skull");
    expect(pack.objectType(62, 100)).toBe("object");
    // An exit hotspot is reported as kind exit even though it is under exits.
    expect(pack.objectType(62, 106)).toBe("exit");
    expect(pack.objectDescription(62, 100)).toContain("skull");
  });

  it("reads item names, preferring the current chapter", () => {
    expect(pack.itemName(28)).toBe("mobile phone");
    expect(pack.itemName(22, 2)).toBe("B.J.'s handbag");
    expect(pack.itemName(13, 2)).toBe("bubble gum");
  });

  it("applies text fixes by context and room", () => {
    // Spanish hotspot name, room-scoped.
    expect(pack.applyTextFixes("ESCALERA", "hotspot", 14)).toBe("stairs");
    // The same raw string outside its room is unchanged by that room-scoped fix.
    expect(pack.applyTextFixes("ESCALERA", "hotspot", 99)).toBe("ESCALERA");
    // A global (room-less) hotspot fix applies anywhere.
    expect(pack.applyTextFixes("PUERTA", "hotspot", 62)).toBe("door");
    // A substring dialogue fix.
    expect(
      pack.applyTextFixes("WELL, DON'T DE AFRAID NOW", "dialogue"),
    ).toBe("WELL, DON'T BE AFRAID NOW");
    // A hotspot fix does not apply in a dialogue context.
    expect(pack.applyTextFixes("PUERTA", "dialogue")).toBe("PUERTA");
  });

  it("returns undefined for unknown rooms, objects and items (fallback)", () => {
    expect(pack.roomName(9999)).toBeUndefined();
    expect(pack.roomShort(9999)).toBeUndefined();
    expect(pack.objectName(62, 9999)).toBeUndefined();
    expect(pack.objectType(62, 9999)).toBeUndefined();
    expect(pack.exitTo(62, 9999)).toBeUndefined();
    expect(pack.itemName(9999)).toBeUndefined();
  });

  it("rejects an unknown major formatVersion", () => {
    const bad = {
      formatVersion: "2.0",
      rooms: {},
      items: [],
    } as unknown as PackData;
    expect(() => loadPack(bad)).toThrow(/formatVersion/);
  });
});

describe("Pack reader: state-aware description accessors (description-variants)", () => {
  // A small synthetic pack exercising both description forms, independent of
  // the real pack's data so these tests stand alone.
  function variantPack(): Pack {
    const data = {
      formatVersion: "1.0",
      rooms: {
        "5": {
          chapters: [2],
          name: "Behind the church fence",
          short: {
            default: "The window is boarded up.",
            variants: [{ when: { flags: { "8": 1 } }, text: "The window is open." }],
          },
          long: {
            default: "A boarded window on the left.",
            variants: [
              { when: { flags: { "8": 1 } }, text: "The forced-open window on the left." },
            ],
          },
          objects: {
            "213": {
              name: "other window",
              type: "object",
              description: {
                default: "A second window, shut.",
                variants: [{ when: { flags: { "8": 1 } }, text: "A second window, beside the open one." }],
              },
            },
            "212": { name: "moon", type: "object", description: "A full moon." },
          },
        },
      },
      items: [],
    } as unknown as PackData;
    return loadPack(data);
  }

  const pack = variantPack();
  const base = { chapter: 2, room: 5, inventory: [] as number[] };
  const closed = { ...base, flags: new Array(50).fill(0) };
  const open = { ...base, flags: Object.assign(new Array(50).fill(0), { 8: 1 }) };
  const NONE: ReadonlySet<string> = new Set();

  it("resolves room short/long to the default before the condition holds", () => {
    expect(pack.roomShortFor(5, closed, NONE)).toBe("The window is boarded up.");
    expect(pack.roomLongFor(5, closed, NONE)).toBe("A boarded window on the left.");
  });

  it("resolves room short/long to the variant once the condition holds", () => {
    expect(pack.roomShortFor(5, open, NONE)).toBe("The window is open.");
    expect(pack.roomLongFor(5, open, NONE)).toBe("The forced-open window on the left.");
  });

  it("resolves an object description by state", () => {
    expect(pack.objectDescriptionFor(5, 213, closed, NONE)).toBe("A second window, shut.");
    expect(pack.objectDescriptionFor(5, 213, open, NONE)).toBe(
      "A second window, beside the open one.",
    );
  });

  it("returns a plain-string object description unchanged for any state", () => {
    expect(pack.objectDescriptionFor(5, 212, closed, NONE)).toBe("A full moon.");
    expect(pack.objectDescriptionFor(5, 212, open, NONE)).toBe("A full moon.");
  });

  it("returns undefined for unknown rooms/objects (engine fallback preserved)", () => {
    expect(pack.roomShortFor(9999, open, NONE)).toBeUndefined();
    expect(pack.objectDescriptionFor(5, 9999, open, NONE)).toBeUndefined();
  });

  it("the plain accessors return the default form, ignoring variants", () => {
    expect(pack.roomShort(5)).toBe("The window is boarded up.");
    expect(pack.roomLong(5)).toBe("A boarded window on the left.");
    expect(pack.objectDescription(5, 213)).toBe("A second window, shut.");
  });
});
