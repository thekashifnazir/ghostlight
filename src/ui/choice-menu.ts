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
// Choosing sends { verb: 'choose', n } for the chosen option's engine number.
// Crucially it does NOT return focus to the game element between picks: within
// one conversation the menu KEEPS focus and enters a WAITING state (aria-busy),
// so a screen reader does not bounce out to #game ("main, Ghostlight game, Inn
// bar, empty application") and back into the menu on every round, talking over
// the actors. The engine's next A11Y_CHOICES replaces the options in place and
// clears the waiting state; only when the conversation ENDS (the engine settles
// to the control phase, i.e. no further choices) does main.ts call close(),
// which returns focus to #game exactly once. The menu is never closed by the
// player directly.

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
  /** Return focus to the game element (only when the conversation ends). */
  returnToList: () => void;
}

export class ChoiceMenu {
  private readonly el: HTMLElement;
  private readonly cb: ChoiceMenuCallbacks;
  private buttons: HTMLButtonElement[] = [];
  private options: ChoiceOption[] = [];
  private index = 0;
  private open = false;
  /**
   * True after a pick is sent and before the next set of choices arrives (Fix
   * 1): the engine is processing the pick and may offer a follow-up question.
   * While waiting the listbox KEEPS focus (so the screen reader never bounces
   * to #game and back), the listbox carries aria-busy="true", and the pickable
   * keys (Up/Down/Enter/numbers) are ignored with no speech. R, H and L still
   * work (handled by the controller / repeatAll), and Escape is unchanged. The
   * next openWith() clears this; close() (conversation ended) resets it.
   */
  private waiting = false;

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

  /** True while a pick has been sent and the next choices have not yet arrived
   *  (Fix 1): the menu keeps focus, is aria-busy, and ignores the pick keys. */
  isWaiting(): boolean {
    return this.waiting;
  }

  /**
   * Open (or replace) the choice menu with a fresh set of options, building the
   * roving-focus buttons and focusing option 1. A new set of choices while the
   * menu is already open (or WAITING after a pick) replaces it in place (the
   * engine moved the conversation on to a new question): the options are
   * swapped, the waiting state and aria-busy are cleared, and focus moves to
   * option 1 — all without the menu ever losing focus to #game, so the screen
   * reader does not bounce out and back between rounds (Fix 1).
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
    // A fresh set of choices clears the post-pick waiting state and the busy
    // flag, so the options are pickable again (Fix 1).
    this.waiting = false;
    this.el.removeAttribute("aria-busy");
    this.el.hidden = false;
    this.focusCurrent();
    this.cb.announce(
      `Choices, ${total} option${total === 1 ? "" : "s"}.`,
    );
  }

  /** Move roving focus to the next option, wrapping. Silent in the live region:
   *  the focused button's text is what the screen reader reads (R6.2). Ignored
   *  silently while waiting for the engine's reply to a pick (Fix 1). */
  next(): void {
    if (!this.open || this.waiting) return;
    this.index = (this.index + 1) % this.buttons.length;
    this.focusCurrent();
  }

  /** Move roving focus to the previous option, wrapping (silent, R6.2).
   *  Ignored silently while waiting (Fix 1). */
  prev(): void {
    if (!this.open || this.waiting) return;
    this.index = (this.index - 1 + this.buttons.length) % this.buttons.length;
    this.focusCurrent();
  }

  /** Choose the focused option (Enter). Ignored silently while waiting for the
   *  engine's reply to the previous pick (Fix 1). */
  chooseCurrent(): void {
    if (!this.open || this.waiting) return;
    this.chooseAt(this.index);
  }

  /**
   * Pick a choice directly by its 1-based position (a number key 1-9). Ignored
   * if the number is out of range for the current options, so pressing 7 on a
   * three-option menu does nothing rather than mis-firing. Ignored silently
   * while waiting for the engine's reply to the previous pick (Fix 1).
   */
  chooseNumber(position: number): void {
    if (!this.open || this.waiting) return;
    if (position < 1 || position > this.options.length) return;
    this.chooseAt(position - 1);
  }

  /**
   * Repeat all the options as one coherent live-region line (R key), numbered
   * with clear pauses and each option terminated by a full stop, so a screen
   * reader reads them as distinct sentences rather than running them together:
   * "Choices, N options. 1. … 2. … 3. …". The engine is waiting and the focused
   * button already read option 1 on open, but after moving around a player may
   * want the whole list again; this composes it as a single update, not a burst
   * of separate announcements (screen-reader-output: one key press, one update).
   * Works while waiting too, so R still re-reads the list after a pick (Fix 1).
   */
  repeatAll(): void {
    if (!this.open) return;
    this.cb.announce(composeChoicesLine(this.options));
  }

  /**
   * Escape does not close the menu: the engine is blocked waiting for a choice,
   * so there is nothing to cancel back to. Instead, re-state how to choose, as
   * one functional live-region line. Unchanged while waiting for the engine's
   * reply to a pick (Fix 1): Escape still does exactly what it does today.
   */
  explainNoEscape(): void {
    if (!this.open) return;
    this.cb.announce("Pick an option with Up and Down, then Enter.");
  }

  /**
   * Close the menu and return focus to the game element exactly once (Fix 1).
   * Called by the page only when the conversation has ENDED — the engine has
   * settled to the control phase with no further choices — never between rounds
   * (a follow-up question replaces the options in place via openWith) and never
   * by the player directly. Returning focus here, rather than on every pick,
   * is what stops the screen reader bouncing to #game and back on each round.
   * Silent in the live region — the engine's own next line is the newest line.
   */
  close(): void {
    const wasOpen = this.open;
    this.open = false;
    this.waiting = false;
    this.el.hidden = true;
    this.el.removeAttribute("aria-busy");
    this.el.innerHTML = "";
    this.buttons = [];
    this.options = [];
    // Hand focus back to #game once the conversation is over, so focus never
    // stays trapped on a now-hidden listbox option (a hidden element must never
    // keep focus). Only when the menu actually was open, so a no-op close does
    // not steal focus.
    if (wasOpen) this.cb.returnToList();
  }

  /**
   * Record and send a pick, then enter the WAITING state (Fix 1): the menu
   * STAYS open and focused, the listbox is marked aria-busy, and the pick keys
   * are ignored until the engine answers. It does NOT return focus to #game —
   * that would bounce the screen reader out of the conversation after every
   * round. The engine's reply either offers the next question (openWith clears
   * the waiting state in place) or ends the conversation (the page calls
   * close(), which returns focus once).
   */
  private chooseAt(i: number): void {
    const { n } = this.options[i];
    this.waiting = true;
    // Mark the listbox busy so assistive tech knows the pick is being
    // processed; the options become non-pickable (guarded in next/prev/choose).
    this.el.setAttribute("aria-busy", "true");
    this.cb.choose(n);
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

/**
 * Give an option a terminal full stop if it has no ending punctuation (Fix 2),
 * so a screen reader reads it as a finished sentence and pauses before the next
 * number, instead of running the options together. The engine's own text is
 * kept verbatim otherwise — a question mark, exclamation mark or existing full
 * stop (optionally followed by a closing quote/paren) is left as is, and no
 * wording is invented.
 */
function endWithStop(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  // Already ends in sentence-final punctuation (possibly before a closing
  // quote or bracket): leave it alone.
  if (/[.!?…]["'”’)\]]*$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

/**
 * Compose the full read of the choices as one coherent line (Fix 2): the menu
 * name and count, then each option numbered by its engine number and ended with
 * a full stop, e.g.
 *   "Choices, 4 options. 1. Hi boss, how are you? 2. And how is the family? …"
 * The count line and the per-option full stops give a screen reader clear
 * sentence breaks so the options do not run together. Exported for the tests.
 */
export function composeChoicesLine(options: ChoiceOption[]): string {
  const total = options.length;
  const header = `Choices, ${total} option${total === 1 ? "" : "s"}.`;
  const items = options.map((o) => `${o.n}. ${endWithStop(o.text)}`).join(" ");
  return items.length > 0 ? `${header} ${items}` : header;
}
