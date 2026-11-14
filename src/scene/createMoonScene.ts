/**
 * Shared 3D scene (owner: P1). Used by the phone (stereo VR) and by the laptop "helmet cam".
 * REAL NASA data:
 *   - Terrain: LRO LOLA 5 m/px DEM of Nobile Rim 1 (PGDA), 480 m × 480 m around the site (src/data/terrain-nobile.json)
 *     + small procedural detail (≤ 0.25 m) for texture between the 4 m samples
 *   - Sun and Earth: JPL Horizons positions for the mission date; Earth = NASA EPIC photo
 *   - Sky: NASA SVS Deep Star Maps 2020 (real star catalogues), oriented for the lunar south pole
 * Lighting rule of the lunar south pole: the Sun is only a few degrees above the horizon → very long, hard shadows,
 * black sky, almost no ambient light (no atmosphere).
 */
import * as THREE from 'three';
import type { Scenario, SimState } from '../shared/types';
import { MISSION_SKY } from '../shared/realdata';
import terrain from '../data/terrain-nobile.json';
import { createOutpost } from './outpost';

export type Quality = 'low' | 'high';

export interface MoonScene {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  terrainHeight(x: number, z: number): number;
  /** call every frame; state may be null before the first sync */
  update(dt: number, state: SimState | null): void;
  dispose(): void;
}

const TERRAIN_SIZE = terrain.sizeM; // metres (real LOLA crop)
/** Horizon direction from azimuth (from north, clockwise) and elevation. Scene axes: x = east, y = up, z = south. */
function skyDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Real LOLA height (metres relative to the site), bilinear between the 4 m samples. */
function lolaHeight(x: number, z: number): number {
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

/** Small deterministic noise: regolith texture between the real 4 m samples (≤ 0.25 m, documented as procedural). */
function noise2(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
function smoothNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = noise2(xi, zi);
  const b = noise2(xi + 1, zi);
  const c = noise2(xi, zi + 1);
  const d = noise2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function microDetail(x: number, z: number): number {
  return (smoothNoise(x * 0.6, z * 0.6) - 0.5) * 0.3 + (smoothNoise(x * 2.1 + 7, z * 2.1 + 3) - 0.5) * 0.1;
}

/** South ecliptic pole (RA 90°, Dec −66.56°): the Moon's spin axis points close to it → near the zenith at the south pole. */
function skyDirFromRaDec(raDeg: number, decDeg: number): THREE.Vector3 {
  // Deep Star Maps: equirectangular, centre column = RA 0h, RA increasing to the left → u = 0.5 − RA/360
  const u = (((0.5 - raDeg / 360) % 1) + 1) % 1;
  const phi = u * Math.PI * 2;
  const theta = THREE.MathUtils.degToRad(90 - decDeg);
  // SphereGeometry vertex formula, mirrored in x (geometry.scale(-1,1,1)) to view the panorama from inside
  return new THREE.Vector3(Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}

/** Procedural regolith grain (fine pebbles + dust tone variation), tiled every 6 m. Purely visual texture. */
function regolithTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const n = 150 + (noise2(i % 256, Math.floor(i / 256)) - 0.5) * 70;
    img.data.set([n, n * 0.985, n * 0.96, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 220; k++) {
    // small pebbles with a lit side
    const x = noise2(k, 3) * 256;
    const y = noise2(k, 7) * 256;
    const r = 0.8 + noise2(k, 11) * 2.2;
    g.fillStyle = 'rgba(40,38,36,0.55)';
    g.beginPath();
    g.arc(x + 0.8, y + 0.8, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(205,200,192,0.6)';
    g.beginPath();
    g.arc(x, y, r * 0.8, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(terrain.sizeM / 6, terrain.sizeM / 6);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}


/** Small text label floating just above a sky direction. */
function skyLabel(text: string, dir: THREE.Vector3, dist: number, degAbove: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.font = '600 52px system-ui, "Segoe UI Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText(text, 256, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(0.9));
  s.scale.set(h * 5.3, h, 1);
  const up = dir.clone();
  up.y += Math.tan(THREE.MathUtils.degToRad(degAbove));
  s.position.copy(up.normalize()).multiplyScalar(dist);
  return s;
}

/** Soft radial glow texture (sun glare, Earth halo). */
function glowTexture(rgb: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(' + rgb + ',1)');
  grad.addColorStop(0.15, 'rgba(' + rgb + ',0.55)');
  grad.addColorStop(0.45, 'rgba(' + rgb + ',0.12)');
  grad.addColorStop(1, 'rgba(' + rgb + ',0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Earth's phase as seen from the Moon: illuminated fraction k = (1 - cos E)/2, E = Sun-Earth elongation in the lunar
 * sky (both directions from JPL Horizons). The lit limb faces the Sun's direction projected onto the sky.
 */
function drawEarthPhase(c: HTMLCanvasElement, img: HTMLImageElement, sunDir: THREE.Vector3, earthDir: THREE.Vector3) {
  const g = c.getContext('2d')!;
  const R = c.width / 2;
  g.clearRect(0, 0, c.width, c.height);
  g.save();
  g.beginPath();
  g.arc(R, R, R * 0.98, 0, Math.PI * 2);
  g.clip();
  g.drawImage(img, 0, 0, c.width, c.height);
  g.restore();
  const E = sunDir.angleTo(earthDir);
  const k = (1 - Math.cos(E)) / 2;
  const right = new THREE.Vector3().crossVectors(earthDir, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, earthDir).normalize();
  const theta = Math.atan2(-sunDir.dot(up), sunDir.dot(right)); // canvas y grows downward
  g.save();
  g.translate(R, R);
  g.rotate(theta); // +x now points toward the Sun
  g.fillStyle = 'rgba(2,4,10,0.94)';
  const rx = Math.abs(1 - 2 * k) * R;
  g.beginPath();
  g.arc(0, 0, R, Math.PI / 2, (3 * Math.PI) / 2);
  // gibbous: subtract a lit ellipse from the night half; crescent: add a dark ellipse on the Sun side
  g.ellipse(0, 0, rx, R, 0, (3 * Math.PI) / 2, Math.PI / 2, k >= 0.5);
  g.fill();
  g.restore();
}

/** Scattered rocks with an instanced mesh; deterministic, off the routes and the outpost area. */
function createRocks(heightAt: (x: number, z: number) => number, scenario: Scenario, quality: Quality): THREE.InstancedMesh {
  const count = quality === 'high' ? 700 : 420;
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a857e, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const segs: [number, number, number, number][] = [];
  for (const route of Object.values(scenario.routes)) {
    for (let i = 1; i < route.length; i++) {
      const a = scenario.waypoints.find((w) => w.id === route[i - 1])!;
      const b = scenario.waypoints.find((w) => w.id === route[i])!;
      segs.push([a.x, a.z, b.x, b.z]);
    }
  }
  const nearRoute = (x: number, z: number) =>
    segs.some(([ax, az, bx, bz]) => {
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(x - (ax + t * dx), z - (az + t * dz)) < 2.2;
    });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let n = 0;
  for (let i = 0; n < count && i < count * 6; i++) {
    const r = 9 + noise2(i, 1.7) * 140;
    const a = noise2(i, 9.1) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (nearRoute(x, z) || Math.hypot(x - 8, z - 6) < 7 || Math.hypot(x - 24, z - 12) < 7) continue;
    const size = 0.08 + Math.pow(noise2(i, 3.3), 3) * 0.9;
    e.set(noise2(i, 4) * 3, noise2(i, 5) * 3, noise2(i, 6) * 3);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, heightAt(x, z) + size * 0.25, z), q, new THREE.Vector3(size * 1.3, size * 0.7, size));
    mesh.setMatrixAt(n++, m);
  }
  mesh.count = n;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createMoonScene(scenario: Scenario, quality: Quality = 'low'): MoonScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // ---- terrain: REAL LOLA DEM + micro detail
  const heightAt = (x: number, z: number) => lolaHeight(x, z) + microDetail(x, z);
  const seg = quality === 'high' ? 360 : 240;
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const grain = regolithTexture();
  const terrainMesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x9a968f, map: grain, bumpMap: grain, bumpScale: 0.6, roughness: 1, metalness: 0 }),
  );
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  scene.add(terrainMesh);

  // ---- sky: REAL star map (NASA SVS Deep Star Maps 2020), south ecliptic pole at the zenith
  const starTex = new THREE.TextureLoader().load('/textures/starmap.jpg');
  starTex.colorSpace = THREE.SRGBColorSpace;
  const skyGeo = new THREE.SphereGeometry(950, 48, 32);
  skyGeo.scale(-1, 1, 1);
  // tinted darker: the airless lunar sky is black
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: starTex, color: 0x6a6a6a, depthWrite: false, fog: false }));
  sky.quaternion.setFromUnitVectors(skyDirFromRaDec(90, -66.56), new THREE.Vector3(0, 1, 0));
  sky.renderOrder = -1;
  scene.add(sky);

  // ---- Sun: REAL position at the site on the mission date (NASA JPL Horizons) — only a few degrees above the horizon
  const sunDir = skyDirection(MISSION_SKY.sun.azimuthDeg, MISSION_SKY.sun.elevationDeg);
  const sun = new THREE.DirectionalLight(0xfff6e8, 7);
  sun.position.copy(sunDir).multiplyScalar(150);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
  scene.add(sun, sun.target);
  const sunDisk = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sunDisk.position.copy(sunDir).multiplyScalar(850);
  const glare = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture('255,244,220'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  glare.scale.set(170, 170, 1);
  glare.position.copy(sunDisk.position);
  scene.add(sunDisk, glare);
  // no atmosphere → deep shadows; a faint fill (sunlight bounced off the regolith + earthshine) keeps them readable
  scene.add(new THREE.HemisphereLight(0x9aa6c0, 0x2a2622, 0.4));

  // ---- Earth: REAL position (JPL Horizons) + REAL photo (NASA EPIC) with the REAL phase seen from the Moon
  const earthDir = skyDirection(MISSION_SKY.earth.azimuthDeg, MISSION_SKY.earth.elevationDeg);
  const EARTH_DIST = 850;
  const earthSize = 2 * EARTH_DIST * Math.tan(THREE.MathUtils.degToRad(0.95));
  const earthCanvas = document.createElement('canvas');
  earthCanvas.width = earthCanvas.height = 256;
  const earthTex = new THREE.CanvasTexture(earthCanvas);
  earthTex.colorSpace = THREE.SRGBColorSpace;
  const earthImg = new Image();
  earthImg.onload = () => {
    drawEarthPhase(earthCanvas, earthImg, sunDir, earthDir);
    earthTex.needsUpdate = true;
  };
  earthImg.src = '/textures/earth-epic.jpg';
  const earth = new THREE.Sprite(new THREE.SpriteMaterial({ map: earthTex, transparent: true, depthWrite: false }));
  earth.scale.set(earthSize, earthSize, 1);
  earth.position.copy(earthDir).multiplyScalar(EARTH_DIST);
  const earthHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture('120,170,255'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }),
  );
  earthHalo.scale.set(earthSize * 2.6, earthSize * 2.6, 1);
  earthHalo.position.copy(earth.position);
  scene.add(earthHalo, earth);
  // sky labels help kids find the tiny real-size Earth (1.9°) and the Sun on the horizon
  scene.add(skyLabel('🌍 Earth · Yer', earthDir, EARTH_DIST, 3.2), skyLabel('☀️ Sun · Günəş', sunDir, 850, 4.5));

  // ---- the outpost (VSAT mast, greenhouse, antenna, habitat, lander) reacts to Mission Control's switches
  const outpost = createOutpost(heightAt, sunDir);
  scene.add(outpost.group);

  // ---- scattered rocks (procedural, kept off the walking routes and the outpost)
  scene.add(createRocks(heightAt, scenario, quality));

  return {
    scene,
    sun,
    terrainHeight: heightAt,
    update(dt, state) {
      outpost.update(dt, state);
    },
    dispose() {
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
      });
    },
  };
}
