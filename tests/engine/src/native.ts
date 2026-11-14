// Native EngineHarness: drive the real engine in a real window.
//
// Per the spec, replay and property runs use the native build in a real window
// (gotcha 12: fully headless SDL is flaky). This harness spawns the native
// ScummVM binary built by scripts/build-engine.sh with --subtitles and a
// --savepath that holds the a11y command file, drives it by appending to that
// file, and reads the A11Y* lines back off stderr, waiting on the per-command
// settle marker (one A11Y_DIFF or one A11Y_ERR) rather than sleeping.
//
// Chapter-2 start without replaying chapter 1 (R9.2): a fixture that begins in
// chapter 2 is launched with --save-slot pointing at a save taken at the
// chapter-2 start (produced by scripts/make-ch2-save.sh). The engine loads that
// save and start() reads chapter 2's first room state directly — about two
// seconds, versus the minutes the live chapter 1->2 crossing takes. Chapter-1
// fixtures launch fresh and replay from the first playable room.
//
// The EngineHarness interface is unchanged, so the same replay/property tests
// run against this harness or the fixture harness; only the wiring differs.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { A11yLine, RoomState } from "./lines.js";
import type { EngineHarness } from "./harness.js";
import { parseStream } from "./parse.js";

export interface NativeHarnessOptions {
  /** Path to the native ScummVM binary built by scripts/build-engine.sh. */
  binary: string;
  /** Game data directory (--path), holding Packet.001 and the Ogg pack. */
  gamePath: string;
  /** Engine-data directory (--extrapath) holding drascula.dat. */
  extraPath: string;
  /**
   * Directory passed as --savepath; the a11y command file lives here. A fresh
   * temp dir is used when omitted so parallel runs never share a command file.
   */
  savePath?: string;
  /**
   * Optional --save-slot to start a run partway through (R9.2). Set for
   * chapter-2 fixtures so they LOAD the chapter-2 start instead of replaying
   * chapter 1.
   */
  saveSlot?: number;
  /** Human-readable label for test names. */
  label?: string;
  /** Per-command settle timeout in ms (hard-bounded). Default 60000. */
  settleMs?: number;
}

/**
 * Marker a command has settled: its diff or an error line appeared, or the
 * game ended (`A11Y_GAME_END`, the last chapter's ending: no diff follows).
 */
function settled(lines: A11yLine[]): boolean {
  return lines.some(
    (l) => l.kind === "diff" || l.kind === "err" || l.kind === "gameEnd",
  );
}

export class NativeHarness implements EngineHarness {
  readonly label: string;
  private readonly options: Required<Omit<NativeHarnessOptions, "saveSlot">> & {
    saveSlot?: number;
  };
  private proc: ChildProcess | null = null;
  private savePath: string;
  private cmdFile: string;
  private logFile: string;
  private ownsSavePath = false;
  /** Count of A11Y lines already consumed, so send() returns only new ones. */
  private consumed = 0;
  /** Accumulated raw stdout/stderr from the engine process. */
  private rawLog = "";

  constructor(options: NativeHarnessOptions) {
    const savePath =
      options.savePath ?? mkdtempSync(join(tmpdir(), "ghostlight-native-"));
    this.ownsSavePath = options.savePath === undefined;
    this.savePath = savePath;
    this.cmdFile = join(savePath, "a11y-cmd.txt");
    this.logFile = join(savePath, "native.log");
    this.label =
      options.label ??
      `native${options.saveSlot !== undefined ? `:slot${options.saveSlot}` : ""}`;
    this.options = {
      binary: options.binary,
      gamePath: options.gamePath,
      extraPath: options.extraPath,
      savePath,
      saveSlot: options.saveSlot,
      label: this.label,
      settleMs: options.settleMs ?? 60000,
    };
  }

  /** All a11y lines in the log so far, parsed. */
  private readLines(): A11yLine[] {
    if (!existsSync(this.logFile)) return [];
    return parseStream(readFileSync(this.logFile, "utf8"));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Poll the log until `pred` holds or the deadline passes. */
  private async waitUntil(
    pred: (lines: A11yLine[]) => boolean,
    what: string,
  ): Promise<A11yLine[]> {
    const deadline = Date.now() + this.options.settleMs;
    for (;;) {
      const lines = this.readLines();
      if (pred(lines)) return lines;
      if (this.proc && this.proc.exitCode !== null) {
        throw new Error(`native engine exited before ${what}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out (${this.options.settleMs}ms) waiting for ${what}`);
      }
      await this.sleep(100);
    }
  }

  async start(): Promise<RoomState> {
    // Start with an empty command file so nothing is queued before we drive.
    writeFileSync(this.cmdFile, "");
    writeFileSync(this.logFile, "");

    const args = [
      `--path=${this.options.gamePath}`,
      `--extrapath=${this.options.extraPath}`,
      `--savepath=${this.savePath}`,
      "--subtitles",
    ];
    if (this.options.saveSlot !== undefined) {
      // Load the chapter-2 start instead of replaying chapter 1 (R9.2).
      // A missing save would leave the engine without a room until the settle
      // cap, so fail at once and name the script that makes it.
      const save = join(this.savePath, `drascula.${String(this.options.saveSlot).padStart(3, "0")}`);
      if (!existsSync(save)) {
        throw new Error(
          `save slot ${this.options.saveSlot} not found (${save}); make it first with scripts/make-ch2-save.sh (slot 9) or scripts/make-gated-door-save.sh (slot 8)`,
        );
      }
      args.push(`--save-slot=${this.options.saveSlot}`);
    }
    args.push("drascula");

    this.rawLog = "";
    const out = (chunk: Buffer) => {
      // Mirror engine stdout/stderr into the log file we poll.
      this.rawLog += chunk.toString();
      writeFileSync(this.logFile, this.rawLog, "utf8");
    };
    this.proc = spawn(this.options.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc.stdout?.on("data", out);
    this.proc.stderr?.on("data", out);

    // The first A11Y room-state line is the starting room (R1.4). For a
    // --save-slot launch that is the chapter-2 room the save was taken in.
    const lines = await this.waitUntil(
      (ls) => ls.some((l) => l.kind === "room"),
      "the first room state",
    );
    const room = lines.find((l): l is RoomState => l.kind === "room")!;
    this.consumed = lines.length;
    return room;
  }

  async send(cmd: string): Promise<A11yLine[]> {
    // Append the command to the file the engine reads each frame.
    this.rawLogAppendCmd(cmd);

    // Wait until a new diff/err appears beyond what we had consumed.
    const all = await this.waitUntil((ls) => {
      const fresh = ls.slice(this.consumed);
      return settled(fresh);
    }, `the settle of "${cmd}"`);

    const fresh = all.slice(this.consumed);
    this.consumed = all.length;
    return fresh;
  }

  /**
   * Queue a command without waiting for it to settle. For commands that settle
   * with no diff of their own, such as a surplus `skip` drained inside an open
   * choice menu (it is only echoed); the next send() returns its lines too.
   */
  queue(cmd: string): void {
    this.rawLogAppendCmd(cmd);
  }

  private rawLogAppendCmd(cmd: string): void {
    const current = existsSync(this.cmdFile)
      ? readFileSync(this.cmdFile, "utf8")
      : "";
    writeFileSync(this.cmdFile, `${current}${cmd}\n`);
  }

  async stop(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) {
      // ScummVM ignores SIGTERM (gotcha 12): SIGKILL the window.
      this.proc.kill("SIGKILL");
    }
    this.proc = null;
    if (this.ownsSavePath) {
      try {
        rmSync(this.savePath, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  /** Expose the resolved options (save slot, save path) for the wiring step. */
  describe(): NativeHarnessOptions {
    return { ...this.options };
  }
}
