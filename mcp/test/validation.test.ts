import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Session } from "../src/session.js";
import { TARGET_VERBS, Tools, type TargetVerb } from "../src/tools.js";
import type { Command, CommandResult, RoomState, Transport } from "../src/transport.js";

// Property test (Requirement 8): every target-verb tool and the `use` tool's
// target reject a number that is not a valid target, and send NOTHING to the
// transport. look/take/open/close/push also accept a currently held inventory
// item as the target (engine task 11); walk and talk stay room-only. The
// positive companions confirm a valid in-room target (and, for the item verbs,
// a held item) is not rejected by validation. Validation is judged against the
// current room only and runs in the tool layer before any send, so this holds
// identically on both transports.

/** Verbs that accept a held item as well as a room hotspot. */
const ITEM_VERBS: readonly TargetVerb[] = ["look", "take", "open", "close", "push"];
/** Verbs that only accept a room hotspot. */
const ROOM_ONLY_VERBS: readonly TargetVerb[] = ["walk", "talk"];

/** The real room-62 (tavern) state: object numbers, one held item (28). */
const room62: RoomState = {
  chapter: 1,
  room: 62,
  hero: { x: 65, y: 145 },
  objects: [52, 53, 54, 100, 101, 102, 103, 104, 105, 106].map((num) => ({
    num,
    name: `OBJ${num}`,
    rect: [0, 0, 10, 10] as [number, number, number, number],
    walkTo: [5, 10] as [number, number],
    visible: true,
    door: num === 105 || num === 106,
    ...(num === 105 || num === 106 ? { toRoom: 63 } : {}),
  })),
  inventory: [28],
  flags: new Array(50).fill(0),
};

const ROOM_NUMS = new Set(room62.objects.map((o) => o.num));
const HELD = new Set(room62.inventory);
const HERO = 50;

/** Records sends so a test can assert "nothing reached the transport". */
class RecordingTransport implements Transport {
  readonly sent: Command[] = [];
  async start(): Promise<RoomState> {
    return room62;
  }
  async send(cmd: Command): Promise<CommandResult> {
    this.sent.push(cmd);
    return { events: [{ type: "diff", diff: { cmd: "x", changed: false } }], diff: { cmd: "x", changed: false } };
  }
  async stop(): Promise<void> {}
}

async function startedTools(): Promise<{ tools: Tools; transport: RecordingTransport }> {
  const transport = new RecordingTransport();
  const tools = new Tools(new Session(), () => transport);
  await tools.start();
  return { tools, transport };
}

/** Any integer that is NOT a hotspot number in room 62. */
const notInRoom = fc.integer({ min: -5, max: 5000 }).filter((n) => !ROOM_NUMS.has(n));

/** Any integer that is neither a room hotspot nor a held item in room 62. */
const notInRoomNorHeld = fc
  .integer({ min: -5, max: 5000 })
  .filter((n) => !ROOM_NUMS.has(n) && !HELD.has(n));

/** Any integer that is not a hotspot, not a held item, and not the hero. */
const invalidUseTarget = fc
  .integer({ min: -5, max: 5000 })
  .filter((n) => !ROOM_NUMS.has(n) && !HELD.has(n) && n !== HERO);

describe("target validation (property, task 11)", () => {
  it("walk/talk reject an out-of-room target (even a held item) and send nothing", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ROOM_ONLY_VERBS), notInRoom, async (verb, target) => {
        const { tools, transport } = await startedTools();
        const r = await tools.targetVerb(verb, target);
        expect(r.isError).toBe(true);
        expect(transport.sent).toHaveLength(0);
      }),
      { numRuns: 300 },
    );
  });

  it("item verbs reject a target that is neither a hotspot nor a held item, and send nothing", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ITEM_VERBS), notInRoomNorHeld, async (verb, target) => {
        const { tools, transport } = await startedTools();
        const r = await tools.targetVerb(verb, target);
        expect(r.isError).toBe(true);
        expect(transport.sent).toHaveLength(0);
      }),
      { numRuns: 300 },
    );
  });

  it("item verbs accept a currently held item as a valid target (it is sent)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ITEM_VERBS),
        fc.constantFrom(...room62.inventory),
        async (verb, target) => {
          const { tools, transport } = await startedTools();
          const r = await tools.targetVerb(verb, target);
          expect(r.isError).toBe(false);
          expect(transport.sent).toEqual([{ verb, target }]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("use rejects a target that is not a hotspot, held item, or hero, and sends nothing", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 50 }), invalidUseTarget, async (item, target) => {
        const { tools, transport } = await startedTools();
        const r = await tools.use(item, target);
        expect(r.isError).toBe(true);
        expect(transport.sent).toHaveLength(0);
      }),
      { numRuns: 300 },
    );
  });

  it("a valid in-room target passes validation (it is sent, not rejected by validation)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...TARGET_VERBS),
        fc.constantFrom(...room62.objects.map((o) => o.num)),
        async (verb, target) => {
          const { tools, transport } = await startedTools();
          const r = await tools.targetVerb(verb, target);
          // Not a validation rejection: it reached the transport.
          expect(r.isError).toBe(false);
          expect(transport.sent).toEqual([{ verb, target }]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("use accepts the hero (50) and any held item as a valid target", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 50 }),
        fc.constantFrom(HERO, ...room62.inventory, ...room62.objects.map((o) => o.num)),
        async (item, target) => {
          const { tools, transport } = await startedTools();
          const r = await tools.use(item, target);
          expect(r.isError).toBe(false);
          expect(transport.sent).toEqual([{ verb: "use", item, target }]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
