/**
 * Moon Base Radio player: 24 kHz PCM from the Live API → a lunar radio link.
 *
 * Queue, fades and the debounced idle report come from TeatrAi
 * apps/stage/public/worklets/pcm-player.js (audio arrives in bursts and must
 * leave at a steady rate; never step the waveform — every stop is a ramp).
 * The voice treatment is new: a radio channel that keeps the voice HUMAN —
 * band-limited and slightly saturated, never robotic.
 *
 *   resample 24k → context rate (Hermite)
 *   → HP 280 Hz → LP 3600 Hz (4th-order) → +3 dB presence at 1.9 kHz
 *   → gentle saturation (tanh-ish, 35% mix) → make-up gain → safety clip
 *   + carrier hiss (band-passed noise with slow flutter) while the link is open
 *   + squelch burst when the link opens, "kshhh" tail when it closes
 *   + Quindar tones on request (2525 Hz key-down, 2475 Hz key-up, 250 ms —
 *     the real Apollo Mission Control push-to-talk tones)
 *
 * Messages in:
 *   { pcm: ArrayBuffer }        Int16 mono 24 kHz, queued
 *   { holdUntil: seconds }      don't START a new transmission before this context time (light delay)
 *   { turnEnd: true }           the model finished: close the link when the queue runs dry
 *   { clear: true }             barge-in: ramp out now, short tail, drop everything
 *   { beep: hz }                Quindar tone (local side)
 *   { fx: boolean }             radio treatment on/off
 * Messages out (~20 Hz): { level, queued, open }
 */

const IN_RATE = 24000;
const FADE_S = 0.004;

function biquad(kind, fs, f0, gainDb, q) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  const alpha = s / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (kind === 'highpass') {
    b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (kind === 'lowpass') {
    b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (kind === 'bandpass') {
    b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else {
    // peaking
    b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * c; a2 = 1 - alpha / A;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, z1: 0, z2: 0 };
}

function run(f, x) {
  const y = f.b0 * x + f.z1;
  f.z1 = f.b1 * x - f.a1 * y + f.z2;
  f.z2 = f.b2 * x - f.a2 * y;
  return y;
}

function softclip(x) {
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

const RADIO = {
  hpHz: 280, lpHz: 3600, presenceHz: 1900, presenceDb: 3, presenceQ: 0.9,
  drive: 1.7, satMix: 0.3, makeup: 0.9,
  hiss: 0.010, flutterHz: 0.7, squelchOpen: 0.11, squelchOpenS: 0.09, tail: 0.09, tailS: 0.22,
};

class RadioPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    const fs = sampleRate;
    this.ratio = IN_RATE / fs;
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.phase = 0;
    this.sA = 0; this.sB = 0; this.sC = 0; this.sD = 0;
    this.fx = true;

    this.hp = biquad('highpass', fs, RADIO.hpHz, 0, 0.707);
    this.lp1 = biquad('lowpass', fs, RADIO.lpHz, 0, 0.5411961);
    this.lp2 = biquad('lowpass', fs, RADIO.lpHz, 0, 1.30656296);
    this.pres = biquad('peaking', fs, RADIO.presenceHz, RADIO.presenceDb, RADIO.presenceQ);
    this.noiseBp = biquad('bandpass', fs, 2200, 0, 0.6);
    this.satNorm = RADIO.drive / softclip(RADIO.drive);

    this.open = false; // link (carrier) open
    this.turnEnded = false;
    this.holdUntil = 0;
    this.dryFor = 0; // seconds the queue has been dry while open
    this.burst = 0; // remaining squelch-burst seconds
    this.burstLen = 1;
    this.burstAmp = 0;
    this.flutter = 0;

    this.last = 0;
    this.fade = 0; // remaining fade-out samples of the voice
    this.fadeLen = Math.round(FADE_S * fs);

    this.beepHz = 0;
    this.beepLeft = 0;
    this.beepPhase = 0;
    this.beepLen = Math.round(0.25 * fs);

    this.peak = 0;
    this.sinceReport = 0;

    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.pcm) {
        this.queue.push(new Int16Array(d.pcm));
        this.turnEnded = false;
      }
      if (typeof d.holdUntil === 'number') this.holdUntil = d.holdUntil;
      if (d.turnEnd) this.turnEnded = true;
      if (typeof d.fx === 'boolean') this.fx = d.fx;
      if (typeof d.beep === 'number') {
        this.beepHz = d.beep;
        this.beepLeft = this.beepLen;
        this.beepPhase = 0;
      }
      if (d.clear) {
        this.queue.length = 0;
        this.current = null;
        this.offset = 0;
        this.fade = this.last !== 0 ? this.fadeLen : 0;
        if (this.open) this.closeLink(0.5);
      }
    };
  }

  startBurst(amp, seconds) {
    this.burstAmp = amp;
    this.burstLen = seconds;
    this.burst = seconds;
  }

  closeLink(scale = 1) {
    this.open = false;
    this.turnEnded = false;
    this.dryFor = 0;
    if (this.fx) this.startBurst(RADIO.tail * scale, RADIO.tailS * scale);
  }

  pull() {
    if (!this.current || this.offset >= this.current.length) {
      this.current = this.queue.shift() ?? null;
      this.offset = 0;
      if (!this.current) return null;
    }
    return this.current[this.offset++] / 0x8000;
  }

  /** One output sample of voice (resampled), or null when dry. */
  voice() {
    this.phase += this.ratio;
    while (this.phase >= 1) {
      const n = this.pull();
      if (n === null) {
        this.phase -= this.ratio;
        return null;
      }
      this.sA = this.sB; this.sB = this.sC; this.sC = this.sD; this.sD = n;
      this.phase -= 1;
    }
    const t = this.phase;
    const c1 = 0.5 * (this.sC - this.sA);
    const c2 = this.sA - 2.5 * this.sB + 2 * this.sC - 0.5 * this.sD;
    const c3 = 0.5 * (this.sD - this.sA) + 1.5 * (this.sB - this.sC);
    return ((c3 * t + c2) * t + c1) * t + this.sB;
  }

  treat(x) {
    if (!this.fx) return x;
    x = run(this.hp, x);
    x = run(this.lp1, x);
    x = run(this.lp2, x);
    x = run(this.pres, x);
    const d = x * RADIO.drive;
    const sat = softclip(d) * (1 / this.satNorm) * RADIO.drive;
    x = x + (sat - x) * RADIO.satMix;
    return x * RADIO.makeup;
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const dt = 1 / sampleRate;
    const holding = currentTime < this.holdUntil;
    const hasAudio = this.queue.length > 0 || (this.current && this.offset < this.current.length);

    // Open the link when audio is waiting and the light delay has elapsed.
    if (!this.open && hasAudio && !holding) {
      this.open = true;
      this.dryFor = 0;
      this.sA = this.sB = this.sC = this.sD = 0;
      this.phase = 0;
      if (this.fx) this.startBurst(RADIO.squelchOpen, RADIO.squelchOpenS);
    }

    for (let i = 0; i < out.length; i++) {
      let v = 0;

      if (this.open) {
        const s = this.voice();
        if (s !== null) {
          v = this.treat(s);
          this.fade = 0;
          this.dryFor = 0;
        } else {
          this.dryFor += dt;
          if (this.fade > 0) {
            this.fade--;
            v = (this.last * this.fade) / this.fadeLen;
          } else if (this.last !== 0 && Math.abs(this.last) > 1e-4) {
            this.fade = this.fadeLen - 1;
            v = (this.last * this.fade) / this.fadeLen;
          }
          // Turn finished (or the server went quiet for too long): close with a tail.
          if ((this.turnEnded && this.dryFor > 0.12) || this.dryFor > 1.6) this.closeLink();
        }
      } else if (this.fade > 0) {
        this.fade--;
        v = (this.last * this.fade) / this.fadeLen;
      }
      this.last = v;

      // Carrier hiss + squelch bursts (only with the radio treatment on).
      if (this.fx && (this.open || this.burst > 0)) {
        const white = Math.random() * 2 - 1;
        const n = run(this.noiseBp, white);
        this.flutter += dt * RADIO.flutterHz * 2 * Math.PI;
        let amp = this.open ? RADIO.hiss * (0.75 + 0.25 * Math.sin(this.flutter) + 0.1 * Math.sin(this.flutter * 3.7)) : 0;
        if (this.burst > 0) {
          const k = this.burst / this.burstLen;
          amp += this.burstAmp * k * k;
          this.burst -= dt;
        }
        v += n * amp * 3;
      }

      // Quindar tone (local key-down / key-up).
      if (this.beepLeft > 0) {
        const pos = this.beepLen - this.beepLeft;
        const env = Math.min(1, pos / (0.005 * sampleRate), this.beepLeft / (0.005 * sampleRate));
        this.beepPhase += (2 * Math.PI * this.beepHz) / sampleRate;
        v += Math.sin(this.beepPhase) * 0.22 * env;
        this.beepLeft--;
      }

      v = v > 0.98 || v < -0.98 ? softclip(v) : v;
      out[i] = v;
      const a = v < 0 ? -v : v;
      if (a > this.peak) this.peak = a;
    }

    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);

    this.sinceReport += out.length;
    if (this.sinceReport >= sampleRate / 20) {
      this.port.postMessage({
        level: this.peak,
        queued: this.queue.length + (this.current && this.offset < this.current.length ? 1 : 0),
        open: this.open,
        holding,
      });
      this.peak = 0;
      this.sinceReport = 0;
    }
    return true;
  }
}

registerProcessor('radio-player', RadioPlayer);
