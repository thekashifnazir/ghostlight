import { describe, expect, it, vi } from "vitest";
import { SonarAudio } from "../src/sonar/audio.js";
import type { Ping } from "../src/sonar/mapping.js";

// jsdom has no Web Audio (no OfflineAudioContext), so these tests drive a
// mocked node graph that records what SonarAudio builds: the stereo panner's
// pan value (the ear a ping points to, R1.3), the oscillator waveforms and
// count per kind (timbre beyond pitch, R1.7), that a scan schedules every ping
// and a muted layer none (R5.4), and that stop() stops and disconnects every
// scheduled node so a scan is cancelled mid-flight (R5.1).
//
// The mock mirrors only the Web Audio surface SonarAudio touches. Oscillators,
// panners and filters are recorded in creation order so the test can assert on
// waveform and count, on each panner's pan value, and on the stop/disconnect
// calls stop() makes.

interface FakeOsc {
  type: string;
  frequency: {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function makeFakeCtx() {
  const oscillators: FakeOsc[] = [];
  const panners: { pan: { value: number } }[] = [];
  const filters: { type: string; frequency: { value: number } }[] = [];

  const audioParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });

  const ctx = {
    currentTime: 0,
    destination: {},
    createOscillator: vi.fn((): FakeOsc => {
      const osc: FakeOsc = {
        type: "sine",
        frequency: {
          value: 0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => ({
      gain: audioParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createBiquadFilter: vi.fn(() => {
      const f = { type: "lowpass", frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      filters.push(f);
      return f;
    }),
    createStereoPanner: vi.fn(() => {
      const p = { pan: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      panners.push(p);
      return p;
    }),
  };

  return { ctx: ctx as unknown as AudioContext, oscillators, panners, filters };
}

const ping = (over: Partial<Ping>): Ping => ({
  num: 1,
  name: "thing",
  kind: "object",
  centreX: 100,
  pan: 0,
  freq: 660,
  cutoff: 5000,
  gain: 1,
  onset: 0,
  distance: 0,
  band: "near",
  direction: "ahead",
  text: "thing, object, ahead, near",
  ...over,
});

describe("SonarAudio", () => {
  it("places an object ping with one sine oscillator panned to its pan", () => {
    const { ctx, oscillators, panners, filters } = makeFakeCtx();
    const audio = new SonarAudio(ctx);
    audio.playOne(ping({ kind: "object", pan: -0.5, cutoff: 4200 }));
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].type).toBe("sine");
    expect(panners).toHaveLength(1);
    expect(panners[0].pan.value).toBe(-0.5); // placed in the left ear.
    expect(filters[0].frequency.value).toBe(4200); // distance timbre.
  });

  it("gives an exit ping two rising triangle notes", () => {
    const { ctx, oscillators } = makeFakeCtx();
    const audio = new SonarAudio(ctx);
    audio.playOne(ping({ kind: "exit", freq: 440 }));
    expect(oscillators).toHaveLength(2);
    expect(oscillators.every((o) => o.type === "triangle")).toBe(true);
    // The second note is a fifth above the first.
    expect(oscillators[1].frequency.value).toBeGreaterThan(oscillators[0].frequency.value);
  });

  it("gives a person ping a sawtooth plus a vibrato LFO", () => {
    const { ctx, oscillators } = makeFakeCtx();
    const audio = new SonarAudio(ctx);
    audio.playOne(ping({ kind: "person", freq: 330 }));
    // One sawtooth voice + one LFO oscillator.
    expect(oscillators).toHaveLength(2);
    expect(oscillators.some((o) => o.type === "sawtooth")).toBe(true);
    // The sawtooth glides: its frequency is ramped, not set once.
    const saw = oscillators.find((o) => o.type === "sawtooth")!;
    expect(saw.frequency.setValueAtTime).toHaveBeenCalled();
    expect(saw.frequency.linearRampToValueAtTime).toHaveBeenCalled();
  });

  it("schedules every ping in a scan, placing each at its pan", () => {
    const { ctx, oscillators, panners } = makeFakeCtx();
    const audio = new SonarAudio(ctx);
    audio.play([
      ping({ num: 1, kind: "object", pan: -0.8, onset: 0 }),
      ping({ num: 2, kind: "object", pan: 0.1, onset: 0.3 }),
      ping({ num: 3, kind: "object", pan: 0.9, onset: 0.6 }),
    ]);
    expect(oscillators).toHaveLength(3);
    expect(panners.map((p) => p.pan.value)).toEqual([-0.8, 0.1, 0.9]);
  });

  it("schedules nothing while muted", () => {
    const { ctx, oscillators } = makeFakeCtx();
    const audio = new SonarAudio(ctx);
    audio.setMuted(true);
    audio.play([ping({}), ping({ num: 2 })]);
    audio.playOne(ping({ num: 3 }));
    expect(oscillators).toHaveLength(0);
  });

  it("stops and disconnects every scheduled node on stop (cancels a scan)", () => {
    const { ctx, oscillators } = makeFakeCtx();
    const audio = new SonarAudio(ctx);
    audio.play([
      ping({ num: 1, onset: 0 }),
      ping({ num: 2, onset: 0.3 }),
      ping({ num: 3, onset: 0.6 }),
    ]);
    expect(oscillators).toHaveLength(3);
    audio.stop();
    for (const osc of oscillators) {
      expect(osc.stop).toHaveBeenCalled();
      expect(osc.disconnect).toHaveBeenCalled();
    }
  });

  it("a new play stops the previous scan's nodes first", () => {
    const { ctx, oscillators } = makeFakeCtx();
    const audio = new SonarAudio(ctx);
    audio.play([ping({ num: 1 })]);
    const first = oscillators[0];
    audio.play([ping({ num: 2 })]);
    expect(first.stop).toHaveBeenCalled(); // the old node was cancelled.
  });
});
