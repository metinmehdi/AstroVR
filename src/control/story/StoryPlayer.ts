/**
 * Campaign-style story intro (~35 s) for the projector: real NASA images (Apollo 8 Earthrise, Apollo 11 bootprint,
 * SDO's view of the real 11 May 2024 flare), the real south-pole terrain in 3D, our rocket at dawn, and the title.
 * One 2D "compositor" canvas draws every frame (photos with slow Ken-Burns moves, the WebGL shots, letterbox,
 * subtitles, credits), so the same canvas can be recorded with its sound into a video file.
 * Narration: pre-generated TTS files (public/audio/{lang}/storyN.mp3) scheduled sample-accurately with Web Audio;
 * if a file is missing the browser voice reads the line. Music: synthesized (audio/score.ts).
 */
import * as THREE from 'three';
import available from '../../audio/available.json';
import { STORY } from '../../audio/lines';
import { Score } from '../../audio/score';
import { createMoonScene, type MoonScene } from '../../scene/createMoonScene';
import { createLaunchTower, createPadGround, createRocket, createSkyDome } from '../../scene/rocket';
import { NOBILE_MAY2024 as SCENARIO } from '../../shared/scenario';
import type { Lang } from '../../shared/types';

const W = 1600;
const H = 900;
const BAR = Math.round(H * 0.12); // cinematic letterbox (subtitles live in the bottom bar)
const FADE = 0.45;

type Kind = 'earthrise' | 'bootprint' | 'moon3d' | 'pad3d' | 'sun' | 'title';
interface Shot {
  kind: Kind;
  line: string;
  min: number;
  credit: Record<Lang, string>;
}
const SHOTS: Shot[] = [
  { kind: 'earthrise', line: 'story1', min: 5, credit: { en: 'Apollo 8 "Earthrise", 1968 · NASA (AS08-14-2383)', az: 'Apollo 8 "Yerin doğuşu", 1968 · NASA (AS08-14-2383)' } },
  { kind: 'bootprint', line: 'story2', min: 5, credit: { en: 'Apollo 11 bootprint, 1969 · NASA (AS11-40-5878)', az: 'Apollo 11 ayaq izi, 1969 · NASA (AS11-40-5878)' } },
  { kind: 'moon3d', line: 'story3', min: 6.5, credit: { en: 'Real terrain of Nobile Rim 1, Moon south pole · NASA LRO LOLA', az: 'Nobile Rim 1-in real relyefi, Ayın cənub qütbü · NASA LRO LOLA' } },
  { kind: 'pad3d', line: 'story4', min: 5, credit: { en: 'AstroVR rocket (illustration)', az: 'AstroVR raketi (illüstrasiya)' } },
  { kind: 'sun', line: 'story5', min: 4.5, credit: { en: 'The real flare · NASA SDO, 11 May 2024, 01:29 UTC', az: 'Real alov · NASA SDO, 11 may 2024, 01:29 UTC' } },
  { kind: 'title', line: 'story6', min: 5.5, credit: { en: 'Real NASA data · AI voice (OpenAI TTS) · music synthesized in code', az: 'Real NASA datası · AI səs (OpenAI TTS) · musiqi kodla sintez olunub' } },
];

const HAS_FILE: Record<Lang, Set<string>> = { en: new Set(available.en as string[]), az: new Set(available.az as string[]) };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(src));
    i.src = src;
  });
}

const ease = (u: number) => u * u * (3 - 2 * u);

export interface StoryOptions {
  lang: Lang;
  record?: boolean;
  onEnd: (recording?: Blob) => void;
}

export class StoryPlayer {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(50, W / H, 0.5, 4000);
  private moon: MoonScene | null = null;
  private pad = new THREE.Scene();
  private img: Partial<Record<'earthrise' | 'bootprint' | 'sun' | 'stars', HTMLImageElement>> = {};
  private ctx: AudioContext;
  private master: GainNode;
  private score: Score;
  private recDest: MediaStreamAudioDestinationNode;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private starts: number[] = [];
  private durs: number[] = [];
  private total = 0;
  private t0 = 0; // performance.now() at story time 0
  private raf = 0;
  private stopped = false;
  private timers: number[] = [];
  private vapor: THREE.Sprite[] = [];

  constructor(private opts: StoryOptions) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = true;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.recDest = this.ctx.createMediaStreamDestination();
    this.master.connect(this.recDest);
    this.score = new Score(this.ctx, this.master);
  }

  /** Load assets, lay out the timeline, then play. */
  async start() {
    void this.ctx.resume();
    this.drawLoading();
    const lang = this.opts.lang;
    const [earthrise, bootprint, sun, stars] = await Promise.all([
      loadImage('/images/story-earthrise.jpg'),
      loadImage('/images/story-bootprint.jpg'),
      loadImage('/images/story-sdo-0304.jpg'),
      loadImage('/textures/starmap.jpg'),
    ]);
    this.img = { earthrise, bootprint, sun, stars };
    this.buildPad();
    this.moon = createMoonScene(SCENARIO, 'low');
    // narration: decode the files so they can be scheduled exactly (and recorded)
    const voices = await Promise.all(
      SHOTS.map(async (s) => {
        if (!HAS_FILE[lang].has(s.line)) return null;
        try {
          const buf = await (await fetch(`/audio/${lang}/${s.line}.mp3`)).arrayBuffer();
          return await this.ctx.decodeAudioData(buf);
        } catch {
          return null;
        }
      }),
    );
    if (this.stopped) return;
    // timeline: each shot lasts at least its minimum, or its narration + breathing room
    let t = 0.4;
    SHOTS.forEach((s, i) => {
      const words = STORY[s.line][lang].split(/\s+/).length;
      const speech = voices[i]?.duration ?? words / 2.6 + 0.5;
      const d = Math.max(s.min, speech + (i === SHOTS.length - 1 ? 2.2 : 0.8));
      this.starts.push(t);
      this.durs.push(d);
      t += d;
    });
    this.total = t;
    // schedule audio against the AudioContext clock, and the picture against the same instant
    const lead = 0.25;
    const a0 = this.ctx.currentTime + lead;
    this.t0 = performance.now() + lead * 1000;
    this.score.story(this.starts, this.total, a0);
    SHOTS.forEach((s, i) => {
      const at = this.starts[i] + (i === SHOTS.length - 1 ? 0.9 : 0.35);
      const v = voices[i];
      if (v) {
        const src = this.ctx.createBufferSource();
        src.buffer = v;
        const vg = this.ctx.createGain();
        vg.gain.value = 1.15;
        src.connect(vg).connect(this.master);
        src.start(a0 + at);
        this.duck(a0 + at, v.duration);
      } else {
        this.timers.push(window.setTimeout(() => this.speak(STORY[s.line][lang]), (lead + at) * 1000));
      }
    });
    if (this.opts.record && typeof MediaRecorder !== 'undefined') {
      const stream = new MediaStream([...this.canvas.captureStream(30).getVideoTracks(), ...this.recDest.stream.getAudioTracks()]);
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.recorder.start(500);
    }
    const loop = () => {
      if (this.stopped) return;
      const el = (performance.now() - this.t0) / 1000;
      this.frame(Math.max(0, el));
      if (el >= this.total + 0.6) {
        void this.finish();
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** music dips under the narrator, then comes back */
  private duck(at: number, dur: number) {
    const g = this.score.out.gain;
    g.setTargetAtTime(0.5, at - 0.1, 0.12);
    g.setTargetAtTime(0.9, at + dur, 0.4);
  }

  private speak(text: string) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const want = this.opts.lang === 'az' ? ['az', 'tr'] : ['en'];
    const voices = speechSynthesis.getVoices();
    const v = want.map((w) => voices.find((x) => x.lang.toLowerCase().startsWith(w))).find(Boolean);
    if (v) u.voice = v;
    u.lang = v?.lang ?? (this.opts.lang === 'az' ? 'tr-TR' : 'en-US');
    u.rate = 0.88;
    u.pitch = 0.8;
    speechSynthesis.speak(u);
  }

  /** Skip / Esc: fade out and end now (no recording is delivered). */
  skip() {
    if (this.stopped) return;
    this.cleanup();
    this.opts.onEnd();
  }

  /** Unmount without ending the story (React cleanup). */
  dispose() {
    this.cleanup();
  }

  private async finish() {
    const rec = this.recorder;
    let blob: Blob | undefined;
    if (rec && rec.state !== 'inactive') {
      blob = await new Promise<Blob>((res) => {
        rec.onstop = () => res(new Blob(this.chunks, { type: rec.mimeType || 'video/webm' }));
        rec.stop();
      });
    }
    this.cleanup();
    this.opts.onEnd(blob);
  }

  private cleanup() {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearTimeout);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.score.stop(0.4);
    setTimeout(() => void this.ctx.close(), 600);
    this.moon?.dispose();
    this.renderer.dispose();
  }

  /* ------------------------------------------------------------------ scenes */

  private buildPad() {
    const sky = createSkyDome(1800, true);
    this.pad.add(sky.mesh);
    this.pad.add(createPadGround(1700));
    const rocket = createRocket();
    this.pad.add(rocket);
    const tower = createLaunchTower(100);
    tower.position.x = 14;
    this.pad.add(tower);
    const sun = new THREE.DirectionalLight(0xffc48a, 3.2);
    sun.position.set(-300, 60, -200);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 120, bottom: -10, near: 1, far: 900 });
    sun.shadow.mapSize.set(2048, 2048);
    // cool front fill from the camera side so the rocket is not a silhouette
    const fill = new THREE.DirectionalLight(0x9fb4ff, 1.4);
    fill.position.set(-120, 40, 260);
    this.pad.add(sun, fill, new THREE.HemisphereLight(0x9cb8ff, 0x3a2a1c, 1.0));
    // low dawn sun glow on the horizon
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const gg = c.getContext('2d')!;
    const grd = gg.createRadialGradient(64, 64, 2, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,240,210,1)');
    grd.addColorStop(0.25, 'rgba(255,170,90,0.6)');
    grd.addColorStop(1, 'rgba(255,120,40,0)');
    gg.fillStyle = grd;
    gg.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(c);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.position.set(-1300, 120, -900);
    glow.scale.set(700, 700, 1);
    this.pad.add(glow);
    // venting vapour around the cold core stage
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, opacity: 0.18, transparent: true, depthWrite: false }));
      s.userData = { y0: 8 + Math.random() * 50, a: Math.random() * Math.PI * 2, sp: 0.4 + Math.random() * 0.8 };
      this.vapor.push(s);
      this.pad.add(s);
    }
  }

  /* ------------------------------------------------------------------ drawing */

  private drawLoading() {
    const g = this.g;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
  }

  private frame(el: number) {
    const g = this.g;
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    let i = this.starts.findIndex((s, k) => el >= s && el < s + this.durs[k]);
    if (i < 0) i = el < this.starts[0] ? -1 : SHOTS.length - 1;
    if (i < 0) return;
    const local = el - this.starts[i];
    const dur = this.durs[i];
    const u = Math.min(1, local / dur);
    const shot = SHOTS[i];
    switch (shot.kind) {
      case 'earthrise':
        this.photo(this.img.earthrise!, 0.56, 0.6, 1.0 + 0.22 * ease(u));
        break;
      case 'bootprint':
        this.photo(this.img.bootprint!, 0.62, 0.62, 1.05 + 0.28 * ease(u));
        break;
      case 'sun':
        this.sun(u, local);
        break;
      case 'moon3d':
        this.moon3d(u, local);
        break;
      case 'pad3d':
        this.pad3d(u, local);
        break;
      case 'title':
        this.title(u, local);
        break;
    }
    // fade through black at every cut
    const last = i === SHOTS.length - 1;
    const fade = Math.min(1, local / FADE, last ? 1 : (dur - local) / FADE);
    if (fade < 1) {
      g.fillStyle = `rgba(0,0,0,${1 - Math.max(0, fade)})`;
      g.fillRect(0, 0, W, H);
    }
    if (last && el > this.total - 1.2) {
      g.fillStyle = `rgba(0,0,0,${Math.min(1, (el - (this.total - 1.2)) / 1.2)})`;
      g.fillRect(0, 0, W, H);
    }
    // letterbox, subtitle, credit
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, BAR);
    g.fillRect(0, H - BAR, W, BAR);
    if (!last) this.subtitle(STORY[shot.line][this.opts.lang], Math.min(1, local / 0.6, (dur - local) / 0.4));
    g.globalAlpha = 0.6;
    g.fillStyle = '#c9d2dc';
    g.font = '500 17px system-ui, sans-serif';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(shot.credit[this.opts.lang], W - 28, BAR / 2);
    g.globalAlpha = 1;
  }

  /** draw an image covering the frame, zoomed by `zoom` around the focus point (fx, fy in 0..1 image coords) */
  private photo(img: HTMLImageElement, fx: number, fy: number, zoom: number, contain = false) {
    const g = this.g;
    const base = contain ? Math.min(W / img.width, (H - 2 * BAR) / img.height) : Math.max(W / img.width, H / img.height);
    const s = base * zoom;
    const dw = img.width * s;
    const dh = img.height * s;
    // keep the focus point near the centre, but never show beyond the image edge (cover mode)
    let x = W / 2 - fx * dw;
    let y = H / 2 - fy * dh;
    if (!contain) {
      x = Math.min(0, Math.max(W - dw, x));
      y = Math.min(0, Math.max(H - dh, y));
    }
    g.drawImage(img, x, y, dw, dh);
  }

  private sun(u: number, local: number) {
    const g = this.g;
    const img = this.img.sun!;
    this.photo(img, 0.5 + 0.2 * ease(u), 0.5 + 0.08 * ease(u), 0.95 + 0.3 * ease(u), true);
    // the flare breathes
    const base = Math.min((H - 2 * BAR) / img.height, W / img.width) * (0.95 + 0.3 * ease(u));
    const dw = img.width * base;
    const dh = img.height * base;
    const x0 = W / 2 - (0.5 + 0.2 * ease(u)) * dw;
    const y0 = H / 2 - (0.5 + 0.08 * ease(u)) * dh;
    const fx = x0 + 0.765 * dw;
    const fy = y0 + 0.6 * dh;
    const pulse = 0.35 + 0.35 * Math.max(0, Math.sin(local * 5.2));
    const grd = g.createRadialGradient(fx, fy, 2, fx, fy, 160);
    grd.addColorStop(0, `rgba(255,250,235,${pulse})`);
    grd.addColorStop(1, 'rgba(255,140,60,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = grd;
    g.fillRect(fx - 170, fy - 170, 340, 340);
    g.globalCompositeOperation = 'source-over';
  }

  private moon3d(u: number, local: number) {
    if (!this.moon) return;
    const e = ease(u);
    const cam = this.camera;
    cam.fov = 50;
    cam.position.set(THREE.MathUtils.lerp(55, 6, e), THREE.MathUtils.lerp(55, 12, e), THREE.MathUtils.lerp(200, 34, e));
    cam.lookAt(THREE.MathUtils.lerp(0, -18, e), THREE.MathUtils.lerp(0, 3, e), THREE.MathUtils.lerp(-80, -160, e));
    cam.updateProjectionMatrix();
    this.moon.update(1 / 60, null);
    void local;
    this.renderer.render(this.moon.scene, cam);
    this.g.drawImage(this.renderer.domElement, 0, 0, W, H);
  }

  private pad3d(u: number, local: number) {
    const e = ease(u);
    const cam = this.camera;
    cam.fov = 42;
    cam.position.set(THREE.MathUtils.lerp(-70, -42, e), THREE.MathUtils.lerp(6, 16, e), THREE.MathUtils.lerp(120, 78, e));
    cam.lookAt(0, THREE.MathUtils.lerp(48, 70, e), 0);
    cam.updateProjectionMatrix();
    for (const s of this.vapor) {
      const d = s.userData as { y0: number; a: number; sp: number };
      const k = (local * d.sp * 0.25 + d.a) % 1;
      s.position.set(Math.cos(d.a) * (4.6 + k * 6), d.y0 - k * 6, Math.sin(d.a) * (4.6 + k * 6));
      s.scale.setScalar(4 + k * 10);
      (s.material as THREE.SpriteMaterial).opacity = 0.2 * (1 - k);
    }
    this.renderer.render(this.pad, cam);
    this.g.drawImage(this.renderer.domElement, 0, 0, W, H);
  }

  private title(u: number, local: number) {
    const g = this.g;
    const stars = this.img.stars!;
    // a slowly drifting crop of the real star map (NASA SVS Deep Star Maps)
    const sw = stars.width * 0.32;
    const sh = (sw * H) / W;
    g.globalAlpha = 0.9;
    g.drawImage(stars, stars.width * (0.52 + 0.02 * u), stars.height * 0.3, sw, sh, 0, 0, W, H);
    g.globalAlpha = 1;
    const a = Math.min(1, Math.max(0, (local - 0.5) / 1.2));
    g.save();
    g.globalAlpha = a;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,122,26,0.85)';
    g.shadowBlur = 40;
    g.fillStyle = '#ffffff';
    g.font = '800 168px system-ui, sans-serif';
    g.fillText('AstroVR', W / 2, H / 2 - 50);
    g.shadowBlur = 0;
    g.fillStyle = '#ff9a4a';
    g.font = '600 40px system-ui, sans-serif';
    const sub = this.opts.lang === 'az' ? 'MƏNİM İLK AY MİSSİYAM' : 'MY FIRST MOON MISSION';
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '10px';
    g.fillText(sub, W / 2, H / 2 + 62);
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
    const b = Math.min(1, Math.max(0, (local - 1.8) / 1));
    g.globalAlpha = b;
    g.fillStyle = '#d7dee8';
    g.font = '500 30px system-ui, sans-serif';
    g.fillText(
      this.opts.lang === 'az' ? 'Real NASA datası. Real fırtına. Sənin qərarların.' : 'Real NASA data. A real storm. Your decisions.',
      W / 2,
      H / 2 + 130,
    );
    g.restore();
  }

  private subtitle(text: string, alpha: number) {
    const g = this.g;
    g.save();
    g.globalAlpha = Math.max(0, alpha);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 31px system-ui, sans-serif';
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 8;
    // wrap to two lines inside the bottom bar region
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (g.measureText(t).width > W * 0.8 && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    const y0 = H - BAR / 2 - ((lines.length - 1) * 38) / 2;
    lines.forEach((l, k) => g.fillText(l, W / 2, y0 + k * 38));
    g.restore();
  }
}
