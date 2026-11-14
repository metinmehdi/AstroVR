/**
 * Measurable impact: the same 3 multiple-choice questions BEFORE (lobby, optional) and AFTER the mission (debrief).
 * No personal data — only aggregate counts in localStorage `astrovr.quiz.v1`.
 */
import { useState } from 'react';
import type { Lang } from '../shared/types';
import { Icon } from './icons';
import { tr } from './strings';

interface Question {
  q: Record<Lang, string>;
  options: Record<Lang, string>[];
  correct: number;
  why: Record<Lang, string>;
}

const L = (en: string, az: string): Record<Lang, string> => ({ en, az });

export const QUESTIONS: Question[] = [
  {
    q: L('Why go to the shelter during a solar storm?', 'Günəş fırtınası zamanı niyə sığınacağa getmək lazımdır?'),
    options: [
      L('It is warmer inside', 'İçəridə daha istidir'),
      L('Walls and terrain block part of the radiation', 'Divarlar və relyef radiasiyanın bir hissəsini saxlayır'),
      L('The storm makes it too dark to see', 'Fırtına zamanı hər yer qaranlıq olur'),
      L('Radio works better inside', 'İçəridə radio daha yaxşı işləyir'),
    ],
    correct: 1,
    why: L(
      'Matter between you and the protons stops part of them: the shelter gives ≈4× less dose, a crater shadow ≈40% less.',
      'Səninlə protonlar arasındakı maddə onların bir hissəsini saxlayır: sığınacaq dozanı ≈4 dəfə, krater kölgəsi ≈40% azaldır.',
    ),
  },
  {
    q: L('Why are solar panels on tall masts at the lunar south pole?', 'Ayın cənub qütbündə günəş panelləri niyə hündür dirəklərdə olur?'),
    options: [
      L('To stay away from Moon dust', 'Ay tozundan uzaq olmaq üçün'),
      L('To be closer to the Sun', 'Günəşə daha yaxın olmaq üçün'),
      L('The Sun is very low, so terrain casts long shadows', 'Günəş çox alçaqdır, relyef uzun kölgələr salır'),
    ],
    correct: 2,
    why: L(
      'At the pole the Sun stays only a few degrees above the horizon (4° on our mission date), so a small hill can hide it. NASA’s VSAT masts lift panels ~10 m into the light.',
      'Qütbdə Günəş üfüqdən cəmi bir neçə dərəcə yuxarıda olur (missiya günü 4°), kiçik təpə belə onu örtə bilər. NASA-nın VSAT dirəkləri panelləri ~10 m yuxarı, işığa qaldırır.',
    ),
  },
  {
    q: L('Why do radio messages from Earth arrive late?', 'Yerdən gələn radio mesajları niyə gecikir?'),
    options: [
      L('Radio waves travel at light speed and need ~1.3 s to reach the Moon', 'Radio dalğaları işıq sürəti ilə gedir və Aya çatmaq ~1.3 s çəkir'),
      L('The Moon’s thick air slows them down', 'Ayın qalın havası onları yavaşladır'),
      L('The antenna has to warm up first', 'Antenna əvvəlcə qızmalıdır'),
    ],
    correct: 0,
    why: L(
      'The Moon is 384,400 km away. Even at the speed of light (300,000 km/s) a message needs 1.28 s.',
      'Ay 384 400 km uzaqdadır. İşıq sürəti ilə (300 000 km/s) belə mesaj 1.28 s yol gedir.',
    ),
  },
];

export const score = (answers: number[]) => answers.filter((a, i) => a === QUESTIONS[i].correct).length;

/* ------------------------------------------------------------------ aggregate storage */

export interface QuizStats {
  sessions: number;
  preCorrect: number;
  postCorrect: number;
  questions: number; // questions per phase, summed over sessions
}

const KEY = 'astrovr.quiz.v1';
const EMPTY: QuizStats = { sessions: 0, preCorrect: 0, postCorrect: 0, questions: 0 };

export function loadStats(): QuizStats {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as QuizStats | null;
    return v && typeof v.sessions === 'number' ? { ...EMPTY, ...v } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

/** Only paired sessions (pre AND post answered) are counted, so the before/after comparison stays fair. */
export function recordSession(pre: number[], post: number[]): QuizStats {
  const s = loadStats();
  s.sessions += 1;
  s.preCorrect += score(pre);
  s.postCorrect += score(post);
  s.questions += QUESTIONS.length;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
  return s;
}

export function pilotLine(lang: Lang, s: QuizStats): string {
  if (!s.sessions || !s.questions) return tr(lang, 'quiz.pilotNone');
  return tr(lang, 'quiz.pilot', {
    n: s.sessions,
    x: Math.round((100 * s.preCorrect) / s.questions),
    y: Math.round((100 * s.postCorrect) / s.questions),
  });
}

/* ------------------------------------------------------------------ UI */

export function Quiz({
  mode,
  lang,
  onDone,
  onSkip,
  autoStart = false,
}: {
  mode: 'pre' | 'post';
  lang: Lang;
  onDone: (answers: number[]) => void;
  onSkip?: () => void;
  autoStart?: boolean;
}) {
  const [started, setStarted] = useState(autoStart);
  const [answers, setAnswers] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const i = answers.length;
  const q = QUESTIONS[i];
  const post = mode === 'post';

  const choose = (k: number) => {
    if (post) {
      if (picked !== null) return;
      setPicked(k);
      return;
    }
    const next = [...answers, k];
    setAnswers(next);
    if (next.length === QUESTIONS.length) onDone(next);
  };
  const cont = () => {
    if (picked === null) return;
    const next = [...answers, picked];
    setAnswers(next);
    setPicked(null);
    if (next.length === QUESTIONS.length) onDone(next);
  };

  return (
    <section className={`card quiz quiz-${mode}`}>
      <div className="card-title">
        <Icon name="question" size={16} /> {tr(lang, post ? 'quiz.postTitle' : 'quiz.preTitle')}
        <span className="spacer" />
        {started && q && (
          <span className="muted small">
            {tr(lang, 'quiz.q')} {i + 1} {tr(lang, 'quiz.of')} {QUESTIONS.length}
          </span>
        )}
      </div>
      {!started && (
        <div className="quiz-intro">
          <p className="muted">{tr(lang, post ? 'quiz.postSub' : 'quiz.preSub')}</p>
          <div className="row">
            <button className="btn accent-outline" onClick={() => setStarted(true)}>
              <Icon name="play" size={16} /> {tr(lang, 'quiz.start')}
            </button>
            {onSkip && (
              <button className="btn ghost" onClick={onSkip}>
                {tr(lang, 'quiz.skip')}
              </button>
            )}
          </div>
        </div>
      )}
      {started && q && (
        <div className="quiz-q">
          <div className="quiz-dots" aria-hidden="true">
            {QUESTIONS.map((_, k) => (
              <i key={k} className={k < i ? 'done' : k === i ? 'cur' : ''} />
            ))}
          </div>
          <h3>{q.q[lang]}</h3>
          <div className="quiz-options">
            {q.options.map((o, k) => {
              const state = picked === null ? '' : k === q.correct ? 'right' : k === picked ? 'wrong' : 'dim';
              return (
                <button key={k} className={`quiz-opt ${state}`} onClick={() => choose(k)} disabled={picked !== null}>
                  <span className="quiz-letter">{String.fromCharCode(65 + k)}</span>
                  <span>{o[lang]}</span>
                </button>
              );
            })}
          </div>
          {picked !== null && (
            <div className={`quiz-feedback ${picked === q.correct ? 'right' : 'wrong'}`}>
              <b>{tr(lang, picked === q.correct ? 'quiz.correct' : 'quiz.wrong')}</b> {q.why[lang]}
              <button className="btn primary sm" onClick={cont}>
                {tr(lang, 'quiz.continue')}
              </button>
            </div>
          )}
          {!post && onSkip && (
            <button className="btn link" onClick={onSkip}>
              {tr(lang, 'quiz.skip')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
