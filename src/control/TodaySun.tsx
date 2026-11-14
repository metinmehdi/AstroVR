/**
 * "Today's real Sun": live NASA DONKI space-weather notifications (last 7 days).
 * If the API is unreachable or rate-limited, shows the cached file with a clear ARCHIVE label (never fake "live").
 */
import { useEffect, useState } from 'react';
import cached from '../data/donki-recent.json';
import type { Lang } from '../shared/types';

interface Item {
  type: string;
  time: string;
  body: string;
}

function summarize(items: Item[]) {
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.type] = (counts[i.type] ?? 0) + 1;
  const report = [...items].reverse().find((i) => i.type === 'Report');
  const summary = report?.body.split('## Summary:')[1]?.trim().split('\n')[0]?.trim() ?? '';
  return { counts, summary, reportTime: report?.time ?? '' };
}

export function TodaySun({ lang }: { lang: Lang }) {
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
    <div className="card sun">
      <div className="card-head">
        ☀️ {az ? 'Bugünkü real Günəş' : "Today's real Sun"}{' '}
        <span className={live ? 'badge ok' : 'badge'}>{live ? 'LIVE · NASA DONKI' : `ARCHIVE · ${cached.fetchedAt.slice(0, 10)}`}</span>
      </div>
      <div className="chips">
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} className="chip">
            {k} × {v}
          </span>
        ))}
      </div>
      {summary && (
        <p className="muted small">
          {reportTime.slice(0, 10)}: {summary}
        </p>
      )}
    </div>
  );
}
