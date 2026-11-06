// The verb menu (Requirement 4).
//
// A role=menu with open/close/talk/push as roving-focus role=menuitem buttons,
// each announced on focus. Choosing a verb sends it for the focused hotspot and
// returns focus to the list; cancel closes and returns focus with an
// announcement. Roving real focus on buttons is used rather than
// aria-activedescendant (gotcha 9).

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
    this.buttons = VERBS.map(({ verb, label }, i) => {
      const b = this.el.ownerDocument.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = label;
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
    this.cb.announce(`Actions for ${this.targetName}. ${VERBS[0].label}.`);
  }

  /** Move roving focus to the next item, wrapping, and announce it. */
  next(): void {
    if (!this.open) return;
    this.index = (this.index + 1) % this.buttons.length;
    this.focusCurrent();
    this.cb.announce(VERBS[this.index].label);
  }

  /** Move roving focus to the previous item, wrapping, and announce it. */
  prev(): void {
    if (!this.open) return;
    this.index = (this.index - 1 + this.buttons.length) % this.buttons.length;
    this.focusCurrent();
    this.cb.announce(VERBS[this.index].label);
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
