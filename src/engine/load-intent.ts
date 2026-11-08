// Load intent across a page reload (save-progress R5.1).
//
// The engine loads a save only at launch (--save-slot), so the load key reloads
// the page and the continue path boots the chosen slot. This small module
// carries the "continue from slot N" decision across that reload through
// sessionStorage (cleared once read, so a later plain reload does not keep
// re-loading the save). Kept separate from main.ts so it is unit-testable and
// so the storage key has one definition.

const KEY = "ghostlight.loadSlot";

/** Session storage, injectable for tests; defaults to window.sessionStorage. */
export interface IntentStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function store(injected?: IntentStore): IntentStore | undefined {
  if (injected) return injected;
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Record that the next page load should continue from `slot`. */
export function setLoadIntent(slot: number, s?: IntentStore): void {
  const st = store(s);
  st?.setItem(KEY, String(slot));
}

/**
 * Read and clear the pending load intent. Returns the slot to continue from, or
 * undefined when there is none. Cleared on read so only the reload that follows
 * a load key acts on it.
 */
export function takeLoadIntent(s?: IntentStore): number | undefined {
  const st = store(s);
  if (!st) return undefined;
  const raw = st.getItem(KEY);
  if (raw === null) return undefined;
  st.removeItem(KEY);
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}
