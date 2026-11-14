// Parse raw engine output into the test model in lines.ts.
//
// The parsing itself is the player's own: splitA11yLines and parseA11yLine in
// src/engine/a11y-lines.ts, the functions the live and replay adapters and the
// MCP server use, so the engine tests read exactly what the player reads. This
// file only maps the player's events onto the `kind`-tagged model the engine
// tests are written against, and keeps one stricter rule: a line with an A11Y
// prefix that does not parse is an error here, so a fixture that breaks the
// line contract fails to load instead of being skipped.

import { parseA11yLine, splitA11yLines } from "../../../src/engine/a11y-lines.js";
import type { EngineEvent } from "../../../src/engine/adapter.js";
import type { A11yLine, Choice, Diff, RoomState } from "./lines.js";

export class ParseError extends Error {}

function toLine(e: EngineEvent): A11yLine {
  switch (e.type) {
    case "room": {
      const s = e.state;
      const room: RoomState = {
        kind: "room",
        chapter: Number(s.chapter),
        room: Number(s.room),
        hero: s.hero,
        objects: s.objects ?? [],
        inventory: s.inventory ?? [],
        flags: s.flags ?? [],
      };
      return room;
    }
    case "diff": {
      const d = { ...e.diff, kind: "diff" } as Diff;
      d.cmd = String(d.cmd ?? "");
      return d;
    }
    case "text":
      return e.voiced
        ? { kind: "text", text: e.line, voiced: true }
        : { kind: "text", text: e.line };
    case "choices":
      return { kind: "choices", choices: e.choices as Choice[] };
    case "inv":
      return { kind: "inv", items: e.items };
    case "cmd":
      return { kind: "cmd", text: e.cmd };
    case "error":
      return { kind: "err", text: e.message };
    case "saved":
      return { kind: "saved", slot: String(e.slot) };
    case "phase":
      return { kind: "phase", phase: e.phase };
    case "gameEnd":
      return { kind: "gameEnd", said: e.said };
    case "engineExit":
      return { kind: "exit" };
    case "voiceEnd":
      return { kind: "voiceEnd" };
    case "voiceHold":
      return { kind: "voiceHold", ms: e.ms };
  }
}

/**
 * Parse a single raw output line. Returns null for lines that carry no a11y
 * prefix (ordinary engine log noise).
 */
export function parseLine(line: string): A11yLine | null {
  const event = parseA11yLine(line);
  if (event) return toLine(event);
  const s = line.trim();
  if (/^A11Y(_[A-Z_]+)?( |$)/.test(s)) {
    throw new ParseError(`A11Y line does not parse: ${s}`);
  }
  return null;
}

/** Parse a whole stream, dropping non-a11y lines and undoing glued lines. */
export function parseStream(raw: string): A11yLine[] {
  const out: A11yLine[] = [];
  for (const line of splitA11yLines(raw)) {
    if (line.length === 0) continue;
    const parsed = parseLine(line);
    if (parsed) out.push(parsed);
  }
  return out;
}
