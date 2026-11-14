/** Three circular gauges: Power (battery), Oxygen (suit + walk-back margin), Radiation (dose vs the 0.8 mGy rule). */
import type { ReactNode } from 'react';
import type { Lang, SimState } from '../shared/types';
import { MISSION_DOSE_BUDGET_MGY } from '../sim/constants';
import { Icon } from './icons';
import { tr } from './strings';

type Tone = 'ok' | 'warn' | 'danger';

const ARC = 270; // degrees of the ring that are used (open at the bottom)
const R = 42;
const C = 2 * Math.PI * R;

export function Ring({ value, tone, children }: { value: number; tone: Tone; children?: ReactNode }) {
  const v = Math.max(0, Math.min(100, value));
  const track = (C * ARC) / 360;
  return (
    <div className={`ring tone-${tone}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <g transform="rotate(135 50 50)">
          <circle cx="50" cy="50" r={R} className="ring-track" strokeDasharray={`${track} ${C}`} />
          <circle cx="50" cy="50" r={R} className="ring-val" strokeDasharray={`${(track * v) / 100} ${C}`} />
        </g>
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

const toneHigh = (v: number, ok: number, warn: number): Tone => (v >= ok ? 'ok' : v >= warn ? 'warn' : 'danger');
const toneLow = (v: number, ok: number, warn: number): Tone => (v <= ok ? 'ok' : v <= warn ? 'warn' : 'danger');

export function Gauges({ s, lang, compact = false }: { s: SimState; lang: Lang; compact?: boolean }) {
  const battery = (s.power.batteryKWh / s.power.batteryMaxKWh) * 100;
  const net = s.power.solarInKW - s.power.loadKW;
  const margin = s.o2.walkbackMarginPct;
  return (
    <div className={`gauges ${compact ? 'compact' : ''}`}>
      <div className="gauge">
        <div className="gauge-head">
          <Icon name="bolt" size={16} /> {tr(lang, 'g.power')}
        </div>
        <Ring value={battery} tone={toneHigh(battery, 50, 20)}>
          <b>{Math.round(battery)}%</b>
          <small>{tr(lang, 'g.battery')}</small>
        </Ring>
        {!compact && (
          <div className="gauge-sub">
            <span>
              ☀ <b>{s.power.solarInKW.toFixed(1)}</b> {tr(lang, 'g.in')} · <b>{s.power.loadKW.toFixed(1)}</b> {tr(lang, 'g.out')} kW{' '}
              <span className={net >= 0 ? 'up' : 'down'}>{net >= 0 ? '▲' : '▼'}</span>
            </span>
          </div>
        )}
      </div>
      <div className="gauge">
        <div className="gauge-head">
          <Icon name="o2" size={16} /> {tr(lang, 'g.o2')}
        </div>
        <Ring value={s.o2.suitPct} tone={toneHigh(margin, 20, 5)}>
          <b>{Math.round(s.o2.suitPct)}%</b>
          <small>{tr(lang, 'g.suit')}</small>
        </Ring>
        {!compact && (
          <div className="gauge-sub">
            <span>
              {tr(lang, 'g.margin')} <b>{Math.max(0, Math.round(margin))}%</b>
            </span>
          </div>
        )}
      </div>
      <div className="gauge">
        <div className="gauge-head">
          <Icon name="radiation" size={16} /> {tr(lang, 'g.dose')}
        </div>
        <Ring value={s.dose.budgetPct} tone={toneLow(s.dose.budgetPct, 50, 80)}>
          <b>{s.dose.totalMGy.toFixed(2)}</b>
          <small>mGy</small>
        </Ring>
        {!compact && (
          <div className="gauge-sub">
            <span>
              <b>{s.dose.rateMGyPerH.toFixed(2)}</b> {tr(lang, 'g.rate')} · {tr(lang, 'g.rule', { v: MISSION_DOSE_BUDGET_MGY })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

