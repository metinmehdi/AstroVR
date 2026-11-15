import { describe, expect, it } from 'vitest';
import { analyseRecording, CAL_GAP_MS, CAL_OFFSET_MS, CAL_ROUNDS } from './calibrate';

/** synthetic microphone: phone beeps (2 kHz) and laptop beeps (3.2 kHz) arriving `delay` ms late, plus noise and echo */
function recording(delayMs: number, sr = 48000) {
  const len = Math.round(sr * 3.6);
  const x = new Float32Array(len);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < len; i++) x[i] = rnd() * 0.02; // room noise
  const burst = (t0: number, f: number, amp: number) => {
    const s0 = Math.round(t0 * sr);
    for (let i = 0; i < Math.round(0.07 * sr); i++) if (s0 + i < len) x[s0 + i] += amp * Math.sin((2 * Math.PI * f * i) / sr);
  };
  for (let r = 0; r < CAL_ROUNDS; r++) {
    const t = 0.25 + (r * CAL_GAP_MS) / 1000 + 0.031; // + phone output/mic latency (cancels out)
    burst(t, 2000, 0.4);
    burst(t + (CAL_OFFSET_MS + delayMs) / 1000, 3200, 0.15); // laptop is farther: quieter
    burst(t + (CAL_OFFSET_MS + delayMs) / 1000 + 0.012, 3200, 0.05); // a wall echo
  }
  return x;
}

describe('sound-sync calibration', () => {
  it('measures the laptop delay within a few ms', () => {
    for (const d of [0, 120, 240]) {
      const ms = analyseRecording(recording(d), 48000);
      expect(ms).not.toBeNull();
      expect(Math.abs((ms as number) - d)).toBeLessThan(8);
    }
  });
  it('reports null when the laptop is silent', () => {
    const x = recording(100);
    // wipe the laptop tones by rebuilding without them
    const sr = 48000;
    const y = new Float32Array(x.length);
    for (let i = 0; i < y.length; i++) y[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1 * 0.01;
    for (let r = 0; r < CAL_ROUNDS; r++) {
      const s0 = Math.round((0.25 + (r * CAL_GAP_MS) / 1000) * sr);
      for (let i = 0; i < 0.07 * sr; i++) y[s0 + i] += 0.4 * Math.sin((2 * Math.PI * 2000 * i) / sr);
    }
    expect(analyseRecording(y, sr)).toBeNull();
  });
});
