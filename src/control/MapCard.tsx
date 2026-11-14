/**
 * Surface map: hillshade of the REAL LOLA terrain (src/data/terrain-nobile.json, 4 m grid) lit from the REAL Sun position
 * on the mission date (JPL Horizons, MISSION_SKY) — including cast shadows ray-marched over the DEM — with routes A/B,
 * waypoints, the shadow refuge and the astronaut.
 */
import { useEffect, useRef } from 'react';
import terrain from '../data/terrain-nobile.json';
import { MISSION_SKY } from '../shared/realdata';
import { NOBILE_MAY2024 as SCENARIO } from '../shared/scenario';
import type { Lang, SimState } from '../shared/types';
import { Icon } from './icons';
import { tr } from './strings';

const H = terrain.heights as number[];
const N = terrain.n;
const HALF = terrain.sizeM / 2;
const STEP = terrain.stepM;

function height(x: number, z: number): number {
  const fx = Math.min(N - 1.001, Math.max(0, (x + HALF) / STEP));
  const fz = Math.min(N - 1.001, Math.max(0, (z + HALF) / STEP));
  const j = Math.floor(fx);
  const i = Math.floor(fz);
  const tx = fx - j;
  const tz = fz - i;
  const a = H[i * N + j];
  const b = H[i * N + j + 1];
  const c = H[(i + 1) * N + j];
  const d = H[(i + 1) * N + j + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** raster extent (world metres) and resolution */
const R_HALF = 150;
const R_RES = 1; // metres per raster pixel
let raster: HTMLCanvasElement | null = null;

function buildRaster(): HTMLCanvasElement {
  if (raster) return raster;
  const size = Math.round((2 * R_HALF) / R_RES);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const az = (MISSION_SKY.sun.azimuthDeg * Math.PI) / 180;
  const el = (MISSION_SKY.sun.elevationDeg * Math.PI) / 180;
  // x east, z south, y up (same as the 3D scene)
  const L = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  const horiz = Math.hypot(L[0], L[2]);
  const ux = L[0] / horiz;
  const uz = L[2] / horiz;
  const rise = Math.tan(el);
  const maxH = terrain.maxM + 1;
  for (let py = 0; py < size; py++) {
    const z = -R_HALF + (py + 0.5) * R_RES;
    for (let px = 0; px < size; px++) {
      const x = -R_HALF + (px + 0.5) * R_RES;
      const h0 = height(x, z);
      const dx = (height(x + 1, z) - height(x - 1, z)) / 2;
      const dz = (height(x, z + 1) - height(x, z - 1)) / 2;
      const nl = Math.hypot(dx, 1, dz);
      const lit = (-dx * L[0] + L[1] - dz * L[2]) / nl;
      // cast shadow: march toward the Sun until the ray is above every peak
      let shadow = false;
      for (let d = 2; d < 420; d += d < 60 ? 2 : 4) {
        const ry = h0 + 0.2 + d * rise;
        if (ry > maxH) break;
        const sx = x + ux * d;
        const sz = z + uz * d;
        if (Math.abs(sx) > HALF || Math.abs(sz) > HALF) break;
        if (height(sx, sz) > ry) {
          shadow = true;
          break;
        }
      }
      const k = Math.max(0, Math.min(1, (lit + 0.04) / 0.42));
      const b = shadow ? 0.13 + 0.1 * k : 0.2 + 0.8 * Math.pow(k, 0.8);
      const o = (py * size + px) * 4;
      if (shadow) {
        img.data[o] = 40 * b + 18;
        img.data[o + 1] = 60 * b + 24;
        img.data[o + 2] = 110 * b + 38;
      } else {
        img.data[o] = 236 * b + 8;
        img.data[o + 1] = 228 * b + 8;
        img.data[o + 2] = 214 * b + 10;
      }
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  raster = cv;
  return cv;
}

const WP = Object.fromEntries(SCENARIO.waypoints.map((w) => [w.id, w]));
// region of interest: all waypoints + padding
const xs = SCENARIO.waypoints.map((w) => w.x);
const zs = SCENARIO.waypoints.map((w) => w.z);
const ROI = { x0: Math.min(...xs) - 32, x1: Math.max(...xs) + 32, z0: Math.min(...zs) - 24, z1: Math.max(...zs) + 24 };
const ROUTE_COLOR: Record<string, string> = { A: '#FF7A1A', B: '#38bdf8' };

export function MapCard({ s, lang }: { s: SimState; lang: Lang }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const latest = useRef(s);
  latest.current = s;
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    const canvas = cv.current!;
    const ctx = canvas.getContext('2d')!;
    const img = buildRaster();
    const start = WP[latest.current.astronaut.waypointId] ?? WP.airlock; // remount (view switch) → no glide from base
    const pos = { x: start.x, z: start.z };
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const st = latest.current;
      const L = langRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = Math.min(w / (ROI.x1 - ROI.x0), h / (ROI.z1 - ROI.z0));
      const cx = (ROI.x0 + ROI.x1) / 2;
      const cz = (ROI.z0 + ROI.z1) / 2;
      const X = (x: number) => w / 2 + (x - cx) * scale;
      const Y = (z: number) => h / 2 + (z - cz) * scale;

      ctx.fillStyle = '#05080d';
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, X(-R_HALF), Y(-R_HALF), 2 * R_HALF * scale, 2 * R_HALF * scale);
      // vignette for legibility
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(5,8,13,0)');
      g.addColorStop(1, 'rgba(5,8,13,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // routes
      for (const [id, route] of Object.entries(SCENARIO.routes)) {
        const chosen = st.route === id;
        ctx.save();
        ctx.strokeStyle = ROUTE_COLOR[id];
        ctx.lineWidth = chosen ? 4 : 2.5;
        ctx.globalAlpha = st.route && !chosen ? 0.45 : 0.95;
        ctx.setLineDash(chosen ? [] : [7, 6]);
        if (chosen) {
          ctx.shadowColor = ROUTE_COLOR[id];
          ctx.shadowBlur = 10;
        }
        ctx.beginPath();
        route.forEach((wid, i) => (i ? ctx.lineTo(X(WP[wid].x), Y(WP[wid].z)) : ctx.moveTo(X(WP[wid].x), Y(WP[wid].z))));
        ctx.stroke();
        ctx.restore();
      }

      // waypoints
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (const wp of SCENARIO.waypoints) {
        const px = X(wp.x);
        const py = Y(wp.z);
        if (wp.id === 'airlock') {
          ctx.fillStyle = '#eaf1fb';
          ctx.strokeStyle = '#05080d';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(px - 9, py - 9, 18, 18, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#05080d';
          ctx.fillText('⌂', px - 4.5, py + 0.5);
          label(ctx, L === 'az' ? 'BAZA' : 'BASE', px + 14, py, '#eaf1fb');
        } else if (wp.siteId) {
          const letter = wp.siteId === 'siteA' ? 'A' : 'B';
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = ROUTE_COLOR[letter];
          ctx.strokeStyle = '#05080d';
          ctx.lineWidth = 2;
          ctx.fillRect(-8, -8, 16, 16);
          ctx.strokeRect(-8, -8, 16, 16);
          ctx.restore();
          ctx.fillStyle = '#05080d';
          ctx.font = '800 11px "Segoe UI", system-ui, sans-serif';
          ctx.fillText(letter, px - 3.5, py + 0.5);
          ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
          label(ctx, `${L === 'az' ? 'Nümunə' : 'Sample'} ${letter}`, px + 14, py, '#eaf1fb');
        } else if (wp.shadowRefuge) {
          ctx.strokeStyle = '#a5b4fc';
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(px, py, 13, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#a5b4fc';
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
          label(ctx, tr(L, 'map.refuge'), px + 16, py + 12, '#c7d2fe');
        } else {
          ctx.fillStyle = 'rgba(234,241,251,0.85)';
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // astronaut (smoothly lopes between waypoints)
      const target = WP[st.astronaut.waypointId] ?? WP.airlock;
      pos.x += (target.x - pos.x) * 0.06;
      pos.z += (target.z - pos.z) * 0.06;
      const ax = X(pos.x);
      const ay = Y(pos.z);
      const pulse = (now / 1200) % 1;
      ctx.strokeStyle = `rgba(255,122,26,${1 - pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ax, ay, 8 + pulse * 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ax, ay, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FF7A1A';
      ctx.beginPath();
      ctx.arc(ax, ay, 4.2, 0, Math.PI * 2);
      ctx.fill();

      // Sun direction (azimuth from north, clockwise; screen up = north)
      const saz = (MISSION_SKY.sun.azimuthDeg * Math.PI) / 180;
      const dx = Math.sin(saz);
      const dy = -Math.cos(saz);
      const t = Math.min((w / 2 - 30) / Math.abs(dx || 1e-6), (h / 2 - 26) / Math.abs(dy || 1e-6));
      const sx = w / 2 + dx * t;
      const sy = h / 2 + dy * t;
      const blocked = st.sun.blocked;
      ctx.save();
      ctx.strokeStyle = blocked ? 'rgba(138,155,178,0.6)' : 'rgba(255,200,90,0.75)';
      ctx.fillStyle = blocked ? '#8a9bb2' : '#ffc95a';
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(sx - dx * 70, sy - dy * 70);
      ctx.lineTo(sx - dx * 16, sy - dy * 16);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * 11, sy + Math.sin(a) * 11);
        ctx.lineTo(sx + Math.cos(a) * 15, sy + Math.sin(a) * 15);
        ctx.stroke();
      }
      ctx.restore();
      const sunBase = `${tr(L, 'map.sun')} ${MISSION_SKY.sun.elevationDeg.toFixed(1)}°`;
      const sunTxt = blocked ? `${sunBase} · ${L === 'az' ? 'örtülü' : 'blocked'}` : sunBase;
      ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
      const tw = ctx.measureText(sunTxt).width;
      const right = sx + 20 + tw < w - 4;
      label(ctx, sunTxt, right ? sx + 20 : sx - 20, sy, blocked ? '#8a9bb2' : '#ffd88a', right ? 'left' : 'right');

      // north arrow
      ctx.fillStyle = '#eaf1fb';
      ctx.beginPath();
      ctx.moveTo(18, 12);
      ctx.lineTo(24, 26);
      ctx.lineTo(18, 22);
      ctx.lineTo(12, 26);
      ctx.closePath();
      ctx.fill();
      ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('N', 14.5, 36);

      // 100 m scale bar
      const bar = 100 * scale;
      const bx = w - 14 - bar;
      const by = h - 16;
      ctx.strokeStyle = '#eaf1fb';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by - 5);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + bar, by);
      ctx.lineTo(bx + bar, by - 5);
      ctx.stroke();
      ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
      label(ctx, '100 m', bx + bar / 2, by - 12, '#eaf1fb', 'center');
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <section className="card map">
      <div className="card-title">
        <Icon name="map" size={16} /> {tr(lang, 'map.title')}
        <span className="spacer" />
        <span className="legend">
          <i style={{ background: ROUTE_COLOR.A }} /> A <i style={{ background: ROUTE_COLOR.B }} /> B
        </span>
      </div>
      <canvas ref={cv} className="map-canvas" aria-label={tr(lang, 'map.sub')} />
      <div className="map-sub">{tr(lang, 'map.sub')}</div>
    </section>
  );
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left') {
  ctx.save();
  ctx.textAlign = align;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(5,8,13,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
