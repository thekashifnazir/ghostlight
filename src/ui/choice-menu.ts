// The conversation choice menu (A11Y_CHOICES, screen-reader-focus R6).
//
// When a conversation offers choices (the engine emits A11Y_CHOICES and the
// phase becomes 'choice'), the engine is WAITING for the player to pick one.
// Before this menu existed there was no keyboard way to pick: the controller
// had no choice handling, so a blind player talking to the drunk in the tavern
// was stuck. This menu is the keyboard way in.
//
// It uses a role=listbox with roving-focus role=option buttons, each carrying
// aria-posinset/aria-setsize and aria-selected on the focused one, so a
// focus-mode screen reader reads "<option>, selected, N of M" from the focused
// option itself with no double-speak (screen-reader-focus R6). A listbox (not a
// role=menu) is deliberate: on role=menu/menuitem VoiceOver reads its own menu
// hint — "To choose this menu item, press Control-Option-Space. To close this
// menu, press Escape." — which is wrong here (Enter picks, Escape does not
// close). A listbox of options carries no such hint, so VoiceOver describes a
// selectable list, which matches how this menu actually behaves. The listbox
// itself keeps the accessible name "Choices"; the verb and inventory menus are
// left as role=menu. The open line gives the menu name and count only
// ("Choices, N options."); the focused option's text is read by the screen
// reader, not repeated in the live region.
//
// Two rules differ from the verb menu and the inventory, because here the
// engine is BLOCKED waiting for a choice:
//   - Escape does NOT close the menu. There is nothing to cancel back to — the
//     engine will not move until a choice is sent — so Escape instead re-states
//     how to choose ("Pick an option with Up and Down, then Enter.").
//   - Number keys 1-9 pick a choice directly (the choices are numbered 1..N in
//     the engine), and R repeats all the options as one line.
//
// Choosing sends { verb: 'choose', n } for the chosen option's engine number,
// and returns focus to the game element (returnToList), like the other menus.
// The menu is closed by main.ts when the engine leaves the choice phase, or
// when a fresh set of choices replaces it — never by the player directly.

export interface ChoiceOption {
  /** The engine's choice number (1-based; what `choose n` sends). */
  n: number;
  /** The spoken text of the option. */
  text: string;
}

export interface ChoiceMenuCallbacks {
  /** Announce a line to the live region. */
  announce: (text: string) => void;
  /** Send the chosen option's engine number (sends { verb: 'choose', n }). */
  choose: (n: number) => void;
  /** Return focus to the game element (after a choice is sent). */
  returnToList: () => void;
}

export class ChoiceMenu {
  private readonly el: HTMLElement;
  private readonly cb: ChoiceMenuCallbacks;
  private buttons: HTMLButtonElement[] = [];
  private options: ChoiceOption[] = [];
  private index = 0;
  private open = false;

  constructor(el: HTMLElement, cb: ChoiceMenuCallbacks) {
    this.el = el;
    this.cb = cb;
    // The container is the listbox itself: a role=listbox named "Choices",
    // holding role=option buttons. Set here (not only in markup) so a menu
    // built in a bare test container is a proper listbox too.
    this.el.setAttribute("role", "listbox");
    this.el.setAttribute("aria-label", "Choices");
    this.el.hidden = true;
  }

  isOpen(): boolean {
    return this.open;
  }

  /**
   * Open (or replace) the choice menu with a fresh set of options, building the
   * roving-focus buttons and focusing option 1. A new set of choices while the
   * menu is already open simply replaces it (the engine moved the conversation
   * on to a new question), so this both opens the menu and refreshes it.
   *
   * The live line gives the menu name and count only; the focused option 1
   * button carries its text (plus aria-posinset/aria-setsize), which the screen
   * reader reads once on focus. Announcing the option text here too would
   * double-speak it (screen-reader-focus R6.1), exactly as the inventory does.
   */
  openWith(options: ChoiceOption[]): void {
    if (options.length === 0) return;
    this.options = options;
    this.el.innerHTML = "";
    const total = options.length;
    this.buttons = options.map((opt, i) => {
      const b = this.el.ownerDocument.createElement("button");
      b.type = "button";
      b.setAttribute("role", "option");
      b.textContent = opt.text;
      // NVDA and JAWS announce "N of M" from these, so the position is read on
      // focus without a second live-region line (screen-reader-focus R6.3).
      b.setAttribute("aria-setsize", String(total));
      b.setAttribute("aria-posinset", String(i + 1));
      // aria-selected marks the currently-focused option (set in full by
      // focusCurrent below), so a listbox reader says "selected" for it.
      b.setAttribute("aria-selected", i === 0 ? "true" : "false");
      b.dataset.n = String(opt.n);
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener("click", () => this.chooseAt(i));
      this.el.appendChild(b);
      return b;
    });
    this.index = 0;
    this.open = true;
    this.el.hidden = false;
    this.focusCurrent();
    this.cb.announce(
      `Choices, ${total} option${total === 1 ? "" : "s"}.`,
    );
  }

  /** Move roving focus to the next option, wrapping. Silent in the live region:
   *  the focused button's text is what the screen reader reads (R6.2). */
  next(): void {
    if (!this.open) return;
    this.index = (this.index + 1) % this.buttons.length;
    this.focusCurrent();
  }

  /** Move roving focus to the previous option, wrapping (silent, R6.2). */
  prev(): void {
    if (!this.open) return;
    this.index = (this.index - 1 + this.buttons.length) % this.buttons.length;
    this.focusCurrent();
  }

  /** Choose the focused option (Enter). */
  chooseCurrent(): void {
    if (!this.open) return;
    this.chooseAt(this.index);
  }

  /**
   * Pick a choice directly by its 1-based position (a number key 1-9). Ignored
   * if the number is out of range for the current options, so pressing 7 on a
   * three-option menu does nothing rather than mis-firing.
   */
  chooseNumber(position: number): void {
    if (!this.open) return;
    if (position < 1 || position > this.options.length) return;
    this.chooseAt(position - 1);
  }

  /**
   * Repeat all the options as one coherent live-region line (R key). The engine
   * is waiting and the focused button already read option 1 on open, but after
   * moving around a player may want the whole list again; this composes it as a
   * single update ("1. … 2. … 3. …"), not a burst of separate announcements
   * (screen-reader-output: one key press, one update).
   */
  repeatAll(): void {
    if (!this.open) return;
    const line = this.options.map((o) => `${o.n}. ${o.text}`).join(" ");
    this.cb.announce(line);
  }

  /**
   * Escape does not close the menu: the engine is blocked waiting for a choice,
   * so there is nothing to cancel back to. Instead, re-state how to choose, as
   * one functional live-region line.
   */
  explainNoEscape(): void {
    if (!this.open) return;
    this.cb.announce("Pick an option with Up and Down, then Enter.");
  }

  /**
   * Close the menu without sending a choice. Called by the page when the engine
   * leaves the choice phase on its own (the conversation ended by another
   * path), never by the player directly. Silent — the engine's own next line is
   * the newest live-region line.
   */
  close(): void {
    this.open = false;
    this.el.hidden = true;
    this.el.innerHTML = "";
    this.buttons = [];
    this.options = [];
  }

  private chooseAt(i: number): void {
    const { n } = this.options[i];
    // Close before sending so focus returns to the game element and the
    // engine's reply (or the next question's menu) is the newest line.
    this.open = false;
    this.el.hidden = true;
    this.cb.choose(n);
    this.cb.returnToList();
  }

  private focusCurrent(): void {
    this.buttons.forEach((b, i) => {
      const selected = i === this.index;
      b.tabIndex = selected ? 0 : -1;
      // Keep aria-selected on the focused option only, so a listbox reader
      // reports exactly one selected option as roving focus moves.
      b.setAttribute("aria-selected", selected ? "true" : "false");
    });
    this.buttons[this.index]?.focus();
  }
}
