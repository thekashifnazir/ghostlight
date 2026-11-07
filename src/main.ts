// Ghostlight player — boot, event routing, room reading (R8, R11.5, R13.4).
//
// Sets up window.Module first, shows the start gate, and only on the first key
// press creates the audio context and calls adapter.start(). Picks ReplayAdapter
// (via ?replay=) or the LiveAdapter stub, loads the pack, subscribes to adapter
// events, and routes them to the model and UI.

import type {
  Diff,
  EngineAdapter,
  EngineEvent,
  RoomState,
} from "./engine/adapter.js";
import { LiveAdapter } from "./engine/live-adapter.js";
import { ReplayAdapter } from "./engine/replay-adapter.js";
import { buildHotspotList, type Hotspot } from "./model/hotspot-list.js";
import { loadPack, type Pack, type PackData } from "./model/pack.js";
import { GhostAudio } from "./hints/audio.js";
import { HintEngine } from "./hints/engine.js";
import { foldDiff, type EngineHintState } from "./hints/fold.js";
import { ProgressTracker } from "./hints/progress.js";
// The hint core imports the pack tools' types; the player loads the same pack.
import type { Pack as HintPack } from "../packs/tools/src/types.js";
// The pack is imported read-only as a bundled JSON module, so the player never
// writes it and no copy of it lives under src/. Vite resolves this to the real
// packs/drascula-en.json at dev and build time.
import packJson from "../packs/drascula-en.json";
import { Controller } from "./ui/controller.js";
import { Highlight } from "./ui/highlight.js";
import { Inventory } from "./ui/inventory.js";
import { ListMode } from "./ui/list-mode.js";
import { LiveRegion } from "./ui/live-region.js";
import { VerbMenu } from "./ui/verb-menu.js";

const HELP_TEXT =
  "Controls. Left and Right cycle the things, people and exits in the room. " +
  "Up or Enter interacts with the focused thing. Down examines it. " +
  "Press V for more actions: open, close, talk, push. " +
  "Tab opens your inventory; choose an item to make it active, then interact " +
  "with a thing to use it. Backspace cancels. R repeats the last line. " +
  "L reads the whole room. H asks the ghost for a hint. " +
  "F1 reads this help. Escape skips.";

/** Spoken when the player asks for a hint but nothing is offered yet. */
const NO_HINT_TEXT = "There is nothing to hint at right now.";

/** Minimal window.Module shape ScummVM expects; set up before boot. */
declare global {
  interface Window {
    Module?: {
      canvas?: HTMLCanvasElement;
      printErr?: (line: string) => void;
    };
  }
}

/** Current state the player keeps to resolve names and chapters. */
interface PlayerState {
  chapter: number;
  room: number;
  objects: RoomState["objects"];
  inventory: number[];
}

function loadBundledPack(): Pack {
  // packJson is the real packs/drascula-en.json, bundled read-only by Vite.
  return loadPack(packJson as unknown as PackData);
}

function chooseAdapter(log?: string): EngineAdapter {
  const params = new URLSearchParams(location.search);
  const replay = params.get("replay");
  if (replay || log) {
    return new ReplayAdapter(log ?? "");
  }
  // ?live opts in to the real wasm engine (web-build spec). Without it, keep
  // the existing selection so the replay-based player tests are unchanged.
  if (params.has("live")) {
    return new LiveAdapter();
  }
  return new LiveAdapter();
}

/** Load a replay fixture's text by name (dev/test path). */
async function fetchFixture(name: string): Promise<string> {
  const res = await fetch(
    new URL(`./fixtures/${name}.a11y.log`, import.meta.url),
  );
  return res.text();
}

export async function boot(): Promise<void> {
  const doc = document;
  const canvas = doc.getElementById("game-canvas") as HTMLCanvasElement;
  const liveEl = doc.getElementById("live-region") as HTMLElement;
  const transcriptEl = doc.getElementById("transcript") as HTMLElement;
  const highlightEl = doc.getElementById("highlight") as HTMLElement;
  const verbMenuEl = doc.getElementById("verb-menu") as HTMLElement;
  const inventoryEl = doc.getElementById("inventory") as HTMLElement;
  const startGate = doc.getElementById("start-gate") as HTMLElement;
  const startButton = doc.getElementById("start-button") as HTMLButtonElement;

  // Set up window.Module before anything engine-related (the live adapter and
  // the real wasm build read it).
  window.Module = { canvas, printErr: () => {} };

  const pack = loadBundledPack();

  // Build the UI pieces.
  const live = new LiveRegion(liveEl, transcriptEl);
  const highlight = new Highlight(highlightEl, canvas);

  const state: PlayerState = { chapter: 1, room: 0, objects: [], inventory: [] };
  let currentList: Hotspot[] = [];

  // Hint core (hints-and-ghost spec). The tracker and engine read the pack's
  // milestones; the pack JSON is the pack-tools shape the hint core expects.
  const hintPack = packJson as unknown as HintPack;
  const hintTracker = new ProgressTracker(hintPack);
  const hintEngine = new HintEngine(hintPack, hintTracker);
  // The running complete engine state the hint core evaluates against: reset to
  // a room's full flags/inventory on entry, folded forward on each diff.
  let hintState: EngineHintState = {
    chapter: 1,
    room: 0,
    flags: new Array(50).fill(0),
    inventory: [],
  };
  // The ghost whisper player, created once the audio context exists (start
  // gate). Until then it is undefined and the stop/play hooks are no-ops.
  let ghostAudio: GhostAudio | undefined;

  const showHighlight = (h: Hotspot | undefined): void => {
    if (h) highlight.show(h.rect);
    else highlight.hide();
  };

  const list = new ListMode((t) => live.announce(t), showHighlight);

  // Audio stop hook: stop the ghost whisper immediately (hints-and-ghost R6.3).
  // The controller calls this at the top of every key handler, so any key press
  // or focus change interrupts a playing whisper.
  const stopAudio = (): void => {
    ghostAudio?.stop();
  };

  // Ask the ghost for a hint (hints-and-ghost R5, R6.1). Text to the live
  // region first (always, complete on its own), then the optional whisper.
  const askHint = (): void => {
    void hintEngine.ask(state.room).then((r) => {
      live.announce(r.kind === "none" ? NO_HINT_TEXT : r.text);
      if (r.kind === "hint") ghostAudio?.play(r.audioKey);
    });
  };

  // Decide the adapter: ?replay=<fixture> loads that fixture; else LiveAdapter.
  const params = new URLSearchParams(location.search);
  const replayName = params.get("replay");
  const log = replayName ? await fetchFixture(replayName) : undefined;
  const adapter = chooseAdapter(log);

  // Returning focus to the list after a menu closes is silent: the list stays
  // the active mode once the menu is hidden, and the last spoken line should be
  // the engine's result (after a choose) or the menu's own "Cancelled" line
  // (after a cancel), not a re-announced focus line that would clobber it.
  const returnToList = (): void => {
    /* list is active again once the menu is closed; no re-announce. */
  };

  const verbMenu = new VerbMenu(verbMenuEl, {
    announce: (t) => live.announce(t),
    choose: (verb) => controller.sendVerbForFocused(verb),
    returnToList,
  });

  const inventory = new Inventory(inventoryEl, pack, {
    announce: (t) => live.announce(t),
    useOnItem: (item, target) => adapter.send({ verb: "use", item, target }),
    returnToList,
    chapter: () => state.chapter,
  });

  const readRoom = (): void => {
    live.announce(
      LiveRegion.roomAnnouncement({
        name: pack.roomName(state.room),
        short: pack.roomShort(state.room),
        hotspots: currentList,
      }),
    );
  };

  const controller = new Controller({
    adapter,
    list,
    verbMenu,
    inventory,
    live,
    showHighlight,
    readRoom,
    readHelp: () => live.announce(HELP_TEXT),
    stopAudio,
    askHint,
  });

  // Route adapter events to the model and UI.
  adapter.onEvent((e: EngineEvent) => handleEvent(e));

  function handleEvent(e: EngineEvent): void {
    switch (e.type) {
      case "room":
        applyRoom(e.state);
        break;
      case "diff":
        applyDiff(e.diff);
        break;
      case "text":
        live.announce(e.line);
        break;
      case "choices":
        live.announce(
          e.choices.map((c) => `${c.n}. ${c.text}`).join(" "),
        );
        break;
      case "inv":
        inventory.setItems(e.items.map((i) => i.id));
        break;
      case "error":
        live.announce(e.message);
        break;
      case "saved":
        live.announce(`Saved in slot ${e.slot}.`);
        break;
      case "cmd":
        // Command echo; nothing to announce (the diff carries the result).
        break;
    }
  }

  function applyRoom(s: RoomState): void {
    state.chapter = s.chapter;
    state.room = s.room;
    state.objects = s.objects;
    state.inventory = s.inventory;
    currentList = buildHotspotList(s, pack);
    list.rebuild(currentList);
    inventory.setItems(s.inventory);
    readRoom();
    showHighlight(list.current());

    // Re-sync the running hint state to this room's full flags and inventory
    // (hints-and-ghost R11.6), then let the tracker latch any reached milestone.
    hintState = {
      chapter: s.chapter,
      room: s.room,
      flags: s.flags.slice(),
      inventory: s.inventory.slice(),
    };
    hintEngine.onEngineState(hintState);
  }

  function applyDiff(diff: Diff): void {
    // Fold the diff onto the running complete hint state before any branching,
    // so the hint core sees all 50 flags and the full inventory on every diff
    // path (hints-and-ghost R11.1-R11.5), not the sparse delta the diff carries.
    hintState = foldDiff(hintState, diff);
    hintEngine.onEngineState(hintState);

    // A room or chapter change rebuilds from the diff's new objects.
    if (diff.room || diff.chapter) {
      if (diff.chapter) state.chapter = diff.chapter[1];
      if (diff.room) state.room = diff.room[1];
      if (diff.objects) {
        state.objects = diff.objects;
        currentList = buildHotspotList(
          {
            chapter: state.chapter,
            room: state.room,
            hero: { x: 0, y: 0 },
            objects: diff.objects,
            inventory: state.inventory,
            flags: [],
          },
          pack,
        );
        list.rebuild(currentList);
      }
      announceSaid(diff);
      readRoom();
      showHighlight(list.current());
      return;
    }

    // Same-room visibility changes update the list in place.
    if (diff.appeared || diff.disappeared) {
      const present = new Map(state.objects.map((o) => [o.num, o]));
      for (const o of diff.disappeared ?? []) present.delete(o.num);
      for (const o of diff.appeared ?? []) present.set(o.num, o);
      state.objects = [...present.values()];
      currentList = buildHotspotList(
        {
          chapter: state.chapter,
          room: state.room,
          hero: { x: 0, y: 0 },
          objects: state.objects,
          inventory: state.inventory,
          flags: [],
        },
        pack,
      );
      list.update(currentList);
    }

    // Announce the engine's own reply first, then the inventory changes, so
    // the "Received X" / "no longer carried" confirmation is the last line the
    // player hears (the live region keeps only the newest line).
    announceSaid(diff);

    for (const added of diff.invAdded ?? []) {
      if (!state.inventory.includes(added.id)) state.inventory.push(added.id);
      inventory.setItems(state.inventory);
      inventory.announceAdded(added);
    }
    for (const removed of diff.invRemoved ?? []) {
      state.inventory = state.inventory.filter((id) => id !== removed.id);
      inventory.setItems(state.inventory);
      inventory.announceRemoved(removed);
    }

    if (diff.changed === false && !diff.said?.length) {
      live.announce("Nothing happened.");
    }
  }

  function announceSaid(diff: Diff): void {
    for (const line of diff.said ?? []) {
      live.announce(line.text);
    }
  }

  // Keyboard: stop keys reaching the engine's own input (gotcha 7).
  doc.addEventListener(
    "keydown",
    (ev) => {
      if (startGate.hidden) {
        const consumed = controller.handleKey(ev.key);
        if (consumed) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      }
    },
    true,
  );

  // Start gate: first key or button press creates the audio context and starts
  // the adapter (R13.4, gotcha 8).
  let started = false;
  const startPlaying = async (): Promise<void> => {
    if (started) return;
    started = true;
    startGate.hidden = true;
    // Create the audio context now that we have a user gesture, and build the
    // ghost whisper player on it (hints-and-ghost R6). If audio is unavailable
    // the player stays fully usable as text and hints remain text-only.
    try {
      const ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      ghostAudio = new GhostAudio(ctx);
    } catch {
      /* audio not available; the player is still fully usable as text. */
    }
    await adapter.start();
  };

  startButton.addEventListener("click", startPlaying);
  startGate.addEventListener(
    "keydown",
    (ev) => {
      ev.preventDefault();
      void startPlaying();
    },
    { once: true },
  );
  startButton.focus();

  // Announce the start gate's instruction in the live region, so a screen
  // reader conveys it as text like every other functional line, not only as
  // static markup (web-build R4.1).
  const gateText = startGate.querySelector("p")?.textContent?.trim();
  if (gateText) live.announce(gateText);
}

// Auto-boot in the browser (not under a test import).
if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot());
  } else {
    void boot();
  }
}
