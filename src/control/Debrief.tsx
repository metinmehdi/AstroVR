/** 5. Evaluation: stars, what happened and why, the decision timeline, the "this was real" cards and the post-flight quiz. */
import type { ReactNode } from 'react';
import { t, type I18nKey } from '../shared/i18n';
import type { Lang, SimState } from '../shared/types';
import { NOBILE_MAY2024 as SCENARIO } from '../shared/scenario';
import { computeDebrief } from '../sim/scoring';
import iss from '../data/iss-dose.json';
import samples from '../data/samples.json';
import { clockLabel, describeEvent } from './events';
import { Icon } from './icons';
import { pilotLine, Quiz, QUESTIONS, score, type QuizStats } from './Quiz';
import { tr } from './strings';

function Stars({ n }: { n: number }) {
  return (
    <span className="star-row" aria-label={`${n}/3`}>
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 24 24" width="34" height="34" className={i < n ? 'star on' : 'star'} aria-hidden="true">
          <path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
        </svg>
      ))}
    </span>
  );
}

export function Debrief({
  s,
  lang,
  cadetName,
  onRetry,
  pre,
  post,
  stats,
  onPostDone,
}: {
  s: SimState;
  lang: Lang;
  cadetName: string;
  onRetry: () => void;
  pre: number[] | null;
  post: number[] | null;
  stats: QuizStats;
  onPostDone: (a: number[]) => void;
}) {
  const d = computeDebrief(s);
  const az = lang === 'az';
  const issDays = s.dose.totalMGy / iss.absorbedMGyPerDay;
  const rock = samples.items[0];
  const anySample = s.samples.some((x) => x.collected);
  const timeline = s.events.map((e) => ({ e, d: describeEvent(e, lang) })).filter((x) => x.d?.key);
  const total = d.prep + d.science + d.resources + d.teamwork;
  let quizBlock: ReactNode;
  if (!post) {
    quizBlock = <Quiz mode="post" lang={lang} onDone={onPostDone} />;
  } else {
    const a = pre ? score(pre) : null;
    const b = score(post);
    quizBlock = (
      <section className="card gain">
        <div className="card-title">
          <Icon name="question" size={16} /> {tr(lang, 'quiz.gain')}
        </div>
        <div className="gain-row">
          {a !== null && (
            <>
              <div className="gain-num">
                <span className="muted small">{tr(lang, 'quiz.before')}</span>
                <b>
                  {a}/{QUESTIONS.length}
                </b>
              </div>
              <span className="gain-arrow">→</span>
            </>
          )}
          <div className="gain-num after">
            <span className="muted small">{tr(lang, 'quiz.after')}</span>
            <b>
              {b}/{QUESTIONS.length}
            </b>
          </div>
          {a !== null && <span className={`gain-delta ${b - a > 0 ? 'up' : ''}`}>{b - a >= 0 ? `+${b - a}` : b - a}</span>}
        </div>
        {a === null && <p className="muted small">{tr(lang, 'quiz.noPre')}</p>}
        <p className="pilot">{pilotLine(lang, stats)}</p>
      </section>
    );
  }

  return (
    <main className="debrief">
      <section className="debrief-hero card">
        <div className="patch" aria-hidden="true">
          <svg viewBox="0 0 120 120" width="112" height="112">
            <defs>
              <linearGradient id="patchg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#1b2a40" />
                <stop offset="1" stopColor="#0a1220" />
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="56" fill="url(#patchg)" stroke="#FF7A1A" strokeWidth="4" />
            <circle cx="60" cy="66" r="24" fill="#d9dde3" />
            <circle cx="52" cy="60" r="5" fill="#aab1bb" />
            <circle cx="68" cy="74" r="3.5" fill="#aab1bb" />
            <text x="60" y="33" textAnchor="middle" fill="#eaf1fb" fontSize="11" fontWeight="800" letterSpacing="2">
              ASTROVR
            </text>
            <text x="60" y="101" textAnchor="middle" fill="#8a9bb2" fontSize="7" letterSpacing="1">
              NOBILE RIM 1
            </text>
          </svg>
        </div>
        <div className="debrief-head">
          <div className="eyebrow accent">{tr(lang, 'debrief.title')}</div>
          <h1>{cadetName || (az ? 'Kursant' : 'Cadet')}</h1>
          <p className="muted">
            AstroVR · {SCENARIO.site.name} · {total}/12 ★{s.abortReason ? ` · ${t(lang, 'phase.aborted')}` : ''}
          </p>
        </div>
        <div className="stars">
          {(['prep', 'science', 'resources', 'teamwork'] as const).map((k) => (
            <div key={k} className="star-card">
              <div className="muted small">{t(lang, `debrief.${k}`)}</div>
              <Stars n={d[k]} />
            </div>
          ))}
        </div>
      </section>

      <div className="debrief-grid">
        <section className="card notes-card">
          <div className="card-title">
            <Icon name="alert" size={16} /> {tr(lang, 'debrief.notes')}
          </div>
          {d.notes.length > 0 ? (
            <ul className="notes">
              {d.notes.map((n) => (
                <li key={n}>{t(lang, n as I18nKey)}</li>
              ))}
            </ul>
          ) : (
            <p className="ok-text">{tr(lang, 'debrief.great')}</p>
          )}
        </section>
        <section className="card real">
          <div className="card-title">
            <span className="real-tag">REAL</span> {tr(lang, 'debrief.real')}
          </div>
          <p>{SCENARIO.realEvent.description[lang]}</p>
          <p className="muted small">DONKI: {SCENARIO.realEvent.donkiIds.join(' · ')}</p>
        </section>
        <section className="card">
          <div className="card-title">
            <Icon name="radiation" size={16} /> {tr(lang, 'debrief.dose')}
          </div>
          <p className="big">{s.dose.totalMGy.toFixed(2)} mGy</p>
          <p>
            {az
              ? `= Beynəlxalq Kosmik Stansiyada təxminən ${issDays.toFixed(1)} gün (ISS TEPC: ${iss.absorbedMGyPerDay} mGy/gün, NASA)`
              : `≈ ${issDays.toFixed(1)} days on the International Space Station (ISS TEPC: ${iss.absorbedMGyPerDay} mGy/day, NASA)`}
          </p>
        </section>
        {anySample && rock && (
          <section className="card sample">
            <div className="card-title">
              <Icon name="flask" size={16} /> {tr(lang, 'debrief.sample')}
            </div>
            <img src="/images/genesis-rock.jpg" alt={rock.title} className="rock" />
            <p className="small">
              {az
                ? 'Apollo 15 "Genesis Rock" (15415): anortozit, 98% plagioklaz, ~4 milyard yaş. Ayın ilkin qabığından.'
                : 'Apollo 15 "Genesis Rock" (15415): anorthosite, 98% plagioclase, ~4 billion years old. A piece of the Moon\'s early crust.'}
            </p>
          </section>
        )}
      </div>

      <div className="debrief-grid two">
        <section className="card">
          <div className="card-title">
            <Icon name="list" size={16} /> {tr(lang, 'debrief.timeline')}
          </div>
          <ol className="timeline">
            {timeline.map(({ e, d: x }, i) => (
              <li key={i} className={`tone-${x!.tone}`}>
                <span className="tl-time">{clockLabel(e.t)}</span>
                <span className="tl-ico" aria-hidden="true">
                  {x!.icon}
                </span>
                <span>{x!.text}</span>
              </li>
            ))}
          </ol>
        </section>
        <div className="debrief-side">
          {quizBlock}
          <button className="btn primary xl" onClick={onRetry}>
            <Icon name="restart" size={20} /> {tr(lang, 'debrief.retry')}
          </button>
        </div>
      </div>
    </main>
  );
}
