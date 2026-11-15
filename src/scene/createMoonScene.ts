/**
 * Shared 3D scene (owner: P1). Used by the phone (stereo VR) and by the laptop "helmet cam".
 * REAL NASA data:
 *   - Terrain: NASA's 5 m/px Shape-from-Shading elevation of Nobile Rim 1 (Artemis III candidate region, PGDA product
 *     104, tied to LRO LOLA), 1280 m × 1280 m around the site (src/data/terrain-nobile.json)
 *   - Ground colour: the REAL LROC NAC orthomosaic of the same square (public/textures/nobile-albedo.jpg)
 *   + procedural detail below 5 m: small craters, regolith normal map, rocks (src/scene/lunarSurface.ts, rocks.ts)
 *   + a VIPER-like robotic rover on its survey loop (src/scene/rover.ts; off with ?rover=0)
 *   - Sun and Earth: JPL Horizons positions for the mission date; Earth = NASA EPIC photo
 *   - Sky: NASA SVS Deep Star Maps 2020 (real star catalogues), oriented for the lunar south pole
 * Lighting rule of the lunar south pole: the Sun is only a few degrees above the horizon → very long, hard shadows,
 * black sky, almost no ambient light (no atmosphere).
 */
import * as THREE from 'three';
import type { Scenario, SimState } from '../shared/types';
import { MISSION_SKY } from '../shared/realdata';
import { createHorizon } from './horizon';
import { TERRAIN_SIZE, lolaHeight } from './lola';
import { createOutpost } from './outpost';
import { makeLunar } from './lunarSurface';
import { createRocks } from './rocks';
import { buildTerrainGeometry } from './terrainMesh';
import { glowTexture } from './glow';
import { createRover, type Rover } from './rover';
import { loopSegments } from './roverPath';

export type Quality = 'low' | 'high';

export interface MoonScene {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  terrainHeight(x: number, z: number): number;
  /** call every frame; state may be null before the first sync */
  update(dt: number, state: SimState | null): void;
  /** where the astronaut is (the sharp shadow area follows) */
  setFocus(x: number, z: number): void;
  /** true once when the (static) shadow map should be re-rendered — renderer.shadowMap.autoUpdate is off */
  takeShadowUpdate(): boolean;
  dispose(): void;
}

/** Horizon direction from azimuth (from north, clockwise) and elevation. Scene axes: x = east, y = up, z = south. */
function skyDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
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
  return (smoothNoise(x * 0.45, z * 0.45) - 0.5) * 0.28;
}

/**
 * Small craters below the 5 m DEM resolution (1–14 m across; many small, few large, like real lunar size-frequency).
 * Procedural, documented as such. Bowl + raised rim; kept away from the walking routes and the outpost.
 */
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
interface Crater {
  x: number;
  z: number;
  r: number;
  d: number;
}
let CRATER_GRID = new Map<string, Crater[]>();
/** distance from (x, z) to the nearest of the segments */
function segDist(segs: [number, number, number, number][], x: number, z: number): number {
  let m = Infinity;
  for (const [ax, az, bx, bz] of segs) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    m = Math.min(m, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return m;
}
function buildCraters(scenario: Scenario, roverPath: [number, number, number, number][]) {
  const segs: [number, number, number, number][] = [];
  for (const route of Object.values(scenario.routes))
    for (let i = 1; i < route.length; i++) {
      const a = scenario.waypoints.find((w) => w.id === route[i - 1])!;
      const b = scenario.waypoints.find((w) => w.id === route[i])!;
      segs.push([a.x, a.z, b.x, b.z]);
    }
  const clear = (x: number, z: number) =>
    Math.min(
      ...segs.map(([ax, az, bx, bz]) => {
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
      }),
      ...scenario.waypoints.map((w) => Math.hypot(x - w.x, z - w.z)),
      ...[[0, 0], [8, 6], [24, 12], [-7, -8], [-9, 2], [7, -3]].map(([ox, oz]) => Math.hypot(x - ox, z - oz) - 4),
    );
  const out: Crater[] = [];
  const rnd = mulberry32(20240511);
  for (let i = 0; out.length < 260 && i < 4000; i++) {
    const rr = 12 + Math.pow(rnd(), 0.8) * 300;
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const r = 0.5 + 6.5 * Math.pow(rnd(), 3.2); // radius 0.5–7 m
    const depth = 0.18 + 0.06 * rnd();
    if (clear(x, z) < r * 1.6 + 1.5) continue;
    // the rover's loop: no crater bowl or rim under its wheels (outer rim 1.8 r, wheels ≤ 0.8 m from the centre line)
    if (roverPath.length && segDist(roverPath, x, z) < r * 1.8 + 2) continue;
    out.push({ x, z, r, d: r * depth });
  }
  CRATER_GRID = new Map();
  for (const c of out) {
    const ext = c.r * 1.8;
    for (let gx = Math.floor((c.x - ext) / 16); gx <= Math.floor((c.x + ext) / 16); gx++)
      for (let gz = Math.floor((c.z - ext) / 16); gz <= Math.floor((c.z + ext) / 16); gz++) {
        const k = gx + ',' + gz;
        if (!CRATER_GRID.has(k)) CRATER_GRID.set(k, []);
        CRATER_GRID.get(k)!.push(c);
      }
  }
}
function craterHeight(x: number, z: number): number {
  const list = CRATER_GRID.get(Math.floor(x / 16) + ',' + Math.floor(z / 16));
  if (!list) return 0;
  let h = 0;
  for (const c of list) {
    const d = Math.hypot(x - c.x, z - c.z) / c.r;
    if (d < 1) h += -c.d * (1 - d * d) + c.d * 0.22;
    else if (d < 1.8) h += c.d * 0.22 * Math.pow(1 - (d - 1) / 0.8, 2);
  }
  return h;
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

/** diffraction starburst (6 soft rays) for the Sun — what a visor/camera shows in an airless sky */
function starburstTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.translate(128, 128);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, 'rgba(255,248,230,0.9)');
    grad.addColorStop(1, 'rgba(255,248,230,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -2.2);
    g.lineTo(128, 0);
    g.lineTo(0, 2.2);
    g.fill();
  }
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
  // the EPIC photo has black space around the disc: find the disc and crop it so it fills the sprite (true size)
  const probe = document.createElement('canvas');
  probe.width = probe.height = 256;
  const pg = probe.getContext('2d', { willReadFrequently: true })!;
  pg.drawImage(img, 0, 0, 256, 256);
  const px = pg.getImageData(0, 0, 256, 256).data;
  let minX = 256, maxX = 0, minY = 256, maxY = 0;
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const o = (y * 256 + x) * 4;
      if (px[o] + px[o + 1] + px[o + 2] > 60) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  const k0 = img.width / 256;
  const sx = minX * k0, sy = minY * k0, sw = (maxX - minX + 1) * k0, sh = (maxY - minY + 1) * k0;
  g.save();
  g.beginPath();
  g.arc(R, R, R * 0.995, 0, Math.PI * 2);
  g.clip();
  if (maxX > minX) g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  else g.drawImage(img, 0, 0, c.width, c.height);
  g.restore();
  g.filter = 'blur(' + Math.round(R * 0.025) + 'px)'; // soft terminator (twilight band)
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
  g.globalCompositeOperation = 'source-atop';
  g.fill();
  g.restore();
  g.filter = 'none';
}

export function createMoonScene(scenario: Scenario, quality: Quality = 'low'): MoonScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // ---- terrain: REAL SfS/LOLA DEM + small craters + gentle noise
  const withRover = new URLSearchParams(location.search).get('rover') !== '0';
  const roverPath = withRover ? loopSegments(1.5) : [];
  buildCraters(scenario, roverPath);
  const heightAt = (x: number, z: number) => lolaHeight(x, z) + craterHeight(x, z) + microDetail(x, z);
  // vertex spacing ≈ 1.2 m around the outpost, growing to ≈ 11 m at the edges (src/scene/terrainMesh.ts)
  const { geometry: geo, meshHeightAt } = buildTerrainGeometry(heightAt, TERRAIN_SIZE, quality === 'high' ? 420 : 300);
  const terrainMat = makeLunar(new THREE.MeshStandardMaterial({ color: 0x9a968e }), { uvMetres: TERRAIN_SIZE, tile: 1.7 });
  // the REAL ground: LROC NAC orthomosaic of this exact square (shading flattened; we light it with the real Sun)
  new THREE.TextureLoader().load('/textures/nobile-albedo.jpg', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    terrainMat.map = t;
    terrainMat.needsUpdate = true;
  });
  const terrainMesh = new THREE.Mesh(geo, terrainMat);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  scene.add(terrainMesh);
  // ---- the REAL landscape out to 60 km (LOLA polar DEM) with real Sun shadows: no more floating square of ground
  scene.add(createHorizon(lolaHeight, TERRAIN_SIZE / 2));

  // ---- sky: REAL star map (NASA SVS Deep Star Maps 2020), south ecliptic pole at the zenith
  const starTex = new THREE.TextureLoader().load('/textures/starmap.jpg');
  starTex.colorSpace = THREE.SRGBColorSpace;
  starTex.anisotropy = 4;
  const skyGeo = new THREE.SphereGeometry(950, 64, 32);
  skyGeo.scale(-1, 1, 1);
  const sunDirForSky = skyDirection(MISSION_SKY.sun.azimuthDeg, MISSION_SKY.sun.elevationDeg);
  // black airless sky; stars fade near the blinding Sun (like any camera or eye), bright in the opposite sky
  const sky = new THREE.Mesh(
    skyGeo,
    new THREE.ShaderMaterial({
      uniforms: { map: { value: starTex }, sunDir: { value: sunDirForSky }, gain: { value: 0.32 } },
      vertexShader: `varying vec2 vUv; varying vec3 vDir;
        void main(){ vUv = uv; vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 sunDir; uniform float gain; varying vec2 vUv; varying vec3 vDir;
        void main(){ vec3 c = texture2D(map, vUv).rgb;
          float s = dot(normalize(vDir), sunDir);
          // like a photo exposed for the sunlit ground: the faint Milky Way glow drops much more than the bright stars
          c = pow(c, vec3(1.7)) * gain * (1.0 - 0.9 * smoothstep(0.55, 0.995, s));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sky.quaternion.setFromUnitVectors(skyDirFromRaDec(90, -66.56), new THREE.Vector3(0, 1, 0));
  sky.renderOrder = -1;
  scene.add(sky);

  // ---- Sun: REAL position at the site on the mission date (NASA JPL Horizons) — only a few degrees above the horizon
  const sunDir = skyDirection(MISSION_SKY.sun.azimuthDeg, MISSION_SKY.sun.elevationDeg);
  const sun = new THREE.DirectionalLight(0xfff6e8, 3.6);
  sun.position.copy(sunDir).multiplyScalar(150);
  sun.castShadow = true;
  // grazing 4° light: one shadow texel spans ~0.8 m along the Sun's azimuth, i.e. ~0.8 m of light-space depth
  // → depth bias ≈ 0.8 m / 419 m (near..far) against acne stripes; the slight detachment is invisible at this scale
  sun.shadow.bias = quality === 'high' ? -0.0012 : -0.0022;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2.5; // soft edge (penumbra of the 0.5° solar disc)
  const SM = quality === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(SM, SM);
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 420 });
  scene.add(sun, sun.target);
  let shadowDirty = true;
  const focus = new THREE.Vector2(0, 0);
  const placeSun = () => {
    const fy = heightAt(focus.x, focus.y);
    sun.target.position.set(focus.x, fy, focus.y);
    sun.position.copy(sunDir).multiplyScalar(180).add(sun.target.position);
    sun.target.updateMatrixWorld();
    shadowDirty = true;
  };
  placeSun();
  const sunDisk = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sunDisk.position.copy(sunDir).multiplyScalar(850);
  const glare = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture('255,244,220'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  glare.scale.set(120, 120, 1);
  glare.position.copy(sunDisk.position);
  // the blinding Sun of an airless sky: hot core + wide halo + diffraction starburst
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture('255,236,205'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.18 }),
  );
  halo.scale.set(520, 520, 1);
  halo.position.copy(sunDisk.position);
  const burst = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: starburstTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }),
  );
  burst.scale.set(300, 300, 1);
  burst.position.copy(sunDisk.position);
  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture('255,255,255'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  core.scale.set(46, 46, 1);
  core.position.copy(sunDisk.position);
  for (const o of [glare, halo, burst, core]) (o.material as THREE.SpriteMaterial).toneMapped = false;
  scene.add(sunDisk, halo, glare, burst, core);
  // no atmosphere → deep shadows; a faint fill (sunlight bounced off the regolith + earthshine) keeps them readable
  scene.add(new THREE.HemisphereLight(0x8e9bb8, 0x2a2622, 0.26)); // faint bluish earthshine from above, regolith bounce below

  // ---- Earth: REAL position (JPL Horizons) + REAL photo (NASA EPIC) with the REAL phase seen from the Moon
  const earthDir = skyDirection(MISSION_SKY.earth.azimuthDeg, MISSION_SKY.earth.elevationDeg);
  const EARTH_DIST = 850;
  const earthSize = 2 * EARTH_DIST * Math.tan(THREE.MathUtils.degToRad(0.95));
  const earthCanvas = document.createElement('canvas');
  earthCanvas.width = earthCanvas.height = 512;
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
  earthHalo.scale.set(earthSize * 1.5, earthSize * 1.5, 1);
  earthHalo.position.copy(earth.position);
  scene.add(earthHalo, earth);
  // sky labels help kids find the tiny real-size Earth (1.9°) and the Sun on the horizon
  scene.add(skyLabel('🌍 Earth · Yer', earthDir, EARTH_DIST, 3.2), skyLabel('☀️ Sun · Günəş', sunDir, 850, 4.5));

  // ---- the outpost (VSAT mast, greenhouse, antenna, habitat, lander) reacts to Mission Control's switches
  const outpost = createOutpost(heightAt, sunDir);
  scene.add(outpost.group);

  // ---- scattered rocks (procedural, kept off the walking routes and the outpost)
  scene.add(createRocks(heightAt, scenario, quality, TERRAIN_SIZE, roverPath));

  // ---- robotic rover (VIPER-like) on its survey loop, on the drawn ground, on the shared mission clock
  let rover: Rover | null = null;
  if (withRover) {
    rover = createRover({ meshHeightAt, heightAt, sunDir, earthDir });
    scene.add(rover.group);
  }

  let shadowAcc = 0;
  return {
    scene,
    sun,
    terrainHeight: heightAt,
    update(dt, state) {
      outpost.update(dt, state);
      rover?.update(dt, state);
      // moving parts of the outpost (mast, dish) → refresh the shadows now and then; the driving rover more often
      // (its long shadow would otherwise trail behind it in steps)
      shadowAcc += dt;
      if (shadowAcc > (rover?.moving ? (quality === 'high' ? 0.1 : 0.33) : 1.5)) {
        shadowAcc = 0;
        shadowDirty = true;
      }
    },
    setFocus(x, z) {
      if (Math.hypot(x - focus.x, z - focus.y) < 4) return;
      focus.set(x, z);
      placeSun();
    },
    takeShadowUpdate() {
      const d = shadowDirty;
      shadowDirty = false;
      return d;
    },
    dispose() {
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
      });
    },
  };
}
