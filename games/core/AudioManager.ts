export type SfxName =
  | "click"
  | "shoot"
  | "hit"
  | "death"
  | "score"
  | "graze"
  | "spawn"
  | "success"
  | "warn";

interface SfxSpec {
  /** Oscillator type, or "noise" for a white-noise burst. */
  type: OscillatorType | "noise";
  /** Start frequency in Hz (ignored for noise). */
  freq: number;
  /** End frequency for the pitch sweep; defaults to `freq`. */
  freqEnd?: number;
  duration: number;
  gain: number;
  /** Lowpass cutoff applied to noise. */
  filter?: number;
}

const SFX: Record<SfxName, SfxSpec> = {
  click: { type: "square", freq: 620, freqEnd: 760, duration: 0.06, gain: 0.16 },
  shoot: { type: "sawtooth", freq: 380, freqEnd: 140, duration: 0.1, gain: 0.12 },
  hit: { type: "square", freq: 200, freqEnd: 60, duration: 0.14, gain: 0.22 },
  death: { type: "sawtooth", freq: 240, freqEnd: 40, duration: 0.7, gain: 0.3 },
  score: { type: "triangle", freq: 880, freqEnd: 1320, duration: 0.12, gain: 0.16 },
  graze: { type: "sine", freq: 1500, freqEnd: 2100, duration: 0.07, gain: 0.09 },
  spawn: { type: "noise", freq: 0, duration: 0.12, gain: 0.1, filter: 1800 },
  success: { type: "triangle", freq: 660, freqEnd: 990, duration: 0.16, gain: 0.2 },
  warn: { type: "square", freq: 160, freqEnd: 190, duration: 0.18, gain: 0.14 },
};

const MUTE_STORAGE_KEY = "game532:muted";

/**
 * Synthesized sound effects over WebAudio. No asset files, no autoplay: the
 * AudioContext is only created once `unlock()` is called from a real user
 * gesture, which is what browsers require.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
      } catch {
        this.muted = false;
      }
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isUnlocked(): boolean {
    return this.ctx !== null;
  }

  /** Safe to call repeatedly; must originate from a user gesture. */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.buildNoise();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.01);
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
      } catch {
        // Private-mode browsers can throw on write; muting still applies in memory.
      }
    }
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * @param detune Multiplier on the base frequency, letting callers pitch a
   *   shared sound up as a combo climbs.
   */
  play(name: SfxName, detune = 1, volume = 1): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;
    if (ctx.state !== "running") return;

    const spec = SFX[name];
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const peak = spec.gain * volume;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);

    if (spec.type === "noise") {
      if (!this.noiseBuffer) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = spec.filter ?? 2000;
      src.connect(lp).connect(gain).connect(master);
      src.start(now);
      src.stop(now + spec.duration);
    } else {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      const f0 = Math.max(20, spec.freq * detune);
      const f1 = Math.max(20, (spec.freqEnd ?? spec.freq) * detune);
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f1, now + spec.duration);
      osc.connect(gain).connect(master);
      osc.start(now);
      osc.stop(now + spec.duration);
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  private buildNoise(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }
}
