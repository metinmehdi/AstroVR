/**
 * The REAL landscape around the site out to 60 km (NASA LRO LOLA polar DEM, 80 m/px), as a ring around the
 * walkable 480 m terrain. Built offline by scripts/fetch-nasa-data.mjs ("LOLA horizon ring"):
 *  - heights in the site's tangent frame, Moon curvature included (the horizon drops d²/2R)
 *  - shading baked from the real Sun at the mission window (JPL Horizons), with shadows ray-marched over the DEM,
 *    so dark valleys here are really in shadow at that moment
 * To fit inside the sky sphere, distances beyond 400 m are squashed while every point keeps its true direction
 * (angle) as seen from the site — mountains appear at their real place and real height on the horizon.
 */
import * as THREE from 'three';
import ring from '../data/horizon-ring.json';

const EYE = 1.7;
const NEAR = 400; // metres kept at true scale (seam with the walkable terrain)
const FAR = 760; // squashed distance of the farthest ring (sky sphere: 950 m, Sun/Earth sprites: 850 m)

function squash(r: number): number {
  return r <= NEAR ? r : NEAR + (FAR - NEAR) * (1 - Math.exp(-(r - NEAR) / 12000));
}

/** `localHeight` = the walkable terrain's height function; `half` = its half size (metres). */
export function createHorizon(localHeight: (x: number, z: number) => number, half: number): THREE.Mesh {
  const AZ = ring.az;
  const radii = ring.radii;
  const NR = radii.length;
  const hAt = (i: number, a: number) => ring.heights[i * AZ + a] / 10;

  // per-azimuth offset so the ring meets the walkable terrain edge without a step (faded out by 1 km)
  const off = new Float32Array(AZ);
  const rEdge = new Float32Array(AZ);
  for (let a = 0; a < AZ; a++) {
    const th = (a / AZ) * Math.PI * 2;
    const se = Math.sin(th);
    const cn = Math.cos(th);
    const re = (half - 1) / Math.max(Math.abs(se), Math.abs(cn));
    rEdge[a] = re;
    let i = 0;
    while (i < NR - 2 && radii[i + 1] < re) i++;
    const t = Math.min(1, Math.max(0, (re - radii[i]) / (radii[i + 1] - radii[i])));
    const ringH = hAt(i, a) * (1 - t) + hAt(i + 1, a) * t;
    off[a] = localHeight(se * re, -cn * re) - ringH;
  }

  const pos = new Float32Array(NR * AZ * 3);
  const col = new Float32Array(NR * AZ * 3);
  const albedo = new THREE.Color(0x9a968f).multiplyScalar(0.36); // same regolith as the walkable terrain (× grain texture)
  for (let i = 0; i < NR; i++) {
    const r = radii[i];
    const k = squash(r) / r;
    for (let a = 0; a < AZ; a++) {
      const th = (a / AZ) * Math.PI * 2;
      const x = Math.sin(th) * r; // east
      const z = -Math.cos(th) * r; // scene z = south
      let h = hAt(i, a);
      if (Math.abs(x) < half - 2 && Math.abs(z) < half - 2) h = localHeight(x, z) - 3; // hidden under the walkable terrain
      else h += off[a] * Math.max(0, 1 - (r - rEdge[a]) / 1000);
      const v = (i * AZ + a) * 3;
      pos[v] = x * k;
      pos[v + 1] = EYE + (h - EYE) * k;
      pos[v + 2] = z * k;
      const s = ring.shade[i * AZ + a] / 255;
      const lum = 1.9 * s + 0.07; // sunlight (N·L × lit) + faint fill, tuned to match the lit walkable terrain at the seam
      col[v] = albedo.r * lum;
      col[v + 1] = albedo.g * lum;
      col[v + 2] = albedo.b * lum;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < NR - 1; i++) {
    for (let a = 0; a < AZ; a++) {
      const a2 = (a + 1) % AZ;
      const p = i * AZ + a;
      const q = i * AZ + a2;
      const p2 = (i + 1) * AZ + a;
      const q2 = (i + 1) * AZ + a2;
      idx.push(p, p2, q, q, p2, q2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = 'horizon';
  mesh.frustumCulled = false;
  return mesh;
}

/** The real horizon elevation (degrees) toward an azimuth, from the site (LOLA DEM). */
export function horizonElevation(azimuthDeg: number): number {
  return ring.mask[((Math.round(azimuthDeg) % 360) + 360) % 360];
}
