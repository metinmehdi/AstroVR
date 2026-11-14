/**
 * Shared 3D scene (owner: P1). Used by the phone (stereo VR) and by the laptop "helmet cam".
 * PLACEHOLDER terrain/sky for the skeleton — replace with:
 *   - LOLA heightmap crop of Nobile Rim 1 (public/data/terrain.png) + CGI Moon Kit texture
 *   - NASA SVS Deep Star Maps sky, Blue Marble Earth
 * Lighting rule of the lunar south pole: the Sun is ~1.5° above the horizon → very long, hard shadows,
 * black sky, almost no ambient light (no atmosphere).
 */
import * as THREE from 'three';
import type { Scenario, SimState } from '../shared/types';
import { MISSION_SKY } from '../shared/realdata';

export type Quality = 'low' | 'high';

export interface MoonScene {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  terrainHeight(x: number, z: number): number;
  /** call every frame; state may be null before the first sync */
  update(dt: number, state: SimState | null): void;
  dispose(): void;
}

const TERRAIN_SIZE = 240; // metres
/** Horizon direction from azimuth (from north, clockwise) and elevation. Scene axes: x = east, y = up, z = south. */
function skyDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Cheap deterministic value noise (placeholder until the LOLA heightmap is wired in). */
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

export function createMoonScene(scenario: Scenario, quality: Quality = 'low'): MoonScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // ---- terrain (placeholder fBm + one crater around site B)
  const crater = scenario.waypoints.find((w) => w.id === 'siteB') ?? { x: -27, z: -38 };
  const heightAt = (x: number, z: number) => {
    let h = 0;
    let amp = 1.6;
    let freq = 0.02;
    for (let o = 0; o < 4; o++) {
      h += (smoothNoise(x * freq + 100, z * freq + 100) - 0.5) * amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    const dc = Math.hypot(x - (crater.x - 12), z - (crater.z - 10));
    if (dc < 22) h -= Math.cos((dc / 22) * Math.PI * 0.5) * 6; // bowl
    if (dc >= 18 && dc < 28) h += Math.sin(((dc - 18) / 10) * Math.PI) * 1.5; // rim
    return h;
  };

  const seg = quality === 'high' ? 256 : 128;
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x8a8782, roughness: 1, metalness: 0 }),
  );
  terrain.receiveShadow = true;
  terrain.castShadow = quality === 'high';
  scene.add(terrain);

  // ---- sky: stars (placeholder for NASA Deep Star Maps)
  const starGeo = new THREE.BufferGeometry();
  const N = quality === 'high' ? 6000 : 2500;
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    arr.set([r * Math.cos(th) * 900, u * 900, r * Math.sin(th) * 900], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false })));

  // ---- Sun: REAL position at the site on the mission date (NASA JPL Horizons) — only a few degrees above the horizon
  const sunDir = skyDirection(MISSION_SKY.sun.azimuthDeg, MISSION_SKY.sun.elevationDeg);
  const sun = new THREE.DirectionalLight(0xfff6e8, 3.2);
  sun.position.copy(sunDir).multiplyScalar(150);
  sun.castShadow = true;
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
        sun.intensity = blocked ? 0.25 : 3.2;
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
