// Keyboard controller (Requirements 3, 7, 9.5, 13).
//
// Owns the keyboard and the current mode (list, verb menu, inventory). Stops
// key events reaching the engine's own input (gotcha 7), stops audio at the top
// of every handler (R9.5), maps keys to intents, resolves interact by kind
// (exit→walk, object/person→primary action, or `use activeItem target`), sends
// commands through the adapter targeting hotspot numbers, and returns focus to
// the list after actions.

import type { Command, EngineAdapter } from "../engine/adapter.js";
import type { Hotspot } from "../model/hotspot-list.js";
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
  list: ListMode;
  verbMenu: VerbMenu;
  inventory: Inventory;
  live: LiveRegion;
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

  /** Examine the focused hotspot (look), without walking (R3.4). */
  private examine(): void {
    const h = this.d.list.current();
    if (!h) return;
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
