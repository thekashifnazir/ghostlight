// The conversation choice menu (A11Y_CHOICES).
//
// When a conversation offers choices (the engine emits A11Y_CHOICES and the
// phase becomes 'choice'), the engine is WAITING for the player to pick one.
// Before this menu existed there was no keyboard way to pick: the controller
// had no choice handling, so a blind player talking to the drunk in the tavern
// was stuck. This menu is the keyboard way in.
//
// This menu NEVER moves DOM focus. An earlier build used a role=listbox with
// roving-focus role=option buttons, and that is what we had to abandon. Under
// VoiceOver with DEFAULT settings (scripted on Safari and Chrome, 9 Nov, a
// probe page), every time DOM focus moved to a new role=option button VoiceOver
// spoke its own hint a moment later, "You are currently on a selectable list
// item, inside a list box." It talked over the game's actors after every arrow
// press, and aria-activedescendant on the listbox gave the same hint. When DOM
// focus instead STAYS on the game element (#game, role=application) and each
// option is spoken through the ARIA live region, VoiceOver speaks NO hint on
// any move. That is already how the room list works (Left/Right speak
// "bin, 2 of 10" through the live region with focus on #game), and that path is
// proven on NVDA too. So the reply menu follows the same path: focus stays on
// the game element and every option the player hears comes from the live
// region, never from a focused widget.
//
// The visual list of buttons stays for sighted players and mouse clicks, but it
// is hidden from assistive tech: the container is aria-hidden="true", the
// buttons are tabIndex -1, and it carries no role=listbox/option or "Replies"
// name, so VoiceOver and NVDA never land on it and nothing is ever read twice.
// The current option is shown visually with a CSS class on its button; that
// class has no assistive-tech meaning (the container is aria-hidden).
//
// The open line reads the prompt, the count, and the first option as one line:
// "Pick a reply, N options. Option 1: <text>" (with ", already asked" after the
// option number when that option was already asked earlier). Each move then
// announces "Option <n> of <N>: <text>" through the same live region. Nothing
// is spoken from the DOM, so there is no double-speak to avoid.
//
// Two rules differ from the verb menu and the inventory, because here the
// engine is BLOCKED waiting for a choice:
//   - Escape does NOT close the menu. There is nothing to cancel back to (the
//     engine will not move until a choice is sent), so Escape instead re-states
//     how to choose ("Pick an option with Up and Down, then Enter.").
//   - Number keys 1-9 pick a choice directly (the choices are numbered 1..N in
//     the engine), and R repeats all the options as one line.
//
// Choosing sends { verb: 'choose', n } for the chosen option's engine number
// and enters a WAITING state so the pick keys are ignored until the engine
// answers. Because focus never leaves the game element, there is no bounce to
// guard against between picks: the engine's next A11Y_CHOICES replaces the
// options in place and clears the waiting state; only when the conversation
// ENDS (the engine settles to the control phase, i.e. no further choices) does
// main.ts call close(). The menu is never closed by the player directly.
//
// Same-set rule. After a pick the engine often re-offers the SAME question with
// the SAME options (only the "used" markers change) while it processes the hero
// and NPC lines. When openWith() is called with options whose count and whose
// n+text match the current ones in the same order, the menu updates IN PLACE:
// the buttons are NOT rebuilt, the current index is kept, the waiting state is
// cleared, the used markers are refreshed, and NOTHING is announced. This stops
// the menu sounding like it "restarts to the top option every time" and stops
// the open line talking over the actors. Any OTHER case (a different count, or
// different n+text, i.e. a genuinely new question) rebuilds the buttons, resets
// to option 1, and announces the open line.

export interface ChoiceOption {
  /** The engine's choice number (1-based; what `choose n` sends). */
  n: number;
  /** The spoken text of the option. */
  text: string;
  /**
   * Already picked earlier in this conversation (the engine's A11Y_CHOICES
   * "used": true). A used option keeps its engine text verbatim; the spoken
   * lines (the open line, the per-move line, and the R re-read) add ", already
   * asked" after the option number, so the player hears the question was asked
   * before without the engine text being changed. The visual button also gains
   * a ", already asked" marker, but that lives in the aria-hidden container and
   * is for the visual DOM only.
   */
  used?: boolean;
}

export interface ChoiceMenuCallbacks {
  /** Announce a line to the live region. */
  announce: (text: string) => void;
  /** Send the chosen option's engine number (sends { verb: 'choose', n }). */
  choose: (n: number) => void;
  /** Return focus to the game element. A no-op guard in close() means this is
   *  only called when focus is NOT already on the game element, which under the
   *  focus-stays-put design is the normal case. */
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
   * True after a pick is sent and before the next set of choices arrives: the
   * engine is processing the pick and may offer a follow-up question. While
   * waiting the pickable keys (Up/Down/Enter/numbers) are ignored with no
   * speech, so a second pick cannot be sent before the engine answers. R, H and
   * L still work (handled by the controller / repeatAll), and Escape is
   * unchanged. The next openWith() clears this; close() (conversation ended)
   * resets it. Focus does not move on a pick (it never left the game element),
   * so there is nothing to restore here.
   */
  private waiting = false;

  constructor(el: HTMLElement, cb: ChoiceMenuCallbacks) {
    this.el = el;
    this.cb = cb;
    // The container is hidden from assistive tech: VoiceOver and NVDA must
    // never land on it, because a focused option is exactly what made VoiceOver
    // speak its "selectable list item" hint over the actors. The visual buttons
    // stay for sighted players and mouse clicks; everything a screen reader
    // needs comes from the live region instead. No role=listbox/option or
    // "Replies" name, since it is no longer an assistive-tech widget.
    this.el.setAttribute("aria-hidden", "true");
    this.el.hidden = true;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** True while a pick has been sent and the next choices have not yet arrived:
   *  the menu ignores the pick keys. Focus never moved, so there is no bounce. */
  isWaiting(): boolean {
    return this.waiting;
  }

  /**
   * Open (or replace) the choice menu with a fresh set of options.
   *
   * Same-set rule (see the header): when the menu is already open (waiting or
   * not) and the new options have the SAME count and the SAME n+text in the
   * SAME order as the current ones, this is the engine re-offering the same
   * question (only "used" markers may have changed). The menu updates IN PLACE:
   * the buttons are not rebuilt, the current index is kept, the waiting state is
   * cleared, the used markers are refreshed, and nothing is announced. This is
   * what stops the menu sounding like it restarts to the top option on every
   * round, and stops the open line talking over the actors.
   *
   * Any other case (first open, a different count, or different n+text, i.e. a
   * genuinely new question) builds the visual buttons fresh, resets to option
   * 1, and announces the open line: the prompt, the count, and the first
   * option, e.g. "Pick a reply, 3 options. Option 1: HI BOSS, HOW ARE YOU?".
   * Because focus stays on the game element, the first option is read from the
   * live region, not from a focused widget, so there is no double-speak.
   */
  openWith(options: ChoiceOption[]): void {
    if (options.length === 0) return;

    // Same-set: the engine re-offered the same question (same count, same
    // n+text, same order). Update in place without rebuilding.
    if (this.open && this.isSameSet(options)) {
      this.options = options;
      this.waiting = false;
      this.el.removeAttribute("aria-busy");
      options.forEach((opt, i) => this.setUsedMarker(this.buttons[i], opt.used));
      this.highlightCurrent();
      return;
    }

    this.options = options;
    this.el.innerHTML = "";
    const total = options.length;
    this.buttons = options.map((opt, i) => {
      const b = this.el.ownerDocument.createElement("button");
      b.type = "button";
      // No role=option: the container is aria-hidden, so these are visual-only
      // buttons for sighted players and mouse clicks, never an AT widget.
      b.textContent = opt.text;
      // A used option gains a visually hidden ", already asked" marker; it is
      // inside an aria-hidden container, so it is kept only for the visual DOM
      // and mirrored by the spoken "already asked" in the live region.
      this.setUsedMarker(b, opt.used);
      // Never tab-focusable: focus must stay on the game element so VoiceOver
      // does not speak its "selectable list item" hint over the actors.
      b.tabIndex = -1;
      b.dataset.n = String(opt.n);
      b.addEventListener("click", () => this.chooseAt(i));
      this.el.appendChild(b);
      return b;
    });
    this.index = 0;
    this.open = true;
    // A fresh set of choices clears the post-pick waiting state so the options
    // are pickable again.
    this.waiting = false;
    this.el.removeAttribute("aria-busy");
    this.el.hidden = false;
    this.highlightCurrent();
    this.cb.announce(
      `Pick a reply, ${total} option${total === 1 ? "" : "s"}. ${this.optionLine(0)}`,
    );
  }

  /**
   * True when `options` is the SAME set as the current one: same count, and the
   * same n+text in the same order. "used" is deliberately NOT compared, because
   * a same-set re-offer is exactly the case where only the used markers change.
   */
  private isSameSet(options: ChoiceOption[]): boolean {
    if (options.length !== this.options.length) return false;
    return options.every(
      (opt, i) =>
        opt.n === this.options[i].n && opt.text === this.options[i].text,
    );
  }

  /**
   * Set or clear a button's visually hidden ", already asked" marker. The
   * marker is a .visually-hidden span appended after the engine's own option
   * text. The whole menu is aria-hidden, so this marker is not itself read by a
   * screen reader; the spoken "already asked" comes from the live region. The
   * marker is kept for parity with the visual DOM and for tests. Idempotent:
   * called on build and on every same-set refresh.
   */
  private setUsedMarker(button: HTMLButtonElement | undefined, used?: boolean): void {
    if (!button) return;
    const existing = button.querySelector(".visually-hidden");
    if (used) {
      if (existing) return;
      const span = button.ownerDocument.createElement("span");
      span.className = "visually-hidden";
      span.textContent = ", already asked";
      button.appendChild(span);
    } else if (existing) {
      existing.remove();
    }
  }

  /** Move to the next option, wrapping, and announce it as one live-region line
   *  ("Option <n> of <N>: <text>"). Focus does not move: the option is spoken
   *  through the live region with focus staying on the game element. Ignored
   *  silently while waiting for the engine's reply to a pick. */
  next(): void {
    if (!this.open || this.waiting) return;
    this.index = (this.index + 1) % this.buttons.length;
    this.highlightCurrent();
    this.cb.announce(this.moveLine());
  }

  /** Move to the previous option, wrapping, and announce it as one live-region
   *  line. Focus does not move. Ignored silently while waiting. */
  prev(): void {
    if (!this.open || this.waiting) return;
    this.index = (this.index - 1 + this.buttons.length) % this.buttons.length;
    this.highlightCurrent();
    this.cb.announce(this.moveLine());
  }

  /** Choose the current option (Enter). Ignored silently while waiting for the
   *  engine's reply to the previous pick. */
  chooseCurrent(): void {
    if (!this.open || this.waiting) return;
    this.chooseAt(this.index);
  }

  /**
   * Pick a choice directly by its 1-based position (a number key 1-9). Ignored
   * if the number is out of range for the current options, so pressing 7 on a
   * three-option menu does nothing rather than mis-firing. Ignored silently
   * while waiting for the engine's reply to the previous pick.
   */
  chooseNumber(position: number): void {
    if (!this.open || this.waiting) return;
    if (position < 1 || position > this.options.length) return;
    this.chooseAt(position - 1);
  }

  /**
   * Repeat all the options as one coherent live-region line (R key), each
   * prefixed by "Option <n>:" and terminated by sentence-final punctuation, so a
   * screen reader reads them as distinct sentences rather than running them
   * together (the bare trailing "2." form read as a sentence end and glued the
   * next number onto the previous option under VoiceOver):
   * "Pick a reply, N options. Option 1: … Option 2: … Option 3: …". After moving
   * around a player may want the whole list again; this composes it as a single
   * update, not a burst of separate announcements (screen-reader-output: one
   * key press, one update). Works while waiting too, so R still re-reads the
   * list after a pick.
   */
  repeatAll(): void {
    if (!this.open) return;
    this.cb.announce(composeChoicesLine(this.options));
  }

  /**
   * Escape does not close the menu: the engine is blocked waiting for a choice,
   * so there is nothing to cancel back to. Instead, re-state how to choose, as
   * one functional live-region line. Unchanged while waiting for the engine's
   * reply to a pick: Escape still does exactly what it does today.
   */
  explainNoEscape(): void {
    if (!this.open) return;
    this.cb.announce("Pick an option with Up and Down, then Enter.");
  }

  /**
   * Close the menu, called by the page only when the conversation has ENDED
   * (the engine has settled to the control phase with no further choices),
   * never between rounds (a follow-up question replaces the options in place
   * via openWith) and never by the player directly. Silent in the live region:
   * the engine's own next line is the newest line.
   *
   * Focus never left the game element while the menu was open (every option was
   * spoken through the live region, not a focused widget), so close() does not
   * need to move focus. It calls returnToList only as a guarded safety net, and
   * only if focus somehow is NOT already on the game element: returnToList()
   * itself re-focuses #game, so a no-op when focus is already there avoids a
   * needless focus() call that could disturb a line being read.
   */
  close(): void {
    this.open = false;
    this.waiting = false;
    this.el.hidden = true;
    this.el.removeAttribute("aria-busy");
    this.el.innerHTML = "";
    this.buttons = [];
    this.options = [];
    // Focus should already be on the game element (it never moved). Only call
    // returnToList as a fallback if something else holds focus, so a hidden
    // button can never keep it.
    const active = this.el.ownerDocument.activeElement;
    const game = this.el.ownerDocument.getElementById("game");
    if (active !== game) this.cb.returnToList();
  }

  /**
   * Record and send a pick, then enter the WAITING state: the menu STAYS open
   * and the pick keys are ignored until the engine answers. Focus does not move
   * (it never left the game element), so there is no bounce to guard against.
   * The engine's reply either offers the next question (openWith clears the
   * waiting state in place) or ends the conversation (the page calls close()).
   */
  private chooseAt(i: number): void {
    const { n } = this.options[i];
    this.waiting = true;
    // Mark the container busy as a state signal (used by the live linger spec
    // and any watchdog). The container is aria-hidden, so this never reaches a
    // screen reader; it is not relied on for any spoken behaviour. The pick
    // keys become non-pickable (guarded in next/prev/choose by `waiting`).
    this.el.setAttribute("aria-busy", "true");
    this.cb.choose(n);
  }

  /** Mark the current option visually (a CSS class), with no assistive-tech
   *  effect: the container is aria-hidden, so this is sighted-only feedback and
   *  never reaches a screen reader. */
  private highlightCurrent(): void {
    this.buttons.forEach((b, i) => {
      b.classList.toggle("current", i === this.index);
    });
  }

  /** The spoken line for the current option on a move: "Option <n> of <N>:
   *  <text>" (with ", already asked" after the number when used). */
  private moveLine(): string {
    const total = this.options.length;
    const opt = this.options[this.index];
    const label = opt.used
      ? `Option ${opt.n} of ${total}, already asked:`
      : `Option ${opt.n} of ${total}:`;
    return `${label} ${endWithStop(opt.text)}`;
  }

  /** The spoken fragment for one option on open: "Option <n>: <text>" (with
   *  ", already asked" after the number when used), matching composeChoicesLine
   *  so the open line and the R re-read read the same way. */
  private optionLine(i: number): string {
    const opt = this.options[i];
    const label = opt.used ? `Option ${opt.n}, already asked:` : `Option ${opt.n}:`;
    return `${label} ${endWithStop(opt.text)}`;
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
 * Compose the full read of the options as one coherent line (Fix 2): a short
 * prompt and the count, then each option labelled "Option <n>:" (its engine
 * number) and ended with a full stop, e.g.
 *   "Pick a reply, 4 options. Option 1: Hi boss, how are you? Option 2: And how is the family? …"
 * An option already asked earlier in this conversation ("used") reads as
 * "Option <n>, already asked: <text>", so the R key tells the player which
 * questions they have already put. Labelling each option "Option N:" rather
 * than a bare "N." keeps the number at the START of its own option, so
 * VoiceOver can no longer read a trailing "2." as a sentence end and glue the
 * next number onto the previous option. The count line and the per-option full
 * stops give clear sentence breaks so the options do not run together. Exported
 * for the tests.
 */
export function composeChoicesLine(options: ChoiceOption[]): string {
  const total = options.length;
  const header = `Pick a reply, ${total} option${total === 1 ? "" : "s"}.`;
  const items = options
    .map((o) => {
      const label = o.used ? `Option ${o.n}, already asked:` : `Option ${o.n}:`;
      return `${label} ${endWithStop(o.text)}`;
    })
    .join(" ");
  return items.length > 0 ? `${header} ${items}` : header;
}
