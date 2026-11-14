/**
 * Moving space graphics for the dashboard:
 *  - Starfield: drifting, twinkling stars + an occasional shooting star behind the whole console (canvas, ~30 fps)
 *  - OrbitOverlay: slowly turning orbit rings with satellites over the helmet camera (SVG)
 *  - SignalLink: Earth → Moon radio link; packets cross in the REAL light delay (1.28 s), red and broken when the antenna is off
 *  - HeroZoom: magnifier button that widens the helmet camera (side columns shrink), Esc to go back
 * All motion stops when the OS asks for reduced motion.
 */
import { useEffect, useRef } from 'react';
import { COMM_DELAY_MS } from '../shared/protocol';
import type { Lang } from '../shared/types';
import { Icon } from './icons';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const L = (lang: Lang, en: string, az: string) => (lang === 'az' ? az : en);

/* ------------------------------------------------------------------ starfield */

interface Star {
  x: number;
  y: number;
  z: number; // depth 0.2..1 → size, speed, brightness
  tw: number; // twinkle phase
}
interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    let meteor: Meteor | null = null;
    let nextMeteor = 4;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const resize = () => {
      w = innerWidth;
      h = innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((w * h) / 9000);
      stars = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, z: 0.2 + Math.random() * 0.8, tw: Math.random() * 6.28 }));
    };
    resize();
    addEventListener('resize', resize);

    const still = reduced();
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc < 1 / 30 && !still) return; // ~30 fps is plenty for a background
      const step = acc;
      acc = 0;
      if (document.hidden) return;
      ctx.clearRect(0, 0, w, h);
      const t = now / 1000;
      for (const s of stars) {
        if (!still) {
          s.x -= s.z * s.z * 6 * step; // slow parallax drift to the left
          if (s.x < -2) {
            s.x = w + 2;
            s.y = Math.random() * h;
          }
        }
        const a = 0.25 + 0.55 * s.z * (0.75 + 0.25 * Math.sin(t * (0.8 + s.z * 1.6) + s.tw));
        ctx.globalAlpha = a;
        ctx.fillStyle = s.z > 0.85 ? '#cfe0ff' : '#ffffff';
        const r = 0.35 + s.z * 0.9;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (still) {
        cancelAnimationFrame(raf);
        return;
      }
      // shooting star every ~6–14 s
      nextMeteor -= step;
      if (!meteor && nextMeteor <= 0) {
        const ang = 0.35 + Math.random() * 0.35;
        const sp = 700 + Math.random() * 400;
        meteor = { x: w * (0.3 + Math.random() * 0.7), y: -20, vx: -Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1 };
        nextMeteor = 6 + Math.random() * 8;
      }
      if (meteor) {
        const m = meteor;
        m.x += m.vx * step;
        m.y += m.vy * step;
        m.life -= step * 0.9;
        const tail = 0.12;
        const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail);
        g.addColorStop(0, `rgba(190, 215, 255, ${0.9 * m.life})`);
        g.addColorStop(1, 'rgba(190, 215, 255, 0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - m.vx * tail, m.y - m.vy * tail);
        ctx.stroke();
        if (m.life <= 0 || m.y > h + 40 || m.x < -40) meteor = null;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}

/* ------------------------------------------------------------------ orbits over the helmet camera */

export function OrbitOverlay() {
  const still = reduced();
  return (
    <svg className="orbits" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="sat-glow">
          <stop offset="0" stopColor="#cfe0ff" />
          <stop offset="1" stopColor="#60a5fa" stopOpacity="0" />
        </radialGradient>
        <path id="orb-a" d="M 120 330 A 380 120 0 1 1 880 330 A 380 120 0 1 1 120 330" />
        <path id="orb-b" d="M 210 300 A 290 210 0 1 0 790 300 A 290 210 0 1 0 210 300" />
      </defs>
      <g className="orb-spin-a" transform="rotate(-14 500 330)">
        <use href="#orb-a" className="orb orb-dash" />
        {!still && (
          <circle r="7" fill="url(#sat-glow)">
            <animateMotion dur="26s" repeatCount="indefinite" rotate="auto">
              <mpath href="#orb-a" />
            </animateMotion>
          </circle>
        )}
      </g>
      <g transform="rotate(22 500 300)">
        <use href="#orb-b" className="orb" />
        {!still && (
          <>
            <circle r="5" fill="url(#sat-glow)">
              <animateMotion dur="38s" repeatCount="indefinite">
                <mpath href="#orb-b" />
              </animateMotion>
            </circle>
            <circle r="3.5" fill="#a3e635" opacity="0.85">
              <animateMotion dur="38s" begin="-19s" repeatCount="indefinite">
                <mpath href="#orb-b" />
              </animateMotion>
            </circle>
          </>
        )}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ Earth → Moon link */

export function SignalLink({ lang, on }: { lang: Lang; on: boolean }) {
  const still = reduced();
  const dur = `${COMM_DELAY_MS / 1000}s`;
  return (
    <section className={`card glass link-card ${on ? '' : 'off'}`}>
      <div className="link-head">
        <b>{L(lang, 'Earth → Moon link', 'Yer → Ay rabitəsi')}</b>
        <span className={`link-state ${on ? 'ok' : 'bad'}`}>
          <i className="dot" /> {on ? `${(COMM_DELAY_MS / 1000).toFixed(2)} s` : L(lang, 'antenna off', 'antena sönük')}
        </span>
      </div>
      <svg className="link-svg" viewBox="0 0 260 70" aria-hidden="true">
        <defs>
          <radialGradient id="earth-g" cx="35%" cy="35%">
            <stop offset="0" stopColor="#7cc4ff" />
            <stop offset="0.55" stopColor="#2563eb" />
            <stop offset="1" stopColor="#0b1f4d" />
          </radialGradient>
          <radialGradient id="moon-g" cx="35%" cy="35%">
            <stop offset="0" stopColor="#f1f5f9" />
            <stop offset="1" stopColor="#64748b" />
          </radialGradient>
          <path id="beam" d="M 34 35 Q 130 -2 228 35" />
        </defs>
        <circle cx="22" cy="35" r="17" fill="url(#earth-g)" className="earth" />
        <circle cx="22" cy="35" r="21" fill="none" stroke="rgba(96,165,250,0.35)" strokeWidth="1" className="earth-halo" />
        <circle cx="240" cy="35" r="11" fill="url(#moon-g)" />
        <circle cx="237" cy="31" r="2" fill="#94a3b8" />
        <circle cx="243" cy="39" r="1.4" fill="#94a3b8" />
        <use href="#beam" className="beam" />
        {on &&
          !still &&
          [0, 1, 2].map((i) => (
            <circle key={i} r="2.8" className="packet">
              <animateMotion dur={dur} begin={`${(i * COMM_DELAY_MS) / 3000}s`} repeatCount="indefinite">
                <mpath href="#beam" />
              </animateMotion>
            </circle>
          ))}
      </svg>
      <div className="link-foot muted small">{L(lang, 'radio waves travel at the speed of light', 'radio dalğaları işıq sürəti ilə gedir')}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ magnifier */

export function HeroZoom({ lang, wide, setWide }: { lang: Lang; wide: boolean; setWide: (v: boolean) => void }) {
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWide(false);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [wide, setWide]);
  const label = wide ? L(lang, 'Back to normal view (Esc)', 'Normal görünüşə qayıt (Esc)') : L(lang, 'Widen the camera view', 'Kameranı genişləndir');
  return (
    <button className={`hero-zoom ${wide ? 'on' : ''}`} onClick={() => setWide(!wide)} aria-pressed={wide} aria-label={label} title={label}>
      <Icon name={wide ? 'zoomOut' : 'zoomIn'} size={20} strokeWidth={2} />
    </button>
  );
}
