// Narration routing for the live region (web-player R3.4, R9.2).
//
// One place that decides WHAT reaches the live region from the engine's text
// and diff streams, so the live-engine run and the replay run narrate the same
// way. main.ts owns the model and UI; the Narrator owns three cross-cutting
// narration rules that the Crew survey of the live engine turned up:
//
//  1. Hover/name labels never reach the live region. The engine draws its own
//     name for whatever is under the (warped) cursor through centerText(),
//     which reaches the player as A11Y_TEXT events — never as the diff's
//     `said` — so the diff-path filter (suppressGenericLook) never sees them.
//     The Narrator drops a hover-name label ("BARTENDER", the hero's "hacker")
//     on EVERY text line: the list already names the focused thing, so a hover
//     echo is never functional text. During an examine it additionally drops
//     the generic "can't see anything in particular" reply, since examine has
//     already announced the pack's authored description.
//  2. "Nothing happened." is wrong after a look. A look that changes no state
//     is the normal case; examine already announced the pack description or the
//     engine's own look text, so the Narrator never says it for a look diff.
//  3. A line the engine reports twice — once as an A11Y_TEXT event when it is
//     drawn, then again in the following diff's `said` (engine/a11y.cpp onText
//     appends every drawn line to both streams) — must be announced once. The
//     Narrator remembers the last line it announced and drops a `said` repeat.

import type { Diff } from "../engine/adapter.js";
import type { Hotspot } from "../model/hotspot-list.js";
import {
  isExamineNoiseLine,
  isHoverNameLine,
  labelKey,
  suppressGenericLook,
} from "./controller.js";

/** The minimal live-region surface the Narrator writes to. */
export interface NarratorLive {
  announce(text: string): void;
  /**
   * Announce a dialogue/character line through the paced queue, so a focus move
   * can drop it if it has not been read yet (speech fix 2). Optional so the
   * many controller unit harnesses that stub a bare { announce } still satisfy
   * the type; when absent the Narrator falls back to announce().
   */
  announceDialogue?(text: string): void;
  /**
   * Record a line in the history/last WITHOUT announcing it to the region, for
   * a suppressed voiced line (speech fix 1). Optional for the same reason;
   * when absent a suppressed voiced line is simply dropped from history too.
   */
  record?(text: string): void;
  /**
   * An actor's recorded line has started: hold region writes until it ends
   * (voice timing). Optional so bare test stubs still satisfy the type.
   */
  voiceStart?(): void;
}

/** Options wiring the Narrator to the voiced-lines setting (speech fix 1). */
export interface NarratorOptions {
  /** Whether the screen reader should read voiced lines (default: off). */
  readVoiced?: () => boolean;
  /**
   * Called with a voiced line the Narrator suppressed from the live region, so
   * the caller can mirror it to ?speechlog as "[voiced] <text>" and record it
   * in the status log. The history is handled by NarratorLive.record().
   */
  onVoicedSuppressed?: (text: string) => void;
}

export class Narrator {
  private readonly live: NarratorLive;
  /** True from the moment a look is issued until that look's diff arrives. */
  private examining = false;
  /** The last line announced, for de-duplicating a text event vs a diff said. */
  private lastAnnounced: string | undefined;
  /** Normalised hover-name labels for the current room (pack + engine names). */
  private roomLabels = new Set<string>();
  /**
   * Whether the command currently in flight has produced anything the player
   * heard beyond its own `changed:false` settle diff: a choice menu
   * (A11Y_CHOICES), a spoken dialogue/narration line (an announced A11Y_TEXT),
   * or a phase change to 'choice'. Set by choices()/text()/onPhase() and reset
   * by beginCommand() when a new command is sent. When any of these is true the
   * settle diff must NOT say "Nothing happened." — the command plainly did
   * something, and in the single-line live region "Nothing happened." would
   * clobber the choice or dialogue line the player actually needs (the drunk
   * `talk 53` bug: the choice menu opened, then "Nothing happened." replaced it).
   */
  private producedChoices = false;
  private producedDialogue = false;
  private enteredChoicePhase = false;
  /**
   * The dialogue/narration lines (trimmed) streamed live through text() during
   * the command currently in flight, oldest first. Reset by beginCommand() when
   * a new command is sent.
   *
   * This is the memory the text-vs-said de-dup needs that `lastAnnounced` alone
   * cannot provide: a talk streams its whole conversation line by line as the
   * engine says each one (A11Y_TEXT), and then the settling A11Y_DIFF carries
   * the WHOLE conversation again in its `said` array. `lastAnnounced` only
   * remembers the single most recent line, so it drops the last repeat but
   * re-announces the other N−1 in one burst — which NVDA reads as a jumble, and
   * which floods R (repeat) and Shift+R (history) with the whole conversation.
   * By recording every streamed line here, said() can skip each `said` line
   * that was already streamed (matched by text, in order) and announce only the
   * lines that were NOT streamed (the non-streamed and chapter-crossing paths),
   * so each conversation line reaches the live region — and the history —
   * exactly once.
   */
  private streamedThisCommand: string[] = [];

  /** Whether the screen reader should read voiced lines (speech fix 1). */
  private readonly readVoiced: () => boolean;
  /** Mirror/record hook for a suppressed voiced line (speech fix 1). */
  private readonly onVoicedSuppressed: (text: string) => void;

  constructor(live: NarratorLive, options: NarratorOptions = {}) {
    this.live = live;
    this.readVoiced = options.readVoiced ?? (() => false);
    this.onVoicedSuppressed = options.onVoicedSuppressed ?? (() => {});
  }

  /**
   * Refresh the room's hover-name labels: the pack's spoken names (from the
   * hotspot list) and the engine's raw object names. Called on every room or
   * same-room list change so an examine's hover echo is recognised wherever the
   * player is.
   */
  setRoomLabels(hotspots: readonly Hotspot[], engineNames: readonly string[]): void {
    const labels = new Set<string>();
    for (const h of hotspots) labels.add(labelKey(h.name));
    for (const name of engineNames) labels.add(labelKey(name));
    this.roomLabels = labels;
  }

  /**
   * Announce a line the player composes itself (room reading, hints, inventory
   * confirmations, the examine pack description). Keeps the de-dup memory in
   * step so a following identical `said` line is still dropped.
   */
  announce(text: string): void {
    this.live.announce(text);
    this.lastAnnounced = text.trim();
  }

  /** Arm the examine window before a look is sent. */
  beginExamine(): void {
    this.examining = true;
  }

  /**
   * Start a new command's narration window: forget any choice menu, dialogue
   * line or choice phase the PREVIOUS command produced, so each command's
   * "Nothing happened." decision is made only from what that command did. The
   * player calls this from its one command seam (sendCommand), so every verb —
   * however it was issued (list Enter, verb menu, typed box) — resets the
   * window before its events arrive.
   */
  beginCommand(): void {
    this.producedChoices = false;
    this.producedDialogue = false;
    this.enteredChoicePhase = false;
    this.streamedThisCommand = [];
  }

  /**
   * Announce the open choice menu (one composed line, "Pick a reply, N options.
   * Option 1: … Option 2: …") and record that this command produced a choice
   * menu, so its settle diff never says "Nothing happened." over it. The line is
   * still the newest live-region line a screen reader reads.
   */
  choices(line: string): void {
    this.producedChoices = true;
    this.announce(line);
  }

  /**
   * Record that the command in flight produced a choice menu, WITHOUT announcing
   * a numbered line. The keyboard choice menu (ui/choice-menu.ts) owns the
   * live-region announcement for choices: it says "Pick a reply, N options.
   * Option 1: <text>" through its own announce callback (which routes to say),
   * and each move announces "Option <n> of <N>: <text>". It never moves DOM
   * focus (a focused option made VoiceOver talk over the actors), so there is no
   * focused menuitem to read from. The page calls this to keep the "Nothing
   * happened." suppression working, instead of calling choices() (which would
   * announce a second line over the menu's own open line).
   */
  markChoices(): void {
    this.producedChoices = true;
  }

  /**
   * Note the engine's own control phase for the command in flight. A change to
   * 'choice' means a conversation menu is open and waiting; the settle diff
   * must not say "Nothing happened." for it. 'control'/'busy' carry no such
   * meaning here and are ignored (the diff/choices paths already cover them).
   */
  onPhase(phase: "control" | "busy" | "choice"): void {
    if (phase === "choice") this.enteredChoicePhase = true;
  }

  /**
   * Route one A11Y_TEXT line.
   *
   * Hover/name labels are dropped on EVERY line — the engine draws its own
   * name for whatever is under the warped cursor ("BARTENDER", or the hero's
   * "hacker" over a doorway), and that leaked into the live region even after
   * an examine had closed. The list already names the focused thing, so a
   * hover echo is never functional text. During an examine the generic
   * "can't see anything in particular" reply is dropped too, since examine
   * already announced the pack's authored description. Real text the engine
   * composes beyond a hover name (dialogue, narration, "HE WINKS AT YOU.") is
   * multi-word, never a label match, and is always announced.
   *
   * A line that IS announced here is real dialogue/narration the command spoke,
   * so it marks the command as having produced spoken text — its settle diff
   * then never says "Nothing happened." over it (a talk whose only output is a
   * dialogue line and a changed:false diff still "did something").
   */
  text(line: string, voiced = false): void {
    if (this.examining) {
      if (isExamineNoiseLine(line, this.roomLabels)) return;
    } else if (isHoverNameLine(line, this.roomLabels)) {
      return;
    }
    this.producedDialogue = true;
    // Record this streamed line (trimmed) so the settling diff's `said` — which
    // repeats the whole conversation — can skip the lines already streamed and
    // re-announce only lines that were NOT streamed. Recorded on the SAME
    // filtered path that announces it, so a dropped hover/examine-noise line is
    // never recorded and never wrongly suppresses a matching real `said` line.
    // A voiced line is recorded here too (speech fix 1): the de-dup must still
    // match it against the diff's voiced `said` entry so the diff never
    // re-announces it, whether or not the screen reader read it.
    this.streamedThisCommand.push(line.trim());
    this.emitDialogue(line, voiced);
  }

  /**
   * Route one streamed A11Y_TEXT dialogue line to the live region (speech fix 1
   * + 2). A voiced line the player chose NOT to have read is suppressed; every
   * other streamed line goes through the paced dialogue queue so a focus move
   * can drop it if it has not been read yet (the stale-after-moving case).
   */
  private emitDialogue(line: string, voiced: boolean): void {
    // An actor is speaking this line: hold every region write until the clip
    // ends, whether or not the screen reader is to read the line itself.
    if (voiced) this.live.voiceStart?.();
    if (voiced && !this.readVoiced()) {
      this.suppressVoiced(line);
      return;
    }
    // Through the normal announce path, so the main.ts tap still feeds the
    // readiness status, ?speechlog and the crossing-skip quiet timer.
    this.announce(line);
  }

  /**
   * A voiced line the player chose not to have the screen reader read (speech
   * fix 1): keep it out of the live region, but still record it in the history
   * (so R reads the last one and Shift+R walks back to it) and mirror it to
   * ?speechlog / the status log via onVoicedSuppressed. Its de-dup memory is
   * kept in step so a matching diff `said` line is still dropped.
   */
  private suppressVoiced(line: string): void {
    const trimmed = line.trim();
    this.lastAnnounced = trimmed;
    this.live.record?.(line);
    this.onVoicedSuppressed(trimmed);
  }

  /**
   * Announce a diff's spoken text. Closes the examine window on a look diff
   * (its text events have all arrived by now), applies the diff-path generic
   * look filter, and de-duplicates `said` lines already announced.
   *
   * Two de-dup layers, both needed:
   *
   *  1. A `said` line already STREAMED live during this same command (through
   *     text(), recorded in streamedThisCommand) is dropped. A talk streams its
   *     whole conversation line by line as the engine says each one, then the
   *     settling diff carries the WHOLE conversation again in `said`. Without
   *     this, all N lines are re-announced in one burst — NVDA reads it as a
   *     jumble and repeats the last line, and R/Shift+R are flooded with the
   *     whole conversation. The match is by text, in order: each `said` line is
   *     checked against the next not-yet-consumed streamed line, so if the
   *     engine legitimately repeats a line twice only the extra occurrences
   *     past what was streamed are announced.
   *  2. A `said` line equal to the single last line already announced
   *     (lastAnnounced) is dropped — the long-standing text-vs-said duplicate
   *     for a one-line reply, and a belt-and-braces guard for any line that was
   *     not streamed this command (e.g. announced by the player composing it).
   *
   * Lines that were NOT streamed are announced — the non-streamed path (a plain
   * one-line engine reply) and the chapter-crossing path (a diff whose `said`
   * carries the crossing's narration with no prior stream) both still speak, so
   * nothing is lost.
   *
   * Returns whether this was a look diff, so the caller can skip "Nothing
   * happened." for it.
   */
  said(diff: Diff): boolean {
    const isLook = diff.cmd?.startsWith("look ") === true;
    if (isLook) this.examining = false;
    // A cursor over the lines streamed live this command. Each `said` line that
    // matches the next un-consumed streamed line (by trimmed text) is a repeat
    // of something the player already heard and is skipped; the cursor then
    // advances so later `said` lines match later streamed lines, preserving
    // order. A `said` line that does not match the next streamed line is not a
    // streamed repeat and is announced (subject to the lastAnnounced guard).
    let streamCursor = 0;
    for (const line of suppressGenericLook(diff)) {
      const text = line.text.trim();
      if (
        streamCursor < this.streamedThisCommand.length &&
        this.streamedThisCommand[streamCursor] === text
      ) {
        streamCursor += 1;
        continue;
      }
      if (text === this.lastAnnounced) continue;
      // A voiced `said` line is suppressed from the region by default (recorded
      // for R / ?speechlog); a non-voiced one speaks. The settle diff is a
      // single settled batch (not the live A11Y_TEXT stream), so it announces
      // synchronously — it is not the stale-after-moving case, which is the
      // paced text() stream below.
      if (line.voiced === true && !this.readVoiced()) {
        this.suppressVoiced(line.text);
      } else {
        this.announce(line.text);
      }
    }
    return isLook;
  }

  /**
   * Announce "Nothing happened." when an action changed no state and said
   * nothing — but never for a look (examine already spoke), never for a save,
   * and never when the command produced a choice menu, a spoken dialogue line,
   * or a phase change to 'choice'. `isLook` is the value said() returned for
   * this diff.
   *
   * The broad rule: "Nothing happened." is only correct when the command
   * produced NO diff change, NO spoken text and NO choices. It is the feedback
   * for a genuine no-op (a take that did nothing), not a report that a command
   * which opened a conversation menu or spoke a line "did nothing". The drunk
   * `talk 53` is the case this guards: the engine opens a choice menu
   * (A11Y_CHOICES, phase 'choice') and settles with a changed:false diff that
   * carries no `said`; without this guard the diff would announce "Nothing
   * happened." one millisecond after the choice line, clobbering it in the
   * single-line polite live region so a screen reader reads only "Nothing
   * happened." The per-command signals (producedChoices / producedDialogue /
   * enteredChoicePhase), reset by beginCommand() on each send, record that the
   * command plainly did something and suppress the line.
   *
   * A `save <slot>` settles with a `changed:false` diff (saving alters no room
   * state) in addition to its A11Y_SAVED line. The save outcome is announced by
   * the save manager ("Saved." or a failure line), so "Nothing happened." for a
   * save is both wrong and would clobber that outcome in the single-line live
   * region. Suppress it for a save diff the same way it is suppressed for a
   * look (save-progress follow-up: a save says only "Saved." or the failure).
   */
  maybeNothingHappened(diff: Diff, isLook: boolean): void {
    const isSave = diff.cmd?.startsWith("save ") === true;
    // `readpause on|off` is a player setting, not a game action: its settle
    // diff must never say "Nothing happened."
    const isReadPause = diff.cmd?.startsWith("readpause ") === true;
    const producedSomething =
      this.producedChoices || this.producedDialogue || this.enteredChoicePhase;
    if (
      diff.changed === false &&
      !diff.said?.length &&
      !isLook &&
      !isSave &&
      !isReadPause &&
      !producedSomething
    ) {
      this.announce("Nothing happened.");
    }
  }
}
