/** Full-screen story intro overlay (projector). Esc or SKIP ends it. In record mode the video downloads at the end. */
import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../shared/types';
import { StoryPlayer } from './story/StoryPlayer';

export function StoryIntro({ lang, record = false, onEnd }: { lang: Lang; record?: boolean; onEnd: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<StoryPlayer | null>(null);
  const [loading, setLoading] = useState(true);
  const done = useRef(onEnd);
  done.current = onEnd;

  useEffect(() => {
    const p = new StoryPlayer({
      lang,
      record,
      onEnd: (blob) => {
        if (blob) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `astrovr-intro-${lang}.webm`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        }
        done.current();
      },
    });
    player.current = p;
    host.current!.appendChild(p.canvas);
    void p.start().then(() => setLoading(false));
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.skip();
    };
    addEventListener('keydown', key);
    return () => {
      removeEventListener('keydown', key);
      p.dispose();
      p.canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="story-overlay">
      <div ref={host} className="story-host" />
      {loading && <div className="story-loading">AstroVR</div>}
      {!record && (
        <button className="story-skip" onClick={() => player.current?.skip()}>
          {lang === 'az' ? 'Keç ⏭' : 'Skip ⏭'}
        </button>
      )}
    </div>
  );
}
