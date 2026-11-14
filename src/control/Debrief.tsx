/** 5. Evaluation: stars, what happened and why, the decision timeline, and the "this was real" cards. */
import { t, type I18nKey } from '../shared/i18n';
import type { Lang, SimState } from '../shared/types';
import { NOBILE_MAY2024 as SCENARIO } from '../shared/scenario';
import { computeDebrief } from '../sim/scoring';
import iss from '../data/iss-dose.json';
import samples from '../data/samples.json';

const EVENT_TEXT: Record<string, { en: string; az: string }> = {
  goForEva: { en: 'GO for EVA', az: 'EVA-ya icazə' },
  route: { en: 'Route chosen', az: 'Marşrut seçildi' },
  sampleCollect: { en: 'Sample collected', az: 'Nümunə toplandı' },
  sunBlocked: { en: 'Sun behind the ridge: solar power drops', az: 'Günəş silsilənin arxasında: enerji düşür' },
  vsatRaise: { en: 'Solar mast raising', az: 'Günəş dirəyi qaldırılır' },
  vsatUp: { en: 'Solar mast up: power restored', az: 'Dirək qalxdı: enerji bərpa olundu' },
  switch: { en: 'Switch', az: 'Açar' },
  sepWarning: { en: 'REAL storm warning (DONKI)', az: 'REAL fırtına xəbərdarlığı (DONKI)' },
  sepArrival: { en: 'Protons arrive (SOHO data)', az: 'Protonlar gəldi (SOHO datası)' },
  stormChoice: { en: 'Storm decision', az: 'Fırtına qərarı' },
  loadShed: { en: 'Battery empty: loads switched off', az: 'Batareya bitdi: yüklər söndü' },
  abort: { en: 'ABORT', az: 'DAYANDIRILDI' },
  autoReturn: { en: 'Automatic safe return', az: 'Avtomatik təhlükəsiz qayıdış' },
};

export function Debrief({ s, lang, cadetName, onRetry }: { s: SimState; lang: Lang; cadetName: string; onRetry: () => void }) {
  const d = computeDebrief(s);
  const az = lang === 'az';
  const issDays = s.dose.totalMGy / iss.absorbedMGyPerDay;
  const rock = samples.items[0];
  const anySample = s.samples.some((x) => x.collected);
  const timeline = s.events.filter((e) => e.type in EVENT_TEXT);
  return (
    <div className="debrief">
      <div className="patch">
        🏅 <b>{cadetName || 'Cadet'}</b> · AstroVR · {SCENARIO.site.name}
      </div>
      <div className="stars">
        {(['prep', 'science', 'resources', 'teamwork'] as const).map((k) => (
          <div key={k}>
            <div className="muted">{t(lang, `debrief.${k}`)}</div>
            <div className="star-row">
              {'★'.repeat(d[k])}
              {'☆'.repeat(3 - d[k])}
            </div>
          </div>
        ))}
      </div>
      {d.notes.length > 0 && (
        <ul className="notes">
          {d.notes.map((n) => (
            <li key={n}>{t(lang, n as I18nKey)}</li>
          ))}
        </ul>
      )}
      <div className="cards">
        <div className="card real">
          <div className="card-head">☀️ {az ? 'Bu fırtına həqiqətən olub' : 'This storm really happened'}</div>
          <p>{SCENARIO.realEvent.description[lang]}</p>
          <p className="muted small">DONKI: {SCENARIO.realEvent.donkiIds.join(' · ')}</p>
        </div>
        <div className="card">
          <div className="card-head">☢️ {az ? 'Sənin dozan' : 'Your dose'}</div>
          <p className="big">{s.dose.totalMGy.toFixed(2)} mGy</p>
          <p>
            {az
              ? `= Beynəlxalq Kosmik Stansiyada təxminən ${issDays.toFixed(1)} gün (ISS TEPC: ${iss.absorbedMGyPerDay} mGy/gün, NASA)`
              : `≈ ${issDays.toFixed(1)} days on the International Space Station (ISS TEPC: ${iss.absorbedMGyPerDay} mGy/day, NASA)`}
          </p>
        </div>
        {anySample && rock && (
          <div className="card">
            <div className="card-head">🪨 {az ? 'Sənin nümunənə bənzəyir' : 'Your sample is like'}</div>
            <img src="/images/genesis-rock.jpg" alt={rock.title} className="rock" />
            <p className="small">
              {az
                ? 'Apollo 15 "Genesis Rock" (15415): anortozit, 98% plagioklaz, ~4 milyard yaş. Ayın ilkin qabığından.'
                : 'Apollo 15 "Genesis Rock" (15415): anorthosite, 98% plagioclase, ~4 billion years old. A piece of the Moon\'s early crust.'}
            </p>
          </div>
        )}
      </div>
      <h3>{az ? 'Qərar xətti' : 'Decision timeline'}</h3>
      <ol className="timeline">
        {timeline.map((e, i) => (
          <li key={i}>
            <span className="muted">t+{Math.floor(e.t)}s · </span>
            <b>{EVENT_TEXT[e.type][lang]}</b> {e.payload ? <span className="muted small">{JSON.stringify(e.payload)}</span> : null}
          </li>
        ))}
      </ol>
      <button className="primary" onClick={onRetry}>
        ↺ {az ? 'Yenidən sına' : 'Try again'}
      </button>
    </div>
  );
}
