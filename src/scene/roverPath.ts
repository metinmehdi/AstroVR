/**
 * Where and how the robotic rover drives (pure maths, no DOM → unit-tested in rover.test.ts).
 *
 * Real numbers (NASA VIPER technical briefings 2024–2026): max drive speed 20 cm/s, 50 cm wheels, 4 independently
 * steered wheels. Drive → stop → image cycle, like real planetary rovers. The path is a smooth closed loop on the gentle
 * (≤ 6°) real terrain north of the outpost (bearing 324°–4° from the hatch, just right of the Earth, clear of the
 * greenhouse dome in the view), 20–40 m from the hatch, clear of the cadet's walking routes. Its curvature is
 * continuous, so the steering never jumps.
 */

export const ROVER = {
  /** m/s — VIPER's maximum driving speed */
  vMax: 0.2,
  /** s — smooth (cosine) speed-up / slow-down; peak acceleration = vMax·π/(2·ramp) ≈ 0.048 m/s² */
  ramp: 6.5,
  /** s — stop at each imaging station (navigation-camera panorama) */
  stop: 12,
  stations: 4,
  wheelRadius: 0.25,
  /** m — front ↔ rear axle */
  wheelBase: 1.3,
  /** m — left ↔ right wheel centres */
  track: 1.4,
};

/** loop: ellipse (+ a gentle 3rd harmonic so it does not look drawn with a compass) */
const LOOP = {
  cx: -8,
  cz: -32,
  a: 10.5, // semi-axis along the long direction
  b: 9,
  phi: (-16 * Math.PI) / 180, // long axis ⟂ to the view from the hatch → the rover crosses the view
  wobble: 0.2,
};

/** the loop point nearest the hatch is where the rover is parked and where it starts (scene x/z of the hatch) */
const HATCH = { x: 0, z: -4 };

function raw(th: number) {
  const r = 1 + (LOOP.wobble / LOOP.b) * Math.sin(3 * th + 1.1);
  const ex = LOOP.a * r * Math.cos(th);
  const ez = LOOP.b * r * Math.sin(th);
  const c = Math.cos(LOOP.phi);
  const s = Math.sin(LOOP.phi);
  return { x: LOOP.cx + ex * c - ez * s, z: LOOP.cz + ex * s + ez * c };
}

const N = 4096;
const TH = new Float64Array(N + 1);
const S = new Float64Array(N + 1);
let theta0 = 0;
{
  // start angle: nearest to the hatch
  let best = Infinity;
  for (let i = 0; i < 3600; i++) {
    const th = (i / 3600) * Math.PI * 2;
    const p = raw(th);
    const d = Math.hypot(p.x - HATCH.x, p.z - HATCH.z);
    if (d < best) {
      best = d;
      theta0 = th;
    }
  }
  // drive direction: counter-clockwise in θ; arc-length table
  let prev = raw(theta0);
  TH[0] = theta0;
  S[0] = 0;
  for (let i = 1; i <= N; i++) {
    const th = theta0 + (i / N) * Math.PI * 2;
    const p = raw(th);
    TH[i] = th;
    S[i] = S[i - 1] + Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
}
/** loop length (m) */
export const LOOP_LENGTH = S[N];

function thetaAt(s: number): number {
  const u = ((s % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
  let lo = 0;
  let hi = N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid] <= u) lo = mid;
    else hi = mid;
  }
  const f = (u - S[lo]) / (S[hi] - S[lo]);
  return TH[lo] + f * (TH[hi] - TH[lo]);
}

export interface PathPoint {
  x: number;
  z: number;
  /** heading (rad): forward = (sin yaw, cos yaw) in (x, z) — three.js rotation.y of an object facing +z */
  yaw: number;
  /** turn rate dyaw/ds (rad/m) */
  turn: number;
}

/** point on the loop at arc length s (any real s; wraps) */
export function pointAt(s: number): PathPoint {
  const th = thetaAt(s);
  const h = 1e-4;
  const p0 = raw(th - h);
  const p1 = raw(th);
  const p2 = raw(th + h);
  const dx = (p2.x - p0.x) / (2 * h);
  const dz = (p2.z - p0.z) / (2 * h);
  const ddx = (p2.x - 2 * p1.x + p0.x) / (h * h);
  const ddz = (p2.z - 2 * p1.z + p0.z) / (h * h);
  const sp2 = dx * dx + dz * dz;
  // yaw = atan2(dx, dz) → dyaw/dθ = (ddx·dz − dx·ddz)/(dx² + dz²); per metre: divide by |dP/dθ|
  return { x: p1.x, z: p1.z, yaw: Math.atan2(dx, dz), turn: (ddx * dz - dx * ddz) / sp2 / Math.sqrt(sp2) };
}

/** the loop as a polyline (for keeping rocks and craters off the path) */
export function loopSegments(step = 2): [number, number, number, number][] {
  const n = Math.max(8, Math.ceil(LOOP_LENGTH / step));
  const out: [number, number, number, number][] = [];
  let a = pointAt(0);
  for (let i = 1; i <= n; i++) {
    const b = pointAt((i / n) * LOOP_LENGTH);
    out.push([a.x, a.z, b.x, b.z]);
    a = b;
  }
  return out;
}

/* ------------------------------------------------------------------ drive schedule */
const LEG = LOOP_LENGTH / ROVER.stations;
const RAMP_DIST = (ROVER.vMax * ROVER.ramp) / 2;
const LEG_TIME = 2 * ROVER.ramp + (LEG - 2 * RAMP_DIST) / ROVER.vMax;
/** one full lap including the stops (s) */
export const CYCLE = ROVER.stations * (LEG_TIME + ROVER.stop);

/** distance along one leg after t seconds of driving: cosine speed ramps (continuous acceleration, no jerk spikes) */
function legDistance(t: number): { d: number; v: number } {
  const { vMax: v, ramp: r } = ROVER;
  if (t <= 0) return { d: 0, v: 0 };
  if (t >= LEG_TIME) return { d: LEG, v: 0 };
  if (t < r) return { d: (v / 2) * (t - (r / Math.PI) * Math.sin((Math.PI * t) / r)), v: (v / 2) * (1 - Math.cos((Math.PI * t) / r)) };
  const tEnd = LEG_TIME - t;
  if (tEnd < r) return { d: LEG - (v / 2) * (tEnd - (r / Math.PI) * Math.sin((Math.PI * tEnd) / r)), v: (v / 2) * (1 - Math.cos((Math.PI * tEnd) / r)) };
  return { d: RAMP_DIST + v * (t - r), v };
}

export interface DriveState {
  /** total distance driven since the start (keeps growing: wheel angle = dist / r never jumps) */
  dist: number;
  /** speed (m/s) */
  v: number;
  /** seconds into the current imaging stop; −1 while driving; −2 parked (before the EVA) */
  stopT: number;
}

/**
 * Rover state τ seconds after the EVA started (τ ≤ 0 or null: parked at the start, before the EVA).
 * Lap: [drive leg, stop] × stations.
 */
export function driveAt(tau: number | null): DriveState {
  if (tau === null || tau <= 0) return { dist: 0, v: 0, stopT: -2 };
  const lap = Math.floor(tau / CYCLE);
  let t = tau - lap * CYCLE;
  const per = LEG_TIME + ROVER.stop;
  const leg = Math.min(ROVER.stations - 1, Math.floor(t / per));
  t -= leg * per;
  const base = lap * LOOP_LENGTH + leg * LEG;
  if (t < LEG_TIME) {
    const { d, v } = legDistance(t);
    return { dist: base + d, v, stopT: -1 };
  }
  return { dist: base + LEG, v: 0, stopT: t - LEG_TIME };
}

/**
 * Smooth rover time: follows the shared mission clock without ever jumping visibly. Network jitter or a clock
 * correction is absorbed by a gentle speed change (≤ a few %); only a large error (> 1 s, e.g. a restart) snaps.
 */
export class RoverClock {
  tau: number | null = null;
  update(dt: number, target: number | null): number | null {
    if (target === null) {
      this.tau = null;
      return null;
    }
    if (this.tau === null || Math.abs(target - this.tau) > 1) {
      this.tau = target;
      return this.tau;
    }
    this.tau += dt + (target - this.tau - dt) * Math.min(1, dt * 0.8);
    return this.tau;
  }
}
