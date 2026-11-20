// Inventory and the active item (Requirement 6).
//
// Tab opens a keyboard list of carried items by pack name. Choosing an item
// makes it the active item and announces it. With an item active: interacting
// on a focused hotspot sends `use item target`; choosing another inventory item
// sends `use item item2`. Backspace clears the active item if set, else closes
// the inventory, announcing the cancel. invAdded announces "Received X";
// invRemoved announces the item is no longer carried, both by pack name.
//
// Menu navigation is silent in the live region (screen-reader-focus R6): the
// open line gives the menu name and count only, and Left/Right move roving
// focus without a live-region write. Each role=menuitem button carries the
// item name and aria-posinset/aria-setsize, so a focus-mode screen reader reads
// "<item>, N of M" from the focused button exactly once, with no double-speak.
// Only action results (item made active, use-on-item, cancel) are announced.

import type { InvItem } from "../engine/adapter.js";
import { currentGame, type GameConfig } from "../engine/game.js";
import type { Pack } from "../model/pack.js";

export interface InventoryCallbacks {
  announce: (text: string) => void;
  /** Send `use activeItem targetItem` (both are inventory item ids). */
  useOnItem: (itemId: number, targetItemId: number) => void;
  /** Send `use activeItem` on the hero (the "Yourself" entry). */
  useOnSelf: (itemId: number) => void;
  /** Return focus to the hotspot list. */
  returnToList: () => void;
  /** The current chapter, for pack item-name lookup. */
  chapter: () => number;
}

/** Placeholder id for the "Yourself" entry; never a real item id. */
const SELF_ENTRY = -1;

/** One carried item: id and its resolved pack name. */
interface CarriedItem {
  id: number;
  name: string;
}

export class Inventory {
  private readonly el: HTMLElement;
  private readonly pack: Pack;
  private readonly cb: InventoryCallbacks;

  private items: CarriedItem[] = [];
  private buttons: HTMLButtonElement[] = [];
  private index = 0;
  private open = false;
  private activeId: number | undefined;

  private readonly game: GameConfig;

  constructor(
    el: HTMLElement,
    pack: Pack,
    cb: InventoryCallbacks,
    game: GameConfig = currentGame(),
  ) {
    this.game = game;
    this.el = el;
    this.pack = pack;
    this.cb = cb;
    this.el.hidden = true;
  }

  isOpen(): boolean {
    return this.open;
  }

  activeItemId(): number | undefined {
    return this.activeId;
  }

  /**
   * Resolve an item id's spoken name (pack, else a placeholder), in the
   * current chapter unless another is given.
   */
  private nameOf(id: number, chapter: number = this.cb.chapter()): string {
    return this.pack.itemName(id, chapter) ?? `item ${id}`;
  }

  /** Update the carried set from the engine's current inventory ids. */
  setItems(ids: number[]): void {
    this.items = ids.map((id) => ({ id, name: this.nameOf(id) }));
    if (this.open) this.render();
  }

  /** Open the inventory list (Tab). */
  openMenu(): void {
    if (this.items.length === 0) {
      this.cb.announce("Your inventory is empty.");
      return;
    }
    this.open = true;
    this.index = 0;
    this.el.hidden = false;
    this.render();
    // The live line gives the menu name and count only; the focused menuitem
    // button carries the item name (plus its aria-posinset/aria-setsize), which
    // the screen reader reads once on focus. Announcing the item name here too
    // would double-speak it (spike 10, screen-reader-focus R6.1).
    this.cb.announce(
      `Inventory, ${this.items.length} item${this.items.length === 1 ? "" : "s"}.`,
    );
  }

  next(): void {
    if (!this.open) return;
    this.index = (this.index + 1) % this.entries().length;
    // Move roving focus only; the newly focused button is what the screen
    // reader reads. No live-region write, to avoid double-speak (R6.2).
    this.focusCurrent();
  }

  prev(): void {
    if (!this.open) return;
    const n = this.entries().length;
    this.index = (this.index - 1 + n) % n;
    this.focusCurrent();
  }

  /** The carried items, plus a final "Yourself" entry while an item is active. */
  private entries(): CarriedItem[] {
    return this.activeId == null || this.game.heroTarget == null
      ? this.items
      : [...this.items, { id: SELF_ENTRY, name: "Yourself" }];
  }

  /**
   * Choose the focused item. If no item is active yet, make it active. If one
   * is already active, send `use active chosen` (use item on item) and clear.
   * The final "Yourself" entry uses the active item on the hero.
   */
  chooseCurrent(): void {
    if (!this.open || this.items.length === 0) return;
    const chosen = this.entries()[this.index];
    if (!chosen) return;

    if (this.activeId == null) {
      this.activeId = chosen.id;
      this.cb.announce(`${chosen.name} is now active. Press Tab to pick something in the room, choose another item, or press Backspace to cancel.`);
      this.render();
      return;
    }

    if (chosen.id === SELF_ENTRY) {
      const activeId = this.activeId;
      const activeName = this.nameOf(activeId);
      this.close();
      this.activeId = undefined;
      this.cb.announce(`Using ${activeName} on yourself.`);
      this.cb.useOnSelf(activeId);
      this.cb.returnToList();
      return;
    }

    if (this.activeId === chosen.id) {
      // Choosing the active item again just re-announces it.
      this.cb.announce(`${chosen.name} is already active.`);
      return;
    }

    const activeName = this.nameOf(this.activeId);
    const targetId = chosen.id;
    const activeId = this.activeId;
    this.close();
    this.activeId = undefined;
    this.cb.announce(`Using ${activeName} on ${chosen.name}.`);
    this.cb.useOnItem(activeId, targetId);
    this.cb.returnToList();
  }

  /**
   * Backspace: clear the active item if one is set (and announce it), else
   * close the inventory. Returns focus to the list when it closes.
   */
  cancel(): void {
    if (this.activeId != null) {
      const name = this.nameOf(this.activeId);
      this.activeId = undefined;
      this.cb.announce(`Cleared ${name}.`);
      if (this.open) this.render();
      return;
    }
    if (this.open) {
      this.close();
      this.cb.announce("Closed inventory.");
      this.cb.returnToList();
    }
  }

  /**
   * Announce what one diff gained (R6.6) and lost or used up (R6.7), as ONE
   * line: the live region keeps only the newest line, so separate lines for a
   * combine ("use rope on branch" gains one item and loses two) left only
   * "You no longer have the branch." and the new item was never heard (a blind
   * tester, 20 Nov). Says nothing when the diff changes nothing carried.
   *
   * `removedChapter` names the removed items in the chapter they were carried
   * in: a crossing diff takes the rope tied to a branch as chapter 5 begins,
   * and item ids are reused per chapter, so it was "the item 21".
   */
  announceChanges(added: InvItem[], removed: InvItem[], removedChapter?: number): void {
    const parts: string[] = [];
    if (added.length > 0) {
      parts.push(`Received ${joinNames(added.map((it) => this.nameOf(it.id)))}.`);
    }
    if (removed.length > 0) {
      parts.push(
        `You no longer have ${joinNames(removed.map((it) => `the ${this.nameOf(it.id, removedChapter)}`))}.`,
      );
    }
    if (parts.length > 0) this.cb.announce(parts.join(" "));
  }

  private render(): void {
    this.el.innerHTML = "";
    const total = this.entries().length;
    this.buttons = this.entries().map((it, i) => {
      const b = this.el.ownerDocument.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = it.id === this.activeId ? `${it.name} (active)` : it.name;
      // NVDA and JAWS announce "N of M" from these themselves, so the position
      // is spoken on focus without a second live-region line (R6.3).
      b.setAttribute("aria-setsize", String(total));
      b.setAttribute("aria-posinset", String(i + 1));
      b.dataset.id = String(it.id);
      b.tabIndex = i === this.index ? 0 : -1;
      b.addEventListener("click", () => {
        this.index = i;
        this.chooseCurrent();
      });
      this.el.appendChild(b);
      return b;
    });
    this.focusCurrent();
  }

  /**
   * Tab in the open inventory: back to the room's list. An active item stays
   * active, so Enter on a thing in the room uses it there. Without one, this
   * just closes, as Backspace does. Before this, the only ways out of the
   * inventory (Backspace, Escape) cleared the item, so an item couldn't be used
   * on a room thing with keys alone (found in QuestAloud, 16 Nov).
   */
  toRoom(): void {
    if (!this.open) return;
    this.close();
    this.cb.announce(
      this.activeId != null
        ? `${this.nameOf(this.activeId)} is active. Pick something in the room and press Enter.`
        : "Closed inventory.",
    );
    this.cb.returnToList();
  }

  private focusCurrent(): void {
    this.buttons.forEach((b, i) => {
      b.tabIndex = i === this.index ? 0 : -1;
    });
    this.buttons[this.index]?.focus();
  }

  private close(): void {
    this.open = false;
    this.el.hidden = true;
  }
}

/** "a", "a and b", "a, b and c". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
