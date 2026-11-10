// Stage 1 and 2 (survey and dump), the engine-free core.
// Spec: .kiro/specs/pack-coverage, Requirements 1 and 2.
//
// Everything here talks to the game through an injected `EngineDriver`, which in
// production is the drascula-mcp client (see survey.ts) and in tests is a fake.
// Nothing in this file touches the filesystem, the command file or the engine
// directly, so the walk order and the verdict bookkeeping can be tested with no
// game data and no native build.
//
// The walk: breadth first over the census exit graph for one chapter. Each
// neighbour is reached by walking through the door hotspot the room's own state
// reports for it (the census graph names rooms, not hotspots), and every move is
// confirmed with a fresh `state`. A failed or stalled step is recorded with its
// reason and the walk carries on; nothing here throws out of the run.

import type { RoomState } from "../../src/engine/adapter.js";
import type {
  RoomDumpMeta,
  RoomDumpState,
  RoomDumpVerbs,
  VerbProbe,
} from "./types.js";

/** Rooms with no walkable way in: they need a checkpoint saved inside them. */
export const CUTSCENE_ROOMS: readonly number[] = [56, 57, 102];

/** The parts of reference/census.json the survey needs. */
export interface CensusSlice {
  /** room -> neighbouring rooms. */
  exitGraph: Record<string, number[]>;
  /** room -> chapters it belongs to. */
  roomChapters: Record<string, number[]>;
}

/** What one MCP tool call came back with, however the transport behaves. */
export interface ToolResult {
  /** The parsed JSON payload the tool returned. */
  data: unknown;
  /** True when the tool reported an error (engine A11Y_ERR or a rejection). */
  isError: boolean;
  /** True when the call did not come back within the per-step timeout. */
  timedOut?: boolean;
}

/** The one seam to the game: call a drascula-mcp tool by name. */
export interface EngineDriver {
  call(tool: string, args?: Record<string, number>): Promise<ToolResult>;
}

/** The three dump files for one room, ready to be written. */
export interface RoomFiles {
  state: RoomDumpState;
  verbs: RoomDumpVerbs;
  meta: RoomDumpMeta;
}

/** Where dumps and screenshots go; injected so tests write nothing. */
export interface SurveySink {
  writeRoom(room: number, files: RoomFiles): void | Promise<void>;
  /** Capture packs/survey/<room>/screenshot.png; true if it landed. */
  screenshot?(room: number): Promise<boolean>;
  log(line: string): void;
}

export interface SurveyOptions {
  chapter: number;
  /** The checkpoint slot to start from. */
  slot?: number;
  census: CensusSlice;
  sink: SurveySink;
  /** Take screenshots (needs sink.screenshot). Off by default. */
  screenshots?: boolean;
  /** Extra verbs to probe after `look` (only safe ones: open, close, push). */
  probeVerbs?: string[];
  cutsceneRooms?: readonly number[];
  /** Consecutive stalled steps before the engine is treated as unresponsive. */
  maxConsecutiveStalls?: number;
  /** ISO date for the meta files; injectable for tests. */
  now?: () => string;
  engineBuild?: string;
}

export interface RoomVerdict {
  room: number;
  verdict: "reached" | "unreached";
  reason?: string;
}

export interface BlockedEdge {
  from: number;
  to: number;
  reason: string;
}

export interface FailedStep {
  /** The room the survey was working on (0 before the first room). */
  room: number;
  step: string;
  reason: string;
  /** True when the step did not settle within the per-step timeout. */
  stalled: boolean;
}

/** packs/survey/survey-<chapter>.json */
export interface SurveySummary {
  chapter: number;
  slot: number | null;
  date: string;
  engineBuild: string;
  rooms: RoomVerdict[];
  blockedEdges: BlockedEdge[];
  failedSteps: FailedStep[];
}

// --- Pure helpers -----------------------------------------------------------

/** Census rooms that belong to a chapter, ascending. */
export function chapterRooms(census: CensusSlice, chapter: number): number[] {
  return Object.entries(census.roomChapters)
    .filter(([, chapters]) => chapters.includes(chapter))
    .map(([room]) => Number(room))
    .sort((a, b) => a - b);
}

/** door destinations seen so far: from-room -> (to-room -> door hotspot). */
export type DoorMap = Map<number, Map<number, number>>;

/** Record the doors a room's state reports, keeping the first visible door per destination. */
export function observeDoors(doors: DoorMap, rs: RoomState): void {
  let row = doors.get(rs.room);
  if (!row) {
    row = new Map();
    doors.set(rs.room, row);
  }
  const visibleSeen = new Set<number>();
  for (const o of rs.objects) {
    if (!o.door || o.toRoom === undefined) continue;
    if (!row.has(o.toRoom) || (!visibleSeen.has(o.toRoom) && o.visible)) {
      row.set(o.toRoom, o.num);
    }
    if (o.visible) visibleSeen.add(o.toRoom);
  }
}

/**
 * The shortest run of doors from one room to another over the doors seen so
 * far, or null when there is no known route. Empty when already there.
 */
export function findRoute(
  doors: DoorMap,
  from: number,
  to: number,
): { door: number; to: number }[] | null {
  if (from === to) return [];
  const prev = new Map<number, { room: number; door: number }>();
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const room = queue.shift()!;
    for (const [next, door] of doors.get(room) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { room, door });
      if (next === to) {
        const route: { door: number; to: number }[] = [];
        let at = to;
        while (at !== from) {
          const p = prev.get(at)!;
          route.unshift({ door: p.door, to: at });
          at = p.room;
        }
        return route;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * The order in which a breadth-first walk over a full, unblocked graph reaches
 * rooms. Used to state and test the expected walk order; the live walk follows
 * the same rule (expand in queue order, neighbours in census order).
 */
export function bfsOrder(
  graph: Record<string, number[]>,
  start: number,
  allowed: ReadonlySet<number>,
): number[] {
  const order: number[] = [];
  const seen = new Set<number>([start]);
  if (allowed.has(start)) order.push(start);
  const queue = [start];
  while (queue.length > 0) {
    const room = queue.shift()!;
    for (const next of graph[String(room)] ?? []) {
      if (seen.has(next) || !allowed.has(next)) continue;
      seen.add(next);
      order.push(next);
      queue.push(next);
    }
  }
  return order;
}

/** One printable line per verdict. */
export function verdictLine(v: RoomVerdict): string {
  return v.verdict === "reached"
    ? `room ${v.room}: reached`
    : `room ${v.room}: unreached (${v.reason ?? "no reason recorded"})`;
}

/** Pull the text out of a tool error payload. */
export function errorText(r: ToolResult): string {
  const d = r.data as { error?: unknown } | null | undefined;
  if (d && typeof d === "object" && typeof d.error === "string") return d.error;
  return typeof r.data === "string" ? r.data : "no error text";
}

/** Verbs the survey may probe beyond look. take and walk change the game; talk opens a conversation. */
export const SAFE_EXTRA_VERBS: readonly string[] = ["open", "close", "push"];

// --- Verdict bookkeeping ----------------------------------------------------

/** Tracks what was reached, what blocked, and what stalled. Pure. */
export class Ledger {
  readonly reached = new Set<number>();
  readonly blocked: BlockedEdge[] = [];
  readonly failed: FailedStep[] = [];

  markReached(room: number): void {
    this.reached.add(room);
  }

  blockEdge(from: number, to: number, reason: string): void {
    this.blocked.push({ from, to, reason });
  }

  failStep(room: number, step: string, reason: string, stalled: boolean): void {
    this.failed.push({ room, step, reason, stalled });
  }

  /** The verdict for each census room: reached, or unreached with the reason. */
  verdicts(rooms: readonly number[], cutscene: ReadonlySet<number>): RoomVerdict[] {
    return rooms
      .slice()
      .sort((a, b) => a - b)
      .map((room): RoomVerdict => {
        if (this.reached.has(room)) return { room, verdict: "reached" };
        const reasons = this.blocked
          .filter((b) => b.to === room)
          .map((b) => `from room ${b.from}: ${b.reason}`);
        if (reasons.length > 0) {
          return { room, verdict: "unreached", reason: reasons.slice(0, 3).join("; ") };
        }
        if (cutscene.has(room)) {
          return {
            room,
            verdict: "unreached",
            reason: "cutscene-only room; needs a checkpoint saved inside it",
          };
        }
        return {
          room,
          verdict: "unreached",
          reason: "no route found from the start room (no door seen leading to it)",
        };
      });
  }
}

/** A summary for a run that never got going (for example a missing checkpoint). */
export function unreachedSummary(
  chapter: number,
  slot: number | null,
  census: CensusSlice,
  reason: string,
  date: string,
  engineBuild: string,
): SurveySummary {
  return {
    chapter,
    slot,
    date,
    engineBuild,
    rooms: chapterRooms(census, chapter).map((room) => ({ room, verdict: "unreached", reason })),
    blockedEdges: [],
    failedSteps: [],
  };
}

// --- Dump shaping -----------------------------------------------------------

export function toDumpState(rs: RoomState, invNames: Map<number, string>): RoomDumpState {
  return {
    chapter: rs.chapter,
    room: rs.room,
    hero: [rs.hero.x, rs.hero.y],
    hotspots: rs.objects.map((o) => ({
      num: o.num,
      rawName: o.name,
      rect: [...o.rect],
      door: o.door ? 1 : 0,
      ...(o.toRoom !== undefined ? { toRoom: o.toRoom } : {}),
      visible: o.visible ? 1 : 0,
    })),
    inventory: rs.inventory.map((id) => {
      const name = invNames.get(id);
      return name !== undefined ? { id, name } : { id };
    }),
    flags: [...rs.flags],
  };
}

/** The game's own words from a tool reply's diff, joined, verbatim. */
export function saidText(data: unknown): string | undefined {
  const said = (data as { diff?: { said?: { text?: unknown }[] } } | null)?.diff?.said;
  if (!Array.isArray(said)) return undefined;
  const parts = said.map((s) => s.text).filter((t): t is string => typeof t === "string" && t !== "");
  return parts.length > 0 ? parts.join(" ") : undefined;
}

// --- The run ----------------------------------------------------------------

export async function runSurvey(
  engine: EngineDriver,
  opts: SurveyOptions,
): Promise<SurveySummary> {
  const { chapter, census, sink } = opts;
  const now = opts.now ?? (() => new Date().toISOString().slice(0, 10));
  const engineBuild = opts.engineBuild ?? "unknown";
  const slot = opts.slot ?? null;
  const targets = new Set(chapterRooms(census, chapter));
  const cutscene = new Set(opts.cutsceneRooms ?? CUTSCENE_ROOMS);
  const maxStalls = opts.maxConsecutiveStalls ?? 5;
  const extraVerbs = (opts.probeVerbs ?? []).filter((v) => SAFE_EXTRA_VERBS.includes(v));

  const ledger = new Ledger();
  const doors: DoorMap = new Map();
  const dumped = new Set<number>();
  const tried = new Set<string>();
  let current: number | null = null;
  let workingRoom = 0;
  let stalls = 0;
  let dead = false;

  /** One bounded step. Never throws; stalls and exceptions are recorded. */
  async function step(
    label: string,
    tool: string,
    args?: Record<string, number>,
  ): Promise<ToolResult> {
    if (dead) {
      return {
        data: { error: "engine unresponsive; step skipped" },
        isError: true,
        timedOut: true,
      };
    }
    let r: ToolResult;
    try {
      r = await engine.call(tool, args);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      ledger.failStep(workingRoom, label, reason, false);
      return { data: { error: reason }, isError: true };
    }
    if (r.timedOut) {
      stalls++;
      ledger.failStep(workingRoom, label, errorText(r), true);
      if (stalls >= maxStalls) dead = true;
    } else {
      stalls = 0;
    }
    return r;
  }

  /** Take a fresh state and make it the current position. */
  async function confirm(label: string): Promise<RoomState | null> {
    const r = await step(label, "state");
    if (r.isError || r.timedOut || !r.data) {
      current = null;
      return null;
    }
    const rs = r.data as RoomState;
    current = rs.room;
    observeDoors(doors, rs);
    return rs;
  }

  /** Walk through one door and confirm where it led. */
  async function walkThrough(
    from: number,
    door: number,
    expected: number,
  ): Promise<{ ok: true; rs: RoomState } | { ok: false; reason: string }> {
    const label = `walk ${door}`;
    const w = await step(label, "walk", { target: door });
    // Confirm with state even after a stall: the walk may have finished late.
    const rs = await confirm(`state after ${label}`);
    if (!rs) return { ok: false, reason: `lost position: state failed after ${label}` };
    if (rs.room === expected) return { ok: true, rs };
    if (w.timedOut) return { ok: false, reason: `${label} stalled: ${errorText(w)}` };
    if (w.isError) return { ok: false, reason: `${label} rejected: ${errorText(w)}` };
    if (rs.room === from) {
      return { ok: false, reason: `${label} did not change room (still in room ${from})` };
    }
    return { ok: false, reason: `${label} led to room ${rs.room}, expected ${expected}` };
  }

  /** Get back to a room over the doors seen so far. */
  async function ensureIn(room: number): Promise<{ ok: true } | { ok: false; reason: string }> {
    for (let guard = 0; guard < 12; guard++) {
      if (current === room) return { ok: true };
      if (current === null) return { ok: false, reason: "position lost" };
      const route = findRoute(doors, current, room);
      if (!route || route.length === 0) {
        return { ok: false, reason: `no known route from room ${current} to room ${room}` };
      }
      const hop = route[0]!;
      const before: number = current;
      const res = await walkThrough(before, hop.door, hop.to);
      // A failed hop that left us where we were (or lost) cannot be retried.
      // One that landed somewhere unexpected is planned again from there.
      if (!res.ok && (current === null || current === before)) {
        return { ok: false, reason: res.reason };
      }
    }
    return { ok: false, reason: `gave up getting back to room ${room} after repeated detours` };
  }

  /** Write the dump for a room we are standing in. */
  async function dumpRoom(rs: RoomState): Promise<void> {
    const room = rs.room;
    workingRoom = room;
    dumped.add(room);

    const invNames = new Map<number, string>();
    if (rs.inventory.length > 0) {
      const inv = await step("inventory", "inventory");
      const items = (inv.data as { items?: { id: number; name: string }[] } | null)?.items;
      if (!inv.isError && Array.isArray(items)) for (const i of items) invNames.set(i.id, i.name);
    }

    let shot = false;
    if (opts.screenshots && sink.screenshot) {
      try {
        shot = await sink.screenshot(room);
      } catch (e) {
        ledger.failStep(room, "screenshot", e instanceof Error ? e.message : String(e), false);
      }
    }

    const probes: VerbProbe[] = [];
    for (const h of rs.objects) {
      const probe: VerbProbe = { num: h.num, answered: [], rejected: [] };
      for (const verb of ["look", ...extraVerbs]) {
        const r = await step(`${verb} ${h.num}`, verb, { target: h.num });
        if (r.timedOut) continue;
        if (r.isError) {
          probe.rejected.push(verb);
          continue;
        }
        probe.answered.push(verb);
        if (verb === "look") {
          const text = saidText(r.data);
          if (text !== undefined) probe.lookText = text;
        }
        const moved = (r.data as { diff?: { room?: [number, number] } } | null)?.diff?.room;
        if (moved) {
          // A probe changed the room; get back before carrying on.
          current = moved[1];
          const back = await ensureIn(room);
          if (!back.ok) {
            ledger.failStep(room, `${verb} ${h.num}`, `moved the hero out and could not return: ${back.reason}`, false);
            dead = true;
          }
        }
        if (dead) break;
      }
      probes.push(probe);
      if (dead) break;
    }

    const files: RoomFiles = {
      state: toDumpState(rs, invNames),
      verbs: { room, probes },
      meta: {
        room,
        chapter: rs.chapter,
        checkpointSlot: slot,
        date: now(),
        engineBuild,
        screenshot: shot,
        hotspots: rs.objects.map((o) => ({
          num: o.num,
          door: o.door ? 1 : 0,
          ...(o.toRoom !== undefined ? { toRoom: o.toRoom } : {}),
        })),
      },
    };
    await sink.writeRoom(room, files);
  }

  async function enter(rs: RoomState): Promise<void> {
    if (!targets.has(rs.room)) return;
    ledger.markReached(rs.room);
    if (!dumped.has(rs.room)) await dumpRoom(rs);
  }

  // Start from the checkpoint.
  const started = await step("start", "start", opts.slot !== undefined ? { slot: opts.slot } : undefined);
  const first = started.data as RoomState | null;
  if (started.isError || started.timedOut || !first || typeof first.room !== "number") {
    const reason = `start failed: ${errorText(started)}`;
    sink.log(reason);
    await engine.call("stop").catch(() => undefined);
    const summary = unreachedSummary(chapter, slot, census, reason, now(), engineBuild);
    summary.failedSteps = ledger.failed;
    return summary;
  }

  current = first.room;
  observeDoors(doors, first);
  await enter(first);

  // Breadth first over the census graph.
  const queue: number[] = [first.room];
  while (queue.length > 0 && !dead) {
    const room = queue.shift()!;
    for (const next of census.exitGraph[String(room)] ?? []) {
      if (dead) break;
      if (!targets.has(next) || ledger.reached.has(next)) continue;
      const edge = `${room}->${next}`;
      if (tried.has(edge)) continue;
      tried.add(edge);
      workingRoom = room;

      const back = await ensureIn(room);
      if (!back.ok) {
        ledger.blockEdge(room, next, `could not get back to room ${room}: ${back.reason}`);
        continue;
      }
      const door = doors.get(room)?.get(next);
      if (door === undefined) {
        ledger.blockEdge(room, next, `no door to room ${next} in room ${room}'s state`);
        continue;
      }
      const res = await walkThrough(room, door, next);
      if (!res.ok) {
        ledger.blockEdge(room, next, res.reason);
        continue;
      }
      await enter(res.rs);
      queue.push(next);
    }
  }

  await engine.call("stop").catch(() => undefined);

  return {
    chapter,
    slot,
    date: now(),
    engineBuild,
    rooms: ledger.verdicts([...targets], cutscene),
    blockedEdges: ledger.blocked,
    failedSteps: ledger.failed,
  };
}
