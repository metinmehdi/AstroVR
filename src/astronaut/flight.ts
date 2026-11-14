/**
 * Rocket flight to the Moon, seen from inside the crew capsule (seated, the cabin is a stable frame → comfortable VR).
 *
 *   pad: tower lights, the crew-access arm swings away, venting · T-6.6 s main-engine ignition (orange light, smoke)
 *   liftoff: the tower slides down past the windows, smoke billows below, rumble + shake
 *   ascent: punch through the clouds, Max Q (buffeting, caution lights), the sky turns black, booster separation
 *   MECO: engines cut — silence (no sound in vacuum) — the toy on its string starts to float: weightless
 *   orbit: the REAL Earth below (NASA Blue Marble) with its thin blue atmosphere, then an orbital sunrise
 *   transit: engine burn to the Moon, the Earth shrinks, the Moon (NASA LRO colour map) grows
 *   arrival: lunar orbit — the Earth rises over the Moon's horizon (Apollo 8's "Earthrise") → descent
 *
 * Earth and Moon are drawn at a fixed range with their TRUE angular size (6,371 km / 1,737 km radius).
 */
import * as THREE from 'three';
import type { SuitAudio } from '../audio/engine';
import { EARTH_MOON_KM, TRANSIT_DAYS } from '../shared/flight';
import { FILM_FULL, FILM_SHORT, FILM_URL, type FilmPlan } from '../shared/flightFilm';
import type { Lang } from '../shared/types';
import { createLaunchTower, createSkyDome } from '../scene/rocket';

const SEAT_Y = 1.25;
const EARTH_R = 6371;
const MOON_R = 1737.4;
const FAR = 1850;
const PAD_H = 88; // the capsule sits ~88 m above the pad

/* ------------------------------------------------------------------ timing */

interface Plan {
  total: number;
  ignite: number; // main engines (T-6.6 s)
  liftoff: number;
  arm: [number, number]; // crew-access arm swings away
  meco: number;
  orbitEnd: number;
  coastEnd: number;
  sunrise: number;
  earthrise: number;
  /** real NASA footage takes over the window here (see shared/flightFilm.ts) */
  filmStart: number;
  offset: number;
  length: number;
  /** voice lines: Mission Control plays them (the phone stays silent to avoid echo) */
  say: Record<string, number>;
}
function planFrom(fp: FilmPlan, arm: [number, number]): Plan {
  return {
    total: fp.total,
    ignite: fp.ignite,
    liftoff: fp.liftoff,
    arm,
    meco: fp.meco,
    orbitEnd: fp.transit,
    coastEnd: fp.earthrise,
    sunrise: fp.meco + 2,
    earthrise: fp.earthrise,
    filmStart: fp.filmStart,
    offset: fp.offset,
    length: fp.length,
    say: {},
  };
}
const FULL: Plan = planFrom(FILM_FULL, [0.6, 3.6]);
const SHORT: Plan = planFrom(FILM_SHORT, [0.1, 1.4]);

/** visual altitude (m) against "full-plan" seconds after liftoff — log-interpolated keyframes, real-ish profile */
const ALT_KEYS: [number, number][] = [
  [2, 22],
  [4, 95],
  [6, 1500],
  [7, 4000],
  [8, 11000], // Max Q ~11–14 km
  [12, 48000], // booster separation ~45–50 km
  [16, 120000],
  [18, 165000], // engine cutoff / orbit insertion
];
function altitude(tau: number): number {
  if (tau <= 0) return 0;
  if (tau < 2) return 22 * (tau / 2) ** 2;
  for (let i = 1; i < ALT_KEYS.length; i++) {
    const [t0, h0] = ALT_KEYS[i - 1];
    const [t1, h1] = ALT_KEYS[i];
    if (tau <= t1) {
      const u = (tau - t0) / (t1 - t0);
      return Math.exp(Math.log(h0) * (1 - u) + Math.log(h1) * u);
    }
  }
  return ALT_KEYS[ALT_KEYS.length - 1][1];
}
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

/* ------------------------------------------------------------------ procedural textures */

function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 18; i++) {
    const x = 64 + (Math.random() - 0.5) * 50;
    const y = 64 + (Math.random() - 0.5) * 50;
    const r = 18 + Math.random() * 30;
    const grd = g.createRadialGradient(x, y, 1, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(rgb: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 1, 64, 64, 64);
  grd.addColorStop(0, `rgba(${rgb},1)`);
  grd.addColorStop(0.25, `rgba(${rgb},0.45)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** soft cloud cover (seamless in longitude) for the globe and the cloud deck */
function cloudTexture(w = 1024, h = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 900; i++) {
    const y = h * (0.08 + 0.84 * Math.random());
    const x = Math.random() * w;
    const r = 6 + Math.random() * 34;
    for (const dx of [0, -w, w]) {
      const grd = g.createRadialGradient(x + dx, y, 1, x + dx, y, r);
      grd.addColorStop(0, `rgba(255,255,255,${0.25 + Math.random() * 0.3})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x + dx - r, y - r, 2 * r, 2 * r);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** capsule interior wall: padded panels, rivets, labels, with 4 transparent windows (front pair + sides) */
const WINDOWS = [
  // centre angle (deg, 0 = ahead), half width (deg), bottom/top as a fraction of the wall height
  { a: -24, hw: 19, v0: 0.14, v1: 0.8 },
  { a: 24, hw: 19, v0: 0.14, v1: 0.8 },
  { a: -80, hw: 15, v0: 0.1, v1: 0.74 },
  { a: 80, hw: 15, v0: 0.1, v1: 0.74 },
];
function wallTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9ced4';
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 128) {
    for (let y = 0; y < H; y += 96) {
      const grd = g.createLinearGradient(x, y, x, y + 96);
      grd.addColorStop(0, '#dde2e7');
      grd.addColorStop(1, '#b4bac1');
      g.fillStyle = grd;
      g.fillRect(x + 3, y + 3, 122, 90);
      g.fillStyle = '#8e959d';
      for (const [rx, ry] of [
        [x + 9, y + 9],
        [x + 117, y + 9],
        [x + 9, y + 85],
        [x + 117, y + 85],
      ])
        g.fillRect(rx, ry, 3, 3);
    }
  }
  g.fillStyle = '#ff7a1a';
  g.fillRect(0, H * 0.93, W, 10);
  g.font = '700 22px system-ui, sans-serif';
  g.fillStyle = '#39424d';
  ['O2', 'CABIN P', 'HATCH', 'CAUTION', 'FIRE EXT', 'COMM', 'CO2 SCRUB', 'WATER', 'LIGHTS', 'AstroVR-1'].forEach((l, i) => g.fillText(l, 40 + i * 205, H * 0.08));
  for (const w of WINDOWS) {
    const cx = (0.5 + w.a / 360) * W;
    const hw = (w.hw / 360) * W;
    const y0 = (1 - w.v1) * H;
    const y1 = (1 - w.v0) * H;
    g.fillStyle = '#23272c';
    roundRect(g, cx - hw - 18, y0 - 18, 2 * hw + 36, y1 - y0 + 36, 30);
    g.fill();
    g.fillStyle = '#4a525b';
    roundRect(g, cx - hw - 8, y0 - 8, 2 * hw + 16, y1 - y0 + 16, 24);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    roundRect(g, cx - hw, y0, 2 * hw, y1 - y0, 20);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // seen from inside: flip U so labels read correctly (u = 0.5 stays straight ahead)
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = -1;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

class Screen {
  readonly c = document.createElement('canvas');
  readonly g: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  constructor(w = 512, h = 320) {
    this.c.width = w;
    this.c.height = h;
    this.g = this.c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
  }
  frame(title: string) {
    const { g, c } = this;
    g.fillStyle = '#03101a';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#1f6f8b';
    g.lineWidth = 4;
    g.strokeRect(4, 4, c.width - 8, c.height - 8);
    g.fillStyle = '#ff9a4a';
    g.font = '700 28px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(title, 18, 40);
  }
}

type Engine = ReturnType<NonNullable<ReturnType<SuitAudio['score']>>['engine']>;

/* ------------------------------------------------------------------ the flight */

export class Flight {
  readonly scene = new THREE.Scene();
  active = false;
  done = false;
  private flying = false;
  private t = 0;
  private plan: Plan = FULL;
  private said = new Set<string>();
  private rigHome: THREE.Object3D | null = null;
  private onArrive: (() => void) | null = null;
  private cinemaOn = false;

  private sky = createSkyDome(1900, 'night');
  private stars: THREE.Mesh;
  private pad = new THREE.Group(); // metres; scaled toward the eye with altitude (true angles)
  private arm = new THREE.Group();
  private towerLights: THREE.Mesh[] = [];
  private smoke: THREE.Sprite[] = [];
  private vents: THREE.Sprite[] = [];
  private clouds = new THREE.Group();
  private deck: THREE.Mesh;
  private earth = new THREE.Group();
  private cloudSphere!: THREE.Mesh;
  private atmo!: THREE.Mesh;
  private moon: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private sunSprite: THREE.Sprite;
  private flare: THREE.Sprite;
  private flameLight: THREE.PointLight;
  private hemi: THREE.HemisphereLight;

  private body = new THREE.Group(); // the rocket under the capsule (moves with us)
  private boosters: THREE.Group[] = [];
  private plume: THREE.Sprite;
  private sepPuffs: THREE.Sprite[] = [];

  private cabin = new THREE.Group();
  private cabinLight: THREE.PointLight;
  private caution: THREE.Mesh[] = [];
  private toy = new THREE.Group();
  private string!: THREE.Line;
  private screens = { flight: new Screen(), traj: new Screen(), events: new Screen() };
  private screenAcc = 0;
  private whiteout: THREE.Mesh;
  private fade: THREE.Mesh;
  private engine: Engine | null = null;
  // real NASA footage in the windows
  private video: HTMLVideoElement;
  private portal: THREE.Mesh;
  private filmOn = false;
  private windowGlow = new THREE.PointLight(0xffffff, 0, 6, 1.2);
  private ambG: CanvasRenderingContext2D;
  private ambAcc = 0;
  private events: string[] = [];
  private moonAltKm = EARTH_MOON_KM;
  private earthHalo!: THREE.Sprite;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private rig: THREE.Object3D,
    private audio: SuitAudio,
    readonly getLang: () => Lang,
  ) {
    const s = this.scene;
    s.background = new THREE.Color(0x000000);
    s.add(this.sky.mesh);
    const starTex = new THREE.TextureLoader().load('/textures/starmap.jpg');
    starTex.colorSpace = THREE.SRGBColorSpace;
    const sg = new THREE.SphereGeometry(1950, 48, 24);
    sg.scale(-1, 1, 1);
    this.stars = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: starTex, color: 0x888888, transparent: true, opacity: 0, depthWrite: false }));
    this.stars.renderOrder = -2;
    s.add(this.stars);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 0); // night launch (Artemis I lifted off at 01:47)
    this.hemi = new THREE.HemisphereLight(0x6a7da8, 0x1a1410, 0.22);
    this.flameLight = new THREE.PointLight(0xff8a2a, 0, 400, 1.2);
    this.flameLight.position.set(0, -70, 0);
    s.add(this.sun, this.sun.target, this.hemi, this.flameLight);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,246,225'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.sunSprite.scale.set(240, 240, 1);
    s.add(this.sunSprite);
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,200,140'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.flare.scale.set(900, 300, 1);
    s.add(this.flare);

    const puff = puffTexture();
    this.buildPad(puff);
    s.add(this.pad);
    this.buildClouds(puff);
    this.deck = this.buildDeck();
    s.add(this.deck);
    this.buildEarth();
    s.add(this.earth);
    const moonTex = new THREE.TextureLoader().load('/textures/moon-lroc-2k.jpg');
    moonTex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.MeshStandardMaterial({ map: moonTex, roughness: 1 }));
    this.moon.visible = false;
    s.add(this.moon);

    this.plume = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,190,110'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.buildRocketBody();
    s.add(this.body);

    this.cabinLight = new THREE.PointLight(0xffb070, 1.4, 5, 1.2); // dim amber night-ops cabin light
    this.buildCabin();
    s.add(this.cabin);

    const overlay = (color: number, order: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
      m.position.z = -0.11;
      m.renderOrder = order;
      return m;
    };
    this.whiteout = overlay(0x3a2a20, 1000); // inside the night cloud deck: grey, lit orange from below
    // the window film: a large plane 30 m out, so in stereo it sits "at infinity" — a view, not a screen
    this.video = document.createElement('video');
    this.video.src = FILM_URL;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('webkit-playsinline', '');
    this.video.preload = 'auto';
    this.video.crossOrigin = 'anonymous';
    const vtex = new THREE.VideoTexture(this.video);
    vtex.colorSpace = THREE.SRGBColorSpace;
    this.portal = new THREE.Mesh(new THREE.PlaneGeometry(64, 36), new THREE.MeshBasicMaterial({ map: vtex, toneMapped: false }));
    this.portal.position.set(0, SEAT_Y + 0.6, -30);
    this.portal.visible = false;
    this.portal.renderOrder = -1;
    s.add(this.portal);
    this.windowGlow.position.set(0, 1.5, -1.4);
    s.add(this.windowGlow);
    const ac = document.createElement('canvas');
    ac.width = 8;
    ac.height = 4;
    this.ambG = ac.getContext('2d', { willReadFrequently: true })!;
    this.fade = overlay(0x000000, 1001);
    this.reset();
  }

  /* ---------------------------------------------------------------- builders */

  private buildPad(puff: THREE.Texture) {
    const p = this.pad;
    const y0 = -PAD_H;
    const ocean = new THREE.Mesh(new THREE.CircleGeometry(400000, 96), new THREE.MeshStandardMaterial({ color: 0x0a1626, roughness: 0.3, metalness: 0.3 }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = y0 - 0.5;
    const land = new THREE.Mesh(new THREE.CircleGeometry(3500, 64), new THREE.MeshStandardMaterial({ color: 0x1c2216, roughness: 1 }));
    land.rotation.x = -Math.PI / 2;
    land.position.set(0, y0 - 0.3, 2900);
    const beach = new THREE.Mesh(new THREE.RingGeometry(3500, 3650, 64), new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 1 }));
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(0, y0 - 0.25, 2900);
    const slab = new THREE.Mesh(new THREE.CircleGeometry(160, 48), new THREE.MeshStandardMaterial({ color: 0x8c8f8f, roughness: 1 }));
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = y0;
    const trench = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 70), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
    trench.position.set(0, y0, 30);
    p.add(ocean, land, beach, slab, trench);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.5, roughness: 0.5 });
    for (const [x, z] of [
      [-60, -40],
      [60, -40],
      [0, 70],
    ]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 180, 8), mastMat);
      m.position.set(x, y0 + 90, z);
      p.add(m);
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 14, 20), new THREE.MeshStandardMaterial({ color: 0xd9dde0 }));
    tank.position.set(-140, y0 + 70, -60);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 63, 6), mastMat);
    legs.position.set(-140, y0 + 31, -60);
    p.add(tank, legs);
    // the tower beside us (+X), blinking lights, and the crew-access arm reaching the hatch
    const tower = createLaunchTower(110);
    tower.position.set(9, y0, 0);
    p.add(tower);
    // night: xenon searchlight beams sweeping up to the rocket, floodlights on the tower
    const beamTex = (() => {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 256;
      const g = c.getContext('2d')!;
      const grd = g.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, 'rgba(210,225,255,0)');
      grd.addColorStop(0.6, 'rgba(210,225,255,0.1)');
      grd.addColorStop(1, 'rgba(230,240,255,0.35)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 4, 256);
      return new THREE.CanvasTexture(c);
    })();
    for (const [x, z] of [
      [-180, -120],
      [190, -80],
      [-140, 170],
      [160, 190],
    ]) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(14, 0.8, 520, 16, 1, true),
        new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      const base = new THREE.Vector3(x, y0, z);
      const aim = new THREE.Vector3(x * 0.15, y0 + 520, z * 0.15 - 260); // shafts of light into the night sky, past the rocket
      const dir = aim.clone().sub(base).normalize();
      beam.position.copy(base).addScaledVector(dir, 260);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().negate());
      p.add(beam);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xeaf2ff }));
      lamp.position.copy(base);
      p.add(lamp);
    }
    // the shore and the launch complex at night: warm points of light
    const pts: number[] = [];
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 400 + Math.random() * 9000;
      const x = Math.cos(a) * r;
      const z = Math.abs(Math.sin(a)) * r * 0.9 + 300; // land is behind us (+z); the sea ahead is dark
      pts.push(x, y0 + 1, z);
    }
    const lightsGeo = new THREE.BufferGeometry();
    lightsGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    p.add(new THREE.Points(lightsGeo, new THREE.PointsMaterial({ color: 0xffc27a, size: 2.2, sizeAttenuation: false })));
    for (let y = 10; y <= 110; y += 20) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
      l.position.set(13.5, y0 + y, -4.5);
      this.towerLights.push(l);
      p.add(l);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x6f7780, metalness: 0.5, roughness: 0.5 });
    const walk = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.6, 1.6), steel);
    walk.position.x = -1.0;
    const room = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.0, 2.0), new THREE.MeshStandardMaterial({ color: 0xe6e8ea, roughness: 0.6 }));
    room.position.x = -2.2;
    this.arm.add(walk, room);
    this.arm.position.set(4.5, 0.4, 0); // pivot on the tower face, level with the capsule
    p.add(this.arm);
    for (let i = 0; i < 16; i++) {
      const v = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      v.userData = { a: Math.random() * Math.PI * 2, k: Math.random(), sp: 0.3 + Math.random() * 0.5 };
      this.vents.push(v);
      p.add(v);
    }
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xdddddd, transparent: true, opacity: 0, depthWrite: false }));
      m.userData = { a: Math.random() * Math.PI * 2, r: Math.random(), up: Math.random(), born: Math.random() };
      this.smoke.push(m);
      p.add(m);
    }
  }

  private buildClouds(puff: THREE.Texture) {
    for (let i = 0; i < 46; i++) {
      const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0x8a6a52, transparent: true, opacity: 0.95, depthWrite: false })); // night cloud lit by the plume
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 60;
      c.position.set(Math.cos(a) * r, (Math.random() - 0.5) * 30, Math.sin(a) * r);
      c.scale.setScalar(20 + Math.random() * 40);
      this.clouds.add(c);
    }
    this.clouds.visible = false;
    this.scene.add(this.clouds);
  }

  private buildDeck(): THREE.Mesh {
    const t = cloudTexture(1024, 1024);
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 8);
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 1, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    return m;
  }

  private buildEarth() {
    const tex = new THREE.TextureLoader().load('/textures/earth-bluemarble.jpg');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    this.cloudSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.006, 128, 64),
      new THREE.MeshStandardMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, roughness: 1 }),
    );
    this.atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.03, 128, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        uniforms: { glow: { value: new THREE.Color(0x5aa6ff) }, power: { value: 1 } },
        vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 glow; uniform float power; varying vec3 vN; varying vec3 vV;
          void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(glow * f * 1.6 * power, f * power); }`,
      }),
    );
    // soft halo so the small, true-size Earth reads at a glance (Earthrise)
    this.earthHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('120,170,255'), blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false }));
    this.earthHalo.scale.setScalar(5);
    this.earth.add(globe, this.cloudSphere, this.atmo, this.earthHalo);
    this.earth.visible = false;
  }

  private buildRocketBody() {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.55, metalness: 0.1 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xd9772b, roughness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.7 });
    const parts: [number, number, number, THREE.Material][] = [
      [2.6, 2.6, 4, white], // service module
      [3.0, 2.6, 2, dark],
      [3.0, 3.0, 12, white], // upper stage
      [4.2, 3.0, 4, white],
      [4.2, 4.2, 62, orange], // core stage
    ];
    let y = -0.2;
    for (const [rBottom, rTop, h, m] of parts) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 32), m);
      y -= h;
      c.position.y = y + h / 2;
      this.body.add(c);
    }
    for (const x of [-6.3, 6.3]) {
      const b = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 54, 24), white);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(1.9, 6, 24), white);
      nose.position.y = 30;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.8, 24), dark);
      band.position.y = 10;
      b.add(tube, nose, band);
      b.userData = { x0: x, y0: y + 29 };
      b.position.set(x, y + 29, 0);
      this.boosters.push(b);
      this.body.add(b);
      // separation-motor flash: bright, additive, travels with the booster
      const ps = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,214,150'), blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false }));
      ps.position.set(x * 0.85, y + 58, 0);
      this.sepPuffs.push(ps);
      this.body.add(ps);
    }
    this.plume.position.set(0, y - 30, 0);
    this.body.add(this.plume);
  }

  private buildCabin() {
    const cab = this.cabin;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.85, 2.6, 96, 1, true),
      new THREE.MeshStandardMaterial({ map: wallTexture(), color: 0x8c939b, side: THREE.BackSide, alphaTest: 0.5, roughness: 0.85 }),
    );
    wall.position.y = 1.3;
    const ceil = new THREE.Mesh(new THREE.ConeGeometry(1.55, 0.9, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x7d838b, side: THREE.BackSide, roughness: 0.85 }));
    ceil.position.y = 3.05;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.85, 48), new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    cab.add(wall, ceil, floor);
    // instrument panel below the front windows, three live displays
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 0.1), new THREE.MeshStandardMaterial({ color: 0x2c333c, roughness: 0.6, metalness: 0.3 }));
    panel.position.set(0, 0.6, -1.05);
    panel.lookAt(0, SEAT_Y + 0.4, 0);
    cab.add(panel);
    const scr = (s: Screen, x: number, w: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.625), new THREE.MeshBasicMaterial({ map: s.tex, toneMapped: false }));
      m.position.set(x, 0.63, -0.99);
      m.lookAt(0, SEAT_Y + 0.4, 0);
      cab.add(m);
    };
    scr(this.screens.traj, -0.52, 0.44);
    scr(this.screens.flight, 0, 0.52);
    scr(this.screens.events, 0.52, 0.44);
    const sw = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.04, 0.018), new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.7, roughness: 0.3 }), 24);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 24; i++) {
      m4.compose(
        new THREE.Vector3(-0.72 + (i % 12) * 0.13, 0.42 - Math.floor(i / 12) * 0.05, -0.98),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      sw.setMatrixAt(i, m4);
    }
    cab.add(sw);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0x552222 }));
      l.position.set(-0.3 + i * 0.2, 0.85, -1.06);
      this.caution.push(l);
      cab.add(l);
    }
    const grip = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.7 });
    for (const x of [-0.42, 0.42]) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.16, 12), grip);
      stick.position.set(x, 0.5, -0.6);
      stick.rotation.x = -0.4;
      cab.add(stick);
    }
    // the zero-g indicator: a small plush bear on a string from the ceiling
    const fur = new THREE.MeshStandardMaterial({ color: 0xb07a45, roughness: 1 });
    const snout = new THREE.MeshStandardMaterial({ color: 0xe8cfa8, roughness: 1 });
    const eye = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const ball = (r: number, x: number, y: number, z: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m);
      b.position.set(x, y, z);
      this.toy.add(b);
    };
    ball(0.05, 0, 0, 0, fur);
    ball(0.04, 0, 0.075, 0, fur);
    ball(0.015, -0.03, 0.105, 0, fur);
    ball(0.015, 0.03, 0.105, 0, fur);
    ball(0.017, 0, 0.068, 0.035, snout);
    ball(0.006, -0.015, 0.085, 0.036, eye);
    ball(0.006, 0.015, 0.085, 0.036, eye);
    ball(0.018, -0.05, 0.01, 0.01, fur);
    ball(0.018, 0.05, 0.01, 0.01, fur);
    ball(0.02, -0.025, -0.05, 0.01, fur);
    ball(0.02, 0.025, -0.05, 0.01, fur);
    cab.add(this.toy);
    this.string = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0xeeeeee }));
    cab.add(this.string);
    this.cabinLight.position.set(0, 2.15, 0.7);
    cab.add(this.cabinLight);
  }

  /* ---------------------------------------------------------------- lifecycle */

  /* ---------------------------------------------------------------- the real window film */

  /** Call inside the START tap: lets mobile browsers play the video later without a gesture. */
  primeVideo() {
    const v = this.video;
    v.load();
    void v
      .play()
      .then(() => {
        v.pause();
        v.currentTime = 0;
      })
      .catch(() => {});
  }

  private stopFilm() {
    this.filmOn = false;
    if (!this.video.paused) this.video.pause();
    this.portal.visible = false;
  }

  private filmUpdate(t: number, dt: number) {
    const P = this.plan;
    const v = this.video;
    const local = t - P.filmStart;
    if (local < -0.1 || local > P.length + 0.5) {
      if (this.filmOn) this.stopFilm();
      return;
    }
    const target = P.offset + Math.min(Math.max(local, 0), P.length - 0.05);
    if (!this.filmOn) {
      this.filmOn = true;
      try {
        v.currentTime = target;
      } catch {
        /* not seekable yet */
      }
      void v.play().catch(() => {});
    }
    // keep in step with the mission clock (both devices follow it)
    if (v.readyState >= 2 && Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
    const ready = v.readyState >= 2 && !v.error;
    this.portal.visible = ready && !this.cinemaOn;
    if (ready) {
      // the outside IS the film now: hide the 3D world behind the windows
      for (const o of [this.pad, this.deck, this.clouds, this.earth, this.moon, this.sky.mesh, this.sunSprite, this.flare, this.body]) o.visible = false;
      this.sampleAmbient(dt);
    }
  }

  /** the cabin is lit by what is outside: average colour of the film edges → fill light + window glow */
  private sampleAmbient(dt: number) {
    this.ambAcc += dt;
    if (this.ambAcc < 0.25) return;
    this.ambAcc = 0;
    try {
      this.ambG.drawImage(this.video, 0, 0, 8, 4);
      const d = this.ambG.getImageData(0, 0, 8, 4).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = d.length / 4;
      const c = new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      this.windowGlow.color.copy(c);
      this.windowGlow.intensity = 0.5 + 4 * lum;
      this.hemi.color.copy(c).lerp(new THREE.Color(0x6a7da8), 0.4);
      this.hemi.intensity = 0.06 + 0.3 * lum;
    } catch {
      /* the frame is not readable yet */
    }
  }

  get isFlying() {
    return this.flying;
  }

  /** debug: jump to a moment of the flight (seconds since the launch command) */
  debugSeek(sec: number) {
    if (this.flying) this.t = sec;
  }

  /** Full-view story in VR: hide the capsule and the world. */
  setCinema(on: boolean) {
    if (on === this.cinemaOn) return;
    this.cinemaOn = on;
    for (const o of [this.cabin, this.pad, this.sky.mesh, this.stars, this.sunSprite, this.body]) o.visible = !on;
  }

  /** back to the pad (also when Mission Control restarts) */
  reset() {
    if (this.active) this.finish(false);
    this.done = false;
    this.flying = false;
    this.t = 0;
    this.said.clear();
    this.events = [];
    this.pad.visible = true;
    this.pad.scale.setScalar(1);
    this.sky.mesh.visible = true;
    this.sky.setAltitude(0);
    (this.stars.material as THREE.MeshBasicMaterial).opacity = 0;
    this.earth.visible = false;
    this.moon.visible = false;
    this.deck.visible = false;
    this.clouds.visible = false;
    this.body.visible = true;
    this.body.position.set(0, 0, 0);
    for (const b of this.boosters) {
      b.position.set(b.userData.x0, b.userData.y0, 0);
      b.rotation.set(0, 0, 0);
      b.visible = true;
    }
    this.arm.rotation.y = 0;
    this.sun.position.set(600, 300, -500);
    this.sun.intensity = 3;
    this.sunSprite.position.set(600, 300, -500).setLength(1700);
    this.sunSprite.visible = true;
    (this.flare.material as THREE.SpriteMaterial).opacity = 0;
    this.hemi.intensity = 1.0;
    this.flameLight.intensity = 0;
    this.layToy(0, 0);
    this.stopFilm();
  }

  enterPad() {
    if (this.active || this.done) return;
    this.active = true;
    this.rigHome = this.rig.parent;
    this.scene.add(this.rig);
    this.rig.position.set(0, SEAT_Y, 0);
    this.camera.add(this.whiteout, this.fade);
    (this.whiteout.material as THREE.MeshBasicMaterial).opacity = 0;
    (this.fade.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  launch(short: boolean, elapsed: number, onArrive: () => void) {
    if (this.done || this.flying) return;
    if (!this.active) this.enterPad();
    this.plan = short ? SHORT : FULL;
    this.flying = true;
    this.t = elapsed;
    this.onArrive = onArrive;
    if (elapsed >= this.plan.total) this.finish();
  }

  abort() {
    if (!this.active) {
      this.done = true;
      return;
    }
    this.finish(false);
  }

  private finish(arrive = true) {
    this.stopFilm();
    this.flying = false;
    this.active = false;
    this.done = true;
    this.engine?.cut();
    this.engine = null;
    this.camera.remove(this.whiteout, this.fade);
    this.rig.position.set(0, 0, 0);
    (this.rigHome ?? this.scene.parent)?.add(this.rig);
    if (arrive) this.onArrive?.();
  }


  private once(key: string): boolean {
    if (this.said.has(key)) return false;
    this.said.add(key);
    return true;
  }

  private event(e: string) {
    if (!this.events.includes(e)) this.events.push(e);
  }

  /* ---------------------------------------------------------------- per frame */

  update(dt: number) {
    if (!this.active) return;
    const P = this.plan;
    const now = performance.now() / 1000;
    this.towerLights.forEach((l, i) => (l.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(now * 3 + i) > 0.3 ? 0xff3b2f : 0x3a0a08));
    if (!this.flying) {
      this.ventUpdate(now, 1);
      this.drawScreens(dt, -10, 0, 0);
      this.layToy(0, now);
      return;
    }
    this.t += dt;
    const t = this.t;
    const full = P === FULL;
    const k18 = full ? 1 : 18 / (P.meco - P.liftoff); // short plan runs the same profile faster

    // ---------------- engines & sound
    const score = this.audio.score();
    if (t >= P.ignite && !this.engine && t < P.meco && this.once('_ignite')) {
      this.engine = score?.engine() ?? null;
      this.engine?.set(0.25, 1.5);
      this.event('IGNITION');
    }
    if (t >= P.liftoff && this.once('_liftoff')) {
      this.engine?.set(0.55, 0.4);
      score?.hit(undefined, 1.3);
      this.event('LIFTOFF');
    }
    const tau = Math.max(0, t - P.liftoff) * k18;
    const maxQ = tau > 6 && tau < 9.5;
    this.engine?.buffet(maxQ);
    if (maxQ) this.event('MAX Q');
    if (tau >= 12 && this.once('_sep')) {
      score?.hit(undefined, 0.9);
      this.engine?.set(0.75, 0.3);
      this.event('BOOSTER SEP');
    }
    if (t >= P.meco && this.once('_meco')) {
      this.engine?.cut(); // silence: no sound in vacuum
      this.engine = null;
      this.event('MECO');
      this.event('ORBIT');
    }
    if (t >= P.orbitEnd && this.once('_tli')) {
      this.engine = score?.engine() ?? null;
      this.engine?.set(0.4, 0.5);
      this.event('TLI BURN');
    }
    if (t >= P.orbitEnd + (full ? 3 : 1.5) && this.once('_tliEnd')) {
      this.engine?.cut();
      this.engine = null;
      score?.space(P.coastEnd - t + 3);
    }
    if (t >= P.sunrise && this.once('_sunrise')) score?.swell(['D3', 'A3', 'E4', 'F4'], 6, 0.35);
    if (t >= P.earthrise - 0.5 && this.once('_earthrise')) {
      score?.swell(['Bb2', 'F3', 'D4'], 6, 0.35);
      this.event('EARTHRISE');
    }

    // ---------------- pad, ignition, liftoff, ascent
    const h = altitude(tau);
    const ignited = t >= P.ignite;
    const lifted = t >= P.liftoff;
    this.arm.rotation.y = -1.9 * smooth(P.arm[0], P.arm[1], t);
    this.ventUpdate(now, ignited ? Math.max(0, 1 - (t - P.ignite)) : 1);
    const thrust = lifted ? (t < P.meco ? 1 : 0) : ignited ? 0.5 * smooth(P.ignite, P.ignite + 1.2, t) : 0;
    const flick = 0.85 + 0.3 * Math.random();
    this.flameLight.intensity = (lifted ? 900 : 500) * thrust * flick * (h < 3000 ? 1 : Math.max(0, 1 - (h - 3000) / 8000));
    (this.plume.material as THREE.SpriteMaterial).opacity = Math.min(1, thrust) * (0.8 + 0.2 * Math.random());
    this.plume.scale.set(30 + 30 * thrust, 60 + 60 * thrust * Math.min(1, 0.4 + h / 20000), 1);
    this.smokeUpdate(t, P);
    // the ground below at true angles for altitude h
    this.pad.scale.setScalar(PAD_H / (PAD_H + h));
    this.pad.visible = h < 9000 && !this.cinemaOn;
    // cloud deck seen from above, fading into the globe
    const deckOn = h > 3500 && h < 60000 && !this.cinemaOn;
    this.deck.visible = deckOn;
    if (deckOn) {
      const below = Math.max(1, h - 3000); // deck top ~3 km
      this.deck.position.set(0, SEAT_Y - 60, 0);
      this.deck.scale.setScalar((400000 * 60) / below);
      (this.deck.material as THREE.MeshStandardMaterial).opacity = smooth(3500, 6000, h) * (1 - smooth(40000, 60000, h));
    }
    // punch through the clouds at ~1.8–4.4 km (the whiteout hides the switch to the deck)
    const cloudU = (h - 1800) / 2600;
    this.clouds.visible = cloudU > -0.25 && cloudU < 1.25 && !this.cinemaOn;
    if (this.clouds.visible) this.clouds.position.y = SEAT_Y + 45 - cloudU * 90;
    const toFilm = Math.max(0, 1 - Math.abs(t - (P.filmStart - 0.35)) / 0.6);
    (this.whiteout.material as THREE.MeshBasicMaterial).opacity = Math.max(0.85 * Math.max(0, 1 - Math.abs(cloudU - 0.5) / 0.35), toFilm);
    // sky blue → black with altitude, stars once above the air
    const alt01 = THREE.MathUtils.clamp(Math.log10(h / 1000 + 1) / Math.log10(90), 0, 1);
    this.sky.setAltitude(t >= P.meco ? 1 : alt01);
    this.sky.mesh.visible = alt01 < 0.999 && t < P.meco && !this.cinemaOn;
    (this.stars.material as THREE.MeshBasicMaterial).opacity = t >= P.meco ? 1 : Math.max(0.8, smooth(0.6, 1, alt01));
    if (!this.filmOn) this.hemi.intensity = 0.22 * (1 - 0.6 * alt01);
    // booster separation: they peel away outward and fall back (seen from the side windows)
    const sepT = (tau - 12) / k18;
    this.boosters.forEach((b, i) => {
      const side = i === 0 ? -1 : 1;
      const pm = this.sepPuffs[i].material as THREE.SpriteMaterial;
      if (sepT <= 0) {
        b.position.set(b.userData.x0, b.userData.y0, 0);
        b.rotation.set(0, 0, 0);
        pm.opacity = 0;
        return;
      }
      const u = Math.min(sepT, 8);
      b.position.set(b.userData.x0 + side * (22 * u + 8 * u * u), b.userData.y0 + 14 * u - 3 * u * u, -3 * u); // thrown out by the separation motors
      b.rotation.set(0.15 * u, 0, side * (0.5 * u + 0.08 * u * u));
      b.visible = sepT < 8;
      pm.opacity = Math.max(0, 1 - sepT * 0.45) * (0.85 + 0.15 * Math.random());
      this.sepPuffs[i].position.set(b.position.x, b.position.y + 6, b.position.z);
      this.sepPuffs[i].scale.setScalar(30 + sepT * 18);
    });
    if (t >= P.meco) {
      const u = t - P.meco; // the spent stage drops away
      this.body.position.set(0, -4 * u * u - 2 * u, 0);
      this.body.visible = u < 6 && !this.cinemaOn;
    }

    // ---------------- Earth (true angular size), orbital sunrise, transit, Moon, Earthrise
    const coastU = smooth(P.orbitEnd, P.coastEnd, t);
    let earthKm = EARTH_R + h / 1000;
    let earthDir = new THREE.Vector3(0, -1, 0);
    if (t >= P.meco) earthKm = EARTH_R + 185; // parking orbit
    if (t >= P.orbitEnd) {
      earthKm = EARTH_R + 185 + (EARTH_MOON_KM - EARTH_R - 185) * Math.pow(coastU, 2.2);
      earthDir = new THREE.Vector3(-0.55 * coastU, -1, 0.9 * coastU).normalize(); // falls behind as we head out
    }
    const globeOn = (h > 30000 || t >= P.meco) && t < P.coastEnd;
    (this.earthHalo.material as THREE.SpriteMaterial).opacity = t >= P.orbitEnd ? 0.45 * coastU : 0;
    this.earth.visible = globeOn && !this.cinemaOn;
    if (globeOn) {
      this.place(this.earth, earthKm, EARTH_R, earthDir, FAR);
      this.fitAtmosphere(FAR);
      this.earth.rotation.set(0.35, 2.2 + t * 0.004, 0);
      (this.atmo.material as THREE.ShaderMaterial).uniforms.power.value = t >= P.meco ? 1 : smooth(30000, 80000, h);
      this.cloudSphere.rotation.y += dt * 0.002;
    }
    if (t >= P.meco) {
      // the Sun was behind the Earth; it rises over the limb ahead ("orbital sunrise"), then lights our way out
      const limbEl = Math.asin(EARTH_R / (EARTH_R + 185)) - Math.PI / 2;
      const su = smooth(P.sunrise - 1.5, P.sunrise + 3, t);
      const el = limbEl - 0.06 + 0.16 * su;
      const dir = new THREE.Vector3(0.18, Math.sin(el), -Math.cos(el)).normalize();
      if (t >= P.orbitEnd) dir.lerp(new THREE.Vector3(0.9, 0.35, 0.1).normalize(), coastU).normalize();
      this.sun.position.copy(dir).multiplyScalar(600);
      this.sun.intensity = 3.4 * su;
      this.sunSprite.position.copy(dir).multiplyScalar(1700);
      this.sunSprite.visible = su > 0.02 && !this.cinemaOn;
      (this.flare.material as THREE.SpriteMaterial).opacity = t < P.orbitEnd ? Math.max(0, 1 - Math.abs(su - 0.35) / 0.35) * 0.9 : 0;
      this.flare.position.copy(dir).multiplyScalar(1650);
      this.cabinLight.color.setHex(su > 0.5 ? 0xfff2e0 : 0xffc890);
    }
    if (t >= P.orbitEnd - 0.5) {
      this.moon.visible = !this.cinemaOn;
      let moonKm = EARTH_MOON_KM - (EARTH_MOON_KM - 9000) * Math.pow(coastU, 1.6);
      let moonDir = new THREE.Vector3(0.05, 0.12, -1);
      if (t >= P.coastEnd) {
        const u = smooth(P.coastEnd, P.total - 1, t);
        moonKm = 9000 - (9000 - (MOON_R + 110)) * Math.pow(u, 0.8); // into lunar orbit (~110 km)
        const angR = Math.asin(Math.min(0.9995, MOON_R / moonKm));
        const moonEl = -angR + 0.03 - 0.05 * u; // its horizon stays at eye level as it fills the view below
        moonDir = new THREE.Vector3(0, Math.sin(moonEl), -Math.cos(moonEl));
        // Earthrise: the small Earth climbs above the Moon's horizon ahead
        const limbTop = moonEl + angR;
        const er = smooth(P.earthrise - 0.5, P.earthrise + 3, t);
        const el = limbTop - 0.035 + 0.13 * er;
        this.earth.visible = !this.cinemaOn;
        // a little to the left so it rises in the left front window (not behind the centre pillar)
        this.place(this.earth, EARTH_MOON_KM, EARTH_R, new THREE.Vector3(-0.27 * Math.cos(el), Math.sin(el), -Math.cos(el)), FAR);
        this.fitAtmosphere(FAR);
        (this.earthHalo.material as THREE.SpriteMaterial).opacity = 0.55;
        (this.atmo.material as THREE.ShaderMaterial).uniforms.power.value = 1;
        this.sun.position.set(400, 250, 200);
        this.sun.intensity = 3.4;
        this.sunSprite.visible = false;
      }
      this.moonAltKm = moonKm - MOON_R;
      this.place(this.moon, moonKm, MOON_R, moonDir, 1500);
      this.moon.rotation.set(-1.1, 1.2, 0); // south polar region toward us
    }

    // ---------------- cabin: shake, caution lights, toy, screens, fade
    const kick = sepT > 0 && sepT < 0.4 ? 0.02 : 0;
    const a = (lifted ? (t < P.meco ? 0.006 + (maxQ ? 0.01 : 0) + kick : 0) : ignited ? 0.003 : 0) + (t >= P.orbitEnd && t < P.orbitEnd + 3 ? 0.003 : 0);
    this.rig.position.set((Math.random() - 0.5) * a, SEAT_Y + (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    this.caution.forEach((c, i) => (c.material as THREE.MeshBasicMaterial).color.setHex(maxQ && Math.sin(now * 8 + i) > 0 ? 0xff8a2a : 0x552222));
    this.layToy(t >= P.meco ? t - P.meco : 0, now, a);
    this.drawScreens(dt, t - P.liftoff, h, t);
    (this.fade.material as THREE.MeshBasicMaterial).opacity = smooth(P.total - 1.4, P.total, t);
    this.filmUpdate(t, dt);
    if (t >= P.total) this.finish();
  }

  /** the toy hangs (and swings) under gravity; once weightless it floats up on a slack string */
  private layToy(weightless: number, now: number, shake = 0) {
    const anchor = new THREE.Vector3(0.28, 2.35, -0.72);
    const L = 0.42;
    const w = Math.min(1, weightless / 2.5);
    const swing = 0.04 * Math.sin(now * 2.1) + shake * 4 * Math.sin(now * 31);
    const hang = new THREE.Vector3(anchor.x + swing, anchor.y - L, anchor.z + 0.02 * Math.cos(now * 1.7));
    const float = new THREE.Vector3(anchor.x - 0.05 + 0.05 * Math.sin(now * 0.5), anchor.y - L * 0.55 + 0.04 * Math.sin(now * 0.7), anchor.z + 0.08 * Math.sin(now * 0.4));
    const p = hang.lerp(float, w);
    this.toy.position.copy(p);
    this.toy.rotation.set(w * 0.6 * Math.sin(now * 0.6), w * now * 0.4, w * 0.5 * Math.cos(now * 0.5));
    const mid = anchor.clone().lerp(p, 0.5).add(new THREE.Vector3(0.06 * w, -0.06 * w, 0));
    this.string.geometry.setFromPoints(new THREE.QuadraticBezierCurve3(anchor, mid, p.clone().add(new THREE.Vector3(0, 0.1, 0))).getPoints(10));
  }

  private ventUpdate(now: number, level: number) {
    for (const v of this.vents) {
      const d = v.userData as { a: number; k: number; sp: number };
      const u = (now * d.sp * 0.3 + d.k) % 1;
      v.position.set(Math.cos(d.a) * (3 + u * 5), -2 - u * 10, Math.sin(d.a) * (3 + u * 5) - 1);
      v.scale.setScalar(2 + u * 6);
      (v.material as THREE.SpriteMaterial).opacity = 0.35 * (1 - u) * level;
    }
  }

  private smokeUpdate(t: number, P: Plan) {
    const since = t - P.ignite;
    for (const m of this.smoke) {
      const d = m.userData as { a: number; r: number; up: number; born: number };
      const mat = m.material as THREE.SpriteMaterial;
      if (since < d.born * 1.5) {
        mat.opacity = 0;
        continue;
      }
      const age = since - d.born * 1.5;
      const spread = 20 + 140 * (1 - Math.exp(-age * 0.35)) * (0.4 + d.r);
      m.position.set(Math.cos(d.a) * spread, -PAD_H + 6 + age * (2 + 5 * d.up), Math.sin(d.a) * spread + 20);
      m.scale.setScalar(25 + age * 8 * (0.6 + d.r));
      mat.opacity = Math.min(0.6, age * 0.6);
      const glow = Math.max(0, 1 - (m.position.y + PAD_H) / 60) * (t < P.meco ? 1 : 0); // lit by the flames low down
      mat.color.setRGB(0.86 + 0.14 * glow, 0.82 - 0.2 * glow, 0.78 - 0.45 * glow);
    }
  }

  /** keep the atmosphere shell outside the camera (true thin limb: ~1.5% of the radius) */
  private fitAtmosphere(range: number) {
    const r = this.earth.scale.x;
    const s = Math.min(1.015, (range - 3) / r) / 1.03; // the shell geometry is 1.03 × the globe
    this.atmo.scale.setScalar(s);
    this.atmo.visible = s * 1.03 > 1.001;
  }

  /** draw a body at `range` in direction `dir` with its TRUE angular size for centre distance `distKm` */
  private place(o: THREE.Object3D, distKm: number, radiusKm: number, dir: THREE.Vector3, range: number) {
    const ang = Math.asin(Math.min(0.9995, radiusKm / distKm));
    const p = dir.clone().normalize().multiplyScalar(range);
    o.position.set(p.x, SEAT_Y + p.y, p.z);
    o.scale.setScalar(range * Math.sin(ang));
  }

  private drawScreens(dt: number, met: number, h: number, t: number) {
    this.screenAcc += dt;
    if (this.screenAcc < 0.2) return;
    this.screenAcc = 0;
    const P = this.plan;
    const { flight, traj, events } = this.screens;
    const coastU = this.flying ? smooth(P.orbitEnd, P.coastEnd, t) : 0;
    const inOrbit = this.flying && t >= P.meco;
    // centre: mission clock, altitude, speed, distance
    const lunar = this.flying && t >= P.coastEnd;
    flight.frame(met < 0 ? 'COUNTDOWN' : lunar ? 'LUNAR ORBIT' : 'FLIGHT');
    const g = flight.g;
    g.fillStyle = '#e8fbff';
    g.font = '800 64px ui-monospace, Consolas, monospace';
    const s = Math.abs(met);
    g.fillText(`${met < 0 ? 'T-' : 'T+'}${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`, 18, 112);
    const altKm = inOrbit ? 185 + (EARTH_MOON_KM - 185) * Math.pow(coastU, 2.2) : h / 1000;
    const vel = !this.flying || t < P.liftoff ? 0 : inOrbit ? (t >= P.orbitEnd ? 10.9 - 9.7 * coastU : 7.8) : 7.8 * Math.min(1, Math.pow((t - P.liftoff) / (P.meco - P.liftoff), 1.3));
    const rows: [string, string][] = lunar
      ? [
          ['MOON ALT', `${Math.round(this.moonAltKm).toLocaleString('en')} km`],
          ['SPEED', '1.6 km/s'],
          ['TARGET', 'NOBILE RIM 1'],
        ]
      : [
      ['ALT', `${altKm < 10 ? altKm.toFixed(1) : Math.round(altKm).toLocaleString('en')} km`],
      ['SPEED', `${vel.toFixed(1)} km/s`],
      ['TO MOON', `${Math.max(0, Math.round(EARTH_MOON_KM * (1 - Math.pow(coastU, 1.6)))).toLocaleString('en')} km`],
        ];
    rows.forEach(([k, v], i) => {
      g.fillStyle = '#7fb6cc';
      g.font = '500 24px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(k, 18, 168 + i * 48);
      g.fillStyle = '#e8fbff';
      g.font = '700 32px ui-monospace, Consolas, monospace';
      g.textAlign = 'right';
      g.fillText(v, 494, 170 + i * 48);
    });
    flight.tex.needsUpdate = true;
    // left: trajectory Earth → Moon with our position
    traj.frame('TRAJECTORY');
    const tg = traj.g;
    tg.fillStyle = '#3d8bff';
    tg.beginPath();
    tg.arc(70, 190, 34, 0, Math.PI * 2);
    tg.fill();
    tg.fillStyle = '#c9c9c9';
    tg.beginPath();
    tg.arc(440, 150, 14, 0, Math.PI * 2);
    tg.fill();
    tg.strokeStyle = '#ff9a4a';
    tg.setLineDash([8, 8]);
    tg.lineWidth = 3;
    tg.beginPath();
    tg.moveTo(104, 182);
    tg.quadraticCurveTo(270, 60, 426, 150);
    tg.stroke();
    tg.setLineDash([]);
    const u = coastU;
    const px = (1 - u) * (1 - u) * 104 + 2 * (1 - u) * u * 270 + u * u * 426;
    const py = (1 - u) * (1 - u) * 182 + 2 * (1 - u) * u * 60 + u * u * 150;
    tg.fillStyle = '#ffffff';
    tg.beginPath();
    tg.arc(px, py, 7, 0, Math.PI * 2);
    tg.fill();
    tg.fillStyle = '#7fb6cc';
    tg.font = '500 22px system-ui, sans-serif';
    tg.textAlign = 'left';
    tg.fillText(`DAY ${Math.min(TRANSIT_DAYS, Math.floor(u * TRANSIT_DAYS) + 1)} / ${TRANSIT_DAYS}`, 18, 290);
    traj.tex.needsUpdate = true;
    // right: event checklist
    events.frame('EVENTS');
    const eg = events.g;
    ['IGNITION', 'LIFTOFF', 'MAX Q', 'BOOSTER SEP', 'MECO', 'ORBIT', 'TLI BURN', 'EARTHRISE'].forEach((e, i) => {
      const ok = this.events.includes(e);
      eg.fillStyle = ok ? '#3ddc84' : '#4b5d6b';
      eg.font = `${ok ? '700' : '500'} 24px system-ui, sans-serif`;
      eg.textAlign = 'left';
      eg.fillText(`${ok ? '✓' : '·'} ${e}`, 22, 78 + i * 30);
    });
    events.tex.needsUpdate = true;
  }
}
