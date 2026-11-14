/**
 * "What should happen NOW?" — one source of truth for the phone HUD (guide) and Mission Control captions.
 * Pure function of SimState (+ whether a radio check is waiting on the phone).
 */
import type { Lang, SimState, SiteId } from './types';

export interface Objective {
  id: string;
  /** mission phase step 1..5 (Briefing, Preparation, Surface, Decision, Evaluation) */
  phaseStep: number;
  icon: string;
  /** short instruction for the astronaut (HUD) */
  astro: Record<Lang, string>;
  /** what Mission Control should do / is watching (operator card + broadcast caption) */
  control: Record<Lang, string>;
  /** gaze target names that are the "active" ones right now (others are dimmed/hidden on the phone) */
  targets: string[];
}

const T = (en: string, az: string): Record<Lang, string> => ({ en, az });

function nextSampleStep(s: SimState, siteId: SiteId) {
  const r = s.samples.find((x) => x.siteId === siteId)!;
  if (!r.photo) return { id: 'photo', icon: '📷', astro: T('Take the photo first (with the scale bar)', 'Əvvəl foto çək (miqyas çubuğu ilə)'), target: `sample:${siteId}:photo` };
  if (!r.collected) return { id: 'collect', icon: '🪨', astro: T('Collect the rock sample', 'Daş nümunəsini topla'), target: `sample:${siteId}:collect` };
  if (!r.marked) return { id: 'mark', icon: '📍', astro: T('Mark the location', 'Yeri qeyd et'), target: `sample:${siteId}:mark` };
  return null;
}

export function currentObjective(s: SimState | null, opts: { radioCheckPending?: boolean; routes?: Record<string, string[]> } = {}): Objective {
  if (!s || s.phase === 'lobby') {
    return { id: 'lobby', phaseStep: 0, icon: '🛰️', astro: T('Waiting for Mission Control', 'Missiya İdarəsi gözlənilir'), control: T('Press START MISSION when the astronaut is ready', 'Astronavt hazır olanda MİSSİYANI BAŞLAT bas'), targets: [] };
  }
  const wp = s.astronaut.waypointId;
  if (s.phase === 'aborted') {
    return { id: 'abort', phaseStep: 4, icon: '🚨', astro: T('ABORT — returning to the shelter', 'DAYANDIRILDI — sığınacağa qayıdış'), control: T('Flight rule broken: automatic safe return', 'Uçuş qaydası pozuldu: avtomatik təhlükəsiz qayıdış'), targets: [] };
  }
  if (s.phase === 'debrief') {
    return { id: 'debrief', phaseStep: 5, icon: '🏅', astro: T('Mission complete! Look at Mission Control', 'Missiya tamamlandı! Missiya İdarəsinə bax'), control: T('Evaluation: stars, decisions and the real storm', 'Qiymətləndirmə: ulduzlar, qərarlar və real fırtına'), targets: [] };
  }
  if (s.phase === 'briefing' && s.flight && s.flight.status !== 'landed') {
    return s.flight.status === 'pad'
      ? { id: 'pad', phaseStep: 1, icon: '🚀', astro: T('On the launch pad. Liftoff soon!', 'Start meydançasındasan. Tezliklə start!'), control: T('The cadet is in the capsule. The story plays, then liftoff', 'Kursant kapsuldadır. Hekayədən sonra start'), targets: [] }
      : { id: 'flight', phaseStep: 1, icon: '🚀', astro: T('Flying to the Moon', 'Aya uçuruq'), control: T('Rocket flight: 384,400 km, 3 days in seconds', 'Raket uçuşu: 384 400 km, 3 gün saniyələrdə'), targets: [] };
  }
  if (s.phase === 'briefing' || s.phase === 'prep') {
    const step = s.phase === 'briefing' ? 1 : 2;
    if (!s.checklist.lookTraining) return { id: 'look', phaseStep: step, icon: '✨', astro: T('Turn your head and look at the light', 'Başını çevir və işığa bax'), control: T('The cadet learns to select by looking', 'Kursant baxışla seçməyi öyrənir'), targets: ['check:lookTraining'] };
    if (!s.checklist.commCheck) {
      return opts.radioCheckPending
        ? { id: 'copy', phaseStep: 2, icon: '📡', astro: T('Answer Mission Control: look at RADIO', 'Missiya İdarəsinə cavab ver: RADİO-ya bax'), control: T('Radio check sent — waiting for "Copy"', 'Rabitə yoxlaması göndərildi — "Copy" gözlənilir'), targets: ['check:commCheck'] }
        : { id: 'waitRadio', phaseStep: 2, icon: '📻', astro: T('Wait for the radio call from Mission Control', 'Missiya İdarəsinin radio çağırışını gözlə'), control: T('YOUR TURN: press "Radio check"', 'SƏNİN NÖVBƏN: "Rabitə yoxlaması" bas'), targets: [] };
    }
    if (!s.checklist.suitCheck) return { id: 'suit', phaseStep: 2, icon: '🧑‍🚀', astro: T('Check your suit: look at SUIT', 'Skafandrı yoxla: SKAFANDR-a bax'), control: T('Suit check: oxygen, pressure, dosimeter', 'Skafandr yoxlaması: oksigen, təzyiq, dozimetr'), targets: ['check:suitCheck'] };
    if (!s.checklist.toolCheck) return { id: 'tools', phaseStep: 2, icon: '🧰', astro: T('Pack your tools: look at TOOLS', 'Alətləri götür: ALƏTLƏR-ə bax'), control: T('Tool check: camera, scale bar, numbered bags', 'Alət yoxlaması: kamera, miqyas çubuğu, nömrəli kisələr'), targets: ['check:toolCheck'] };
    return { id: 'go', phaseStep: 2, icon: '✅', astro: T('Ready! Waiting for GO', 'Hazırsan! İcazə gözlənilir'), control: T('Checklist complete — GO for EVA', 'Yoxlama tamam — EVA-ya icazə'), targets: [] };
  }

  // surface + crisis
  const step = s.sep.warning ? 4 : 3;
  if (s.sep.warning) {
    if (wp === 'airlock') return { id: 'sheltered', phaseStep: 4, icon: '🛡️', astro: T('You are safe in the shelter. Wait for the storm to pass', 'Sığınacaqdasan, təhlükəsizsən. Fırtınanın keçməsini gözlə'), control: T('Turn ON the shelter shield (≈4× less dose)', 'Sığınacaq qorumasını AÇ (doza ≈4 dəfə az)'), targets: [] };
    if (!s.stormChoice) return { id: 'stormChoice', phaseStep: 4, icon: '☢️', astro: T('SOLAR STORM! Choose: home, shadow or keep working', 'GÜNƏŞ FIRTINASI! Seç: ev, kölgə və ya iş'), control: T('REAL storm (NASA DONKI, 11 May 2024). Advise the astronaut!', 'REAL fırtına (NASA DONKI, 11 May 2024). Astronavta məsləhət ver!'), targets: ['storm:returnNow', 'storm:finishInShadow', 'storm:continueOpen'] };
    const home = towards(s, 'airlock', opts.routes);
    return { id: 'goShelter', phaseStep: 4, icon: '🏠', astro: T('Go back to the shelter', 'Sığınacağa qayıt'), control: T('Protons are rising — get the astronaut home', 'Protonlar artır — astronavtı evə qaytar'), targets: home ? [`wp:${home}`] : [] };
  }
  if (wp === 'airlock') return { id: 'hatch', phaseStep: step, icon: '🚪', astro: T('Go outside: look at the HATCH', 'Çölə çıx: LYUK-a bax'), control: T('EVA started. Watch oxygen and the walk-back margin', 'EVA başladı. Oksigeni və geri qayıtma ehtiyatını izlə'), targets: ['wp:base'] };
  if (!s.route || wp === 'base') return { id: 'route', phaseStep: step, icon: '🧭', astro: T('Choose a route: A (sunny, close) or B (shadow, better science)', 'Marşrut seç: A (günəşli, yaxın) və ya B (kölgə, daha yaxşı elm)'), control: T('The astronaut chooses a route', 'Astronavt marşrut seçir'), targets: ['wp:a1', 'wp:b1'] };
  const site: SiteId = s.route === 'A' ? 'siteA' : 'siteB';
  if (wp === site) {
    const n = nextSampleStep(s, site);
    if (n) return { id: n.id, phaseStep: step, icon: n.icon, astro: n.astro, control: T('Apollo procedure: photo → collect → bag → mark', 'Apollo qaydası: foto → topla → kisə → qeyd'), targets: [n.target] };
    return { id: 'done', phaseStep: step, icon: '🏠', astro: T('Science done! Head back to base', 'Elm tamam! Bazaya qayıt'), control: T(s.sun.blocked ? 'Solar power dropped — raise the solar mast!' : 'Sample documented. Watch the Sun and the battery', s.sun.blocked ? 'Günəş enerjisi düşdü — günəş dirəyini qaldır!' : 'Nümunə sənədləşdi. Günəşi və batareyanı izlə'), targets: ['wp:' + (towards(s, 'airlock', opts.routes) ?? 'base')] };
  }
  const nxt = towards(s, site, opts.routes);
  return {
    id: 'walk',
    phaseStep: step,
    icon: '👣',
    astro: T('Hop to the glowing marker', 'Parlayan nişana tullan'),
    control: T(s.sun.blocked ? 'Solar power dropped — raise the solar mast!' : 'The astronaut is walking to the sample site', s.sun.blocked ? 'Günəş enerjisi düşdü — günəş dirəyini qaldır!' : 'Astronavt nümunə yerinə gedir'),
    targets: nxt ? [`wp:${nxt}`] : [],
  };
}

/** Next waypoint from the astronaut's position toward a goal along the chosen route. */
function towards(s: SimState, goal: string, routes?: Record<string, string[]>): string | null {
  const route = routes?.[s.route ?? 'A'] ?? routes?.A;
  if (!route) return null;
  const i = route.indexOf(s.astronaut.waypointId);
  const j = route.indexOf(goal);
  if (i < 0 || j < 0 || i === j) return null;
  return route[i + Math.sign(j - i)];
}
