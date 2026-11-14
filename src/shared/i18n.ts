/** UI strings (owner: P5). EN is the default; AZ is selectable. Voice lines live in src/audio/lines.ts. */
import type { Lang } from './types';

const en = {
  'app.title': 'AstroVR — My First Moon Mission',
  'astro.start': 'START',
  'astro.instructions': 'Turn the phone sideways, press START, then put it in the VR box.',
  'astro.noRoom': 'Scan the QR code on the Mission Control screen.',
  'astro.signalLost': 'Signal lost — reconnecting…',
  'control.room': 'Room',
  'control.scan': 'Astronaut: scan to join',
  'control.waiting': 'Waiting for the astronaut…',
  'control.ready': 'Astronaut ready',
  'control.start': 'START MISSION',
  'control.next': 'NEXT',
  'control.goEva': 'GO FOR EVA',
  'control.end': 'END MISSION',
  'res.power': 'Power',
  'res.o2': 'Oxygen',
  'res.dose': 'Radiation',
  'sw.vsat': 'Solar mast',
  'sw.antenna': 'Antenna',
  'sw.shelter': 'Shelter shield',
  'sw.greenhouse': 'Greenhouse',
  'phase.lobby': 'Lobby',
  'phase.briefing': '1 · Briefing',
  'phase.prep': '2 · Preparation',
  'phase.surface': '3 · Surface',
  'phase.crisis': '4 · Decision',
  'phase.debrief': '5 · Evaluation',
  'phase.aborted': 'Safe return',
  'debrief.prep': 'Preparation',
  'debrief.science': 'Science records',
  'debrief.resources': 'Resources',
  'debrief.teamwork': 'Teamwork',
} as const;

export type I18nKey = keyof typeof en;

const az: Record<I18nKey, string> = {
  'app.title': 'AstroVR — İlk Ay Missiyam',
  'astro.start': 'BAŞLA',
  'astro.instructions': 'Telefonu yan çevir, BAŞLA düyməsinə bas, sonra VR box-a qoy.',
  'astro.noRoom': 'Missiya İdarəsi ekranındakı QR kodu oxut.',
  'astro.signalLost': 'Siqnal itdi — yenidən qoşulur…',
  'control.room': 'Otaq',
  'control.scan': 'Astronavt: qoşulmaq üçün oxut',
  'control.waiting': 'Astronavt gözlənilir…',
  'control.ready': 'Astronavt hazırdır',
  'control.start': 'MİSSİYANI BAŞLAT',
  'control.next': 'NÖVBƏTİ',
  'control.goEva': 'EVA-YA İCAZƏ',
  'control.end': 'MİSSİYANI BİTİR',
  'res.power': 'Enerji',
  'res.o2': 'Oksigen',
  'res.dose': 'Radiasiya',
  'sw.vsat': 'Günəş dirəyi',
  'sw.antenna': 'Antenna',
  'sw.shelter': 'Sığınacaq qoruması',
  'sw.greenhouse': 'İstixana',
  'phase.lobby': 'Gözləmə',
  'phase.briefing': '1 · Tanışlıq',
  'phase.prep': '2 · Hazırlıq',
  'phase.surface': '3 · Səth',
  'phase.crisis': '4 · Qərar',
  'phase.debrief': '5 · Qiymətləndirmə',
  'phase.aborted': 'Təhlükəsiz qayıdış',
  'debrief.prep': 'Hazırlıq',
  'debrief.science': 'Elmi qeydlər',
  'debrief.resources': 'Resurslar',
  'debrief.teamwork': 'Komanda işi',
};

const dict: Record<Lang, Record<I18nKey, string>> = { en, az };

export function t(lang: Lang, key: I18nKey): string {
  return dict[lang][key] ?? en[key];
}
