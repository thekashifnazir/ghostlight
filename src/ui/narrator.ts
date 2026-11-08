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

  constructor(live: NarratorLive) {
    this.live = live;
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
  }

  /**
   * Announce the open choice menu (one line, "1. … 2. …") and record that this
   * command produced a choice menu, so its settle diff never says "Nothing
   * happened." over it. The line is still the newest live-region line a screen
   * reader reads.
   */
  choices(line: string): void {
    this.producedChoices = true;
    this.announce(line);
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
  text(line: string): void {
    if (this.examining) {
      if (isExamineNoiseLine(line, this.roomLabels)) return;
    } else if (isHoverNameLine(line, this.roomLabels)) {
      return;
    }
    this.producedDialogue = true;
    this.announce(line);
  }

  /**
   * Announce a diff's spoken text. Closes the examine window on a look diff
   * (its text events have all arrived by now), applies the diff-path generic
   * look filter, and drops a `said` line equal to the last line already
   * announced (the text-vs-said duplicate). Returns whether this was a look
   * diff, so the caller can skip "Nothing happened." for it.
   */
  said(diff: Diff): boolean {
    const isLook = diff.cmd?.startsWith("look ") === true;
    if (isLook) this.examining = false;
    for (const line of suppressGenericLook(diff)) {
      if (line.text.trim() === this.lastAnnounced) continue;
      this.announce(line.text);
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
    const producedSomething =
      this.producedChoices || this.producedDialogue || this.enteredChoicePhase;
    if (
      diff.changed === false &&
      !diff.said?.length &&
      !isLook &&
      !isSave &&
      !producedSomething
    ) {
      this.announce("Nothing happened.");
    }
  }
}
