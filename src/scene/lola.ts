/**
 * REAL terrain height: NASA's 5 m/px Shape-from-Shading elevation of Nobile Rim 1 (PGDA product 104, tied to LRO LOLA),
 * 1280 m × 1280 m around the site (src/data/terrain-nobile.json). Pure (no DOM) → also used by unit tests.
 */
import terrain from '../data/terrain-nobile.json';

export const TERRAIN_SIZE = terrain.sizeM; // metres

/** Real LOLA height (metres relative to the site), bilinear between the samples. */
export function lolaHeight(x: number, z: number): number {
  const n = terrain.n;
  const half = terrain.sizeM / 2;
  const fx = Math.min(n - 1.001, Math.max(0, (x + half) / terrain.stepM));
  const fz = Math.min(n - 1.001, Math.max(0, (z + half) / terrain.stepM));
  const j = Math.floor(fx);
  const i = Math.floor(fz);
  const tx = fx - j;
  const tz = fz - i;
  const H = terrain.heights as number[];
  const a = H[i * n + j];
  const b = H[i * n + j + 1];
  const c = H[(i + 1) * n + j];
  const d = H[(i + 1) * n + j + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
