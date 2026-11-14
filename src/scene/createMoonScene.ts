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

export function createMoonScene(scenario: Scenario, quality: Quality = 'low'): MoonScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  void scenario;

  // ---- terrain: REAL LOLA DEM + micro detail
  const heightAt = (x: number, z: number) => lolaHeight(x, z) + microDetail(x, z);
  const seg = quality === 'high' ? 360 : 240;
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const terrainMesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x8f8c87, roughness: 1, metalness: 0 }),
  );
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  scene.add(terrainMesh);

  // ---- sky: REAL star map (NASA SVS Deep Star Maps 2020), south ecliptic pole at the zenith
  const starTex = new THREE.TextureLoader().load('/textures/starmap.jpg');
  starTex.colorSpace = THREE.SRGBColorSpace;
  const skyGeo = new THREE.SphereGeometry(950, 48, 32);
  skyGeo.scale(-1, 1, 1);
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: starTex, color: 0x6a6a6a, depthWrite: false, fog: false }) // darker: airless black sky);
  sky.quaternion.setFromUnitVectors(skyDirFromRaDec(90, -66.56), new THREE.Vector3(0, 1, 0));
  sky.renderOrder = -1;
  scene.add(sky);

  // ---- Sun: REAL position at the site on the mission date (NASA JPL Horizons) — only a few degrees above the horizon
  const sunDir = skyDirection(MISSION_SKY.sun.azimuthDeg, MISSION_SKY.sun.elevationDeg);
  const sun = new THREE.DirectionalLight(0xfff6e8, 3.2);
  sun.position.copy(sunDir).multiplyScalar(150);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
  scene.add(sun, sun.target);
  const sunDisk = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sunDisk.position.copy(sunDir).multiplyScalar(850);
  scene.add(sunDisk);
  scene.add(new THREE.AmbientLight(0x223344, 0.04)); // no atmosphere → near-black shadows

  // ---- Earth: REAL position (JPL Horizons) + REAL photo of Earth (NASA EPIC camera on DSCOVR, public/textures/earth-epic.jpg).
  // Apparent size from the Moon ≈ 1.9°. TODO(P1): EPIC shows the full day side; the real phase seen from the Moon differs.
  const earthTex = new THREE.TextureLoader().load('/textures/earth-epic.jpg');
  earthTex.colorSpace = THREE.SRGBColorSpace;
  const earth = new THREE.Sprite(new THREE.SpriteMaterial({ map: earthTex, transparent: true, depthWrite: false }));
  const EARTH_DIST = 850;
  const earthSize = 2 * EARTH_DIST * Math.tan(THREE.MathUtils.degToRad(0.95));
  earth.scale.set(earthSize, earthSize, 1);
  earth.position.copy(skyDirection(MISSION_SKY.earth.azimuthDeg, MISSION_SKY.earth.elevationDeg)).multiplyScalar(EARTH_DIST);
  scene.add(earth);

  // ---- waypoint markers (gameplay owner P2 replaces with gaze targets)
  for (const w of scenario.waypoints) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.05, 24),
      new THREE.MeshBasicMaterial({ color: w.siteId ? 0xffc847 : 0x5fd3ff }),
    );
    m.position.set(w.x, heightAt(w.x, w.z) + 0.05, w.z);
    m.name = `wp:${w.id}`;
    scene.add(m);
  }

  let sunBlocked = false;
  return {
    scene,
    sun,
    terrainHeight: heightAt,
    update(_dt, state) {
      earth.rotation.y += 0.0005;
      const blocked = Boolean(state?.sun.blocked);
      if (blocked !== sunBlocked) {
        sunBlocked = blocked;
        // Sun slides behind the ridge: terrain at the base falls into shadow.
        // the base's low solar arrays fall into the ridge shadow; the sunlit terrain dims only slightly
        sun.intensity = blocked ? 1.6 : 3.2;
        sunDisk.visible = !blocked;
      }
    },
    dispose() {
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
      });
    },
  };
}
