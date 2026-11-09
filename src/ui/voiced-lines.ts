// The "read voiced lines" setting (speech fix 1).
//
// Drascula plays the actors' recorded voice for character lines. When the
// player's own screen reader then reads the same subtitle over the actor it is
// overwhelming (a real VoiceOver playtest found this). So voiced lines — the
// engine marks them A11Y_VTEXT / `said.voiced` — are NOT spoken by the screen
// reader by DEFAULT. A player who wants the screen reader to read them anyway
// (no game audio, or a preference for the reader's own voice/speed) can turn
// this on with a key; the choice persists across sessions in localStorage.
//
// This is a tiny observable flag plus a try/catch-wrapped persistence layer, so
// it is unit-testable without a browser and never throws if storage is blocked
// (private mode, disabled cookies). Unvoiced lines, pack narration and all UI
// lines are never affected by this setting.

/** The localStorage key under which the setting is persisted. */
export const READ_VOICED_KEY = "ghostlight.readVoicedLines";

/**
 * The default: voiced lines are NOT read by the screen reader. A fresh player,
 * or one whose stored value cannot be read, gets this.
 */
export const READ_VOICED_DEFAULT = false;

/** The minimal Storage surface this module uses (so a test can inject one). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the persisted "read voiced lines" setting, or the default when it has
 * never been set or storage is unavailable. `"1"` means on, anything else
 * (including a missing value or a thrown error) means the default-safe off.
 */
export function loadReadVoiced(storage?: StorageLike): boolean {
  const s = storage ?? safeStorage();
  if (!s) return READ_VOICED_DEFAULT;
  try {
    const raw = s.getItem(READ_VOICED_KEY);
    if (raw === null) return READ_VOICED_DEFAULT;
    return raw === "1";
  } catch {
    return READ_VOICED_DEFAULT;
  }
}

/**
 * Persist the "read voiced lines" setting. Wrapped in try/catch so a storage
 * failure (private mode, quota, disabled storage) is silently ignored — the
 * setting still works for the current session, it just does not persist.
 */
export function saveReadVoiced(on: boolean, storage?: StorageLike): void {
  const s = storage ?? safeStorage();
  if (!s) return;
  try {
    s.setItem(READ_VOICED_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable; the in-memory flag still holds for this session. */
  }
}

/** The browser localStorage, or undefined when it is not reachable. */
function safeStorage(): StorageLike | undefined {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* accessing localStorage can itself throw (sandboxed iframe). */
  }
  return undefined;
}
