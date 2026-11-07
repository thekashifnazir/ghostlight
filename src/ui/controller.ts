// Keyboard controller (Requirements 3, 7, 9.5, 13).
//
// Owns the keyboard and the current mode (list, verb menu, inventory). Stops
// key events reaching the engine's own input (gotcha 7), stops audio at the top
// of every handler (R9.5), maps keys to intents, resolves interact by kind
// (exit→walk, object/person→primary action, or `use activeItem target`), sends
// commands through the adapter targeting hotspot numbers, and returns focus to
// the list after actions.

import type { Command, Diff, EngineAdapter } from "../engine/adapter.js";
import type { Hotspot } from "../model/hotspot-list.js";
import type { Pack } from "../model/pack.js";
import type { Sonar } from "../sonar/sonar.js";
import type { Inventory } from "./inventory.js";
import type { ListMode } from "./list-mode.js";
import type { LiveRegion } from "./live-region.js";
import type { VerbMenu } from "./verb-menu.js";

/** The default engine verb for interacting with a non-exit hotspot by kind. */
function primaryVerb(hotspot: Hotspot): Command {
  if (hotspot.kind === "exit") return { verb: "walk", target: hotspot.num };
  if (hotspot.kind === "npc") return { verb: "talk", target: hotspot.num };
  // A plain object: the engine's primary action is take-or-operate; the
  // interaction model uses `take` as the default "interact", which the engine
  // routes to the object's own action.
  return { verb: "take", target: hotspot.num };
}

export interface ControllerDeps {
  adapter: EngineAdapter;
  /** The accessibility pack, for authored examine descriptions (R3.4). */
  pack: Pack;
  /** The room the player is in now, for keying pack descriptions by hotspot. */
  currentRoom: () => number;
  /**
   * The complete folded engine state and reached milestone set, for resolving
   * description variants on examine (description-variants R3.3). Optional: when
   * absent, examine uses the default description form. Wired by main.ts.
   */
  descriptionState?: () => {
    state: import("../hints/fold.js").EngineHintState;
    reached: ReadonlySet<string>;
  };
  list: ListMode;
  verbMenu: VerbMenu;
  inventory: Inventory;
  live: LiveRegion;
  /**
   * Open an examine window for the focused hotspot before sending `look`
   * (optional; wired by main.ts). The engine answers an examine by drawing
   * hover/examine text that reaches us as A11Y_TEXT events — the generic
   * "can't see anything in particular" line and short hover-name labels — so
   * the narration layer needs to know an examine is in flight to suppress
   * those from the text path, exactly as suppressGenericLook does on the diff
   * path. The window is closed by the look diff. When absent (tests of the
   * controller alone), examine still works; only the text-path suppression is
   * not armed.
   */
  beginExamine?: (num: number) => void;
  /** The highlight follows the focused hotspot; show/hide by rect. */
  showHighlight: (hotspot: Hotspot | undefined) => void;
  /** Read the whole room (name, description, things, exits). */
  readRoom: () => void;
  /** Read the controls (F1). */
  readHelp: () => void;
  /** Stop any playing speech/audio (R9.5). */
  stopAudio: () => void;
  /** Ask the ghost for a hint (hints-and-ghost R7.2). */
  askHint: () => void;
  /** Toggle the ghost voice on/off; text hints keep working (R6.2). */
  toggleGhostVoice: () => void;
  /** Room sonar: scan, step, mute (sonar spec R2, R3, R5, R6). */
  sonar: Sonar;
}

export class Controller {
  private readonly d: ControllerDeps;

  constructor(deps: ControllerDeps) {
    this.d = deps;
  }

  /**
   * Handle one key. Returns true if the key was consumed (so the caller stops
   * propagation and default, keeping it from the engine's input, gotcha 7).
   */
  handleKey(key: string): boolean {
    // Stop audio on every key press (R9.5).
    this.d.stopAudio();

    // Mode-specific routing first.
    if (this.d.verbMenu.isOpen()) return this.handleVerbMenuKey(key);
    if (this.d.inventory.isOpen()) return this.handleInventoryKey(key);
    return this.handleListKey(key);
  }

  private handleListKey(key: string): boolean {
    switch (key) {
      case "ArrowRight":
        this.d.list.next();
        return true;
      case "ArrowLeft":
        this.d.list.prev();
        return true;
      case "ArrowUp":
      case "Enter":
        this.interact();
        return true;
      case "ArrowDown":
        this.examine();
        return true;
      case "v":
      case "V":
        this.openVerbMenu();
        return true;
      case "Tab":
        this.d.inventory.openMenu();
        return true;
      case "Backspace":
        // Nothing to cancel in plain list mode; re-read current focus.
        this.d.list.announceCurrent();
        return true;
      case "r":
      case "R":
        this.d.live.repeat();
        return true;
      case "l":
      case "L":
        this.d.readRoom();
        return true;
      case "h":
      case "H":
        // Ask the ghost for a hint. stopAudio() already ran at the top of
        // handleKey, so any playing whisper is stopped first (R7.3).
        this.d.askHint();
        return true;
      case "g":
      case "G":
        // Toggle the ghost voice. Text hints keep working either way; this
        // only turns the optional whisper on or off and announces the new
        // state (R6.2).
        this.d.toggleGhostVoice();
        return true;
      case "F1":
        this.d.readHelp();
        return true;
      case "s":
      case "S":
        // Sonar scan: one ping per thing, then a summary line (sonar R2).
        // stopAudio() already ran at the top of handleKey, so any scan in
        // progress is stopped before this new one starts (sonar R6.4).
        this.d.sonar.scan();
        return true;
      case "n":
      case "N":
        // Step to the next thing: one ping and its name/direction/distance.
        this.d.sonar.next();
        return true;
      case "p":
      case "P":
        // Step to the previous thing.
        this.d.sonar.prev();
        return true;
      case "m":
      case "M":
        // Toggle sonar sound; the text equivalents keep working when muted.
        this.d.sonar.toggleMute();
        return true;
      case "Escape":
        this.d.adapter.send({ verb: "skip" });
        return true;
      default:
        return false;
    }
  }

  private handleVerbMenuKey(key: string): boolean {
    switch (key) {
      case "ArrowDown":
      case "ArrowRight":
        this.d.verbMenu.next();
        return true;
      case "ArrowUp":
      case "ArrowLeft":
        this.d.verbMenu.prev();
        return true;
      case "Enter":
        this.d.verbMenu.chooseCurrent();
        return true;
      case "Backspace":
      case "Escape":
        this.d.verbMenu.cancel();
        return true;
      default:
        return false;
    }
  }

  private handleInventoryKey(key: string): boolean {
    switch (key) {
      case "ArrowDown":
      case "ArrowRight":
        this.d.inventory.next();
        return true;
      case "ArrowUp":
      case "ArrowLeft":
        this.d.inventory.prev();
        return true;
      case "Enter":
        this.d.inventory.chooseCurrent();
        return true;
      case "Backspace":
      case "Escape":
        this.d.inventory.cancel();
        return true;
      default:
        return false;
    }
  }

  /** Interact with the focused hotspot: walk+act, or use the active item. */
  private interact(): void {
    const h = this.d.list.current();
    if (!h) return;

    const activeItem = this.d.inventory.activeItemId();
    if (activeItem != null) {
      // Use the active item on the focused hotspot (R6.3).
      this.d.adapter.send({ verb: "use", item: activeItem, target: h.num });
      return;
    }
    this.d.adapter.send(primaryVerb(h));
  }

  /**
   * Examine the focused hotspot (look), without walking (R3.4).
   *
   * The engine's own look reply is useless for people and doors — it answers
   * the stock "I can't see anything in particular" line, or nothing. So we
   * announce the pack's authored description first (an object's/person's
   * `description`, or an exit's `label` — whatever the pack carries for that
   * hotspot number), then still send `look` so the engine's reply can append
   * anything it adds beyond the pack. The generic no-info line is filtered out
   * of that reply (see suppressGenericLook, applied where look replies surface)
   * so it never reaches the player. When the pack has nothing for the hotspot,
   * nothing is announced up front and the engine text stands alone, as before.
   */
  private examine(): void {
    const h = this.d.list.current();
    if (!h) return;
    const room = this.d.currentRoom();
    const ds = this.d.descriptionState?.();
    const objectText = ds
      ? this.d.pack.objectDescriptionFor(room, h.num, ds.state, ds.reached)
      : this.d.pack.objectDescription(room, h.num);
    const authored =
      objectText ??
      (h.kind === "exit" ? this.d.pack.exitLabel(room, h.num) : undefined);
    if (authored) this.d.live.announce(authored);
    // Arm the text-path examine suppression before the look, so the engine's
    // hover/examine A11Y_TEXT lines that arrive for this look are filtered.
    this.d.beginExamine?.(h.num);
    this.d.adapter.send({ verb: "look", target: h.num });
  }

  private openVerbMenu(): void {
    const h = this.d.list.current();
    if (!h) return;
    this.d.verbMenu.openOn(h.name);
  }

  /** Send a verb chosen from the verb menu for the focused hotspot. */
  sendVerbForFocused(verb: "open" | "close" | "talk" | "push"): void {
    const h = this.d.list.current();
    if (!h) return;
    this.d.adapter.send({ verb, target: h.num });
  }
}

/**
 * The signature of the engine's stock "no useful look" reply. The Drascula
 * engine answers an examine it has no special text for with a line of the form
 * "I can't see anything in particular", matched case-insensitively on this
 * distinctive phrase so authored pack descriptions are never caught.
 */
const GENERIC_LOOK_PHRASE = "anything in particular";

/** True if `text` is the engine's generic no-info look reply. */
export function isGenericLookLine(text: string): boolean {
  return text.toLowerCase().includes(GENERIC_LOOK_PHRASE);
}

/**
 * Normalise a drawn line for hover-label comparison: trim, drop a trailing
 * full stop the engine sometimes draws, and lower-case. Hover names are drawn
 * as the engine's own hotspot name (ALL CAPS like "BARTENDER", or lower-case
 * like the hero's "hacker"), so a case-insensitive exact match against the
 * room's known names identifies a hover echo without touching real sentences.
 */
function normalizeLabel(text: string): string {
  return text.trim().replace(/\.+$/, "").toLowerCase();
}

/**
 * Decide whether one A11Y_TEXT line drawn during an examine should be dropped.
 *
 * The engine answers an examine by drawing hover/examine text that reaches the
 * player as A11Y_TEXT events, not through the diff's `said`, so the diff-path
 * suppressGenericLook never sees them. Two kinds are noise during an examine
 * and are dropped here:
 *  - the engine's generic "I can't see anything in particular" reply, and
 *  - a bare hover-name label — the engine's own name for a hotspot under the
 *    cursor (e.g. "BARTENDER", or the hero's "hacker"), which is an exact,
 *    case-insensitive match for one of the room's known hotspot names.
 *
 * `roomLabels` is the set of known hotspot names for the current room
 * (normalised): the pack's spoken names and the engine's raw names. A hover
 * name that is NOT a current room hotspot — the hero's own drawn name, which
 * the engine keeps in its character-name table (_textmisc: "hacker", "yoda",
 * "igor") and draws under the cursor — would slip past a room-only match, so a
 * bare single-word token is also treated as a hover echo during an examine.
 * Anything the engine adds beyond a hover name or the stock line — a real
 * sentence like "HE WINKS AT YOU." — is multi-word and is kept.
 */
export function isExamineNoiseLine(
  text: string,
  roomLabels: ReadonlySet<string>,
): boolean {
  if (isGenericLookLine(text)) return true;
  const label = normalizeLabel(text);
  if (roomLabels.has(label)) return true;
  // A bare one-word name-like token (letters only, no spaces) drawn during an
  // examine is a hover name, not a reply the engine composed for the look. This
  // catches the hero's own hover name ("hacker"), which is not a room hotspot.
  return isBareHoverName(label);
}

/**
 * True if a normalised line is a bare hover-name token: a single word of only
 * letters (plus an optional internal hyphen, as some engine names carry one).
 * Multi-word engine replies — the only look text worth keeping — never match.
 */
function isBareHoverName(label: string): boolean {
  return /^[a-z]+(?:-[a-z]+)*$/.test(label);
}

/** Normalise a hotspot name for the room-label set used by isExamineNoiseLine. */
export function labelKey(name: string): string {
  return normalizeLabel(name);
}

/**
 * Drop the engine's generic no-info look line from a look diff's spoken text,
 * so examine (which announces the pack's authored description itself) does not
 * also read the useless stock reply. Scoped to look commands only: other verbs'
 * diffs are returned unchanged, so this never swallows text for talk, take, and
 * the rest. Returns the diff's `said` entries to announce (possibly empty).
 */
export function suppressGenericLook(diff: Diff): { color: string; text: string }[] {
  const said = diff.said ?? [];
  if (!diff.cmd?.startsWith("look ")) return said;
  return said.filter((line) => !isGenericLookLine(line.text));
}
