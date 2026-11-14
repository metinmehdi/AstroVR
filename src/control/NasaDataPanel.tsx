/** "Which NASA data did you use? Show it." — every dataset with its source, link and what it drives in the game. */
import manifest from '../data/manifest.json';
import { SOURCES } from '../sim/constants';
import type { Lang } from '../shared/types';

export function NasaDataPanel({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const az = lang === 'az';
  return (
    <div className="modal" role="dialog" aria-label="NASA data">
      <div className="modal-body">
        <header className="modal-head">
          <h2>🛰️ {az ? 'Bu missiyada istifadə olunan real NASA datası' : 'Real NASA data used in this mission'}</h2>
          <button onClick={onClose}>✕</button>
        </header>
        <p className="muted">
          {az
            ? `Sayt: ${manifest.site.name} (${manifest.site.lat}°, ${manifest.site.lon}°). Data ${manifest.generatedAt.slice(0, 10)} tarixində NASA API-lərindən çəkilib.`
            : `Site: ${manifest.site.name} (${manifest.site.lat}°, ${manifest.site.lon}°). Data pulled from NASA APIs on ${manifest.generatedAt.slice(0, 10)}.`}
        </p>
        <ol className="datasets">
          {manifest.datasets.map((d) => (
            <li key={d.id}>
              <b>{d.name}</b>
              <div className="muted">
                {d.org} ·{' '}
                <a href={d.url} target="_blank" rel="noreferrer">
                  {d.url.replace(/^https?:\/\//, '').slice(0, 60)}
                </a>
              </div>
              <div>→ {d.usedFor}</div>
            </li>
          ))}
        </ol>
        <h3>{az ? 'Model necə hesablanır' : 'How the model is calculated'}</h3>
        <ul className="sources">
          {Object.entries(SOURCES).map(([k, v]) => (
            <li key={k}>{v}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
