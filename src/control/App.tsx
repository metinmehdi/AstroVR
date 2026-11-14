/**
 * Mission Control (laptop). AUTHORITATIVE: runs the simulation at 10 Hz and publishes SimState at 4 Hz.
 * Two views of the same console:
 *  - Operator (default): a kid runs the mission — live helmet view, what to do NOW, gauges, systems, radio, map, log.
 *  - Broadcast (key B): projector/judges — full-bleed astronaut view, captions, REAL DATA chart, event banners.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StoryIntro } from './StoryIntro';
import { FlightFilm } from './FlightFilm';
import { preloadFilm } from '../shared/filmCache';
import QRCode from 'qrcode';
import { createTransport, type Transport } from '../shared/transport';
import { astronautUrl, makeId, makeRoomCode, STATE_PUBLISH_HZ } from '../shared/protocol';
import { NOBILE_MAY2024 as SCENARIO } from '../shared/scenario';
import { currentObjective } from '../shared/objective';
import { startMirrorReceiver } from '../shared/rtc';
import type { AstronautPose, Lang, RadioMessageType, RoomMeta, SimState } from '../shared/types';
import { applyAction, applyControl, createInitialState, step, type ControlCommand } from '../sim/model';
import { Banners, Caption, ChallengeStrip, ProtonChart, useBanners } from './Broadcast';
import { Debrief } from './Debrief';
import { EventFeed } from './EventFeed';
import { Gauges } from './Gauges';
import { Header } from './Header';
import { Icon } from './icons';
import { Lobby } from './Lobby';
import { MapCard } from './MapCard';
import { MirrorView } from './MirrorView';
import { NasaDataPanel } from './NasaDataPanel';
import { NowCard, Radio, Systems, type LastRadio } from './Panels';
import { loadStats, recordSession, type QuizStats } from './Quiz';
import { tr, type SKey } from './strings';
import { t } from '../shared/i18n';

const TICK_S = 0.1;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

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
  const poseRef = useRef<AstronautPose | null>(null);
  const [showData, setShowData] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [broadcast, setBroadcast] = useState(() => new URLSearchParams(location.search).get('view') === 'broadcast');
  const [lastRadio, setLastRadio] = useState<LastRadio | null>(null);
  // quiz (measurable impact): pre in the lobby (optional), post in the debrief
  const [pre, setPre] = useState<'open' | 'done' | 'skipped'>('open');
  // story intro + rocket flight
  const urlFlags = useMemo(() => new URLSearchParams(location.search), []);
  const [storyOn, setStoryOn] = useState(() => urlFlags.get('story') !== '0');
  const [shortFlight, setShortFlight] = useState(() => urlFlags.get('pitch') === '1');
  const [story, setStory] = useState<null | 'preview' | 'start' | 'record'>(null);
  useEffect(() => {
    void preloadFilm(); // the real flight footage, ready long before liftoff
  }, []);
  // the phone shows the same story in VR; if the astronaut skips there, the projector story ends too
  const storyRun = useRef<{ id: string; seen: boolean } | null>(null);
  const [storySkip, setStorySkip] = useState(false);
  const [preAnswers, setPreAnswers] = useState<number[] | null>(null);
  const [postAnswers, setPostAnswers] = useState<number[] | null>(null);
  const [stats, setStats] = useState<QuizStats>(() => loadStats());

  const meta = (): RoomMeta => ({
    code,
    lang,
    mode: 'mission',
    scenarioId: SCENARIO.id,
    cadetName,
    createdAt: Date.now(),
    astronautJoined: ready,
  });

  // transport + QR + live mirror receiver
  useEffect(() => {
    let alive = true;
    let stopMirror = () => {};
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url);
    void QRCode.toDataURL(astronautUrl(location.origin, code), { margin: 1, width: 360 }).then(setQr);
    void createTransport(code).then((transport) => {
      if (!alive) return transport.close();
      tx.current = transport;
      transport.onConnection(setConnected);
      transport.onPose((p) => (poseRef.current = p));
      transport.onAction((env) => {
        if (env.action.kind === 'ready') setReady(true);
        applyAction(sim.current, env.action, SCENARIO);
      });
      void transport.setMeta(meta());
      stopMirror = startMirrorReceiver(transport, setStream);
    });
    return () => {
      alive = false;
      stopMirror();
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

  // B = broadcast / operator view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'b' || e.key === 'B') setBroadcast((v) => !v);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const cmd = (c: ControlCommand) => {
    applyControl(sim.current, c, SCENARIO);
    setView(structuredClone(sim.current));
  };
  const radio = (type: RadioMessageType) => {
    const id = makeId();
    const lost = !sim.current.switches.antenna;
    cmd({ kind: 'radio', msgId: id, type });
    tx.current?.sendRadio({ id, type, ts: Date.now(), lost });
    setLastRadio({ id, type, at: sim.current.t, lost });
  };
  const restart = async () => {
    sim.current = createInitialState(SCENARIO);
    await tx.current?.resetQueues();
    setView(structuredClone(sim.current));
    setLastRadio(null);
    setPre('open');
    setPreAnswers(null);
    setPostAnswers(null);
  };
  const onPostDone = useCallback(
    (a: number[]) => {
      setPostAnswers(a);
      if (preAnswers) setStats(recordSession(preAnswers, a));
    },
    [preAnswers],
  );

  const s = view;
  // story skipped in VR: the state's story disappears after we had seen it → end the projector story
  useEffect(() => {
    const r = storyRun.current;
    if (!r || !story) return;
    if (s.story?.id === r.id) r.seen = true;
    else if (r.seen) setStorySkip(true);
  }, [s.story?.id, story]);
  const radioCheckPending = Boolean(lastRadio && lastRadio.type === 'radioCheck' && !lastRadio.lost && lastRadio.id in s.comms.pending);
  const obj = currentObjective(s, { routes: SCENARIO.routes, radioCheckPending });
  const banners = useBanners(s.events, lang);
  const stepName = obj.phaseStep ? tr(lang, `step.${obj.phaseStep}` as SKey) : '';

  const header = (
    <Header
      s={s}
      lang={lang}
      step={obj.phaseStep}
      connected={connected}
      ready={ready}
      mirrorLive={Boolean(stream)}
      broadcast={broadcast}
      overlay={broadcast && s.phase !== 'lobby' && s.phase !== 'debrief'}
      onData={() => setShowData(true)}
      onLang={() => setLang(lang === 'en' ? 'az' : 'en')}
      onBroadcast={() => setBroadcast((v) => !v)}
    />
  );

  const alerts = (
    <div className="mirror-alerts">
      {s.sun.blocked && s.switches.vsat !== 'up' && (
        <span className="alert-chip warn">
          <Icon name="sun" size={16} /> {lang === 'az' ? 'Panellər kölgədə' : 'Panels shaded'} · ☀ {s.power.solarInKW.toFixed(1)} kW
        </span>
      )}
      {s.sep.warning && (
        <span className="alert-chip danger">
          <Icon name="radiation" size={16} /> {lang === 'az' ? 'Günəş fırtınası' : 'Solar storm'} ·{' '}
          {s.sep.active ? (lang === 'az' ? 'aktiv' : 'active') : lang === 'az' ? 'xəbərdarlıq' : 'warning'} · SOHO {s.sep.protons.toFixed(1)}
        </span>
      )}
    </div>
  );

  let body;
  if (s.phase === 'lobby') {
    body = (
      <Lobby
        lang={lang}
        qr={qr}
        code={code}
        cadetName={cadetName}
        setCadetName={setCadetName}
        ready={ready}
        onStart={() => {
          cmd({ kind: 'start' }); // the cadet waits in the capsule on the pad
          if (urlFlags.get('flight') === '0') cmd({ kind: 'skipFlight' });
          else if (storyOn) setStory('start');
          else cmd({ kind: 'launch', short: shortFlight });
        }}
        story={{
          on: storyOn,
          setOn: setStoryOn,
          short: shortFlight,
          setShort: setShortFlight,
          play: () => setStory('preview'),
          record: urlFlags.get('record') === '1' ? () => setStory('record') : undefined,
        }}
        onJudge={() => {
          cmd({ kind: 'quickMoon' });
          setTimeout(() => radio('sepWarning'), 1500);
        }}
        pre={pre}
        onPreDone={(a) => {
          setPreAnswers(a);
          setPre('done');
        }}
        onPreSkip={() => setPre('skipped')}
      />
    );
  } else if (s.phase === 'debrief') {
    body = (
      <Debrief
        s={s}
        lang={lang}
        cadetName={cadetName}
        onRetry={() => void restart()}
        pre={preAnswers}
        post={postAnswers}
        stats={stats}
        onPostDone={onPostDone}
      />
    );
  } else if (broadcast) {
    body = (
      <main className="bc">
        <MirrorView stream={stream} poseRef={poseRef} state={s} lang={lang} broadcast>
          {alerts}
        </MirrorView>
        <div className="bc-shade" />
        <div className="bc-right">{s.sep.warning ? <ProtonChart s={s} lang={lang} /> : <Gauges s={s} lang={lang} compact />}</div>
        <Banners banners={banners} big />
        <div className="bc-bottom">
          {s.phase === 'briefing' && <ChallengeStrip lang={lang} />}
          <Caption obj={obj} lang={lang} phaseLabel={stepName} />
        </div>
        <div className="bc-dock">
          {(s.phase === 'briefing' || s.phase === 'prep') && (
            <button className="btn primary" onClick={() => cmd({ kind: 'next' })}>
              <Icon name={s.phase === 'prep' ? 'play' : 'next'} size={16} />
              {s.phase === 'prep' ? t(lang, 'control.goEva') : t(lang, 'control.next')}
            </button>
          )}
        </div>
      </main>
    );
  } else {
    body = (
      <main className="op">
        <div className="op-left">
          <MirrorView stream={stream} poseRef={poseRef} state={s} lang={lang}>
            {alerts}
            <Banners banners={banners} />
          </MirrorView>
          <div className="op-bottom">
            <MapCard s={s} lang={lang} />
            <EventFeed s={s} lang={lang} />
          </div>
        </div>
        <div className="op-right">
          <NowCard s={s} lang={lang} obj={obj} cmd={cmd} onRestart={() => void restart()} />
          <section className="card gauges-card">
            <Gauges s={s} lang={lang} />
          </section>
          <Systems s={s} lang={lang} cmd={cmd} />
          <Radio s={s} lang={lang} last={lastRadio} onSend={radio} />
        </div>
      </main>
    );
  }

  return (
    <div className={`mc ${broadcast ? 'is-bc' : 'is-op'} phase-${s.phase}`}>
      {header}
      {showData && <NasaDataPanel lang={lang} onClose={() => setShowData(false)} />}
      {body}
      {s.flight?.status === 'flying' && !story && <FlightFilm state={s} stream={stream} poseRef={poseRef} lang={lang} />}
      {story && (
        <StoryIntro
          lang={lang}
          record={story === 'record'}
          skip={storySkip}
          onPlay={(tl) => {
            if (story === 'record') return;
            const id = Math.random().toString(36).slice(2, 10);
            storyRun.current = { id, seen: false };
            cmd({ kind: 'story', play: true, id, starts: tl.starts.map(r3), durs: tl.durs.map(r3) });
          }}
          onEnd={() => {
            if (storyRun.current) cmd({ kind: 'story', play: false });
            storyRun.current = null;
            setStorySkip(false);
            if (story === 'start') cmd({ kind: 'launch', short: shortFlight });
            setStory(null);
          }}
        />
      )}
    </div>
  );
}
