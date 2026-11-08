// The verb menu (Requirement 4).
//
// A role=menu with open/close/talk/push as roving-focus role=menuitem buttons.
// Navigation is silent in the live region (screen-reader-focus R6): the open
// line gives the menu name only, and Left/Right move roving focus without a
// live-region write, so the focused button's label (plus aria-posinset/
// aria-setsize) is read once by the screen reader with no double-speak.
// Choosing a verb sends it for the focused hotspot and returns focus to the
// game element; cancel closes and returns focus with an announcement. Roving
// real focus on buttons is used rather than aria-activedescendant (gotcha 9).

import type { TargetVerb } from "../engine/adapter.js";

const VERBS: { verb: Extract<TargetVerb, "open" | "close" | "talk" | "push">; label: string }[] = [
  { verb: "open", label: "Open" },
  { verb: "close", label: "Close" },
  { verb: "talk", label: "Talk to" },
  { verb: "push", label: "Push" },
];

export interface VerbMenuCallbacks {
  /** Announce a line to the live region. */
  announce: (text: string) => void;
  /** Send the chosen verb for the currently focused hotspot. */
  choose: (verb: "open" | "close" | "talk" | "push") => void;
  /** Return focus to the hotspot list (after choose or cancel). */
  returnToList: () => void;
}

export class VerbMenu {
  private readonly el: HTMLElement;
  private readonly cb: VerbMenuCallbacks;
  private buttons: HTMLButtonElement[] = [];
  private index = 0;
  private open = false;
  /** The hotspot name the menu was opened on, for announcements. */
  private targetName = "";

  constructor(el: HTMLElement, cb: VerbMenuCallbacks) {
    this.el = el;
    this.cb = cb;
    this.el.hidden = true;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Open the menu on a focused hotspot, building the roving-focus buttons. */
  openOn(targetName: string): void {
    this.targetName = targetName;
    this.el.innerHTML = "";
    const total = VERBS.length;
    this.buttons = VERBS.map(({ verb, label }, i) => {
      const b = this.el.ownerDocument.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = label;
      // NVDA and JAWS announce "N of M" from these, so the position is read on
      // focus without a second live-region line (screen-reader-focus R6.3).
      b.setAttribute("aria-setsize", String(total));
      b.setAttribute("aria-posinset", String(i + 1));
      b.dataset.verb = verb;
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener("click", () => this.chooseAt(i));
      this.el.appendChild(b);
      return b;
    });
    this.index = 0;
    this.open = true;
    this.el.hidden = false;
    this.focusCurrent();
    // The live line gives the menu name only; the focused Open button carries
    // its label, which the screen reader reads once. Announcing the first verb
    // here too would double-speak it (spike 10, R6.1).
    this.cb.announce(`Actions for ${this.targetName}.`);
  }

  /** Move roving focus to the next item, wrapping. Silent in the live region:
   *  the focused button's label is what the screen reader reads (R6.2). */
  next(): void {
    if (!this.open) return;
    this.index = (this.index + 1) % this.buttons.length;
    this.focusCurrent();
  }

  /** Move roving focus to the previous item, wrapping (silent, R6.2). */
  prev(): void {
    if (!this.open) return;
    this.index = (this.index - 1 + this.buttons.length) % this.buttons.length;
    this.focusCurrent();
  }

  /** Choose the focused verb. */
  chooseCurrent(): void {
    if (!this.open) return;
    this.chooseAt(this.index);
  }

  /** Cancel: close and return focus to the list, announcing the return. */
  cancel(): void {
    if (!this.open) return;
    this.close();
    this.cb.announce(`Cancelled. Back to ${this.targetName}.`);
    this.cb.returnToList();
  }

  private chooseAt(i: number): void {
    const { verb } = VERBS[i];
    this.close();
    this.cb.choose(verb);
    this.cb.returnToList();
  }

  private close(): void {
    this.open = false;
    this.el.hidden = true;
  }

  private focusCurrent(): void {
    this.buttons.forEach((b, i) => {
      b.tabIndex = i === this.index ? 0 : -1;
    });
    this.buttons[this.index]?.focus();
  }
}
