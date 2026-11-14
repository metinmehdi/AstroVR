/**
 * Rocket-flight sound on one device, on the SHARED clock: the real SLS roar from ignition (cut at engine cutoff — no
 * sound in vacuum) and the launch-control voice lines. The phone and Mission Control call this with the same launch
 * moment, so both play every line at the same instant.
 */
import type { FilmPlan } from '../shared/flightFilm';
import { ROAR_URL } from '../shared/flightFilm';
import { sharedNow } from '../shared/clock';
import type { Lang } from '../shared/types';
import type { Playing, VoicePlayer } from './voice';

export function scheduleFlightSound(p: VoicePlayer, plan: FilmPlan, launchAt: number, lang: Lang, gain: { voice: number; roar: number }): () => void {
  const playing: Playing[] = [];
  const timers: number[] = [];
  let cancelled = false;
  const keep = (h: Playing | null) => {
    if (!h) return;
    if (cancelled) h.stop();
    else playing.push(h);
  };
  const alive = () => !cancelled;
  if (gain.roar > 0) {
    void p.playAt(ROAR_URL, launchAt + plan.ignite * 1000, gain.roar, alive).then((h) => {
      keep(h);
      if (!h) return;
      // engines off → silence (fade 1.2 s), on the same shared moment on every device
      timers.push(window.setTimeout(() => h.stop(1.2), Math.max(0, launchAt + plan.meco * 1000 - sharedNow())));
    });
  }
  for (const [id, t] of Object.entries(plan.say)) void p.sayAt(lang, id, launchAt + t * 1000, gain.voice, alive).then(keep);
  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
    playing.forEach((h) => h.stop(0.3));
  };
}
