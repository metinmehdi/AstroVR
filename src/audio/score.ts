/**
 * Synthesized cinematic score (Web Audio, no files, no licences): the story-intro bed and the rocket sounds.
 *  - story(): drone + minor chord pads that build shot by shot, a low "boom" on every cut, a heartbeat under the storm,
 *    a riser into the title and a final hit
 *  - liftoff(): engine rumble felt through the capsule, fading as the air thins; cutoff thud
 * Everything goes through a small generated reverb so it sounds like a trailer, not a synth demo.
 */

const NOTE: Record<string, number> = {
  D2: 73.42, F2: 87.31, A2: 110.0, 'Bb1': 58.27, 'Bb2': 116.54, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0,
  'Bb3': 233.08, C4: 261.63, D4: 293.66, F4: 349.23, A4: 440.0, G2: 98.0, C2: 65.41, E4: 329.63,
};

/** one chord per story shot (D minor → B♭ → F → C → Dm (storm) → D sus/add9 (title, hope)) */
const CHORDS: string[][] = [
  ['D3', 'F3', 'A3'],
  ['Bb2', 'D3', 'F3'],
  ['F2', 'C3', 'A3'],
  ['C3', 'E3', 'G3'],
  ['D3', 'F3', 'A3'],
  ['D3', 'A3', 'E4', 'F4'],
];

export class Score {
  readonly out: GainNode;
  private noise: AudioBuffer;
  private reverb: ConvolverNode;
  private wet: GainNode;
  private nodes: AudioScheduledSourceNode[] = [];

  constructor(
    private ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    // gentle master compression keeps the hits from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.out.connect(comp).connect(destination);
    // reverb (generated impulse: 3.2 s decaying stereo noise)
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.5;
    this.reverb.connect(this.wet).connect(this.out);
    // shared noise
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < n.length; i++) {
      // brown-ish noise (deeper rumble than white)
      b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      n[i] = b * 3.5 + (Math.random() * 2 - 1) * 0.15;
    }
  }

  /** send a node to both the dry bus and the reverb */
  private bus(node: AudioNode, wet = 0.6) {
    node.connect(this.out);
    const g = this.ctx.createGain();
    g.gain.value = wet;
    node.connect(g).connect(this.reverb);
  }

  private track<T extends AudioScheduledSourceNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  stop(fadeS = 0.6) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fadeS);
    for (const n of this.nodes) {
      try {
        n.stop(t + fadeS + 0.05);
      } catch {
        /* already stopped */
      }
    }
    this.nodes = [];
  }

  /** a sustained, slowly filtered chord (detuned saw pairs) from t0 for dur seconds */
  private pad(notes: string[], t0: number, dur: number, level: number, bright: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(level, t0 + Math.min(1.8, dur * 0.4));
    g.gain.setValueAtTime(level, t0 + dur - 0.2);
    g.gain.linearRampToValueAtTime(0, t0 + dur + 1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(380 + bright * 400, t0);
    lp.frequency.linearRampToValueAtTime(700 + bright * 1600, t0 + dur);
    lp.Q.value = 0.6;
    lp.connect(g);
    this.bus(g, 0.8);
    for (const name of notes) {
      for (const det of [-7, 6]) {
        const o = this.track(ctx.createOscillator());
        o.type = 'sawtooth';
        o.frequency.value = NOTE[name];
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.18 / notes.length;
        o.connect(og).connect(lp);
        o.start(t0);
        o.stop(t0 + dur + 1.8);
      }
    }
  }

  /** cinematic hit: falling sub sine + filtered noise burst */
  hit(t: number, size = 1) {
    const ctx = this.ctx;
    const o = this.track(ctx.createOscillator());
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * size, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g);
    this.bus(g, 0.5);
    o.start(t);
    o.stop(t + 1.9);
    const n = this.track(ctx.createBufferSource());
    n.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.6);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5 * size, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    n.connect(lp).connect(ng);
    this.bus(ng, 0.9);
    n.start(t, Math.random());
    n.stop(t + 1);
  }

  private riser(t0: number, dur: number) {
    const ctx = this.ctx;
    const n = this.track(ctx.createBufferSource());
    n.buffer = this.noise;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(250, t0);
    bp.frequency.exponentialRampToValueAtTime(5000, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + dur);
    g.gain.linearRampToValueAtTime(0, t0 + dur + 0.05);
    n.connect(bp).connect(g);
    this.bus(g, 0.4);
    n.start(t0);
    n.stop(t0 + dur + 0.1);
    const o = this.track(ctx.createOscillator());
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, t0);
    o.frequency.exponentialRampToValueAtTime(900, t0 + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.06, t0 + dur);
    og.gain.linearRampToValueAtTime(0, t0 + dur + 0.05);
    o.connect(og);
    this.bus(og, 0.5);
    o.start(t0);
    o.stop(t0 + dur + 0.1);
  }

  private heartbeat(t0: number, dur: number) {
    for (let t = t0; t < t0 + dur; t += 0.62) {
      this.thump(t, 0.5);
      this.thump(t + 0.2, 0.32);
    }
  }

  private thump(t: number, v: number) {
    const ctx = this.ctx;
    const o = this.track(ctx.createOscillator());
    o.frequency.setValueAtTime(62, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g);
    this.bus(g, 0.3);
    o.start(t);
    o.stop(t + 0.32);
  }

  private drone(t0: number, dur: number) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.32, t0 + 3);
    g.gain.setValueAtTime(0.32, t0 + dur - 1);
    g.gain.linearRampToValueAtTime(0, t0 + dur + 2);
    lp.connect(g);
    this.bus(g, 0.7);
    for (const [f, det] of [
      [NOTE.D2, -5],
      [NOTE.D2, 5],
      [NOTE.A2, 0],
    ]) {
      const o = this.track(ctx.createOscillator());
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = 0.22;
      o.connect(og).connect(lp);
      o.start(t0);
      o.stop(t0 + dur + 2.2);
    }
  }

  /**
   * The story bed. `cuts` = start times (s, from now) of each shot; `end` = when the title fades.
   * Shot 5 (index 4) is the storm: heartbeat. The last cut is the title: riser before it, big hit on it.
   */
  story(cuts: number[], end: number, startAt = this.ctx.currentTime + 0.05) {
    const T = (s: number) => startAt + s;
    this.out.gain.setValueAtTime(0.9, startAt);
    this.drone(T(0), end);
    for (let i = 0; i < cuts.length; i++) {
      const from = cuts[i];
      const to = i + 1 < cuts.length ? cuts[i + 1] : end;
      const last = i === cuts.length - 1;
      this.pad(CHORDS[Math.min(i, CHORDS.length - 1)], T(from), to - from, last ? 0.5 : 0.18 + i * 0.05, i / cuts.length);
      if (i > 0 && !last) this.hit(T(from), 0.55 + i * 0.08);
      if (i === 4) this.heartbeat(T(from), to - from - 0.2);
    }
    const title = cuts[cuts.length - 1];
    this.riser(T(Math.max(0, title - 2.6)), 2.6);
    this.hit(T(title), 1.4);
  }

  /** Rocket engines: deep rumble that fades as the air thins (no sound in vacuum — only what the capsule carries). */
  liftoff(durS: number, startAt = this.ctx.currentTime + 0.05) {
    const ctx = this.ctx;
    const n = this.track(ctx.createBufferSource());
    n.buffer = this.noise;
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, startAt);
    lp.frequency.linearRampToValueAtTime(160, startAt + durS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.exponentialRampToValueAtTime(1.1, startAt + 0.8);
    g.gain.setValueAtTime(1.1, startAt + durS * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + durS);
    n.connect(lp).connect(g);
    this.bus(g, 0.25);
    n.start(startAt);
    n.stop(startAt + durS + 0.1);
    const o = this.track(ctx.createOscillator());
    o.frequency.value = 38;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, startAt);
    og.gain.exponentialRampToValueAtTime(0.5, startAt + 1);
    og.gain.exponentialRampToValueAtTime(0.0001, startAt + durS);
    o.connect(og);
    this.bus(og, 0.1);
    o.start(startAt);
    o.stop(startAt + durS + 0.1);
    this.hit(startAt, 1.2);
  }

  /** Quiet space pad for the coast + a swell on arrival. */
  space(durS: number, startAt = this.ctx.currentTime + 0.05) {
    this.pad(['D3', 'A3', 'E4'], startAt, durS * 0.6, 0.16, 0.2);
    this.pad(['Bb2', 'F3', 'D4'], startAt + durS * 0.55, durS * 0.45, 0.22, 0.6);
  }
}
