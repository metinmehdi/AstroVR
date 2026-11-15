/**
 * Lunar rocks and boulders: five distinct procedural shapes (noise-displaced, flattened icosahedra) in regolith
 * material, scattered with a lunar-like size-frequency (many pebbles, few boulders), off the walking routes.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Scenario } from '../shared/types';
import { makeLunar } from './lunarSurface';

/** good-quality deterministic PRNG (sequential sin-hashes line up into visible rows) */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(x: number, y: number, s: number) {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}
function noise3(x: number, y: number, z: number, s: number) {
  // cheap smooth 3D value noise
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const h = (a: number, b: number, c: number) => hash(a + c * 57.3, b - c * 13.1, s);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

function rockGeometry(seed: number, detail: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position as THREE.BufferAttribute;
  const flat = 0.55 + hash(seed, 1, 3) * 0.3;
  const stretch = 0.8 + hash(seed, 2, 3) * 0.5;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n =
      (noise3(x * 1.6 + seed, y * 1.6, z * 1.6, seed) - 0.5) * 0.55 +
      (noise3(x * 3.7, y * 3.7 + seed, z * 3.7, seed + 1) - 0.5) * 0.22 +
      (noise3(x * 8, y * 8, z * 8 + seed, seed + 2) - 0.5) * 0.07;
    // facets: planar chips like real impact-broken rock
    const chip = Math.max(0, x * Math.cos(seed) + z * Math.sin(seed) - 0.55) * 0.5;
    const r = 1 + n - chip;
    p.setXYZ(i, x * r * stretch, y * r * flat - (y < -0.2 ? (y + 0.2) * 0.4 : 0), z * r);
  }
  g.computeVertexNormals();
  // planar uv in metres-ish (regolith texture on the rock)
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * 0.5 + p.getY(i) * 0.25;
    uv[i * 2 + 1] = p.getZ(i) * 0.5 - p.getY(i) * 0.25;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function createRocks(
  heightAt: (x: number, z: number) => number,
  scenario: Scenario,
  quality: 'low' | 'high',
  extent: number,
  /** extra paths to keep clear (the rover's loop), as segments [ax, az, bx, bz] */
  keepClear: [number, number, number, number][] = [],
): THREE.Group {
  const group = new THREE.Group();
  const VARIANTS = 5;
  const total = quality === 'high' ? 1100 : 650;
  const mat = makeLunar(new THREE.MeshStandardMaterial({ color: 0x7d7a75 }), { uvMetres: 1, tile: 0.9, detailStrength: 0.7 });
  const segs: [number, number, number, number][] = [];
  for (const route of Object.values(scenario.routes)) {
    for (let i = 1; i < route.length; i++) {
      const a = scenario.waypoints.find((w) => w.id === route[i - 1])!;
      const b = scenario.waypoints.find((w) => w.id === route[i])!;
      segs.push([a.x, a.z, b.x, b.z]);
    }
  }
  segs.push(...keepClear);
  const clearance = (x: number, z: number) =>
    Math.min(
      ...segs.map(([ax, az, bx, bz]) => {
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
      }),
    );
  const buckets: THREE.Matrix4[][] = Array.from({ length: VARIANTS }, () => []);
  const colors: THREE.Color[][] = Array.from({ length: VARIANTS }, () => []);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const rnd = mulberry32(1969);
  for (let i = 0, n = 0; n < total && i < total * 8; i++) {
    // radius: dense near the outpost, thinning out; boulders mostly farther away
    const r = 6 + Math.pow(rnd(), 1.4) * Math.min(extent * 0.45, 260);
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // size-frequency: N(>D) ~ D^-2.5  → mostly 5–30 cm, a few metre-class boulders
    const u = rnd();
    const big = rnd();
    let size = 0.05 + 0.25 * Math.pow(u, 6) + (u > 0.985 ? 0.6 + big * 1.6 : 0);
    if (r < 25) size = Math.min(size, 0.5);
    if (clearance(x, z) < 1.6 + size || Math.hypot(x - 8, z - 6) < 7 || Math.hypot(x - 24, z - 12) < 7 || Math.hypot(x, z) < 4.5) continue;
    if (Math.hypot(x + 7, z + 8) < 4 || Math.hypot(x + 9, z - 2) < 3.5 || Math.hypot(x - 7, z + 3) < 3) continue;
    e.set(rnd() * 0.6, rnd() * Math.PI * 2, rnd() * 0.6);
    q.setFromEuler(e);
    const sink = size * (0.25 + rnd() * 0.2); // partly buried
    m.compose(new THREE.Vector3(x, heightAt(x, z) + size * 0.55 - sink, z), q, new THREE.Vector3(size, size, size));
    const v = n % VARIANTS;
    buckets[v].push(m.clone());
    const tone = 0.8 + rnd() * 0.35; // fresh rocks brighter, old ones darker
    colors[v].push(new THREE.Color(tone, tone * 0.99, tone * 0.97));
    n++;
  }
  for (let v = 0; v < VARIANTS; v++) {
    const geo = rockGeometry(v * 7.3 + 1, quality === 'high' ? 2 : 1); // 320 / 80 faces: most rocks are pebbles
    const mesh = new THREE.InstancedMesh(geo, mat, buckets[v].length);
    buckets[v].forEach((mm, k) => {
      mesh.setMatrixAt(k, mm);
      mesh.setColorAt(k, colors[v][k]);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** a single sample rock (mission targets A/B): same procedural shape family, larger */
export function sampleRockGeometry(seed: number): THREE.BufferGeometry {
  return rockGeometry(seed, 3);
}
export function sampleRockMaterial(color: number): THREE.MeshStandardMaterial {
  return makeLunar(new THREE.MeshStandardMaterial({ color }), { uvMetres: 1, tile: 0.6, detailStrength: 0.6 });
}
