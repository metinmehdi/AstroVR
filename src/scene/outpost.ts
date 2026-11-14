/**
 * The lunar outpost, visible in VR AND in Mission Control's fallback view. Every Mission Control decision is VISIBLE:
 *   ☀️ VSAT mast rises (NASA Vertical Solar Array Technology idea: ~10 m masts above the long south-pole shadows)
 *   🌱 greenhouse grow lights switch on/off · 📡 antenna dish turns + blinks when on · 🛡️ shelter shield lights glow
 * Generic, unbranded shapes (no agency logos). Placed around the airlock at the scene origin.
 */
import * as THREE from 'three';
import type { SimState } from '../shared/types';

export interface Outpost {
  group: THREE.Group;
  update(dt: number, s: SimState | null): void;
}

const WHITE = new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.55, metalness: 0.15 });
const GREY = new THREE.MeshStandardMaterial({ color: 0x8d939b, roughness: 0.6, metalness: 0.5 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8, metalness: 0.3 });
const GOLD = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.9 });

function solarPanelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c1f4a';
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = '#6f8fd6';
  g.lineWidth = 2;
  for (let x = 0; x <= 128; x += 16) g.strokeRect(x, 0, 0, 256);
  for (let y = 0; y <= 256; y += 16) g.strokeRect(0, y, 128, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createOutpost(heightAt: (x: number, z: number) => number, sunDir: THREE.Vector3): Outpost {
  const group = new THREE.Group();
  const place = (o: THREE.Object3D, x: number, z: number, dy = 0) => {
    o.position.set(x, heightAt(x, z) + dy, z);
    group.add(o);
    o.traverse((m) => {
      if (m instanceof THREE.Mesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return o;
  };

  // ---- airlock = storm shelter (the cadet starts inside). Wide window facing north: hatch side, low Sun, Earth.
  const airlock = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xd9dce1, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 2.8, 48, 1, true, Math.PI * 1.4, Math.PI * 1.2), shellMat);
  wall.position.y = 1.4;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48), new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  const roof = new THREE.Mesh(new THREE.CircleGeometry(2.45, 48), shellMat);
  roof.rotation.x = Math.PI / 2;
  roof.position.y = 2.8;
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(2.38, 2.38, 2.6, 24, 1, true, Math.PI * 0.6, Math.PI * 0.8),
    new THREE.MeshPhysicalMaterial({ color: 0x9fc7ff, transparent: true, opacity: 0.1, roughness: 0, side: THREE.DoubleSide }),
  );
  glass.position.y = 1.4;
  // interior light so the room is never a black box
  const cabin = new THREE.PointLight(0xdfe9ff, 2.2, 7, 1.6);
  cabin.position.y = 2.5;
  // shelter shield indicator: ring of lights under the roof
  const shieldMat = new THREE.MeshBasicMaterial({ color: 0x3a2a10 });
  const shieldRing = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.05, 8, 64), shieldMat);
  shieldRing.rotation.x = Math.PI / 2;
  shieldRing.position.y = 2.65;
  airlock.add(wall, floor, roof, glass, cabin, shieldRing);
  place(airlock, 0, 0);

  // ---- habitat modules (south-east)
  const hab = new THREE.Group();
  const mod = (len: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, len, 32), WHITE);
    m.rotation.z = Math.PI / 2;
    return m;
  };
  const m1 = mod(7);
  m1.position.y = 1.9;
  const m2 = mod(6);
  m2.position.set(0, 1.9, 4.2);
  const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.6, 16), GREY);
  tunnel.rotation.x = Math.PI / 2;
  tunnel.position.set(0, 1.9, 2.1);
  const windows = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (let i = -2; i <= 2; i++) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), windows);
    w.position.set(i * 1.2, 2.3, -1.71);
    w.rotation.y = Math.PI;
    hab.add(w);
  }
  for (const x of [-2.6, 2.6]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.9, 8), GREY);
    leg.position.set(x, 0.45, 0);
    hab.add(leg);
  }
  hab.add(m1, m2, tunnel);
  hab.rotation.y = -0.4;
  place(hab, 8, 6);

  // ---- VSAT vertical solar array mast (west of the airlock)
  const vsat = new THREE.Group();
  const mastBase = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.6, 12), DARK);
  mastBase.position.y = 0.3;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1, 8), GREY);
  const panelTex = solarPanelTexture();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 4.8, 0.06),
    new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.3, metalness: 0.6, emissive: 0x0a1430 }),
  );
  // face the Sun (arrays track the low polar Sun around the horizon)
  const sunYaw = Math.atan2(sunDir.x, sunDir.z);
  panel.rotation.y = sunYaw;
  vsat.add(mastBase, mast, panel);
  place(vsat, -9, 2);

  // ---- greenhouse dome (north-west) with grow lights
  const greenhouse = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.28, roughness: 0.1, side: THREE.DoubleSide }),
  );
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.08, 8, 48), GREY);
  ring.rotation.x = Math.PI / 2;
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x3fae5a, roughness: 0.8, emissive: 0x0a2a10 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 0.6 + (i % 3) * 0.45;
    const p = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 6), plantMat);
    p.position.set(Math.cos(a) * r, 0.3, Math.sin(a) * r);
    greenhouse.add(p);
  }
  const grow = new THREE.PointLight(0xff4fd8, 3, 6, 1.5);
  grow.position.y = 1.5;
  const growGlow = new THREE.Mesh(new THREE.SphereGeometry(2.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.12, side: THREE.BackSide }));
  greenhouse.add(dome, ring, grow, growGlow);
  place(greenhouse, -7, -8);

  // ---- antenna dish (east), points toward Earth's side of the sky
  const antenna = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 8), GREY);
  pole.position.y = 1.3;
  const head = new THREE.Group();
  head.position.y = 2.6;
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 4.2), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, side: THREE.DoubleSide }));
  dish.rotation.x = Math.PI;
  dish.position.y = 0.75;
  head.add(dish);
  head.rotation.x = -1.1;
  const blinkMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), blinkMat);
  blink.position.y = 2.75;
  antenna.add(pole, head, blink);
  place(antenna, 7, -3);

  // ---- generic lander silhouette for scale (south-east, downhill)
  const lander = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 5.5, 8), WHITE);
  body.position.y = 5.2;
  const top = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.2, 8), WHITE);
  top.position.y = 9;
  const foil = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 1.4, 8), GOLD);
  foil.position.y = 2.6;
  lander.add(body, top, foil);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 6), GREY);
    leg.position.set(Math.cos(a) * 2.8, 1.6, Math.sin(a) * 2.8);
    leg.rotation.z = Math.cos(a) * 0.45;
    leg.rotation.x = -Math.sin(a) * 0.45;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 12), GREY);
    pad.position.set(Math.cos(a) * 3.7, 0.06, Math.sin(a) * 3.7);
    lander.add(leg, pad);
  }
  place(lander, 24, 12);

  let t = 0;
  let mastH = 2.5;
  return {
    group,
    update(dt, s) {
      t += dt;
      // VSAT: 2.5 m stowed → 10 m raised, follows the real raise progress
      const target = !s ? 2.5 : s.switches.vsat === 'up' ? 10 : s.switches.vsat === 'raising' ? 2.5 + 7.5 * s.vsatProgress : 2.5;
      mastH += (target - mastH) * Math.min(1, dt * 3);
      mast.scale.y = mastH;
      mast.position.y = 0.6 + mastH / 2;
      panel.position.y = 0.6 + mastH - 0.2;
      // greenhouse lights
      const gOn = s ? s.switches.greenhouse : true;
      grow.intensity = gOn ? 3 : 0;
      (growGlow.material as THREE.MeshBasicMaterial).opacity = gOn ? 0.12 + 0.03 * Math.sin(t * 2) : 0;
      plantMat.emissive.setHex(gOn ? 0x0a2a10 : 0x000000);
      if (s) plantMat.color.setRGB(0.25 + 0.5 * (1 - s.greenhouseHealth), 0.68 * (0.4 + 0.6 * s.greenhouseHealth), 0.35);
      // antenna turns + blinks while ON
      const aOn = s ? s.switches.antenna : true;
      if (aOn) head.rotation.y += dt * 0.4;
      blinkMat.color.setHex(aOn && Math.sin(t * 6) > 0 ? 0xff3b30 : 0x330000);
      // shelter shield lights
      const shOn = Boolean(s?.switches.shelter);
      shieldMat.color.setHex(shOn ? (Math.sin(t * 3) > -0.2 ? 0xffb000 : 0xb37a00) : 0x3a2a10);
    },
  };
}
