/**
 * The commander's "instruments": a one-line, spoken-friendly summary of the
 * live mission state, sent to the Live session as an invisible note before
 * each transmission (clientContent, turnComplete:false — TeatrAi measured 0/30
 * read-alouds of such notes). The persona is told to use it only when asked.
 */
import { currentObjective } from '../shared/objective';
import { NOBILE_MAY2024 } from '../shared/scenario';
import type { Lang, Phase, SimState } from '../shared/types';

const PHASE: Record<Phase, Record<Lang, string>> = {
  lobby: { az: 'missiya hələ başlamayıb', en: 'mission not started yet' },
  briefing: { az: 'brifinq / uçuş və eniş', en: 'briefing / flight and landing' },
  prep: { az: 'hazırlıq checklist-i', en: 'preparation checklist' },
  surface: { az: 'səthdə iş (EVA)', en: 'surface work (EVA)' },
  crisis: { az: 'günəş fırtınası böhranı', en: 'solar storm crisis' },
  debrief: { az: 'missiya bitib, qiymətləndirmə', en: 'mission over, debrief' },
  aborted: { az: 'missiya dayandırılıb, təhlükəsiz qayıdış', en: 'mission aborted, safe return' },
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function telemetryNote(s: SimState | null, lang: Lang): string | null {
  if (!s) return null;
  const az = lang === 'az';
  const wp = NOBILE_MAY2024.waypoints.find((w) => w.id === s.astronaut.waypointId);
  const where = wp ? wp.label[lang] : s.astronaut.waypointId;
  const obj = currentObjective(s);
  const sw = s.switches;
  const onOff = (b: boolean) => (az ? (b ? 'açıq' : 'bağlı') : b ? 'on' : 'off');

  if (az) {
    return [
      '[TELEMETRİYA — səsli oxuma, yalnız soruşulsa istifadə et]',
      `Faza: ${PHASE[s.phase].az}.`,
      `AstroVR: ${where}${s.astronaut.inAirlock ? ', sığınacağın içində' : ''}${s.astronaut.inShadow ? ', krater kölgəsində' : ''}, bazaya ${Math.round(s.astronaut.distanceToBaseM)} metr.`,
      `Radiasiya dozası: ${r1(s.dose.totalMGy)} milliqrey, büdcənin ${Math.round(s.dose.budgetPct)} faizi; indiki sürət saatda ${r1(s.dose.rateMGyPerH)} milliqrey.`,
      `Skafandrda oksigen: ${Math.round(s.o2.suitPct)} faiz.`,
      `Batareya: ${r1(s.power.batteryKWh)} / ${s.power.batteryMaxKWh} kilovat-saat; günəşdən gələn ${r1(s.power.solarInKW)} kilovat, sərf ${r1(s.power.loadKW)} kilovat.`,
      `Günəş: ${s.sun.blocked ? 'silsilənin arxasındadır, panellər kölgədə' : 'panelləri işıqlandırır'}.`,
      `Günəş fırtınası: ${s.sep.active ? 'İNDİ DAVAM EDİR' : s.sep.warning ? 'xəbərdarlıq verilib, protonlar yoldadır' : 'yoxdur'}.`,
      `Açarlar: sığınacaq qoruması ${onOff(sw.shelter)}, antenna ${onOff(sw.antenna)}, istixana ${onOff(sw.greenhouse)}, günəş dirəyi ${sw.vsat === 'up' ? 'qalxıb' : sw.vsat === 'raising' ? 'qalxır' : 'aşağıdadır'}.`,
      `İndi: ${obj.control.az}.`,
    ].join(' ');
  }
  return [
    '[TELEMETRY — never read aloud, use only if asked]',
    `Phase: ${PHASE[s.phase].en}.`,
    `AstroVR: ${where}${s.astronaut.inAirlock ? ', inside the shelter' : ''}${s.astronaut.inShadow ? ', in crater shadow' : ''}, ${Math.round(s.astronaut.distanceToBaseM)} metres from base.`,
    `Radiation dose: ${r1(s.dose.totalMGy)} milligray, ${Math.round(s.dose.budgetPct)} percent of budget; current rate ${r1(s.dose.rateMGyPerH)} milligray per hour.`,
    `Suit oxygen: ${Math.round(s.o2.suitPct)} percent.`,
    `Battery: ${r1(s.power.batteryKWh)} of ${s.power.batteryMaxKWh} kilowatt-hours; solar in ${r1(s.power.solarInKW)} kilowatts, load ${r1(s.power.loadKW)} kilowatts.`,
    `Sun: ${s.sun.blocked ? 'behind the ridge, panels in shadow' : 'lighting the panels'}.`,
    `Solar storm: ${s.sep.active ? 'HAPPENING NOW' : s.sep.warning ? 'warning issued, protons on the way' : 'none'}.`,
    `Switches: shelter shielding ${onOff(sw.shelter)}, antenna ${onOff(sw.antenna)}, greenhouse ${onOff(sw.greenhouse)}, solar mast ${sw.vsat}.`,
    `Now: ${obj.control.en}.`,
  ].join(' ');
}
