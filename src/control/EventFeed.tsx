/** Plain-language mission log (newest first). */
import type { Lang, SimState } from '../shared/types';
import { clockLabel, describeEvent } from './events';
import { Icon } from './icons';
import { tr } from './strings';

export function EventFeed({ s, lang }: { s: SimState; lang: Lang }) {
  const items = s.events
    .map((e) => ({ e, d: describeEvent(e, lang) }))
    .filter((x) => x.d)
    .slice(-40)
    .reverse();
  return (
    <section className="card feed">
      <div className="card-title">
        <Icon name="list" size={16} /> {tr(lang, 'feed.title')}
      </div>
      <ol className="feed-list">
        {items.length === 0 && <li className="feed-empty muted">{tr(lang, 'feed.empty')}</li>}
        {items.map(({ e, d }, i) => (
          <li key={`${e.t}-${e.type}-${items.length - i}`} className={`feed-item tone-${d!.tone}`}>
            <span className="feed-time">{clockLabel(e.t)}</span>
            <span className="feed-ico" aria-hidden="true">
              {d!.icon}
            </span>
            <span className="feed-text">{d!.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
