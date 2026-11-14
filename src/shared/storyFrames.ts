/**
 * The story intro's shots, timeline and 2D frame drawing — shared by Mission Control (projector, with live WebGL
 * shots and sound) and the phone (a cinema screen inside the capsule, silent: the room hears the projector).
 * On the phone the two 3D shots use pre-rendered stills of the same scenes (public/images/story-moon.jpg,
 * story-pad.jpg) so the headset never builds a second 3D world.
 */
import { STORY } from '../audio/lines';
import type { Lang } from './types';

export type ShotKind = 'earthrise' | 'bootprint' | 'moon3d' | 'pad3d' | 'sun' | 'title';
export interface Shot {
  kind: ShotKind;
  line: string;
  min: number;
  credit: Record<Lang, string>;
}
export const STORY_SHOTS: Shot[] = [
  { kind: 'earthrise', line: 'story1', min: 5, credit: { en: 'Apollo 8 "Earthrise", 1968 · NASA (AS08-14-2383)', az: 'Apollo 8 "Yerin doğuşu", 1968 · NASA (AS08-14-2383)' } },
  { kind: 'bootprint', line: 'story2', min: 5, credit: { en: 'Apollo 11 bootprint, 1969 · NASA (AS11-40-5878)', az: 'Apollo 11 ayaq izi, 1969 · NASA (AS11-40-5878)' } },
  { kind: 'moon3d', line: 'story3', min: 6.5, credit: { en: 'Real terrain of Nobile Rim 1, Moon south pole · NASA LRO LOLA', az: 'Nobile Rim 1-in real relyefi, Ayın cənub qütbü · NASA LRO LOLA' } },
  { kind: 'pad3d', line: 'story4', min: 5, credit: { en: 'AstroVR rocket (illustration)', az: 'AstroVR raketi (illüstrasiya)' } },
  { kind: 'sun', line: 'story5', min: 4.5, credit: { en: 'The real flare · NASA SDO, 11 May 2024, 01:29 UTC', az: 'Real alov · NASA SDO, 11 may 2024, 01:29 UTC' } },
  { kind: 'title', line: 'story6', min: 5.5, credit: { en: 'Real NASA data · AI voice (OpenAI TTS) · music synthesized in code', az: 'Real NASA datası · AI səs (OpenAI TTS) · musiqi kodla sintez olunub' } },
];

export interface Timeline {
  starts: number[];
  durs: number[];
  total: number;
}

/** each shot lasts at least its minimum, or its narration (file duration, else a reading-speed estimate) + air */
export function storyTimeline(lang: Lang, voiceDur: (number | null)[]): Timeline {
  const starts: number[] = [];
  const durs: number[] = [];
  let t = 0.4;
  STORY_SHOTS.forEach((s, i) => {
    const words = STORY[s.line][lang].split(/\s+/).length;
    const speech = voiceDur[i] ?? words / 2.6 + 0.5;
    const d = Math.max(s.min, speech + (i === STORY_SHOTS.length - 1 ? 2.2 : 0.8));
    starts.push(t);
    durs.push(d);
    t += d;
  });
  return { starts, durs, total: t };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(src));
    i.src = src;
  });
}

const ease = (u: number) => u * u * (3 - 2 * u);
const FADE = 0.45;

type Img = 'earthrise' | 'bootprint' | 'sun' | 'stars' | 'moonStill' | 'padStill';
const SRC: Record<Img, string> = {
  earthrise: '/images/story-earthrise.jpg',
  bootprint: '/images/story-bootprint.jpg',
  sun: '/images/story-sdo-0304.jpg',
  stars: '/textures/starmap.jpg',
  moonStill: '/images/story-moon.jpg',
  padStill: '/images/story-pad.jpg',
};

/**
 * Draws story frames into a 2D canvas. `letterbox`: cinema bars with subtitles inside the bottom bar (projector);
 * otherwise full-frame picture with subtitles over a dark band (VR screen).
 */
export class StoryCanvas {
  readonly canvas = document.createElement('canvas');
  readonly g: CanvasRenderingContext2D;
  readonly W: number;
  readonly H: number;
  private bar: number;
  img: Partial<Record<Img, HTMLImageElement>> = {};

  constructor(W: number, H: number, private letterbox: boolean) {
    this.W = W;
    this.H = H;
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.bar = letterbox ? Math.round(H * 0.12) : 0;
  }

  async load(stills: boolean) {
    // the phone skips the 4k star map (memory); its title card draws a light procedural star field instead
    const keys: Img[] = stills ? ['earthrise', 'bootprint', 'sun', 'moonStill', 'padStill'] : ['earthrise', 'bootprint', 'sun', 'stars'];
    const imgs = await Promise.all(keys.map((k) => loadImage(SRC[k]).catch(() => null)));
    keys.forEach((k, i) => {
      if (imgs[i]) this.img[k] = imgs[i]!;
    });
  }

  clear() {
    this.g.globalAlpha = 1;
    this.g.fillStyle = '#000';
    this.g.fillRect(0, 0, this.W, this.H);
  }

  /** Index of the shot at time `el` (−1 before the first). */
  shotAt(el: number, tl: Timeline): number {
    const i = tl.starts.findIndex((s, k) => el >= s && el < s + tl.durs[k]);
    if (i >= 0) return i;
    return el < tl.starts[0] ? -1 : STORY_SHOTS.length - 1;
  }

  /**
   * Draw the frame at story time `el`. For 3D shots, `draw3D(kind, u)` may return a rendered image to use;
   * otherwise the pre-rendered still is shown with a slow push-in.
   */
  frame(el: number, tl: Timeline, lang: Lang, draw3D?: (kind: ShotKind, u: number, local: number) => CanvasImageSource | null) {
    const { g, W, H } = this;
    this.clear();
    const i = this.shotAt(el, tl);
    if (i < 0) return;
    const shot = STORY_SHOTS[i];
    const local = el - tl.starts[i];
    const dur = tl.durs[i];
    const u = Math.min(1, local / dur);
    switch (shot.kind) {
      case 'earthrise':
        this.photo(this.img.earthrise, 0.56, 0.6, 1.0 + 0.22 * ease(u));
        break;
      case 'bootprint':
        this.photo(this.img.bootprint, 0.62, 0.62, 1.05 + 0.28 * ease(u));
        break;
      case 'sun':
        this.sun(u, local);
        break;
      case 'moon3d':
      case 'pad3d': {
        const live = draw3D?.(shot.kind, u, local);
        if (live) g.drawImage(live, 0, 0, W, H);
        else this.photo(shot.kind === 'moon3d' ? this.img.moonStill : this.img.padStill, 0.5, shot.kind === 'moon3d' ? 0.62 : 0.4, 1.0 + 0.14 * ease(u));
        break;
      }
      case 'title':
        this.title(u, local, lang);
        break;
    }
    const last = i === STORY_SHOTS.length - 1;
    const fade = Math.min(1, local / FADE, last ? 1 : (dur - local) / FADE);
    if (fade < 1) {
      g.fillStyle = `rgba(0,0,0,${1 - Math.max(0, fade)})`;
      g.fillRect(0, 0, W, H);
    }
    if (last && el > tl.total - 1.2) {
      g.fillStyle = `rgba(0,0,0,${Math.min(1, (el - (tl.total - 1.2)) / 1.2)})`;
      g.fillRect(0, 0, W, H);
    }
    if (this.letterbox) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, this.bar);
      g.fillRect(0, H - this.bar, W, this.bar);
    }
    if (!last) this.subtitle(STORY[shot.line][lang], Math.min(1, local / 0.6, (dur - local) / 0.4));
    g.globalAlpha = 0.6;
    g.fillStyle = '#c9d2dc';
    g.font = `500 ${Math.round(H * 0.019)}px system-ui, sans-serif`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(shot.credit[lang], W - W * 0.018, this.letterbox ? this.bar / 2 : H * 0.04);
    g.globalAlpha = 1;
  }

  /** image covering the frame (or contained), zoomed around a focus point (fx, fy in 0..1 image coords) */
  photo(img: HTMLImageElement | undefined, fx: number, fy: number, zoom: number, contain = false) {
    if (!img) return;
    const { g, W, H } = this;
    const base = contain ? Math.min(W / img.width, (H - 2 * this.bar) / img.height) : Math.max(W / img.width, H / img.height);
    const s = base * zoom;
    const dw = img.width * s;
    const dh = img.height * s;
    let x = W / 2 - fx * dw;
    let y = H / 2 - fy * dh;
    if (!contain) {
      x = Math.min(0, Math.max(W - dw, x));
      y = Math.min(0, Math.max(H - dh, y));
    }
    g.drawImage(img, x, y, dw, dh);
  }

  private sun(u: number, local: number) {
    const img = this.img.sun;
    if (!img) return;
    const { g, W, H } = this;
    const z = 0.95 + 0.3 * ease(u);
    const fx0 = 0.5 + 0.2 * ease(u);
    const fy0 = 0.5 + 0.08 * ease(u);
    this.photo(img, fx0, fy0, z, true);
    const base = Math.min((H - 2 * this.bar) / img.height, W / img.width) * z;
    const dw = img.width * base;
    const dh = img.height * base;
    const fx = W / 2 - fx0 * dw + 0.765 * dw;
    const fy = H / 2 - fy0 * dh + 0.6 * dh;
    const pulse = 0.35 + 0.35 * Math.max(0, Math.sin(local * 5.2));
    const r = H * 0.18;
    const grd = g.createRadialGradient(fx, fy, 2, fx, fy, r);
    grd.addColorStop(0, `rgba(255,250,235,${pulse})`);
    grd.addColorStop(1, 'rgba(255,140,60,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = grd;
    g.fillRect(fx - r, fy - r, 2 * r, 2 * r);
    g.globalCompositeOperation = 'source-over';
  }

  private title(u: number, local: number, lang: Lang) {
    const { g, W, H } = this;
    const stars = this.img.stars;
    if (stars) {
      const sw = stars.width * 0.32;
      const sh = (sw * H) / W;
      g.globalAlpha = 0.9;
      g.drawImage(stars, stars.width * (0.52 + 0.02 * u), stars.height * 0.3, sw, sh, 0, 0, W, H);
      g.globalAlpha = 1;
    } else {
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 260; i++) {
        const x = ((rnd() + u * 0.02) % 1) * W;
        const y = rnd() * H;
        const r = rnd() < 0.08 ? 1.6 : 0.8;
        g.globalAlpha = 0.35 + rnd() * 0.6;
        g.fillRect(x, y, r, r);
      }
      g.globalAlpha = 1;
    }
    const a = Math.min(1, Math.max(0, (local - 0.5) / 1.2));
    const k = H / 900;
    g.save();
    g.globalAlpha = a;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,122,26,0.85)';
    g.shadowBlur = 40 * k;
    g.fillStyle = '#ffffff';
    g.font = `800 ${Math.round(168 * k)}px system-ui, sans-serif`;
    g.fillText('AstroVR', W / 2, H / 2 - 50 * k);
    g.shadowBlur = 0;
    g.fillStyle = '#ff9a4a';
    g.font = `600 ${Math.round(40 * k)}px system-ui, sans-serif`;
    const ls = g as CanvasRenderingContext2D & { letterSpacing?: string };
    ls.letterSpacing = `${Math.round(10 * k)}px`;
    g.fillText(lang === 'az' ? 'MƏNİM İLK AY MİSSİYAM' : 'MY FIRST MOON MISSION', W / 2, H / 2 + 62 * k);
    ls.letterSpacing = '0px';
    g.globalAlpha = Math.min(1, Math.max(0, (local - 1.8) / 1));
    g.fillStyle = '#d7dee8';
    g.font = `500 ${Math.round(30 * k)}px system-ui, sans-serif`;
    g.fillText(lang === 'az' ? 'Real NASA datası. Real fırtına. Sənin qərarların.' : 'Real NASA data. A real storm. Your decisions.', W / 2, H / 2 + 130 * k);
    g.restore();
  }

  private subtitle(text: string, alpha: number) {
    const { g, W, H } = this;
    const k = H / 900;
    g.save();
    g.globalAlpha = Math.max(0, alpha);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 ${Math.round((this.letterbox ? 31 : 52) * k)}px system-ui, sans-serif`;
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (g.measureText(t).width > W * 0.88 && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    const lh = (this.letterbox ? 38 : 60) * k;
    const cy = this.letterbox ? H - this.bar / 2 : H - 90 * k;
    if (!this.letterbox) {
      // dark band behind the subtitle so it reads on any picture
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(0, cy - (lines.length * lh) / 2 - 14 * k, W, lines.length * lh + 28 * k);
    }
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 8 * k;
    const y0 = cy - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, j) => g.fillText(l, W / 2, y0 + j * lh));
    g.restore();
  }
}
