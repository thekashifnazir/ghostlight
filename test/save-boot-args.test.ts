// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { bootEngine, type ScummvmBootModule } from "../src/engine/boot.js";
import type { EngineEvent } from "../src/engine/adapter.js";

/**
 * Drive bootEngine with a stubbed loadScript (no real wasm) and a one-shot
 * room event, so we can inspect the launch arguments it sets. The engine's
 * --pre-js repopulates Module.arguments from location.hash, so boot sets the
 * hash to the space-joined args; we read the hash back to assert them.
 */
async function bootWith(saveSlot?: number): Promise<string[]> {
  const w = window as unknown as { Module?: ScummvmBootModule };
  w.Module = { canvas: document.createElement("canvas"), printErr: () => {} };

  let emitRoom: (() => void) | undefined;
  await bootEngine({
    installReader: () => {},
    onEvent: (listener: (e: EngineEvent) => void) => {
      // Fire the first room on the next tick so bootEngine's await resolves.
      emitRoom = () =>
        listener({
          type: "room",
          state: {
            chapter: 1,
            room: 62,
            hero: { x: 0, y: 0 },
            objects: [],
            inventory: [],
            flags: [],
          },
        });
      return () => {};
    },
    loadScript: async () => {
      emitRoom?.();
    },
    saveSlot,
  });

  // boot sets location.hash to the space-joined launch args.
  return decodeURIComponent(window.location.hash.replace(/^#/, "")).split(" ");
}

afterEach(() => {
  window.location.hash = "";
});

describe("boot launch arguments (save-progress)", () => {
  it("launches a fresh game with --savepath=/saves and no --save-slot", async () => {
    const args = await bootWith(undefined);
    expect(args).toContain("--savepath=/saves");
    expect(args.some((a) => a.startsWith("--save-slot"))).toBe(false);
    expect(args).toContain("--subtitles");
    // The game target is still launched from /data/games/drascula.
    expect(args).toContain("-p");
    expect(args).toContain("/data/games/drascula");
    expect(args).toContain("drascula");
  });

  it("appends --save-slot=<n> when a slot is requested (load at launch)", async () => {
    const args = await bootWith(1);
    expect(args).toContain("--savepath=/saves");
    expect(args).toContain("--save-slot=1");
  });

  it("does not launch with the old in-memory /tmp save path", async () => {
    const args = await bootWith(undefined);
    expect(args).not.toContain("--savepath=/tmp");
  });
});
