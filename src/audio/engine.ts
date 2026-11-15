/**
 * Suit audio engine (owner: P5). Scientifically correct: there is NO sound in the lunar vacuum,
 * so everything is "inside the suit": breathing, fan, heartbeat, dosimeter clicks, radio, footsteps through the body.
 * All ambience is synthesized (no files). Voice: public/audio/{lang}/{id}.mp3 (Gemini TTS), played through Web Audio
 * at a moment of the SHARED clock, so Mission Control speaks the same line at the same instant (src/audio/voice.ts).
 */
import { sharedNow } from '../shared/clock';
import { makeId } from '../shared/protocol';
import type { FastMsg, Lang } from '../shared/types';
import { FLIGHT, RADIO, STORY, SUIT } from './lines';
import { Score } from './score';
import { VoicePlayer, radioCallAt, voiceUrl } from './voice';
import { ROAR_URL } from '../shared/flightFilm';

// download order: what plays first (flight, story) before the mission lines
export const ALL_LINES = [...Object.keys(FLIGHT), ...Object.keys(STORY), ...Object.keys(SUIT), ...Object.keys(RADIO)];

export class SuitAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private breathGain!: GainNode;
  private nextClickAt = 0;
  private nextBeatAt = 0;
  private doseRate = 0; // mGy/h
  private stress = 0; // 0..1
  private cinematic: Score | null = null;
  private busyUntil = 0; // shared ms: the voice channel is busy until then (lines never overlap)
  private _lang: Lang = 'en';
  /** synchronized voice player (after unlock) */
  voice: VoicePlayer | null = null;
  /** sends a voice cue to Mission Control, which plays the same line at the same moment */
  share: ((m: FastMsg) => void) | null = null;

  get lang() {
    return this._lang;
  }
  set lang(l: Lang) {
    if (l === this._lang) return;
    this._lang = l;
    this.voice?.preloadLines(l, ALL_LINES);
  }

  /** Must be called from a user gesture (the START button). */
  unlock() {
    if (this.ctx) return void this.ctx.resume();
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    // white noise buffer reused by breath, fan, static, footsteps
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startFan();
    this.startBreath();
    this.voice = new VoicePlayer(ctx, this.master);
    this.voice.preloadLines(this._lang, ALL_LINES);
    void this.voice.load(ROAR_URL); // the real SLS roar, decoded long before liftoff
  }

  private noiseSource(loop = true) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  private startFan() {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const hum = ctx.createOscillator();
    hum.frequency.value = 92;
    const hg = ctx.createGain();
    hg.gain.value = 0.012;
    src.connect(lp).connect(g).connect(this.master);
    hum.connect(hg).connect(this.master);
    src.start();
    hum.start();
  }

  private startBreath() {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    src.connect(bp).connect(this.breathGain).connect(this.master);
    src.start();
  }

  /** Call every frame. doseRate in mGy/h, stress 0..1 (storm, low O2). */
  update(doseRateMGyH: number, stress: number) {
    if (!this.ctx) return;
    this.doseRate = doseRateMGyH;
    this.stress = stress;
    const t = this.ctx.currentTime;
    // breathing: faster and louder under stress
    const period = 4.2 - 1.8 * this.stress;
    const phase = (t % period) / period;
    const inhale = phase < 0.4 ? Math.sin((phase / 0.4) * Math.PI) : 0;
    const exhale = phase >= 0.5 && phase < 0.9 ? Math.sin(((phase - 0.5) / 0.4) * Math.PI) * 0.7 : 0;
    this.breathGain.gain.setTargetAtTime((inhale + exhale) * (0.05 + 0.06 * this.stress), t, 0.05);
    // heartbeat
    if (t >= this.nextBeatAt) {
      const bpm = 72 + 48 * this.stress;
      this.thump(t, 55, 0.18);
      this.thump(t + 0.18, 48, 0.12);
      this.nextBeatAt = t + 60 / bpm;
    }
    // dosimeter: clicks per second grow with the dose rate (Poisson)
    if (t >= this.nextClickAt) {
      const cps = 0.4 + 18 * this.doseRate;
      this.click(t);
      this.nextClickAt = t - Math.log(1 - Math.random()) / cps;
    }
  }

  private thump(t: number, freq: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * (0.6 + this.stress), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  private click(t: number) {
    const ctx = this.ctx!;
    const src = this.noiseSource(false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.015);
  }

  /** Synthesized cinematic sounds (rocket rumble, space pads) on the suit's audio graph. Null before unlock(). */
  score(): Score | null {
    if (!this.ctx) return null;
    if (!this.cinematic) this.cinematic = new Score(this.ctx, this.master);
    return this.cinematic;
  }

  /** A footstep felt through the suit (low thud), called on each lope hop. */
  step() {
    if (!this.ctx) return;
    this.thump(this.ctx.currentTime, 70, 0.35);
  }

  /** Two rising tones when a mission step is completed. */
  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 880, 0.12, 0.09);
    this.tone(t + 0.12, 1320, 0.18, 0.09);
  }

  /** Short UI tick for gaze selections. */
  tick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 1400, 0.06, 0.08);
  }

  private tone(t: number, freq: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol, t + dur - 0.01);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  /**
   * Radio call at shared time `at` (Mission Control chose it: send time + the 1.28 s light delay): "Quindar" beeps,
   * static, the voice. Mission Control plays the same call at the same moment.
   */
  radio(id: string, at = sharedNow() + 300) {
    if (!this.voice || !this.ctx) return;
    const v = this.voice;
    const stat = this.staticNoise(Math.max(this.ctx.currentTime, v.ctxTimeFor(at - 300)));
    void radioCallAt(v, this._lang, id, at).then((end) => {
      this.busyUntil = Math.max(this.busyUntil, end);
      stat.stop(Math.max(this.ctx!.currentTime, v.ctxTimeFor(end)));
    });
    this.busyUntil = Math.max(this.busyUntil, at + 3000);
  }

  /** Suit computer voice: queued after the current line, shared with Mission Control (same instant on both). */
  suit(id: string, text = '') {
    if (!this.voice) return;
    const lang = this._lang;
    const dur = this.voice.duration(voiceUrl(lang, id)) ?? text.split(/\s+/).length / 2.6 + 0.5;
    const at = Math.max(sharedNow() + 900, this.busyUntil + 250); // 0.9 s: enough for the cue to reach the laptop
    this.busyUntil = at + dur * 1000;
    this.share?.({ k: 'voice', id: makeId(), line: id, lang, at, kind: 'suit' });
    void this.voice.sayAt(lang, id, at, 0.9);
  }

  private staticNoise(t: number) {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.025;
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    return src;
  }
}
