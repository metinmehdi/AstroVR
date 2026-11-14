/** Console header: big title + breadcrumb, 5-step phase timeline, EVA clock pill, link status, cadet chip (view controls in broadcast). */
import { t } from '../shared/i18n';
import { evaClock } from '../shared/protocol';
import type { Lang, SimState } from '../shared/types';
import { Icon } from './icons';
import { tr, type SKey } from './strings';

export function Header({
  s,
  lang,
  step,
  connected,
  ready,
  cadetName,
  mirrorLive,
  broadcast,
  overlay,
  onData,
  onLang,
  onBroadcast,
}: {
  s: SimState;
  lang: Lang;
  step: number;
  connected: boolean;
  ready: boolean;
  cadetName: string;
  mirrorLive: boolean;
  broadcast: boolean;
  overlay: boolean;
  onData: () => void;
  onLang: () => void;
  onBroadcast: () => void;
}) {
  const eva = s.evaStartedAt === null ? 0 : s.t - s.evaStartedAt;
  const active = s.phase !== 'lobby';
  const name = cadetName.trim() || tr(lang, 'mc.phone');
  return (
    <header className={`hdr ${overlay ? 'hdr-bc' : ''}`}>
      <img className="hdr-logo" src="/images/astrovr-wordmark.png" alt="AstroVR" width={568} height={191} />
      <div className="hdr-title">
        <h1>{tr(lang, 'mc.console')}</h1>
        <nav className="crumbs" aria-label="Breadcrumb">
          <span>{tr(lang, 'mc.site').split(' · ')[0]}</span>
          <span className="crumb-sep">/</span>
          <b>{t(lang, `phase.${s.phase}` as 'phase.lobby')}</b>
        </nav>
      </div>

      <ol className="steps" aria-label="Mission phases">
        {[1, 2, 3, 4, 5].map((n) => {
          const state = !active || n > step ? 'todo' : n < step ? 'done' : 'cur';
          return (
            <li key={n} className={`step ${state}`}>
              <span className="step-num">{state === 'done' ? <Icon name="check" size={12} strokeWidth={3} /> : n}</span>
              <span className="step-lbl">{tr(lang, `step.${n}` as SKey)}</span>
            </li>
          );
        })}
      </ol>

      <div className="hdr-pills">
        <span className="pill-box clock" title={tr(lang, 'mc.evaClock')}>
          <span className="clock-lbl">EVA</span>
          <span className="clock-val">{evaClock(eva)}</span>
        </span>
        <span className={`pill-box stat ${connected ? 'ok' : 'bad'}`}>
          <i className="dot" /> {connected ? tr(lang, 'mc.link') : tr(lang, 'mc.noLink')}
        </span>
        {mirrorLive && (
          <span className="pill-box stat live">
            <i className="dot" /> VIDEO
          </span>
        )}
      </div>

      {broadcast && (
        <div className="hdr-actions">
          <button className="btn ghost" onClick={onData}>
            <Icon name="satellite" size={18} /> {tr(lang, 'mc.nasaData')}
          </button>
          <button className="btn ghost" onClick={onLang} aria-label="Language">
            <Icon name="globe" size={18} /> {lang === 'en' ? 'AZ' : 'EN'}
          </button>
          <button className="btn ghost active" onClick={onBroadcast} title={tr(lang, 'mc.broadcastHint')}>
            <Icon name="screen" size={18} /> {tr(lang, 'mc.operator')}
            <kbd>B</kbd>
          </button>
        </div>
      )}

      <div className={`cadet ${ready ? 'ready' : ''}`} title={ready ? tr(lang, 'mc.phoneReady') : tr(lang, 'mc.phoneWaiting')}>
        <span className="live-tag">
          <Icon name="star" size={11} strokeWidth={2.4} /> NASA DATA
        </span>
        <span className="avatar" aria-hidden="true">
          <Icon name="user" size={18} />
          <i className="avatar-dot" />
        </span>
        <span className="cadet-text">
          <b>{name}</b>
          <small>{ready ? tr(lang, 'mc.phoneReady') : tr(lang, 'mc.phoneWaiting')}</small>
        </span>
      </div>
    </header>
  );
}
