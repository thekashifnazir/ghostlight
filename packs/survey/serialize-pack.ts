// The one writer for packs/drascula-en.json (and any other pack file).
// Spec: .kiro/specs/pack-coverage, Requirement 4.
//
// JSON.stringify(pack, null, 2) puts every key on its own line, which turns the
// pack's 1,000 lines into 2,000+ and buries the real change in a merge diff.
// This serializer keeps the pack compact and, more importantly, STABLE:
//
//   * A value is written on one line, as `{ "k": v, "k2": v2 }` or `[a, b]`,
//     when that one-line form is at most MAX_INLINE characters. Otherwise the
//     value is opened across lines with two-space indentation and each child is
//     decided the same way.
//   * The decision for a value depends only on that value, never on its
//     neighbours or its depth. So changing one room changes only that room's
//     lines, and merging nothing changes nothing.
//   * Keys are written in JavaScript's own iteration order (digit-string keys
//     ascending, then the rest in insertion order). That is the order a parse
//     produces, so parse then serialize is a fixed point: serializePack is
//     idempotent and `serializePack(JSON.parse(text)) === text` for any text
//     this function wrote.
//
// Strings and numbers are written with JSON.stringify, so the output is always
// valid JSON that parses back to a deeply equal value.

/** Longest one-line form (not counting indentation or the key before it). */
export const MAX_INLINE = 120;

function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return v !== null && typeof v === "object";
}

/** Keys of an object whose value would survive JSON.stringify. */
function liveKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => {
    const t = typeof obj[k];
    return obj[k] !== undefined && t !== "function" && t !== "symbol";
  });
}

/** A value on a single line. */
function flat(v: unknown): string {
  if (Array.isArray(v)) {
    return v.length === 0 ? "[]" : `[${v.map(flat).join(", ")}]`;
  }
  if (isContainer(v)) {
    const keys = liveKeys(v);
    if (keys.length === 0) return "{}";
    return `{ ${keys.map((k) => `${JSON.stringify(k)}: ${flat(v[k])}`).join(", ")} }`;
  }
  // Primitives; undefined and functions in an array become null, as in JSON.
  return JSON.stringify(v) ?? "null";
}

/** A value on one line if it fits, else opened across lines. */
function layout(v: unknown, depth: number): string {
  const oneLine = flat(v);
  if (!isContainer(v) || oneLine.length <= MAX_INLINE) return oneLine;

  const inner = "  ".repeat(depth + 1);
  const outer = "  ".repeat(depth);
  if (Array.isArray(v)) {
    const items = v.map((x) => `${inner}${layout(x, depth + 1)}`);
    return `[\n${items.join(",\n")}\n${outer}]`;
  }
  const rows = liveKeys(v).map(
    (k) => `${inner}${JSON.stringify(k)}: ${layout(v[k], depth + 1)}`,
  );
  return `{\n${rows.join(",\n")}\n${outer}}`;
}

/** The pack as file text, with a trailing newline. */
export function serializePack(pack: unknown): string {
  return `${layout(pack, 0)}\n`;
}
