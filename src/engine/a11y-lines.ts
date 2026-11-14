// Pure A11Y line parser (Requirements 10.2, 11.2).
//
// Turns one raw log line from the engine into a typed EngineEvent, or null if
// the line is not an A11Y line we handle. Both adapters use this one parser so
// the live engine and the replay of recorded logs cannot drift.
//
// The engine emits clean, unprefixed lines via g_system->logMessage (see
// engine/a11y.cpp), but a line can reach us wrapped by ScummVM's warning()
// path as "WARNING: <line>!" on some backends, so we defensively strip a
// leading "WARNING: " and a single trailing "!" before dispatching.

import type {
  Choice,
  Diff,
  EngineEvent,
  EnginePhase,
  InvItem,
  RoomState,
} from "./adapter.js";

/**
 * Every A11Y prefix token the engine emits. Kept here so `splitA11yLines`
 * recognises exactly the same set of line starts the parser dispatches on, and
 * so a new prefix is added in one place.
 */
const A11Y_PREFIXES = [
  "A11Y",
  "A11Y_DIFF",
  "A11Y_TEXT",
  "A11Y_VTEXT",
  "A11Y_VEND",
  "A11Y_CHOICES",
  "A11Y_INV",
  "A11Y_CMD",
  "A11Y_PHASE",
  "A11Y_ERR",
  "A11Y_SAVED",
  "A11Y_HOVER",
  "A11Y_SAY",
  "A11Y_GAME_END",
  "A11Y_EXIT",
] as const;

/**
 * Split one raw `printErr` string into separate A11Y lines.
 *
 * The engine emits one A11Y line per `g_system->logMessage` call, but on some
 * backends two consecutive lines reach `Module.printErr` GLUED together with no
 * newline between them — e.g. a room-changing command's A11Y_DIFF followed
 * immediately by A11Y_PHASE:
 *
 *   ...,"changed":true}A11Y_PHASE control
 *
 * With them glued, `JSON.parse` of the first payload fails (it swallows the
 * trailing `A11Y_PHASE control`), `parseA11yLine` drops the whole thing, and
 * the player never applies the room change. This pure splitter undoes the glue:
 * it splits on real newlines first, then also splits a segment just before any
 * known A11Y prefix that directly follows a `}` or `]` — i.e. the close of a
 * JSON payload. Both separated and glued input come out as clean per-line
 * strings in order.
 *
 * It never splits inside A11Y_TEXT message text that merely contains the
 * letters "A11Y" mid-sentence: a split point requires the preceding character
 * to be `}` or `]` (a JSON payload boundary) — plain prose does not end a token
 * that way — in addition to a real newline, which `split` already handles.
 */
export function splitA11yLines(raw: string): string[] {
  if (raw == null) return [];
  const out: string[] = [];
  for (const segment of raw.split(/\r?\n/)) {
    let start = 0;
    // Scan for a prefix token that begins right after a `}` or `]`. Start at 1
    // so index 0 (the segment's own leading prefix) is never a split point.
    for (let i = 1; i < segment.length; i++) {
      const prev = segment[i - 1];
      if (prev !== "}" && prev !== "]") continue;
      if (startsWithPrefixToken(segment, i)) {
        out.push(segment.slice(start, i));
        start = i;
      }
    }
    out.push(segment.slice(start));
  }
  return out;
}

/**
 * True when `s` at index `i` begins a known A11Y prefix token followed by a
 * space or the end of the string. Requiring the boundary avoids matching a
 * longer identifier that merely starts with a prefix's letters.
 */
function startsWithPrefixToken(s: string, i: number): boolean {
  for (const prefix of A11Y_PREFIXES) {
    if (!s.startsWith(prefix, i)) continue;
    const after = s[i + prefix.length];
    if (after === undefined || after === " ") return true;
  }
  return false;
}

/** Strip a ScummVM "WARNING: " prefix and a single trailing "!" if present. */
function unwrap(line: string): string {
  let s = line.trim();
  const warn = /^WARNING:\s*/i;
  if (warn.test(s)) {
    s = s.replace(warn, "");
    if (s.endsWith("!")) s = s.slice(0, -1);
  }
  return s.trim();
}

/** Parse the JSON payload after a prefix; returns null on malformed JSON. */
function parseJson<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

/**
 * Parse one raw engine log line into a typed event.
 *
 * Returns null for:
 *  - lines that are not A11Y lines,
 *  - A11Y_HOVER / A11Y_SAY (deliberately ignored: the game's own TTS stays off
 *    so it never talks over the player's screen reader),
 *  - malformed payloads (bad JSON, missing argument).
 */
export function parseA11yLine(line: string): EngineEvent | null {
  if (line == null) return null;
  const s = unwrap(line);

  // Split the prefix (first token) from the rest. A single trailing space after
  // the prefix is the engine's format ("A11Y {…}", "A11Y_CMD look 52").
  const sp = s.indexOf(" ");
  const prefix = sp === -1 ? s : s.slice(0, sp);
  const rest = sp === -1 ? "" : s.slice(sp + 1);

  switch (prefix) {
    case "A11Y": {
      const state = parseJson<RoomState>(rest);
      return state ? { type: "room", state } : null;
    }

    case "A11Y_DIFF": {
      const diff = parseJson<Diff>(rest);
      return diff ? { type: "diff", diff } : null;
    }

    case "A11Y_TEXT": {
      // The payload is a plain drawn line, not JSON. An empty line is not
      // useful.
      return rest.length > 0 ? { type: "text", line: rest } : null;
    }

    case "A11Y_VTEXT": {
      // A voiced line: the same plain drawn text as A11Y_TEXT, but the game was
      // speaking it aloud (a voice sample was playing). Tagged `voiced: true` so
      // the player suppresses the screen-reader echo of it by default.
      return rest.length > 0 ? { type: "text", line: rest, voiced: true } : null;
    }

    case "A11Y_CHOICES": {
      const parsed = parseJson<{ choices: Choice[] }>(rest);
      return parsed && Array.isArray(parsed.choices)
        ? { type: "choices", choices: parsed.choices }
        : null;
    }

    case "A11Y_INV": {
      const parsed = parseJson<{ items: InvItem[] }>(rest);
      return parsed && Array.isArray(parsed.items)
        ? { type: "inv", items: parsed.items }
        : null;
    }

    case "A11Y_CMD": {
      return rest.length > 0 ? { type: "cmd", cmd: rest } : null;
    }

    case "A11Y_PHASE": {
      // Engine-truth control phase: `A11Y_PHASE control|busy|choice`. The
      // payload is a single bare word, not JSON. An unknown word is treated as
      // not-an-event (null) so a future phase name never mis-maps.
      const word = rest.trim();
      if (word === "control" || word === "busy" || word === "choice") {
        return { type: "phase", phase: word as EnginePhase };
      }
      return null;
    }

    case "A11Y_GAME_END": {
      // The final chapter ended. Payload {"cmd":..,"said":[{color,text}]}.
      const parsed = parseJson<{ said?: unknown }>(rest);
      if (!parsed) return null;
      const said = Array.isArray(parsed.said)
        ? (parsed.said as { color: string; text: string; voiced?: boolean }[]).filter(
            (s) => s && typeof s.text === "string",
          )
        : [];
      return { type: "gameEnd", said };
    }

    case "A11Y_EXIT":
      // The engine finished the ending and credits and is quitting.
      return { type: "engineExit" };

    case "A11Y_VEND":
      // The actor's recorded line ended (or a skip stopped it).
      return { type: "voiceEnd" };

    case "A11Y_ERR": {
      return rest.length > 0 ? { type: "error", message: rest } : null;
    }

    case "A11Y_SAVED": {
      // The engine emits the JSON form `A11Y_SAVED {"slot":N,"chapter":C,
      // "room":R}` (engine/a11y.cpp dispatchSave). Parse the slot out of that.
      // A bare `A11Y_SAVED N` is also accepted for forward/backward safety and
      // older recorded logs. Anything else is malformed and returns null.
      const trimmed = rest.trim();
      if (trimmed.startsWith("{")) {
        const parsed = parseJson<{ slot?: unknown }>(trimmed);
        const slot = parsed?.slot;
        return typeof slot === "number" && Number.isFinite(slot)
          ? { type: "saved", slot }
          : null;
      }
      const slot = Number.parseInt(trimmed, 10);
      return Number.isFinite(slot) ? { type: "saved", slot } : null;
    }

    // Deliberately ignored.
    case "A11Y_HOVER":
    case "A11Y_SAY":
      return null;

    default:
      return null;
  }
}
