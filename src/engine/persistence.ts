// Persistent save store (save-progress Requirement 1).
//
// The browser build launches the engine with --savepath=/saves. By default
// /saves (like /tmp) is Emscripten's in-memory MEMFS, wiped on every reload,
// so a save written in one session is gone on the next. This module gives
// /saves a home that outlives the tab: it mounts IDBFS there and flushes it to
// IndexedDB with an explicit FS.syncfs after each save.
//
// Why an explicit mount + sync, not Emscripten's auto-persisting $HOME: the
// engine reads BOTH the save files and the command file from <savepath>
// (a11y.cpp commandFileNode() resolves "<savepath>/a11y-cmd.txt"). syncfs()
// works on the WHOLE mount, so if we persisted /saves naively, the command
// file in it would round-trip through IndexedDB and the engine could replay a
// STALE command at launch. We avoid that with two deliberate steps:
//   - init() deletes /saves/a11y-cmd.txt AFTER loading IndexedDB -> MEMFS and
//     BEFORE boot, so nothing restored from the store can replay.
//   - commit() truncates /saves/a11y-cmd.txt to empty BEFORE syncfs(false), so
//     the copy that reaches the store carries no command.
// Only the save files are ever persisted with content (R1.4).
//
// This module depends only on the Emscripten FS global (resolved the same way
// live-adapter.ts does) and IDBFS. It never imports the model or UI, and it
// never throws from init(): a browser without IDBFS (private mode, blocked
// storage) falls back to an in-memory session so the page still boots (R1.5).

/** The save directory the engine launches with (--savepath=/saves). */
export const SAVE_DIR = "/saves";

/** The engine command file, resolved by a11y.cpp as <savepath>/a11y-cmd.txt. */
export const COMMAND_FILE_NAME = "a11y-cmd.txt";

/**
 * The reserved autosave slot. ScummVM's convention (and the engine's
 * dispatchSave, which rejects `save 0` as a manual save) is slot 0 = autosave,
 * slots >= 1 = manual. Keeping the autosave on slot 0 and manual saves on a
 * slot >= 1 makes them disjoint by construction, so an autosave can never
 * overwrite a manual slot and a manual save can never overwrite the autosave
 * (Requirement 2.6).
 */
export const AUTOSAVE_SLOT = 0;

/** The single manual quick-save slot this feature writes with the save key. */
export const MANUAL_SLOT = 1;

/**
 * ScummVM names Drascula saves "drascula.NNN" where NNN is the zero-padded
 * slot. We read the save folder through this pattern to find existing slots.
 */
const SAVE_FILE_RE = /^drascula\.(\d+)$/;

/** Build the engine's save-file name for a slot (drascula.001 for slot 1). */
export function saveFileName(slot: number): string {
  return `drascula.${String(slot).padStart(3, "0")}`;
}

/** Which kind of save a write is: an automatic room-change save or a manual one. */
export type SaveKind = "auto" | "manual";

/**
 * The slot a save of the given kind writes to. Autosaves always write the
 * reserved AUTOSAVE_SLOT; manual saves always write MANUAL_SLOT. Because the
 * two constants are disjoint (0 vs >= 1), an autosave can never land on a
 * manual slot and a manual save can never land on the autosave slot
 * (Requirement 2.6). This is the single routing point the save manager uses,
 * so the invariant cannot be broken by a stray slot literal elsewhere.
 */
export function slotForSave(kind: SaveKind): number {
  return kind === "auto" ? AUTOSAVE_SLOT : MANUAL_SLOT;
}

/** The result of the pre-boot save probe used by onboarding. */
export interface ProbeResult {
  hasSave: boolean;
  latestSlot?: number;
}

/**
 * Pre-boot probe: does a save exist, and which slot is most recent? Answers the
 * onboarding Continue / New game question BEFORE the engine boots, so it cannot
 * use the Emscripten FS (which does not exist yet). IDBFS stores each mounted
 * folder as an IndexedDB database named after the mountpoint ("/saves") with a
 * FILE_DATA object store keyed by absolute path. This opens that database
 * read-only and looks for keys under "/saves/" that match a Drascula save-file
 * name, ignoring the command file. On any error (no database, no IndexedDB,
 * blocked storage) it resolves { hasSave: false }, so a first visit or a
 * browser without IndexedDB falls through to a new game (R3.6). Read-only: it
 * never creates the database.
 *
 * @param indexedDB the factory, injectable for tests; defaults to the global.
 */
export function probeSaves(
  indexedDB?: IDBFactory,
): Promise<ProbeResult> {
  const factory =
    indexedDB ?? (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return Promise.resolve({ hasSave: false });

  return new Promise<ProbeResult>((resolve) => {
    let open: IDBOpenDBRequest;
    try {
      // IDBFS names the database after the mountpoint. Opening without a version
      // does not upgrade/create for our purposes beyond a default; if the DB did
      // not exist we simply find no FILE_DATA store and report no save.
      open = factory.open(SAVE_DIR);
    } catch {
      resolve({ hasSave: false });
      return;
    }
    open.onerror = () => resolve({ hasSave: false });
    open.onsuccess = () => {
      const db = open.result;
      try {
        if (!db.objectStoreNames.contains("FILE_DATA")) {
          db.close();
          resolve({ hasSave: false });
          return;
        }
        const tx = db.transaction("FILE_DATA", "readonly");
        const keysReq = tx.objectStore("FILE_DATA").getAllKeys();
        keysReq.onerror = () => {
          db.close();
          resolve({ hasSave: false });
        };
        keysReq.onsuccess = () => {
          const slots: number[] = [];
          for (const key of keysReq.result as IDBValidKey[]) {
            const path = String(key);
            const name = path.startsWith(`${SAVE_DIR}/`)
              ? path.slice(SAVE_DIR.length + 1)
              : path;
            const m = SAVE_FILE_RE.exec(name);
            if (m) slots.push(Number(m[1]));
          }
          db.close();
          if (slots.length === 0) {
            resolve({ hasSave: false });
          } else {
            // The probe cannot read mtimes cheaply; "most recent" is refined by
            // the mounted-FS latestSlot() after boot. For onboarding, the
            // highest manual-or-auto slot is a reasonable default to continue.
            resolve({ hasSave: true, latestSlot: Math.max(...slots) });
          }
        };
      } catch {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        resolve({ hasSave: false });
      }
    };
  });
}

/**
 * The subset of the Emscripten FS global this module uses. ScummVM's build
 * exposes FS as a plain global (globalThis.FS), not Module.FS, so we resolve it
 * from the global by default; a test may inject its own.
 */
export interface PersistenceFS {
  mkdir(path: string): void;
  mount(type: unknown, opts: Record<string, unknown>, mountpoint: string): void;
  syncfs(populate: boolean, cb: (err: unknown) => void): void;
  readdir(path: string): string[];
  stat(path: string): { mtime?: Date | number };
  analyzePath?(path: string): { exists: boolean };
  unlink(path: string): void;
  writeFile(path: string, data: string): void;
  /** Emscripten hangs the IDBFS backend off FS.filesystems.IDBFS. */
  filesystems?: { IDBFS?: unknown; MEMFS?: unknown };
}

/** The outcome of init(): whether persistence is available this session. */
export interface PersistenceResult {
  available: boolean;
  /** Why persistence is unavailable, for logging; never shown raw to players. */
  reason?: string;
}

/**
 * Resolve the Emscripten FS. ScummVM exposes it as a global, so prefer an
 * injected FS (tests) and fall back to globalThis.FS. Returns undefined when
 * neither is available (no wasm booted yet).
 */
function resolveFS(injected?: PersistenceFS): PersistenceFS | undefined {
  if (injected) return injected;
  const g = globalThis as unknown as { FS?: PersistenceFS };
  return g.FS;
}

/** Promisify FS.syncfs, which takes a Node-style callback. */
function syncfs(fs: PersistenceFS, populate: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.syncfs(populate, (err) => (err ? reject(err) : resolve()));
  });
}

/** True if `path` exists, using analyzePath when present or a stat probe. */
function pathExists(fs: PersistenceFS, path: string): boolean {
  if (fs.analyzePath) return fs.analyzePath(path).exists;
  try {
    fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Milliseconds from a stat mtime (Date or epoch ms), 0 when absent. */
function mtimeMs(stat: { mtime?: Date | number }): number {
  const m = stat.mtime;
  if (m instanceof Date) return m.getTime();
  if (typeof m === "number") return m;
  return 0;
}

export class Persistence {
  private readonly injectedFS: PersistenceFS | undefined;
  private available = false;

  /**
   * @param fs an injected Emscripten FS (tests). Omitted in the browser, where
   *   the real FS global is resolved at call time (after the wasm has booted,
   *   or — for init — after the mount is created on the pre-boot FS global).
   */
  constructor(fs?: PersistenceFS) {
    this.injectedFS = fs;
  }

  /** Whether save files will persist this session (false after a failed init). */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Mount IDBFS at the save directory and load any saved files from IndexedDB
   * into MEMFS, so a launch with --save-slot=<n> can load a save written in an
   * earlier session (R1.3). Deletes a restored command file before boot so no
   * stale command can be replayed (R1.4). Never throws: a browser without a
   * usable IDBFS resolves { available: false } and the page runs in memory
   * (R1.5).
   *
   * ORDERING: in the browser this must run inside Emscripten's `Module.preRun`,
   * because the `FS` global only exists after `scummvm.js` instantiates the
   * wasm, and the mount must be in place before the engine's `main()` reads the
   * save path. `main.ts` pushes `() => persistence.init()` onto `Module.preRun`
   * (where `resolveFS()` finds the real global). Tests call it directly with an
   * injected FS. The pre-boot onboarding probe is `probeSaves()`, which does not
   * need an FS.
   */
  async init(): Promise<PersistenceResult> {
    const fs = resolveFS(this.injectedFS);
    if (!fs) {
      this.available = false;
      return { available: false, reason: "no Emscripten FS available" };
    }
    const idbfs = fs.filesystems?.IDBFS;
    if (!idbfs) {
      this.available = false;
      return { available: false, reason: "IDBFS is not available in this browser" };
    }
    try {
      if (!pathExists(fs, SAVE_DIR)) fs.mkdir(SAVE_DIR);
      fs.mount(idbfs, {}, SAVE_DIR);
      // populate = true: IndexedDB -> MEMFS, so earlier sessions' saves appear.
      await syncfs(fs, true);
      // Drop any command file restored from the store so a stale command queued
      // in a previous session can never be replayed at this launch (R1.4).
      this.deleteCommandFile(fs);
      this.available = true;
      return { available: true };
    } catch (err) {
      this.available = false;
      return {
        available: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Flush MEMFS -> IndexedDB so the save just written survives a reload (R1.2).
   * Truncates the command file to empty first, so the copy that reaches the
   * store carries no command (R1.4). Returns false on failure so the caller can
   * announce it (R4.3); returns true as a no-op when persistence is unavailable
   * so callers need no special-casing.
   */
  async commit(): Promise<boolean> {
    if (!this.available) return true;
    const fs = resolveFS(this.injectedFS);
    if (!fs) return false;
    try {
      this.truncateCommandFile(fs);
      // populate = false: MEMFS -> IndexedDB.
      await syncfs(fs, false);
      return true;
    } catch {
      return false;
    }
  }

  /** True when at least one Drascula save file exists in the save folder. */
  hasSave(): boolean {
    return this.listSlots().length > 0;
  }

  /**
   * The most recent saved slot by modification time, or undefined when none.
   * Used by the load key and the Continue onboarding to pick what to resume.
   */
  latestSlot(): number | undefined {
    const slots = this.listSlots();
    if (slots.length === 0) return undefined;
    slots.sort((a, b) => b.mtime - a.mtime);
    return slots[0].slot;
  }

  /** Read the save folder and return the slot number + mtime of each save. */
  private listSlots(): { slot: number; mtime: number }[] {
    if (!this.available) return [];
    const fs = resolveFS(this.injectedFS);
    if (!fs) return [];
    let names: string[];
    try {
      names = fs.readdir(SAVE_DIR);
    } catch {
      return [];
    }
    const slots: { slot: number; mtime: number }[] = [];
    for (const name of names) {
      const m = SAVE_FILE_RE.exec(name);
      if (!m) continue;
      let mtime = 0;
      try {
        mtime = mtimeMs(fs.stat(`${SAVE_DIR}/${name}`));
      } catch {
        /* keep mtime 0; the slot still counts as present */
      }
      slots.push({ slot: Number(m[1]), mtime });
    }
    return slots;
  }

  /** Delete the command file from the mount if present (init, pre-boot). */
  private deleteCommandFile(fs: PersistenceFS): void {
    const path = `${SAVE_DIR}/${COMMAND_FILE_NAME}`;
    if (!pathExists(fs, path)) return;
    try {
      fs.unlink(path);
    } catch {
      /* best effort: a non-removable command file is still emptied by commit */
    }
  }

  /** Truncate the command file to empty before a commit (never persist a command). */
  private truncateCommandFile(fs: PersistenceFS): void {
    const path = `${SAVE_DIR}/${COMMAND_FILE_NAME}`;
    if (!pathExists(fs, path)) return;
    try {
      fs.writeFile(path, "");
    } catch {
      /* best effort */
    }
  }
}
