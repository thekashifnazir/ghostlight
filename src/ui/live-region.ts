// The one live region (Requirement 9, 7.1).
//
// A single polite role=log region carries every functional line as text.
// announce(text) replaces the region's content so the newest line interrupts
// rather than queuing behind earlier lines (R9.3, gotcha 5). The last line is
// kept for the repeat key (R7.1). A visible transcript mirror is updated too,
// for a sighted co-player; it is aria-hidden so it is not double-read.

import type { Hotspot } from "../model/hotspot-list.js";

/** How many earlier lines Shift+R can step back through. */
const HISTORY_LIMIT = 20;

/** If no voiceEnd arrives this long after the last voiced start, release the hold. */
const VOICE_HOLD_TIMEOUT_MS = 15000;

/**
 * Silent cut payloads, built from U+034F COMBINING GRAPHEME JOINER (CGJ).
 * Chromium drops a live-region change whose text is only whitespace or format
 * (Unicode Cf) characters, so no-break and zero-width spaces never reach
 * VoiceOver there. CGJ is not dropped, and two of them stop VoiceOver while
 * it says nothing. Chromium also fires nothing when the text is the SAME as
 * last time, so the payloads differ in length (two, then three) and alternate.
 */
const SILENT_CUT_A = "\u034f\u034f"; // two combining grapheme joiners
const SILENT_CUT_B = "\u034f\u034f\u034f"; // three combining grapheme joiners

export class LiveRegion {
  private readonly region: HTMLElement;
  private readonly transcript: HTMLElement | undefined;
  private last = "";
  /**
   * Earlier announced lines, newest first, capped at HISTORY_LIMIT. The current
   * line (`last`) is NOT in here; these are the lines announced before it, the
   * ones Shift+R walks back through.
   */
  private history: string[] = [];
  /**
   * How many steps back Shift+R has walked: 0 means "at the current line", 1
   * means history[0], and so on. Reset to 0 on any new line or any other key.
   */
  private backCursor = 0;

  /**
   * Dialogue lines whose live-region WRITE is pending but not yet shown (speech
   * fix 2). announceDialogue does the history/last bookkeeping synchronously
   * (so R, Shift+R and lastLine are correct at once, and the text-vs-said de-dup
   * is unaffected), but DEFERS the actual region write so a focus move can drop
   * it. This holds only the lines not yet written to the region; a focus move
   * clears it via {@link dropPendingDialogue} so the focus line is next. Oldest
   * first. Non-dialogue lines (room reads, focus lines, hints, UI) use
   * {@link announce} and write to the region immediately.
   */
  private pendingDialogue: string[] = [];
  /** True while a dialogue flush is scheduled, so only one is in flight. */
  private flushScheduled = false;
  /** Schedules the next dialogue flush; injectable so tests can drive it. */
  private readonly schedule: (fn: () => void) => void;

  /**
   * Flips on every region write (Fix 3). A polite live region only re-reads
   * when its text actually CHANGES, so writing the same string twice (R pressed
   * twice on the same line) is silent the second time — the DOM did not change.
   * To make every write re-read, {@link setRegion} appends a trailing
   * zero-width marker whose presence alternates with this flag, so the region's
   * textContent is guaranteed to differ from its previous value even when the
   * visible text is identical. The marker is invisible (U+2060 WORD JOINER,
   * which carries no sound and no width) and is NEVER added to `last`, the
   * history, the transcript or the ?speechlog mirror — only to the live
   * region's own textContent — so repeat/step-back and the console mirror all
   * keep the clean text.
   */
  private writeToggle = false;

  /** The assertive region used only by {@link interrupt}. Optional. */
  private readonly interruptRegion: HTMLElement | undefined;
  /** Clock in ms; injectable so tests control time. */
  private readonly now: () => number;
  /** When the polite region was last written, and how long that line was. */
  private lastWriteAt = Number.NEGATIVE_INFINITY;
  private lastWriteChars = 0;
  /** Same repeat-marker toggle as writeToggle, for the assertive region. */
  private interruptToggle = false;

  /**
   * Voice timing. True from the moment an actor's recorded line starts until
   * its end is signalled (voiceEnd), a key press releases the hold, or the
   * safety timer fires. While true, announce() and announceDialogue() do all
   * their bookkeeping at once but HOLD the region write in `heldLines`.
   */
  private voicePlaying = false;
  /** Lines whose region write is held while a voice plays, oldest first. */
  private heldLines: string[] = [];
  /** Cancels the pending safety release, if any. */
  private cancelVoiceTimer: (() => void) | undefined;
  /**
   * True while a hold was started by {@link holdForReply} rather than by a
   * voice, so the command's diff can release it when no actor speaks.
   */
  private replyHold = false;
  /** The command a reply hold waits on (e.g. "look 201"), when known. */
  private replyFor: string | undefined;
  /** Starts the safety timer; returns a cancel function. Injectable for tests. */
  private readonly startVoiceTimer: (fn: () => void, ms: number) => () => void;

  /**
   * @param region the role=log element.
   * @param transcript optional visible mirror for sighted co-players.
   * @param schedule how to defer the next paced dialogue line; defaults to
   *   queueMicrotask so dialogue is paced out across microtasks (and a focus
   *   move landing between them can drop the rest). Injected in tests.
   * @param voiceTimer how to start the voice-hold safety timer; defaults to
   *   setTimeout. Injected in tests.
   */
  constructor(
    region: HTMLElement,
    transcript?: HTMLElement,
    schedule?: (fn: () => void) => void,
    interruptRegion?: HTMLElement,
    now?: () => number,
    voiceTimer?: (fn: () => void, ms: number) => () => void,
  ) {
    this.region = region;
    this.transcript = transcript;
    this.interruptRegion = interruptRegion;
    this.now = now ?? (() => Date.now());
    this.startVoiceTimer =
      voiceTimer ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
    this.schedule =
      schedule ??
      ((fn) =>
        typeof queueMicrotask === "function"
          ? queueMicrotask(fn)
          : void Promise.resolve().then(fn));
  }

  /**
   * An actor's recorded line has started. Hold region writes until it ends.
   * Restarts the safety timer, so the hold is released 15 s after the LAST
   * voiced start if no voiceEnd arrives.
   */
  voiceStart(): void {
    this.voicePlaying = true;
    // A voice took over any reply hold: only its end (or a key, or the safety
    // timer) releases now, never a diff or error that lands mid-line.
    this.replyHold = false;
    this.replyFor = undefined;
    this.cancelVoiceTimer?.();
    this.cancelVoiceTimer = this.startVoiceTimer(
      () => this.voiceEnd(),
      VOICE_HOLD_TIMEOUT_MS,
    );
  }

  /**
   * The actor's line ended (or the hold is being released by a key press or the
   * safety timer). Writes what was held: only the newest would be heard anyway,
   * so several held lines are written once, joined with a space in order.
   */
  voiceEnd(): void {
    this.cancelVoiceTimer?.();
    this.cancelVoiceTimer = undefined;
    this.voicePlaying = false;
    this.replyHold = false;
    this.replyFor = undefined;
    if (this.heldLines.length === 0) return;
    const joined = this.heldLines.join(" ");
    this.heldLines = [];
    this.setRegion(joined);
  }

  /**
   * Hold region writes until the engine has answered the command about to be
   * sent: the actor's line ending (voiceEnd) or, when nobody speaks, the
   * command's diff or error (releaseReplyHold). Examine uses it. It announces
   * the pack's description and then sends `look`, and the hero speaks his own
   * look line about 0.3 to 1 s later. Written at once, the description was
   * still being read when the voice started, and the voice hold began only
   * with the voice (a blind tester, 18 Nov). The same safety timer and key
   * release apply.
   *
   * `cmd` is the command being answered (e.g. "look 201"). Only that
   * command's diff releases the hold: pressing Down on a second thing while
   * the hero is still answering the first, the first look's diff and voice end
   * arrive after the hold began and must not write the description just
   * before the hero's next line (a blind tester, 20 Nov).
   */
  holdForReply(cmd?: string): void {
    this.voiceStart();
    this.replyHold = true;
    this.replyFor = cmd;
  }

  /**
   * The engine says a voiced clip ended (A11Y_VEND). While a reply hold still
   * waits for its command's answer, no voice has started since the hold, so
   * the clip that ended is an earlier line: keep holding. Otherwise this is
   * {@link voiceEnd}.
   */
  engineVoiceEnd(): void {
    if (this.replyHold) return;
    this.voiceEnd();
  }

  /**
   * A command's diff or error arrived. Release a {@link holdForReply} hold
   * that no voice took over, when `cmd` is the command it waits on (or either
   * is unknown, as for an error). A no-op when there is no reply hold (a voice
   * already ended it, or none was started).
   */
  releaseReplyHold(cmd?: string): void {
    if (!this.replyHold) return;
    if (cmd !== undefined && this.replyFor !== undefined && cmd !== this.replyFor) return;
    this.voiceEnd();
  }

  /** True while region writes are being held for a playing voice. */
  isVoicePlaying(): boolean {
    return this.voicePlaying;
  }

  /** Write a line to the region now, or hold it while a voice plays. */
  private writeOrHold(line: string): void {
    if (this.voicePlaying) {
      if (line) this.heldLines.push(line);
      return;
    }
    this.setRegion(line);
  }

  /**
   * Write one functional line. Replaces the region's content (interrupt, not
   * append) and remembers it as the last line for repeat.
   */
  announce(text: string): void {
    const line = text.trim();
    // Push the line being replaced onto the history (newest first), capped, so
    // Shift+R can walk back through the recent lines. The very first line has
    // no predecessor to record. A new line resets the back-step cursor.
    if (this.last) {
      this.history.unshift(this.last);
      if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    }
    this.backCursor = 0;
    this.last = line;
    // Replacing textContent is what makes a polite region re-announce the new
    // line rather than appending and reading the whole history. setRegion
    // guarantees the DOM actually changes even when `line` equals what the
    // region already holds, so a repeat is never silently dropped (Fix 3).
    // While an actor's voice plays the write is held (see voiceStart).
    this.writeOrHold(line);
    if (this.transcript) {
      const p = this.transcript.ownerDocument.createElement("p");
      p.textContent = line;
      this.transcript.appendChild(p);
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }
  }

  /**
   * Record a line in the history and as the last line WITHOUT announcing it to
   * the live region (speech fix 1). Used for a voiced line the player chose not
   * to have the screen reader read: the game is speaking it aloud, so it must
   * NOT reach the live region, but R (repeat) must still be able to read the
   * last one and Shift+R must still walk back through it, and the transcript
   * mirror still shows it for a sighted co-player. Keeps the same history
   * bookkeeping as {@link announce} but never touches the region's textContent.
   */
  record(text: string): void {
    const line = text.trim();
    if (!line) return;
    if (this.last) {
      this.history.unshift(this.last);
      if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    }
    this.backCursor = 0;
    this.last = line;
    if (this.transcript) {
      const p = this.transcript.ownerDocument.createElement("p");
      p.textContent = line;
      this.transcript.appendChild(p);
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }
  }

  /**
   * Announce a dialogue / character line through the paced queue (speech fix 2).
   * Each dialogue line is flushed one per scheduler tick. A focus move
   * (Left/Right) calls {@link dropPendingDialogue} to discard whatever is still
   * queued, so the focus announcement — a normal {@link announce} — is the next
   * thing heard rather than being buried behind a backlog of unread dialogue.
   */
  /**
   * Announce a dialogue / character line (speech fix 2). The history / last-line
   * bookkeeping (for R, Shift+R, lastLine and the transcript) happens
   * synchronously — exactly as {@link announce} does — so repeat, step-back and
   * the narrator's text-vs-said de-dup all see the line at once. Only the actual
   * live-region WRITE is deferred to a scheduler tick, so a focus move
   * (Left/Right) can {@link dropPendingDialogue} the writes not yet shown and
   * make the focus line the next thing the screen reader reads.
   */
  announceDialogue(text: string): void {
    const line = text.trim();
    if (!line) return;
    // Synchronous bookkeeping: push the previous line into history, make this
    // the last line, reset the back cursor, and mirror to the transcript. This
    // is the same bookkeeping announce() does, minus the region write.
    if (this.last) {
      this.history.unshift(this.last);
      if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    }
    this.backCursor = 0;
    this.last = line;
    if (this.transcript) {
      const p = this.transcript.ownerDocument.createElement("p");
      p.textContent = line;
      this.transcript.appendChild(p);
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }
    // Write the region now. A deferred write (an earlier version) landed AFTER
    // a following synchronous line such as "Chapter 2: ..." and overwrote it,
    // so dialogue is written immediately; with voiced lines off by default the
    // backlog a focus move used to hear is mostly gone. dropPendingDialogue()
    // stays as the hook for any queued writes. setRegion guarantees a DOM change
    // even when two consecutive dialogue lines are identical (Fix 3). Held
    // while an actor's voice plays (see voiceStart).
    this.writeOrHold(line);
  }

  /**
   * Drop every dialogue line whose region write is still pending (speech fix 2).
   * Called on a focus move so stale character/dialogue lines are not read after
   * the new focus line. History / last-line are untouched (those were recorded
   * synchronously), so R can still repeat the most recent dialogue line; only
   * the not-yet-shown region writes are discarded.
   */
  dropPendingDialogue(): void {
    this.pendingDialogue = [];
  }

  /** Schedule one dialogue flush if none is already pending. */
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.schedule(() => this.flushDialogue());
  }

  /** Write the oldest pending dialogue line to the region, then reschedule. */
  private flushDialogue(): void {
    this.flushScheduled = false;
    const next = this.pendingDialogue.shift();
    if (next === undefined) return;
    // Write only the region (bookkeeping already happened in announceDialogue).
    this.setRegion(next);
    if (this.pendingDialogue.length > 0) this.scheduleFlush();
  }

  /** Re-announce the most recent line (the repeat key, R). Resets the back
   *  cursor so a following Shift+R starts from the most recent earlier line. */
  repeat(): void {
    this.backCursor = 0;
    if (this.last) {
      // setRegion guarantees the DOM changes even when the region already holds
      // this exact line, so pressing R twice is read twice rather than the
      // second press being silently dropped (Fix 3).
      this.setRegion(this.last);
    }
  }

  /**
   * Step one line further back through the announced history (Shift+R),
   * announcing it prefixed with "Earlier: " so the player knows it is a recall,
   * not a new event. Walks back up to HISTORY_LIMIT lines; once at the oldest
   * remembered line, further Shift+R re-announces that oldest line rather than
   * going silent. Does not disturb `last` (R still repeats the real last line)
   * and does not add the recalled line to the history. A no-op with no history.
   */
  stepBack(): void {
    if (this.history.length === 0) return;
    if (this.backCursor < this.history.length) this.backCursor += 1;
    const line = this.history[this.backCursor - 1];
    const recall = `Earlier: ${line}`;
    // setRegion guarantees a DOM change even when repeated Shift+R lands on the
    // same oldest line, so it is re-read rather than going silent (Fix 3).
    this.setRegion(recall);
    if (this.transcript) {
      const p = this.transcript.ownerDocument.createElement("p");
      p.textContent = recall;
      this.transcript.appendChild(p);
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }
  }

  /** Reset the Shift+R back-step cursor (called when any other key is pressed
   *  so the next Shift+R starts again from the most recent earlier line). */
  resetHistoryCursor(): void {
    this.backCursor = 0;
  }

  /**
   * Write `text` to the live region so a polite screen reader always re-reads
   * it, even when it equals what the region already holds (Fix 3). A polite
   * region only speaks on an actual text change, so writing the same string
   * twice (two R presses on one line, or two identical dialogue lines) is
   * silent the second time. To force a change, a single trailing zero-width
   * WORD JOINER (U+2060) is toggled on/off ONLY when the new visible text
   * equals what the region currently shows: the textContent then differs from
   * its previous value on every such write while the visible, spoken text is
   * unchanged (the WORD JOINER has no width and no sound). A genuinely new line
   * is written clean, so distinct announcements never carry the marker. The
   * marker lives ONLY in the region's own textContent — never in `last`, the
   * history, the transcript or the ?speechlog mirror, which all keep the clean
   * text — so repeat, step-back and the console mirror are unaffected.
   */
  private setRegion(text: string): void {
    // Remember when and how long, so interrupt() can guess whether the screen
    // reader is probably still reading this line.
    this.lastWriteAt = this.now();
    this.lastWriteChars = text.length;
    const current = this.region.textContent ?? "";
    // Strip any marker we previously added, to compare the visible text only.
    const visible = current.replace(/\u2060$/, "");
    if (visible === text) {
      // Same visible line again: flip the invisible marker so the DOM changes
      // and the polite region re-reads it (Fix 3).
      this.writeToggle = !this.writeToggle;
      this.region.textContent = this.writeToggle ? `${text}\u2060` : text;
    } else {
      // A new line: write it clean and reset the toggle.
      this.writeToggle = false;
      this.region.textContent = text;
    }
  }

  /**
   * Cut off a screen reader that is probably still reading the last polite
   * line, silently, by changing the assertive region's content.
   *
   * Measured on VoiceOver + Safari with recorded audio (2 rounds each): clearing
   * the polite region, aria-busy, display:none, removing it, or a no-break space
   * in the polite region NEVER stops VoiceOver. Only a change to an
   * aria-live="assertive" region does. A real word ("Picked.") stops it in
   * about 420 ms but is spoken. A SINGLE invisible character is read out by
   * name ("space", "zero width space"). Two invisible characters stopped
   * VoiceOver in Safari, but Chromium (Chrome, Edge) DROPS a live-region change
   * made only of whitespace or format (Cf) characters, so spaces and zero-width
   * spaces did nothing there. Two U+034F combining grapheme joiners reach
   * VoiceOver: it stopped within about 375 ms in Chrome and 250 ms in Safari
   * and spoke nothing. Chromium also ignores a write of the same text as the
   * previous one, so the default write alternates two joiners and three
   * joiners (5 of 5 stops in Chrome, 375-381 ms). Toggling aria-live off and on
   * breaks a live region in Safari (it never announces again), so aria-live is
   * never touched.
   *
   * Writes only if the last polite write was less than (its characters x 65 ms,
   * capped at 15000 ms) ago; otherwise does nothing and returns false. The
   * polite region, `last`, the history and the transcript are left alone, so R
   * still repeats the real last line and the silent cut is never recorded as a
   * spoken line. `word` is optional (tests or future use); when given it is
   * written as a spoken word with the U+2060 repeat marker. The caller taps
   * this to log "[cut]" under ?speechlog (see main.ts).
   */
  interrupt(word?: string): boolean {
    if (!this.interruptRegion) return false;
    const budgetMs = Math.min(this.lastWriteChars * 65, 15000);
    if (!(this.now() - this.lastWriteAt < budgetMs)) return false;
    if (word === undefined) {
      this.interruptToggle = !this.interruptToggle;
      this.interruptRegion.textContent = this.interruptToggle ? SILENT_CUT_A : SILENT_CUT_B;
      return true;
    }
    const current = (this.interruptRegion.textContent ?? "").replace(/\u2060$/, "");
    if (current === word) {
      this.interruptToggle = !this.interruptToggle;
      this.interruptRegion.textContent = this.interruptToggle ? `${word}\u2060` : word;
    } else {
      this.interruptToggle = false;
      this.interruptRegion.textContent = word;
    }
    return true;
  }

  /** The last announced line, for tests and recaps. */
  lastLine(): string {
    return this.last;
  }

  /** Compose the "name, N of M" focus line (R2.4). */
  static focusLine(name: string, index: number, total: number): string {
    return `${name}, ${index + 1} of ${total}`;
  }

  /**
   * Compose the room-entry announcement (R8.1): name, short description, then
   * the things and people, then the exits. Undefined name/short fall back so
   * the room is still announced (R8.2).
   */
  static roomAnnouncement(args: {
    name: string | undefined;
    short: string | undefined;
    hotspots: Hotspot[];
    /** The "worth a look" line, spoken straight after the name. */
    nudge?: string;
  }): string {
    const { name, short, hotspots, nudge } = args;
    const parts: string[] = [];

    const title = name && name.length > 0 ? name : "A room";
    if (nudge && nudge.length > 0) {
      parts.push(/[.!?]$/.test(title) ? title : `${title}.`);
      parts.push(nudge);
    } else {
      parts.push(title);
    }
    if (short && short.length > 0) parts.push(short);

    const things = hotspots.filter((h) => h.kind !== "exit").map((h) => h.name);
    const exits = hotspots.filter((h) => h.kind === "exit").map((h) => h.name);

    if (things.length > 0) {
      parts.push(`Here: ${list(things)}.`);
    } else {
      parts.push("Nothing here to use.");
    }

    if (exits.length > 0) {
      parts.push(`Exits: ${list(exits)}.`);
    } else {
      parts.push("No obvious way out.");
    }

    return parts.join(" ");
  }
}

/** Join names as a readable list: "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
