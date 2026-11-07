// Parse raw engine output lines into the typed model in lines.ts.
//
// The engine emits everything through debug()/printErr, so in practice the
// stream is interleaved with ordinary ScummVM log noise. We key off the a11y
// prefixes and ignore anything else, which is exactly what a line-by-line reader
// on the web side does (design.md, "One line in, one line out").

import type {
  A11yLine,
  Choice,
  Diff,
  InvEntry,
  RoomState,
  SaidLine,
} from "./lines.js";

/** Prefixes we recognise, longest first so `A11Y_DIFF` wins over `A11Y`. */
const PREFIXES = [
  "A11Y_DIFF ",
  "A11Y_CHOICES ",
  "A11Y_CMD ",
  "A11Y_ERR ",
  "A11Y_TEXT ",
  "A11Y_INV ",
  "A11Y_SAVED ",
  "A11Y_HOVER ",
  "A11Y_SAY ",
  "A11Y ",
] as const;

export class ParseError extends Error {}

function parseJson(prefix: string, rest: string): unknown {
  try {
    return JSON.parse(rest);
  } catch (e) {
    throw new ParseError(
      `${prefix.trim()} payload is not valid JSON: ${rest}`,
    );
  }
}

function toRoomState(raw: Record<string, unknown>): RoomState {
  return {
    kind: "room",
    chapter: Number(raw.chapter),
    room: Number(raw.room),
    hero: raw.hero as { x: number; y: number },
    objects: (raw.objects as RoomState["objects"]) ?? [],
    inventory: (raw.inventory as number[]) ?? [],
    flags: (raw.flags as number[]) ?? [],
  };
}

function toDiff(raw: Record<string, unknown>): Diff {
  const d: Diff = { kind: "diff", cmd: String(raw.cmd ?? "") };
  if (raw.chapter !== undefined) d.chapter = raw.chapter as [number, number];
  if (raw.room !== undefined) d.room = raw.room as [number, number];
  if (raw.objects !== undefined) d.objects = raw.objects as Diff["objects"];
  if (raw.appeared !== undefined) d.appeared = raw.appeared as Diff["appeared"];
  if (raw.disappeared !== undefined)
    d.disappeared = raw.disappeared as Diff["disappeared"];
  if (raw.doors !== undefined) d.doors = raw.doors as Diff["doors"];
  if (raw.invAdded !== undefined) d.invAdded = raw.invAdded as InvEntry[];
  if (raw.invRemoved !== undefined) d.invRemoved = raw.invRemoved as InvEntry[];
  if (raw.flags !== undefined)
    d.flags = raw.flags as Record<string, [number, number]>;
  if (raw.said !== undefined) d.said = raw.said as SaidLine[];
  if (raw.changed !== undefined) d.changed = Boolean(raw.changed);
  return d;
}

/**
 * Parse a single raw output line. Returns null for lines that carry no a11y
 * prefix (ordinary engine log noise), so callers can filter them out.
 */
export function parseLine(line: string): A11yLine | null {
  for (const prefix of PREFIXES) {
    if (!line.startsWith(prefix)) continue;
    const rest = line.slice(prefix.length);
    switch (prefix) {
      case "A11Y ": {
        return toRoomState(parseJson(prefix, rest) as Record<string, unknown>);
      }
      case "A11Y_DIFF ": {
        return toDiff(parseJson(prefix, rest) as Record<string, unknown>);
      }
      case "A11Y_CHOICES ": {
        const obj = parseJson(prefix, rest) as { choices: Choice[] };
        return { kind: "choices", choices: obj.choices ?? [] };
      }
      case "A11Y_INV ": {
        const obj = parseJson(prefix, rest) as {
          items: { id: number; name: string; look?: string }[];
        };
        return { kind: "inv", items: obj.items ?? [] };
      }
      case "A11Y_CMD ":
        return { kind: "cmd", text: rest };
      case "A11Y_ERR ":
        return { kind: "err", text: rest };
      case "A11Y_TEXT ":
        return { kind: "text", text: rest };
      case "A11Y_SAVED ": {
        // The engine emits `A11Y_SAVED {"slot":N,"chapter":..,"room":..}`
        // (engine/a11y.cpp dispatchSave). Pull the slot out of the JSON; fall
        // back to the raw text for any older bare-number form so the parser
        // stays tolerant of both shapes.
        const trimmed = rest.trim();
        if (trimmed.startsWith("{")) {
          const obj = parseJson(prefix, trimmed) as { slot?: number | string };
          return { kind: "saved", slot: String(obj.slot ?? trimmed) };
        }
        return { kind: "saved", slot: trimmed };
      }
      case "A11Y_HOVER ":
        return { kind: "hover", text: rest };
      case "A11Y_SAY ":
        return { kind: "say", text: rest };
    }
  }
  return null;
}

/** Parse a whole stream, dropping non-a11y lines. */
export function parseStream(raw: string): A11yLine[] {
  const out: A11yLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const parsed = parseLine(line);
    if (parsed) out.push(parsed);
  }
  return out;
}
