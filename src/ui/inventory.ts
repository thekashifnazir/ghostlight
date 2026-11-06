// Inventory and the active item (Requirement 6).
//
// Tab opens a keyboard list of carried items by pack name. Choosing an item
// makes it the active item and announces it. With an item active: interacting
// on a focused hotspot sends `use item target`; choosing another inventory item
// sends `use item item2`. Backspace clears the active item if set, else closes
// the inventory, announcing the cancel. invAdded announces "Received X";
// invRemoved announces the item is no longer carried, both by pack name.

import type { InvItem } from "../engine/adapter.js";
import type { Pack } from "../model/pack.js";

export interface InventoryCallbacks {
  announce: (text: string) => void;
  /** Send `use activeItem targetItem` (both are inventory item ids). */
  useOnItem: (itemId: number, targetItemId: number) => void;
  /** Return focus to the hotspot list. */
  returnToList: () => void;
  /** The current chapter, for pack item-name lookup. */
  chapter: () => number;
}

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

  constructor(el: HTMLElement, pack: Pack, cb: InventoryCallbacks) {
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

  /** Resolve an item id's spoken name (pack, else a placeholder). */
  private nameOf(id: number): string {
    return this.pack.itemName(id, this.cb.chapter()) ?? `item ${id}`;
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
    this.cb.announce(
      `Inventory, ${this.items.length} item${this.items.length === 1 ? "" : "s"}. ${this.items[0].name}, 1 of ${this.items.length}.`,
    );
  }

  next(): void {
    if (!this.open) return;
    this.index = (this.index + 1) % this.items.length;
    this.focusCurrent();
    this.announceCurrent();
  }

  prev(): void {
    if (!this.open) return;
    this.index = (this.index - 1 + this.items.length) % this.items.length;
    this.focusCurrent();
    this.announceCurrent();
  }

  /**
   * Choose the focused item. If no item is active yet, make it active. If one
   * is already active, send `use active chosen` (use item on item) and clear.
   */
  chooseCurrent(): void {
    if (!this.open || this.items.length === 0) return;
    const chosen = this.items[this.index];

    if (this.activeId == null) {
      this.activeId = chosen.id;
      this.cb.announce(`${chosen.name} is now active. Choose a target, or press Backspace to cancel.`);
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
      return;
    }
    if (this.open) {
      this.close();
      this.cb.announce("Closed inventory.");
      this.cb.returnToList();
    }
  }

  /** Announce an item gained (R6.6). */
  announceAdded(item: InvItem): void {
    this.cb.announce(`Received ${this.nameOf(item.id)}.`);
  }

  /** Announce an item lost or used up (R6.7). */
  announceRemoved(item: InvItem): void {
    this.cb.announce(`You no longer have the ${this.nameOf(item.id)}.`);
  }

  private announceCurrent(): void {
    const it = this.items[this.index];
    this.cb.announce(`${it.name}, ${this.index + 1} of ${this.items.length}`);
  }

  private render(): void {
    this.el.innerHTML = "";
    this.buttons = this.items.map((it, i) => {
      const b = this.el.ownerDocument.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = it.id === this.activeId ? `${it.name} (active)` : it.name;
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
