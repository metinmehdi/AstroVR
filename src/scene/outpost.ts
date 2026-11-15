/**
 * The lunar outpost, visible in VR AND in Mission Control's fallback view. Every Mission Control decision is VISIBLE:
 *   ☀️ VSAT mast rises (NASA Vertical Solar Array Technology idea: ~10 m masts above the long south-pole shadows)
 *   🌱 greenhouse grow lights switch on/off · 📡 antenna dish turns + blinks when on · 🛡️ shelter shield lights glow
 * Signal lights (emissive + optical glare only, no extra scene lights; timed on the SHARED clock so the headset and the
 * projector blink together): red obstruction light on top of the tall VSAT mast, white double strobe on the lander,
 * airlock status lamp (green = normal, amber = storm warning, red = storm), habitat windows where the crew inside
 * now and then walks past.
 * Built like real hardware (src/scene/outpostMaterials.ts): quilted MLI blankets, crinkled gold foil, solar cells,
 * a panelled interior with handrails and stowage bags, regolith-bag shielding berms, struts, ladders, cables.
 * Generic, unbranded shapes (no agency logos). Static parts are merged per material (few draw calls on phones).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SimState } from '../shared/types';
import { sharedNow } from '../shared/clock';
import { makeLamp } from './glow';
import {
  bagMaterial,
  bake,
  floorTexture,
  foilMaterial,
  interiorTextures,
  lunarEnv,
  mliMaterial,
  solarCellCanvas,
  strut,
  tiled,
  trussTexture,
} from './outpostMaterials';

export interface Outpost {
  group: THREE.Group;
  update(dt: number, s: SimState | null): void;
}

// shared with the rover (src/scene/rover.ts); they get the lunar reflections in createOutpost()
export const WHITE = new THREE.MeshStandardMaterial({ color: 0xe4e5e8, roughness: 0.7, metalness: 0.05 });
export const GREY = new THREE.MeshStandardMaterial({ color: 0x8d939b, roughness: 0.5, metalness: 0.6 });
export const DARK = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.75, metalness: 0.35 });
export const GOLD = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 1 });

export function solarPanelTexture(): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(solarCellCanvas());
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** point on a circle of radius r at angle th (three.js cylinder convention: th = 0 → +z) */
const polar = (r: number, th: number, y: number) => v3(r * Math.sin(th), y, r * Math.cos(th));

function screenTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#04121a';
  g.fillRect(0, 0, 256, 160);
  g.font = 'bold 20px system-ui, sans-serif';
  g.fillStyle = '#7fe3a8';
  g.fillText('O₂  21.0 %', 14, 32);
  g.fillText('P   101.3 kPa', 14, 60);
  g.fillText('T   21 °C', 14, 88);
  g.strokeStyle = '#3fb4ff';
  g.lineWidth = 2;
  g.beginPath();
  for (let x = 0; x < 110; x++) g.lineTo(138 + x, 70 - 18 * Math.sin(x / 9) * Math.exp(-x / 120));
  g.stroke();
  g.fillStyle = '#2bd96b';
  g.fillRect(14, 118, 90, 24);
  g.fillStyle = '#04121a';
  g.font = 'bold 16px system-ui, sans-serif';
  g.fillText('SUIT OK', 24, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createOutpost(heightAt: (x: number, z: number) => number, sunDir: THREE.Vector3): Outpost {
  const env = lunarEnv(sunDir);
  for (const m of [WHITE, GREY, DARK, GOLD]) {
    m.envMap = env;
    m.envMapIntensity = 0.8;
    m.needsUpdate = true;
  }
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xb7bbc2, roughness: 0.45, metalness: 0.7, envMap: env, side: THREE.DoubleSide });
  const ledWhite = new THREE.MeshBasicMaterial({ color: 0xeef3ff });

  const group = new THREE.Group();
  const shadows = (o: THREE.Object3D) =>
    o.traverse((m) => {
      if (m instanceof THREE.Mesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  const place = (o: THREE.Object3D, x: number, z: number, dy = 0) => {
    o.position.set(x, heightAt(x, z) + dy, z);
    group.add(o);
    shadows(o);
    return o;
  };

  /* ================================================================ airlock = storm shelter (the cadet starts inside)
   * wall behind (216°), wide window facing north (hatch side, low Sun, Earth) between 0.6π and 1.4π */
  const airlock = new THREE.Group();
  const al = new THREE.Group(); // static parts → baked
  const R = 2.4;
  const WALL0 = Math.PI * 1.4;
  const WALL = Math.PI * 1.2;
  const WIN0 = Math.PI * 0.6;
  const WIN = Math.PI * 0.8;
  const inner = interiorTextures();
  const interiorMat = new THREE.MeshStandardMaterial({
    map: tiled(inner.map, 3, 2),
    bumpMap: tiled(inner.bump, 3, 2),
    bumpScale: 0.8,
    roughness: 0.72,
    metalness: 0.05,
    side: THREE.BackSide,
    envMap: env,
    envMapIntensity: 0.4,
  });
  const ceilingMat = new THREE.MeshStandardMaterial({ map: tiled(inner.map, 1.6, 1.6), bumpMap: tiled(inner.bump, 1.6, 1.6), bumpScale: 0.8, roughness: 0.75 });
  const shellMat = mliMaterial(sunDir, 6, 2);
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 2.8, 64, 1, true, WALL0, WALL), shellMat);
  outer.position.y = 1.4;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.02, 2.8, 64, 1, true, WALL0, WALL), interiorMat);
  wall.position.y = 1.4;
  // window frame: sill, header, three mullions (four posts incl. the wall edges)
  const sill = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.3, 40, 1, true, WIN0, WIN), frameMat);
  sill.position.y = 0.15;
  const header = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.3, 40, 1, true, WIN0, WIN), frameMat);
  header.position.y = 2.65;
  al.add(outer, wall, sill, header);
  for (let i = 0; i <= 3; i++) {
    const th = WIN0 + (WIN * i) / 3;
    const post = new THREE.Mesh(new THREE.BoxGeometry(i === 0 || i === 3 ? 0.2 : 0.12, 2.8, 0.18), frameMat);
    post.position.copy(polar(R, th, 1.4));
    post.rotation.y = th;
    al.add(post);
  }
  // floor, ceiling with ribs and LED panels, roof outside. The floor sits on the highest ground under the shelter
  // (the real terrain slopes: a floor at the centre height would let regolith poke through on the uphill side)
  const y00 = heightAt(0, 0);
  let rise = 0;
  for (let r = 0.4; r <= R; r += 0.4)
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) rise = Math.max(rise, heightAt(Math.sin(a) * r, Math.cos(a) * r) - y00);
  const FLOOR_Y = rise + 0.03;
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, FLOOR_Y + 0.6, 48, 1, true), DARK);
  skirt.position.y = (FLOOR_Y - 0.6) / 2;
  al.add(skirt);
  const ft = floorTexture();
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshStandardMaterial({ map: ft.map, bumpMap: ft.bump, bumpScale: 1, roughness: 0.6, metalness: 0.6, envMap: env, envMapIntensity: 0.5 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  const ceiling = new THREE.Mesh(new THREE.CircleGeometry(R, 48), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 2.78;
  al.add(floor, ceiling);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.07, 0.07), frameMat);
    rib.position.set(Math.cos(a) * 1.15, 2.74, -Math.sin(a) * 1.15);
    rib.rotation.y = a;
    al.add(rib);
  }
  for (let k = 0; k < 3; k++) {
    const a = ((k + 0.5) / 3) * Math.PI * 2;
    const led = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.2), ledWhite);
    led.rotation.x = Math.PI / 2;
    led.rotation.z = a;
    led.position.set(Math.cos(a) * 1.0, 2.735, -Math.sin(a) * 1.0);
    al.add(led);
  }
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.4, R + 0.07, 0.2, 48), mliMaterial(sunDir, 4, 1));
  roof.position.y = 2.9;
  const roofRim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.06, 0.05, 6, 64), frameMat);
  roofRim.rotation.x = Math.PI / 2;
  roofRim.position.y = 2.8;
  al.add(roof, roofRim);
  // handrails (blue-grey, like on a space station) along the wall
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6f86a8, roughness: 0.5, metalness: 0.3 });
  for (const th of [1.52, 1.78, 2.02, 2.24, 2.48].map((f) => f * Math.PI)) {
    const t = v3(Math.cos(th), 0, -Math.sin(th));
    const c = polar(R - 0.14, th, 1.15);
    const a = c.clone().addScaledVector(t, -0.35);
    const b = c.clone().addScaledVector(t, 0.35);
    al.add(strut(a, b, 0.022, railMat, 6));
    for (const e of [a, b]) {
      const w = e.clone().setLength(R - 0.02);
      w.y = e.y;
      al.add(strut(e, w, 0.018, railMat, 6));
    }
  }
  // soft stowage bags strapped to the wall
  const bagCloth = mliMaterial(sunDir, 1, 1, 0xcfc6ae);
  for (const [f, y, w, h] of [
    [1.86, 1.75, 0.55, 0.4],
    [2.1, 1.7, 0.5, 0.36],
    [2.32, 0.55, 0.6, 0.42],
    [1.62, 0.5, 0.45, 0.34],
  ]) {
    const th = f * Math.PI;
    const bag = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.22, 2, 0.07), bagCloth);
    bag.position.copy(polar(R - 0.13, th, y));
    bag.rotation.y = th;
    al.add(bag);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, h + 0.02, 0.235), DARK);
    strap.position.copy(bag.position);
    strap.rotation.y = th;
    al.add(strap);
  }
  // control panel beside the window (hatch side): screen + status LEDs
  const thP = 1.47 * Math.PI;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.06), DARK);
  box.position.copy(polar(R - 0.05, thP, 1.45));
  box.rotation.y = thP;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.21), new THREE.MeshBasicMaterial({ map: screenTexture() }));
  screen.position.copy(polar(R - 0.085, thP, 1.5));
  screen.rotation.y = thP + Math.PI;
  al.add(box, screen);
  for (let i = 0; i < 4; i++) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.01), new THREE.MeshBasicMaterial({ color: i === 3 ? 0xffb000 : 0x2bd96b }));
    led.position.copy(polar(R - 0.085, thP + (i - 1.5) * 0.025, 1.3));
    led.rotation.y = thP + Math.PI;
    al.add(led);
  }
  // shelter shield indicator: thin LED strip under the ceiling (dark when off, amber when on)
  const shieldMat = new THREE.MeshBasicMaterial({ color: 0x2a2d33 });
  const shieldRing = new THREE.Mesh(new THREE.TorusGeometry(R - 0.07, 0.022, 6, 96), shieldMat);
  shieldRing.rotation.x = Math.PI / 2;
  shieldRing.position.y = 2.6;
  al.add(shieldRing);
  airlock.add(bake(al));
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(R - 0.01, R - 0.01, 2.2, 32, 1, true, WIN0, WIN),
    new THREE.MeshPhysicalMaterial({ color: 0x9fb8d8, transparent: true, opacity: 0.07, roughness: 0.04, metalness: 0.1, envMap: env, envMapIntensity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  );
  glass.position.y = 1.4;
  // soft interior light (no hot spot on the ceiling)
  const cabin = new THREE.PointLight(0xe8eeff, 0.8, 6, 1.2);
  cabin.position.y = 1.9;
  airlock.add(glass, cabin);
  // status lamp on the roof edge above the window/hatch side: green = normal, amber = storm warning, red = storm
  const status = makeLamp(0x2bd96b, 0.06, 0.9);
  status.group.position.set(0, 2.9, -2.3);
  airlock.add(status.group);
  place(airlock, 0, 0);
  airlock.traverse((m) => {
    if (m === glass) m.castShadow = false;
  });

  // regolith-bag berm around the shelter (radiation shielding), open in front of the hatch
  const bagGeo = new RoundedBoxGeometry(0.62, 0.26, 0.36, 2, 0.08);
  const bags: THREE.Matrix4[] = [];
  const rnd = (() => {
    let s = 1234567;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  const y0 = heightAt(0, 0);
  for (let layer = 0; layer < 2; layer++) {
    const n = 27;
    for (let i = 0; i < n; i++) {
      const th = ((i + layer * 0.5) / n) * Math.PI * 2;
      const fr = (((th / Math.PI) % 2) + 2) % 2; // 0..2 (×π)
      if (fr > 0.85 && fr < 1.15) continue; // the way out of the hatch
      if (layer === 1 && fr > 0.6 && fr < 1.4) continue; // keep the window view low
      const p = polar(2.85, th, 0);
      p.y = heightAt(p.x, p.z) - y0 + 0.12 + layer * 0.24;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.08, th + (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.08));
      bags.push(new THREE.Matrix4().compose(p, q, v3(1, 1, 1)));
    }
  }
  const berm = new THREE.InstancedMesh(bagGeo, bagMaterial(sunDir), bags.length);
  bags.forEach((m, i) => berm.setMatrixAt(i, m));
  place(berm, 0, 0);
  berm.position.y = y0;

  /* ================================================================ habitat modules (south-east) */
  const hab = new THREE.Group();
  const hs = new THREE.Group();
  const habMat = mliMaterial(sunDir, 7, 4.5);
  const module = (len: number, z: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, len, 40), habMat);
    m.rotation.z = Math.PI / 2;
    m.position.set(0, 1.9, z);
    hs.add(m);
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.7, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.42, 1).rotateZ(-s * Math.PI / 2), habMat);
      cap.position.set((s * len) / 2, 1.9, z);
      hs.add(cap);
    }
    for (let x = -len / 2 + 0.5; x <= len / 2 - 0.4; x += 1.6) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.045, 6, 48), frameMat);
      band.rotation.y = Math.PI / 2;
      band.position.set(x, 1.9, z);
      hs.add(band);
    }
    for (const x of [-len / 2 + 1, len / 2 - 1]) {
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.55, 2.4), DARK);
      saddle.position.set(x, 0.27, z);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 2.8), GREY);
      pad.position.set(x, 0.03, z);
      hs.add(saddle, pad);
    }
  };
  module(7, 0);
  module(6, 4.2);
  const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.6, 20), GREY);
  tunnel.rotation.x = Math.PI / 2;
  tunnel.position.set(0, 1.9, 2.1);
  hs.add(tunnel);
  for (const z of [1.0, 3.2]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.06, 6, 24), frameMat);
    ring.position.set(0, 1.9, z);
    hs.add(ring);
  }
  // radiator panels on top (white, glossy) and a small antenna
  const radMat = new THREE.MeshStandardMaterial({ color: 0xf0f1f3, roughness: 0.3, metalness: 0.1, envMap: env });
  for (const s of [-1, 1]) {
    const rad = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.04, 1.1), radMat);
    rad.position.set(-0.6, 3.85, s * 0.75);
    rad.rotation.x = s * 0.3;
    hs.add(rad);
    hs.add(strut(v3(-1.6, 3.55, s * 0.4), v3(-1.6, 3.8, s * 0.6), 0.04, GREY, 6));
    hs.add(strut(v3(0.4, 3.55, s * 0.4), v3(0.4, 3.8, s * 0.6), 0.04, GREY, 6));
  }
  hs.add(strut(v3(2.2, 3.5, 0), v3(2.2, 4.6, 0), 0.025, GREY, 6));
  // window frames (the lit windows themselves animate)
  const WINDOW_X = [-2.4, -1.2, 0, 1.2, 2.4];
  for (const x of WINDOW_X) {
    const fr = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.04, 6, 20), DARK);
    fr.position.set(x, 2.3, -1.72);
    hs.add(fr);
  }
  hab.add(bake(hs));
  // each window its own material: the crew inside walks past now and then; one window shows a cool screen light
  const windowBase = [0xffd9a0, 0xffd29a, 0xffdca8, 0xbfd8ff, 0xffd6a0].map((c) => new THREE.Color(c));
  const windowMats = windowBase.map((c) => new THREE.MeshBasicMaterial({ color: c.clone() }));
  for (let i = -2; i <= 2; i++) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), windowMats[i + 2]);
    w.position.set(i * 1.2, 2.3, -1.73);
    w.rotation.y = Math.PI;
    hab.add(w);
  }
  hab.rotation.y = -0.4;
  place(hab, 8, 6);

  /* ================================================================ VSAT vertical solar array mast (west) */
  const vsat = new THREE.Group();
  const vs = new THREE.Group();
  const baseBox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 1.1), DARK);
  baseBox.position.y = 0.225;
  const baseTop = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.2, 16), GREY);
  baseTop.position.y = 0.55;
  vs.add(baseBox, baseTop);
  for (const [x, z] of [
    [-0.75, -0.75],
    [0.75, -0.75],
    [-0.75, 0.75],
    [0.75, 0.75],
  ]) {
    vs.add(strut(v3(x * 0.6, 0.3, z * 0.6), v3(x, 0.02, z), 0.03, GREY, 6));
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 10), GREY);
    foot.position.set(x, 0.025, z);
    vs.add(foot);
  }
  vsat.add(bake(vs));
  const truss = trussTexture();
  const mast = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 1, 0.24),
    new THREE.MeshStandardMaterial({ map: truss, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.6, envMap: env }),
  );
  const panelTex = solarPanelTexture();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 4.8, 0.05),
    new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.6, metalness: 0.1, envMap: env, envMapIntensity: 0.4 }),
  );
  // face the Sun (arrays track the low polar Sun around the horizon)
  const sunYaw = Math.atan2(sunDir.x, sunDir.z);
  panel.rotation.y = sunYaw;
  // red obstruction light on the highest point (a 10 m mast in the dark polar shadows)
  const obstruction = makeLamp(0xff2a1a, 0.06, 1.4);
  vsat.add(mast, panel, obstruction.group);
  place(vsat, -9, 2);

  /* ================================================================ greenhouse (north-west): geodesic dome, racks */
  const greenhouse = new THREE.Group();
  const gs = new THREE.Group();
  const foundation = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.3, 0.25, 40), DARK);
  foundation.position.y = 0.125;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.07, 8, 48), frameMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  gs.add(foundation, ring);
  const shelfYs = [0.65, 1.2];
  for (const z of [-0.6, 0.6]) {
    for (const y of shelfYs) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.05, 0.55), frameMat);
      shelf.position.set(0, y, z);
      const tray = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.48), DARK);
      tray.position.set(0, y + 0.06, z);
      gs.add(shelf, tray);
    }
    for (const x of [-1.2, 1.2]) for (const dz of [-0.25, 0.25]) gs.add(strut(v3(x, 0.25, z + dz), v3(x, 1.75, z + dz), 0.02, frameMat, 5));
  }
  greenhouse.add(bake(gs));
  // geodesic frame: icosahedron edges above the ground (instanced struts)
  const ico = new THREE.IcosahedronGeometry(2.2, 1);
  const P = ico.attributes.position;
  const edges = new Map<string, [THREE.Vector3, THREE.Vector3]>();
  const key = (v: THREE.Vector3) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
  for (let i = 0; i < P.count; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = v3(P.getX(i + k), P.getY(i + k), P.getZ(i + k));
      const b = v3(P.getX(i + ((k + 1) % 3)), P.getY(i + ((k + 1) % 3)), P.getZ(i + ((k + 1) % 3)));
      const id = [key(a), key(b)].sort().join('|');
      if (!edges.has(id)) edges.set(id, [a, b]);
    }
  const struts: THREE.Matrix4[] = [];
  for (let [a, b] of edges.values()) {
    if (a.y < 0 && b.y < 0) continue;
    if (a.y > b.y) [a, b] = [b, a];
    if (a.y < 0) a = a.clone().lerp(b, -a.y / (b.y - a.y));
    const len = a.distanceTo(b);
    if (len < 0.05) continue;
    const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), b.clone().sub(a).normalize());
    struts.push(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5).setY((a.y + b.y) / 2 + 0.25), q, v3(1, len, 1)));
  }
  const frame = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5), frameMat, struts.length);
  struts.forEach((m, i) => frame.setMatrixAt(i, m));
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0xdfefff, transparent: true, opacity: 0.16, roughness: 0.05, envMap: env, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false }),
  );
  dome.position.y = 0.25;
  // leafy plants in rows on the racks (instanced; colour follows the greenhouse health)
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x3fae5a, roughness: 0.8, emissive: 0x0a2a10 });
  const leafGeo = new THREE.IcosahedronGeometry(0.12, 1).scale(1, 0.65, 1);
  const plants = new THREE.InstancedMesh(leafGeo, plantMat, 4 * 11);
  let pi = 0;
  const pc = new THREE.Color();
  for (const z of [-0.6, 0.6])
    for (const y of shelfYs)
      for (let i = 0; i < 11; i++) {
        const s = 0.75 + rnd() * 0.5;
        plants.setMatrixAt(pi, new THREE.Matrix4().compose(v3(-1.1 + i * 0.22, y + 0.16 * s, z + (rnd() - 0.5) * 0.15), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), v3(s, s, s)));
        plants.setColorAt(pi++, pc.setRGB(0.8 + rnd() * 0.3, 0.85 + rnd() * 0.3, 0.8 + rnd() * 0.2));
      }
  // pink grow-light bars above each shelf (red + blue LEDs, like NASA's Veggie)
  const growMat = new THREE.MeshBasicMaterial({ color: 0xff5ad8 });
  for (const z of [-0.6, 0.6])
    for (const y of shelfYs) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.03, 0.08), growMat);
      bar.position.set(0, y + 0.45, z);
      greenhouse.add(bar);
    }
  const grow = new THREE.PointLight(0xff4fd8, 3, 6, 1.5);
  grow.position.y = 1.5;
  const growGlow = new THREE.Mesh(
    new THREE.SphereGeometry(2.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.1, side: THREE.BackSide, depthWrite: false }),
  );
  growGlow.position.y = 0.25;
  greenhouse.add(frame, plants, dome, grow, growGlow);
  place(greenhouse, -7, -8);
  dome.castShadow = false;
  growGlow.castShadow = false;

  /* ================================================================ antenna dish (east), tripod + equipment box */
  const antenna = new THREE.Group();
  const as = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    as.add(strut(v3(Math.cos(a) * 0.9, 0.02, Math.sin(a) * 0.9), v3(0, 1.3, 0), 0.04, GREY, 6));
  }
  as.add(strut(v3(0, 1.2, 0), v3(0, 2.6, 0), 0.075, GREY, 10));
  const equip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.42), mliMaterial(sunDir, 0.6, 0.5));
  equip.position.set(0.85, 0.225, 0.5);
  as.add(equip, strut(v3(0.85, 0.45, 0.5), v3(0.85, 1.0, 0.5), 0.012, GREY, 4));
  antenna.add(bake(as));
  const blinkMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), blinkMat);
  blink.position.set(0.85, 1.02, 0.5);
  // the dish turns (azimuth) and looks up (elevation)
  const az = new THREE.Group();
  az.position.y = 2.6;
  const el = new THREE.Group();
  el.rotation.x = -1.1;
  const F = 0.42;
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const r = (i / 12) * 0.95;
    prof.push(new THREE.Vector2(r, (r * r) / (4 * F)));
  }
  const dishMat = new THREE.MeshStandardMaterial({ color: 0xc9c7c1, roughness: 0.6, metalness: 0.15, envMap: env, envMapIntensity: 0.5, side: THREE.DoubleSide });
  const dish = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), dishMat);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.18, 12), GREY);
  hub.position.y = -0.06;
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 0.16, 12), DARK);
  horn.position.y = F;
  el.add(dish, hub, horn);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    el.add(strut(v3(Math.cos(a) * 0.9, (0.9 * 0.9) / (4 * F), Math.sin(a) * 0.9), v3(0, F + 0.08, 0), 0.012, GREY, 4));
  }
  az.add(el);
  antenna.add(az, blink);
  place(antenna, 7, -3);

  /* ================================================================ lander (south-east, downhill): generic, unbranded
   * gold-foil descent stage with tanks and engine bell, strutted legs with footpads, white crew cabin, porch + ladder */
  const lander = new THREE.Group();
  const ls = new THREE.Group();
  const foil = foilMaterial(sunDir, 6, 2);
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 2.0, 8), foil);
  stage.position.y = 3.4;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.1, 8), DARK);
  deck.position.y = 4.45;
  ls.add(stage, deck);
  const tankMat = mliMaterial(sunDir, 2, 1);
  for (let k = 0; k < 4; k++) {
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 16), tankMat);
    t.position.copy(polar(2.55, (k * Math.PI) / 2, 3.4));
    ls.add(t);
  }
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.4, metalness: 0.85, envMap: env, side: THREE.DoubleSide });
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 1.0, 1.25, 28, 1, true), bellMat);
  bell.position.y = 1.85;
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.35, 16), bellMat);
  throat.position.y = 2.6;
  ls.add(bell, throat);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const top = polar(2.55, a, 3.7);
    const foot = polar(4.5, a, 0.3);
    ls.add(strut(top, foot, 0.08, GREY, 8));
    ls.add(strut(top, top.clone().lerp(foot, 0.4), 0.13, frameMat, 10)); // shock absorber
    const mid = top.clone().lerp(foot, 0.6);
    ls.add(strut(polar(2.6, a - 0.32, 2.45), mid, 0.05, GREY, 6));
    ls.add(strut(polar(2.6, a + 0.32, 2.45), mid, 0.05, GREY, 6));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.16, 18), GREY);
    pad.position.copy(polar(4.55, a, 0.08));
    ls.add(pad);
  }
  const cabinMat = mliMaterial(sunDir, 5, 1.6);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 2.4, 36), cabinMat);
  cab.position.y = 5.6;
  const cabTop = new THREE.Mesh(new THREE.SphereGeometry(1.45, 36, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1), cabinMat);
  cabTop.position.y = 6.8;
  ls.add(cab, cabTop);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.06, metalness: 0.9, envMap: env, envMapIntensity: 1.5 });
  for (const x of [-0.38, 0.38]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.08), glassMat);
    w.position.set(x, 6.25, -1.42);
    w.rotation.y = x * 0.5;
    ls.add(w);
  }
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.08), frameMat);
  hatch.position.set(0, 5.1, -1.45);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.06), DARK);
  handle.position.set(0.25, 5.1, -1.5);
  const porch = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 1.0), frameMat);
  porch.position.set(0, 4.47, -3.0);
  ls.add(hatch, handle, porch);
  // ladder down to the ground
  const l0 = v3(0, 4.45, -3.45);
  const l1 = v3(0, 0.05, -4.7);
  for (const x of [-0.26, 0.26]) ls.add(strut(l0.clone().setX(x), l1.clone().setX(x), 0.03, frameMat, 6));
  for (let i = 1; i < 12; i++) {
    const p = l0.clone().lerp(l1, i / 12);
    ls.add(strut(p.clone().setX(-0.26), p.clone().setX(0.26), 0.02, frameMat, 5));
  }
  // thruster pods + top antenna
  for (let k = 0; k < 4; k++) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), DARK);
    pod.position.copy(polar(1.5, Math.PI / 4 + (k * Math.PI) / 2, 6.55));
    ls.add(pod);
  }
  ls.add(strut(v3(0.6, 7.1, 0.4), v3(0.6, 7.9, 0.4), 0.025, GREY, 6));
  lander.add(bake(ls));
  // white anti-collision strobe on the top of the cabin (double flash)
  const strobe = makeLamp(0xffffff, 0.07, 2.2);
  strobe.group.position.y = 7.62;
  lander.add(strobe.group);
  lander.rotation.y = Math.atan2(24, 12); // hatch and ladder face the outpost
  place(lander, 24, 12);

  /* ================================================================ power cables on the ground */
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.7, metalness: 0.2 });
  const cable = (pts: [number, number][]) => {
    const ps: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az2] = pts[i];
      const [bx, bz] = pts[i + 1];
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az2) / 0.5));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = ax + (bx - ax) * t + Math.sin((i * 7 + k) * 0.7) * 0.06;
        const z = az2 + (bz - az2) * t + Math.cos((i * 5 + k) * 0.9) * 0.06;
        ps.push(v3(x, heightAt(x, z) + 0.04, z));
      }
    }
    const [lx, lz] = pts[pts.length - 1];
    ps.push(v3(lx, heightAt(lx, lz) + 0.04, lz));
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ps), ps.length * 2, 0.03, 5), cableMat);
    m.receiveShadow = true;
    group.add(m);
  };
  cable([[-8.5, 2], [-5.5, 1.6], [-3.1, 0.6]]); // VSAT → shelter
  cable([[3.0, 0.8], [5.2, 3.0], [6.6, 4.4]]); // shelter → habitat
  cable([[6.2, -2.6], [4.5, -1.4], [3.0, -0.4]]); // antenna → shelter

  let t = 0;
  let mastH = 2.5;
  const hash = (k: number) => {
    const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  return {
    group,
    update(dt, s) {
      t += dt;
      const T = sharedNow() / 1000; // shared clock: the headset and the projector blink together
      // ---- signal lights
      obstruction.group.position.y = 0.6 + mastH + 2.25; // top edge of the array, follows the mast
      obstruction.set(Math.pow(Math.max(0, Math.sin((2 * Math.PI * T) / 1.5)), 2));
      const ph = ((T % 2) + 2) % 2;
      strobe.set(ph < 0.06 || (ph > 0.2 && ph < 0.26) ? 1 : 0);
      if (s?.sep.active) status.set(Math.sin(2 * Math.PI * 2 * T) > 0 ? 1 : 0.15, 0xff3020);
      else if (s?.sep.warning) status.set(0.2 + 0.8 * Math.pow(Math.max(0, Math.sin(2 * Math.PI * T)), 2), 0xffb000);
      else status.set(0.85, 0x2bd96b);
      // ---- habitat windows: every ~11 s somebody may walk past inside (a soft shadow moving window to window)
      const slot = Math.floor(T / 11);
      const u = T - slot * 11;
      const walking = hash(slot) < 0.6 && u < 6;
      const dirW = hash(slot + 0.5) < 0.5 ? 1 : -1;
      const wx = dirW * (-3.6 + 1.2 * u);
      for (let i = 0; i < 5; i++) {
        const dim = walking ? 1 - 0.7 * Math.exp(-Math.pow((wx - WINDOW_X[i]) / 0.45, 2)) : 1;
        const screenK = i === 3 ? 0.93 + 0.07 * Math.sin(T * 1.7) * Math.sin(T * 0.43) : 1;
        windowMats[i].color.copy(windowBase[i]).multiplyScalar(dim * screenK * (i === 1 ? 0.88 : 1));
      }
      // VSAT: 2.5 m stowed → 10 m raised, follows the real raise progress
      const target = !s ? 2.5 : s.switches.vsat === 'up' ? 10 : s.switches.vsat === 'raising' ? 2.5 + 7.5 * s.vsatProgress : 2.5;
      mastH += (target - mastH) * Math.min(1, dt * 3);
      mast.scale.y = mastH;
      mast.position.y = 0.6 + mastH / 2;
      truss.repeat.set(1, mastH / 0.45);
      panel.position.y = 0.6 + mastH - 0.2;
      // greenhouse lights
      const gOn = s ? s.switches.greenhouse : true;
      grow.intensity = gOn ? 3 : 0;
      (growGlow.material as THREE.MeshBasicMaterial).opacity = gOn ? 0.1 + 0.03 * Math.sin(t * 2) : 0;
      growMat.color.setHex(gOn ? 0xff5ad8 : 0x2a2328);
      plantMat.emissive.setHex(gOn ? 0x0a2a10 : 0x000000);
      if (s) plantMat.color.setRGB(0.25 + 0.5 * (1 - s.greenhouseHealth), 0.68 * (0.4 + 0.6 * s.greenhouseHealth), 0.35);
      // antenna turns + blinks while ON
      const aOn = s ? s.switches.antenna : true;
      if (aOn) az.rotation.y += dt * 0.4;
      blinkMat.color.setHex(aOn && Math.sin(t * 6) > 0 ? 0xff3b30 : 0x330000);
      // shelter shield lights
      const shOn = Boolean(s?.switches.shelter);
      shieldMat.color.setHex(shOn ? (Math.sin(t * 3) > -0.2 ? 0xffb000 : 0xb37a00) : 0x2a2d33);
    },
  };
}
