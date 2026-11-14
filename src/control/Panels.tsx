/** Operator panels: NOW card (what to do), base systems (4 switches with their trade-offs) and the CAPCOM radio. */
import type { ReactNode } from 'react';
import { t } from '../shared/i18n';
import type { Objective } from '../shared/objective';
import type { Lang, RadioMessageType, SimState } from '../shared/types';
import { COMM_DELAY_MS } from '../shared/protocol';
import * as K from '../sim/constants';
import type { ControlCommand } from '../sim/model';
import { Icon } from './icons';
import { tr, type SKey } from './strings';

/* ------------------------------------------------------------------ NOW card */

export function NowCard({
  s,
  lang,
  obj,
  cmd,
  onRestart,
}: {
  s: SimState;
  lang: Lang;
  obj: Objective;
  cmd: (c: ControlCommand) => void;
  onRestart: () => void;
}) {
  const yourTurn = /^(YOUR TURN|SƏNİN NÖVBƏN)/.test(obj.control[lang]);
  return (
    <section className={`card now ${s.sep.warning ? 'now-storm' : ''} ${yourTurn ? 'now-turn' : ''}`} aria-live="polite">
      <div className="now-icon" aria-hidden="true">
        {obj.icon}
      </div>
      <div className="now-body">
        <div className="eyebrow">{tr(lang, 'now.title')}</div>
        <div className="now-control">{obj.control[lang]}</div>
        <div className="now-astro">
          <span className="muted">{tr(lang, 'now.astro')}:</span> {obj.astro[lang]}
        </div>
        <div className="now-actions">
          {(s.phase === 'briefing' || s.phase === 'prep') && (
            <button className="btn primary" onClick={() => cmd({ kind: 'next' })}>
              <Icon name={s.phase === 'prep' ? 'play' : 'next'} size={18} />
              {s.phase === 'prep' ? t(lang, 'control.goEva') : t(lang, 'control.next')}
            </button>
          )}
          <button className="btn ghost danger" onClick={() => cmd({ kind: 'endMission' })}>
            <Icon name="stop" size={16} />
            {t(lang, 'control.end')}
          </button>
          <button className="btn ghost icon-only" onClick={onRestart} title={tr(lang, 'ctl.restart')} aria-label={tr(lang, 'ctl.restart')}>
            <Icon name="restart" size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ systems */

function SystemCard({
  icon,
  name,
  status,
  on,
  kw,
  trade,
  control,
  extra,
}: {
  icon: string;
  name: string;
  status: string;
  on: boolean;
  kw: string;
  trade: string;
  control: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className={`sys ${on ? 'on' : 'off'}`}>
      <div className="sys-top">
        <span className="sys-ico">
          <Icon name={icon} size={20} />
        </span>
        <div className="sys-name">
          <b>{name}</b>
          <span className="sys-meta">
            <span className={`pill ${on ? 'pill-on' : 'pill-off'}`}>{status}</span> <span className="kw">{kw}</span>
          </span>
        </div>
        {control}
      </div>
      {extra}
      <div className="sys-trade">{trade}</div>
    </div>
  );
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="knob" />
    </button>
  );
}

export function Systems({ s, lang, cmd }: { s: SimState; lang: Lang; cmd: (c: ControlCommand) => void }) {
  const v = s.switches.vsat;
  const sw = (key: 'antenna' | 'shelter' | 'greenhouse') => (on: boolean) => cmd({ kind: 'switch', key, on });
  const onOff = (on: boolean) => tr(lang, on ? 'sys.on' : 'sys.off');
  return (
    <section className="card systems">
      <div className="card-title">
        <Icon name="bolt" size={16} /> {tr(lang, 'sys.title')}
      </div>
      <div className="sys-grid">
        <SystemCard
          icon="mast"
          name={t(lang, 'sw.vsat')}
          status={tr(lang, v === 'down' ? 'sys.down' : v === 'raising' ? 'sys.raising' : 'sys.up')}
          on={v !== 'down'}
          kw={v === 'raising' ? `−${K.VSAT_MOTOR_KW} kW` : v === 'up' ? `+${K.SOLAR_VSAT_UP_KW} kW` : `${K.VSAT_MOTOR_KW} kW · ${K.VSAT_RAISE_S} min`}
          trade={tr(lang, v === 'up' ? 'sys.vsat.tradeUp' : 'sys.vsat.trade')}
          control={
            v === 'down' ? (
              <button className={`btn sm ${s.sun.blocked ? 'primary pulse' : ''}`} onClick={() => cmd({ kind: 'raiseVsat' })}>
                {tr(lang, 'sys.raise')}
              </button>
            ) : (
              <span className="sys-state">{v === 'up' ? <Icon name="check" size={20} /> : `${Math.round(s.vsatProgress * 100)}%`}</span>
            )
          }
          extra={
            v === 'raising' ? (
              <div className="bar">
                <div style={{ width: `${s.vsatProgress * 100}%` }} />
              </div>
            ) : null
          }
        />
        <SystemCard
          icon="antenna"
          name={t(lang, 'sw.antenna')}
          status={onOff(s.switches.antenna)}
          on={s.switches.antenna}
          kw={`${K.LOAD_ANTENNA_KW} kW`}
          trade={tr(lang, 'sys.antenna.trade')}
          control={<Toggle on={s.switches.antenna} label={t(lang, 'sw.antenna')} onChange={sw('antenna')} />}
        />
        <SystemCard
          icon="shield"
          name={t(lang, 'sw.shelter')}
          status={onOff(s.switches.shelter)}
          on={s.switches.shelter}
          kw={`${K.LOAD_SHELTER_KW} kW`}
          trade={tr(lang, 'sys.shelter.trade')}
          control={<Toggle on={s.switches.shelter} label={t(lang, 'sw.shelter')} onChange={sw('shelter')} />}
        />
        <SystemCard
          icon="leaf"
          name={t(lang, 'sw.greenhouse')}
          status={onOff(s.switches.greenhouse)}
          on={s.switches.greenhouse}
          kw={`${K.LOAD_GREENHOUSE_KW} kW`}
          trade={tr(lang, 'sys.greenhouse.trade')}
          control={<Toggle on={s.switches.greenhouse} label={t(lang, 'sw.greenhouse')} onChange={sw('greenhouse')} />}
          extra={
            <div className={`bar thin ${s.greenhouseHealth < 0.7 ? 'bad' : ''}`} title={`${tr(lang, 'sys.plants')} ${Math.round(s.greenhouseHealth * 100)}%`}>
              <div style={{ width: `${s.greenhouseHealth * 100}%` }} />
            </div>
          }
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ radio */

export interface LastRadio {
  id: string;
  type: RadioMessageType;
  at: number; // sim seconds
  lost: boolean;
}

export const CAPCOM: { type: RadioMessageType; icon: string; key: SKey }[] = [
  { type: 'radioCheck', icon: 'radio', key: 'radio.radioCheck' },
  { type: 'statusRequest', icon: 'question', key: 'radio.statusRequest' },
  { type: 'returnToBase', icon: 'home', key: 'radio.returnToBase' },
  { type: 'seekShadow', icon: 'shadow', key: 'radio.seekShadow' },
  { type: 'finishSample', icon: 'flask', key: 'radio.finishSample' },
  { type: 'goodJob', icon: 'thumb', key: 'radio.goodJob' },
];

export function radioStatus(s: SimState, last: LastRadio | null): { tone: string; key: SKey } {
  if (!last) return { tone: 'muted', key: 'radio.idle' };
  if (last.lost) return { tone: 'danger', key: 'radio.lost' };
  if (s.events.some((e) => e.type === 'copy' && e.payload?.msgId === last.id)) return { tone: 'ok', key: 'radio.copy' };
  if (s.t - last.at < COMM_DELAY_MS / 1000) return { tone: 'info', key: 'radio.sent' };
  if (last.id in s.comms.pending) return { tone: 'warn', key: 'radio.waiting' };
  return { tone: 'muted', key: 'radio.noReply' };
}

export function Radio({ s, lang, last, onSend }: { s: SimState; lang: Lang; last: LastRadio | null; onSend: (t: RadioMessageType) => void }) {
  const st = radioStatus(s, last);
  const label = (type: RadioMessageType) => CAPCOM.find((c) => c.type === type);
  return (
    <section className="card radio">
      <div className="card-title">
        <Icon name="radio" size={16} /> {tr(lang, 'radio.title')}
        <span className="spacer" />
        <span className="muted small">{tr(lang, 'radio.delay')}</span>
      </div>
      <div className="radio-grid">
        {CAPCOM.map((c) => (
          <button key={c.type} className={`btn radio-btn ${!s.switches.antenna ? 'nolink' : ''}`} data-radio={c.type} onClick={() => onSend(c.type)}>
            <Icon name={c.icon} size={20} />
            <span>{tr(lang, c.key)}</span>
          </button>
        ))}
      </div>
      <div className={`radio-status tone-${st.tone}`}>
        <i className="dot" />
        <span>
          {last && <b>“{label(last.type) ? tr(lang, label(last.type)!.key) : last.type}” · </b>}
          {tr(lang, st.key)}
        </span>
        <span className="spacer" />
        <span className="muted small">{tr(lang, 'radio.stats', { sent: s.comms.sent, acked: s.comms.acked, lost: s.comms.lost })}</span>
      </div>
    </section>
  );
}
