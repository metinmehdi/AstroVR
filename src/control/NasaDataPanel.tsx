/** "Which NASA data did you use? Show it." — every dataset with its source, link and what it drives in the game. */
import { useEffect } from 'react';
import manifest from '../data/manifest.json';
import { SOURCES } from '../sim/constants';
import type { Lang } from '../shared/types';
import { Icon } from './icons';
import { tr } from './strings';

export function NasaDataPanel({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const az = lang === 'az';
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-label="NASA data" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-body">
        <header className="modal-head">
          <div>
            <div className="eyebrow accent">NASA · {manifest.datasets.length} datasets</div>
            <h2>{tr(lang, 'data.title')}</h2>
          </div>
          <button className="btn ghost icon-only" onClick={onClose} aria-label={tr(lang, 'data.close')}>
            <Icon name="close" size={20} />
          </button>
        </header>
        <p className="muted">
          {az
            ? `Sayt: ${manifest.site.name} (${manifest.site.lat}°, ${manifest.site.lon}°). Data ${manifest.generatedAt.slice(0, 10)} tarixində NASA API-lərindən çəkilib.`
            : `Site: ${manifest.site.name} (${manifest.site.lat}°, ${manifest.site.lon}°). Data pulled from NASA APIs on ${manifest.generatedAt.slice(0, 10)}.`}
        </p>
        <ol className="datasets">
          {manifest.datasets.map((d, i) => (
            <li key={d.id} className="dataset">
              <span className="dataset-n">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <b>{d.name}</b>
                <div className="muted small">
                  {d.org} ·{' '}
                  <a href={d.url} target="_blank" rel="noreferrer">
                    {d.url.replace(/^https?:\/\//, '').slice(0, 60)}
                  </a>
                </div>
                <div className="dataset-use">→ {d.usedFor}</div>
              </div>
            </li>
          ))}
        </ol>
        <h3>{tr(lang, 'data.model')}</h3>
        <ul className="sources">
          {Object.entries(SOURCES).map(([k, v]) => (
            <li key={k}>{v}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
