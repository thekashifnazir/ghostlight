import { describe, expect, it, vi } from "vitest";
import { GhostAudio } from "../src/hints/audio.js";

// A minimal AudioContext stand-in. The tests exercise the disabled, missing-key
// and stop paths, none of which touch decode/playback, so the methods only need
// to exist; if a test did reach them the spies would record the calls.
function fakeCtx() {
  const source = {
    buffer: null as unknown,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as unknown,
  };
  return {
    ctx: {
      decodeAudioData: vi.fn(async () => ({}) as AudioBuffer),
      createBufferSource: vi.fn(() => source),
      createGain: vi.fn(() => ({
        gain: { value: 0 },
        connect: vi.fn(),
      })),
      destination: {},
    } as unknown as AudioContext,
    source,
  };
}

describe("GhostAudio", () => {
  it("defaults to enabled", () => {
    const { ctx } = fakeCtx();
    const audio = new GhostAudio(ctx, {});
    expect(audio.isEnabled()).toBe(true);
  });

  it("play is a no-op when disabled", async () => {
    const { ctx } = fakeCtx();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const audio = new GhostAudio(ctx, { "./ghost/abc.mp3": "/assets/abc.mp3" });
    audio.setEnabled(false);
    await audio.play("abc");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("is silent for a key with no glob entry (no throw, no fetch)", async () => {
    const { ctx } = fakeCtx();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const audio = new GhostAudio(ctx, {}); // empty map: nothing cached
    await expect(audio.play("missing-key")).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("stop is safe when nothing is playing", () => {
    const { ctx } = fakeCtx();
    const audio = new GhostAudio(ctx, {});
    expect(() => audio.stop()).not.toThrow();
  });

  it("setEnabled(false) stops any current playback safely", () => {
    const { ctx } = fakeCtx();
    const audio = new GhostAudio(ctx, {});
    // No current source; toggling off must not throw.
    expect(() => audio.setEnabled(false)).not.toThrow();
    expect(audio.isEnabled()).toBe(false);
  });
});
