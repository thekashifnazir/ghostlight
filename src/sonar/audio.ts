// Sonar audio layer (Requirements 1.5, 1.6, 1.7, 5.1, 5.4; thin).
//
// Voices Ping values on a Web Audio graph. Given finished Pings and an
// AudioContext, it schedules one short synthesised sound per ping: an
// oscillator (waveform and rhythm by kind) → gain (a short envelope scaled by
// ping.gain) → lowpass (ping.cutoff, the distance timbre) → stereo panner
// (ping.pan, the left-right place) → destination. Pitch is ping.freq.
//
// The layer has no game or DOM knowledge: it does not read the room, the pack
// or the live region. It only knows how to turn a Ping into sound, so the
// sonar controller owns every decision and this stays testable with an
// OfflineAudioContext. `stop()` cancels and disconnects every node scheduled
// since the last play, so a key press kills a scan mid-flight (R5.1). While
// muted, `play`/`playOne` are no-ops (R5.4).
//
// Timbre by kind, so a thing's kind is audible beyond pitch alone (R1.7):
//   object — one short sine blip;
//   exit   — two rising triangle notes a fifth apart;
//   person — one buzzy sawtooth with vibrato and a falling glide.

import type { Ping } from "./mapping.js";

/** Peak attack time in seconds for a ping's amplitude envelope. */
const ATTACK = 0.012;

/** A single-note ping's duration in seconds. */
const NOTE = 0.11;

/** Each note's duration in a two-note exit ping. */
const EXIT_NOTE = 0.1;

/** A person ping's duration in seconds (longer, so the vibrato is audible). */
const PERSON_NOTE = 0.13;

/** The interval (a perfect fifth, 2^(7/12)) between the two exit notes. */
const FIFTH = 2 ** (7 / 12);

/** Vibrato rate in Hz for a person ping. */
const VIBRATO_RATE = 6;

/** Vibrato depth in Hz for a person ping. */
const VIBRATO_DEPTH = 8;

/** Fraction of its starting pitch a person ping glides down to by its end. */
const PERSON_GLIDE = 0.92;

export class SonarAudio {
  private readonly ctx: AudioContext;
  private muted = false;
  /** Every node started since the last play/stop, kept so stop() can end it. */
  private live: AudioScheduledSourceNode[] = [];

  /** @param ctx the AudioContext created at the player's start gate. */
  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /** Turn sonar sound off or on; muted makes play/playOne no-ops (R5.4). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stop();
  }

  /** Schedule a whole scan: each ping at ctx.currentTime + ping.onset (R2.1). */
  play(pings: Ping[]): void {
    if (this.muted) return;
    this.stop();
    const base = this.ctx.currentTime;
    for (const ping of pings) this.schedule(ping, base + ping.onset);
  }

  /** Voice a single ping now (a step: R3.1, R3.2). */
  playOne(ping: Ping): void {
    if (this.muted) return;
    this.stop();
    this.schedule(ping, this.ctx.currentTime);
  }

  /**
   * Stop all scheduled and playing sonar sound immediately (R5.1). Safe to call
   * when nothing is playing. Each node is stopped and disconnected so a long
   * scan is cancelled the instant a key is pressed.
   */
  stop(): void {
    for (const node of this.live) {
      try {
        node.stop();
      } catch {
        /* already stopped or not yet started; nothing to do. */
      }
      try {
        node.disconnect();
      } catch {
        /* already disconnected. */
      }
    }
    this.live = [];
  }

  /** Build and start the graph for one ping at the given start time. */
  private schedule(ping: Ping, start: number): void {
    switch (ping.kind) {
      case "exit":
        this.scheduleExit(ping, start);
        break;
      case "person":
        this.schedulePerson(ping, start);
        break;
      default:
        this.scheduleObject(ping, start);
        break;
    }
  }

  /** A short lowpass+panner chain shared by every ping, ending at destination. */
  private chain(ping: Ping): { input: AudioNode; gain: GainNode } {
    const gain = this.ctx.createGain();
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = ping.cutoff;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = ping.pan;
    gain.connect(lowpass);
    lowpass.connect(panner);
    panner.connect(this.ctx.destination);
    return { input: gain, gain };
  }

  /** Apply a short attack/decay envelope to a gain node over [start, start+dur]. */
  private envelope(gain: GainNode, peak: number, start: number, dur: number): void {
    const g = gain.gain;
    g.setValueAtTime(0, start);
    g.linearRampToValueAtTime(peak, start + ATTACK);
    g.exponentialRampToValueAtTime(0.0001, start + dur);
  }

  /** object — one short sine blip at ping.freq. */
  private scheduleObject(ping: Ping, start: number): void {
    const { input, gain } = this.chain(ping);
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = ping.freq;
    osc.connect(input);
    this.envelope(gain, ping.gain, start, start + NOTE);
    osc.start(start);
    osc.stop(start + NOTE);
    this.live.push(osc);
  }

  /** exit — two rising triangle notes a fifth apart. */
  private scheduleExit(ping: Ping, start: number): void {
    const freqs = [ping.freq, ping.freq * FIFTH];
    freqs.forEach((freq, i) => {
      const { input, gain } = this.chain(ping);
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      osc.connect(input);
      const noteStart = start + i * EXIT_NOTE;
      this.envelope(gain, ping.gain, noteStart, noteStart + EXIT_NOTE);
      osc.start(noteStart);
      osc.stop(noteStart + EXIT_NOTE);
      this.live.push(osc);
    });
  }

  /** person — a buzzy sawtooth with vibrato and a falling glide. */
  private schedulePerson(ping: Ping, start: number): void {
    const { input, gain } = this.chain(ping);
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    const end = start + PERSON_NOTE;
    // A gentle downward glide over the note.
    osc.frequency.setValueAtTime(ping.freq, start);
    osc.frequency.linearRampToValueAtTime(ping.freq * PERSON_GLIDE, end);
    // Vibrato: a slow LFO on the oscillator's frequency.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = VIBRATO_RATE;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = VIBRATO_DEPTH;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(input);
    this.envelope(gain, ping.gain, start, end);
    osc.start(start);
    osc.stop(end);
    lfo.start(start);
    lfo.stop(end);
    this.live.push(osc, lfo);
  }
}
