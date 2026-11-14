/**
 * Mission Control (laptop). Owner: P3. AUTHORITATIVE: runs the simulation and publishes SimState.
 * Skeleton UI only — P3 turns this into the kid-friendly NASA console (dark, big icons, 3 gauges,
 * 4 switches, map, helmet cam, Today's Sun, debrief with stars + decision timeline).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { createTransport, type Transport } from '../shared/transport';
import { astronautUrl, evaClock, makeId, makeRoomCode, STATE_PUBLISH_HZ } from '../shared/protocol';
import { NOBILE_MAY2024 as SCENARIO } from '../shared/scenario';
import { t } from '../shared/i18n';
import type { Lang, RadioMessageType, RoomMeta, SimState } from '../shared/types';
import { applyAction, applyControl, createInitialState, step, type ControlCommand } from '../sim/model';
import { computeDebrief } from '../sim/scoring';

const TICK_S = 0.1;

export function App() {
  const code = useMemo(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? makeRoomCode(), []);
  const [lang, setLang] = useState<Lang>('en');
  const [cadetName, setCadetName] = useState('');
  const [qr, setQr] = useState('');
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<SimState>(() => createInitialState(SCENARIO));
  const sim = useRef<SimState>(view);
  const tx = useRef<Transport | null>(null);

  const meta = (): RoomMeta => ({
    code,
    lang,
    mode: 'mission',
    scenarioId: SCENARIO.id,
    cadetName,
    createdAt: Date.now(),
    astronautJoined: ready,
  });

  // transport + QR
  useEffect(() => {
    let alive = true;
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url);
    void QRCode.toDataURL(astronautUrl(location.origin, code), { margin: 1, width: 320 }).then(setQr);
    void createTransport(code).then((transport) => {
      if (!alive) return transport.close();
      tx.current = transport;
      transport.onConnection(setConnected);
      transport.onAction((env) => {
        if (env.action.kind === 'ready') setReady(true);
        applyAction(sim.current, env.action, SCENARIO);
      });
      void transport.setMeta(meta());
    });
    return () => {
      alive = false;
      tx.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    void tx.current?.setMeta(meta());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, cadetName, ready]);

  // simulation loop (10 Hz) + publish (4 Hz) + UI refresh (4 Hz)
  useEffect(() => {
    let acc = 0;
    const id = setInterval(() => {
      step(sim.current, TICK_S, SCENARIO);
      acc += TICK_S;
      if (acc >= 1 / STATE_PUBLISH_HZ) {
        acc = 0;
        tx.current?.publishState(structuredClone(sim.current));
        setView(structuredClone(sim.current));
      }
    }, TICK_S * 1000);
    return () => clearInterval(id);
  }, []);

  const cmd = (c: ControlCommand) => {
    applyControl(sim.current, c);
    setView(structuredClone(sim.current));
  };
  const radio = (type: RadioMessageType) => {
    const id = makeId();
    const lost = !sim.current.switches.antenna;
    cmd({ kind: 'radio', msgId: id, type });
    tx.current?.sendRadio({ id, type, ts: Date.now(), lost });
  };
  const restart = async () => {
    sim.current = createInitialState(SCENARIO);
    await tx.current?.resetQueues();
    setView(structuredClone(sim.current));
  };

  const s = view;
  const debrief = s.phase === 'debrief' ? computeDebrief(s) : null;
  const pct = (n: number) => `${Math.round(n)}%`;

  return (
    <div className="mc">
      <header>
        <h1>{t(lang, 'app.title')}</h1>
        <span className={connected ? 'ok' : 'bad'}>{connected ? '● LINK' : '○ NO LINK'}</span>
        <button onClick={() => setLang(lang === 'en' ? 'az' : 'en')}>{lang === 'en' ? 'AZ' : 'EN'}</button>
      </header>

      {s.phase === 'lobby' && (
        <section className="lobby">
          <img src={qr} alt="QR" width={320} height={320} />
          <p>
            {t(lang, 'control.room')}: <b>{code}</b> · {t(lang, 'control.scan')}
          </p>
          <input placeholder="Cadet name" value={cadetName} onChange={(e) => setCadetName(e.target.value)} />
          <p>{ready ? t(lang, 'control.ready') : t(lang, 'control.waiting')}</p>
          <button disabled={!ready} onClick={() => cmd({ kind: 'start' })}>
            {t(lang, 'control.start')}
          </button>
        </section>
      )}

      {s.phase !== 'lobby' && (
        <section className="console">
          <div className="row">
            <b>{t(lang, `phase.${s.phase}`)}</b> · EVA {evaClock(s.evaStartedAt === null ? 0 : s.t - s.evaStartedAt)}
            {s.sun.blocked && <span className="warn">☀️ SUN BLOCKED</span>}
            {s.sep.warning && <span className="danger">☢️ SOLAR STORM {s.sep.active ? 'ACTIVE' : 'WARNING'}</span>}
          </div>
          <div className="gauges">
            <Gauge label={`⚡ ${t(lang, 'res.power')}`} value={(s.power.batteryKWh / s.power.batteryMaxKWh) * 100} />
            <Gauge label={`🫁 ${t(lang, 'res.o2')}`} value={s.o2.suitPct} sub={`walk-back margin ${pct(s.o2.walkbackMarginPct)}`} />
            <Gauge label={`☢️ ${t(lang, 'res.dose')}`} value={100 - s.dose.budgetPct} sub={`${s.dose.totalMGy.toFixed(2)} mGy · ${s.dose.rateMGyPerH} mGy/h`} />
          </div>
          <div className="switches">
            <button onClick={() => cmd({ kind: 'raiseVsat' })} disabled={s.switches.vsat !== 'down'}>
              ☀️ {t(lang, 'sw.vsat')}: {s.switches.vsat} {s.switches.vsat === 'raising' && pct(s.vsatProgress * 100)}
            </button>
            {(['antenna', 'shelter', 'greenhouse'] as const).map((k) => (
              <button key={k} onClick={() => cmd({ kind: 'switch', key: k, on: !s.switches[k] })}>
                {k === 'antenna' ? '📡' : k === 'shelter' ? '🛡️' : '🌱'} {t(lang, `sw.${k}`)}: {s.switches[k] ? 'ON' : 'OFF'}
              </button>
            ))}
            <span>🌱 {pct(s.greenhouseHealth * 100)} · ⚡ in {s.power.solarInKW} kW / out {s.power.loadKW} kW</span>
          </div>
          <div className="radio">
            {(['radioCheck', 'statusRequest', 'returnToBase', 'seekShadow', 'finishSample', 'goodJob'] as const).map((r) => (
              <button key={r} onClick={() => radio(r)}>
                📻 {r}
              </button>
            ))}
          </div>
          <div className="row">
            {(s.phase === 'briefing' || s.phase === 'prep') && (
              <button onClick={() => cmd({ kind: 'next' })}>
                {s.phase === 'prep' ? t(lang, 'control.goEva') : t(lang, 'control.next')}
              </button>
            )}
            <button onClick={() => cmd({ kind: 'endMission' })}>{t(lang, 'control.end')}</button>
            <button onClick={() => void restart()}>↺</button>
          </div>
          <div className="row">
            📍 {s.astronaut.waypointId} · {s.astronaut.distanceToBaseM} m · checklist{' '}
            {Object.entries(s.checklist)
              .map(([k, v]) => `${v ? '✓' : '·'}${k}`)
              .join(' ')}
          </div>
          {debrief && (
            <div className="debrief">
              {(['prep', 'science', 'resources', 'teamwork'] as const).map((k) => (
                <p key={k}>
                  {t(lang, `debrief.${k}`)}: {'★'.repeat(debrief[k])}
                  {'☆'.repeat(3 - debrief[k])}
                </p>
              ))}
              <p>{debrief.notes.join(' · ')}</p>
            </div>
          )}
          <ol className="events">
            {s.events.slice(-12).map((e, i) => (
              <li key={i}>
                {e.t.toFixed(1)}s · {e.actor} · {e.type} {e.payload ? JSON.stringify(e.payload) : ''}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Gauge({ label, value, sub }: { label: string; value: number; sub?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="gauge">
      <div>{label}</div>
      <div className="bar">
        <div style={{ width: `${v}%`, background: v > 50 ? '#3ddc84' : v > 20 ? '#ffc847' : '#ff5a4f' }} />
      </div>
      {sub && <small>{sub}</small>}
    </div>
  );
}
