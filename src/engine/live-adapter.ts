// Live adapter (Requirement 10) — typed stub.
//
// This documents the seam to the real wasm build and makes `main.ts` compile
// against the EngineAdapter interface, so the boundary is real. The actual
// wasm boot, the ScummVM Module wiring, and the FS/printErr plumbing are
// completed by the web player spec; this spec ships only the replay path as a
// working adapter. Every method here throws or no-ops with a clear message so
// an accidental live run in this spec fails loudly rather than silently.

import {
  type Command,
  type EngineAdapter,
  type EngineEvent,
  serializeCommand,
} from "./adapter.js";
import { parseA11yLine } from "./a11y-lines.js";

/**
 * The subset of the Emscripten Module the live adapter needs. The web player
 * spec provides the real object (the ScummVM wasm build sets `window.Module`).
 */
export interface ScummvmModule {
  /** Emscripten MEMFS; the page writes the command file through it. */
  FS: {
    writeFile(path: string, data: string): void;
    readFile?(path: string, opts: { encoding: "utf8" }): string;
  };
  /** Set by us before boot: ScummVM routes A11Y lines here (stderr). */
  printErr?: (line: string) => void;
}

/** Where the engine reads commands from (launch with --savepath=/tmp). */
const COMMAND_FILE = "/tmp/a11y-cmd.txt";

export class LiveAdapter implements EngineAdapter {
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private module: ScummvmModule | undefined;

  /**
   * @param module the booted ScummVM Emscripten Module. Omitted in this spec;
   *   the web player spec passes the real one.
   */
  constructor(module?: ScummvmModule) {
    this.module = module;
  }

  onEvent(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Read path: ScummVM emits A11Y lines on stderr, which Emscripten delivers to
   * `Module.printErr`. We install a printErr that runs each line through the one
   * shared `parseA11yLine` and forwards the typed events to listeners — the
   * exact same decode the replay adapter uses, so live and replay cannot drift.
   * The web player spec calls this once the Module exists.
   */
  installReader(module: ScummvmModule): void {
    this.module = module;
    const previous = module.printErr;
    module.printErr = (line: string) => {
      previous?.(line);
      const event = parseA11yLine(line);
      if (event) {
        for (const l of this.listeners) l(event);
      }
    };
  }

  async start(): Promise<void> {
    // The real boot (fetch the wasm and game data, instantiate the Module, wait
    // for the first A11Y room state) is the web player spec's job.
    throw new Error(
      "LiveAdapter.start() is a stub in the player spec; the wasm boot is " +
        "completed by the web player spec. Use ReplayAdapter (?replay=) here.",
    );
  }

  /**
   * Write path: a command is appended as one line to the engine's command file
   * via `FS.writeFile`; the engine's per-frame poll drains it (see
   * engine/a11y.cpp readCommandFile). The serialisation is the shared
   * `serializeCommand`, so the bytes the engine parses match what the replay
   * adapter matched against.
   */
  send(cmd: Command): void {
    if (!this.module) {
      throw new Error(
        "LiveAdapter.send() has no Module; the web player spec supplies it. " +
          "Use ReplayAdapter here.",
      );
    }
    this.module.FS.writeFile(COMMAND_FILE, serializeCommand(cmd) + "\n");
  }
}
