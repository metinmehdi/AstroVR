/**
 * Voice lines and sound files played at an exact moment of the SHARED clock (src/shared/clock.ts), so the phone and
 * the laptop speak the same line at the same instant. Web Audio buffers (decoded once, after the START tap unlocked
 * the context) → no autoplay blocks on iPhone, no robotic browser voice: a missing file is simply silent.
 * Each device compensates its own output latency (and an optional extra delay, e.g. a Bluetooth speaker).
 */
import { sharedNow } from '../shared/clock';
import type { Lang } from '../shared/types';
import available from './available.json';

const HAS: Record<Lang, Set<string>> = { en: new Set(available.en as string[]), az: new Set(available.az as string[]) };
export const hasVoice = (lang: Lang, id: string) => HAS[lang].has(id);
export const voiceUrl = (lang: Lang, id: string) => `/audio/${lang}/${id}.mp3`;

/**
 * Bytes are fetched as early as possible (page load, before any tap), a few at a time in priority order, and kept
 * here; decoding needs the AudioContext, which only exists after the START tap / the operator's first click.
 */
const bytes = new Map<string, Promise<ArrayBuffer | null>>();
const queue: string[] = [];
let active = 0;
function pump() {
  while (active < 4 && queue.length) {
    const url = queue.shift()!;
    active++;
    // a Range request: some antivirus web filters (Kaspersky) answer plain audio fetches with an empty 204
    const p = fetch(url, { headers: { Range: 'bytes=0-' } })
      .then((r) => (r.ok && r.status !== 204 ? r.arrayBuffer() : null))
      .catch(() => null)
      .finally(() => {
        active--;
        pump();
      });
    resolvers.get(url)?.(p);
  }
}
const resolvers = new Map<string, (p: Promise<ArrayBuffer | null>) => void>();
function fetchBytes(url: string, urgent = false): Promise<ArrayBuffer | null> {
  let p = bytes.get(url);
  if (!p) {
    p = new Promise<ArrayBuffer | null>((res) => resolvers.set(url, (q) => q.then(res)));
    bytes.set(url, p);
    if (urgent) queue.unshift(url);
    else queue.push(url);
    void p.then((b) => {
      resolvers.delete(url);
      if (!b) bytes.delete(url); // retry later
    });
    pump();
  } else if (urgent) {
    const i = queue.indexOf(url);
    if (i > 0) queue.unshift(...queue.splice(i, 1));
  }
  return p;
}

/** start downloading these sounds now (no AudioContext needed); the first ones first */
export function prefetchAudio(urls: string[]) {
  urls.forEach((u) => void fetchBytes(u));
}
export function prefetchLines(lang: Lang, ids: string[]) {
  prefetchAudio(ids.filter((id) => HAS[lang].has(id)).map((id) => voiceUrl(lang, id)));
}

export interface Playing {
  stop(fade?: number): void;
  /** shared-clock ms when it ends */
  end: number;
}

export class VoicePlayer {
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private ready = new Map<string, AudioBuffer>();
  /** extra output delay of this device in ms (Bluetooth speaker ≈ 150–250) */
  extraLatencyMs = 0;

  constructor(
    readonly ctx: AudioContext,
    private out: AudioNode,
  ) {}

  load(url: string, urgent = false): Promise<AudioBuffer | null> {
    let p = this.cache.get(url);
    if (!p) {
      p = fetchBytes(url, urgent)
        .then((b) => (b ? this.ctx.decodeAudioData(b.slice(0)) : Promise.reject(new Error('no data'))))
        .then((buf) => (this.ready.set(url, buf), buf))
        .catch(() => (this.cache.delete(url), null));
      this.cache.set(url, p);
    }
    return p;
  }

  /** decode these lines now (bytes come from the prefetch, in this order) */
  preloadLines(lang: Lang, ids: string[]) {
    for (const id of ids) if (HAS[lang].has(id)) void this.load(voiceUrl(lang, id));
  }

  /** seconds, if decoded */
  duration(url: string): number | null {
    return this.ready.get(url)?.duration ?? null;
  }

  /** AudioContext time at which a sound must start to LEAVE THE SPEAKER at shared time `at` (ms) */
  ctxTimeFor(at: number): number {
    const ctx = this.ctx;
    const ahead = (at - sharedNow()) / 1000;
    const ts = ctx.getOutputTimestamp?.();
    let t: number;
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      // contextTime is the sample leaving the speaker at performanceTime → output latency already included
      t = ts.contextTime + (performance.now() + ahead * 1000 - ts.performanceTime) / 1000;
    } else {
      const lat = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0;
      t = ctx.currentTime + ahead - lat;
    }
    return t - this.extraLatencyMs / 1000;
  }

  /**
   * Play `url` so that it starts at shared time `at`. If that moment has passed (late cue / slow load), it starts
   * at once from the right offset, so both devices stay together; if it is already over, nothing plays.
   */
  async playAt(url: string, at: number, gain = 1, alive: () => boolean = () => true): Promise<Playing | null> {
    const buf = this.ready.get(url) ?? (await this.load(url, true));
    if (!buf || !alive()) return null;
    const ctx = this.ctx;
    if (ctx.state !== 'running') void ctx.resume();
    let when = this.ctxTimeFor(at);
    let offset = 0;
    const now = ctx.currentTime + 0.02;
    if (when < now) {
      offset = now - when;
      when = now;
      if (offset >= buf.duration - 0.2) return null;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.out);
    src.start(when, offset);
    (window as unknown as { __astrovrVoiceLog?: object[] }).__astrovrVoiceLog?.push({ url, at: Math.round(at), late: Math.round(offset * 1000) });
    return {
      end: at + buf.duration * 1000,
      stop: (fade = 0.05) => {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + fade);
        try {
          src.stop(t + fade + 0.02);
        } catch {
          /* not started yet */
        }
      },
    };
  }

  /** a voice line by id (silent if the file does not exist) */
  sayAt(lang: Lang, id: string, at: number, gain = 1, alive?: () => boolean) {
    if (!HAS[lang].has(id)) return Promise.resolve(null);
    return this.playAt(voiceUrl(lang, id), at, gain, alive);
  }

  /** Apollo "Quindar" beep at shared time `at` */
  beepAt(at: number, freq: number, dur = 0.25, vol = 0.12) {
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime + 0.01, this.ctxTimeFor(at));
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol, t + dur - 0.01);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur);
  }
}

/** A CAPCOM radio call on one device: intro beep, the voice, outro beep (same timing everywhere). */
export async function radioCallAt(p: VoicePlayer, lang: Lang, id: string, at: number, gain = 0.95) {
  p.beepAt(at - 300, 2525);
  const playing = await p.sayAt(lang, id, at, gain);
  const end = playing?.end ?? at + 2500;
  p.beepAt(end + 80, 2475);
  return end + 400;
}
