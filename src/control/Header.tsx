/** Console header: mission identity, 5-step phase timeline, EVA clock, link status and view controls. */
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
  mirrorLive: boolean;
  broadcast: boolean;
  overlay: boolean;
  onData: () => void;
  onLang: () => void;
  onBroadcast: () => void;
}) {
  const eva = s.evaStartedAt === null ? 0 : s.t - s.evaStartedAt;
  const active = s.phase !== 'lobby';
  return (
    <header className={`hdr ${overlay ? 'hdr-bc' : ''}`}>
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="11" fill="#d9dde3" />
          <circle cx="16" cy="17" r="2.6" fill="#aab1bb" />
          <circle cx="23.5" cy="24" r="1.8" fill="#aab1bb" />
          <ellipse cx="20" cy="20" rx="18" ry="7" fill="none" stroke="#FF7A1A" strokeWidth="2.2" transform="rotate(-24 20 20)" />
        </svg>
        <div className="brand-text">
          <div className="brand-name">
            AstroVR <span className="brand-sep">/</span> <span className="brand-sub">{tr(lang, 'mc.console')}</span>
          </div>
          <div className="brand-mission">{tr(lang, 'mc.mission')}</div>
        </div>
      </div>

      <ol className="steps" aria-label="Mission phases">
        {[1, 2, 3, 4, 5].map((n) => {
          const state = !active || n > step ? 'todo' : n < step ? 'done' : 'cur';
          return (
            <li key={n} className={`step ${state}`}>
              {state === 'cur' ? (
                <span className="step-cur">{t(lang, `phase.${s.phase}` as 'phase.lobby')}</span>
              ) : (
                <>
                  <span className="step-num">{state === 'done' ? <Icon name="check" size={13} strokeWidth={3} /> : n}</span>
                  <span className="step-lbl">{tr(lang, `step.${n}` as SKey)}</span>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="clock" title={tr(lang, 'mc.evaClock')}>
        <span className="clock-lbl">EVA</span>
        <span className="clock-val">{evaClock(eva)}</span>
      </div>

      <div className="status">
        <span className={`stat ${connected ? 'ok' : 'bad'}`} title={connected ? tr(lang, 'mc.link') : tr(lang, 'mc.noLink')}>
          <i className="dot" /> {connected ? tr(lang, 'mc.link') : tr(lang, 'mc.noLink')}
        </span>
        <span className={`stat ${ready ? 'ok' : 'idle'}`}>
          <Icon name="user" size={14} /> {ready ? tr(lang, 'mc.phoneReady') : tr(lang, 'mc.phoneWaiting')}
        </span>
        {mirrorLive && (
          <span className="stat live">
            <i className="dot" /> VIDEO
          </span>
        )}
      </div>

      <div className="hdr-actions">
        <button className="btn ghost" onClick={onData}>
          <Icon name="satellite" size={18} /> {tr(lang, 'mc.nasaData')}
        </button>
        <button className="btn ghost" onClick={onLang} aria-label="Language">
          <Icon name="globe" size={18} /> {lang === 'en' ? 'AZ' : 'EN'}
        </button>
        <button className={`btn ghost ${broadcast ? 'active' : ''}`} onClick={onBroadcast} title={tr(lang, 'mc.broadcastHint')}>
          <Icon name="screen" size={18} /> {broadcast ? tr(lang, 'mc.operator') : tr(lang, 'mc.broadcast')}
          <kbd>B</kbd>
        </button>
      </div>
    </header>
  );
}
