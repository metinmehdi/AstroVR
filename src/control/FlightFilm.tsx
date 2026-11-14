/**
 * Projector view of the rocket flight. Same clock as the phone (seconds since the launch command):
 *   before the real footage: the astronaut's cabin view (live mirror) full screen + the countdown clock
 *   then: the REAL Artemis I footage full screen (same file as the capsule windows), the cabin view in a corner
 * Sound for the room: the real SLS roar (launch-pad microphone) from ignition, cut at engine cutoff (vacuum),
 * and the launch-control voice lines (AZ/EN TTS). Captions name each real event.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import available from '../audio/available.json';
import { FLIGHT, lineText } from '../audio/lines';
import { filmSrc } from '../shared/filmCache';
import { FILM_CREDIT, ROAR_URL, filmPlan } from '../shared/flightFilm';
import type { AstronautPose, Lang, SimState } from '../shared/types';
import { MirrorView } from './MirrorView';

const HAS: Record<Lang, Set<string>> = { en: new Set(available.en as string[]), az: new Set(available.az as string[]) };

export function FlightFilm({
  state,
  stream,
  poseRef,
  lang,
}: {
  state: SimState;
  stream: MediaStream | null;
  poseRef: { current: AstronautPose | null };
  lang: Lang;
}) {
  const f = state.flight!;
  const plan = useMemo(() => filmPlan(f.short), [f.short]);
  const video = useRef<HTMLVideoElement>(null);
  const roar = useRef<HTMLAudioElement | null>(null);
  const said = useRef(new Set<string>());
  const anchor = useRef({ at: -1, t0: 0 });
  const [t, setT] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [src] = useState(() => filmSrc()); // the in-memory copy (preloaded in the lobby) when ready

  // a smooth local clock anchored to the simulation's launch time
  const simT = state.t - f.at;
  if (anchor.current.at !== f.at || Math.abs((performance.now() - anchor.current.t0) / 1000 - simT) > 0.5) {
    anchor.current = { at: f.at, t0: performance.now() - simT * 1000 };
  }
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setT((performance.now() - anchor.current.t0) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // sound: real roar from ignition to engine cutoff, then silence (no sound in vacuum)
  useEffect(() => {
    const a = new Audio(ROAR_URL);
    a.preload = 'auto';
    roar.current = a;
    return () => {
      a.pause();
      roar.current = null;
    };
  }, []);
  useEffect(() => {
    const a = roar.current;
    if (!a) return;
    if (t >= plan.ignite && t < plan.meco && a.paused && !said.current.has('_roar')) {
      said.current.add('_roar');
      a.currentTime = Math.max(0, t - plan.ignite);
      a.volume = 1;
      void a.play().catch(() => {});
    }
    if (t >= plan.meco && !a.paused) {
      a.volume = Math.max(0, a.volume - 0.34);
      if (a.volume <= 0.01) a.pause();
    }
    // launch-control voice lines on cue
    for (const [id, at] of Object.entries(plan.say)) {
      if (t >= at && t < at + 3 && !said.current.has(id)) {
        said.current.add(id);
        const text = lineText(FLIGHT, id, lang);
        if (HAS[lang].has(id)) void new Audio(`/audio/${lang}/${id}.mp3`).play().catch(() => {});
        else if ('speechSynthesis' in window) speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text), { lang: lang === 'az' ? 'tr-TR' : 'en-US' }));
      }
    }
  }, [t, plan, lang]);

  // the real footage, kept in step with the clock
  const filmOn = t >= plan.filmStart - 0.05 && t < plan.total + 0.5;
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (!filmOn) {
      if (!v.paused) v.pause();
      return;
    }
    const target = plan.offset + Math.min(Math.max(t - plan.filmStart, 0), plan.length - 0.05);
    if (v.paused) {
      v.currentTime = target;
      void v.play().catch(() => {});
    } else if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
  }, [t, filmOn, plan]);

  const ev = [...plan.events].reverse().find((e) => t >= e.t && t < e.t + 4.5);
  const met = t - plan.liftoff;
  const clock = `${met < 0 ? 'T-' : 'T+'}${String(Math.floor(Math.abs(met) / 60)).padStart(2, '0')}:${String(Math.floor(Math.abs(met) % 60)).padStart(2, '0')}`;

  if (hidden) {
    return (
      <button className="ff-show" onClick={() => setHidden(false)}>
        🚀 {lang === 'az' ? 'Uçuşu göstər' : 'Show flight'}
      </button>
    );
  }
  return (
    <div className="ff-overlay">
      <video ref={video} className={`ff-video ${filmOn ? 'on' : ''}`} src={src} muted playsInline preload="auto" />
      <div className={`ff-mirror ${filmOn ? 'corner' : 'full'}`}>
        <MirrorView stream={stream} poseRef={poseRef} state={state} lang={lang} broadcast={!filmOn} />
      </div>
      <div className="ff-top">
        <span className="ff-clock">{clock}</span>
        <span className="ff-live">{filmOn ? (lang === 'az' ? 'REAL KADRLAR · ARTEMIS I' : 'REAL FOOTAGE · ARTEMIS I') : lang === 'az' ? 'CANLI · KABİNƏ' : 'LIVE · CABIN'}</span>
      </div>
      {ev && (
        <div className="ff-caption" key={ev.key}>
          {ev[lang]}
        </div>
      )}
      <div className="ff-credit">{FILM_CREDIT[lang]}</div>
      <button className="ff-hide" onClick={() => setHidden(true)} title="Operator">
        ✕
      </button>
    </div>
  );
}
