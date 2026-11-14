/** Debrief scoring: 1–3 stars in the four categories from the original idea. */
import type { SimState } from '../shared/types';
import { CHECKLIST_ITEMS } from '../shared/types';

export type Stars = 1 | 2 | 3;

export interface Debrief {
  prep: Stars; // preparation procedures followed
  science: Stars; // completeness of scientific records
  resources: Stars; // power, oxygen, radiation, food
  teamwork: Stars; // coordination astronaut ↔ Mission Control
  /** i18n keys explaining what happened (rendered by the debrief UI) */
  notes: string[];
}

export function isDocumented(x: SimState['samples'][number]): boolean {
  return x.photo && x.collected && x.bagNumber !== null && x.marked;
}

export function computeDebrief(s: SimState): Debrief {
  const notes: string[] = [];

  const done = CHECKLIST_ITEMS.filter((i) => s.checklist[i]).length;
  const prep: Stars = done === CHECKLIST_ITEMS.length ? 3 : done === CHECKLIST_ITEMS.length - 1 ? 2 : 1;
  if (!s.checklist.suitCheck) notes.push('note.skippedSuitCheck');
  if (!s.checklist.toolCheck) notes.push('note.skippedToolCheck');
  if (!s.checklist.commCheck) notes.push('note.skippedCommCheck');

  const documented = s.samples.filter(isDocumented).length;
  const anyWork = s.samples.some((x) => x.photo || x.collected);
  const science: Stars = documented >= 2 ? 3 : documented === 1 ? 2 : 1;
  if (s.samples.some((x) => x.collected && !x.photo)) notes.push('note.noPhotoBeforeSample');
  if (!anyWork) notes.push('note.noSamples');

  let res = 0;
  if (s.power.batteryKWh / s.power.batteryMaxKWh >= 0.2) res++;
  else notes.push('note.lowBattery');
  if (s.dose.budgetPct <= 50) res++;
  else notes.push('note.highDose');
  if (s.greenhouseHealth >= 0.7) res++;
  else notes.push('note.greenhouseStress');
  if (!s.abortReason) res++;
  const resources: Stars = res >= 4 ? 3 : res >= 2 ? 2 : 1;

  const delivered = s.comms.sent;
  const ratio = delivered === 0 ? 0 : s.comms.acked / delivered;
  let team: Stars = ratio >= 0.8 ? 3 : ratio >= 0.5 ? 2 : 1;
  if (s.sep.warning && !s.stormChoice && team > 1) team = (team - 1) as Stars;
  if (s.comms.lost > 0) notes.push('note.radioLost');
  if (s.abortReason) notes.push(`note.abort.${s.abortReason}`);

  return { prep, science, resources, teamwork: team, notes };
}
