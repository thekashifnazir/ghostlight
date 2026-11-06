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
  InvItem,
  RoomState,
} from "./adapter.js";

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

    case "A11Y_ERR": {
      return rest.length > 0 ? { type: "error", message: rest } : null;
    }

    case "A11Y_SAVED": {
      const slot = Number.parseInt(rest, 10);
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
