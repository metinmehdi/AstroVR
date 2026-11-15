/**
 * Automatic sound-sync calibration (browsers cannot see HDMI / Bluetooth / projector audio delay).
 * Mission Control asks; on the shared clock the PHONE beeps at T (2 kHz) and the LAPTOP beeps at T + 350 ms (3.2 kHz),
 * three times. The phone's microphone hears both; the gap between the two onsets, minus 350 ms, is how much later the
 * laptop's sound really comes out than the phone's. Both onsets go through the same microphone, so its own latency
 * cancels. Mission Control then plays that much earlier (VoicePlayer.extraLatencyMs).
 */
import type { VoicePlayer } from './voice';

export const CAL_ROUNDS = 3;
export const CAL_GAP_MS = 750;
export const CAL_OFFSET_MS = 350;
const F_PHONE = 2000;
const F_LAPTOP = 3200;

/** laptop side: the three laptop beeps */
export function playLaptopBeeps(p: VoicePlayer, at: number) {
  for (let i = 0; i < CAL_ROUNDS; i++) p.beepAt(at + i * CAL_GAP_MS + CAL_OFFSET_MS, F_LAPTOP, 0.07, 0.5);
}

/** Goertzel power of one frequency over a block */
function goertzel(x: Float32Array, start: number, n: number, f: number, sr: number) {
  const k = 2 * Math.cos((2 * Math.PI * f) / sr);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s = x[start + i] + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - k * s1 * s2;
}

/** onset times (s) of short tone bursts of frequency f in x */
function onsets(x: Float32Array, sr: number, f: number): number[] {
  const hop = 64;
  const win = 256;
  const e: number[] = [];
  for (let i = 0; i + win < x.length; i += hop) e.push(goertzel(x, i, win, f, sr));
  const sorted = [...e].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.5)] + 1e-9;
  const peak = sorted[sorted.length - 1];
  const th = Math.max(floor * 30, peak * 0.2);
  const out: number[] = [];
  let quiet = 99;
  for (let j = 0; j < e.length; j++) {
    if (e[j] > th && quiet > 20) {
      // refine: first hop above 10 % of this burst's maximum
      let m = j;
      for (let q = j; q < Math.min(e.length, j + 12); q++) if (e[q] > e[m]) m = q;
      let s = j;
      while (s > 0 && e[s - 1] > e[m] * 0.1) s--;
      out.push((s * hop + win / 2) / sr);
      quiet = 0;
    } else if (e[j] < th) quiet++;
    else quiet = 0;
  }
  return out;
}

/**
 * Phone side: play our beeps and record the microphone around them.
 * Returns the laptop's extra delay in ms (positive = laptop sounds later), or null if the beeps were not heard clearly.
 */
export async function measureOnPhone(p: VoicePlayer, mic: MediaStream, at: number, sharedNowFn: () => number): Promise<number | null> {
  const ctx = p.ctx;
  if (ctx.state !== 'running') await ctx.resume();
  const src = ctx.createMediaStreamSource(mic);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const chunks: Float32Array[] = [];
  let recording = false;
  proc.onaudioprocess = (ev) => {
    if (recording) chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
  };
  src.connect(proc).connect(mute).connect(ctx.destination);
  for (let i = 0; i < CAL_ROUNDS; i++) p.beepAt(at + i * CAL_GAP_MS, F_PHONE, 0.07, 0.5);
  // record from just before the first beep to well after the last
  await new Promise((r) => setTimeout(r, Math.max(0, at - 250 - sharedNowFn())));
  recording = true;
  await new Promise((r) => setTimeout(r, CAL_ROUNDS * CAL_GAP_MS + CAL_OFFSET_MS + 900));
  recording = false;
  proc.disconnect();
  src.disconnect();
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const x = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    x.set(c, o);
    o += c.length;
  }
  return analyseRecording(x, ctx.sampleRate);
}

/** the laptop's extra delay (ms) from a microphone recording of the beeps, or null if unclear */
export function analyseRecording(x: Float32Array, sr: number): number | null {
  const a = onsets(x, sr, F_PHONE);
  const b = onsets(x, sr, F_LAPTOP);
  const deltas: number[] = [];
  for (const ta of a) {
    const tb = b.find((t) => t > ta + 0.1 && t < ta + 0.7); // the laptop beep that belongs to this round
    if (tb !== undefined) deltas.push((tb - ta) * 1000 - CAL_OFFSET_MS);
  }
  if (deltas.length < 2) return null;
  deltas.sort((u, v) => u - v);
  const med = deltas[Math.floor(deltas.length / 2)];
  if (deltas[deltas.length - 1] - deltas[0] > 60) return null; // inconsistent (noise/echo)
  return Math.round(med);
}
