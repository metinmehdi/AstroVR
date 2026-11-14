/**
 * Push-to-talk mic capture: float32 at the context rate → 16-bit PCM at 16 kHz,
 * posted every ~40 ms (Google recommends 20–40 ms chunks for the Live API).
 *
 * Adapted from TeatrAi apps/stage/public/worklets/pcm-recorder.js, without the
 * echo detector: push-to-talk is half duplex (the player is silenced the moment
 * the button goes down), so there is nothing to detect.
 *
 * The resampler needs a real anti-alias filter (48k → 16k): two biquad
 * low-pass stages (4th-order Butterworth) at 0.44 × the target rate.
 */

const STAGE_Q = [0.5411961, 1.30656296];

function makeLowpass(fc, q, rate) {
  const w0 = (2 * Math.PI * fc) / rate;
  const cos0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos0) / 2 / a0, b1: (1 - cos0) / a0, b2: (1 - cos0) / 2 / a0,
    a1: (-2 * cos0) / a0, a2: (1 - alpha) / a0,
    x1: 0, x2: 0, y1: 0, y2: 0,
  };
}

function stepBiquad(f, x) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1; f.x1 = x;
  f.y2 = f.y1; f.y1 = y;
  return y;
}

class PttRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options?.processorOptions?.targetRate ?? 16000;
    this.ratio = sampleRate / this.targetRate;
    this.chunkSamples = Math.round(this.targetRate * 0.04);
    this.buffer = new Int16Array(this.chunkSamples);
    this.fill = 0;
    this.peak = 0;
    this.cursor = 0;
    this.prev = 0;
    const fc = Math.min(7000, this.targetRate * 0.44, sampleRate * 0.44);
    this.stages = STAGE_Q.map((q) => makeLowpass(fc, q, sampleRate));
  }

  process(inputs) {
    const mic = inputs[0]?.[0];
    if (!mic) return true;

    for (let i = 0; i < mic.length; i++) {
      let y = mic[i];
      for (const st of this.stages) y = stepBiquad(st, y);
      while (this.cursor < 1) {
        let s = this.prev + (y - this.prev) * this.cursor;
        if (s > 1) s = 1; else if (s < -1) s = -1;
        const a = s < 0 ? -s : s;
        if (a > this.peak) this.peak = a;
        this.buffer[this.fill++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.fill === this.chunkSamples) {
          const out = this.buffer;
          this.port.postMessage({ pcm: out.buffer, peak: this.peak }, [out.buffer]);
          this.buffer = new Int16Array(this.chunkSamples);
          this.fill = 0;
          this.peak = 0;
        }
        this.cursor += this.ratio;
      }
      this.cursor -= 1;
      this.prev = y;
    }
    return true;
  }
}

registerProcessor('ptt-recorder', PttRecorder);
