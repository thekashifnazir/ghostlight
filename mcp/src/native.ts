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

/**
 * Hard cap on the START wait only. Booting the engine (load game data, reach
 * the first room) legitimately takes a couple of seconds and, on a cold cache,
 * longer; a generous cap here guards only against a broken build that never
 * reaches a room.
 */
const START_CAP_MS = 60_000;

/**
 * Settle cap for a single command. A command that truly does not settle returns
 * a clear error after this, carrying the last A11Y line seen, rather than
 * leaving the caller in 60 s of silence (transport-settle bugfix). This is well
 * above the slowest real settle observed (a conversation `choose` whose reply
 * animation runs ~4 s), so a healthy command always settles first; it only
 * fires when the engine genuinely never emits the command's terminal marker.
 */
const COMMAND_CAP_MS = 10_000;

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
  /** Reset the quiet-period timer; called on every A11Y line while in flight. */
  bump: () => void;
  /** Cancel the quiet-period timer; called when the command settles. */
  clear: () => void;
  /**
   * When set, this is a `state`/`dump` snapshot wait: settle on the FRESH
   * room-state (`A11Y { ... }`) line the command emits rather than on its diff,
   * and resolve the snapshot promise with that RoomState instead of a
   * CommandResult. The trailing `A11Y_DIFF {"cmd":"state","changed":false}` is
   * then just a stray line between commands, harmlessly ignored.
   */
  resolveRoom?: (room: RoomState) => void;
  resolve: (r: CommandResult) => void;
}

/** The engine's own full-snapshot command (A11Y line: emits the room state). */
const STATE_COMMAND = "state";

const GAME_ENDED_MESSAGE =
  "the game has ended (the credits ran and the engine exits on its own). " +
  "Call stop, then start for a new session.";

export class NativeTransport implements Transport {
  private readonly config: NativeConfig;
  private readonly commandFile: string;
  /** Per-command log sink, flushed on every line (so a hang shows its call). */
  private readonly log: NativeLogger;
  private child: ChildProcess | undefined;
  private pid: number | undefined;

  /**
   * Carry of a partial final line across stream chunks, kept SEPARATELY per
   * stream. The engine prints A11Y lines on stderr, but the child also writes
   * unrelated chatter on stdout (startup banner) and stderr (ScummVM
   * "WARNING:" lines). stdout and stderr are independent event sources, so a
   * single shared carry would splice a partial line on one stream into the next
   * line on the other — corrupting an A11Y line so parseA11yLine drops it and
   * the command never settles (the 60 s timeout this bugfix removes). One carry
   * per stream means a partial line on stdout can never corrupt a line on
   * stderr, and vice versa.
   */
  private stdoutBuffer = "";
  private stderrBuffer = "";

  /**
   * The raw text of the last A11Y line parsed from either stream. Reported in a
   * command's timeout error so the caller sees how far the engine got, instead
   * of only "no diff within N s".
   */
  private lastA11yLine = "";

  /** True once `A11Y_GAME_END` was seen: the engine's later exit is expected. */
  private gameEnded = false;

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

    // A11Y lines arrive on stderr (the engine logs via logMessage(kError));
    // some backends or wrappers put a line on stdout, and both streams also
    // carry unrelated chatter. Pump each stream with its OWN line carry so a
    // partial line on one can never corrupt a line on the other (the stream-
    // split hang this bugfix fixes).
    child.stdout?.on("data", (d: Buffer) => this.onChunk("stdout", d));
    child.stderr?.on("data", (d: Buffer) => this.onChunk("stderr", d));

    return new Promise<RoomState>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.awaitingRoom = undefined;
        this.awaitingRoomError = undefined;
        this.killChild();
        reject(
          new Error(
            `native transport: the engine did not reach a room state within ` +
              `${START_CAP_MS / 1000}s. Check the build and game data ` +
              `(scripts/build-engine.sh, scripts/fetch.sh).`,
          ),
        );
      }, START_CAP_MS);

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
        this.onChildExit(code);
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
    if (this.gameEnded) return { events: [], error: GAME_ENDED_MESSAGE };
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
      // A QUIET-PERIOD cap, not an absolute one: it fires only after
      // COMMAND_CAP_MS with NO A11Y output at all for this command. Any A11Y
      // line (an echo, a drawn text line, a choices refresh) resets it via
      // bump(), so a long-but-progressing command (a cutscene the caller is
      // paced-skipping, a multi-second conversation reply) is never cut off,
      // while a genuine stall returns a clear error in ~10 s instead of 60 s of
      // silence (transport-settle bugfix).
      const onTimeout = () => {
        const p = this.pending;
        this.pending = undefined;
        if (!p) return;
        this.log(
          `timeout "${expected}" after ${COMMAND_CAP_MS / 1000}s quiet; ` +
            `last A11Y line: ${this.lastA11yLine || "(none)"}`,
        );
        resolve({
          events: p.events,
          error:
            `native transport: command "${expected}" did not settle within ` +
            `${COMMAND_CAP_MS / 1000}s of engine silence (no A11Y_DIFF/A11Y_ERR` +
            `/A11Y_CHOICES). Last A11Y line seen: ` +
            `${this.lastA11yLine || "(none)"}. The session is still up; call ` +
            `stop to tear it down.`,
        });
      };

      let timer = setTimeout(onTimeout, COMMAND_CAP_MS);
      const bump = () => {
        clearTimeout(timer);
        timer = setTimeout(onTimeout, COMMAND_CAP_MS);
      };
      const clear = () => clearTimeout(timer);

      this.pending = {
        expected,
        echoed: false,
        events: [],
        bump,
        clear,
        resolve,
      };
    });
  }

  // --- snapshot -------------------------------------------------------------

  async snapshot(): Promise<RoomState> {
    if (this.gameEnded) throw new Error(GAME_ENDED_MESSAGE);
    if (!this.child || !this.pid) {
      throw new Error("native transport: not started; call start() first.");
    }
    if (this.pending) {
      throw new Error("native transport: a command is already in flight.");
    }

    // The engine's `state` command re-emits the full A11Y room-state line (and
    // a trailing changed:false diff). Drive it directly — the player has no
    // `state` verb, so this does not go through serializeCommand — and settle on
    // the fresh room line, so the caller gets the engine's live state (flags,
    // hero, inventory and all) rather than a folded approximation.
    this.log(`snapshot "${STATE_COMMAND}"`);
    writeFileSync(this.commandFile, STATE_COMMAND + "\n");

    return new Promise<RoomState>((resolve, reject) => {
      // Same quiet-period cap as send(): the snapshot settles on the fresh
      // room-state line the `state` command emits, which arrives at once on a
      // healthy engine; the inactivity cap only fires on a genuine stall.
      const onTimeout = () => {
        const p = this.pending;
        this.pending = undefined;
        if (!p) return;
        this.log(
          `timeout "${STATE_COMMAND}" after ${COMMAND_CAP_MS / 1000}s quiet; ` +
            `last A11Y line: ${this.lastA11yLine || "(none)"}`,
        );
        reject(
          new Error(
            `native transport: snapshot "${STATE_COMMAND}" did not settle ` +
              `within ${COMMAND_CAP_MS / 1000}s of engine silence (no A11Y ` +
              `room-state line). Last A11Y line seen: ` +
              `${this.lastA11yLine || "(none)"}. The session is still up; call ` +
              `stop to tear it down.`,
          ),
        );
      };

      let timer = setTimeout(onTimeout, COMMAND_CAP_MS);
      const bump = () => {
        clearTimeout(timer);
        timer = setTimeout(onTimeout, COMMAND_CAP_MS);
      };
      const clear = () => clearTimeout(timer);

      this.pending = {
        expected: STATE_COMMAND,
        echoed: false,
        events: [],
        bump,
        clear,
        resolveRoom: resolve,
        // Unused for a snapshot wait (resolveRoom settles it), but the shape
        // requires a resolver; a no-op keeps the slot total.
        resolve: () => {},
      };
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

  /**
   * Split a stream chunk into lines, carrying a partial final line across
   * chunks WITHIN that stream only. Each stream keeps its own carry so a
   * partial line on stdout cannot splice into an A11Y line on stderr (the
   * stream-split corruption that caused the settle hang).
   */
  private onChunk(stream: "stdout" | "stderr", data: Buffer): void {
    let buffer =
      (stream === "stdout" ? this.stdoutBuffer : this.stderrBuffer) +
      data.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      this.onLine(line);
    }
    if (stream === "stdout") this.stdoutBuffer = buffer;
    else this.stderrBuffer = buffer;
  }

  /** Parse one line and route the resulting event to start() or the pending send. */
  private onLine(line: string): void {
    const event = parseA11yLine(line);
    if (!event) return;

    // Record the last recognised A11Y line (trimmed of the WARNING wrapper is
    // not needed — the raw line is what a reader would want to see) and, while
    // a command is in flight, reset its quiet-period timer: any A11Y output
    // means the engine is still working on the command, so the inactivity cap
    // only fires after a genuine stall (transport-settle bugfix).
    this.lastA11yLine = line.trim();
    this.pending?.bump();

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

    // The last chapter ended: this is the command's settle. The credits run and
    // the engine exits by itself afterwards (expected, see onChildExit).
    if (event.type === "gameEnd") {
      this.gameEnded = true;
      this.settle({ events: p.events, ended: { said: event.said } });
      return;
    }

    // A snapshot wait (`state`/`dump`) settles on the fresh room-state line the
    // command emits, resolving the snapshot promise with that RoomState; the
    // trailing changed:false diff is left to be ignored between commands.
    if (p.resolveRoom) {
      if (event.type === "room") {
        this.settleRoom(event.state);
      } else if (event.type === "error") {
        // A snapshot that erred has no room line to return: surface it as a
        // normal settle so the caller's await rejects via the error path.
        this.settle({ events: p.events, error: event.message });
      }
      return;
    }

    if (event.type === "diff") {
      this.settle({ events: p.events, diff: event.diff });
    } else if (event.type === "error") {
      this.settle({ events: p.events, error: event.message });
    } else if (event.type === "choices" && this.choicesSettles(p.expected)) {
      // A `talk`/`choices` settles when the option list appears: a `talk` that
      // opens a conversation defers its own diff until the conversation ends
      // (out of order, after a later choose), so waiting for that diff would
      // deadlock; `choices` just re-lists and emits no diff. For those, the
      // choices line IS the settle.
      this.settle({ events: p.events });
    }
    // For a `choose`, the re-presented A11Y_CHOICES is NOT the settle: the
    // engine emits it just BEFORE the choose's own deferred A11Y_DIFF on the
    // frame the reply finishes (recorded order in tavern.json: A11Y_CHOICES
    // then A11Y_DIFF for a non-ending choose). Settling on the choices would
    // drop that diff — and with it the flag changes a choose commits — forcing
    // the caller to run `state` to see a flag like 40 (transport-settle
    // bugfix). So a choose collects the choices into `events` and waits for its
    // diff (or error). An ending choose (option 4) emits no re-presented
    // choices and settles on its diff from onConverseEnd().
  }

  /**
   * Whether an A11Y_CHOICES line settles the given command. True for `talk`
   * (opens a conversation; its diff is deferred and arrives out of order) and
   * for `choices` (re-lists, emits no diff). False for `choose`, which must
   * wait for its own A11Y_DIFF so the caller sees the flags the choice
   * committed without a follow-up `state` (transport-settle bugfix).
   */
  private choicesSettles(expected: string): boolean {
    return !expected.startsWith("choose");
  }

  /** Resolve the in-flight command with its result and clear the slot. */
  private settle(result: CommandResult): void {
    const p = this.pending;
    if (!p) return;
    p.clear();
    this.pending = undefined;
    const outcome = result.error
      ? `error (${result.error})`
      : result.ended
        ? "game end"
        : result.diff
        ? "diff"
        : "choices";
    this.log(`settled "${p.expected}": ${outcome}`);
    p.resolve(result);
  }

  /**
   * The child exited. After `A11Y_GAME_END` that is the expected end of the
   * credits: just log it and forget the child. Otherwise an exit with a command
   * in flight would leave it waiting out the quiet cap, so fail it at once.
   */
  private onChildExit(code: number | null): void {
    if (this.gameEnded) {
      this.log(`engine exited (code ${code ?? "?"}) after the game ended; expected`);
      this.child = undefined;
      this.pid = undefined;
      return;
    }
    const p = this.pending;
    if (p && !p.resolveRoom) {
      this.settle({
        events: p.events,
        error: `native transport: the engine exited (code ${code ?? "?"}) before the command settled.`,
      });
    }
  }

  /** Resolve an in-flight snapshot wait with the fresh room and clear the slot. */
  private settleRoom(room: RoomState): void {
    const p = this.pending;
    if (!p || !p.resolveRoom) return;
    p.clear();
    this.pending = undefined;
    this.log(`settled "${p.expected}": room (chapter ${room.chapter}, room ${room.room})`);
    p.resolveRoom(room);
  }
}
