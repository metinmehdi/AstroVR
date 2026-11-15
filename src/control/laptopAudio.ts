/**
 * Mission Control's synchronized voice output: the same lines as the headset, at the same instant (shared clock).
 * The AudioContext opens on the operator's first click/key (browser autoplay rule). An extra output delay for a
 * Bluetooth speaker can be set with ?audioDelay=ms (saved in this browser).
 */
import { FLIGHT, RADIO, STORY, SUIT } from '../audio/lines';
import { VoicePlayer, prefetchAudio, prefetchLines } from '../audio/voice';
import { playLaptopBeeps } from '../audio/calibrate';
import { sharedNow } from '../shared/clock';
import { makeId } from '../shared/protocol';
import type { Transport } from '../shared/transport/types';
import { ROAR_URL } from '../shared/flightFilm';
import type { Lang } from '../shared/types';

const ALL_LINES = [...Object.keys(FLIGHT), ...Object.keys(STORY), ...Object.keys(SUIT), ...Object.keys(RADIO)];
let player: VoicePlayer | null = null;
let lang: Lang = 'en';

function storedDelay(): number {
  const q = new URLSearchParams(location.search).get('audioDelay');
  try {
    if (q !== null) localStorage.setItem('astrovr.audioDelay', q);
    return Number(q ?? localStorage.getItem('astrovr.audioDelay') ?? 0) || 0;
  } catch {
    return Number(q) || 0;
  }
}

function unlock() {
  if (player) {
    if (player.ctx.state === 'suspended') void player.ctx.resume();
    return;
  }
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  player = new VoicePlayer(ctx, master);
  player.extraLatencyMs = storedDelay();
  player.preloadLines(lang, ALL_LINES);
  void player.load(ROAR_URL);
}

/** call once at startup: the first operator gesture opens the audio */
export function installLaptopAudio() {
  prefetchLines(lang, ALL_LINES);
  prefetchAudio([ROAR_URL]);
  const once = () => unlock();
  addEventListener('pointerdown', once, { capture: true });
  addEventListener('keydown', once, { capture: true });
}

export function laptopVoice(): VoicePlayer | null {
  return player;
}

/** current extra output delay of this laptop (ms), null if never calibrated */
export function laptopDelay(): number | null {
  try {
    const v = localStorage.getItem('astrovr.audioDelay');
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

/**
 * Sound-sync calibration with the phone's microphone (src/audio/calibrate.ts). Resolves with the new delay (ms) or
 * null if the phone could not hear both beeps clearly (quiet room helps; phone near the laptop speaker).
 */
export function calibrateWithPhone(transport: Transport): Promise<number | null> {
  unlock();
  const p = player!;
  const id = makeId();
  const at = sharedNow() + 3200; // time for the phone to open its microphone
  transport.sendFast({ k: 'cal', id, at });
  setTimeout(() => transport.sendFast({ k: 'cal', id, at }), 150);
  playLaptopBeeps(p, at);
  return new Promise((resolve) => {
    const off = transport.onFast((m) => {
      if (m.k !== 'calres' || m.id !== id) return;
      off();
      clearTimeout(timer);
      if (m.ms === null) return resolve(null);
      const next = Math.max(-300, Math.min(800, Math.round(p.extraLatencyMs + m.ms)));
      p.extraLatencyMs = next;
      try {
        localStorage.setItem('astrovr.audioDelay', String(next));
      } catch {
        /* private mode */
      }
      resolve(next);
    });
    const timer = setTimeout(() => {
      off();
      resolve(null);
    }, 12000);
  });
}

export function setLaptopAudioLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  prefetchLines(l, ALL_LINES);
  player?.preloadLines(l, ALL_LINES);
}
