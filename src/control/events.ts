/** SimEvent → one plain-language sentence (EN/AZ) for the mission log, the broadcast banners and the debrief timeline. */
import { NOBILE_MAY2024 as SCENARIO } from '../shared/scenario';
import type { Lang, SimEvent } from '../shared/types';
import { tr, type SKey } from './strings';

export type Tone = 'info' | 'ok' | 'warn' | 'danger' | 'muted';

export interface EventText {
  icon: string;
  text: string;
  tone: Tone;
  /** a decision or turning point (shown in the debrief timeline) */
  key: boolean;
}

const T = (lang: Lang, en: string, az: string) => (lang === 'az' ? az : en);

const CHECK: Record<string, [string, string]> = {
  lookTraining: ['Look training done', 'Baxış məşqi tamam'],
  commCheck: ['Radio check confirmed', 'Rabitə yoxlaması təsdiqləndi'],
  suitCheck: ['Suit checked: oxygen, pressure, dosimeter', 'Skafandr yoxlandı: oksigen, təzyiq, dozimetr'],
  toolCheck: ['Tools packed: camera, scale bar, numbered bags', 'Alətlər götürüldü: kamera, miqyas çubuğu, nömrəli kisələr'],
};

const SYS: Record<string, [string, string, string]> = {
  antenna: ['📡', 'Antenna', 'Antenna'],
  shelter: ['🛡️', 'Shelter shield', 'Sığınacaq qoruması'],
  greenhouse: ['🌱', 'Greenhouse lights', 'İstixana işıqları'],
};

const CHOICE: Record<string, [string, string, string]> = {
  returnNow: ['🏠', 'Storm decision: go home to the shelter now', 'Fırtına qərarı: dərhal sığınacağa qayıt'],
  finishInShadow: ['⛰️', 'Storm decision: finish in the crater shadow', 'Fırtına qərarı: krater kölgəsində bitir'],
  continueOpen: ['⚠️', 'Storm decision: keep working in the open', 'Fırtına qərarı: açıq yerdə işə davam'],
};

const PHASE: Record<string, [string, string, string]> = {
  briefing: ['🚀', 'Mission started — briefing', 'Missiya başladı — tanışlıq'],
  prep: ['🧰', 'Preparation checklist begins', 'Hazırlıq yoxlaması başlayır'],
  surface: ['🌖', 'Hatch open — EVA on the surface', 'Lyuk açıldı — səthdə EVA'],
  crisis: ['⚡', 'Decision time — the Sun is changing', 'Qərar vaxtı — Günəş dəyişir'],
  aborted: ['🚨', 'Abort — automatic safe return', 'Dayandırıldı — avtomatik təhlükəsiz qayıdış'],
  debrief: ['🏅', 'Mission complete — evaluation', 'Missiya tamamlandı — qiymətləndirmə'],
};

const ABORT: Record<string, [string, string]> = {
  dose: ['ABORT: storm dose reached the flight rule', 'DAYANDIRILDI: fırtına dozası uçuş qaydasına çatdı'],
  oxygen: ['ABORT: not enough oxygen to walk home', 'DAYANDIRILDI: evə qayıtmaq üçün oksigen çatmır'],
  power: ['ABORT: base lost power for life support', 'DAYANDIRILDI: həyat təminatı üçün enerji bitdi'],
};

export function radioLabel(lang: Lang, type: string): string {
  const k = `radio.${type}` as SKey;
  if (['radioCheck', 'statusRequest', 'returnToBase', 'seekShadow', 'finishSample', 'goodJob'].includes(type)) return tr(lang, k);
  const sys: Record<string, [string, string]> = {
    sepWarning: ['Storm warning', 'Fırtına xəbərdarlığı'],
    sunBlocked: ['Sun blocked', 'Günəş örtüldü'],
    abort: ['Abort', 'Dayandır'],
    missionComplete: ['Mission complete', 'Missiya tamamlandı'],
  };
  return sys[type] ? T(lang, ...sys[type]) : type;
}

function wpLabel(lang: Lang, id: unknown): string {
  const w = SCENARIO.waypoints.find((x) => x.id === id);
  return w ? w.label[lang] : String(id);
}

function siteName(lang: Lang, id: unknown) {
  return id === 'siteA' ? T(lang, 'sample A', 'nümunə A') : T(lang, 'sample B', 'nümunə B');
}

export function describeEvent(e: SimEvent, lang: Lang): EventText | null {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const L = (en: string, az: string) => T(lang, en, az);
  switch (e.type) {
    case 'phase': {
      const ph = PHASE[String(p.phase)];
      return ph ? { icon: ph[0], text: L(ph[1], ph[2]), tone: p.phase === 'aborted' ? 'danger' : 'info', key: p.phase === 'surface' } : null;
    }
    case 'ready':
      return { icon: '🧑‍🚀', text: L('Astronaut joined and is ready', 'Astronavt qoşuldu və hazırdır'), tone: 'ok', key: false };
    case 'checklist': {
      const c = CHECK[String(p.item)];
      return c ? { icon: '✅', text: L(c[0], c[1]), tone: 'ok', key: false } : null;
    }
    case 'copy':
      return { icon: '📻', text: L(`Astronaut answered “Copy” (${p.after ?? '?'} s)`, `Astronavt “Copy” cavabı verdi (${p.after ?? '?'} s)`), tone: 'ok', key: false };
    case 'route':
      return p.route === 'A'
        ? { icon: '🧭', text: L('Route A chosen: sunny and close', 'Marşrut A seçildi: günəşli və yaxın'), tone: 'info', key: true }
        : { icon: '🧭', text: L('Route B chosen: shadow side, better science', 'Marşrut B seçildi: kölgə tərəfi, daha yaxşı elm'), tone: 'info', key: true };
    case 'move':
      return { icon: '👣', text: L(`Astronaut reached: ${wpLabel(lang, p.to)}`, `Astronavt çatdı: ${wpLabel(lang, p.to)}`), tone: 'muted', key: false };
    case 'samplePhoto':
      return {
        icon: '📷',
        text: p.gnomon ? L(`Photo of ${siteName(lang, p.siteId)} with the scale bar`, `${siteName(lang, p.siteId)} miqyas çubuğu ilə çəkildi`) : L(`Photo of ${siteName(lang, p.siteId)} (no scale bar)`, `${siteName(lang, p.siteId)} çəkildi (miqyas çubuğu yox)`),
        tone: 'ok',
        key: true,
      };
    case 'sampleCollect':
      return {
        icon: '🪨',
        text: p.bag
          ? L(`Rock collected into bag ${p.bag}`, `Daş ${p.bag} kisəsinə yığıldı`)
          : L('Rock collected — but no numbered bag', 'Daş yığıldı — amma nömrəli kisə yoxdur'),
        tone: p.photoFirst ? 'ok' : 'warn',
        key: true,
      };
    case 'sampleMark':
      return { icon: '📍', text: L('Sample location marked on the map', 'Nümunənin yeri xəritədə qeyd olundu'), tone: 'ok', key: true };
    case 'stormChoice': {
      const c = CHOICE[String(p.choice)];
      return c ? { icon: c[0], text: L(c[1], c[2]), tone: p.choice === 'continueOpen' ? 'danger' : 'ok', key: true } : null;
    }
    case 'goForEva': {
      const skipped = Array.isArray(p.skipped) ? p.skipped.length : 0;
      return skipped
        ? { icon: '🟢', text: L(`GO for EVA — ${skipped} check(s) skipped`, `EVA-ya icazə — ${skipped} yoxlama buraxıldı`), tone: 'warn', key: true }
        : { icon: '🟢', text: L('GO for EVA — all checks done', 'EVA-ya icazə — bütün yoxlamalar tamam'), tone: 'ok', key: true };
    }
    case 'switch': {
      const s = SYS[String(p.key)];
      if (!s) return null;
      return { icon: s[0], text: `${L(s[1], s[2])} ${p.on ? L('switched ON', 'AÇILDI') : L('switched OFF', 'SÖNDÜRÜLDÜ')}`, tone: 'info', key: true };
    }
    case 'vsatRaise':
      return { icon: '☀️', text: L('Solar mast is being raised', 'Günəş dirəyi qaldırılır'), tone: 'info', key: true };
    case 'vsatUp':
      return { icon: '☀️', text: L('Solar mast up — power restored (3.6 kW)', 'Dirək qalxdı — enerji bərpa olundu (3.6 kVt)'), tone: 'ok', key: true };
    case 'radio':
      return { icon: '📻', text: L(`CAPCOM: “${radioLabel(lang, String(p.type))}” sent`, `CAPCOM: “${radioLabel(lang, String(p.type))}” göndərildi`), tone: 'info', key: false };
    case 'radioLost':
      return { icon: '📵', text: L(`Radio call lost (antenna OFF): “${radioLabel(lang, String(p.type))}”`, `Radio mesajı itdi (antenna sönük): “${radioLabel(lang, String(p.type))}”`), tone: 'danger', key: true };
    case 'launch':
      return { icon: '🚀', text: L('LIFTOFF! The rocket is on its way to the Moon', 'START! Raket Aya yola düşdü'), tone: 'ok', key: true };
    case 'landed':
      return { icon: '🌕', text: L('Landed at the south pole — welcome to the Moon', 'Cənub qütbünə endik — Aya xoş gəldin'), tone: 'ok', key: true };
    case 'sunBlocked':
      return { icon: '🌑', text: L('Low Sun: a ridge shades the low solar panels — power 4.0 → 0.4 kW', 'Alçaq Günəş: silsilə alçaq panelləri kölgələdi — enerji 4.0 → 0.4 kVt'), tone: 'warn', key: true };
    case 'sepWarning':
      return { icon: '☢️', text: L('REAL solar storm warning (NASA DONKI, 11 May 2024)', 'REAL Günəş fırtınası xəbərdarlığı (NASA DONKI, 11 may 2024)'), tone: 'danger', key: true };
    case 'sepArrival':
      return { icon: '☢️', text: L('Protons arriving — measured by SOHO on 11 May 2024', 'Protonlar gəlir — SOHO 11 may 2024-də ölçüb'), tone: 'danger', key: true };
    case 'loadShed':
      return { icon: '🔋', text: L('Battery empty — base switched loads off', 'Batareya bitdi — baza yükləri söndürdü'), tone: 'danger', key: true };
    case 'abort': {
      const a = ABORT[String(p.reason)];
      return { icon: '🚨', text: a ? L(a[0], a[1]) : 'ABORT', tone: 'danger', key: true };
    }
    case 'autoReturn':
      return { icon: '🏠', text: L('Automatic safe return to the shelter', 'Sığınacağa avtomatik təhlükəsiz qayıdış'), tone: 'warn', key: true };
    case 'quickMoon':
      return { icon: '⚡', text: L('Judge mode: straight onto the surface during the real storm', 'Münsif rejimi: real fırtına zamanı birbaşa səthə'), tone: 'info', key: true };
    default:
      return null;
  }
}

/** Real seconds since START → "m:ss". */
export function clockLabel(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
