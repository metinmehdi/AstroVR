/** Lobby styled as a mission briefing screen: big QR to become the astronaut, cadet name, START, judge mode, quiz, Today's Sun. */
import { t } from '../shared/i18n';
import type { Lang } from '../shared/types';
import { ChallengeStrip } from './Broadcast';
import { Icon } from './icons';
import { Quiz } from './Quiz';
import { tr } from './strings';
import { TodaySun } from './TodaySun';

export function Lobby({
  lang,
  qr,
  code,
  cadetName,
  setCadetName,
  ready,
  onStart,
  onJudge,
  pre,
  onPreDone,
  onPreSkip,
}: {
  lang: Lang;
  qr: string;
  code: string;
  cadetName: string;
  setCadetName: (v: string) => void;
  ready: boolean;
  onStart: () => void;
  onJudge: () => void;
  pre: 'open' | 'done' | 'skipped';
  onPreDone: (a: number[]) => void;
  onPreSkip: () => void;
}) {
  return (
    <main className="lobby">
      <div className="lobby-hero">
        <div className="eyebrow accent">{tr(lang, 'lobby.kicker')} · {tr(lang, 'mc.site')}</div>
        <h1 className="lobby-title">{tr(lang, 'mc.mission')}</h1>
        <p className="lobby-goal">{tr(lang, 'lobby.goalText')}</p>
      </div>

      <div className="lobby-grid">
        <section className="card join">
          <div className="qr-frame">
            {qr ? <img src={qr} alt="QR" width={300} height={300} /> : <div className="qr-ph" />}
            <i className="qr-corner tl" />
            <i className="qr-corner tr" />
            <i className="qr-corner bl" />
            <i className="qr-corner br" />
          </div>
          <div className="join-text">
            <h2>
              <Icon name="qr" size={22} /> {tr(lang, 'lobby.scan')}
            </h2>
            <p className="muted">{tr(lang, 'lobby.scanSub')}</p>
            <div className="room">
              <span className="muted small">{tr(lang, 'lobby.room')}</span>
              <span className="room-code">{code}</span>
            </div>
            <div className={`join-status ${ready ? 'ok' : 'wait'}`}>
              <i className="dot" />
              <span>{ready ? t(lang, 'control.ready') : t(lang, 'control.waiting')}</span>
            </div>
          </div>
        </section>

        <div className="lobby-side">
          <section className="card launch">
            <label className="field">
              <span className="muted small">{tr(lang, 'lobby.cadet')}</span>
              <input placeholder={tr(lang, 'lobby.cadetPh')} value={cadetName} maxLength={24} onChange={(e) => setCadetName(e.target.value)} />
            </label>
            <button className="btn primary xl" disabled={!ready} onClick={onStart}>
              <Icon name="play" size={22} />
              {t(lang, 'control.start')}
            </button>
            <button className="btn judge" disabled={!ready} onClick={onJudge} title={tr(lang, 'lobby.judgeSub')}>
              <Icon name="lightning" size={18} />
              <span>
                <b>{tr(lang, 'lobby.judge')}</b>
                <small>{tr(lang, 'lobby.judgeSub')}</small>
              </span>
            </button>
          </section>
          {pre === 'open' ? (
            <Quiz mode="pre" lang={lang} onDone={onPreDone} onSkip={onPreSkip} />
          ) : (
            <section className="card quiz-done">
              <Icon name="check" size={18} /> {pre === 'done' ? tr(lang, 'quiz.saved') : `${tr(lang, 'quiz.preTitle')}: ${tr(lang, 'quiz.skip').toLowerCase()}`}
            </section>
          )}
          <TodaySun lang={lang} />
        </div>
      </div>
      <ChallengeStrip lang={lang} />
    </main>
  );
}
