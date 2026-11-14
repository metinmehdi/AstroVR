/**
 * radio.html — Moon Base Radio. A phone (or laptop) talks to Commander Nova on
 * the Moon by push-to-talk. Optional `?room=CODE` joins the mission room
 * READ-ONLY (meta + state) so the commander knows the live telemetry.
 *
 * URL: ?room=ABCD  ?lang=az|en  ?delay=0 (no light delay)  ?fx=0 (clean voice)
 */
import './radio.css';
import { createTransport, type Transport } from '../shared/transport';
import type { Lang, RoomMeta, SimState } from '../shared/types';
import { LIGHT_DELAY_MS, LiveRadio, type RadioPhase } from './liveRadio';
import { telemetryNote } from './telemetry';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const STR = {
  az: {
    title: 'Ay Bazası Radiosu',
    earth: 'Yer',
    moon: 'Ay',
    cmdName: 'Komandir Nova',
    cmdWhere: 'Artemis bazası · Ayın cənub qütbü',
    aiNote: '🤖 Komandirin səsi süni intellektdir (Google Gemini Live), real vaxtda yaranır. Mikrofon yalnız düymə basılı olanda işləyir.',
    armTitle: 'Ay bazası ilə rabitə',
    armText: 'Düyməni basıb saxla, danış, burax. Komandir Nova Aydan cavab verəcək. Siqnal Aya 1.3 saniyəyə gedir!',
    roomLabel: 'Otaq kodu (vacib deyil)',
    armBtn: '📻 RABİTƏNİ AÇ',
    noRoom: 'otaqsız',
    room: 'Otaq',
    you: 'Sən',
    nova: 'Nova',
    ptt: 'BAS VƏ DANIŞ',
    talking: 'DANIŞ… BURAXANDA GEDƏCƏK',
    wait: 'GÖZLƏ…',
    phase: {
      off: 'Bağlı',
      connecting: 'Qoşulur…',
      ready: 'Əlaqə var',
      talking: 'Efirdəsən',
      uplink: 'Siqnal Aya gedir',
      downlink: 'Cavab Yerə qayıdır',
      receiving: 'Nova danışır',
      nosignal: 'Siqnal zəifdir',
      error: 'Əlaqə yoxdur',
    } as Record<RadioPhase, string>,
    hintReady: 'Düyməni basıb saxla və sualını ver',
    hintUp: '📡 Sənin səsin Aya uçur… işığın sürəti ilə 1.3 saniyə',
    hintDown: '🌕 Nova cavab verir… cavab Yerə 1.3 saniyəyə qayıdır',
    hintNoSignal: 'Siqnal itdi. Bir də de, bu dəfə daha aydın danış.',
    hintError: 'Əlaqə qurulmadı. Toxun və yenidən cəhd et.',
    fxOn: '📻 Radio səsi',
    fxOff: '🔈 Təmiz səs',
    delayOn: '⏱ 1.3 s gecikmə',
    delayOff: '⏱ Gecikmə yox',
    micDenied: 'Mikrofona icazə lazımdır. Brauzerin ünvan zolağından icazə ver və yenidən toxun.',
  },
  en: {
    title: 'Moon Base Radio',
    earth: 'Earth',
    moon: 'Moon',
    cmdName: 'Commander Nova',
    cmdWhere: 'Artemis base · Lunar south pole',
    aiNote: "🤖 The commander's voice is AI (Google Gemini Live), generated in real time. The mic only works while you hold the button.",
    armTitle: 'Radio link to the Moon base',
    armText: 'Hold the button, talk, let go. Commander Nova will answer from the Moon. Your signal takes 1.3 seconds to get there!',
    roomLabel: 'Room code (optional)',
    armBtn: '📻 OPEN THE LINK',
    noRoom: 'no room',
    room: 'Room',
    you: 'You',
    nova: 'Nova',
    ptt: 'HOLD TO TALK',
    talking: 'TALK… LET GO TO SEND',
    wait: 'WAIT…',
    phase: {
      off: 'Off',
      connecting: 'Connecting…',
      ready: 'Link up',
      talking: "You're on air",
      uplink: 'Signal going to the Moon',
      downlink: 'Answer coming back',
      receiving: 'Nova is talking',
      nosignal: 'Weak signal',
      error: 'No link',
    } as Record<RadioPhase, string>,
    hintReady: 'Hold the button and ask your question',
    hintUp: '📡 Your voice is flying to the Moon… 1.3 seconds at the speed of light',
    hintDown: '🌕 Nova is answering… it takes 1.3 seconds to come back',
    hintNoSignal: 'Signal lost. Say it again, nice and clear.',
    hintError: "Couldn't connect. Tap to try again.",
    fxOn: '📻 Radio voice',
    fxOff: '🔈 Clean voice',
    delayOn: '⏱ 1.3 s delay',
    delayOff: '⏱ No delay',
    micDenied: 'Microphone permission is needed. Allow it from the address bar and tap again.',
  },
};

let lang: Lang = params.get('lang') === 'en' ? 'en' : 'az';
let langPinned = params.has('lang');
let fx = params.get('fx') !== '0';
let delayOn = params.get('delay') !== '0';
let roomCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
let meta: RoomMeta | null = null;
let sim: SimState | null = null;
let transport: Transport | null = null;
let radio: LiveRadio | null = null;

const S = () => STR[lang];

/* ───────────────────────── static text ───────────────────────── */

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const k = el.dataset.i18n as keyof (typeof STR)['az'];
    const v = S()[k];
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll<HTMLButtonElement>('#lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  $('fx').textContent = fx ? S().fxOn : S().fxOff;
  $('fx').classList.toggle('on', fx);
  $('delay').textContent = delayOn ? S().delayOn : S().delayOff;
  $('delay').classList.toggle('on', delayOn);
  $('room-chip').textContent = roomCode ? `${S().room} ${roomCode}${meta?.cadetName ? ' · ' + meta.cadetName : ''}` : S().noRoom;
  render(radio?.phase ?? 'off');
}

/* ───────────────────────── transcript ───────────────────────── */

const log = $('log');
let userLine: HTMLElement | null = null;
let novaLine: HTMLElement | null = null;

function line(who: 'you' | 'nova'): HTMLElement {
  const row = document.createElement('div');
  row.className = `msg ${who}`;
  const tag = document.createElement('b');
  tag.textContent = who === 'you' ? S().you : S().nova;
  const txt = document.createElement('span');
  row.append(tag, txt);
  log.append(row);
  while (log.children.length > 8) log.firstElementChild?.remove();
  return txt;
}

function scrollLog() {
  log.scrollTop = log.scrollHeight;
}

/* ───────────────────────── state rendering ───────────────────────── */

const ptt = $<HTMLButtonElement>('ptt');
const pttLabel = $('ptt-label');
const hint = $('hint');
const pulse = $('pulse');
const leg = $('leg');
let legTimer = 0;

function render(p: RadioPhase, detail?: string) {
  document.body.dataset.phase = p;
  $('status-text').textContent = S().phase[p];
  ptt.disabled = !['ready', 'talking', 'receiving', 'nosignal', 'uplink', 'downlink'].includes(p);
  pttLabel.textContent = p === 'talking' ? S().talking : p === 'connecting' ? S().wait : S().ptt;
  hint.textContent =
    p === 'uplink' ? S().hintUp :
    p === 'downlink' ? S().hintDown :
    p === 'nosignal' ? S().hintNoSignal :
    p === 'error' ? `${S().hintError}${detail ? ` (${detail.slice(0, 60)})` : ''}` :
    p === 'ready' ? S().hintReady : '';
  pulse.className = `pulse ${p === 'uplink' ? 'up' : p === 'downlink' ? 'down' : p === 'receiving' ? 'live' : ''}`;
}

function startLegCountdown(upEnds: number, downEnds: number) {
  cancelAnimationFrame(legTimer);
  const tick = () => {
    const now = performance.now();
    const left = now < upEnds ? upEnds - now : downEnds - now;
    if (left <= 0) {
      leg.textContent = '1.3 s';
      return;
    }
    leg.textContent = `${(left / 1000).toFixed(1)} s`;
    legTimer = requestAnimationFrame(tick);
  };
  tick();
}

/* ───────────────────────── room (read-only) ───────────────────────── */

async function joinRoom(code: string) {
  if (!code) return;
  try {
    transport = await createTransport(code);
    transport.onMeta((m) => {
      if (!m) return;
      const nameChanged = (m.cadetName || '') !== (meta?.cadetName || '');
      meta = m;
      if (!langPinned && m.lang !== lang) {
        lang = m.lang;
        applyLang();
        radio?.restart({ lang, name: meta.cadetName });
        return;
      }
      if (nameChanged && radio && radio.phase === 'ready') radio.restart({ name: m.cadetName });
      applyLang();
    });
    transport.onState((s) => {
      sim = s;
    });
  } catch (e) {
    console.warn('[radio] room join failed', e);
  }
}

/* ───────────────────────── push-to-talk ───────────────────────── */

function down(e?: Event) {
  e?.preventDefault();
  if (!radio || ptt.disabled) return;
  if (radio.phase === 'error') return radio.retry();
  navigator.vibrate?.(12);
  radio.pressStart();
  userLine = null;
}

function up(e?: Event) {
  e?.preventDefault();
  radio?.pressEnd();
}

ptt.addEventListener('pointerdown', (e) => {
  ptt.setPointerCapture(e.pointerId);
  down(e);
});
ptt.addEventListener('pointerup', up);
ptt.addEventListener('pointercancel', up);
ptt.addEventListener('lostpointercapture', () => radio?.pressEnd());
ptt.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT') down(e);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') up(e);
});
window.addEventListener('blur', () => radio?.pressEnd());

$('status').addEventListener('click', () => {
  if (radio?.phase === 'error') radio.retry();
});

/* ───────────────────────── toggles ───────────────────────── */

document.querySelectorAll<HTMLButtonElement>('#lang button').forEach((b) =>
  b.addEventListener('click', () => {
    const next = b.dataset.lang as Lang;
    if (next === lang) return;
    lang = next;
    langPinned = true;
    applyLang();
    radio?.restart({ lang });
  }),
);
$('fx').addEventListener('click', () => {
  fx = !fx;
  radio?.setFx(fx);
  applyLang();
});
$('delay').addEventListener('click', () => {
  delayOn = !delayOn;
  radio?.setDelay(delayOn ? LIGHT_DELAY_MS : 0);
  applyLang();
});

/* ───────────────────────── output level → avatar ───────────────────────── */

const avatar = $('avatar');
const ring = $('ring');

/* ───────────────────────── arm (user gesture) ───────────────────────── */

const roomInput = $<HTMLInputElement>('room-input');
roomInput.value = roomCode;
if (roomCode) roomInput.closest('label')!.hidden = true;

$('arm-btn').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('arm-btn');
  btn.disabled = true;
  $('arm-err').textContent = '';
  roomCode = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (roomCode) {
    const u = new URL(location.href);
    u.searchParams.set('room', roomCode);
    history.replaceState(null, '', u);
  }
  await joinRoom(roomCode);
  // Give the room a moment to replay meta (language + cadet name) before the token is minted.
  if (roomCode) await new Promise((r) => setTimeout(r, 700));

  radio = new LiveRadio(
    { lang, name: meta?.cadetName || undefined, delayMs: delayOn ? LIGHT_DELAY_MS : 0, fx },
    {
      phase: (p, detail) => render(p, detail),
      userText: (t) => {
        if (!userLine) {
          userLine = line('you');
          novaLine = null;
        }
        userLine.textContent += t;
        scrollLog();
      },
      novaText: (t) => {
        if (!novaLine) novaLine = line('nova');
        novaLine.textContent += t;
        scrollLog();
      },
      turnDone: () => {
        novaLine = null;
      },
      micLevel: (pk) => ring.style.setProperty('--lvl', String(Math.min(1, pk * 3))),
      outLevel: (pk) => avatar.style.setProperty('--lvl', String(Math.min(1, pk * 2.5))),
      legs: (a, b) => startLegCountdown(a, b),
    },
    () => telemetryNote(sim, lang),
  );

  try {
    await radio.arm();
  } catch (e) {
    const msg = (e as Error).message || String(e);
    $('arm-err').textContent = /permission|denied|notallowed/i.test(msg) ? S().micDenied : msg;
    btn.disabled = false;
    radio.dispose();
    radio = null;
    return;
  }
  try {
    await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock?.request('screen');
  } catch {
    /* optional */
  }
  $('arm').hidden = true;
  void radio.connect();
  applyLang();
});

// The commander's next transmission starts a fresh line.
setInterval(() => {
  if (radio?.phase === 'talking') novaLine = null;
}, 250);

applyLang();
