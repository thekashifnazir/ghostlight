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
import { Persistence, probeSaves } from "./engine/persistence.js";
import { SaveManager } from "./engine/save-manager.js";
import { setLoadIntent, takeLoadIntent } from "./engine/load-intent.js";
import { buildHotspotList, type Hotspot } from "./model/hotspot-list.js";
import { loadPack, type Pack, type PackData } from "./model/pack.js";
import { GhostAudio } from "./hints/audio.js";
import { HintEngine } from "./hints/engine.js";
import { foldDiff, type EngineHintState } from "./hints/fold.js";
import { ProgressTracker } from "./hints/progress.js";
import { Sonar } from "./sonar/sonar.js";
// The hint core imports the pack tools' types; the player loads the same pack.
import type { Pack as HintPack } from "../packs/tools/src/types.js";
// The pack is imported read-only as a bundled JSON module, so the player never
// writes it and no copy of it lives under src/. Vite resolves this to the real
// packs/drascula-en.json at dev and build time.
import packJson from "../packs/drascula-en.json";
import { CommandBox } from "./ui/command-box.js";
import { Controller } from "./ui/controller.js";
import { Narrator } from "./ui/narrator.js";
import { Highlight } from "./ui/highlight.js";
import { Inventory } from "./ui/inventory.js";
import { ListMode } from "./ui/list-mode.js";
import { LiveRegion } from "./ui/live-region.js";
import { VerbMenu } from "./ui/verb-menu.js";

// Build stamp, replaced by Vite's define at build and dev-server start. A
// tester reading F1 help can tell us the exact build they played, so a bug
// report maps to a commit. Declared so TypeScript knows the globals exist.
declare const __BUILD_HASH__: string;
declare const __BUILD_DATE__: string;
const BUILD_LINE = `Ghostlight build ${__BUILD_HASH__}, ${__BUILD_DATE__}.`;

const HELP_TEXT =
  "Controls. Left and Right cycle the things, people and exits in the room. " +
  "Up or Enter interacts with the focused thing. Down examines it. " +
  "Press V for more actions: open, close, talk, push. " +
  "Tab opens your inventory; choose an item to make it active, then interact " +
  "with a thing to use it. Backspace cancels. " +
  "Slash opens a command box: type a plain command such as use coins on " +
  "machine, press Enter to send it, or Escape to close. " +
  "R repeats the last line; Shift plus R steps back through earlier lines. " +
  "L reads the whole room. H asks the ghost for a hint. " +
  "G turns the ghost voice on or off; text hints keep working either way. " +
  "F1 reads this help. Escape skips. " +
  "S scans the room as sound, left to right, then counts what is here. " +
  "N and P step to the next and previous thing, playing its place. " +
  "M mutes the sonar sound; the text keeps working. " +
  "C saves your progress. O loads your most recent save. " +
  "Your progress also saves by itself whenever you move to a new room. " +
  "If keys don't work, press NVDA+Space, or JAWS Insert+Z. " +
  BUILD_LINE;

/** Spoken when the player asks for a hint but nothing is offered yet. */
const NO_HINT_TEXT = "There is nothing to hint at right now.";

/**
 * Spoken once, on the first room the player reaches after Start, as a short
 * orientation to the core keys (accessibility: keyboard only, functional text
 * in the live region). Never repeated on later rooms — F1 gives the full help
 * at any time.
 */
const ONBOARDING_TEXT =
  "Left and Right move through the room. Enter acts, Down examines. " +
  "Slash to type a command. H for a hint. F1 for all keys. " +
  "If keys don't work, press NVDA+Space, or JAWS Insert+Z.";

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
  /** Hero foot/centre point, seeded from each full room state so diff-rebuilt
   *  states pass the real hero to sonar instead of (0, 0) (sonar R1.3). */
  hero: { x: number; y: number };
  objects: RoomState["objects"];
  inventory: number[];
}

function loadBundledPack(): Pack {
  // packJson is the real packs/drascula-en.json, bundled read-only by Vite.
  return loadPack(packJson as unknown as PackData);
}

function chooseAdapter(log?: string, saveSlot?: number): EngineAdapter {
  const params = new URLSearchParams(location.search);
  const replay = params.get("replay");
  if (replay || log) {
    return new ReplayAdapter(log ?? "");
  }
  // ?live opts in to the real wasm engine (web-build spec). Without it, keep
  // the existing selection so the replay-based player tests are unchanged.
  // `saveSlot`, when set, loads that save at launch (save-progress R5.1); a
  // fresh start passes undefined and the boot args are unchanged.
  if (params.has("live")) {
    return new LiveAdapter(undefined, undefined, saveSlot);
  }
  return new LiveAdapter(undefined, undefined, saveSlot);
}

/** Load a replay fixture's text by name (dev/test path). */
async function fetchFixture(name: string): Promise<string> {
  const res = await fetch(
    new URL(`./fixtures/${name}.a11y.log`, import.meta.url),
  );
  return res.text();
}

/** The tab title the page keeps, regardless of what ScummVM sets (R5). */
const GHOSTLIGHT_TITLE = "Ghostlight: Drascula";

/**
 * Stop ScummVM's Web MIDI probe so Chrome never pops a "Control and reprogram
 * MIDI devices" permission prompt at boot (spike 10, screen-reader-focus R4).
 *
 * We hide the API on the page rather than rebuilding the wasm with a MIDI-off
 * build flag: this is a page-only, deploy-free fix in the files this spec owns
 * and is testable immediately, whereas a build flag would be unverifiable until
 * the 10 MB wasm is rebuilt and redeployed (which this spec does not do). No
 * functional audio is lost — the game's music plays through SDL audio at the
 * launch --music-volume, and our sonar/earcons/ghost use the page's own Web
 * Audio graph, none of which touch Web MIDI. Returning a rejecting promise
 * (not deleting the property) keeps any feature-detect-then-call path happy: it
 * simply fails to get a MIDI port, with no UI. Reversible — a later build flag
 * could replace this. Must run before scummvm.js loads, so boot() calls it
 * first.
 */
function suppressMidiProbe(): void {
  try {
    const nav = navigator as Navigator & { requestMIDIAccess?: unknown };
    if (typeof nav.requestMIDIAccess === "function") {
      Object.defineProperty(nav, "requestMIDIAccess", {
        configurable: true,
        value: () =>
          Promise.reject(new Error("Web MIDI disabled by Ghostlight")),
      });
    }
  } catch {
    /* navigator frozen or the API absent: nothing to suppress. */
  }
}

/**
 * Keep the browser tab saying "Ghostlight" after ScummVM overwrites
 * document.title with the game's DOS title at boot (spike 10, R5), so a screen
 * reader announces the right thing when the window gains focus.
 *
 * A MutationObserver on <title> resets the title whenever the engine changes
 * it: deterministic (it reacts to the engine's own write) and bounded (it does
 * nothing until the title changes), not an open-ended polling timer. The guard
 * prevents the observer from reacting to its own correction.
 */
function pinTitle(): void {
  document.title = GHOSTLIGHT_TITLE;
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  const obs = new MutationObserver(() => {
    if (document.title !== GHOSTLIGHT_TITLE) document.title = GHOSTLIGHT_TITLE;
  });
  obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
}

export async function boot(): Promise<void> {
  // Kill the Web MIDI probe before anything engine-related runs, so the engine
  // never sees the real navigator.requestMIDIAccess and Chrome never prompts.
  suppressMidiProbe();

  const doc = document;
  const canvas = doc.getElementById("game-canvas") as HTMLCanvasElement;
  const gameEl = doc.getElementById("game") as HTMLElement;
  const liveEl = doc.getElementById("live-region") as HTMLElement;
  const transcriptEl = doc.getElementById("transcript") as HTMLElement;
  const highlightEl = doc.getElementById("highlight") as HTMLElement;
  const verbMenuEl = doc.getElementById("verb-menu") as HTMLElement;
  const inventoryEl = doc.getElementById("inventory") as HTMLElement;
  const commandBoxEl = doc.getElementById("command-box") as HTMLElement;
  const commandBoxInput = doc.getElementById(
    "command-box-input",
  ) as HTMLInputElement;
  const startGate = doc.getElementById("start-gate") as HTMLElement;
  const startButton = doc.getElementById("start-button") as HTMLButtonElement;
  // Continue / New game onboarding (save-progress R3). Present in the markup
  // but only revealed when a save exists in the browser store.
  const resumeChoice = doc.getElementById("resume-choice") as HTMLElement | null;
  const continueButton = doc.getElementById(
    "continue-button",
  ) as HTMLButtonElement | null;
  const newGameButton = doc.getElementById(
    "new-game-button",
  ) as HTMLButtonElement | null;

  // Set up window.Module before anything engine-related (the live adapter and
  // the real wasm build read it).
  window.Module = { canvas, printErr: () => {} };

  const pack = loadBundledPack();

  // Build the UI pieces.
  const live = new LiveRegion(liveEl, transcriptEl);
  const highlight = new Highlight(highlightEl, canvas);

  const state: PlayerState = {
    chapter: 1,
    room: 0,
    hero: { x: 0, y: 0 },
    objects: [],
    inventory: [],
  };
  let currentList: Hotspot[] = [];
  // One-shot: the spoken key orientation is announced on the first room the
  // player reaches after Start, and never again (later rooms arrive as diffs).
  let onboardingDone = false;

  // The narrator owns the cross-cutting narration rules the live-engine survey
  // turned up: dropping the generic look reply and hover-name echoes from the
  // A11Y_TEXT path during an examine, not saying "Nothing happened." after a
  // look, and de-duplicating a line the engine reports both as an A11Y_TEXT
  // event and in the following diff's `said`. See ui/narrator.ts.
  const narrator = new Narrator(live);

  // Announce a composed line through the narrator, so its text-vs-said de-dup
  // memory stays in step.
  const say = (text: string): void => narrator.announce(text);

  // Refresh the narrator's room hover-name labels from the current list and the
  // engine's raw object names, so an examine's hover echo is recognised.
  const rebuildRoomLabels = (): void => {
    narrator.setRoomLabels(
      currentList,
      state.objects.map((o) => o.name),
    );
  };

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
  // The start-gate audio context, set when the player starts (user gesture).
  // Sonar reads it through getContext and stays text-only until it exists.
  let audioContext: AudioContext | undefined;

  // Room sonar: builds pings from the current room state and hotspot list and
  // voices them, writing every line to the same live region (sonar spec).
  const sonar = new Sonar({
    live,
    getContext: () => audioContext,
  });

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
    // Any key press also stops a sonar scan in progress (sonar R5.1, R6.4).
    sonar.stop();
  };

  // Ask the ghost for a hint (hints-and-ghost R5, R6.1). Text to the live
  // region first (always, complete on its own), then the optional whisper.
  const askHint = (): void => {
    void hintEngine.ask(state.room).then((r) => {
      // Every outcome's text goes to the live region, complete on its own: a
      // tier hint, the "nothing to hint at" line, or the exhausted line once
      // the answer has been given twice. The whisper is optional; GhostAudio
      // is a silent no-op when no cached file matches the key.
      live.announce(r.kind === "none" ? NO_HINT_TEXT : r.text);
      if (r.kind !== "none") ghostAudio?.play(r.audioKey);
    });
  };

  // Toggle the ghost voice on or off (hints-and-ghost R6.2). The text hints are
  // untouched — askHint always announces to the live region — so this only
  // flips the optional whisper. Turning it off also stops any whisper playing
  // now (GhostAudio.setEnabled(false) calls stop). Before the start gate
  // ghostAudio is undefined; the toggle still reports the intended state so the
  // key is never silent. The announced line is functional text in the live
  // region, so a screen-reader user hears the result.
  let ghostVoiceOn = true;
  const toggleGhostVoice = (): void => {
    ghostVoiceOn = !ghostVoiceOn;
    ghostAudio?.setEnabled(ghostVoiceOn);
    live.announce(ghostVoiceOn ? "Ghost voice on." : "Ghost voice off.");
  };

  // Decide the adapter: ?replay=<fixture> loads that fixture; else LiveAdapter.
  const params = new URLSearchParams(location.search);
  const replayName = params.get("replay");
  const log = replayName ? await fetchFixture(replayName) : undefined;

  // Save persistence (save-progress R1). The IDBFS mount is registered on
  // Module.preRun below so it is in place before the engine's main() reads the
  // save path; `persistence` also serves hasSave()/latestSlot() after boot. In
  // the replay path there is no wasm FS, so persistence stays unavailable and
  // every save/load path is a graceful no-op.
  const persistence = new Persistence();

  // Resolve the slot to boot into: a load-key reload left a "continue from slot"
  // intent in session storage; the Continue onboarding sets `loadSlot` directly.
  // Undefined means a fresh game.
  let loadSlot: number | undefined = takeLoadIntent();
  // `true` once we booted into a slot, so the first room after boot is
  // announced as "Loaded: <room>" rather than a plain room entry.
  let bootedIntoSlot = loadSlot !== undefined;

  // Register the IDBFS mount + populate inside Emscripten's preRun, so the
  // saved files are visible at /saves before the engine's launch reads
  // --save-slot. Only for the live path (the replay path has no Module.preRun
  // the engine runs). Errors are swallowed by init() itself (R1.5).
  if (!replayName && !log) {
    const w = window as unknown as {
      Module?: { preRun?: Array<() => void>; [k: string]: unknown };
    };
    w.Module = w.Module ?? {};
    const preRun = (w.Module.preRun as Array<() => void> | undefined) ?? [];
    preRun.push(() => {
      // Runs with the real FS global available; init() resolves it internally.
      void persistence.init();
    });
    w.Module.preRun = preRun;
  }

  const adapter = chooseAdapter(log, loadSlot);

  // Move keyboard focus to the game's role="application" element, silently
  // (screen-reader-focus R1, R2). preventScroll keeps focusing from scrolling
  // the page or disturbing the live-region line being read (R1.5). No
  // live-region write here: focus changes must not add a line (R2.6).
  const focusGame = (): void => {
    gameEl.focus({ preventScroll: true });
  };

  // Returning focus to the list after a menu or the command box closes keeps
  // the screen reader in focus mode: focus goes back to the game element so the
  // next key still reaches the page (R2.1, R2.2, R2.4). It is silent — the list
  // stays the active mode and the last spoken line should be the engine's
  // result (after a choose) or the menu's own "Cancelled" line (after a
  // cancel), not a re-announced focus line that would clobber it (R2.6).
  const returnToList = (): void => {
    focusGame();
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

  // The typed command box: "/" opens it; Enter parses the phrase with the
  // existing parser against the current hotspot list and inventory, and sends
  // the resolved command through the same adapter seam the list and menus use.
  // A fixed phrase (help, read room, inventory, skip, choices, repeat) runs the
  // page's own handler for it. Unknown or ambiguous phrases are announced in
  // the live region and not sent.
  const commandBox = new CommandBox(commandBoxEl, commandBoxInput, {
    announce: (t) => live.announce(t),
    send: (cmd) => adapter.send(cmd),
    visible: () => currentList,
    // Resolve carried item ids to the same pack names the inventory uses, so a
    // typed name (e.g. "coins") matches the parser's candidate set.
    inventory: () =>
      state.inventory.map((id) => ({
        id,
        name: pack.itemName(id, state.chapter) ?? `item ${id}`,
      })),
    // No conversation state is tracked at the page level yet; the vending and
    // other non-conversation fixtures never set these. Kept as a seam so a
    // future conversation mode can enrich it without touching the box.
    parseContext: () => ({ inConversation: false, pendingChoice: false }),
    returnToList,
    runFixed: (action) => {
      switch (action) {
        case "repeat":
          live.repeat();
          break;
        case "readRoom":
          readRoom();
          break;
        case "help":
          live.announce(HELP_TEXT);
          break;
        case "inventory":
          inventory.openMenu();
          break;
        case "skip":
          adapter.send({ verb: "skip" });
          break;
        case "choices":
          adapter.send({ verb: "choices" });
          break;
        case "cancel":
          // Nothing to cancel once the box has closed; re-read the focus so the
          // player knows where they are.
          list.announceCurrent();
          break;
      }
    },
  });

  // Read the whole room. `suffix`, when given, is appended to the same spoken
  // line (used once for the first-room key orientation) so it is spoken with
  // the room rather than clobbering it in the single-line live region.
  const readRoom = (suffix?: string): void => {
    const room = LiveRegion.roomAnnouncement({
      name: pack.roomName(state.room),
      // Resolve the short against the running complete state and the reached
      // set, so a variant (e.g. a passage opening) is spoken once its
      // condition holds (description-variants R3.1, R3.5).
      short: pack.roomShortFor(state.room, hintState, hintEngine.reached()),
      hotspots: currentList,
    });
    live.announce(suffix ? `${room} ${suffix}` : room);
  };

  // Save / load / autosave manager (save-progress R2, R4). It drives the engine
  // only through the adapter seam and announces through the one live region. The
  // load path records a "continue from slot" intent and reloads the page (the
  // engine loads only at launch), so Continue on the next load boots the slot.
  const saveManager = new SaveManager({
    send: (cmd) => adapter.send(cmd),
    persistence,
    announce: (t) => live.announce(t),
    roomName: (room) => pack.roomName(room),
    requestReloadInto: (slot) => {
      setLoadIntent(slot);
      location.reload();
    },
  });

  const controller = new Controller({
    adapter,
    pack,
    currentRoom: () => state.room,
    // The folded state and reached set for resolving examine descriptions
    // against variants (description-variants R3.3).
    descriptionState: () => ({ state: hintState, reached: hintEngine.reached() }),
    list,
    verbMenu,
    inventory,
    commandBox,
    live,
    // Open the examine window so the engine's hover/examine A11Y_TEXT lines for
    // this look are filtered from the text path until the look diff arrives.
    beginExamine: () => narrator.beginExamine(),
    showHighlight,
    readRoom,
    readHelp: () => live.announce(HELP_TEXT),
    stopAudio,
    askHint,
    toggleGhostVoice,
    sonar,
    // Save (C) and load (O) keys (save-progress R2.2, R2.4).
    save: () => saveManager.save(),
    load: () => saveManager.load(),
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
        announceText(e.line);
        break;
      case "choices":
        say(e.choices.map((c) => `${c.n}. ${c.text}`).join(" "));
        break;
      case "inv":
        inventory.setItems(e.items.map((i) => i.id));
        break;
      case "error":
        say(e.message);
        break;
      case "saved":
        // The save manager decides what to announce: "Saved." for a manual
        // save that committed, a failure line if the commit did not stick, and
        // nothing for a quiet autosave (save-progress R2.3, R4.3, R4.4).
        void saveManager.onSaved(e.slot);
        break;
      case "cmd":
        // Command echo; nothing to announce (the diff carries the result).
        break;
    }
  }

  /** Route one A11Y_TEXT line through the narrator's examine filter. */
  function announceText(line: string): void {
    narrator.text(line);
  }

  function applyRoom(s: RoomState): void {
    state.chapter = s.chapter;
    state.room = s.room;
    state.hero = s.hero;
    state.objects = s.objects;
    state.inventory = s.inventory;
    currentList = buildHotspotList(s, pack);
    rebuildRoomLabels();
    list.rebuild(currentList);
    inventory.setItems(s.inventory);
    // On the first room after Start, append the one-time key orientation to the
    // room reading so both are spoken together as the single newest live-region
    // line (the region holds only the newest line, so a separate announce would
    // clobber the room). Later rooms arrive as diffs and never repeat it.
    //
    // When this first room is the result of a Continue / load boot, the one
    // update is instead "Loaded: <room>" (save-progress R2.4): the player asked
    // to resume and the confirmation names where they landed. The full room can
    // be re-read with L. A fresh start keeps the normal room + onboarding line.
    if (!onboardingDone) {
      onboardingDone = true;
      if (bootedIntoSlot) {
        bootedIntoSlot = false;
        saveManager.announceLoaded(s.room);
      } else {
        readRoom(ONBOARDING_TEXT);
      }
    } else {
      readRoom();
    }
    // Let the autosave manager see this room entry. The manager gates the very
    // first room (a loaded slot must not be overwritten) and autosaves into the
    // reserved slot on later room changes (save-progress R2.5).
    saveManager.onRoomChange();
    showHighlight(list.current());
    // Feed sonar the full room (with the real hero) and reset its step cursor.
    sonar.setRoom(s, currentList);

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
    // Capture the resolved room descriptions BEFORE folding this diff, so a
    // same-room variant change can be detected and re-announced once
    // (description-variants R4.1). The reached set is a live reference to the
    // tracker's set, so snapshot it before onEngineState mutates it.
    const roomBefore = state.room;
    const reachedBefore = new Set(hintEngine.reached());
    const shortBefore = pack.roomShortFor(roomBefore, hintState, reachedBefore);
    const longBefore = pack.roomLongFor(roomBefore, hintState, reachedBefore);

    // Fold the diff onto the running complete hint state before any branching,
    // so the hint core sees all 50 flags and the full inventory on every diff
    // path (hints-and-ghost R11.1-R11.5), not the sparse delta the diff carries.
    hintState = foldDiff(hintState, diff);
    hintEngine.onEngineState(hintState);

    // If a diff carries a hero position, adopt it before rebuilding so sonar
    // pans from the current hero (the engine chat adds an optional A11Y_DIFF
    // `hero`; until then this is absent and sonar keeps the last room's hero).
    const diffHero = (diff as { hero?: { x: number; y: number } }).hero;
    if (diffHero) state.hero = diffHero;

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
            hero: state.hero,
            objects: diff.objects,
            inventory: state.inventory,
            flags: [],
          },
          pack,
        );
        rebuildRoomLabels();
        list.rebuild(currentList);
        // Refresh sonar with the rebuilt room and the (possibly new) hero.
        sonar.setRoom(
          {
            chapter: state.chapter,
            room: state.room,
            hero: state.hero,
            objects: state.objects,
            inventory: state.inventory,
            flags: [],
          },
          currentList,
        );
      }
      announceSaid(diff);
      readRoom();
      // Autosave on moving to a new room (save-progress R2.5). The manager's
      // first-room gate was already spent by applyRoom's initial entry, so a
      // room change via a door always autosaves.
      saveManager.onRoomChange();
      showHighlight(list.current());
      return;
    }

    // Same-room visibility changes update the list in place.
    if (diff.appeared || diff.disappeared) {
      const present = new Map(state.objects.map((o) => [o.num, o]));
      for (const o of diff.disappeared ?? []) present.delete(o.num);
      for (const o of diff.appeared ?? []) present.set(o.num, o);
      state.objects = [...present.values()];
      const sameRoomState: RoomState = {
        chapter: state.chapter,
        room: state.room,
        hero: state.hero,
        objects: state.objects,
        inventory: state.inventory,
        flags: [],
      };
      currentList = buildHotspotList(sameRoomState, pack);
      rebuildRoomLabels();
      list.update(currentList);
      // Keep sonar in step with the updated visible things (sonar R2.6, R3.6).
      sonar.setRoom(sameRoomState, currentList);
    }

    // Announce the engine's own reply first, then the inventory changes, so
    // the "Received X" / "no longer carried" confirmation is the last line the
    // player hears (the live region keeps only the newest line).
    const isLookDiff = announceSaid(diff);

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

    // "Nothing happened." is the right feedback for an action that did nothing,
    // but never for a look: examine already announced the pack description (or
    // the engine's own look text), and a look that changes no state is the
    // normal case, not a failure to report. The narrator suppresses it for look
    // diffs.
    narrator.maybeNothingHappened(diff, isLookDiff);

    // Re-announce the room once if this same-room diff changed which variant
    // resolves for the short or long description, so a passage opening (or any
    // state-driven description change) is spoken at the moment it happens
    // (description-variants R4.1, R4.2, R4.5). This runs after the engine's own
    // reply and the inventory lines, so the current room picture is the newest
    // line (R4.4/R4.6). The room/chapter-change path returned early above, so
    // reaching here means the room did not change (R4.3); roomBefore is only a
    // belt-and-braces guard.
    if (state.room === roomBefore) {
      const reachedAfter = hintEngine.reached();
      const shortAfter = pack.roomShortFor(state.room, hintState, reachedAfter);
      const longAfter = pack.roomLongFor(state.room, hintState, reachedAfter);
      if (shortAfter !== shortBefore || longAfter !== longBefore) {
        readRoom();
      }
    }
  }

  /**
   * Announce a diff's spoken text through the narrator: it closes the examine
   * window on a look diff, drops the generic look reply (suppressGenericLook),
   * and de-duplicates a `said` line already announced as an A11Y_TEXT event.
   * Returns whether this was a look diff, for the "Nothing happened." guard.
   */
  function announceSaid(diff: Diff): boolean {
    return narrator.said(diff);
  }

  // Keyboard: stop keys reaching the engine's own input (gotcha 7).
  doc.addEventListener(
    "keydown",
    (ev) => {
      if (startGate.hidden) {
        const consumed = controller.handleKey(ev.key, ev.shiftKey);
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
    // Move focus to the game's role="application" element now that the gate is
    // gone, so NVDA and JAWS switch to focus mode and game keys reach the page
    // instead of browse-mode quick-nav (screen-reader-focus R1.2, R2.3).
    focusGame();
    // Pin the tab title before the engine boots, so ScummVM's title change at
    // boot is reverted to "Ghostlight: Drascula" (R5).
    pinTitle();
    // Create the audio context now that we have a user gesture, and build the
    // ghost whisper player on it (hints-and-ghost R6). If audio is unavailable
    // the player stays fully usable as text and hints remain text-only.
    try {
      const ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      ghostAudio = new GhostAudio(ctx);
      // Honour a toggle the player flipped before the start gate.
      ghostAudio.setEnabled(ghostVoiceOn);
    } catch {
      /* audio not available; the player is still fully usable as text. */
    }
    await adapter.start();
  };

  startButton.addEventListener("click", startPlaying);

  // Onboarding Continue / New game (save-progress R3). A returning player's
  // page loads fresh (no slot in the adapter yet), so Continue reuses the load
  // path: record a "continue from slot" intent and reload; the reloaded page
  // reads that intent, boots --save-slot, and announces "Loaded: <room>". New
  // game starts fresh through the normal gate, leaving the save in place.
  //
  // When a load intent is already pending at this load (loadSlot set), we are
  // the continue reload itself: skip the choice and start straight into the
  // slot. Otherwise probe the browser store; only when a save exists do we show
  // the choice. The probe is read-only and falls through to a plain new game on
  // any error or when there is no save (R3.6).
  let gateHandlesAnyKey = true; // the "press any key to begin" default
  const showResumeChoice =
    !replayName && !log && loadSlot === undefined && resumeChoice &&
    continueButton && newGameButton;

  if (showResumeChoice) {
    // Probe IndexedDB directly for an existing save (no wasm FS exists yet).
    const result = await probeSaves().catch(
      (): import("./engine/persistence.js").ProbeResult => ({ hasSave: false }),
    );
    if (result.hasSave && resumeChoice && continueButton && newGameButton) {
      // Reveal the choice, suppress the "any key starts" default so an arrow or
      // stray key does not start a fresh game before the player chooses, and
      // move focus to Continue.
      resumeChoice.hidden = false;
      startButton.hidden = true;
      gateHandlesAnyKey = false;
      const resumeSlot = result.latestSlot;
      continueButton.addEventListener("click", () => {
        if (resumeSlot === undefined) {
          void startPlaying();
          return;
        }
        // Reuse the load path: record the slot and reload into the continue
        // boot. The reloaded page announces "Loaded: <room>".
        setLoadIntent(resumeSlot);
        location.reload();
      });
      newGameButton.addEventListener("click", () => void startPlaying());
      // Announce the choice as functional text (R3.3).
      live.announce(
        "You have a saved game. Press Continue to resume, or New game to start over.",
      );
      continueButton.focus();
    }
  }

  // The gate's "any key begins" shortcut, kept for a fresh start. Suppressed
  // when the Continue / New game choice is showing (the buttons own the keys).
  startGate.addEventListener(
    "keydown",
    (ev) => {
      if (!gateHandlesAnyKey) return; // let the resume-choice buttons handle it
      ev.preventDefault();
      void startPlaying();
    },
    { once: true },
  );

  if (gateHandlesAnyKey) startButton.focus();

  // Announce the start gate's instruction in the live region, so a screen
  // reader conveys it as text like every other functional line, not only as
  // static markup (web-build R4.1). When the resume choice is showing, its own
  // announcement above is the functional line instead.
  if (gateHandlesAnyKey) {
    const gateText = startGate.querySelector("p")?.textContent?.trim();
    if (gateText) live.announce(gateText);
  }
}

// Auto-boot in the browser (not under a test import).
if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot());
  } else {
    void boot();
  }
}
