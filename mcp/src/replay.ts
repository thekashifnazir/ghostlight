// Replay transport (Requirement 7).
//
// Plays the recorded fixtures in tests/engine/fixtures/ so the MCP server works
// and is testable before the native engine build exists (Req 7.1). It is a thin
// request/response adapter over the SHARED src/engine/replay-adapter.ts
// ReplayAdapter — the exact code the player uses to replay a log — so the "one
// contract" guarantee is literal: the same parser, the same command matching,
// the same quoted mismatch errors (Req 7.4, 7.5, 5.4).
//
// The ReplayAdapter is event-stream (start() emits up to the first room;
// send(cmd) emits every event up to and including the diff). Its emission is
// synchronous, so we wrap each call by subscribing a collector, invoking the
// adapter, and resolving with what was collected — turning the stream into the
// single CommandResult the Transport interface and MCP tool calls need.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { ReplayAdapter } from "../../src/engine/replay-adapter.js";
import type {
  Command,
  CommandResult,
  EngineEvent,
  RoomState,
  Transport,
} from "./transport.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The shared fixtures live under tests/engine/fixtures (read-only here). */
const FIXTURE_DIR = resolve(HERE, "..", "..", "tests", "engine", "fixtures");

/**
 * On-disk fixture shape (tests/engine/fixtures/<name>.json): the raw A11Y lines
 * the engine printed, exactly as they came off stderr. `startRaw` is the first
 * room-state line; each step holds the command and the raw lines it produced.
 */
interface RawFixture {
  label: string;
  startRaw: string;
  steps: { cmd: string; raw: string[] }[];
}

/**
 * Reconstruct the raw stderr line stream from a fixture: the start room-state
 * line, then every step's raw lines in order. This blob is exactly what a live
 * stderr capture would have looked like, so the shared ReplayAdapter drives it
 * unchanged (and validates every line through parseA11yLine on construction).
 */
function fixtureToLogBlob(fixture: RawFixture): string {
  const lines: string[] = [fixture.startRaw];
  for (const step of fixture.steps) lines.push(...step.raw);
  return lines.join("\n");
}

function loadFixtureBlob(name: string, omitCommands: ReadonlySet<string>): string {
  const path = resolve(FIXTURE_DIR, `${name}.json`);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `replay transport: fixture "${name}" not found at ${path}. ` +
        `Available fixtures live in tests/engine/fixtures/.`,
    );
  }
  const fixture = JSON.parse(text) as RawFixture;
  if (omitCommands.size > 0) {
    fixture.steps = fixture.steps.filter((s) => !omitCommands.has(s.cmd));
  }
  return fixtureToLogBlob(fixture);
}

/** Options for the replay transport. */
export interface ReplayOptions {
  /**
   * Recorded step commands (by their `cmd` string) to omit when building the
   * replay log. This is a TEST-ONLY escape hatch for a recorded verb spelling
   * the shared serialiser does not emit — specifically the `inv`/`inventory`
   * seam: `tavern.json` recorded `inv`, but `serializeCommand({verb:"inventory"})`
   * emits `inventory`, so the `inv` step cannot be matched through the shared
   * contract (see .kiro/specs/drascula-mcp/design.md "Known gap" and process-log
   * entry 65). Omitting that one step lets the rest of the fixture replay. It
   * does NOT edit the on-disk fixture (owned by the engine spec); it filters the
   * in-memory log. Defaults to omitting nothing.
   */
  omitSteps?: readonly string[];
}

export class ReplayTransport implements Transport {
  private readonly log: string;
  private adapter: ReplayAdapter | undefined;

  /** @param fixtureName fixture under tests/engine/fixtures (e.g. "tavern"). */
  constructor(fixtureName: string, options: ReplayOptions = {}) {
    // Load (and JSON-parse) eagerly so a missing/bad fixture fails at
    // construction with a clear message (Req 1.4), not on the first tool call.
    this.log = loadFixtureBlob(fixtureName, new Set(options.omitSteps ?? []));
  }

  /**
   * Run the adapter for one synchronous operation, collecting every event it
   * emits during the call. ReplayAdapter emits synchronously, so by the time
   * `run()` returns, the collector holds the full response.
   */
  private collect(run: (adapter: ReplayAdapter) => void): EngineEvent[] {
    const adapter = this.requireAdapter();
    const events: EngineEvent[] = [];
    const unsubscribe = adapter.onEvent((e) => events.push(e));
    try {
      run(adapter);
    } finally {
      unsubscribe();
    }
    return events;
  }

  private requireAdapter(): ReplayAdapter {
    if (!this.adapter) {
      throw new Error("replay transport: not started; call start() first.");
    }
    return this.adapter;
  }

  async start(): Promise<RoomState> {
    // A fresh adapter each start, so a re-start replays from the top (Req 4.2).
    this.adapter = new ReplayAdapter(this.log);
    const events = this.collect((a) => void a.start());
    const room = events.find((e) => e.type === "room");
    if (!room || room.type !== "room") {
      throw new Error(
        "replay transport: fixture produced no initial room state on start.",
      );
    }
    return room.state;
  }

  async send(cmd: Command): Promise<CommandResult> {
    const events = this.collect((a) => a.send(cmd));
    return toCommandResult(events);
  }

  async stop(): Promise<void> {
    // Nothing to release: the adapter is in-memory. Drop it so a later send
    // without a start fails loudly rather than replaying a stale cursor.
    this.adapter = undefined;
  }
}

/**
 * Fold an ordered event list into a CommandResult: the single diff when the
 * command settled with one, or the error message when it produced an A11Y_ERR
 * (or a replay mismatch) instead. Events are always carried in full so no
 * engine output is lost (Req 3.1, 3.2, 3.8).
 */
export function toCommandResult(events: EngineEvent[]): CommandResult {
  const diff = events.find((e) => e.type === "diff");
  const error = events.find((e) => e.type === "error");
  const result: CommandResult = { events };
  if (diff && diff.type === "diff") result.diff = diff.diff;
  if (error && error.type === "error") result.error = error.message;
  return result;
}
