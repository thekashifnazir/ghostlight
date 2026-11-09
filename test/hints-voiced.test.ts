// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { GhostAudio } from "../src/hints/audio.js";

// A VoiceOver user pressing H must not hear a hint TWICE: once as a live-region
// announcement and once as the ghost's recorded voice. The hint is treated like
// a voiced character line (speech fix 1, toggled with D): by default the ghost
// speaks it aloud and the screen reader does NOT read it, but it is still
// recorded (R repeats it), logged and mirrored to the transcript / ?speechlog.
//
// These tests pin the askHint wiring main.ts uses. The harness mirrors the
// askHint closure in src/main.ts exactly (same ordering and the same fallbacks)
// against a real GhostAudio and fake live/status/speechlog, the same way
// ghost-voice-toggle.test.ts mirrors toggleGhostVoice.

const NO_HINT_TEXT = "There is nothing to hint at right now.";

type HintResult =
  | { kind: "none" }
  | { kind: "hint"; text: string; audioKey: string };

/** A LiveRegion stand-in recording announce() and record() separately. */
class FakeLive {
  announced: string[] = [];
  recorded: string[] = [];
  announce(text: string): void {
    this.announced.push(text);
  }
  record(text: string): void {
    this.recorded.push(text);
  }
}

/** A minimal AudioContext stand-in exercising the full play path. */
function fakeCtx(): AudioContext {
  const source = {
    buffer: null as unknown,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as unknown,
  };
  return {
    decodeAudioData: vi.fn(async () => ({}) as AudioBuffer),
    createBufferSource: vi.fn(() => source),
    createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() })),
    destination: {},
  } as unknown as AudioContext;
}

/**
 * Build askHint exactly as main.ts wires it: a real GhostAudio, the readVoiced
 * flag, and the record/log/speechlog + play-with-fallback logic.
 */
function harness(opts: {
  result: HintResult;
  urls?: Record<string, string>;
  readVoicedLines?: boolean;
  voiceOn?: boolean;
}) {
  const live = new FakeLive();
  const status = { recordLine: vi.fn() };
  const speechlog = { voiced: vi.fn(), say: vi.fn() };
  const ghostAudio = new GhostAudio(fakeCtx(), opts.urls ?? {});
  if (opts.voiceOn === false) ghostAudio.setEnabled(false);
  // Resolve by default so tests do not hit a real fetch (node has none); the
  // rejection test overrides with mockRejectedValueOnce. willPlay is NOT mocked,
  // so the record-vs-announce decision still runs against the real urls map.
  const playSpy = vi.spyOn(ghostAudio, "play").mockResolvedValue(undefined);
  const readVoicedLines = opts.readVoicedLines ?? false;

  const hintEngine = { ask: vi.fn(async (_room: number) => opts.result) };

  // Mirror of src/main.ts askHint.
  const askHint = (): Promise<void> =>
    hintEngine.ask(62).then((r) => {
      if (r.kind === "none") {
        live.announce(NO_HINT_TEXT);
        return;
      }
      const voiced = ghostAudio.willPlay(r.audioKey) === true;
      if (voiced && !readVoicedLines) {
        live.record(r.text);
        status.recordLine(r.text);
        speechlog.voiced(r.text);
        ghostAudio.play(r.audioKey).catch(() => {
          live.announce(r.text);
        });
        return;
      }
      live.announce(r.text);
      ghostAudio.play(r.audioKey).catch(() => {});
    });

  return { askHint, live, status, speechlog, ghostAudio, playSpy };
}

const HINT: HintResult = { kind: "hint", text: "Open the machine.", audioKey: "k1" };
const URLS = { "./ghost/k1.mp3": "/assets/k1.mp3" };

describe("askHint: hint voiced by the ghost, not double-read", () => {
  it("default setting: records the hint, does NOT announce it, and plays audio", async () => {
    const h = harness({ result: HINT, urls: URLS });
    await h.askHint();
    // Not announced to the live region (the ghost speaks it aloud)…
    expect(h.live.announced).not.toContain("Open the machine.");
    // …but recorded so R repeats it, logged, and mirrored as a voiced line.
    expect(h.live.recorded).toEqual(["Open the machine."]);
    expect(h.status.recordLine).toHaveBeenCalledWith("Open the machine.");
    expect(h.speechlog.voiced).toHaveBeenCalledWith("Open the machine.");
    // The whisper plays.
    expect(h.playSpy).toHaveBeenCalledWith("k1");
  });

  it("voice off (G): announces the text as before (no file will play)", async () => {
    const h = harness({ result: HINT, urls: URLS, voiceOn: false });
    await h.askHint();
    expect(h.live.announced).toEqual(["Open the machine."]);
    expect(h.live.recorded).toEqual([]);
    expect(h.speechlog.voiced).not.toHaveBeenCalled();
  });

  it("no cached file: announces the text (willPlay is false)", async () => {
    const h = harness({ result: HINT, urls: {} }); // nothing cached
    await h.askHint();
    expect(h.live.announced).toEqual(["Open the machine."]);
    expect(h.live.recorded).toEqual([]);
  });

  it("play rejection: falls back to announcing the text so it is never silent", async () => {
    const h = harness({ result: HINT, urls: URLS });
    h.playSpy.mockRejectedValueOnce(new Error("decode failed"));
    await h.askHint();
    // flush the rejection handler microtask.
    await Promise.resolve();
    await Promise.resolve();
    expect(h.live.recorded).toEqual(["Open the machine."]);
    expect(h.live.announced).toContain("Open the machine.");
  });

  it("D on (read voiced lines): announces AND plays the audio", async () => {
    const h = harness({ result: HINT, urls: URLS, readVoicedLines: true });
    await h.askHint();
    expect(h.live.announced).toEqual(["Open the machine."]);
    expect(h.live.recorded).toEqual([]);
    expect(h.playSpy).toHaveBeenCalledWith("k1");
  });

  it("nothing to hint at: always announced, never recorded", async () => {
    const h = harness({ result: { kind: "none" }, urls: URLS });
    await h.askHint();
    expect(h.live.announced).toEqual([NO_HINT_TEXT]);
    expect(h.live.recorded).toEqual([]);
    expect(h.playSpy).not.toHaveBeenCalled();
  });
});

describe("askHint: R repeats a recorded hint", () => {
  it("records the hint through the real LiveRegion so repeat() replays it", async () => {
    // Use the real LiveRegion to prove record() feeds R (repeat last).
    const { LiveRegion } = await import("../src/ui/live-region.js");
    const doc = globalThis.document;
    const regionEl = doc.createElement("div");
    const region = new LiveRegion(regionEl);
    const ghostAudio = new GhostAudio(fakeCtx(), URLS);
    vi.spyOn(ghostAudio, "play").mockResolvedValue(undefined);

    // Mirror the default-setting voiced path: record, do not announce.
    const r = HINT;
    if (ghostAudio.willPlay(r.audioKey)) {
      region.record(r.text);
      void ghostAudio.play(r.audioKey);
    }

    // The recorded hint is the last line, and R (repeat) re-reads it verbatim
    // into the live region even though it was never announced.
    expect(region.lastLine()).toBe("Open the machine.");
    region.repeat();
    expect(regionEl.textContent).toBe("Open the machine.");
  });
});
