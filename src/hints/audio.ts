// Ghost audio playback glue (Requirements 6.1, 6.2, 6.4, 6.5, 8.4).
//
// Plays the cached whisper for a hint line after the text has already gone to
// the live region. The text is the hint; this audio is flavour on top, so it
// is optional (a toggle, on by default), interruptible (`stop`, wired into the
// controller's existing `stopAudio` hook) and silent when a file is missing,
// disabled, or playback fails. It carries no functional information.
//
// The cache lives at `src/hints/ghost/*.mp3`. Vite resolves those files to
// hashed asset URLs at dev and build time via `import.meta.glob(... ?url)`
// (gotcha 10), with no `vite.config.ts` change. The URL map is injectable so a
// unit test can exercise the disabled/missing/stop paths without real assets.

import { cacheFileName } from "./cache.js";

/** `./ghost/<key>.mp3` → hashed asset URL, resolved by Vite at build time. */
const globUrls = import.meta.glob<string>("./ghost/*.mp3", {
  query: "?url",
  import: "default",
  eager: true,
});

export type UrlMap = Record<string, string>;

/**
 * Output boost for the ghost whisper. The game music plays through the wasm
 * engine's own mixer (launched at ~40% in boot.ts), not this AudioContext, so
 * we cannot route the music through a shared gain to duck it live. Instead the
 * whisper is lifted above unity here so it sits clearly over the music. 1.8 is
 * a comfortable lift for a pre-normalised whisper recording without hard
 * clipping at the destination.
 */
const GHOST_BOOST = 1.8;

export class GhostAudio {
  private readonly ctx: AudioContext;
  private readonly urls: UrlMap;
  /** Master gain the whisper plays through, lifting it above the music. */
  private readonly master: GainNode;
  private enabled = true;
  private current: AudioBufferSourceNode | undefined;

  /**
   * @param ctx  the AudioContext created at the player's start gate.
   * @param urls the `./ghost/<key>.mp3` → URL map; defaults to the Vite glob.
   */
  constructor(ctx: AudioContext, urls: UrlMap = globUrls) {
    this.ctx = ctx;
    this.urls = urls;
    this.master = ctx.createGain();
    this.master.gain.value = GHOST_BOOST;
    this.master.connect(ctx.destination);
  }

  /** Whether the ghost whisper is on (default true, R6.2). */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Turn the whisper on or off; off makes `play` a no-op (R6.2). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop();
  }

  /**
   * Play the whisper for a cache key. No-op when disabled (R6.2) or when no
   * file exists for the key (silent text-only fallback, R6.5). Any fetch,
   * decode or playback error is swallowed so the player never sees it (R6.5).
   */
  async play(key: string): Promise<void> {
    if (!this.enabled) return;
    const url = this.urls[`./ghost/${cacheFileName(key)}`];
    if (!url) return; // no cached file: silent fallback.
    try {
      const res = await fetch(url);
      const bytes = await res.arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(bytes);
      this.stop(); // never overlap two whispers.
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.master);
      source.onended = () => {
        if (this.current === source) this.current = undefined;
      };
      source.start();
      this.current = source;
    } catch {
      // Any failure falls back to the text that is already spoken (R6.5).
    }
  }

  /** Stop any playing whisper immediately; safe when nothing is playing (R6.3). */
  stop(): void {
    if (!this.current) return;
    try {
      this.current.stop();
    } catch {
      /* already stopped or never started; nothing to do. */
    }
    this.current = undefined;
  }
}
