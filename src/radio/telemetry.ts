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

/**
 * Before landing the crewmate is not on the Moon at all. The persona takes AstroVR's
 * whereabouts from this note, so say it plainly and drop the surface lines (waypoint,
 * dose, suit O₂) that would make the commander describe a moonwalk during the rocket ride.
 */
function awayLine(s: SimState, az: boolean): string | null {
  if (s.phase === 'lobby') {
    return az
      ? 'AstroVR hələ Yerdədir, missiyaya hazırlaşır — Aya gəlməyib.'
      : 'AstroVR is still on Earth getting ready — not on the Moon yet.';
  }
  const f = s.flight?.status;
  if (f === 'pad') {
    return az
      ? 'AstroVR hələ Yerdədir: raketin başındakı kapsulda oturub, start meydançasında gözləyir. Hələ uçmayıb, Ayda DEYİL. Real uçuş təxminən üç gün çəkir, təlimdə isə startdan bir dəqiqəyə yaxın sonra bazanın yanına enəcək.'
      : 'AstroVR is still on Earth, strapped into the capsule on top of the rocket on the launch pad. Has not launched, is NOT on the Moon. The real trip takes about three days; in training they land next to the base about a minute after liftoff.';
  }
  if (f === 'flying') {
    return az
      ? 'AstroVR indi kapsulda Aya uçur — hələ enməyib, səthdə DEYİL. Real uçuş təxminən üç gün çəkir, təlimdə qısaldılıb: bir dəqiqəyə yaxın bazanın yanına enəcək. Sən onu gözləyirsən.'
      : 'AstroVR is flying to the Moon in the capsule right now — has NOT landed, is NOT on the surface. The real trip takes about three days; in training it is shortened and they land next to the base in about a minute. You are waiting for them.';
  }
  return null;
}

export function telemetryNote(s: SimState | null, lang: Lang): string | null {
  if (!s) return null;
  const az = lang === 'az';
  const obj = currentObjective(s);
  const away = awayLine(s, az);
  if (away) {
    return [
      az ? '[TELEMETRİYA — səsli oxuma, yalnız soruşulsa istifadə et]' : '[TELEMETRY — never read aloud, use only if asked]',
      az ? `Faza: ${PHASE[s.phase].az}.` : `Phase: ${PHASE[s.phase].en}.`,
      away,
      az ? `İndi: ${obj.control.az}` : `Now: ${obj.control.en}`,
    ].join(' ');
  }
  const wp = NOBILE_MAY2024.waypoints.find((w) => w.id === s.astronaut.waypointId);
  const where = wp ? wp.label[lang] : s.astronaut.waypointId;
  const sw = s.switches;
  // "bağlı" is ambiguous in Azerbaijani (switched off vs. sealed/safe) — the model read
  // "shielding bağlı" as "safe". Say plainly whether it works.
  const onOff = (b: boolean) => (az ? (b ? 'İŞLƏYİR' : 'SÖNDÜRÜLÜB (işləmir)') : b ? 'ON' : 'OFF');
  const exposed = (s.sep.active || s.sep.warning) && !s.astronaut.inAirlock;
  const unshielded = (s.sep.active || s.sep.warning) && !sw.shelter;

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
      `Açarlar: sığınacağın radiasiya qoruması ${onOff(sw.shelter)}, antenna ${onOff(sw.antenna)}, istixana ${onOff(sw.greenhouse)}, günəş dirəyi ${sw.vsat === 'up' ? 'qalxıb' : sw.vsat === 'raising' ? 'qalxır' : 'aşağıdadır'}.`,
      exposed ? 'DİQQƏT: fırtına var, AstroVR hələ sığınacaqda DEYİL — təhlükəsiz deyil.' : '',
      unshielded ? 'DİQQƏT: fırtına var, sığınacağın qoruması SÖNDÜRÜLÜB — Missiya İdarəsi onu yandırmalıdır.' : '',
      `İndi: ${obj.control.az}`,
    ]
      .filter(Boolean)
      .join(' ');
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
    `Switches: shelter radiation shielding ${onOff(sw.shelter)}, antenna ${onOff(sw.antenna)}, greenhouse ${onOff(sw.greenhouse)}, solar mast ${sw.vsat}.`,
    exposed ? 'WARNING: storm on and AstroVR is NOT in the shelter yet — not safe.' : '',
    unshielded ? 'WARNING: storm on and the shelter shielding is OFF — Mission Control should switch it on.' : '',
    `Now: ${obj.control.en}`,
  ]
    .filter(Boolean)
    .join(' ');
}
