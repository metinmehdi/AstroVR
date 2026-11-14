/**
 * Real NASA data → game inputs. Every value here comes from files in src/data/ written by
 * scripts/fetch-nasa-data.mjs (with source URLs + fetch time in src/data/manifest.json).
 */
import ephin from '../data/ephin-2024-05.json';
import horizons from '../data/horizons-site.json';

/** Real flare start (DONKI 2024-05-11T01:10:00-FLR-001, linked to SEP 2024-05-11T02:10:00-SEP-001). */
export const FLARE_TIME = Date.parse('2024-05-11T01:10:00Z');

/**
 * Storm replay speed: the real storm is replayed 4× faster than the mission clock
 * (1 real second = 4 storm minutes) so that its real ~4 h flare-to-proton delay fits a 7-minute mission.
 * Shown openly in the Science panel.
 */
export const STORM_MINUTES_PER_REAL_SECOND = 4;

/** EPHIN channel widths (MeV) for 25–40.9 and 40.9–53 MeV — the protons that get through a spacesuit. */
const DE_25_41 = 40.9 - 25;
const DE_41_53 = 53 - 40.9;

/**
 * Integral proton intensity 25–53 MeV in (cm² s sr)⁻¹ = Σ I(E)·ΔE over the two high-energy EPHIN channels.
 * Rows: [UTC, I(4.3–7.8), I(7.8–25), I(25–40.9), I(40.9–53)].
 */
function penetratingProtons(row: (string | number)[]): number {
  const a = Number(row[3]);
  const b = Number(row[4]);
  if (!(a >= 0) || !(b >= 0)) return NaN; // fill values are negative
  return a * DE_25_41 + b * DE_41_53;
}

/** [secondsAfterWarning (real s), integral flux 25–53 MeV] from 1 h before the flare to ~20 h after. */
export function buildProtonProfile(): [number, number][] {
  const out: [number, number][] = [];
  for (const row of ephin.rows as (string | number)[][]) {
    const t = Date.parse(String(row[0]));
    const minutesAfterFlare = (t - FLARE_TIME) / 60000;
    if (minutesAfterFlare < -60 || minutesAfterFlare > 20 * 60) continue;
    const p = penetratingProtons(row);
    if (Number.isNaN(p)) continue;
    out.push([Math.max(0, minutesAfterFlare / STORM_MINUTES_PER_REAL_SECOND), round3(p)]);
  }
  // collapse pre-flare samples to t=0 (the warning moment), keep the latest one
  const pre = out.filter(([s]) => s === 0);
  const post = out.filter(([s]) => s > 0);
  return pre.length ? [pre[pre.length - 1], ...post] : post;
}

export const PROTON_PROFILE = buildProtonProfile();
export const PROTON_PEAK = Math.max(...PROTON_PROFILE.map(([, v]) => v));

export interface SkyPos {
  utc: string;
  azimuthDeg: number; // from north, clockwise (east = 90°)
  elevationDeg: number;
}
type Row = [string, number, number];
const toPos = (r: Row): SkyPos => ({ utc: r[0], azimuthDeg: r[1], elevationDeg: r[2] });

/** Real Sun/Earth at the site at fetch time (JPL Horizons). Earth may be below the horizon → no direct comms. */
export const SKY_NOW = { sun: toPos(horizons.sun[0] as Row), earth: toPos(horizons.earth[0] as Row) };

/**
 * Mission date = the next window when BOTH the Sun (power) and the Earth (direct-to-Earth radio) are above the
 * horizon at the site — the same site/date trade-off real lunar mission planners make (JPL Horizons data).
 */
export const MISSION_SKY = (() => {
  const sun = horizons.sun as Row[];
  const earth = horizons.earth as Row[];
  const i = sun.findIndex((s, k) => s[2] > 0.5 && earth[k] && earth[k][2] > 2);
  const k = i < 0 ? 0 : i;
  return { sun: toPos(sun[k]), earth: toPos(earth[k]) };
})();

export const SITE = horizons.site as { name: string; lat: number; lon: number };

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
