/**
 * Authoritative mission simulation. Runs ONLY on the Mission Control laptop.
 * Pure TypeScript (no DOM, no three.js) so it is unit-testable and portable to the future game engine.
 * Functions mutate the given state object (Control owns a single state instance).
 */
import type {
  AbortReason,
  AstronautAction,
  ChecklistItem,
  Phase,
  RadioMessageType,
  RouteId,
  Scenario,
  SimEvent,
  SimState,
  SiteId,
  Waypoint,
} from '../shared/types';
import { CHECKLIST_ITEMS } from '../shared/types';
import * as C from './constants';

export type ControlCommand =
  | { kind: 'start' } // lobby → briefing
  | { kind: 'next' } // briefing → prep, prep → surface ("GO for EVA")
  | { kind: 'switch'; key: 'antenna' | 'shelter' | 'greenhouse'; on: boolean }
  | { kind: 'raiseVsat' }
  | { kind: 'radio'; msgId: string; type: RadioMessageType }
  | { kind: 'endMission' }
  /** Judge mode ("Stand on the Moon", 60 s): straight onto the surface, joining the REAL storm 45 s after its warning */
  | { kind: 'quickMoon' };

const SITES: SiteId[] = ['siteA', 'siteB'];

export function createInitialState(_scenario?: Scenario): SimState {
  return {
    version: 1,
    phase: 'lobby',
    t: 0,
    power: {
      batteryKWh: C.BATTERY_START_KWH,
      batteryMaxKWh: C.BATTERY_MAX_KWH,
      solarInKW: C.SOLAR_LIT_KW,
      loadKW: C.LOAD_LIFE_SUPPORT_KW + C.LOAD_GREENHOUSE_KW + C.LOAD_ANTENNA_KW,
    },
    o2: { suitPct: 100, walkbackMarginPct: 100 - C.O2_RESERVE_PCT },
    dose: { totalMGy: 0, rateMGyPerH: C.GCR_MGY_PER_H, budgetPct: 0 },
    greenhouseHealth: 1,
    sun: { elevationDeg: 1.5, blocked: false },
    sep: { warning: false, active: false, protons: 0, fluxNorm: 0 },
    switches: { vsat: 'down', antenna: true, shelter: false, greenhouse: true },
    vsatProgress: 0,
    astronaut: { waypointId: 'airlock', inAirlock: true, inShadow: false, distanceToBaseM: 0 },
    checklist: Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i, false])) as Record<ChecklistItem, boolean>,
    route: null,
    samples: SITES.map((siteId) => ({ siteId, photo: false, collected: false, bagNumber: null, marked: false })),
    stormChoice: null,
    abortReason: null,
    comms: { sent: 0, lost: 0, acked: 0, pending: {} },
    evaStartedAt: null,
    phaseStartedAt: 0,
    events: [],
  };
}

/* ------------------------------------------------------------------ helpers */

function log(s: SimState, actor: SimEvent['actor'], type: string, payload?: Record<string, unknown>) {
  s.events.push({ t: round1(s.t), actor, type, ...(payload ? { payload } : {}) });
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function setPhase(s: SimState, phase: Phase) {
  if (s.phase === phase) return;
  s.phase = phase;
  s.phaseStartedAt = s.t;
  if (phase === 'surface' && s.evaStartedAt === null) s.evaStartedAt = s.t;
  log(s, 'system', 'phase', { phase });
}

function wp(scenario: Scenario, id: string): Waypoint | undefined {
  return scenario.waypoints.find((w) => w.id === id);
}

/** Scene distance between two waypoints × distanceScale = mission metres. */
function missionDistanceM(scenario: Scenario, a: string, b: string): number {
  const A = wp(scenario, a);
  const B = wp(scenario, b);
  if (!A || !B) return 0;
  return Math.hypot(A.x - B.x, A.z - B.z) * scenario.distanceScale;
}

/** Mission metres along the route from waypoint back to the airlock. */
export function pathToBaseM(scenario: Scenario, waypointId: string): number {
  for (const route of Object.values(scenario.routes)) {
    const idx = route.indexOf(waypointId);
    if (idx < 0) continue;
    let d = 0;
    for (let i = idx; i > 0; i--) d += missionDistanceM(scenario, route[i], route[i - 1]);
    return d;
  }
  return 0;
}

function routeOf(scenario: Scenario, waypointId: string): RouteId | null {
  for (const [id, route] of Object.entries(scenario.routes) as [RouteId, string[]][]) {
    if (route.indexOf(waypointId) >= 2) return id; // beyond airlock + hatch
  }
  return null;
}

function isAdjacent(scenario: Scenario, a: string, b: string): boolean {
  return Object.values(scenario.routes).some((route) => {
    const i = route.indexOf(a);
    const j = route.indexOf(b);
    return i >= 0 && j >= 0 && Math.abs(i - j) === 1;
  });
}

/** Real seconds to lope a mission distance. */
function travelRealS(missionM: number) {
  return missionM / C.LOPE_SPEED_MPS / 60;
}

function o2Rate(s: SimState) {
  return C.O2_PCT_PER_S * (s.checklist.suitCheck ? 1 : C.O2_LEAK_FACTOR);
}

/** Real measured proton intensity (25–53 MeV) at a time after the warning — linear interpolation of SOHO/EPHIN data. */
export function protonsAt(scenario: Scenario, secondsAfterWarning: number): number {
  const p = scenario.realEvent.protonProfile;
  if (secondsAfterWarning <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    const [t1, v1] = p[i];
    const [t0, v0] = p[i - 1];
    if (secondsAfterWarning <= t1) return v0 + ((v1 - v0) * (secondsAfterWarning - t0)) / (t1 - t0);
  }
  return p[p.length - 1][1];
}

function evaT(s: SimState) {
  return s.evaStartedAt === null ? -1 : s.t - s.evaStartedAt;
}

function isOutside(s: SimState) {
  return !s.astronaut.inAirlock;
}

function moveAstronaut(s: SimState, scenario: Scenario, to: string) {
  const target = wp(scenario, to);
  if (!target) return;
  const from = s.astronaut.waypointId;
  const dist = missionDistanceM(scenario, from, to);
  // extra oxygen for the exertion of moving (rest rate is charged every tick)
  s.o2.suitPct -= o2Rate(s) * (C.O2_ACTIVITY_MOVING - 1) * travelRealS(dist);
  s.astronaut.waypointId = to;
  s.astronaut.inAirlock = to === 'airlock';
  s.astronaut.inShadow = Boolean(target.shadowRefuge);
  s.astronaut.distanceToBaseM = Math.round(pathToBaseM(scenario, to));
  const r = routeOf(scenario, to);
  if (r && s.route !== r) {
    s.route = r;
    log(s, 'astronaut', 'route', { route: r });
  }
  log(s, 'astronaut', 'move', { to });
}

function sample(s: SimState, siteId: SiteId) {
  return s.samples.find((x) => x.siteId === siteId)!;
}

/* ------------------------------------------------------------------ inputs */

export function applyAction(s: SimState, action: AstronautAction, scenario: Scenario) {
  switch (action.kind) {
    case 'ready':
      log(s, 'astronaut', 'ready');
      return;
    case 'checklist':
      if (s.phase !== 'prep' && s.phase !== 'briefing') return;
      if (!s.checklist[action.item]) {
        s.checklist[action.item] = true;
        log(s, 'astronaut', 'checklist', { item: action.item });
      }
      return;
    case 'copy': {
      const sentAt = s.comms.pending[action.msgId];
      if (sentAt === undefined) return;
      delete s.comms.pending[action.msgId];
      if (s.t - sentAt <= C.COPY_WINDOW_S) {
        s.comms.acked++;
        log(s, 'astronaut', 'copy', { msgId: action.msgId, after: round1(s.t - sentAt) });
      }
      return;
    }
    case 'route':
      if (s.phase === 'surface' || s.phase === 'crisis') {
        s.route = action.route;
        log(s, 'astronaut', 'route', { route: action.route });
      }
      return;
    case 'moveTo':
      if (s.phase !== 'surface' && s.phase !== 'crisis') return;
      if (!isAdjacent(scenario, s.astronaut.waypointId, action.waypointId)) return;
      moveAstronaut(s, scenario, action.waypointId);
      return;
    case 'samplePhoto': {
      const w = wp(scenario, s.astronaut.waypointId);
      if (w?.siteId !== action.siteId) return;
      const x = sample(s, action.siteId);
      if (!x.photo) {
        x.photo = true;
        log(s, 'astronaut', 'samplePhoto', { siteId: action.siteId, gnomon: s.checklist.toolCheck });
      }
      return;
    }
    case 'sampleCollect': {
      const w = wp(scenario, s.astronaut.waypointId);
      if (w?.siteId !== action.siteId) return;
      const x = sample(s, action.siteId);
      if (x.collected) return;
      x.collected = true;
      // Without the tool check, no numbered sample bags were packed → the sample is not traceable.
      x.bagNumber = s.checklist.toolCheck ? `BAG-${String(s.samples.filter((y) => y.collected).length).padStart(2, '0')}` : null;
      s.o2.suitPct -= o2Rate(s) * (C.O2_ACTIVITY_SAMPLING - 1) * 5;
      log(s, 'astronaut', 'sampleCollect', { siteId: action.siteId, photoFirst: x.photo, bag: x.bagNumber });
      return;
    }
    case 'sampleMark': {
      const x = sample(s, action.siteId);
      if (x.collected && !x.marked) {
        x.marked = true;
        log(s, 'astronaut', 'sampleMark', { siteId: action.siteId });
      }
      return;
    }
    case 'stormChoice':
      if (!s.sep.warning || s.stormChoice) return;
      s.stormChoice = action.choice;
      log(s, 'astronaut', 'stormChoice', { choice: action.choice });
      return;
  }
}

/** Judge mode joins the real storm this many seconds after the warning → protons arrive ~12 s into the demo. */
export const QUICK_MOON_WARNING_AGO_S = 45;

export function applyControl(s: SimState, cmd: ControlCommand, scenario?: Scenario) {
  switch (cmd.kind) {
    case 'start':
      if (s.phase === 'lobby') setPhase(s, 'briefing');
      return;
    case 'next':
      if (s.phase === 'briefing') setPhase(s, 'prep');
      else if (s.phase === 'prep') {
        log(s, 'control', 'goForEva', {
          skipped: CHECKLIST_ITEMS.filter((i) => !s.checklist[i]),
        });
        setPhase(s, 'surface');
      }
      return;
    case 'switch':
      if (s.switches[cmd.key] === cmd.on) return;
      s.switches[cmd.key] = cmd.on;
      log(s, 'control', 'switch', { key: cmd.key, on: cmd.on });
      return;
    case 'raiseVsat':
      if (s.switches.vsat !== 'down') return;
      s.switches.vsat = 'raising';
      s.vsatProgress = 0;
      log(s, 'control', 'vsatRaise');
      return;
    case 'radio':
      if (!s.switches.antenna) {
        s.comms.lost++;
        log(s, 'control', 'radioLost', { type: cmd.type });
        return;
      }
      s.comms.sent++;
      s.comms.pending[cmd.msgId] = s.t;
      log(s, 'control', 'radio', { type: cmd.type });
      return;
    case 'endMission':
      if (s.phase !== 'debrief') setPhase(s, 'debrief');
      return;
    case 'quickMoon': {
      if (s.phase !== 'lobby' || !scenario) return;
      for (const i of CHECKLIST_ITEMS) s.checklist[i] = true;
      s.evaStartedAt = s.t - (scenario.timeline.sepWarningAfterEvaS + QUICK_MOON_WARNING_AGO_S);
      s.sun.blocked = true;
      s.sep.warning = true;
      s.astronaut = { waypointId: 'base', inAirlock: false, inShadow: false, distanceToBaseM: Math.round(pathToBaseM(scenario, 'base')) };
      log(s, 'control', 'quickMoon');
      s.phase = 'crisis';
      s.phaseStartedAt = s.t;
      return;
    }
  }
}

/* ------------------------------------------------------------------ tick */

/** Advance the simulation by dt real seconds. */
export function step(s: SimState, dt: number, scenario: Scenario) {
  if (s.phase === 'lobby' || s.phase === 'debrief') return;
  s.t += dt;

  // --- phase timers
  if (s.phase === 'briefing' && s.t - s.phaseStartedAt >= C.BRIEFING_S) setPhase(s, 'prep');
  if (s.phase === 'prep' && CHECKLIST_ITEMS.every((i) => s.checklist[i])) setPhase(s, 'surface');

  const e = evaT(s);
  if (s.phase === 'surface' && e >= scenario.timeline.sunBlockedAfterEvaS && !s.sun.blocked) {
    s.sun.blocked = true;
    log(s, 'system', 'sunBlocked');
    setPhase(s, 'crisis');
  }
  if (s.phase === 'crisis' && e >= scenario.timeline.sepWarningAfterEvaS && !s.sep.warning) {
    s.sep.warning = true;
    log(s, 'system', 'sepWarning', { donki: scenario.realEvent.donkiIds });
  }

  // --- solar storm flux
  const afterWarning = s.sep.warning && s.evaStartedAt !== null ? e - scenario.timeline.sepWarningAfterEvaS : -1;
  const profile = scenario.realEvent.protonProfile;
  const protons = afterWarning >= 0 ? protonsAt(scenario, afterWarning) : 0;
  if (afterWarning >= 0 && !s.sep.active && protons > profile[0][1] * C.SEP_ARRIVAL_FACTOR) {
    s.sep.active = true;
    log(s, 'system', 'sepArrival', { protons: round2(protons) });
  }
  s.sep.protons = round2(protons);
  s.sep.fluxNorm = round2(protons / Math.max(...profile.map(([, v]) => v)));

  // --- VSAT mast
  if (s.switches.vsat === 'raising') {
    s.vsatProgress = Math.min(1, s.vsatProgress + dt / C.VSAT_RAISE_S);
    if (s.vsatProgress >= 1) {
      s.switches.vsat = 'up';
      log(s, 'system', 'vsatUp');
    }
  }

  // --- power balance
  const solar = !s.sun.blocked ? C.SOLAR_LIT_KW : s.switches.vsat === 'up' ? C.SOLAR_VSAT_UP_KW : C.SOLAR_BLOCKED_KW;
  const load =
    C.LOAD_LIFE_SUPPORT_KW +
    (s.switches.greenhouse ? C.LOAD_GREENHOUSE_KW : 0) +
    (s.switches.shelter ? C.LOAD_SHELTER_KW : 0) +
    (s.switches.antenna ? C.LOAD_ANTENNA_KW : 0) +
    (s.switches.vsat === 'raising' ? C.VSAT_MOTOR_KW : 0);
  s.power.solarInKW = solar;
  s.power.loadKW = load;
  // 1 real s = 1 mission minute = 1/60 h
  s.power.batteryKWh = clamp(s.power.batteryKWh + ((solar - load) * dt) / 60, 0, s.power.batteryMaxKWh);
  if (s.power.batteryKWh <= 0) loadShed(s, solar);

  // --- greenhouse
  s.greenhouseHealth = clamp(
    s.greenhouseHealth + (s.switches.greenhouse ? C.GREENHOUSE_RECOVER_PER_S : -C.GREENHOUSE_DECAY_PER_S) * dt,
    0,
    1,
  );

  // --- oxygen (only while outside; suit is recharged in the airlock)
  if (isOutside(s)) s.o2.suitPct = Math.max(0, s.o2.suitPct - o2Rate(s) * dt);
  const backS = travelRealS(pathToBaseM(scenario, s.astronaut.waypointId));
  const backCost = o2Rate(s) * C.O2_ACTIVITY_MOVING * backS;
  s.o2.walkbackMarginPct = round1(s.o2.suitPct - backCost - C.O2_RESERVE_PCT);

  // --- radiation
  const factor = s.astronaut.inAirlock
    ? s.switches.shelter
      ? C.SHELTER_FACTOR_POWERED
      : C.SHELTER_FACTOR_UNPOWERED
    : s.astronaut.inShadow
      ? C.SHADOW_FACTOR
      : C.OPEN_FACTOR;
  // mGy per mission hour, computed from the real measured protons (see constants.ts)
  const rate = (C.GCR_MGY_PER_H + C.DOSE_MGY_PER_H_PER_INTENSITY * protons) * factor;
  s.dose.rateMGyPerH = round2(rate);
  s.dose.totalMGy += (rate * dt) / 60;
  s.dose.budgetPct = round1((s.dose.totalMGy / C.MISSION_DOSE_BUDGET_MGY) * 100);

  // --- expire unanswered radio calls
  for (const [id, sentAt] of Object.entries(s.comms.pending)) {
    if (s.t - sentAt > C.COPY_WINDOW_S) delete s.comms.pending[id];
  }

  // --- soft abort rules (flight-rule style)
  if (s.phase === 'surface' || s.phase === 'crisis') {
    if (s.dose.budgetPct >= 100) abort(s, 'dose');
    else if (isOutside(s) && s.o2.walkbackMarginPct < 0) abort(s, 'oxygen');
  }

  // --- end of crisis: astronaut sheltered after the storm warning
  if (s.phase === 'crisis' && s.sep.warning && s.astronaut.inAirlock && afterWarning >= 75) setPhase(s, 'debrief');

  // --- abort sequence: announcement → automatic safe return → debrief
  if (s.phase === 'aborted') {
    const since = s.t - s.phaseStartedAt;
    if (since >= C.SOFT_ABORT_RETURN_S && !s.astronaut.inAirlock) {
      s.astronaut = { waypointId: 'airlock', inAirlock: true, inShadow: false, distanceToBaseM: 0 };
      log(s, 'system', 'autoReturn');
    }
    if (since >= C.ABORT_TO_DEBRIEF_S) setPhase(s, 'debrief');
  }
}

function loadShed(s: SimState, solar: number) {
  // Life support has priority: everything else is switched off automatically.
  const shed = (['greenhouse', 'shelter', 'antenna'] as const).filter((k) => s.switches[k]);
  for (const k of shed) s.switches[k] = false;
  if (shed.length) log(s, 'system', 'loadShed', { shed });
  if (solar < C.LOAD_LIFE_SUPPORT_KW && (s.phase === 'surface' || s.phase === 'crisis')) abort(s, 'power');
}

function abort(s: SimState, reason: AbortReason) {
  if (s.phase === 'aborted' || s.phase === 'debrief') return;
  s.abortReason = reason;
  log(s, 'system', 'abort', { reason });
  setPhase(s, 'aborted');
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
