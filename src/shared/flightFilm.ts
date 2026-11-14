/**
 * Timing of the rocket flight around the REAL NASA window film (src/data/flight-film.json, built by
 * scripts/build-flight-film.mjs). Shared by the phone (capsule window) and Mission Control (projector), so both
 * follow one clock: t = seconds since the launch command.
 *   0 → filmStart: the capsule on the night pad, ignition, liftoff (3D, like Artemis I's night launch)
 *   filmStart → total: real Artemis I footage in the window (booster separation … Earthrise)
 */
import film from '../data/flight-film.json';
import { FLIGHT_S, FLIGHT_SHORT_S } from './flight';

export const FILM_URL = film.video;
export const ROAR_URL = film.roar;

export interface FilmEvent {
  t: number;
  key: string;
  en: string;
  az: string;
}

export interface FilmPlan {
  total: number;
  ignite: number; // main-engine ignition (T-6.6 s)
  liftoff: number;
  filmStart: number; // real footage begins in the window
  offset: number; // where this edit starts inside flight-film.mp4
  length: number;
  meco: number; // engines off → weightless
  transit: number; // engine burn to the Moon / approaching the Moon
  earthrise: number;
  /** voice line id → time (played by Mission Control) */
  say: Record<string, number>;
  events: FilmEvent[];
}

const r = (n: number) => Math.round(n * 100) / 100;

function build(short: boolean): FilmPlan {
  const edit = short ? film.short : film.full;
  const total = short ? FLIGHT_SHORT_S : FLIGHT_S;
  const filmStart = r(total - edit.length);
  const seg = (what: string) => {
    const s = edit.segments.find((x) => x.what.toLowerCase().includes(what));
    return s ? r(filmStart + s.at) : filmStart;
  };
  const ignite = short ? 0.4 : 3.4;
  const liftoff = short ? 6 : 10;
  const meco = seg('first view of earth');
  const earthrise = seg('earthrise');
  const transit = short ? seg('lunar surface') : seg('approaching the moon');
  const surface = seg('lunar surface');
  const arrival = seg('moon beyond');
  const events: FilmEvent[] = [
    { t: ignite, key: 'ignition', en: 'IGNITION', az: 'ALIŞMA' },
    { t: liftoff, key: 'liftoff', en: 'LIFTOFF', az: 'START' },
    ...(short ? [] : [{ t: liftoff + 5, key: 'maxq', en: 'MAX Q', az: 'MAKS Q' }]),
    { t: filmStart, key: 'boosterSep', en: 'BOOSTER SEPARATION', az: 'BUSTƏRLƏR AYRILDI' },
    { t: meco, key: 'meco', en: 'ENGINES OFF · WEIGHTLESS', az: 'MÜHƏRRİKLƏR SÖNDÜ · ÇƏKİSİZLİK' },
    { t: transit, key: 'moon', en: short ? 'LUNAR FLYBY' : 'APPROACHING THE MOON', az: short ? 'AY ÜZƏRİNDƏN UÇUŞ' : 'AYA YAXINLAŞMA' },
    ...(short ? [] : [{ t: surface, key: 'flyby', en: 'LUNAR FLYBY', az: 'AY ÜZƏRİNDƏN UÇUŞ' }]),
    { t: earthrise, key: 'earthrise', en: 'EARTHRISE', az: 'YERİN DOĞUŞU' },
    { t: arrival, key: 'arrival', en: 'MOON ARRIVAL', az: 'AYA ÇATDIQ' },
  ];
  const say: Record<string, number> = short
    ? { countdown: 1, meco: meco + 0.1, earthrise: earthrise + 0.2 }
    : { countdown: 5, maxQ: liftoff + 5, boosterSep: filmStart + 0.3, meco: meco + 0.1, transit: transit + 0.2, earthrise: earthrise + 0.3 };
  return { total, ignite, liftoff, filmStart, offset: edit.offset, length: edit.length, meco, transit, earthrise, say, events };
}

export const FILM_FULL = build(false);
export const FILM_SHORT = build(true);
export const filmPlan = (short: boolean) => (short ? FILM_SHORT : FILM_FULL);

export const FILM_CREDIT = {
  en: 'Real footage: NASA Artemis I (2022) · Sound: SLS launch-pad microphone, NASA Artemis II (2026)',
  az: 'Real kadrlar: NASA Artemis I (2022) · Səs: SLS start meydançası mikrofonu, NASA Artemis II (2026)',
};
