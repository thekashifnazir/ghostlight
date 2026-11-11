// How one ghost hint reaches the player: voiced by the ghost, or read as text.
// Pulled out of main.ts so the order of cut, record and play can be tested.

import type { HintResult } from "../hints/engine.js";

export interface HintSpeechDeps {
  live: {
    announce(text: string): void;
    record(text: string): void;
    interrupt(): boolean;
  };
  /** Undefined before the start gate. */
  audio: { willPlay(key: string): boolean; play(key: string): Promise<unknown> } | undefined;
  readVoicedLines: boolean;
  noHintText: string;
  recordStatus(text: string): void;
  logVoiced(text: string): void;
}

/**
 * Speak one hint reply. A real hint always cuts a screen reader that is still
 * reading the previous line, BEFORE the new line or the ghost's voice starts:
 * - Voiced: the ghost's recording would otherwise play over the screen reader.
 * - Read as text: a polite live-region change queues behind the line being
 *   read (only an assertive change stops VoiceOver), so without the cut the
 *   hint waits for the old line to finish.
 * "Nothing to hint at" is left as it was, with no cut.
 */
export function speakHint(r: HintResult, d: HintSpeechDeps): void {
  if (r.kind === "none") {
    d.live.announce(d.noHintText);
    return;
  }
  d.live.interrupt();
  const audio = d.audio;
  const voiced = audio?.willPlay(r.audioKey) === true;
  if (audio && voiced && !d.readVoicedLines) {
    // Spoken aloud only: keep the text out of the live region, but record it so
    // R repeats it, and log it.
    d.live.record(r.text);
    d.recordStatus(r.text);
    d.logVoiced(r.text);
    audio.play(r.audioKey).catch(() => {
      d.live.announce(r.text);
    });
    return;
  }
  d.live.announce(r.text);
  if (audio) {
    audio.play(r.audioKey).catch(() => {
      /* text is already spoken; the whisper is flavour only. */
    });
  }
}
