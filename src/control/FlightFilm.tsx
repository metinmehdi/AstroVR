/**
 * Projector view of the rocket flight. Same shared clock as the headset (seconds since launch):
 *   LEFT, big: what the cadet sees in VR — the capsule rendered here on the laptop from the cadet's head direction
 *   RIGHT: the view from outside — a live ascent-trajectory graphic, then (once the window covers are off) the REAL
 *   Artemis I footage (same file as the capsule windows); clock, event, credit below
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
import { TwinFlight } from './TwinFlight';

export function FlightFilm({
  state,
  poseRef,
  lang,
}: {
  state: SimState;
  /** the old video mirror (unused: the VR view is rendered here) */
  stream?: MediaStream | null;
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
  const filmOn = filmTime && vidReady; // never a black frame: until the footage can play, the trajectory graphic stays
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

  if (t > plan.total + 0.3) return null; // the flight is over: the descent shows in the normal (twin) view
  if (hidden) {
    return (
      <button className="ff-show" onClick={() => setHidden(false)}>
        🚀 {lang === 'az' ? 'Uçuşu göstər' : 'Show flight'}
      </button>
    );
  }
  const az = lang === 'az';
  return (
    <div className="ff-overlay ff-split">
      <section className="ff-main">
        <TwinFlight state={state} poseRef={poseRef} lang={lang} />
        <span className="ff-tag vr">🥽 {az ? 'VR · ASTRONAVTIN GÖZÜ' : 'VR · ASTRONAUT VIEW'}</span>
      </section>
      <aside className="ff-side">
        <div className="ff-ext">
          <AscentGraphic t={t} plan={plan} lang={lang} hidden={filmOn} />
          <video ref={video} className={`ff-video ${filmOn ? 'on' : ''}`} src={src} muted playsInline preload="auto" onCanPlay={() => setVidReady(true)} onPlaying={() => setVidReady(true)} />
          <span className={`ff-tag ${filmOn ? 'real' : ''}`}>
            {filmOn ? (az ? 'KƏNARDAN · REAL ARTEMIS I KADRLARI' : 'OUTSIDE · REAL ARTEMIS I FOOTAGE') : az ? 'KƏNARDAN · TRAEKTORİYA' : 'OUTSIDE · TRAJECTORY'}
          </span>
        </div>
        <div className="ff-info">
          <span className="ff-live">● {az ? 'CANLI' : 'LIVE'}</span>
          <span className="ff-clock">{clock}</span>
          <span className="ff-event">{ev ? ev[lang] : '\u00a0'}</span>
          <span className="ff-credit">{FILM_CREDIT[lang]}</span>
        </div>
      </aside>
      <button className="ff-hide" onClick={() => setHidden(true)} title="Operator">
        ✕
      </button>
    </div>
  );
}

/** Ascent graphic (like a launch broadcast): the rocket climbs its arc over the curved Earth; real-mission figures. */
function AscentGraphic({ t, plan, lang, hidden }: { t: number; plan: ReturnType<typeof filmPlan>; lang: Lang; hidden: boolean }) {
  // the compressed flight maps onto the real Artemis I ascent: liftoff → booster separation at T+2:12, ~48 km
  const u = Math.min(1, Math.max(0, (t - plan.liftoff) / (plan.filmStart - plan.liftoff)));
  const realS = u * 132;
  const altKm = 48 * Math.pow(u, 1.7);
  const kmh = 5100 * Math.pow(u, 1.25);
  // path: from the pad (left) curving to the right and up
  const P = (k: number) => {
    const x = 70 + 470 * k;
    const y = 300 - 230 * Math.sin((k * Math.PI) / 2) ** 1.4;
    return [x, y];
  };
  const pts = Array.from({ length: 41 }, (_, i) => P(i / 40));
  const done = pts.filter((_, i) => i / 40 <= u);
  const [rx, ry] = P(u);
  const [nx, ny] = P(Math.min(1, u + 0.02));
  const ang = (Math.atan2(ny - ry, nx - rx) * 180) / Math.PI;
  const maxQ = P(0.42);
  const az = lang === 'az';
  const mmss = (sec: number) => `T+${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  return (
    <svg className={`ff-ascent ${hidden ? 'off' : ''}`} viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="ffEarth" cx="50%" cy="0%" r="80%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#0b1d3a" stopOpacity="0.9" />
        </radialGradient>
      </defs>
      <rect width="640" height="360" fill="#03060c" />
      {Array.from({ length: 60 }, (_, i) => (
        <circle key={i} cx={(i * 97) % 640} cy={(i * 53) % 220} r={i % 7 === 0 ? 1.4 : 0.8} fill="#fff" opacity={0.25 + (i % 5) * 0.1} />
      ))}
      <ellipse cx="320" cy="1180" rx="1100" ry="870" fill="url(#ffEarth)" stroke="#7aa5ff" strokeOpacity="0.6" strokeWidth="2" />
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#7aa5ff" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="6 6" />
      {done.length > 1 && <polyline points={done.map((p) => p.join(',')).join(' ')} fill="none" stroke="#ff9a4a" strokeWidth="4" strokeLinecap="round" />}
      <g opacity={u > 0.3 ? 1 : 0.45}>
        <circle cx={maxQ[0]} cy={maxQ[1]} r="5" fill="#ffd166" />
        <text x={maxQ[0] - 10} y={maxQ[1] - 12} fill="#ffd166" fontSize="20" fontWeight="700" textAnchor="end">
          MAX Q
        </text>
      </g>
      <text x={P(1)[0]} y={P(1)[1] - 14} fill="#cbd5e1" fontSize="19" fontWeight="700" textAnchor="end">
        {az ? 'BUSTƏRLƏR AYRILIR' : 'BOOSTERS SEPARATE'}
      </text>
      <g transform={`translate(${rx},${ry}) rotate(${u > 0 ? ang : -90})`}>
        {u > 0 && <ellipse cx="-22" cy="0" rx="16" ry="5" fill="#ffb36b" opacity="0.9" />}
        <rect x="-12" y="-4" width="24" height="8" rx="3" fill="#f8fafc" />
        <polygon points="12,-4 20,0 12,4" fill="#f8fafc" />
        <rect x="-10" y="-7" width="16" height="3" rx="1.5" fill="#e2e8f0" />
        <rect x="-10" y="4" width="16" height="3" rx="1.5" fill="#e2e8f0" />
      </g>
      <text x="40" y="340" fill="#94a3b8" fontSize="18" textAnchor="start">
        {az ? 'Start meydançası 39B' : 'Launch Pad 39B'}
      </text>
      <g fontFamily="ui-monospace, Consolas, monospace" fontWeight="700">
        <text x="24" y="46" fill="#e2e8f0" fontSize="30">{`${az ? 'Hündürlük' : 'Altitude'} ≈ ${altKm.toFixed(1)} km`}</text>
        <text x="24" y="84" fill="#e2e8f0" fontSize="30">{`${az ? 'Sürət' : 'Speed'} ≈ ${Math.round(kmh).toLocaleString('en-US')} km/h`}</text>
        <text x="24" y="114" fill="#94a3b8" fontSize="19">{`${az ? 'Real Artemis I vaxtı' : 'Real Artemis I time'}: ${mmss(realS)}`}</text>
      </g>
    </svg>
  );
}
