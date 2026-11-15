/**
 * Rocket flight to the Moon from inside the REAL Orion crew module: the cabin is NASA's 360° photo of the Orion that
 * flew Artemis I (KSC-20220808-PH-FMX02_0002, NASA/Frank Michaux, 8 Aug 2022) — with Commander Moonikin Campos in
 * the next seat. Seated and head-tracked (rotation only) → comfortable in a VR box.
 *
 *   pad → ignition → liftoff → Max Q: as on a real Orion launch, the windows are still covered by the launch abort
 *     system's fairing → dark; the cabin shakes and rumbles, lights flicker
 *   window covers off (filmStart): REAL Artemis I footage appears in the two side windows (src/shared/flightFilm.ts)
 *   engine cutoff: silence and weightlessness (the toy floats) · Earth · lunar flyby · Earthrise → descent
 * If the footage cannot play (slow network), a simple NASA-textured Earth and Moon show through the windows instead.
 */
import * as THREE from 'three';
import type { SuitAudio } from '../audio/engine';
import { filmReady, filmSrc, preloadFilm } from '../shared/filmCache';
import { FILM_FULL, FILM_SHORT, type FilmPlan } from '../shared/flightFilm';
import type { Lang } from '../shared/types';

const SEAT_Y = 1.25;
const PANO_R = 2.6; // the photo sphere (≈ cabin size, so the stereo depth feels like a small capsule)
/** rotate the photo so its two side windows are straight ahead (window centres at azimuth −118° and −73°) */
const PANO_YAW = THREE.MathUtils.degToRad(-185.4);
const WINDOW_EL = THREE.MathUtils.degToRad(4.5); // the windows sit just above eye level

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

type Engine = ReturnType<NonNullable<ReturnType<SuitAudio['score']>>['engine']>;

/** soft-edged alpha for the footage, so its border melts into black space around the windows */
function vignette(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 144;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 144);
  g.filter = 'blur(10px)';
  g.fillStyle = '#fff';
  g.fillRect(18, 14, 220, 116);
  return new THREE.CanvasTexture(c);
}

function hudCanvas() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 384;
  return c;
}

export class Flight {
  readonly scene = new THREE.Scene();
  active = false;
  done = false;
  private flying = false;
  private t = 0;
  private plan: FilmPlan = FILM_FULL;
  private said = new Set<string>();
  private rigHome: THREE.Object3D | null = null;
  private onArrive: (() => void) | null = null;
  private cinemaOn = false;

  private cabin = new THREE.Group();
  private pano: THREE.Mesh;
  private panoMat: THREE.MeshBasicMaterial;
  private cover: THREE.Mesh; // the launch abort system's fairing over the windows
  private flash: THREE.Mesh;
  private stars: THREE.Mesh;
  private earth: THREE.Mesh;
  private moon: THREE.Mesh;
  private hemi = new THREE.HemisphereLight(0xdfe6ef, 0x3a3a40, 1.4);
  private key = new THREE.PointLight(0xfff4e6, 3, 4, 1.5);
  private toy = new THREE.Group();
  private string!: THREE.Line;
  private fade: THREE.Mesh;
  private hud: { mesh: THREE.Mesh; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; last: string };
  private engine: Engine | null = null;
  // real NASA footage in the windows
  private video: HTMLVideoElement;
  private portal: THREE.Mesh;
  private filmOn = false;
  private ambient = new THREE.Color(1, 1, 1);
  private ambG: CanvasRenderingContext2D;
  private ambAcc = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private rig: THREE.Object3D,
    private audio: SuitAudio,
    readonly getLang: () => Lang,
  ) {
    const s = this.scene;
    s.background = new THREE.Color(0x000000);
    const loader = new THREE.TextureLoader();

    // space behind the windows: stars (fallback world + the hatch window)
    const starTex = loader.load('/textures/starmap.jpg');
    starTex.colorSpace = THREE.SRGBColorSpace;
    const sg = new THREE.SphereGeometry(900, 48, 24);
    sg.scale(-1, 1, 1);
    this.stars = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: starTex, color: 0x9a9a9a, toneMapped: false, depthWrite: false }));
    this.stars.renderOrder = -3;
    s.add(this.stars);
    // fallback Earth / Moon (NASA Blue Marble, LRO), only if the footage is not ready
    const earthTex = loader.load('/textures/earth-bluemarble.jpg');
    earthTex.colorSpace = THREE.SRGBColorSpace;
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshBasicMaterial({ map: earthTex, toneMapped: false }));
    const moonTex = loader.load('/textures/moon-lroc-2k.jpg');
    moonTex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshBasicMaterial({ map: moonTex, color: 0xd8d8d8, toneMapped: false }));
    s.add(this.earth, this.moon);

    // the real footage, far behind the windows (reads as "outside"); hidden until it can play
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'none'; // no second download: the in-memory copy (filmCache) is attached when ready
    if (filmReady()) this.video.src = filmSrc();
    this.video.crossOrigin = 'anonymous';
    const vtex = new THREE.VideoTexture(this.video);
    vtex.colorSpace = THREE.SRGBColorSpace;
    const d = 30;
    const fw = 2 * d * Math.tan(THREE.MathUtils.degToRad(26)); // ≈52° wide: most of every frame shows through the two windows (±40°)
    this.portal = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, (fw * 9) / 16),
      new THREE.MeshBasicMaterial({ map: vtex, alphaMap: vignette(), transparent: true, toneMapped: false, depthWrite: false }),
    );
    this.portal.position.set(0, SEAT_Y + d * Math.tan(WINDOW_EL), -d);
    this.portal.renderOrder = -2;
    this.portal.visible = false;
    s.add(this.portal);
    const ac = document.createElement('canvas');
    ac.width = 8;
    ac.height = 4;
    this.ambG = ac.getContext('2d', { willReadFrequently: true })!;

    // the fairing over the windows (dark), just outside the photo sphere; it drops away at filmStart
    this.cover = new THREE.Mesh(
      new THREE.SphereGeometry(PANO_R + 0.4, 48, 24),
      new THREE.MeshBasicMaterial({ color: 0x07080a, side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.cover.renderOrder = -1;
    this.cover.position.y = SEAT_Y;
    s.add(this.cover);

    // the cabin: the real 360° photo with its window panes cut out (alpha mask)
    const pano = loader.load('/textures/orion-cabin.jpg');
    pano.colorSpace = THREE.SRGBColorSpace;
    pano.anisotropy = 8;
    const mask = loader.load('/textures/orion-cabin-mask.png');
    const pg = new THREE.SphereGeometry(PANO_R, 128, 64);
    pg.scale(-1, 1, 1);
    this.panoMat = new THREE.MeshBasicMaterial({ map: pano, alphaMap: mask, transparent: true, alphaTest: 0.02, toneMapped: false });
    this.pano = new THREE.Mesh(pg, this.panoMat);
    this.pano.rotation.y = PANO_YAW;
    this.pano.position.y = SEAT_Y;
    this.cabin.add(this.pano);
    s.add(this.cabin);

    // light for the 3D toy (matches the photo's bright, cool cabin)
    this.key.position.set(0.3, SEAT_Y + 1.1, 0.2);
    s.add(this.hemi, this.key);
    this.buildToy();

    // a short white flash when the covers come off (sunlit space floods in)
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, toneMapped: false }));
    this.flash.position.z = -0.3;
    this.flash.renderOrder = 998;
    this.fade = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false }));
    this.fade.position.z = -0.29;
    this.fade.renderOrder = 999;

    // flight info: clock + event, a visor read-out below the windows (big, crisp, high contrast)
    const hc = hudCanvas();
    const htex = new THREE.CanvasTexture(hc);
    htex.colorSpace = THREE.SRGBColorSpace;
    htex.anisotropy = 8;
    const hm = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.225), new THREE.MeshBasicMaterial({ map: htex, transparent: true, toneMapped: false, depthTest: false }));
    hm.renderOrder = 900;
    hm.position.set(0, SEAT_Y - 0.4, -0.92);
    hm.lookAt(0, SEAT_Y, 0);
    s.add(hm);
    this.hud = { mesh: hm, g: hc.getContext('2d')!, tex: htex, last: '' };
    this.reset();
  }

  private buildToy() {
    // the zero-g indicator: a small plush bear on a string (Orion crews fly one; it floats when the engines stop)
    const fur = new THREE.MeshStandardMaterial({ color: 0xb07a45, roughness: 1 });
    const snout = new THREE.MeshStandardMaterial({ color: 0xe8cfa8, roughness: 1 });
    const eye = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const ball = (r: number, x: number, y: number, z: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m);
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
    this.cabin.add(this.toy);
    this.string = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0xeeeeee }));
    this.cabin.add(this.string);
  }

  /* ---------------------------------------------------------------- the real window film */

  /** Call on START: attach the in-memory film as soon as it is downloaded (muted inline video needs no gesture). */
  primeVideo() {
    const v = this.video;
    void preloadFilm().then((src) => {
      if (!this.filmOn && v.src !== src) {
        v.src = src;
        v.preload = 'auto';
        v.load();
      }
    });
  }

  private stopFilm() {
    this.filmOn = false;
    if (!this.video.paused) this.video.pause();
    this.portal.visible = false;
  }

  /** returns true while the real footage is on screen */
  private filmUpdate(t: number, dt: number): boolean {
    const P = this.plan;
    const v = this.video;
    const local = t - P.filmStart;
    if (local < -0.1 || local > P.length + 0.5) {
      if (this.filmOn) this.stopFilm();
      return false;
    }
    const target = P.offset + Math.min(Math.max(local, 0), P.length - 0.05);
    if (!this.filmOn) {
      this.filmOn = true;
      if (filmReady() && v.src !== filmSrc()) v.src = filmSrc();
      else if (!v.getAttribute('src')) v.src = filmSrc(); // not in memory yet: stream it now
      try {
        v.currentTime = target;
      } catch {
        /* not seekable yet */
      }
      void v.play().catch(() => {});
    }
    if (v.readyState >= 2 && Math.abs(v.currentTime - target) > 0.35) v.currentTime = target; // same clock everywhere
    const ready = v.readyState >= 2 && !v.error;
    this.portal.visible = ready && !this.cinemaOn;
    if (ready) this.sampleAmbient(dt);
    return ready;
  }

  /** the cabin takes a little of the colour/brightness of what is outside the windows */
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
      const n = (d.length / 4) * 255;
      this.ambient.setRGB(r / n, g / n, b / n);
    } catch {
      /* the frame is not readable yet */
    }
  }

  get isFlying() {
    return this.flying;
  }

  /** keep the flight on the shared clock (seconds since launch); small drift is ignored */
  syncClock(sec: number) {
    if (this.flying && !this.seeked && Math.abs(this.t - sec) > 0.12) this.t = sec;
  }

  /** debug: jump to a moment of the flight (seconds since the launch command); stops following the shared clock */
  debugSeek(sec: number) {
    if (!this.flying) return;
    this.seeked = true;
    this.t = sec;
  }
  private seeked = false;

  /** Full-view story in VR: hide the capsule and the world. */
  setCinema(on: boolean) {
    if (on === this.cinemaOn) return;
    this.cinemaOn = on;
    for (const o of [this.cabin, this.hud.mesh, this.cover, this.stars]) o.visible = !on;
    if (on) this.portal.visible = false;
  }

  /** back to the pad (also when Mission Control restarts) */
  reset() {
    if (this.active) this.finish(false);
    this.done = false;
    this.flying = false;
    this.t = 0;
    this.said.clear();
    this.cover.visible = !this.cinemaOn;
    (this.cover.material as THREE.MeshBasicMaterial).opacity = 1;
    this.earth.visible = false;
    this.moon.visible = false;
    this.panoMat.color.setRGB(0.92, 0.92, 0.92);
    this.layToy(0, 0);
    this.stopFilm();
  }

  enterPad() {
    if (this.active || this.done) return;
    this.active = true;
    this.rigHome = this.rig.parent;
    this.scene.add(this.rig);
    this.rig.position.set(0, SEAT_Y, 0);
    this.camera.add(this.flash, this.fade);
    (this.flash.material as THREE.MeshBasicMaterial).opacity = 0;
    (this.fade.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  launch(short: boolean, elapsed: number, onArrive: () => void) {
    if (this.done || this.flying) return;
    if (!this.active) this.enterPad();
    this.plan = short ? FILM_SHORT : FILM_FULL;
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
    this.camera.remove(this.flash, this.fade);
    this.rig.position.set(0, 0, 0);
    (this.rigHome ?? this.scene.parent)?.add(this.rig);
    if (arrive) this.onArrive?.();
  }

  private once(key: string): boolean {
    if (this.said.has(key)) return false;
    this.said.add(key);
    return true;
  }

  /* ---------------------------------------------------------------- per frame */

  update(dt: number) {
    if (!this.active) return;
    const P = this.plan;
    const now = performance.now() / 1000;
    if (!this.flying) {
      this.layToy(0, now);
      this.drawHud(-10, '');
      return;
    }
    this.t += dt;
    const t = this.t;

    // ---------------- engines & sound (cabin rumble; the real roar plays from the shared schedule)
    const score = this.audio.score();
    if (t >= P.ignite && !this.engine && t < P.meco && this.once('_ignite')) {
      this.engine = score?.engine() ?? null;
      this.engine?.set(0.25, 1.5);
    }
    if (t >= P.liftoff && this.once('_liftoff')) {
      this.engine?.set(0.55, 0.4);
      score?.hit(undefined, 1.3);
    }
    const maxQ = t > P.liftoff + 4 && t < P.liftoff + 8.5 && t < P.filmStart;
    this.engine?.buffet(maxQ);
    if (t >= P.filmStart && this.once('_covers')) {
      score?.hit(undefined, 0.9);
      this.engine?.set(0.75, 0.3);
    }
    if (t >= P.meco && this.once('_meco')) {
      this.engine?.cut(); // silence: no sound in vacuum
      this.engine = null;
    }
    if (t >= P.transit && this.once('_tli')) score?.space(Math.max(4, P.earthrise - t + 3));
    if (t >= P.earthrise - 0.5 && this.once('_earthrise')) score?.swell(['Bb2', 'F3', 'D4'], 6, 0.35);

    // ---------------- windows: covered by the fairing until it is jettisoned, then the real footage
    const open = smooth(P.filmStart - 0.15, P.filmStart + 0.35, t);
    (this.cover.material as THREE.MeshBasicMaterial).opacity = 1 - open;
    this.cover.visible = open < 1 && !this.cinemaOn;
    const flashA = Math.max(0, 1 - Math.abs(t - (P.filmStart + 0.1)) / 0.45) * 0.55;
    (this.flash.material as THREE.MeshBasicMaterial).opacity = flashA;
    const film = this.filmUpdate(t, dt);
    // fallback world (no footage yet): Earth below-ahead, later the Moon
    const fallback = open > 0 && !film && !this.cinemaOn;
    this.stars.visible = !this.cinemaOn;
    this.earth.visible = fallback && t < P.earthrise + 6;
    this.moon.visible = fallback && t >= P.transit - 1;
    if (fallback) {
      const away = smooth(P.meco, P.transit, t);
      const er = this.earth;
      er.scale.setScalar(THREE.MathUtils.lerp(260, 40, away));
      er.position.set(-60, SEAT_Y - 180 + 120 * away, -420);
      er.rotation.y = 2.2 + t * 0.01;
      const mu = smooth(P.transit - 1, P.total, t);
      this.moon.scale.setScalar(THREE.MathUtils.lerp(20, 240, mu));
      this.moon.position.set(40, SEAT_Y - 30 - 160 * mu, -430);
      this.moon.rotation.set(-1.1, 1.2, 0);
      if (t >= P.earthrise - 1) {
        const r = smooth(P.earthrise - 1, P.earthrise + 4, t);
        er.scale.setScalar(26);
        er.position.set(-70, SEAT_Y - 40 + 70 * r, -440);
      }
    }

    // ---------------- cabin light: steady on the pad, flicker under thrust, then a little of the outside colour
    const thrust = t >= P.liftoff && t < P.meco ? 1 : t >= P.ignite && t < P.meco ? 0.5 : 0;
    const flick = thrust ? 0.04 * thrust * (Math.random() - 0.5) : 0;
    const base = 0.92 + flick;
    const c = this.panoMat.color;
    if (film) {
      const lum = 0.2126 * this.ambient.r + 0.7152 * this.ambient.g + 0.0722 * this.ambient.b;
      const k = 0.82 + 0.3 * lum;
      c.setRGB(k, k, k).lerp(this.ambient.clone().multiplyScalar(1.2), 0.12);
    } else c.setRGB(base, base * (1 - 0.02 * thrust), base * (1 - 0.05 * thrust));

    // ---------------- shake, toy, read-out, fade
    const kick = t >= P.filmStart && t < P.filmStart + 0.4 ? 0.012 : 0;
    const a = t >= P.liftoff && t < P.meco ? 0.005 + (maxQ ? 0.009 : 0) + kick : t >= P.ignite && t < P.meco ? 0.0025 : 0;
    this.rig.position.set((Math.random() - 0.5) * a, SEAT_Y + (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    this.layToy(t >= P.meco ? t - P.meco : 0, now, a);
    const ev = [...P.events].reverse().find((e) => t >= e.t && t < e.t + 4.5);
    this.drawHud(t - P.liftoff, ev ? ev[this.getLang()] : '');
    (this.fade.material as THREE.MeshBasicMaterial).opacity = smooth(P.total - 1.4, P.total, t);
    if (t >= P.total) this.finish();
  }

  /** the toy hangs (and swings) under gravity; once weightless it floats up on a slack string */
  private layToy(weightless: number, now: number, shake = 0) {
    const anchor = new THREE.Vector3(0.28, SEAT_Y + 0.56, -0.8);
    const L = 0.3;
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

  /** "T+00:12" over the event name — large type (clock ≈3.5°, event ≥2°), redrawn only when it changes */
  private drawHud(met: number, event: string) {
    const clock = met < -9 ? '' : `${met < 0 ? 'T−' : 'T+'}${String(Math.floor(Math.abs(met) / 60)).padStart(2, '0')}:${String(Math.floor(Math.abs(met) % 60)).padStart(2, '0')}`;
    const key = clock + '|' + event;
    if (key === this.hud.last) return;
    this.hud.last = key;
    const g = this.hud.g;
    const W = 1024;
    const H = 384;
    g.clearRect(0, 0, W, H);
    if (clock || event) {
      g.fillStyle = 'rgba(8,14,30,0.86)';
      g.beginPath();
      g.roundRect(8, 8, W - 16, H - 16, 44);
      g.fill();
      g.strokeStyle = 'rgba(77,132,255,0.95)';
      g.lineWidth = 6;
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      g.font = '800 150px system-ui, sans-serif';
      g.fillText(clock, W / 2, event ? 125 : H / 2);
      if (event) {
        g.fillStyle = '#9dbbff';
        let size = 92;
        do {
          g.font = `800 ${size}px system-ui, sans-serif`;
          size -= 4;
        } while (g.measureText(event).width > W - 70 && size > 56);
        if (g.measureText(event).width > W - 70) {
          // two short lines rather than tiny type
          const words = event.split(' · ');
          g.font = '800 64px system-ui, sans-serif';
          g.fillText(words[0], W / 2, 255);
          if (words[1]) g.fillText(words[1], W / 2, 325);
        } else g.fillText(event, W / 2, 275);
      }
    }
    this.hud.tex.needsUpdate = true;
  }
}
