/**
 * A robotic polar rover with the proportions of NASA's VIPER (generic, no logos), driving its survey loop near the
 * outpost. Real behaviour (NASA VIPER briefings 2024–2026):
 *  - 20 cm/s max, drive → stop → navigation-camera panorama → drive (src/scene/roverPath.ts, unit-tested)
 *  - 4 independently steered 50 cm wheels: symmetric front/rear steering on curves, wheels roll without slipping
 *  - active suspension: every wheel sits on the DRAWN ground (terrainMesh.meshHeightAt), the body follows the mean
 *    slope, the legs take up the rest
 *  - vertical solar panels on three sides (the polar Sun is only ~4° high), high-gain antenna tracking the Earth
 *  - mast lights only in shadow (in vacuum there is no light beam to see, only the lamp)
 *  - wheel tracks: the disturbed regolith is darker (like the Apollo rover tracks seen by LRO)
 *  - no dust plume: at 20 cm/s the wheels throw almost nothing
 * Driven by the SHARED mission clock (EVA start), so the headset and the projector twin show the same moment.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SimState } from '../shared/types';
import { sharedNow } from '../shared/clock';
import { LOOP_LENGTH, ROVER, RoverClock, driveAt, pointAt } from './roverPath';
import { makeLamp } from './glow';
import { DARK, GOLD, GREY, WHITE, solarPanelTexture } from './outpost';

export interface Rover {
  group: THREE.Group;
  update(dt: number, state: SimState | null): void;
  /** true while the wheels turn (its shadow must be redrawn more often) */
  readonly moving: boolean;
}

interface RoverOpts {
  /** height of the drawn terrain triangles */
  meshHeightAt(x: number, z: number): number;
  /** analytic terrain height (for the terrain-shadow test along the path) */
  heightAt(x: number, z: number): number;
  sunDir: THREE.Vector3;
  earthDir: THREE.Vector3;
}

const R = 0.255; // wheel radius incl. grousers, minus ~1 cm sinkage in the regolith
const HALF_BASE = ROVER.wheelBase / 2;
const HALF_TRACK = ROVER.track / 2;
const BODY_ABOVE_HUBS = 0.475; // body centre above the wheel hubs (ground clearance ≈ 0.45 m)
/** wheel hubs in the body frame: front-left, front-right, rear-left, rear-right (+x = left, +z = forward) */
const HUBS: [number, number][] = [
  [HALF_TRACK, HALF_BASE],
  [-HALF_TRACK, HALF_BASE],
  [HALF_TRACK, -HALF_BASE],
  [-HALF_TRACK, -HALF_BASE],
];

function part(list: THREE.BufferGeometry[], g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) {
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  list.push(g);
}

function wheelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // rigid sheet-metal wheel, axis along x
  part(parts, new THREE.CylinderGeometry(0.245, 0.245, 0.2, 28), 0, 0, 0, 0, Math.PI / 2);
  // grousers on the tread → the rolling is visible from every side
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const g = new THREE.BoxGeometry(0.2, 0.02, 0.035);
    g.translate(0, 0.252, 0);
    g.rotateX(a);
    parts.push(g);
  }
  // spokes + hub on both faces
  for (const side of [-1, 1]) {
    part(parts, new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12), side * 0.105, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BoxGeometry(0.02, 0.2, 0.035);
      g.translate(side * 0.105, 0.12, 0);
      g.rotateX((i / 6) * Math.PI * 2);
      parts.push(g);
    }
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
}

/** wheel-track texture: grouser imprints across the track (alpha) */
function trackAlpha(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(150,150,150)';
  g.fillRect(0, 0, 16, 64);
  g.fillStyle = 'rgb(255,255,255)';
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 16, 6);
  g.fillStyle = 'rgb(60,60,60)'; // soft edges of the rut
  g.fillRect(0, 0, 2, 64);
  g.fillRect(14, 0, 2, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** the darker ruts of earlier laps, laid exactly on the drawn ground */
function createTracks(meshHeightAt: (x: number, z: number) => number): THREE.Mesh {
  const W = 0.11; // half width of a rut (wheel 20 cm + a little spread)
  const STEP = 0.25;
  const n = Math.ceil(LOOP_LENGTH / STEP);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (const side of [1, -1]) {
    const base = v;
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * LOOP_LENGTH;
      const p = pointAt(s);
      const lx = Math.cos(p.yaw); // body +x (left) in world
      const lz = -Math.sin(p.yaw);
      for (const e of [-W, W]) {
        const x = p.x + lx * (side * HALF_TRACK + e);
        const z = p.z + lz * (side * HALF_TRACK + e);
        pos.push(x, meshHeightAt(x, z) + 0.015, z);
        uv.push(e < 0 ? 0 : 1, s / 0.112); // one grouser imprint every 11 cm (14 grousers on a 50 cm wheel)
      }
      if (i > 0) {
        const a = base + (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      v += 2;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.2,
    alphaMap: trackAlpha(),
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * The rover's own copies of the outpost materials (same look and Moon reflections), drawn into the shadow map with
 * their BACK faces: at a 4° Sun a lit surface compared against its own depth speckles (shadow acne); against the far
 * side of the part it never does. So every part can receive real shadows (a boulder's 40 m shadow, the terrain's).
 */
function own<T extends THREE.Material>(m: T): T {
  const c = m.clone() as T;
  c.shadowSide = THREE.BackSide;
  return c;
}

export function createRover(o: RoverOpts): Rover {
  const group = new THREE.Group();
  group.name = 'rover';
  group.add(createTracks(o.meshHeightAt));

  const root = new THREE.Group(); // body centre, oriented with the body
  root.rotation.order = 'YXZ'; // yaw, then pitch, then roll
  group.add(root);

  // ---- body (static parts merged per material)
  const lists: Record<'grey' | 'white' | 'dark' | 'gold' | 'solar', THREE.BufferGeometry[]> = { grey: [], white: [], dark: [], gold: [], solar: [] };
  part(lists.grey, new THREE.BoxGeometry(1.1, 0.55, 1.3), 0, 0, 0);
  part(lists.white, new THREE.BoxGeometry(1.16, 0.04, 1.36), 0, 0.295, 0); // radiator deck
  // vertical solar panels on three sides (the polar Sun is low)
  // (flush on the sides and above the wheel tops, so a steered or lifted wheel never touches them)
  part(lists.solar, new THREE.BoxGeometry(0.025, 0.5, 1.22), 0.567, 0.05, 0);
  part(lists.solar, new THREE.BoxGeometry(0.025, 0.5, 1.22), -0.567, 0.05, 0);
  part(lists.solar, new THREE.BoxGeometry(1.0, 0.56, 0.025), 0, 0.02, -0.663);
  // front: hazard-camera bar and bumper
  part(lists.dark, new THREE.BoxGeometry(0.5, 0.08, 0.06), 0, 0.12, 0.67);
  part(lists.dark, new THREE.BoxGeometry(0.9, 0.06, 0.05), 0, -0.22, 0.67);
  // drill housing at the front corner
  part(lists.dark, new THREE.BoxGeometry(0.18, 0.3, 0.18), -0.4, 0.05, 0.74);
  part(lists.gold, new THREE.CylinderGeometry(0.045, 0.045, 0.85, 10), -0.4, 0.2, 0.74);
  // mast and antenna post
  part(lists.grey, new THREE.CylinderGeometry(0.035, 0.04, 1.34, 10), 0.3, 0.315 + 0.67, 0.45);
  part(lists.grey, new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8), -0.3, 0.315 + 0.21, -0.4);
  // real solar cells look almost black-navy (they absorb light); the tint darkens the shared panel texture
  const solarMat = new THREE.MeshStandardMaterial({ map: solarPanelTexture(), color: 0x6a7488, roughness: 0.35, metalness: 0.5, emissive: 0x020409 });
  const darkMat = own(DARK);
  const greyMat = own(GREY);
  const mats = { grey: greyMat, white: own(WHITE), dark: darkMat, gold: own(GOLD), solar: own(solarMat) };
  for (const k of Object.keys(lists) as (keyof typeof lists)[]) {
    const g = mergeGeometries(lists[k].map((x) => x.toNonIndexed()))!;
    const m = new THREE.Mesh(g, mats[k]);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }

  // ---- mast head: pan → tilt, two navigation cameras + two LED lights
  const pan = new THREE.Group();
  pan.position.set(0.3, 1.68, 0.45);
  const tilt = new THREE.Group();
  pan.add(tilt);
  const headParts: THREE.BufferGeometry[] = [];
  part(headParts, new THREE.BoxGeometry(0.44, 0.12, 0.13), 0, 0, 0);
  for (const x of [-0.13, 0.13]) part(headParts, new THREE.CylinderGeometry(0.035, 0.035, 0.06, 12), x, 0.0, 0.08, Math.PI / 2);
  part(headParts, new THREE.BoxGeometry(0.06, 0.08, 0.06), 0, -0.09, 0); // pan-tilt unit
  const head = new THREE.Mesh(mergeGeometries(headParts.map((x) => x.toNonIndexed()))!, darkMat);
  head.castShadow = head.receiveShadow = true;
  tilt.add(head);
  const lamps = [-0.2, 0.2].map((x) => {
    const l = makeLamp(0xfff4e0, 0.022, 0.55);
    l.group.position.set(x, -0.02, 0.075);
    tilt.add(l.group);
    l.set(0);
    return l;
  });
  root.add(pan);

  // ---- high-gain antenna on a gimbal: always pointed at the Earth
  const hga = new THREE.Group();
  hga.position.set(-0.3, 0.315 + 0.45, -0.4);
  const dishGeo = new THREE.SphereGeometry(0.3, 18, 6, 0, Math.PI * 2, 0, Math.PI / 5);
  dishGeo.rotateX(-Math.PI / 2); // concave side faces +z (towards the Earth after lookAt)
  dishGeo.translate(0, 0, 0.26);
  const dishMat = own(WHITE);
  dishMat.side = THREE.DoubleSide;
  const dish = new THREE.Mesh(dishGeo, dishMat);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6).rotateX(Math.PI / 2).translate(0, 0, 0.1), greyMat);
  const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), darkMat);
  for (const m of [dish, feed, yoke]) m.castShadow = m.receiveShadow = true;
  hga.add(dish, feed, yoke);
  root.add(hga);

  // ---- wheels and suspension legs (instanced: 1 draw call each)
  const wheels = new THREE.InstancedMesh(wheelGeometry(), greyMat, 4);
  const strutGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, 0.5, 0);
  const legs = new THREE.InstancedMesh(strutGeo, darkMat, 4);
  for (const m of [wheels, legs]) {
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false; // instances move every frame: never cull the rover by a stale bounding sphere
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(m);
  }

  // ---- lights only where the path is in the REAL terrain shadow (ray-march towards the Sun)
  const shadowStep = 1;
  const inShadow: boolean[] = [];
  {
    const hx = o.sunDir.x;
    const hz = o.sunDir.z;
    const hl = Math.hypot(hx, hz);
    const tanEl = o.sunDir.y / hl;
    for (let s = 0; s < LOOP_LENGTH; s += shadowStep) {
      const p = pointAt(s);
      const h0 = o.heightAt(p.x, p.z) + 1.2;
      let shade = false;
      for (let d = 2; d < 600 && !shade; d += 2) if (o.heightAt(p.x + (hx / hl) * d, p.z + (hz / hl) * d) > h0 + tanEl * d) shade = true;
      inShadow.push(shade);
    }
  }

  // ---- per-frame state
  const clock = new RoverClock();
  let evaWall: number | null = null;
  let seenT = NaN;
  let seenEva: number | null = null;
  let panA = 0;
  let tiltA = -0.2;
  let lampLevel = 0;
  let moving = false;
  const hubW = HUBS.map(() => new THREE.Vector3());
  const hubL = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qs = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3();
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const hp = new THREE.Vector3();
  const legScale = new THREE.Vector3(1, 1, 1);
  const dir = new THREE.Vector3();
  const earthTarget = new THREE.Vector3();
  const slew = (cur: number, target: number, dt: number, maxRate: number) => {
    const want = (target - cur) * Math.min(1, dt * 3);
    return cur + Math.max(-maxRate * dt, Math.min(maxRate * dt, want));
  };

  function update(dt: number, s: SimState | null) {
    // ---- time: seconds since the EVA started, on the shared clock (headset = projector)
    if (s && s.evaStartedAt !== null) {
      if (s.t !== seenT || s.evaStartedAt !== seenEva) {
        // estimate the wall time of the EVA start when a NEW state arrives (not every frame)
        evaWall = sharedNow() - (s.t - s.evaStartedAt) * 1000;
        seenT = s.t;
        seenEva = s.evaStartedAt;
      }
    } else {
      evaWall = null;
      seenEva = null;
    }
    const tau = clock.update(dt, evaWall === null ? null : (sharedNow() - evaWall) / 1000);
    const d = driveAt(tau);
    moving = d.v > 0;
    const p = pointAt(d.dist);
    const sinY = Math.sin(p.yaw);
    const cosY = Math.cos(p.yaw);

    // ---- wheels on the drawn ground: highest resting point of each wheel over its footprint
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = HUBS[i];
      const wx = p.x + lx * cosY + lz * sinY;
      const wz = p.z - lx * sinY + lz * cosY;
      let y = -Infinity;
      for (const a of [-0.12, 0, 0.12]) // along the wheel
        for (const b of [-0.08, 0, 0.08]) {
          // across the tread
          const gx = wx + a * sinY + b * cosY;
          const gz = wz + a * cosY - b * sinY;
          y = Math.max(y, o.meshHeightAt(gx, gz) + Math.sqrt(R * R - a * a));
        }
      hubW[i].set(wx, y, wz);
    }
    // ---- body: mean slope of the four wheels (active suspension takes up the twist)
    const front = (hubW[0].y + hubW[1].y) / 2;
    const rear = (hubW[2].y + hubW[3].y) / 2;
    const left = (hubW[0].y + hubW[2].y) / 2;
    const right = (hubW[1].y + hubW[3].y) / 2;
    root.rotation.set(-Math.atan2(front - rear, ROVER.wheelBase), p.yaw, Math.atan2(left - right, ROVER.track));
    up.set(0, 1, 0).applyEuler(root.rotation);
    root.position
      .set(p.x, (hubW[0].y + hubW[1].y + hubW[2].y + hubW[3].y) / 4, p.z)
      .addScaledVector(up, BODY_ABOVE_HUBS);
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();

    // ---- wheels: 4-wheel steering (front +δ, rear −δ about the body centre), rolling without slip
    const delta = Math.atan(p.turn * HALF_BASE);
    const spin = d.dist / R;
    qs.setFromAxisAngle(X, spin);
    for (let i = 0; i < 4; i++) {
      hubL.copy(hubW[i]).applyMatrix4(inv);
      q.setFromAxisAngle(Y, i < 2 ? delta : -delta).multiply(qs);
      wheels.setMatrixAt(i, m4.compose(hubL, q, one));
      // suspension leg: from the body hard-point to the inner face of the wheel
      const sx = Math.sign(HUBS[i][0]);
      hp.set(sx * 0.48, -0.2, Math.sign(HUBS[i][1]) * 0.5);
      dir.set(hubL.x - sx * 0.12, hubL.y, hubL.z).sub(hp);
      const len = dir.length();
      q.setFromUnitVectors(Y, dir.divideScalar(len));
      legScale.y = len;
      legs.setMatrixAt(i, m4.compose(hp, q, legScale));
    }
    wheels.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;

    // ---- mast: looks ahead while driving, step-and-stare panorama at the stations, slow survey while parked
    let panT = 0;
    let tiltT = -0.26;
    if (d.stopT >= 0) {
      const steps = [-0.8, -0.27, 0.27, 0.8, 0];
      panT = steps[Math.min(steps.length - 1, Math.floor(d.stopT / (ROVER.stop / steps.length)))];
      tiltT = -0.12;
    } else if (d.stopT === -2) {
      panT = 0.6 * Math.sin((sharedNow() / 1000) * 0.15);
      tiltT = -0.15;
    }
    panA = slew(panA, panT, dt, 0.7);
    tiltA = slew(tiltA, tiltT, dt, 0.5);
    pan.rotation.y = panA;
    tilt.rotation.x = -tiltA; // rotation about +x by a positive angle tips the front (+z) down
    // ---- HGA → Earth
    hga.getWorldPosition(earthTarget);
    hga.lookAt(earthTarget.addScaledVector(o.earthDir, 100));
    // ---- lights: on only in terrain shadow
    const sIdx = Math.floor((((d.dist % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH) / shadowStep) % inShadow.length;
    lampLevel += ((inShadow[sIdx] ? 1 : 0) - lampLevel) * Math.min(1, dt * 4);
    for (const l of lamps) l.set(lampLevel);
  }

  update(0, null);
  return {
    group,
    update,
    get moving() {
      return moving;
    },
  };
}
