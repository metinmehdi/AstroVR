/**
 * Dashboard chrome for the operator view (glass "space dashboard" layout):
 *  - Rail: the slim icon sidebar (views, NASA data, language)
 *  - StatColumn: battery trend card, three status tiles, mission numbers, power-by-system bars
 *  - HeroOverlay: floating step card + two donut rings over the helmet camera
 */
import { useRef } from 'react';
import type { Lang, SimState } from '../shared/types';
import * as K from '../sim/constants';
import { Ring } from './Gauges';
import { Icon } from './icons';
import { SignalLink } from './Space';
import { tr, type SKey } from './strings';

const L = (lang: Lang, en: string, az: string) => (lang === 'az' ? az : en);

/* ------------------------------------------------------------------ rail */

export function Rail({
  lang,
  broadcast,
  onData,
  onLang,
  onBroadcast,
}: {
  lang: Lang;
  broadcast: boolean;
  onData: () => void;
  onLang: () => void;
  onBroadcast: () => void;
}) {
  return (
    <nav className="rail" aria-label={L(lang, 'Views', 'Görünüşlər')}>
      <button className={`rail-btn ${!broadcast ? 'on' : ''}`} onClick={() => broadcast && onBroadcast()} aria-label={tr(lang, 'mc.operator')} title={tr(lang, 'mc.operator')}>
        <Icon name="globe" size={20} />
      </button>
      <button className={`rail-btn ${broadcast ? 'on' : ''}`} onClick={onBroadcast} aria-label={tr(lang, 'mc.broadcast')} title={`${tr(lang, 'mc.broadcast')} (B)`}>
        <Icon name="screen" size={20} />
      </button>
      <button className="rail-btn" onClick={onData} aria-label={tr(lang, 'mc.nasaData')} title={tr(lang, 'mc.nasaData')}>
        <Icon name="satellite" size={20} />
      </button>
      <span className="spacer" />
      <button className="rail-btn rail-lang" onClick={onLang} aria-label="Language" title="Language">
        <Icon name="globe" size={16} />
        <span>{lang === 'en' ? 'AZ' : 'EN'}</span>
      </button>
    </nav>
  );
}

/* ------------------------------------------------------------------ sparkline */

/** keeps the last `n` values of a number across renders (UI refreshes at 4 Hz) */
function useHistory(value: number, n = 80) {
  const h = useRef<number[]>([]);
  const last = h.current[h.current.length - 1];
  if (last === undefined || Math.abs(last - value) > 1e-6 || h.current.length < 2) {
    h.current.push(value);
    if (h.current.length > n) h.current.shift();
  }
  return h.current;
}

function Sparkline({ data, min, max }: { data: number[]; min: number; max: number }) {
  const W = 120;
  const H = 40;
  const pts = data.length > 1 ? data : [data[0] ?? 0, data[0] ?? 0];
  const span = max - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 6)] as const);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--ok)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--ok)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${W} ${H} L0 ${H} Z`} fill="url(#spark-fill)" />
      <path d={d} className="spark-line" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.6" className="spark-dot" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------ left column */

type Tone = 'ok' | 'warn' | 'danger';

function Tile({ icon, tone, label, value, sub }: { icon: string; tone: string; label: string; value: string; sub: string }) {
  return (
    <div className="tile">
      <span className={`tile-ico ti-${tone}`}>
        <Icon name={icon} size={20} strokeWidth={2} />
      </span>
      <div className="tile-text">
        <span className="tile-lbl">{label}</span>
        <b className="tile-val">{value}</b>
      </div>
      <span className="tile-sub">{sub}</span>
    </div>
  );
}

export function StatColumn({ s, lang }: { s: SimState; lang: Lang }) {
  const battery = (s.power.batteryKWh / s.power.batteryMaxKWh) * 100;
  const hist = useHistory(s.power.batteryKWh);
  const net = s.power.solarInKW - s.power.loadKW;
  const collected = s.samples.filter((x) => x.collected).length;
  const eva = s.evaStartedAt === null ? 0 : s.t - s.evaStartedAt;

  // power used by each system, kW (life support is always on)
  const v = s.switches.vsat;
  const loads: { key: string; label: string; kw: number; cls: string }[] = [
    { key: 'life', label: L(lang, 'Life support', 'Həyat təminatı'), kw: K.LOAD_LIFE_SUPPORT_KW, cls: 'b-blue' },
    { key: 'green', label: L(lang, 'Greenhouse', 'İstixana'), kw: s.switches.greenhouse ? K.LOAD_GREENHOUSE_KW : 0, cls: 'b-lime' },
    { key: 'shelter', label: L(lang, 'Shelter', 'Sığınacaq'), kw: s.switches.shelter ? K.LOAD_SHELTER_KW : 0, cls: 'b-slate' },
    { key: 'comms', label: L(lang, 'Antenna + mast', 'Antena + dirək'), kw: (s.switches.antenna ? K.LOAD_ANTENNA_KW : 0) + (v === 'raising' ? K.VSAT_MOTOR_KW : 0), cls: 'b-amber' },
  ];
  const total = loads.reduce((a, l) => a + l.kw, 0) || 1;
  const peak = Math.max(...loads.map((l) => l.kw), 0.01);
  const doseTone: Tone = s.dose.budgetPct <= 50 ? 'ok' : s.dose.budgetPct <= 80 ? 'warn' : 'danger';

  return (
    <aside className="stats" aria-label={L(lang, 'Mission numbers', 'Missiya göstəriciləri')}>
      <section className="card glass trend">
        <div className="trend-head">
          <span className="muted">{tr(lang, 'g.power')}</span>
          <span className="trend-tag">{tr(lang, 'g.battery')}</span>
        </div>
        <div className="trend-body">
          <b className="trend-val">{Math.round(battery)}%</b>
          <Sparkline data={hist} min={0} max={s.power.batteryMaxKWh} />
        </div>
        <div className={`trend-net ${net >= 0 ? 'up' : 'down'}`}>
          {net >= 0 ? '▲' : '▼'} {Math.abs(net).toFixed(1)} kW <span className="muted">{L(lang, 'net', 'balans')}</span>
        </div>
      </section>

      <div className="tiles">
        <Tile
          icon="sun"
          tone={s.sun.blocked ? 'amber' : 'blue'}
          label={L(lang, 'Solar in', 'Günəş enerjisi')}
          value={`${s.power.solarInKW.toFixed(1)} kW`}
          sub={s.sun.blocked ? L(lang, 'shaded', 'kölgədə') : L(lang, 'sunlit', 'işıqda')}
        />
        <Tile
          icon="o2"
          tone="lime"
          label={tr(lang, 'g.o2')}
          value={`${Math.round(s.o2.suitPct)}%`}
          sub={`${tr(lang, 'g.suit')}`}
        />
        <Tile
          icon="radiation"
          tone={doseTone === 'ok' ? 'amber' : 'red'}
          label={tr(lang, 'g.dose')}
          value={`${s.dose.totalMGy.toFixed(2)} mGy`}
          sub={`${s.dose.rateMGyPerH.toFixed(2)} ${tr(lang, 'g.rate')}`}
        />
      </div>

      <section className="figures">
        <div className="figures-title">{L(lang, 'Mission', 'Missiya')}</div>
        <div className="figure">
          <span className="muted">{tr(lang, 'mc.evaClock')}</span>
          <div className="figure-row">
            <b>{`${Math.floor(eva / 60)}:${String(Math.floor(eva % 60)).padStart(2, '0')}`}</b>
            <span className="delta">
              {collected}/2 {L(lang, 'samples', 'nümunə')}
            </span>
          </div>
        </div>
        <div className="figure">
          <span className="muted">{tr(lang, 'radio.title' as SKey)}</span>
          <div className="figure-row">
            <b>
              {s.comms.acked}
              <span className="figure-of"> / {s.comms.sent}</span>
            </b>
            <span className={`delta ${s.comms.lost ? 'bad' : ''}`}>
              {s.comms.lost ? `${s.comms.lost} ${L(lang, 'lost', 'itdi')}` : L(lang, 'copied', 'təsdiq')}
            </span>
          </div>
        </div>
      </section>

      <SignalLink lang={lang} on={s.switches.antenna} />

      <section className="card glass bars-card">
        <div className="bars-head">
          <b>{L(lang, 'Power use', 'Enerji sərfi')}</b>
          <span className="muted small">
            {s.power.loadKW.toFixed(1)} kW · {L(lang, 'by system', 'sistemlər üzrə')}
          </span>
        </div>
        <div className="bars" role="img" aria-label={loads.map((l) => `${l.label} ${l.kw.toFixed(1)} kW`).join(', ')}>
          {loads.map((l) => (
            <div key={l.key} className="bar-col">
              <span className="bar-pct">{Math.round((l.kw / total) * 100)}%</span>
              <div className={`bar-fill ${l.cls}`} style={{ height: `${Math.max(4, (l.kw / peak) * 100)}%` }} />
            </div>
          ))}
        </div>
        <ul className="bars-legend">
          {loads.map((l) => (
            <li key={l.key}>
              <i className={l.cls} />
              <span>{l.label}</span>
              <b>{l.kw.toFixed(1)} kW</b>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

/* ------------------------------------------------------------------ hero overlay */

export function HeroOverlay({ s, lang, step, stepName }: { s: SimState; lang: Lang; step: number; stepName: string }) {
  const margin = Math.max(0, Math.min(100, s.o2.walkbackMarginPct));
  const dose = Math.max(0, Math.min(100, s.dose.budgetPct));
  return (
    <>
      <div className="hero-card glass">
        <div className="hero-card-head">
          <i className="dot" />
          <span>{L(lang, 'Mission step', 'Missiya mərhələsi')}</span>
        </div>
        <div className="hero-card-val">
          {Math.max(step, 1)} <span>/ 5</span>
        </div>
        <div className="hero-card-sub">{stepName}</div>
      </div>
      <div className="hero-rings">
        <div className="hero-ring">
          <Ring value={margin} tone={margin >= 20 ? 'ok' : margin >= 5 ? 'warn' : 'danger'}>
            <b>
              {Math.round(margin)}
              <small>%</small>
            </b>
          </Ring>
          <span>{L(lang, 'O₂ margin', 'O₂ ehtiyatı')}</span>
        </div>
        <div className="hero-ring">
          <Ring value={dose} tone={dose <= 50 ? 'ok' : dose <= 80 ? 'warn' : 'danger'}>
            <b>
              {Math.round(dose)}
              <small>%</small>
            </b>
          </Ring>
          <span>{L(lang, 'Dose budget', 'Doza limiti')}</span>
        </div>
      </div>
    </>
  );
}
