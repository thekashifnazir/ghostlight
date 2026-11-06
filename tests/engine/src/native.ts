// Native EngineHarness: the seam for wiring the real engine later.
//
// This is intentionally not implemented yet. Per the spec, replay and property
// tests run against the native build in a real window (gotcha 12: fully
// headless SDL is flaky), which needs scripts/build-engine.sh to have produced a
// binary, the Ogg audio pack, --extrapath for drascula.dat, --subtitles and a
// --savepath that holds the command file. None of that is this chat's to touch
// (engine/ and scripts/ are off-limits here), so the method is stubbed.
//
// When wired, drive() will:
//   1. spawn the native binary with --subtitles --savepath=<tmp> (and optional
//      --save-slot to start partway through, Requirement 9.2);
//   2. for start(), skip the intro and read the first A11Y room-state line;
//   3. for send(cmd), append the line to <savepath>/a11y-cmd.txt, then read
//      stderr until the command settles (its single A11Y_DIFF or A11Y_ERR
//      arrives), collecting every a11y line in between via parse.ts;
//   4. for stop(), kill the process and clean the temp savepath.
//
// The tests already target the EngineHarness interface, so none of them change
// when this lands; only this file gains a body. The fixtures become the golden
// transcript the native output is diffed against.

import type { A11yLine, RoomState } from "./lines.js";
import type { EngineHarness } from "./harness.js";

export interface NativeHarnessOptions {
  /** Path to the native ScummVM binary built by scripts/build-engine.sh. */
  binary: string;
  /** Directory passed as --savepath; the command file lives here. */
  savePath: string;
  /** Optional --save-slot to start a run partway through (Requirement 9.2). */
  saveSlot?: number;
}

export class NativeHarnessNotWired extends Error {
  constructor() {
    super(
      "NativeHarness is not wired yet. Build the native engine via " +
        "scripts/build-engine.sh (real window, Ogg pack, --extrapath, " +
        "--subtitles) and implement spawn/read here. The EngineHarness tests " +
        "run unchanged once this is implemented.",
    );
    this.name = "NativeHarnessNotWired";
  }
}

export class NativeHarness implements EngineHarness {
  readonly label = "native";
  // Kept so the shape is ready; unused until wired.
  private readonly options: NativeHarnessOptions;

  constructor(options: NativeHarnessOptions) {
    this.options = options;
  }

  async start(): Promise<RoomState> {
    throw new NativeHarnessNotWired();
  }

  async send(_cmd: string): Promise<A11yLine[]> {
    throw new NativeHarnessNotWired();
  }

  async stop(): Promise<void> {
    /* no process to release until wired */
  }

  /** Expose options for the wiring step and to satisfy noUnusedLocals intent. */
  describe(): NativeHarnessOptions {
    return this.options;
  }
}
