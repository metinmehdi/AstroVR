/**
 * "Today's real Sun": live NASA DONKI space-weather notifications (last 7 days).
 * If the API is unreachable or rate-limited, shows the cached file with a clear ARCHIVE label (never fake "live").
 */
import { useEffect, useState } from 'react';
import cached from '../data/donki-recent.json';
import type { Lang } from '../shared/types';
import { Icon } from './icons';
import { tr } from './strings';

interface Item {
  type: string;
  time: string;
  body: string;
}

const NAMES: Record<string, [string, string, string]> = {
  FLR: ['☀️', 'Solar flares', 'Günəş alovları'],
  CME: ['💨', 'Coronal mass ejections', 'Koronal kütlə atılmaları'],
  SEP: ['☢️', 'Energetic particles', 'Enerjili hissəciklər'],
  GST: ['🧲', 'Geomagnetic storms', 'Geomaqnit fırtınaları'],
  IPS: ['🌊', 'Interplanetary shocks', 'Planetlərarası zərbələr'],
  RBE: ['🛰️', 'Radiation belt boosts', 'Radiasiya qurşağı güclənməsi'],
  MPC: ['🌐', 'Magnetopause crossings', 'Maqnitopauza keçidləri'],
  Report: ['📝', 'Weekly reports', 'Həftəlik hesabatlar'],
};

function summarize(items: Item[]) {
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.type] = (counts[i.type] ?? 0) + 1;
  const report = [...items].reverse().find((i) => i.type === 'Report');
  const summary = report?.body.split('## Summary:')[1]?.trim().split('\n')[0]?.trim() ?? '';
  return { counts, summary, reportTime: report?.time ?? '' };
}

export function TodaySun({ lang, compact = false }: { lang: Lang; compact?: boolean }) {
  const [items, setItems] = useState<Item[]>((cached.items as Item[]) ?? []);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const key = import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY';
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
    fetch(`https://api.nasa.gov/DONKI/notifications?startDate=${start}&endDate=${end}&type=all&api_key=${key}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((list: { messageType: string; messageIssueTime: string; messageBody: string }[]) => {
        setItems(list.map((n) => ({ type: n.messageType, time: n.messageIssueTime, body: n.messageBody })));
        setLive(true);
      })
      .catch(() => setLive(false));
  }, []);
  const { counts, summary, reportTime } = summarize(items);
  const az = lang === 'az';
  return (
    <section className={`card sun ${compact ? 'compact' : ''}`}>
      <div className="card-title">
        <Icon name="sun" size={16} /> {tr(lang, 'sun.title')}
        <span className="spacer" />
        <span className={live ? 'badge live' : 'badge'}>
          {live ? (
            <>
              <i className="dot" /> {tr(lang, 'sun.live')}
            </>
          ) : (
            `${tr(lang, 'sun.archive')} · ${cached.fetchedAt.slice(0, 10)}`
          )}
        </span>
      </div>
      <div className="muted small">{tr(lang, 'sun.sub')}</div>
      <div className="chips">
        {Object.keys(counts).length === 0 && <span className="muted small">—</span>}
        {Object.entries(counts).map(([k, v]) => {
          const n = NAMES[k];
          return (
            <span key={k} className="chip" title={k}>
              {n ? n[0] : '•'} {n ? (az ? n[2] : n[1]) : k} <b>{v}</b>
            </span>
          );
        })}
      </div>
      {summary && !compact && (
        <p className="muted small sun-summary">
          {reportTime.slice(0, 10)}: {summary}
        </p>
      )}
    </section>
  );
}
