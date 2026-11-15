/**
 * SHARED CONTRACT — frozen after the first integration hour.
 * Change only after agreeing with every package owner (astronaut, control, sim, scene, audio).
 *
 * Architecture: the Mission Control laptop is AUTHORITATIVE. It runs the simulation and publishes
 * `SimState`. The phone (astronaut) only sends `AstronautPose` + `AstronautAction`s and renders state.
 */

export type Lang = 'en' | 'az';
export type Role = 'control' | 'astronaut';
export type RoomMode = 'mission' | 'quickMoon';

/** Mission phases. Order matters (see PHASE_ORDER). */
export type Phase =
  | 'lobby' // waiting for the astronaut to join and press START
  | 'briefing' // 1. Mission briefing
  | 'prep' // 2. Preparation checklist
  | 'surface' // 3. Surface activity
  | 'crisis' // 4. Scenario decision (double Sun crisis)
  | 'debrief' // 5. Evaluation
  | 'aborted'; // soft abort (safe return) → then debrief

export const PHASE_ORDER: Phase[] = ['lobby', 'briefing', 'prep', 'surface', 'crisis', 'debrief'];

export type ChecklistItem = 'lookTraining' | 'commCheck' | 'suitCheck' | 'toolCheck';
export const CHECKLIST_ITEMS: ChecklistItem[] = ['lookTraining', 'commCheck', 'suitCheck', 'toolCheck'];

export type RouteId = 'A' | 'B';
export type SiteId = 'siteA' | 'siteB';

/** Where the astronaut is. Waypoint ids come from the scenario. */
export interface AstronautLocation {
  waypointId: string;
  inAirlock: boolean; // airlock = storm shelter
  inShadow: boolean; // standing in a crater-wall shadow refuge
  distanceToBaseM: number;
}

export interface SampleRecord {
  siteId: SiteId;
  photo: boolean; // photo with gnomon (scale bar) BEFORE collecting — Apollo procedure
  collected: boolean;
  bagNumber: string | null;
  marked: boolean; // location logged
}

export type VsatState = 'down' | 'raising' | 'up';

/** Mission Control switches. Life support is always ON and not switchable. */
export interface Switches {
  vsat: VsatState; // ☀️ vertical solar array mast (NASA VSAT concept)
  antenna: boolean; // 📡 comms with astronaut + Earth
  shelter: boolean; // 🛡️ storm-shelter radiation protection (powered)
  greenhouse: boolean; // 🌱 grow lights (food production)
}

export type StormChoice = 'returnNow' | 'finishInShadow' | 'continueOpen';

export interface SimEvent {
  /** mission time in real seconds since START */
  t: number;
  actor: 'astronaut' | 'control' | 'system';
  type: string; // e.g. 'checklist', 'route', 'switch', 'stormChoice', 'sunBlocked', 'sepWarning', 'abort'
  payload?: Record<string, unknown>;
}

/** Rocket flight to the Moon before the briefing (story mode). null = no flight (judge mode, skipped). */
export interface FlightState {
  status: 'pad' | 'flying' | 'landed';
  short: boolean;
  /** sim time (s) of the last status change */
  at: number;
  /** shared clock (ms, src/shared/clock.ts) at launch: both devices schedule voices and the film from it */
  wall?: number;
}

export interface SimState {
  version: 1;
  phase: Phase;
  /** real seconds since START (mission clock shown as compressed EVA time) */
  t: number;
  power: {
    batteryKWh: number;
    batteryMaxKWh: number;
    solarInKW: number;
    loadKW: number;
  };
  o2: {
    suitPct: number; // 0..100
    walkbackMarginPct: number; // O2 left after the walk back home (must stay > 0)
  };
  dose: {
    totalMGy: number; // accumulated this EVA (simplified model)
    rateMGyPerH: number; // current rate in mission time
    budgetPct: number; // 0..100 of the mission dose budget
  };
  greenhouseHealth: number; // 0..1
  sun: { elevationDeg: number; blocked: boolean };
  /** protons: real integral intensity 25–53 MeV (cm² s sr)⁻¹; fluxNorm = protons / event peak (for UI bars) */
  sep: { warning: boolean; active: boolean; protons: number; fluxNorm: number };
  switches: Switches;
  vsatProgress: number; // 0..1 while raising
  astronaut: AstronautLocation;
  checklist: Record<ChecklistItem, boolean>;
  route: RouteId | null;
  samples: SampleRecord[];
  stormChoice: StormChoice | null;
  abortReason: AbortReason | null;
  /** radio statistics for the teamwork score */
  comms: {
    sent: number;
    lost: number; // sent while antenna was off
    acked: number; // astronaut answered "Copy" in time
    pending: Record<string, number>; // msgId → sent time (real s)
  };
  /** real seconds when EVA (surface phase) started; null before */
  evaStartedAt: number | null;
  /** real seconds when the phase last changed */
  phaseStartedAt: number;
  flight: FlightState | null;
  /** story intro playing on Mission Control (the phone shows it in VR on the same timeline); null = not playing */
  story: { id: string; starts: number[]; durs: number[]; /** shared clock (ms) of timeline zero */ at?: number } | null;
  /** the phone has the real flight footage in memory (lobby readiness chip) */
  filmReady: boolean;
  events: SimEvent[];
}

export type AbortReason = 'dose' | 'oxygen' | 'power';

/** Phone → room, high rate (~10 Hz), last-write-wins. Used for the "helmet cam" on the laptop. */
export interface AstronautPose {
  q: [number, number, number, number]; // head orientation quaternion (x, y, z, w) in scene space
  waypointId: string;
  ts: number; // sender clock ms
}

/** Phone → room, discrete actions (queued, processed once by Control). */
export type AstronautAction =
  | { kind: 'ready' } // pressed START on the phone (sensors + audio unlocked)
  | { kind: 'skipStory' } // looked at SKIP on the in-capsule story screen
  | { kind: 'filmReady' } // the real flight footage is downloaded on the phone
  | { kind: 'checklist'; item: ChecklistItem }
  | { kind: 'copy'; msgId: string } // radio read-back "Copy"
  | { kind: 'route'; route: RouteId }
  | { kind: 'moveTo'; waypointId: string }
  | { kind: 'samplePhoto'; siteId: SiteId }
  | { kind: 'sampleCollect'; siteId: SiteId }
  | { kind: 'sampleMark'; siteId: SiteId }
  | { kind: 'stormChoice'; choice: StormChoice };

export interface ActionEnvelope {
  id: string;
  ts: number;
  action: AstronautAction;
}

/** Control → astronaut radio messages (CAPCOM). Played with the Earth–Moon delay. */
export type RadioMessageType =
  | 'radioCheck'
  | 'statusRequest'
  | 'returnToBase'
  | 'seekShadow'
  | 'finishSample'
  | 'goodJob'
  | 'sepWarning'
  | 'sunBlocked'
  | 'abort'
  | 'missionComplete';

export interface RadioMessage {
  id: string;
  type: RadioMessageType;
  ts: number; // sender clock ms
  /** true when the antenna was off at send time → message never arrives */
  lost?: boolean;
  /** shared clock (ms) when the voice starts on both devices (after the 1.28 s light delay) */
  at?: number;
}

/** low-latency, fire-and-forget messages: clock sync and synchronized voice lines */
export type FastMsg =
  | { k: 'ping'; id: number; t0: number }
  | { k: 'pong'; id: number; t0: number; tl: number }
  | { k: 'voice'; id: string; line: string; lang: Lang; at: number; kind: 'suit' }
  | { k: 'cal'; id: string; at: number } // sound-sync calibration: beep at `at` (shared clock)
  | { k: 'calres'; id: string; ms: number | null }; // measured extra delay of the laptop's sound

/** WebRTC signalling for the live phone → Mission Control mirror (carried by the reliable transport). */
export interface RtcSignal {
  id: string;
  to: Role;
  kind: 'request' | 'offer' | 'answer' | 'ice';
  data?: unknown;
}

export interface RoomMeta {
  code: string;
  lang: Lang;
  mode: RoomMode;
  scenarioId: string;
  cadetName: string;
  createdAt: number;
  astronautJoined: boolean;
}

/* ---------------- Scenario (static JSON, built by scripts/ from real NASA data) ---------------- */

export interface Waypoint {
  id: string;
  /** scene coordinates in metres: x east, z south, y up (height filled from terrain at runtime) */
  x: number;
  z: number;
  label: { en: string; az: string };
  shadowRefuge?: boolean;
  siteId?: SiteId;
}

export interface Scenario {
  id: string;
  title: { en: string; az: string };
  site: {
    name: string; // e.g. "Nobile Rim 1"
    latDeg: number;
    lonDeg: number;
    source: string; // data provenance text shown in the Science panel
  };
  realEvent: {
    donkiIds: string[];
    date: string; // ISO date of the real event
    description: { en: string; az: string };
    /**
     * REAL measured penetrating-proton profile after the warning:
     * [secondsAfterWarning (real s), integral intensity 25–53 MeV in (cm² s sr)⁻¹] from SOHO/EPHIN.
     */
    protonProfile: [number, number][];
    /** storm minutes per real second (replay speed, shown openly) */
    stormMinutesPerRealSecond: number;
    source: string;
  };
  /** real seconds after EVA start (hatch opens): when the Sun drops behind the ridge, when the SEP warning comes */
  timeline: { sunBlockedAfterEvaS: number; sepWarningAfterEvaS: number };
  /** waypoint coordinates are scene metres; mission distance = scene × distanceScale (shown openly) */
  distanceScale: number;
  waypoints: Waypoint[];
  routes: Record<RouteId, string[]>; // ordered waypoint ids from base
}
