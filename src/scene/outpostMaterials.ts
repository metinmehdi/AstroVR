/**
 * Real-looking surfaces for the outpost, all generated in code once per page (no downloads, no logos):
 *  - lunarEnv: what shiny parts reflect on the Moon: black sky, grey sunlit regolith below, the low Sun
 *  - MLI / beta cloth: the quilted white blanket that wraps real spacecraft and habitats
 *  - crinkled gold foil (descent stages), solar cells, interior wall panels, floor grating, regolith bags, truss
 * Plus `bake()`: merges a structure's static parts into one mesh per material (few draw calls → smooth on phones).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb: boolean, repeat: [number, number] = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

/** the same image with another tiling */
export function tiled<T extends THREE.Texture>(t: T, rx: number, ry: number): T {
  const c = t.clone() as T;
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

/* ------------------------------------------------------------------ environment */
let env: THREE.CubeTexture | null = null;
/** reflections: airless black sky, sunlit grey regolith below the horizon, the low Sun near the horizon */
export function lunarEnv(sunDir: THREE.Vector3): THREE.CubeTexture {
  if (env) return env;
  const N = 64;
  const faces: HTMLCanvasElement[] = [];
  const sun = new THREE.Vector3(-sunDir.x, sunDir.y, sunDir.z).normalize(); // three mirrors x for cube textures
  const d = new THREE.Vector3();
  for (let f = 0; f < 6; f++) {
    const [c, g] = canvas(N, N);
    const img = g.createImageData(N, N);
    for (let v = 0; v < N; v++)
      for (let u = 0; u < N; u++) {
        const sc = (2 * (u + 0.5)) / N - 1;
        const tc = (2 * (v + 0.5)) / N - 1;
        if (f === 0) d.set(1, -tc, -sc);
        else if (f === 1) d.set(-1, -tc, sc);
        else if (f === 2) d.set(sc, 1, tc);
        else if (f === 3) d.set(sc, -1, -tc);
        else if (f === 4) d.set(sc, -tc, 1);
        else d.set(-sc, -tc, -1);
        d.normalize();
        let r = 0;
        let gg = 0;
        let b = 0;
        if (d.y < 0) {
          // regolith: brighter toward the horizon (seen at grazing angles), a little brighter on the Sun's side
          const k = 70 + 40 * (1 + d.y) + 25 * Math.max(0, d.x * sun.x + d.z * sun.z);
          r = k;
          gg = k * 0.97;
          b = k * 0.92;
        } else {
          const s = d.dot(sun);
          const glow = 255 * Math.pow(Math.max(0, s), 900) + 60 * Math.pow(Math.max(0, s), 60);
          r = glow;
          gg = glow * 0.97;
          b = glow * 0.9;
        }
        const o = (v * N + u) * 4;
        img.data[o] = Math.min(255, r);
        img.data[o + 1] = Math.min(255, gg);
        img.data[o + 2] = Math.min(255, b);
        img.data[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    faces.push(c);
  }
  env = new THREE.CubeTexture(faces);
  env.colorSpace = THREE.SRGBColorSpace;
  env.needsUpdate = true;
  return env;
}

/* ------------------------------------------------------------------ MLI / beta cloth */
let mliCache: { map: THREE.Texture; bump: THREE.Texture } | null = null;
/** quilted multi-layer insulation: white beta cloth, stitched in pillows, a few tape seams and soft wrinkles */
export function mliTextures() {
  if (mliCache) return mliCache;
  const N = 512;
  const CELL = 128;
  const rnd = mulberry32(7);
  const [cc, cg] = canvas(N, N);
  const [bc, bg] = canvas(N, N);
  cg.fillStyle = '#dedcd5';
  cg.fillRect(0, 0, N, N);
  bg.fillStyle = '#000';
  bg.fillRect(0, 0, N, N);
  for (let y = 0; y < N; y += CELL)
    for (let x = 0; x < N; x += CELL) {
      // each pillow: slightly different tone, puffed in the middle
      const tone = 214 + Math.floor(rnd() * 16);
      cg.fillStyle = `rgb(${tone},${tone - 2},${tone - 8})`;
      cg.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      const gr = bg.createRadialGradient(x + CELL / 2, y + CELL / 2, 4, x + CELL / 2, y + CELL / 2, CELL * 0.72);
      gr.addColorStop(0, '#fff');
      gr.addColorStop(1, '#202020');
      bg.fillStyle = gr;
      bg.fillRect(x, y, CELL, CELL);
      const sh = cg.createRadialGradient(x + CELL * 0.4, y + CELL * 0.4, 6, x + CELL / 2, y + CELL / 2, CELL * 0.75);
      sh.addColorStop(0, 'rgba(255,255,255,0.10)');
      sh.addColorStop(1, 'rgba(60,55,50,0.16)');
      cg.fillStyle = sh;
      cg.fillRect(x, y, CELL, CELL);
    }
  // stitches along the seams
  cg.fillStyle = 'rgba(90,86,78,0.55)';
  bg.fillStyle = '#000';
  for (let k = 0; k <= N; k += CELL)
    for (let s = 0; s < N; s += 8) {
      cg.fillRect(k - 1, s, 2, 4);
      cg.fillRect(s, k - 1, 4, 2);
      bg.fillRect(k - 2, s, 4, 5);
      bg.fillRect(s, k - 2, 5, 4);
    }
  // soft wrinkles
  for (let i = 0; i < 60; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const a = rnd() * Math.PI;
    const len = 20 + rnd() * 50;
    for (const [ctx, col, w] of [
      [cg, 'rgba(120,115,105,0.18)', 2],
      [bg, 'rgba(0,0,0,0.35)', 3],
    ] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (rnd() - 0.5) * 12, y + Math.sin(a) * len * 0.5 + (rnd() - 0.5) * 12, x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
  }
  // a strip of aluminised tape
  cg.fillStyle = 'rgba(190,192,196,0.85)';
  cg.fillRect(0, CELL * 2 - 9, N, 18);
  mliCache = { map: tex(cc, true), bump: tex(bc, false) };
  return mliCache;
}

export function mliMaterial(sunDir: THREE.Vector3, rx: number, ry: number, tint = 0xffffff) {
  const t = mliTextures();
  return new THREE.MeshStandardMaterial({
    color: tint,
    map: tiled(t.map, rx, ry),
    bumpMap: tiled(t.bump, rx, ry),
    bumpScale: 1.2,
    roughness: 0.88,
    metalness: 0,
    envMap: lunarEnv(sunDir),
    envMapIntensity: 0.6,
  });
}

/* ------------------------------------------------------------------ crinkled gold foil */
let foilCache: { map: THREE.Texture; bump: THREE.Texture } | null = null;
export function foilTextures() {
  if (foilCache) return foilCache;
  const N = 256;
  const G = 14; // cells per side
  const rnd = mulberry32(11);
  const pts: { x: number; y: number; tone: number; gx: number; gy: number }[] = [];
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) pts.push({ x: (i + rnd()) / G, y: (j + rnd()) / G, tone: rnd(), gx: rnd() * 2 - 1, gy: rnd() * 2 - 1 });
  const [cc, cg] = canvas(N, N);
  const [bc, bg] = canvas(N, N);
  const ci = cg.createImageData(N, N);
  const bi = bg.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const ci0 = Math.floor(u * G);
      const cj0 = Math.floor(v * G);
      let best = 9;
      let second = 9;
      let bp = pts[0];
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = (ci0 + di + G) % G;
          const jj = (cj0 + dj + G) % G;
          const p = pts[jj * G + ii];
          // wrap-around distance (tileable)
          let dx = Math.abs(u - p.x);
          let dy = Math.abs(v - p.y);
          dx = Math.min(dx, 1 - dx);
          dy = Math.min(dy, 1 - dy);
          const dd = dx * dx + dy * dy;
          if (dd < best) {
            second = best;
            best = dd;
            bp = p;
          } else if (dd < second) second = dd;
        }
      const edge = Math.sqrt(second) - Math.sqrt(best); // 0 on a crease
      const crease = Math.min(1, edge * G * 4);
      const facet = 0.5 + 0.35 * (bp.gx * (u - bp.x) + bp.gy * (v - bp.y)) * G;
      const o = (y * N + x) * 4;
      const k = (0.7 + 0.45 * bp.tone) * (0.75 + 0.25 * crease);
      ci.data[o] = Math.min(255, 228 * k);
      ci.data[o + 1] = Math.min(255, 168 * k);
      ci.data[o + 2] = Math.min(255, 62 * k);
      ci.data[o + 3] = 255;
      const h = Math.max(0, Math.min(255, (facet * 0.7 + crease * 0.3) * 255));
      bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = h;
      bi.data[o + 3] = 255;
    }
  cg.putImageData(ci, 0, 0);
  bg.putImageData(bi, 0, 0);
  foilCache = { map: tex(cc, true), bump: tex(bc, false) };
  return foilCache;
}

export function foilMaterial(sunDir: THREE.Vector3, rx: number, ry: number) {
  const t = foilTextures();
  return new THREE.MeshStandardMaterial({
    map: tiled(t.map, rx, ry),
    bumpMap: tiled(t.bump, rx, ry),
    bumpScale: 2.5,
    metalness: 1,
    roughness: 0.32,
    envMap: lunarEnv(sunDir),
    envMapIntensity: 1.2,
  });
}

/* ------------------------------------------------------------------ solar cells */
/** dark blue cells, silver busbars and gaps (a real array, not a grid of lines) */
export function solarCellCanvas(): HTMLCanvasElement {
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#4a5160';
  g.fillRect(0, 0, 256, 512);
  const rnd = mulberry32(3);
  const S = 31;
  for (let y = 4; y + S <= 508; y += S + 2)
    for (let x = 4; x + S <= 252; x += S + 2) {
      const k = 0.85 + rnd() * 0.3;
      const gr = g.createLinearGradient(x, y, x + S, y + S);
      gr.addColorStop(0, `rgb(${Math.floor(22 * k)},${Math.floor(42 * k)},${Math.floor(98 * k)})`);
      gr.addColorStop(1, `rgb(${Math.floor(12 * k)},${Math.floor(26 * k)},${Math.floor(70 * k)})`);
      g.fillStyle = gr;
      g.fillRect(x, y, S, S);
      g.fillStyle = 'rgba(190,196,208,0.4)'; // two busbars per cell
      g.fillRect(x + S / 3, y, 1, S);
      g.fillRect(x + (2 * S) / 3, y, 1, S);
      g.fillStyle = 'rgba(180,190,210,0.12)'; // fine fingers
      for (let f = y + 3; f < y + S; f += 4) g.fillRect(x, f, S, 1);
    }
  g.strokeStyle = '#8f96a3';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 252, 508);
  return c;
}

/* ------------------------------------------------------------------ interior panels */
let panelCache: { map: THREE.Texture; bump: THREE.Texture } | null = null;
/** spacecraft interior: off-white panels, seams, fasteners, placards, velcro patches (≈ 3 m × 1.5 m per tile) */
export function interiorTextures() {
  if (panelCache) return panelCache;
  const W = 1024;
  const H = 512;
  const rnd = mulberry32(5);
  const [cc, g] = canvas(W, H);
  const [bc, b] = canvas(W, H);
  g.fillStyle = '#5e5f62';
  g.fillRect(0, 0, W, H);
  b.fillStyle = '#000';
  b.fillRect(0, 0, W, H);
  const cols = [0, 230, 470, 700, 1024];
  const rows = [0, 250, 512];
  for (let r = 0; r < rows.length - 1; r++)
    for (let cI = 0; cI < cols.length - 1; cI++) {
      const x = cols[cI] + 5;
      const y = rows[r] + 5;
      const w = cols[cI + 1] - cols[cI] - 10;
      const h = rows[r + 1] - rows[r] - 10;
      const tone = 176 + Math.floor(rnd() * 16);
      g.fillStyle = `rgb(${tone},${tone - 1},${tone - 6})`;
      g.fillRect(x, y, w, h);
      // bevel
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x, y, w, 3);
      g.fillRect(x, y, 3, h);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x, y + h - 3, w, 3);
      g.fillRect(x + w - 3, y, 3, h);
      b.fillStyle = '#d0d0d0';
      b.fillRect(x + 3, y + 3, w - 6, h - 6);
      // fasteners at the corners
      for (const [fx, fy] of [
        [x + 12, y + 12],
        [x + w - 12, y + 12],
        [x + 12, y + h - 12],
        [x + w - 12, y + h - 12],
      ]) {
        g.fillStyle = '#7d7c78';
        g.beginPath();
        g.arc(fx, fy, 5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.fillRect(fx - 2, fy - 2, 2, 2);
        b.fillStyle = '#fff';
        b.beginPath();
        b.arc(fx, fy, 5, 0, Math.PI * 2);
        b.fill();
      }
      const what = rnd();
      if (what < 0.35) {
        // placard: dark plate with small light "text" lines (generic, no logos)
        const px = x + 30 + rnd() * (w - 150);
        const py = y + 30 + rnd() * (h - 90);
        g.fillStyle = '#2a2d33';
        g.fillRect(px, py, 110, 46);
        g.fillStyle = 'rgba(230,232,236,0.85)';
        for (let l = 0; l < 4; l++) g.fillRect(px + 8, py + 8 + l * 9, 40 + rnd() * 55, 3);
      } else if (what < 0.65) {
        // velcro patches (things are stuck to the walls in a spacecraft)
        g.fillStyle = '#8a867c';
        for (let k = 0; k < 3; k++) g.fillRect(x + 25 + rnd() * (w - 70), y + 25 + rnd() * (h - 50), 34, 22);
      } else if (what < 0.75) {
        // yellow/black caution stripes along the bottom edge
        g.save();
        g.beginPath();
        g.rect(x, y + h - 28, w, 20);
        g.clip();
        g.fillStyle = '#e0b21f';
        g.fillRect(x, y + h - 28, w, 20);
        g.fillStyle = '#1b1b1b';
        for (let s = x - 20; s < x + w; s += 24) {
          g.beginPath();
          g.moveTo(s, y + h - 8);
          g.lineTo(s + 12, y + h - 8);
          g.lineTo(s + 32, y + h - 28);
          g.lineTo(s + 20, y + h - 28);
          g.fill();
        }
        g.restore();
      }
    }
  // scuffs
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(80,76,70,${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 14, 1 + rnd() * 3);
  }
  panelCache = { map: tex(cc, true), bump: tex(bc, false) };
  return panelCache;
}

/** floor: dark anti-slip diamond plate */
export function floorTexture(): { map: THREE.Texture; bump: THREE.Texture } {
  const [cc, g] = canvas(128, 128);
  const [bc, b] = canvas(128, 128);
  g.fillStyle = '#44474c';
  g.fillRect(0, 0, 128, 128);
  b.fillStyle = '#000';
  b.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16)
    for (let x = 0; x < 128; x += 16) {
      const o = (y / 16) % 2 ? 8 : 0;
      g.save();
      g.translate(x + o + 4, y + 8);
      g.rotate((((x + y) / 16) % 2 ? 1 : -1) * 0.785);
      g.fillStyle = '#5d6168';
      g.fillRect(-5, -1.5, 10, 3);
      g.restore();
      b.save();
      b.translate(x + o + 4, y + 8);
      b.rotate((((x + y) / 16) % 2 ? 1 : -1) * 0.785);
      b.fillStyle = '#fff';
      b.fillRect(-5, -1.5, 10, 3);
      b.restore();
    }
  return { map: tex(cc, true, [10, 10]), bump: tex(bc, false, [10, 10]) };
}

/** lattice truss (alpha-tested): a light mast you can see through */
export function trussTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 128);
  g.clearRect(0, 0, 64, 128);
  g.strokeStyle = '#d8dce2';
  g.lineWidth = 7;
  g.strokeRect(3, -4, 58, 136);
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(4, 0);
  g.lineTo(60, 64);
  g.lineTo(4, 128);
  g.moveTo(4, 64);
  g.lineTo(60, 64);
  g.stroke();
  const t = tex(c, true);
  return t;
}

/** regolith-filled bags (radiation shielding berms): dusty grey cloth */
export function bagMaterial(sunDir: THREE.Vector3) {
  const t = mliTextures();
  return new THREE.MeshStandardMaterial({ color: 0x8f8a80, bumpMap: tiled(t.bump, 2, 1), bumpScale: 1.5, roughness: 1, metalness: 0, envMap: lunarEnv(sunDir), envMapIntensity: 0.3 });
}

/* ------------------------------------------------------------------ helpers */
/** a cylinder from a to b (struts, legs, rails) */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, seg = 8): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/**
 * Merge every (non-instanced) mesh under `src` into one mesh per material, in `src`'s own frame.
 * The result casts and receives shadows. Moving parts must stay out of `src`.
 */
export function bake(src: THREE.Object3D): THREE.Group {
  src.updateMatrixWorld(true);
  const inv = src.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const out = new THREE.Group();
  src.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
    let g = o.geometry as THREE.BufferGeometry;
    g = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const m = o.material as THREE.Material;
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m)!.push(g);
  });
  for (const [m, gs] of byMat) {
    const merged = mergeGeometries(gs, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}
