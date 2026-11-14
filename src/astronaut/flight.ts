/**
 * Rocket flight to the Moon, seen from the crew capsule (seated, the cabin is a stable frame → comfortable in VR).
 *   countdown on the pad → liftoff (rumble, small shake, the sky darkens, the ground falls away) → engines off in
 *   space, the REAL Earth (NASA EPIC photo) to the left → 3-day transit compressed (Earth shrinks, the Moon grows:
 *   NASA CGI Moon Kit global colour map) → arrival over the south pole → fade → the existing descent (Mission.startIntro).
 * Distances are drawn at a fixed range with the TRUE angular size (Earth 6,371 km, Moon 1,737 km radius), so the
 * sizes you see are the real ones at that distance.
 */
import * as THREE from 'three';
import { FLIGHT, lineText } from '../audio/lines';
import type { SuitAudio } from '../audio/engine';
import { EARTH_MOON_KM, FLIGHT_S, FLIGHT_SHORT_S, TRANSIT_DAYS } from '../shared/flight';
import type { Lang } from '../shared/types';
import { createLaunchTower, createPadGround, createSkyDome } from '../scene/rocket';

const SEAT_Y = 1.25;
const EARTH_R = 6371;
const MOON_R = 1737.4;
const SHOW_D = 1400; // drawing distance for Earth/Moon (inside the camera far plane)

interface Plan {
  countdown: number;
  ascent: number;
  space: number;
  transit: number;
  arrival: number;
}
const PLANS: Record<'full' | 'short', Plan> = {
  // the countdown voice says "Liftoff!" at ~5 s
  full: { countdown: 5.5, ascent: 8, space: 6, transit: 9.5, arrival: 6 }, // 35 s = FLIGHT_S
  short: { countdown: 5.5, ascent: 4, space: 2.5, transit: 4.5, arrival: 3.5 }, // 20 s = FLIGHT_SHORT_S
};

function screenTexture(): { tex: THREE.CanvasTexture; draw: (rows: [string, string][], title: string) => void } {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return {
    tex,
    draw: (rows, title) => {
      g.fillStyle = '#04121c';
      g.fillRect(0, 0, 512, 256);
      g.strokeStyle = '#1f6f8b';
      g.lineWidth = 4;
      g.strokeRect(4, 4, 504, 248);
      g.fillStyle = '#ff9a4a';
      g.font = '700 30px system-ui, sans-serif';
      g.fillText(title, 22, 44);
      rows.forEach(([k, v], i) => {
        g.fillStyle = '#7fb6cc';
        g.font = '500 26px system-ui, sans-serif';
        g.fillText(k, 22, 96 + i * 52);
        g.fillStyle = '#e8fbff';
        g.font = '700 34px ui-monospace, Consolas, monospace';
        g.textAlign = 'right';
        g.fillText(v, 490, 98 + i * 52);
        g.textAlign = 'left';
      });
      tex.needsUpdate = true;
    },
  };
}

export class Flight {
  readonly scene = new THREE.Scene();
  /** true while the cadet is in the capsule (pad or flying) */
  active = false;
  /** true once the flight has been flown or skipped (never start it again) */
  done = false;
  private flying = false;
  private t = 0;
  private plan: Plan = PLANS.full;
  private sky = createSkyDome(1900, false);
  private stars: THREE.Mesh;
  private near = new THREE.Group(); // pad, tower, ground (metres, scaled with altitude)
  private cabin = new THREE.Group();
  private cinemaOn = false;
  private earth: THREE.Sprite;
  private moon: THREE.Mesh;
  private sunGlow: THREE.Sprite;
  private fade: THREE.Mesh;
  private screen = screenTexture();
  private screenAcc = 0;
  private said = new Set<string>();
  private rigHome: THREE.Object3D | null = null;
  private onArrive: (() => void) | null = null;
  /** 0..1: darken the sky on the pad while the story plays on the cinema screen */
  dim = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private rig: THREE.Object3D,
    private audio: SuitAudio,
    private getLang: () => Lang,
  ) {
    const s = this.scene;
    s.background = new THREE.Color(0x000000);
    s.add(this.sky.mesh);
    // real star map (NASA SVS), fades in as the sky turns black
    const starTex = new THREE.TextureLoader().load('/textures/starmap.jpg');
    starTex.colorSpace = THREE.SRGBColorSpace;
    const sg = new THREE.SphereGeometry(1950, 48, 24);
    sg.scale(-1, 1, 1);
    this.stars = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: starTex, color: 0x777777, transparent: true, opacity: 0, depthWrite: false }));
    this.stars.renderOrder = -2;
    s.add(this.stars);

    // light: low Sun (front-right) + soft fill
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
    sun.position.set(600, 250, -500);
    s.add(sun, new THREE.HemisphereLight(0xbfd4ff, 0x40352a, 1.1));
    // warm cabin light so the cockpit reads in VR
    const cabinLight = new THREE.PointLight(0xffe2c0, 3, 5, 1.2);
    cabinLight.position.set(0, 2.4, 0.2);
    s.add(cabinLight);
    const glowC = document.createElement('canvas');
    glowC.width = glowC.height = 128;
    const gg = glowC.getContext('2d')!;
    const grd = gg.createRadialGradient(64, 64, 2, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,250,235,1)');
    grd.addColorStop(0.2, 'rgba(255,200,130,0.55)');
    grd.addColorStop(1, 'rgba(255,140,60,0)');
    gg.fillStyle = grd;
    gg.fillRect(0, 0, 128, 128);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowC), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.sunGlow.position.set(1100, 300, -900).setLength(1800);
    this.sunGlow.scale.set(260, 260, 1);
    s.add(this.sunGlow);

    // near world: pad + tower beside the capsule (we sit ~85 m up, at the top of the rocket)
    const ground = createPadGround(30000);
    ground.position.y = -85;
    const tower = createLaunchTower(100);
    tower.position.set(13, -85, 0);
    this.near.add(ground, tower);
    s.add(this.near);

    // the REAL Earth (NASA EPIC full-disk photo) and Moon (NASA CGI Moon Kit colour map)
    const epic = new THREE.TextureLoader().load('/textures/earth-epic.jpg');
    epic.colorSpace = THREE.SRGBColorSpace;
    this.earth = new THREE.Sprite(new THREE.SpriteMaterial({ map: epic, transparent: true, depthWrite: false }));
    this.earth.visible = false;
    s.add(this.earth);
    const moonTex = new THREE.TextureLoader().load('/images/moon-poles.jpg');
    moonTex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshStandardMaterial({ map: moonTex, roughness: 1 }));
    this.moon.visible = false;
    s.add(this.moon);

    this.buildCabin();

    // fade-to-black quad in front of the eyes (transitions), lives on the camera while flying
    this.fade = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.fade.position.z = -0.11;
    this.fade.renderOrder = 1001;
    this.fade.visible = false;
  }

  private buildCabin() {
    const cabin = this.cabin;
    const shell = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.8, metalness: 0.2 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x1b2028, roughness: 0.6 });
    // floor + low side consoles
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.1, 32), trim);
    floor.position.y = 0;
    cabin.add(floor);
    for (const x of [-0.95, 0.95]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 1.2), shell);
      side.position.set(x, 0.32, -0.3);
      cabin.add(side);
      for (let i = 0; i < 6; i++) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: [0x3ddc84, 0xffc847, 0x5fd3ff][i % 3] }));
        led.position.set(x * 0.8, 0.56, -0.7 + i * 0.16);
        cabin.add(led);
      }
    }
    // main console in front, tilted toward the seat, with a live flight display
    const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.26, 0.42), shell);
    consoleBox.position.set(0, 0.5, -0.8);
    consoleBox.rotation.x = -0.75;
    cabin.add(consoleBox);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.28), new THREE.MeshBasicMaterial({ map: this.screen.tex }));
    display.position.set(0, 0.72, -0.62);
    display.lookAt(0, SEAT_Y, 0);
    cabin.add(display);
    // canopy struts: an open frame so the whole sky stays visible
    const strutMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.35, metalness: 0.3 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(Math.sin(a) * 1.35, 0.9, Math.cos(a) * 1.35),
        new THREE.Vector3(Math.sin(a) * 1.25, 2.4, Math.cos(a) * 1.25),
        new THREE.Vector3(0, 2.75, 0),
      );
      cabin.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.016, 6), strutMat));
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.04, 8, 48), strutMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.9;
    cabin.add(rim);
    // name plate (not an agency logo)
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff9a4a';
    g.font = '800 40px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('AstroVR-1', 128, 46);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    plate.position.set(0.78, 1.0, -0.45);
    plate.lookAt(0, SEAT_Y, 0);
    cabin.add(plate);
    this.scene.add(cabin);
  }

  /** Full-screen story in VR: hide the capsule and the world (black around the curved screen). */
  setCinema(on: boolean) {
    if (on === this.cinemaOn) return;
    this.cinemaOn = on;
    for (const o of [this.cabin, this.near, this.sky.mesh, this.stars, this.sunGlow]) o.visible = !on;
  }

  /** Sit in the capsule on the pad (waiting for the story / liftoff). */
  enterPad() {
    if (this.active || this.done) return;
    this.active = true;
    this.rigHome = this.rig.parent;
    this.scene.add(this.rig);
    this.rig.position.set(0, SEAT_Y, 0);
    this.camera.add(this.fade);
    this.setAltitude(0);
    this.drawScreen('T-00:00', [
      ['STATUS', 'GO'],
      ['ALT', '0 km'],
      ['TO MOON', `${EARTH_MOON_KM.toLocaleString('en')} km`],
    ]);
  }

  /** Liftoff. `elapsed` > 0 when joining late (reconnect). onArrive runs when the Moon is reached. */
  launch(short: boolean, elapsed: number, onArrive: () => void) {
    if (this.done || this.flying) return;
    if (!this.active) this.enterPad();
    this.plan = short ? PLANS.short : PLANS.full;
    this.flying = true;
    this.t = elapsed;
    this.onArrive = onArrive;
    const total = short ? FLIGHT_SHORT_S : FLIGHT_S;
    if (elapsed >= total) this.finish();
  }

  get isFlying() {
    return this.flying;
  }

  /** Mission Control restarted: allow a new flight. */
  reset() {
    if (this.active) this.finish(false);
    this.done = false;
    this.flying = false;
    this.t = 0;
    this.said.clear();
    this.near.visible = true;
    this.sky.mesh.visible = true;
    this.earth.visible = false;
    this.moon.visible = false;
  }

  /** Leave the capsule without flying (judge mode, reconnect into a later phase, Mission Control pressed NEXT). */
  abort() {
    if (!this.active) {
      this.done = true;
      return;
    }
    this.finish(false);
  }

  private finish(arrive = true) {
    this.flying = false;
    this.active = false;
    this.done = true;
    this.camera.remove(this.fade);
    this.rig.position.y = 0;
    (this.rigHome ?? this.scene.parent)?.add(this.rig);
    if (arrive) this.onArrive?.();
  }

  private say(id: string) {
    if (this.said.has(id)) return;
    this.said.add(id);
    void this.audio.suit(id, lineText(FLIGHT, id, this.getLang()));
  }

  private setAltitude(a: number) {
    this.sky.setAltitude(a);
    (this.stars.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.smoothstep(a, 0.35, 0.9);
  }

  private drawScreen(title: string, rows: [string, string][]) {
    this.screen.draw(rows, title);
  }

  update(dt: number) {
    if (!this.active) return;
    if (!this.flying) {
      // waiting on the pad (the story may play on the cinema screen: dusk-like sky)
      this.near.scale.setScalar(1);
      this.near.position.y = 0;
      this.setAltitude(0);
      return;
    }
    this.t += dt;
    const P = this.plan;
    const t1 = P.countdown;
    const t2 = t1 + P.ascent;
    const t3 = t2 + P.space;
    const t4 = t3 + P.transit;
    const t5 = t4 + P.arrival;
    const t = this.t;
    const fadeMat = this.fade.material as THREE.MeshBasicMaterial;
    this.fade.visible = true;
    fadeMat.opacity = 0;
    this.rig.position.set(0, SEAT_Y, 0);

    if (t < t1) {
      // countdown
      this.say('countdown');
      const left = Math.ceil(t1 - t);
      this.drawScreenThrottled(dt, `T-00:0${Math.max(0, left)}`, [
        ['STATUS', 'GO FOR LAUNCH'],
        ['ALT', '0 km'],
        ['TO MOON', `${EARTH_MOON_KM.toLocaleString('en')} km`],
      ]);
    } else if (t < t2) {
      // ascent: the ground falls away (drawn at the same angles), sky darkens, rumble + small shake
      if (!this.said.has('liftoff')) {
        this.said.add('liftoff');
        this.audio.score()?.liftoff(P.ascent + 1);
      }
      const u = (t - t1) / P.ascent;
      const altKm = 200 * u * u;
      const altM = Math.max(85, altKm * 1000 + 85);
      const k = 85 / altM;
      this.near.scale.setScalar(k);
      this.near.position.y = 0;
      this.setAltitude(Math.min(1, altKm / 70));
      const shake = 0.012 * (1 - u * 0.7);
      this.rig.position.set((Math.random() - 0.5) * shake, SEAT_Y + (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      this.drawScreenThrottled(dt, 'ASCENT', [
        ['ALT', `${Math.round(altKm)} km`],
        ['SPEED', `${(7.8 * u).toFixed(1)} km/s`],
        ['TO MOON', `${EARTH_MOON_KM.toLocaleString('en')} km`],
      ]);
      // fade through black into space at the end of the burn
      fadeMat.opacity = THREE.MathUtils.smoothstep(t, t2 - 0.6, t2);
    } else if (t < t4) {
      // space + transit: the real Earth on the left shrinks, the Moon ahead grows
      this.near.visible = false;
      this.sky.mesh.visible = false;
      this.setAltitude(1);
      if (t < t3) this.say('inSpace');
      else if (P !== PLANS.short) this.say('transit'); // the short (pitch) flight keeps only the key lines
      if (!this.said.has('spacePad')) {
        this.said.add('spacePad');
        this.audio.score()?.space(t4 - t2 + P.arrival);
      }
      const u = (t - t2) / (t4 - t2); // 0..1 across space + transit
      const e = u * u * (3 - 2 * u);
      // Earth distance from its centre: 6,371 + 400 km (orbit) → far away
      const earthKm = EARTH_R + 400 + e * (EARTH_MOON_KM - 60000);
      this.placeBody(this.earth, earthKm, EARTH_R, new THREE.Vector3(-1, -0.12, 0.2));
      this.earth.visible = true;
      // Moon distance from its centre: from 384,400 km down to ~12,000 km at the end of the transit
      const moonKm = EARTH_MOON_KM - e * (EARTH_MOON_KM - 12000);
      this.placeBody(this.moon, moonKm, MOON_R, new THREE.Vector3(0.05, 0.28, -1));
      this.moon.visible = true;
      this.moon.rotation.set(-0.2, 1.2 + t * 0.01, 0);
      fadeMat.opacity = 1 - THREE.MathUtils.smoothstep(t, t2, t2 + 0.8);
      const day = Math.min(TRANSIT_DAYS, e * TRANSIT_DAYS);
      this.drawScreenThrottled(dt, t < t3 ? 'ENGINES OFF' : `DAY ${Math.min(TRANSIT_DAYS, Math.floor(day) + 1)} / ${TRANSIT_DAYS}`, [
        ['SPEED', `${(10.8 - 9.6 * e).toFixed(1)} km/s`],
        ['FROM EARTH', `${Math.round(earthKm - EARTH_R).toLocaleString('en')} km`],
        ['TO MOON', `${Math.max(0, Math.round(moonKm - MOON_R)).toLocaleString('en')} km`],
      ]);
    } else if (t < t5) {
      // arrival: the south pole fills the view, then fade
      this.say('arrival');
      const u = (t - t4) / P.arrival;
      const moonKm = 12000 - u * (12000 - (MOON_R + 150));
      this.placeBody(this.moon, moonKm, MOON_R, new THREE.Vector3(0.05, 0.28 - 0.5 * u, -1));
      this.moon.rotation.set(-0.2 - 1.0 * u, 1.2 + t * 0.01, 0); // tip the south pole toward us
      const earthKm = EARTH_MOON_KM;
      this.placeBody(this.earth, earthKm, EARTH_R, new THREE.Vector3(-1, -0.12, 0.2));
      fadeMat.opacity = THREE.MathUtils.smoothstep(t, t5 - 1.2, t5);
      this.drawScreenThrottled(dt, 'MOON ARRIVAL', [
        ['ALT', `${Math.max(0, Math.round(moonKm - MOON_R)).toLocaleString('en')} km`],
        ['TARGET', 'NOBILE RIM 1'],
        ['LAT', '85.3° S'],
      ]);
    } else {
      this.finish();
    }
  }

  /** Draw a body at SHOW_D in direction `dir`, scaled to its TRUE angular size at `distKm` (centre distance). */
  private placeBody(o: THREE.Object3D, distKm: number, radiusKm: number, dir: THREE.Vector3) {
    const ang = Math.asin(Math.min(0.999, radiusKm / distKm));
    const r = SHOW_D * Math.sin(ang);
    const p = dir.clone().normalize().multiplyScalar(SHOW_D);
    o.position.set(p.x, SEAT_Y + p.y, p.z);
    if (o instanceof THREE.Sprite) o.scale.set(r * 2.04, r * 2.04, 1); // EPIC frame: the disk nearly fills the image
    else o.scale.setScalar(r);
  }

  private drawScreenThrottled(dt: number, title: string, rows: [string, string][]) {
    this.screenAcc += dt;
    if (this.screenAcc < 0.2) return;
    this.screenAcc = 0;
    this.drawScreen(title, rows);
  }
}
