/**
 * Suit audio engine (owner: P5). Scientifically correct: there is NO sound in the lunar vacuum,
 * so everything is "inside the suit": breathing, fan, heartbeat, dosimeter clicks, radio, footsteps through the body.
 * All ambience is synthesized (no files). Voice: public/audio/{lang}/{id}.mp3 if present, else browser speech.
 */
import type { Lang } from '../shared/types';

export class SuitAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private breathGain!: GainNode;
  private nextClickAt = 0;
  private nextBeatAt = 0;
  private doseRate = 0; // mGy/h
  private stress = 0; // 0..1
  private speaking = Promise.resolve();
  lang: Lang = 'en';

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

  /** A footstep felt through the suit (low thud), called on each lope hop. */
  step() {
    if (!this.ctx) return;
    this.thump(this.ctx.currentTime, 70, 0.35);
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
   * Radio call: Apollo-style "Quindar" tones (2525 Hz intro, 2475 Hz outro), static, then the voice.
   * Calls are queued so they never overlap.
   */
  radio(id: string, text: string) {
    this.speaking = this.speaking.then(async () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.tone(t, 2525, 0.25, 0.12);
      const stat = this.staticNoise(t + 0.25);
      await sleep(300);
      await this.say(id, text, 'radio');
      this.tone(this.ctx.currentTime, 2475, 0.25, 0.12);
      stat.stop(this.ctx.currentTime + 0.3);
      await sleep(350);
    });
    return this.speaking;
  }

  /** Suit computer voice (no beeps). */
  suit(id: string, text: string) {
    this.speaking = this.speaking.then(() => this.say(id, text, 'suit'));
    return this.speaking;
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

  private say(id: string, text: string, kind: 'radio' | 'suit'): Promise<void> {
    return new Promise((resolve) => {
      const audio = new Audio(`/audio/${this.lang}/${id}.mp3`);
      audio.volume = kind === 'radio' ? 0.95 : 0.85;
      audio.onended = () => resolve();
      audio.onerror = () => this.speak(text).then(resolve);
      audio.play().catch(() => this.speak(text).then(resolve));
    });
  }

  private speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      const want = this.lang === 'az' ? ['az', 'tr'] : ['en'];
      const v = want.map((w) => voices.find((x) => x.lang.toLowerCase().startsWith(w))).find(Boolean);
      if (v) u.voice = v;
      u.lang = v?.lang ?? (this.lang === 'az' ? 'tr-TR' : 'en-US');
      u.rate = 0.95;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
      setTimeout(resolve, 12000); // never block the queue forever
    });
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
