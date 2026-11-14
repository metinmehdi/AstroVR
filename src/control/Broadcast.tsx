/**
 * Broadcast pieces (projector / judges): REAL DATA proton chart, event banners, the "Challenge → AstroVR" strip and the
 * lower-third caption. Also used as overlays in operator mode.
 */
import { useEffect, useRef, useState } from 'react';
import type { Objective } from '../shared/objective';
import { NOBILE_MAY2024 as SCENARIO } from '../shared/scenario';
import { PROTON_PEAK } from '../shared/realdata';
import type { Lang, SimEvent, SimState } from '../shared/types';
import { describeEvent } from './events';
import { Icon } from './icons';
import { tr, type SKey } from './strings';

/* ------------------------------------------------------------------ real data chart */

const X_MAX = SCENARIO.realEvent.protonProfile[SCENARIO.realEvent.protonProfile.length - 1][0];
const Y_MAX = Math.ceil(PROTON_PEAK / 5) * 5;
const FLARE_UTC_MIN = 1 * 60 + 10; // 01:10 UTC, DONKI 2024-05-11T01:10:00-FLR-001

export function afterWarningS(s: SimState): number | null {
  if (!s.sep.warning || s.evaStartedAt === null) return null;
  return s.t - s.evaStartedAt - SCENARIO.timeline.sepWarningAfterEvaS;
}

export function ProtonChart({ s, lang }: { s: SimState; lang: Lang }) {
  const W = 420;
  const Hh = 190;
  const m = { l: 34, r: 12, t: 14, b: 26 };
  const X = (v: number) => m.l + (v / X_MAX) * (W - m.l - m.r);
  const Y = (v: number) => Hh - m.b - (v / Y_MAX) * (Hh - m.t - m.b);
  const prof = SCENARIO.realEvent.protonProfile;
  const path = prof.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('');
  const now = Math.max(0, Math.min(X_MAX, afterWarningS(s) ?? 0));
  const nowX = X(now);
  const area = `${path}L${X(X_MAX)},${Y(0)}L${X(0)},${Y(0)}Z`;
  const base = prof[0][1];
  const factor = s.sep.protons / base;
  // ticks at round UTC hours: minutes after flare / 4 = seconds after warning
  const ticks = [2, 6, 10, 14, 18].map((hh) => ({ hh, x: (hh * 60 - FLARE_UTC_MIN) / SCENARIO.realEvent.stormMinutesPerRealSecond }));
  return (
    <div className="chart">
      <div className="chart-head">
        <span className="real-tag">{tr(lang, 'bc.realData')}</span>
        <span className="chart-title">{tr(lang, 'bc.protons')}</span>
        <span className="spacer" />
        <span className="chart-factor">
          ×{factor >= 10 ? Math.round(factor) : factor.toFixed(1)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="chart-svg" role="img" aria-label={tr(lang, 'bc.protons')}>
        <defs>
          <linearGradient id="pgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FF7A1A" stopOpacity="0.55" />
            <stop offset="1" stopColor="#FF7A1A" stopOpacity="0.02" />
          </linearGradient>
          <clipPath id="played">
            <rect x="0" y="0" width={nowX} height={Hh} />
          </clipPath>
        </defs>
        {[0, Y_MAX / 2, Y_MAX].map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={m.l - 6} y={Y(v) + 4} textAnchor="end" className="axis">
              {v}
            </text>
          </g>
        ))}
        {ticks.map((tk) => (
          <text key={tk.hh} x={X(tk.x)} y={Hh - 8} textAnchor="middle" className="axis">
            {String(tk.hh).padStart(2, '0')}:00
          </text>
        ))}
        <path d={path} className="curve-future" />
        <g clipPath="url(#played)">
          <path d={area} fill="url(#pgrad)" />
          <path d={path} className="curve" />
        </g>
        <line x1={nowX} x2={nowX} y1={m.t - 4} y2={Y(0)} className="now-line" />
        <circle cx={nowX} cy={Y(s.sep.protons)} r="5" className="now-dot" />
        <text x={Math.min(nowX + 6, W - 60)} y={m.t + 6} className="now-label">
          {tr(lang, 'bc.now')} {s.sep.protons.toFixed(1)}
        </text>
      </svg>
      <div className="chart-src">
        {tr(lang, 'bc.chartSrc')} · {tr(lang, 'bc.utc')}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ banners */

export interface Banner {
  id: number;
  icon: string;
  title: string;
  sub: string;
  tone: 'warn' | 'danger' | 'ok' | 'info';
  until: number;
}

function stormBefore(events: SimEvent[], idx: number) {
  for (let i = idx - 1; i >= 0; i--) if (events[i].type === 'sepWarning' || events[i].type === 'quickMoon') return true;
  return false;
}

function toBanner(events: SimEvent[], i: number, lang: Lang): Omit<Banner, 'id' | 'until'> | null {
  const e = events[i];
  const B = (icon: string, title: SKey, sub: SKey, tone: Banner['tone']) => ({ icon, title: tr(lang, title), sub: tr(lang, sub), tone });
  switch (e.type) {
    case 'sunBlocked':
      return B('🌑', 'banner.sunBlocked', 'banner.sunBlockedSub', 'warn');
    case 'sepWarning':
    case 'quickMoon':
      return B('☢️', 'banner.sepWarning', 'banner.sepWarningSub', 'danger');
    case 'sepArrival':
      return B('☢️', 'banner.sepArrival', 'banner.sepArrivalSub', 'danger');
    case 'vsatUp':
      return B('☀️', 'banner.vsatUp', 'banner.vsatUpSub', 'ok');
    case 'loadShed':
      return B('🔋', 'banner.loadShed', 'banner.loadShedSub', 'danger');
    case 'abort':
      return { icon: '🚨', title: tr(lang, 'banner.abort'), sub: describeEvent(e, lang)?.text ?? '', tone: 'danger' };
    case 'move':
      if (!stormBefore(events, i)) return null;
      if (e.payload?.to === 'airlock') return B('🛡️', 'banner.sheltered', 'banner.shelteredSub', 'ok');
      if (SCENARIO.waypoints.find((w) => w.id === e.payload?.to)?.shadowRefuge) return B('⛰️', 'banner.shadow', 'banner.shadowSub', 'ok');
      return null;
    default:
      return null;
  }
}

const BANNER_MS = 7000;

/** New turning-point events → short-lived banners (newest two). */
export function useBanners(events: SimEvent[], lang: Lang): Banner[] {
  const [banners, setBanners] = useState<Banner[]>([]);
  const seen = useRef(0);
  const nextId = useRef(1);
  useEffect(() => {
    if (events.length < seen.current) {
      seen.current = 0;
      setBanners([]);
    }
    const add: Banner[] = [];
    for (let i = seen.current; i < events.length; i++) {
      const b = toBanner(events, i, lang);
      if (b) add.push({ ...b, id: nextId.current++, until: Date.now() + BANNER_MS });
    }
    seen.current = events.length;
    if (add.length) setBanners((old) => [...old, ...add].slice(-2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);
  useEffect(() => {
    if (!banners.length) return;
    const id = setInterval(() => setBanners((old) => old.filter((b) => b.until > Date.now())), 500);
    return () => clearInterval(id);
  }, [banners.length]);
  return banners;
}

export function Banners({ banners, big = false }: { banners: Banner[]; big?: boolean }) {
  if (!banners.length) return null;
  return (
    <div className={`banners ${big ? 'big' : ''}`} role="status">
      {banners.map((b) => (
        <div key={b.id} className={`banner tone-${b.tone}`}>
          <span className="banner-ico" aria-hidden="true">
            {b.icon}
          </span>
          <div>
            <div className="banner-title">{b.title}</div>
            {b.sub && <div className="banner-sub">{b.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ challenge strip */

const CHALLENGE: SKey[] = ['challenge.life', 'challenge.rad', 'challenge.power', 'challenge.food', 'challenge.comm', 'challenge.data'];

export function ChallengeStrip({ lang }: { lang: Lang }) {
  return (
    <div className="challenge">
      <span className="challenge-title">{tr(lang, 'challenge.title')}</span>
      {CHALLENGE.map((k) => (
        <span key={k} className="challenge-item">
          <Icon name="check" size={14} strokeWidth={3} /> {tr(lang, k)}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ lower third */

export function Caption({ obj, lang, phaseLabel }: { obj: Objective; lang: Lang; phaseLabel: string }) {
  return (
    <div className="caption">
      <div className="caption-icon" aria-hidden="true">
        {obj.icon}
      </div>
      <div className="caption-body">
        <div className="caption-kicker">{phaseLabel}</div>
        <div className="caption-main">{obj.control[lang]}</div>
        <div className="caption-sub">
          {tr(lang, 'now.astro')}: {obj.astro[lang]}
        </div>
      </div>
    </div>
  );
}
