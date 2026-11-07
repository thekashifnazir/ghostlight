// Pack reader (Requirements 8, 15.2).
//
// Loads the accessibility pack read-only and exposes word lookups: room names
// and descriptions, exit labels and destinations, object spoken names and
// kinds, item names, and text-fix application. The engine supplies live state;
// the pack supplies words. Unknown ids return undefined so callers fall back to
// engine data. The pack is never written here.

/** Minimal shapes of the parts of the pack this reader reads. */
import type { EngineHintState } from "../hints/fold.js";
import { resolveDescription, type Describable } from "./variants.js";

/** The default form of a description: the string itself, or an object form's `default`. */
function defaultText(d: Describable | undefined): string | undefined {
  if (d === undefined) return undefined;
  return typeof d === "string" ? d : d.default;
}

interface PackExit {
  label: string;
  to: number | null;
  direction?: string;
}

interface PackObject {
  name: string;
  type?: "object" | "npc" | "exit";
  description?: Describable;
}

interface PackRoom {
  chapters: number[];
  name: string;
  short?: Describable;
  long?: Describable;
  exits?: Record<string, PackExit>;
  objects?: Record<string, PackObject>;
}

interface PackItem {
  id: number;
  chapters: number[];
  name: string;
  description?: string;
}

type TextFixContext = "hotspot" | "dialogue" | "item";

interface TextFix {
  from: string;
  to: string;
  context?: TextFixContext;
  rooms?: number[];
  match?: "exact" | "substring";
  reason?: string;
}

/** The raw pack JSON shape, only the fields this reader uses. */
export interface PackData {
  formatVersion: string;
  rooms: Record<string, PackRoom>;
  items: PackItem[];
  textFixes?: TextFix[];
}

/** Context a text fix applies in, passed to applyTextFixes. */
export type FixContext = TextFixContext;

export class Pack {
  private readonly data: PackData;

  constructor(data: PackData) {
    // Reject an unknown major formatVersion (R: pack reader validates major).
    const major = Number.parseInt(data.formatVersion.split(".")[0] ?? "", 10);
    if (major !== 1) {
      throw new Error(
        `unsupported pack formatVersion "${data.formatVersion}"; this player reads major version 1`,
      );
    }
    this.data = data;
  }

  private room(room: number): PackRoom | undefined {
    return this.data.rooms[String(room)];
  }

  /** The room's display name, or undefined if the room is not in the pack. */
  roomName(room: number): string | undefined {
    return this.room(room)?.name;
  }

  /**
   * The room's short description resolved for the given state, or undefined if
   * the room is not in the pack. A plain-string description resolves to itself;
   * an object-form description resolves to its first matching variant, else its
   * default (description-variants R2, R3.1).
   */
  roomShortFor(
    room: number,
    state: EngineHintState,
    reached: ReadonlySet<string>,
  ): string | undefined {
    const short = this.room(room)?.short;
    return short === undefined
      ? undefined
      : resolveDescription(short, state, reached);
  }

  /**
   * The room's long description resolved for the given state, or undefined
   * (description-variants R3.2).
   */
  roomLongFor(
    room: number,
    state: EngineHintState,
    reached: ReadonlySet<string>,
  ): string | undefined {
    const long = this.room(room)?.long;
    return long === undefined
      ? undefined
      : resolveDescription(long, state, reached);
  }

  /** The room's short description in its default form, ignoring variants. */
  roomShort(room: number): string | undefined {
    return defaultText(this.room(room)?.short);
  }

  /** The room's long description in its default form, ignoring variants. */
  roomLong(room: number): string | undefined {
    return defaultText(this.room(room)?.long);
  }

  /** The spoken label for an exit hotspot, or undefined. */
  exitLabel(room: number, num: number): string | undefined {
    return this.room(room)?.exits?.[String(num)]?.label;
  }

  /** The destination room for an exit hotspot (null = scripted/none), or undefined if not an exit. */
  exitTo(room: number, num: number): number | null | undefined {
    const exit = this.room(room)?.exits?.[String(num)];
    return exit ? exit.to : undefined;
  }

  /** The spoken name for an object hotspot, or undefined. */
  objectName(room: number, num: number): string | undefined {
    return this.room(room)?.objects?.[String(num)]?.name;
  }

  /**
   * The pack's kind for a hotspot in a room: an exit if listed under exits,
   * otherwise the object's declared type, or undefined if the pack has no entry.
   */
  objectType(room: number, num: number): "object" | "npc" | "exit" | undefined {
    const r = this.room(room);
    if (!r) return undefined;
    if (r.exits?.[String(num)]) return "exit";
    const obj = r.objects?.[String(num)];
    if (!obj) return undefined;
    return obj.type ?? "object";
  }

  /**
   * An object's description resolved for the given state, or undefined if the
   * object has no description. Covers objects and NPCs only; exits have a
   * label, not a description, so callers fall back to exitLabel for exits
   * (description-variants R3.3).
   */
  objectDescriptionFor(
    room: number,
    num: number,
    state: EngineHintState,
    reached: ReadonlySet<string>,
  ): string | undefined {
    const desc = this.room(room)?.objects?.[String(num)]?.description;
    return desc === undefined
      ? undefined
      : resolveDescription(desc, state, reached);
  }

  /** An object's description in its default form, ignoring variants. */
  objectDescription(room: number, num: number): string | undefined {
    return defaultText(this.room(room)?.objects?.[String(num)]?.description);
  }

  /**
   * The spoken name for a carried item id, preferring an entry valid in the
   * current chapter. Returns undefined if the pack has no such item.
   */
  itemName(id: number, chapter?: number): string | undefined {
    const matches = this.data.items.filter((it) => it.id === id);
    if (matches.length === 0) return undefined;
    if (chapter != null) {
      const inChapter = matches.find((it) => it.chapters.includes(chapter));
      if (inChapter) return inChapter.name;
    }
    return matches[0].name;
  }

  /**
   * Apply the pack's text fixes to a raw engine string for the given context
   * and room. Exact fixes replace the whole string; substring fixes replace
   * occurrences. Room-scoped fixes only apply in their rooms.
   */
  applyTextFixes(raw: string, context: FixContext, room?: number): string {
    const fixes = this.data.textFixes ?? [];
    let out = raw;
    for (const fix of fixes) {
      if (fix.context && fix.context !== context) continue;
      if (fix.rooms && (room == null || !fix.rooms.includes(room))) continue;
      if (fix.match === "substring") {
        out = out.split(fix.from).join(fix.to);
      } else if (out === fix.from) {
        out = fix.to;
      }
    }
    return out;
  }
}

/** Build a Pack from already-parsed JSON (the page fetches and parses it). */
export function loadPack(data: PackData): Pack {
  return new Pack(data);
}
