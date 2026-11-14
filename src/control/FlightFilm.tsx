/**
 * Projector view of the rocket flight. Same clock as the phone (seconds since the launch command):
 *   before the real footage: the astronaut's cabin view (live mirror) full screen + the countdown clock
 *   then: the REAL Artemis I footage full screen (same file as the capsule windows), the cabin view in a corner
 * Sound for the room: the real SLS roar (launch-pad microphone) from ignition, cut at engine cutoff (vacuum),
 * and the launch-control voice lines (AZ/EN, Gemini TTS) — on the SHARED clock, so the headset plays every line at
 * the same instant. Captions name each real event.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { scheduleFlightSound } from '../audio/flightSound';
import { sharedNow } from '../shared/clock';
import { filmSrc } from '../shared/filmCache';
import { FILM_CREDIT, filmPlan } from '../shared/flightFilm';
import type { AstronautPose, Lang, SimState } from '../shared/types';
import { laptopVoice } from './laptopAudio';
import { MirrorView } from './MirrorView';

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
  const anchor = useRef({ at: -1, t0: 0 });
  const [t, setT] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [src] = useState(() => filmSrc()); // the in-memory copy (preloaded in the lobby) when ready
  const [vidReady, setVidReady] = useState(false);

  // the launch moment on the shared clock (same as the headset); older states: anchored to the simulation time
  const simT = state.t - f.at;
  if (anchor.current.at !== f.at || (f.wall === undefined && Math.abs((performance.now() - anchor.current.t0) / 1000 - simT) > 0.5)) {
    anchor.current = { at: f.at, t0: f.wall !== undefined ? performance.now() - (sharedNow() - f.wall) : performance.now() - simT * 1000 };
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

  // sound: real roar + launch-control voices, scheduled once on the shared clock
  useEffect(() => {
    const v = laptopVoice();
    if (!v) return;
    const launchAt = f.wall ?? sharedNow() - (state.t - f.at) * 1000;
    return scheduleFlightSound(v, plan, launchAt, lang, { voice: 1, roar: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.at, plan]);

  // the real footage, kept in step with the clock
  const filmTime = t >= plan.filmStart - 0.05 && t < plan.total + 0.5;
  const filmOn = filmTime && vidReady; // never show a black frame: until the footage can play, the cabin view stays full screen
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (!filmTime) {
      if (!v.paused) v.pause();
      return;
    }
    const target = plan.offset + Math.min(Math.max(t - plan.filmStart, 0), plan.length - 0.05);
    if (v.paused) {
      v.currentTime = target;
      void v.play().catch(() => {});
    } else if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
  }, [t, filmTime, plan]);

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
      <video ref={video} className={`ff-video ${filmOn ? 'on' : ''}`} src={src} muted playsInline preload="auto" onCanPlay={() => setVidReady(true)} onPlaying={() => setVidReady(true)} />
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
