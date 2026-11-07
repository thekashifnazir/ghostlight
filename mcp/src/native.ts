// Native transport (Requirement 6) — drives the real native ScummVM build.
//
// Spawns the native Drascula a11y binary built by scripts/build-engine.sh in a
// real window (fully headless SDL is flaky, engine gotcha 12), feeds commands
// through the a11y command file, reads A11Y lines off the engine's output, and
// settles each command by WAITING ON LOG MARKERS — never a fixed sleep — under
// a hard 60 s cap. This mirrors scripts/drive.sh's marker-wait approach, but
// interactively: drive.sh writes a whole script up front and waits for the last
// command; here each send() writes one command and waits for that command's
// A11Y_CMD echo then its single A11Y_DIFF (or an A11Y_ERR).
//
// Safety: it tracks its OWN child PID and `kill -9`s only that pid (ScummVM
// ignores SIGTERM, gotcha 12). It never `pgrep`s for the process — that would
// hit the engine chat's ScummVM sharing this machine. It uses its own save
// path (/tmp/ghostlight-mcp) so it never shares a11y-cmd.txt or saves with
// another chat, and on teardown it removes ONLY the command file, never the
// saves (the --save-slot start path needs them).
//
// The contract is imported, never copied: lines are parsed with the shared
// parseA11yLine, and commands are serialised by session.send via the shared
// serializeCommand, so the bytes the engine parses match the player's.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

import { parseA11yLine } from "../../src/engine/a11y-lines.js";
import { serializeCommand } from "../../src/engine/adapter.js";
import type { NativeConfig } from "./config.js";
import type {
  Command,
  CommandResult,
  EngineEvent,
  RoomState,
  Transport,
} from "./transport.js";

/** Hard cap on any single wait (start or a command). No run can hang (Req 6.6). */
const HARD_CAP_MS = 60_000;

/** The command file name the engine reads under the save path. */
const COMMAND_FILE = "a11y-cmd.txt";

/**
 * A per-command log sink. Each line is flushed as soon as it is written, so if
 * a command hangs the last line on stderr names the call that blocked, rather
 * than nothing printing until the (up to 60 s) cap fires. Injectable so a test
 * can capture the lines without reading stderr.
 */
export type NativeLogger = (line: string) => void;

/**
 * Default logger: write to stderr (stdout is reserved for MCP protocol traffic,
 * Req 1.5) with a synchronous flush. `fs.writeSync(2, ...)` writes straight to
 * the fd and does not buffer, so the line is on disk/the terminal before the
 * next, possibly blocking, step runs.
 */
function defaultLogger(line: string): void {
  try {
    writeSync(2, `[drascula-mcp native] ${line}\n`);
  } catch {
    /* logging must never throw into the transport */
  }
}

/** A waiter the line pump feeds until its command settles or the cap fires. */
interface PendingSend {
  /** The serialised command we are waiting to see settle. */
  expected: string;
  /** Whether we have seen this command's A11Y_CMD echo yet. */
  echoed: boolean;
  /** Events collected from the echo up to (and including) the diff/error. */
  events: EngineEvent[];
  resolve: (r: CommandResult) => void;
  timer: NodeJS.Timeout;
}

export class NativeTransport implements Transport {
  private readonly config: NativeConfig;
  private readonly commandFile: string;
  /** Per-command log sink, flushed on every line (so a hang shows its call). */
  private readonly log: NativeLogger;
  private child: ChildProcess | undefined;
  private pid: number | undefined;

  /** Carry of a partial final line across stream chunks. */
  private buffer = "";

  /** One-shot resolver for the first room state during start(). */
  private awaitingRoom: ((room: RoomState) => void) | undefined;
  private awaitingRoomError: ((e: Error) => void) | undefined;

  /** The current in-flight command, if any (one at a time). */
  private pending: PendingSend | undefined;

  /** Installed once, removed on stop: kill our child if the process exits. */
  private readonly exitHandler = () => this.killChild();

  constructor(config: NativeConfig, logger: NativeLogger = defaultLogger) {
    this.config = config;
    this.commandFile = join(config.savePath, COMMAND_FILE);
    this.log = logger;
  }

  // --- start ----------------------------------------------------------------

  async start(): Promise<RoomState> {
    // Own save path; create it and clear any stale command file so the engine
    // does not pick up a leftover command on the first frame.
    mkdirSync(this.config.savePath, { recursive: true });
    writeFileSync(this.commandFile, "");

    const args = [
      `--path=${this.config.gamePath}`,
      `--extrapath=${this.config.extraPath}`,
      `--savepath=${this.config.savePath}`,
      "--subtitles", // mandatory or no text is drawn (gotcha 1 / R6.7)
    ];
    if (this.config.slot !== undefined) {
      // Load a saved game so the session begins partway through (R6.2).
      args.push(`--save-slot=${this.config.slot}`);
    }
    args.push("drascula");

    this.log(
      `start` +
        (this.config.slot !== undefined ? ` (save-slot ${this.config.slot})` : ""),
    );

    const child = spawn(this.config.binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.pid = child.pid;
    process.once("exit", this.exitHandler);

    // A11Y lines arrive on stdout or stderr (the engine logs via printErr; some
    // backends split them), so pump both through the same line reader.
    child.stdout?.on("data", (d: Buffer) => this.onChunk(d));
    child.stderr?.on("data", (d: Buffer) => this.onChunk(d));

    return new Promise<RoomState>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.awaitingRoom = undefined;
        this.awaitingRoomError = undefined;
        this.killChild();
        reject(
          new Error(
            `native transport: the engine did not reach a room state within ` +
              `${HARD_CAP_MS / 1000}s. Check the build and game data ` +
              `(scripts/build-engine.sh, scripts/fetch.sh).`,
          ),
        );
      }, HARD_CAP_MS);

      this.awaitingRoom = (room) => {
        clearTimeout(timer);
        this.awaitingRoom = undefined;
        this.awaitingRoomError = undefined;
        resolve(room);
      };
      this.awaitingRoomError = (e) => {
        clearTimeout(timer);
        this.awaitingRoom = undefined;
        this.awaitingRoomError = undefined;
        this.killChild();
        reject(e);
      };

      child.once("error", (e) =>
        this.awaitingRoomError?.(
          new Error(`native transport: failed to launch the engine: ${e.message}`),
        ),
      );
      child.once("exit", (code) => {
        if (this.awaitingRoom || this.awaitingRoomError) {
          this.awaitingRoomError?.(
            new Error(
              `native transport: the engine exited (code ${code ?? "?"}) before ` +
                `reaching a room state.`,
            ),
          );
        }
      });
    });
  }

  // --- send -----------------------------------------------------------------

  async send(cmd: Command): Promise<CommandResult> {
    if (!this.child || !this.pid) {
      throw new Error("native transport: not started; call start() first.");
    }
    if (this.pending) {
      throw new Error("native transport: a command is already in flight.");
    }

    const expected = serializeCommand(cmd);
    // Flush a "sending" line BEFORE the write and the wait, so if the engine
    // never answers, the last line on stderr names the command that blocked.
    this.log(`send "${expected}"`);
    // Write one command. The engine reads the file each frame, queues the line,
    // and truncates the file (engine/a11y.cpp readCommandFile), so one write
    // per send is correct and leaves nothing behind for the next frame.
    writeFileSync(this.commandFile, expected + "\n");

    return new Promise<CommandResult>((resolve) => {
      const timer = setTimeout(() => {
        // Hard cap: return a timeout error and leave the session usable (R6.6).
        const p = this.pending;
        this.pending = undefined;
        if (p) {
          this.log(`timeout "${expected}" after ${HARD_CAP_MS / 1000}s`);
          resolve({
            events: p.events,
            error:
              `native transport: command "${expected}" did not settle within ` +
              `${HARD_CAP_MS / 1000}s (no A11Y_DIFF/A11Y_ERR). The session is ` +
              `still up; call stop to tear it down.`,
          });
        }
      }, HARD_CAP_MS);

      this.pending = { expected, echoed: false, events: [], resolve, timer };
    });
  }

  // --- stop -----------------------------------------------------------------

  async stop(): Promise<void> {
    this.killChild();
    // Remove ONLY the command file; never the save files — the --save-slot
    // start path needs them to begin partway through (R6.2).
    try {
      rmSync(this.commandFile, { force: true });
    } catch {
      /* best effort */
    }
  }

  /**
   * SIGKILL our own tracked child (ScummVM ignores SIGTERM, gotcha 12). We kill
   * by the stored pid only — never pgrep — so we can never hit another chat's
   * ScummVM sharing this machine.
   */
  private killChild(): void {
    const child = this.child;
    const pid = this.pid;
    this.child = undefined;
    this.pid = undefined;
    process.removeListener("exit", this.exitHandler);
    if (pid === undefined) return;
    try {
      child?.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }

  // --- line pump ------------------------------------------------------------

  /** Split a stream chunk into lines, carrying a partial line across chunks. */
  private onChunk(data: Buffer): void {
    this.buffer += data.toString("utf8");
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      this.onLine(line);
    }
  }

  /** Parse one line and route the resulting event to start() or the pending send. */
  private onLine(line: string): void {
    const event = parseA11yLine(line);
    if (!event) return;

    // During start(), the first room state resolves the boot promise. A pre-room
    // subtitles error (A11Y_ERR mentioning subtitles) fails the boot (R6.7).
    if (this.awaitingRoom || this.awaitingRoomError) {
      if (event.type === "room") {
        this.awaitingRoom?.(event.state);
        return;
      }
      if (event.type === "error" && /subtitle/i.test(event.message)) {
        this.awaitingRoomError?.(
          new Error(`native transport: ${event.message} (subtitles must be on, gotcha 1).`),
        );
        return;
      }
      // Other pre-room lines are ignored until the room state arrives.
      return;
    }

    this.routeToPending(event);
  }

  /**
   * Feed one parsed event to the in-flight command. Settling by markers: begin
   * collecting at this command's A11Y_CMD echo, then resolve on the first
   * terminal marker — A11Y_DIFF (success), A11Y_ERR (failure), or A11Y_CHOICES.
   *
   * Why A11Y_CHOICES is terminal: a `talk` that opens a conversation does NOT
   * emit its A11Y_DIFF when the choices appear. The engine runs the conversation
   * in its own loop and only builds the `talk` diff once that loop RETURNS —
   * i.e. after the player drives the conversation to its end (a `choose 4`), at
   * which point the deferred `talk` diff lands out of order, after the choose's
   * own diff (confirmed live: talk 53 -> A11Y_CHOICES, then choose 4 -> its diff,
   * then the late talk-53 diff). An interactive transport must therefore treat
   * the choices line as "this command has settled, the conversation is now open
   * and awaiting a choose" — otherwise send(talk) would wait forever for a diff
   * that only comes after later commands. The late talk diff, arriving between
   * commands with no pending waiter, is harmlessly ignored.
   *
   * Interleaved text/choices/inv/room/further cmd (e.g. a queued skip) are
   * accumulated so nothing is lost (R3.2). No fixed sleep gates this — only the
   * engine's own markers (R6.5).
   */
  private routeToPending(event: EngineEvent): void {
    const p = this.pending;
    if (!p) return; // a stray line between commands (e.g. a late talk diff); ignore.

    if (!p.echoed) {
      // Wait for THIS command's echo before collecting, so lines from a prior
      // command cannot bleed into this result.
      if (event.type === "cmd" && event.cmd === p.expected) {
        p.echoed = true;
        p.events.push(event);
      }
      return;
    }

    p.events.push(event);

    if (event.type === "diff") {
      this.settle({ events: p.events, diff: event.diff });
    } else if (event.type === "error") {
      this.settle({ events: p.events, error: event.message });
    } else if (event.type === "choices") {
      // Conversation opened/refreshed: this command has settled (its own diff,
      // if any, is deferred until the conversation ends).
      this.settle({ events: p.events });
    }
  }

  /** Resolve the in-flight command with its result and clear the slot. */
  private settle(result: CommandResult): void {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = undefined;
    const outcome = result.error
      ? `error (${result.error})`
      : result.diff
        ? "diff"
        : "choices";
    this.log(`settled "${p.expected}": ${outcome}`);
    p.resolve(result);
  }
}
