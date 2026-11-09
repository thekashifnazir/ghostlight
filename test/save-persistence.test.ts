import { describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_SLOT,
  COMMAND_FILE_NAME,
  MANUAL_SLOT,
  Persistence,
  SAVE_DIR,
  saveFileName,
  type PersistenceFS,
} from "../src/engine/persistence.js";

/**
 * A fake Emscripten FS + IDBFS backed by a plain in-memory map, enough to
 * exercise Persistence. Files are keyed by absolute path; mtimes are explicit.
 * syncfs is a no-op by default; tests can make populate/flush reject.
 */
function fakeFS(opts?: {
  withIDBFS?: boolean;
  onMkdir?: () => void;
  onMount?: () => void;
  syncPopulateRejects?: boolean;
  syncFlushRejects?: boolean;
  initial?: Record<string, number>; // path -> mtime ms
}) {
  const withIDBFS = opts?.withIDBFS ?? true;
  const files = new Map<string, number>(
    Object.entries(opts?.initial ?? {}),
  );
  const dirs = new Set<string>([SAVE_DIR]);
  const calls = { mounts: 0, syncPopulate: 0, syncFlush: 0 };

  const fs: PersistenceFS = {
    mkdir(path) {
      opts?.onMkdir?.();
      dirs.add(path);
    },
    mount() {
      opts?.onMount?.();
      calls.mounts++;
    },
    syncfs(populate, cb) {
      if (populate) {
        calls.syncPopulate++;
        cb(opts?.syncPopulateRejects ? new Error("populate failed") : null);
      } else {
        calls.syncFlush++;
        cb(opts?.syncFlushRejects ? new Error("flush failed") : null);
      }
    },
    readdir(path) {
      const prefix = `${path}/`;
      const out: string[] = [];
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) out.push(key.slice(prefix.length));
      }
      return out;
    },
    stat(path) {
      if (!files.has(path)) throw new Error(`no such file: ${path}`);
      return { mtime: files.get(path)! };
    },
    analyzePath(path) {
      return { exists: files.has(path) || dirs.has(path) };
    },
    unlink(path) {
      files.delete(path);
    },
    writeFile(path, data) {
      // Content is irrelevant here; track presence and a trivial mtime bump.
      files.set(path, data === "" ? (files.get(path) ?? 1) : Date.now());
    },
    filesystems: withIDBFS ? { IDBFS: {}, MEMFS: {} } : { MEMFS: {} },
  };
  return { fs, files, calls };
}

const CMD_PATH = `${SAVE_DIR}/${COMMAND_FILE_NAME}`;

describe("Persistence.init", () => {
  it("mounts IDBFS, populates from the store, and reports available", async () => {
    const { fs, calls } = fakeFS();
    const p = new Persistence(fs);
    const res = await p.init();
    expect(res.available).toBe(true);
    expect(p.isAvailable()).toBe(true);
    expect(calls.mounts).toBe(1);
    expect(calls.syncPopulate).toBe(1);
  });

  it("resolves { available: false } without throwing when IDBFS is absent", async () => {
    const { fs } = fakeFS({ withIDBFS: false });
    const p = new Persistence(fs);
    const res = await p.init();
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/IDBFS/);
    expect(p.isAvailable()).toBe(false);
  });

  it("resolves { available: false } without throwing when syncfs(populate) rejects", async () => {
    const { fs } = fakeFS({ syncPopulateRejects: true });
    const p = new Persistence(fs);
    await expect(p.init()).resolves.toMatchObject({ available: false });
    expect(p.isAvailable()).toBe(false);
  });

  it("deletes a command file restored from the store, before boot (R1.4)", async () => {
    // A command file was persisted by a buggy earlier session and restored by
    // syncfs(true); init must drop it so no stale command replays at launch.
    const { fs, files } = fakeFS({ initial: { [CMD_PATH]: 100 } });
    expect(files.has(CMD_PATH)).toBe(true);
    const p = new Persistence(fs);
    await p.init();
    expect(files.has(CMD_PATH)).toBe(false);
  });
});

describe("Persistence.commit", () => {
  it("truncates the command file before flushing, then syncs MEMFS -> store (R1.4)", async () => {
    const { fs, files, calls } = fakeFS({ initial: { [CMD_PATH]: 100 } });
    const p = new Persistence(fs);
    await p.init();
    // init deleted the restored command file; simulate the engine writing a new
    // command between init and commit.
    files.set(CMD_PATH, 200);
    const truncate = vi.spyOn(fs, "writeFile");

    const ok = await p.commit();
    expect(ok).toBe(true);
    // The command file was written empty BEFORE the flush.
    expect(truncate).toHaveBeenCalledWith(CMD_PATH, "");
    expect(calls.syncFlush).toBe(1);
  });

  it("returns false when syncfs(flush) rejects", async () => {
    const { fs } = fakeFS({ syncFlushRejects: true });
    const p = new Persistence(fs);
    await p.init();
    await expect(p.commit()).resolves.toBe(false);
  });

  it("is a no-op returning true when persistence is unavailable", async () => {
    const { fs, calls } = fakeFS({ withIDBFS: false });
    const p = new Persistence(fs);
    await p.init();
    expect(p.isAvailable()).toBe(false);
    await expect(p.commit()).resolves.toBe(true);
    expect(calls.syncFlush).toBe(0);
  });
});

describe("Persistence.commit serialises overlapping flushes (one in flight, one queued)", () => {
  /**
   * A fake FS whose flush syncfs does NOT call back immediately: each flush's
   * callback is parked in `pending` so a test can start several commits and
   * then release the flushes one at a time, observing how many actually ran.
   * populate (init) still calls back synchronously so init resolves at once.
   */
  function deferredFlushFS() {
    const pending: Array<(err: unknown) => void> = [];
    let flushStarts = 0;
    const fs: PersistenceFS = {
      mkdir() {},
      mount() {},
      syncfs(populate, cb) {
        if (populate) {
          cb(null); // init populate settles immediately
          return;
        }
        flushStarts++;
        pending.push(cb); // park the flush callback for the test to release
      },
      readdir: () => [],
      stat: () => ({ mtime: 0 }),
      analyzePath: () => ({ exists: false }),
      unlink() {},
      writeFile() {},
      filesystems: { IDBFS: {}, MEMFS: {} },
    };
    /** Resolve the oldest in-flight flush, letting its awaiters continue. */
    const release = async () => {
      const cb = pending.shift();
      cb?.(null);
      // Let the microtask chain settle (the runCommit resolution, the .finally
      // promotion, and the queued flush's .then(startFlush) that starts the
      // next sync) before the test inspects flushStarts again. A macrotask tick
      // drains all the pending microtasks regardless of how many hops deep.
      await new Promise((r) => setTimeout(r, 0));
    };
    return { fs, release, flushStarts: () => flushStarts, inFlight: () => pending.length };
  }

  it("never runs two flushes at once: a burst of commits collapses to the running flush plus one queued", async () => {
    const { fs, release, flushStarts, inFlight } = deferredFlushFS();
    const p = new Persistence(fs);
    await p.init();

    // Fire three commits while none can settle. Only the first starts a real
    // flush; the other two coalesce onto a single queued follow-up.
    const a = p.commit();
    const b = p.commit();
    const c = p.commit();
    await Promise.resolve();
    expect(flushStarts()).toBe(1); // only ONE sync in flight
    expect(inFlight()).toBe(1);

    // Release the running flush: the single queued follow-up now starts, and it
    // is the SECOND sync — not a third and fourth for b and c separately.
    await release();
    expect(flushStarts()).toBe(2);
    expect(inFlight()).toBe(1);
    await expect(a).resolves.toBe(true);

    // Release the follow-up: b and c (which coalesced onto it) resolve together.
    await release();
    expect(await b).toBe(true);
    expect(await c).toBe(true);
    // No extra sync beyond the two: running + one queued covered the burst.
    expect(flushStarts()).toBe(2);
  });

  it("a commit after the queue has drained starts a fresh flush", async () => {
    const { fs, release, flushStarts } = deferredFlushFS();
    const p = new Persistence(fs);
    await p.init();

    const first = p.commit();
    await Promise.resolve();
    expect(flushStarts()).toBe(1);
    await release(); // drains: no follow-up was queued
    await first;

    // A later, non-overlapping commit is a brand-new flush, not a no-op.
    const second = p.commit();
    await Promise.resolve();
    expect(flushStarts()).toBe(2);
    await release();
    await expect(second).resolves.toBe(true);
  });

  it("a third commit during the queued follow-up queues one more, still one at a time", async () => {
    const { fs, release, flushStarts, inFlight } = deferredFlushFS();
    const p = new Persistence(fs);
    await p.init();

    const a = p.commit(); // starts flush 1
    const b = p.commit(); // queues follow-up
    await Promise.resolve();
    expect(flushStarts()).toBe(1);

    await release(); // flush 1 done; follow-up (flush 2) starts
    expect(flushStarts()).toBe(2);
    expect(inFlight()).toBe(1);

    // A new commit WHILE flush 2 runs queues a single third flush.
    const c = p.commit();
    await Promise.resolve();
    expect(flushStarts()).toBe(2); // still only flush 2 in flight

    await release(); // flush 2 done; flush 3 starts
    expect(flushStarts()).toBe(3);
    await release(); // flush 3 done
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(await c).toBe(true);
  });
});

describe("Persistence.hasSave / latestSlot", () => {
  it("reports no save on an empty folder", async () => {
    const { fs } = fakeFS();
    const p = new Persistence(fs);
    await p.init();
    expect(p.hasSave()).toBe(false);
    expect(p.latestSlot()).toBeUndefined();
  });

  it("recognises Drascula save files and picks the most recent slot", async () => {
    const { fs } = fakeFS({
      initial: {
        [`${SAVE_DIR}/${saveFileName(AUTOSAVE_SLOT)}`]: 300, // drascula.000
        [`${SAVE_DIR}/${saveFileName(MANUAL_SLOT)}`]: 100, // drascula.001
        [`${SAVE_DIR}/${saveFileName(2)}`]: 500, // drascula.002, newest
        [`${SAVE_DIR}/notasave.txt`]: 999, // ignored
      },
    });
    const p = new Persistence(fs);
    await p.init();
    expect(p.hasSave()).toBe(true);
    expect(p.latestSlot()).toBe(2);
  });

  it("ignores the command file when listing saves", async () => {
    const { fs } = fakeFS({ initial: { [CMD_PATH]: 100 } });
    const p = new Persistence(fs);
    await p.init();
    expect(p.hasSave()).toBe(false);
  });
});

describe("slot constants", () => {
  it("keep autosave and manual slots disjoint, both valid engine slots (R2.6)", () => {
    expect(AUTOSAVE_SLOT).not.toBe(MANUAL_SLOT);
    // The engine (a11y.cpp dispatchSave) rejects any save slot < 1, so BOTH
    // the autosave and the manual slot must be >= 1; the autosave is no longer
    // ScummVM's conventional slot 0.
    expect(AUTOSAVE_SLOT).toBe(99);
    expect(AUTOSAVE_SLOT).toBeGreaterThanOrEqual(1);
    expect(MANUAL_SLOT).toBeGreaterThanOrEqual(1);
  });
});
