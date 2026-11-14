// Content-addressed cache key for a hint line's audio (Requirement 8.3, 8.8).
//
// The key is a hex SHA-256 over a canonical join of the line text, the voice id
// and the model id, so editing a line's words (or changing the voice or model)
// changes the key and the old whisper is never reused (gotcha 7). Both sides
// hash the UTF-8 bytes of the same canonical string, so the Node path (used by
// the generator script) and the Web Crypto path (used by browser playback)
// produce identical keys. Files live at `src/hints/ghost/<key>.mp3`.

/**
 * The canonical string hashed for a line. A NUL separator cannot appear in the
 * hint text (plain prose) or in a voice/model id, so the join is unambiguous.
 */
function canonical(text: string, voiceId: string, modelId: string): string {
  return [text, voiceId, modelId].join("\u0000");
}

/** Hex SHA-256 of an ArrayBuffer. */
function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * The cache key for a line. Works in both runtimes: it uses Web Crypto
 * (`crypto.subtle`) when available — the browser, and Node 20+ where it is a
 * global — and falls back to Node's `crypto` module otherwise. Both hash the
 * UTF-8 bytes of the same canonical string, so the key is identical whichever
 * path runs (verified by a unit test comparing the two paths directly).
 */
export async function cacheKey(
  text: string,
  voiceId: string,
  modelId: string,
): Promise<string> {
  const message = canonical(text, voiceId, modelId);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(message),
    );
    return toHex(digest);
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(message, "utf8").digest("hex");
}

/** The cache file name for a key: `<key>.mp3`. */
export function cacheFileName(key: string): string {
  return `${key}.mp3`;
}
