// Replay adapter (Requirement 11).
//
// Plays a recorded A11Y log so the whole player can be built, run and tested
// before the web build exists. It implements the same EngineAdapter interface
// as the live engine, parses the log with the one shared parser, emits up to
// the first room state on start(), and on each command advances the log to the
// engine's response to that command. If a command does not match the next
// recorded command, it surfaces a clear mismatch error rather than inventing
// engine behaviour (R11.4).

import {
  type Command,
  type EngineAdapter,
  type EngineEvent,
  serializeCommand,
} from "./adapter.js";
import { parseA11yLine } from "./a11y-lines.js";

/**
 * One parsed log line: the typed event (or null for comments / blank / ignored
 * lines) plus the raw text, so mismatch messages can quote the recording.
 */
interface LogEntry {
  event: EngineEvent | null;
  raw: string;
}

export class ReplayAdapter implements EngineAdapter {
  private readonly entries: LogEntry[];
  private cursor = 0;
  private started = false;
  private readonly listeners = new Set<(e: EngineEvent) => void>();

  /** @param log the recorded A11Y log, as one blob of newline-delimited text. */
  constructor(log: string) {
    this.entries = log
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((raw) => ({ raw, event: parseA11yLine(raw) }));
  }

  onEvent(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: EngineEvent): void {
    for (const l of this.listeners) l(e);
  }

  /**
   * Boot: emit events up to and including the first room state. Anything before
   * the first room (an early A11Y_ERR about subtitles, say) is emitted too, so
   * the player sees exactly what a live boot would show.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    while (this.cursor < this.entries.length) {
      const { event } = this.entries[this.cursor];
      this.cursor++;
      if (!event) continue;
      this.emit(event);
      if (event.type === "room") return;
    }
  }

  /**
   * Issue a command. The next recorded command line must match what this
   * command serialises to; then every event up to and including the next diff
   * is emitted (the engine's full settled response). On a mismatch, emit a
   * clear error and do not advance past the recorded command (R11.4).
   */
  send(cmd: Command): void {
    // A player setting with no recorded counterpart: nothing to replay.
    if (cmd.verb === "readpause") return;
    const expected = serializeCommand(cmd);

    // Find the next recorded command line from the cursor.
    let i = this.cursor;
    while (i < this.entries.length && this.entries[i].event?.type !== "cmd") {
      i++;
    }

    if (i >= this.entries.length) {
      this.emit({
        type: "error",
        message: `replay: no further recorded command to match "${expected}" (end of log)`,
      });
      return;
    }

    const recorded = this.entries[i].event as Extract<
      EngineEvent,
      { type: "cmd" }
    >;
    if (recorded.cmd !== expected) {
      this.emit({
        type: "error",
        message: `replay mismatch: player sent "${expected}" but the recording's next command is "${recorded.cmd}"`,
      });
      return;
    }

    // Match: advance the cursor past the command, then emit through the next
    // diff (inclusive), surfacing any interleaved text/choices/inv/error lines.
    this.cursor = i + 1;
    while (this.cursor < this.entries.length) {
      const { event } = this.entries[this.cursor];
      this.cursor++;
      if (!event) continue;
      this.emit(event);
      if (event.type === "diff") return;
      if (event.type === "gameEnd") {
        // The ending settles the command; the engine's A11Y_EXIT comes only
        // after the credits (minutes later). Play any recorded exit line a
        // moment later so the finish line has time to be read.
        const next = this.entries[this.cursor]?.event;
        if (next?.type === "engineExit") {
          this.cursor++;
          setTimeout(() => this.emit(next), 2000);
        }
        return;
      }
    }

    // Ran off the end without a diff: the recording is incomplete for this
    // command. Report it rather than pretending the command settled.
    this.emit({
      type: "error",
      message: `replay: command "${expected}" matched but the recording has no diff for it`,
    });
  }
}

/** Convenience for tests and ?replay=: build an adapter from log text. */
export function replayFromLog(log: string): ReplayAdapter {
  return new ReplayAdapter(log);
}
