/**
 * WorldView Tactical Audio Engine
 *
 * Fully procedural sound synthesis via the Web Audio API.
 * No external audio files required — every sound is generated at runtime,
 * keeping the bundle tiny and avoiding any copyright concerns.
 *
 * Sound palette:
 *  - ambientDrone   : Low hum + filtered noise (ops-centre atmosphere)
 *  - bootTick       : Short high blip (splash-screen line reveal)
 *  - click          : Crisp digital button blip
 *  - toggleOn       : Rising two-tone
 *  - toggleOff      : Falling two-tone
 *  - shaderSwitch   : Sci-fi mode-change sweep
 *  - alertPing      : Subtle notification ping
 *  - bootComplete   : Chord confirming system ready
 */

export type SoundEffect =
  | 'click'
  | 'toggleOn'
  | 'toggleOff'
  | 'shaderSwitch'
  | 'alertPing'
  | 'bootTick'
  | 'bootComplete'
  | 'bootSweep'
  | 'bootConnect'
  | 'bootLoad'
  | 'bootOk'
  | 'bootReady'
  | 'bootSeparator';

class TacticalAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _muted: boolean;

  // Ambient nodes
  private ambientOsc: OscillatorNode | null = null;
  private ambientNoise: AudioBufferSourceNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientRunning = false;

  constructor() {
    this._muted = false;
  }

  /** Lazily initialise the AudioContext (must be triggered by a user gesture). */
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._muted ? 0 : 1;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /* ── Public API ────────────────────────────────────────────────── */

  get muted(): boolean {
    return this._muted;
  }

  setMuted(value: boolean): void {
    this._muted = value;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(value ? 0 : 1, this.ctx!.currentTime, 0.05);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this._muted);
    return this._muted;
  }

  /** Play a one-shot tactical sound effect. */
  play(effect: SoundEffect): void {
    // Always ensure context exists so sounds can be resumed
    const ctx = this.ensureContext();
    if (this._muted) return;

    switch (effect) {
      case 'click':
        this.playClick(ctx);
        break;
      case 'toggleOn':
        this.playToggle(ctx, 'on');
        break;
      case 'toggleOff':
        this.playToggle(ctx, 'off');
        break;
      case 'shaderSwitch':
        this.playShaderSwitch(ctx);
        break;
      case 'alertPing':
        this.playAlertPing(ctx);
        break;
      case 'bootTick':
        this.playBootTick(ctx);
        break;
      case 'bootComplete':
        this.playBootComplete(ctx);
        break;
      case 'bootSweep':
        this.playBootSweep(ctx);
        break;
      case 'bootConnect':
        this.playBootConnect(ctx);
        break;
      case 'bootLoad':
        this.playBootLoad(ctx);
        break;
      case 'bootOk':
        this.playBootOk(ctx);
        break;
      case 'bootReady':
        this.playBootReady(ctx);
        break;
      case 'bootSeparator':
        this.playBootSeparator(ctx);
        break;
    }
  }

  /** Start the ambient ops-centre drone. Idempotent. */
  startAmbient(): void {
    const ctx = this.ensureContext();
    if (this.ambientRunning) return;
    this.ambientRunning = true;

    const now = ctx.currentTime;

    // Gain envelope for the ambient bus
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.setValueAtTime(0, now);
    this.ambientGain.gain.linearRampToValueAtTime(0.06, now + 3); // slow fade in
    this.ambientGain.connect(this.masterGain!);

    // Low-frequency sine hum (50 Hz mains-like)
    this.ambientOsc = ctx.createOscillator();
    this.ambientOsc.type = 'sine';
    this.ambientOsc.frequency.value = 50;

    // Subtle LFO to modulate hum amplitude
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.15; // very slow pulsing
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain);
    lfoGain.connect(this.ambientOsc.frequency);
    lfo.start();

    this.ambientOsc.connect(this.ambientGain);
    this.ambientOsc.start();

    // Filtered white noise — electronics / air-con hiss
    const noiseBuffer = this.createNoiseBuffer(ctx, 4);
    this.ambientNoise = ctx.createBufferSource();
    this.ambientNoise.buffer = noiseBuffer;
    this.ambientNoise.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 400;
    noiseFilter.Q.value = 0.5;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.25;

    this.ambientNoise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.ambientGain);
    this.ambientNoise.start();
  }

  /** Stop the ambient drone. */
  stopAmbient(): void {
    if (!this.ambientRunning) return;
    const now = this.ctx?.currentTime ?? 0;

    if (this.ambientGain) {
      this.ambientGain.gain.setTargetAtTime(0, now, 0.5);
    }

    // Clean up after fade-out
    setTimeout(() => {
      try {
        this.ambientOsc?.stop();
        this.ambientNoise?.stop();
      } catch {
        /* already stopped */
      }
      this.ambientOsc = null;
      this.ambientNoise = null;
      this.ambientGain = null;
      this.ambientRunning = false;
    }, 2000);
  }

  /** Dispose of the entire audio context. */
  dispose(): void {
    this.stopAmbient();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
    }
  }

  /* ── Sound generators ──────────────────────────────────────────── */

  /** Short crisp digital blip. */
  private playClick(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.04);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  /** Rising or falling two-tone for toggles. */
  private playToggle(ctx: AudioContext, direction: 'on' | 'off'): void {
    const now = ctx.currentTime;
    const freqs = direction === 'on' ? [600, 900] : [900, 600];

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      const offset = i * 0.06;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.1, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.08);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + offset);
      osc.stop(now + offset + 0.08);
    });
  }

  /** Sci-fi sweep for shader/mode changes. */
  private playShaderSwitch(ctx: AudioContext): void {
    const now = ctx.currentTime;

    // Sweep oscillator
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(1500, now + 0.1);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);

    // Low-pass filter for warmth
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    filter.Q.value = 2;

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /** Subtle alert notification ping. */
  private playAlertPing(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(1100, now + 0.15);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  /** Tiny tick for boot-sequence lines. */
  private playBootTick(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.value = 1200 + Math.random() * 400; // subtle variation

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.03);
  }

  /** Chord confirming boot complete / system ready. */
  private playBootComplete(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      const offset = i * 0.08;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.08, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.5);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + offset);
      osc.stop(now + offset + 0.5);
    });
  }

  /** Dramatic sweep for the title line. */
  private playBootSweep(ctx: AudioContext): void {
    const now = ctx.currentTime;

    // Rising sine sweep
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.35);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3000;
    filter.Q.value = 3;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.03);
    gain.gain.setValueAtTime(0.1, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.4);

    // Sub-bass thump
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = 80;
    subGain.gain.setValueAtTime(0.12, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    sub.connect(subGain);
    subGain.connect(this.masterGain!);
    sub.start(now);
    sub.stop(now + 0.25);
  }

  /** Data modem-like chirp for "CONNECTING" lines. */
  private playBootConnect(ctx: AudioContext): void {
    const now = ctx.currentTime;

    // Rapid frequency-hopping chirps (modem handshake feel)
    const chirpFreqs = [800, 1200, 600, 1400, 900];
    chirpFreqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;

      const offset = i * 0.025;
      gain.gain.setValueAtTime(0.04, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.02);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + offset);
      osc.stop(now + offset + 0.025);
    });

    // Trailing noise burst (static crackle)
    const noiseLen = 0.06;
    const buffer = this.createNoiseBuffer(ctx, noiseLen);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 2000;
    noiseFilter.Q.value = 5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.04, now + 0.12);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain!);
    noise.start(now + 0.12);
  }

  /** Digital loading/processing blip for "LOADING" / "BUILDING" / "COMPILING" lines. */
  private playBootLoad(ctx: AudioContext): void {
    const now = ctx.currentTime;

    // Descending digital stutter
    const steps = [1600, 1400, 1100, 800];
    steps.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const offset = i * 0.03;
      gain.gain.setValueAtTime(0.06, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.025);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + offset);
      osc.stop(now + offset + 0.03);
    });
  }

  /** Satisfied confirmation blip when a line shows "OK". */
  private playBootOk(ctx: AudioContext): void {
    const now = ctx.currentTime;

    // Quick rising two-tone (lower → higher)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = 880;
    gain1.gain.setValueAtTime(0.06, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc1.connect(gain1);
    gain1.connect(this.masterGain!);
    osc1.start(now);
    osc1.stop(now + 0.06);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 1320;
    gain2.gain.setValueAtTime(0.07, now + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc2.connect(gain2);
    gain2.connect(this.masterGain!);
    osc2.start(now + 0.05);
    osc2.stop(now + 0.12);
  }

  /** Triumphant chord for "ALL SYSTEMS NOMINAL". */
  private playBootReady(ctx: AudioContext): void {
    const now = ctx.currentTime;
    // Majestic C major spread: C4, E4, G4, C5
    const notes = [261.63, 329.63, 392.00, 523.25];

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const offset = i * 0.06;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.07, now + offset + 0.02);
      gain.gain.setValueAtTime(0.07, now + offset + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.8);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + offset);
      osc.stop(now + offset + 0.8);
    });

    // Gentle white noise shimmer on top
    const noiseBuffer = this.createNoiseBuffer(ctx, 0.5);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 6000;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.015, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain!);
    noise.start(now);
  }

  /** Subtle electric hum for the separator line. */
  private playBootSeparator(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 120;
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /* ── Utilities ─────────────────────────────────────────────────── */

  /** Generate a white-noise AudioBuffer. */
  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * durationSec;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}

/** Singleton — shared across the entire app. */
export const tacticalAudio = new TacticalAudio();
