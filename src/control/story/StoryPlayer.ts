/**
 * Campaign-style story intro (~35 s) for the projector: real NASA images (Apollo 8 Earthrise, Apollo 11 bootprint,
 * SDO's view of the real 11 May 2024 flare), the real south-pole terrain in 3D, the REAL Artemis I night launch (NASA photos), and the title.
 * Frames are drawn by the shared StoryCanvas (also used by the phone's in-capsule cinema screen); here the two 3D
 * shots are rendered live with WebGL. The canvas + sound can be recorded into a video file.
 * Narration: pre-generated TTS files (public/audio/{lang}/storyN.mp3) scheduled sample-accurately with Web Audio;
 * if a file is missing the browser voice reads the line. Music: synthesized (audio/score.ts).
 */
import * as THREE from 'three';
import available from '../../audio/available.json';
import { Score } from '../../audio/score';
import { createMoonScene, type MoonScene } from '../../scene/createMoonScene';
import { NOBILE_MAY2024 as SCENARIO } from '../../shared/scenario';
import { STORY_SHOTS as SHOTS, StoryCanvas, storyLineAt, storyTimeline, type ShotKind, type Timeline } from '../../shared/storyFrames';
import { sharedNow } from '../../shared/clock';
import type { Lang } from '../../shared/types';

const W = 1600;
const H = 900;
const HAS_FILE: Record<Lang, Set<string>> = { en: new Set(available.en as string[]), az: new Set(available.az as string[]) };
const ease = (u: number) => u * u * (3 - 2 * u);

interface Voice {
  buf?: AudioBuffer;
  el?: HTMLAudioElement;
  dur: number;
}

export interface StoryOptions {
  lang: Lang;
  record?: boolean;
  /** playback really started (assets loaded): the timeline, so the phone can show the same story in VR */
  /** at = shared clock (ms) of timeline zero, so the headset narrates in sync */
  onPlay?: (tl: Timeline, at: number) => void;
  onEnd: (recording?: Blob) => void;
}

export class StoryPlayer {
  private sc = new StoryCanvas(W, H, true);
  readonly canvas = this.sc.canvas;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(50, W / H, 0.5, 4000);
  private moon: MoonScene | null = null;
  private ctx: AudioContext;
  private master: GainNode;
  private score: Score;
  private recDest: MediaStreamAudioDestinationNode;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private tl: Timeline = { starts: [], durs: [], total: 0 };
  private t0 = 0;
  private raf = 0;
  private stopped = false;
  private timers: number[] = [];
  private els: HTMLAudioElement[] = [];

  constructor(private opts: StoryOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
    (window as unknown as { __astrovrStory?: StoryPlayer }).__astrovrStory = this; // debug / still export
  }

  /** Load assets (images, scenes, narration). A line is a decoded buffer, or an <audio> element if decoding fails. */
  private async prepare(): Promise<(Voice | null)[]> {
    void this.ctx.resume();
    this.sc.clear();
    await this.sc.load(false);
    this.moon = createMoonScene(SCENARIO, 'low');
    const lang = this.opts.lang;
    return Promise.all(
      SHOTS.map(async (s) => {
        if (!HAS_FILE[lang].has(s.line)) return null;
        const url = `/audio/${lang}/${s.line}.mp3`;
        try {
          const buf = await (await fetch(url, { headers: { Range: 'bytes=0-' } })).arrayBuffer(); // Range: see audio/voice.ts
          const b = await this.ctx.decodeAudioData(buf);
          return { buf: b, dur: b.duration };
        } catch {
          // some browsers cannot decode this MP3 in Web Audio: stream it through a media element instead
          return await new Promise<Voice | null>((res) => {
            const el = new Audio(url);
            el.preload = 'auto';
            el.onloadedmetadata = () => res({ el, dur: el.duration });
            el.onerror = () => res(null);
            setTimeout(() => res(null), 5000);
          });
        }
      }),
    );
  }

  /** Load, lay out the timeline, then play. */
  async start() {
    const voices = await this.prepare();
    if (this.stopped) return;
    const lang = this.opts.lang;
    this.tl = storyTimeline(
      lang,
      voices.map((v) => v?.dur ?? null),
    );
    const tl = this.tl;
    const lead = 0.25;
    const a0 = this.ctx.currentTime + lead;
    this.t0 = performance.now() + lead * 1000;
    this.score.story(tl.starts, tl.total, a0);
    SHOTS.forEach((_s, i) => {
      const at = storyLineAt(tl.starts, i);
      const v = voices[i];
      if (v?.buf) {
        const src = this.ctx.createBufferSource();
        src.buffer = v.buf;
        const vg = this.ctx.createGain();
        vg.gain.value = 1.15;
        src.connect(vg).connect(this.master);
        src.start(a0 + at);
        this.duck(a0 + at, v.dur);
      } else if (v?.el) {
        const el = v.el;
        this.els.push(el);
        try {
          this.ctx.createMediaElementSource(el).connect(this.master); // also recorded
        } catch {
          /* already connected */
        }
        this.timers.push(window.setTimeout(() => void el.play().catch(() => {}), (lead + at) * 1000));
        this.duck(a0 + at, v.dur);
      }
    });
    if (this.opts.record && typeof MediaRecorder !== 'undefined') {
      const stream = new MediaStream([...this.canvas.captureStream(30).getVideoTracks(), ...this.recDest.stream.getAudioTracks()]);
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.recorder.start(500);
    }
    const lat = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency || this.ctx.baseLatency || 0;
    this.opts.onPlay?.(tl, sharedNow() + (lead + lat) * 1000);
    const loop = () => {
      if (this.stopped) return;
      const el = Math.max(0, (performance.now() - this.t0) / 1000);
      this.sc.frame(el, tl, lang, (kind, u, local) => this.render3D(kind, u, local));
      if (el >= tl.total + 0.6) {
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

  /** Skip / Esc / skipped in VR: end now (no recording is delivered). */
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
    if (this.stopped) return;
    this.cleanup();
    this.opts.onEnd(blob);
  }

  private cleanup() {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearTimeout);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.els.forEach((a) => a.pause());
    this.score.stop(0.4);
    setTimeout(() => void this.ctx.close(), 600);
    this.moon?.dispose();
    this.renderer.dispose();
  }

  /** Debug: render a 3D shot at progress u and return it as a JPEG data URL (used to make the phone's stills). */
  async still(kind: 'moon3d', u: number): Promise<string> {
    if (!this.moon) await this.prepare();
    this.render3D(kind, u, u * 6);
    return this.renderer.domElement.toDataURL('image/jpeg', 0.88);
  }

  /* ------------------------------------------------------------------ 3D shots */

  private render3D(kind: ShotKind, u: number, _local: number): HTMLCanvasElement | null {
    const e = ease(u);
    const cam = this.camera;
    if (kind === 'moon3d' && this.moon) {
      cam.fov = 50;
      cam.position.set(THREE.MathUtils.lerp(55, 6, e), THREE.MathUtils.lerp(55, 12, e), THREE.MathUtils.lerp(200, 34, e));
      cam.lookAt(THREE.MathUtils.lerp(0, -18, e), THREE.MathUtils.lerp(0, 3, e), THREE.MathUtils.lerp(-80, -160, e));
      cam.updateProjectionMatrix();
      this.moon.update(1 / 60, null);
      this.renderer.render(this.moon.scene, cam);
      return this.renderer.domElement;
    }
    return null;
  }
}
