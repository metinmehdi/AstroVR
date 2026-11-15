/**
 * The rover must move like the real one, with no visual errors: speed and acceleration limits, no jumps (position,
 * heading, wheel spin — also across the lap wrap), a drivable path on the REAL terrain, clear of the cadet's routes.
 */
import { describe, expect, it } from 'vitest';
import { CYCLE, LOOP_LENGTH, ROVER, RoverClock, driveAt, loopSegments, pointAt } from './roverPath';
import { lolaHeight } from './lola';
import { NOBILE_MAY2024 as SC } from '../shared/scenario';

const DT = 1 / 60;
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

describe('rover path', () => {
  it('has a sensible length', () => {
    expect(LOOP_LENGTH).toBeGreaterThan(45);
    expect(LOOP_LENGTH).toBeLessThan(75);
  });

  it('never turns tighter than a 6 m radius and the turn rate is continuous', () => {
    let prev = pointAt(0).turn;
    for (let s = 0; s <= LOOP_LENGTH; s += 0.05) {
      const p = pointAt(s);
      expect(Math.abs(p.turn)).toBeLessThan(1 / 6);
      expect(Math.abs(p.turn - prev)).toBeLessThan(0.01);
      prev = p.turn;
    }
  });

  it('is closed: the end meets the start (position and heading)', () => {
    const a = pointAt(0);
    const b = pointAt(LOOP_LENGTH - 1e-6);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-3);
    expect(Math.abs(angDiff(a.yaw, b.yaw))).toBeLessThan(1e-3);
  });

  it('stays ≥ 6 m from the walking routes, waypoints and outpost buildings', () => {
    const wp = (id: string) => SC.waypoints.find((w) => w.id === id)!;
    const segs: [number, number, number, number][] = [];
    for (const r of Object.values(SC.routes)) for (let i = 1; i < r.length; i++) segs.push([wp(r[i - 1]).x, wp(r[i - 1]).z, wp(r[i]).x, wp(r[i]).z]);
    // outpost: airlock, habitat, lander, greenhouse, VSAT mast, antenna (centre, radius)
    const buildings = [[0, 0, 2.5], [8, 6, 5], [24, 12, 4], [-7, -8, 2.3], [-9, 2, 1.3], [7, -3, 1]];
    let min = Infinity;
    for (let s = 0; s < LOOP_LENGTH; s += 0.25) {
      const { x, z } = pointAt(s);
      for (const [ax, az, bx, bz] of segs) {
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        min = Math.min(min, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
      }
      for (const [bx, bz, r] of buildings) min = Math.min(min, Math.hypot(x - bx, z - bz) - r);
    }
    expect(min).toBeGreaterThanOrEqual(6);
  });

  it('is drivable on the REAL terrain: slope under the rover ≤ 10° (VIPER limit ~15°)', () => {
    let max = 0;
    for (let s = 0; s < LOOP_LENGTH; s += 0.5) {
      const { x, z } = pointAt(s);
      const gx = (lolaHeight(x + 1, z) - lolaHeight(x - 1, z)) / 2;
      const gz = (lolaHeight(x, z + 1) - lolaHeight(x, z - 1)) / 2;
      max = Math.max(max, (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI);
    }
    expect(max).toBeLessThanOrEqual(10);
  });

  it('gives a polyline for keeping rocks and craters away', () => {
    const segs = loopSegments(2);
    expect(segs.length).toBeGreaterThan(20);
    expect(Math.hypot(segs[0][0] - segs[segs.length - 1][2], segs[0][1] - segs[segs.length - 1][3])).toBeLessThan(1e-6);
  });
});

describe('rover motion', () => {
  it('respects VIPER speed (≤ 0.2 m/s) and gentle acceleration (≤ 0.05 m/s²) over two laps', () => {
    let prev = driveAt(0);
    let prevV = 0;
    for (let t = DT; t < 2 * CYCLE + 5; t += DT) {
      const d = driveAt(t);
      const v = (d.dist - prev.dist) / DT;
      expect(v).toBeGreaterThanOrEqual(-1e-9); // never backwards
      expect(v).toBeLessThanOrEqual(ROVER.vMax + 1e-6);
      expect(Math.abs(d.v - prevV) / DT).toBeLessThanOrEqual(0.05);
      prev = d;
      prevV = d.v;
    }
  });

  it('has no jumps in position, heading or wheel spin (incl. the lap wrap and the start of the EVA)', () => {
    let prevD = driveAt(-1);
    let prevP = pointAt(prevD.dist);
    for (let t = -1 + DT; t < 2 * CYCLE + 5; t += DT) {
      const d = driveAt(t);
      const p = pointAt(d.dist);
      expect(Math.hypot(p.x - prevP.x, p.z - prevP.z)).toBeLessThanOrEqual(ROVER.vMax * DT + 1e-6);
      expect(Math.abs(angDiff(p.yaw, prevP.yaw))).toBeLessThan(0.002);
      // wheel angle = dist / r → its change per frame is bounded by the speed
      expect((d.dist - prevD.dist) / ROVER.wheelRadius).toBeLessThanOrEqual((ROVER.vMax * DT) / ROVER.wheelRadius + 1e-6);
      prevD = d;
      prevP = p;
    }
  });

  it('stops at every imaging station', () => {
    let stops = 0;
    let wasStopped = false;
    for (let t = 0.01; t < CYCLE; t += 0.25) {
      const s = driveAt(t).stopT >= 0;
      if (s && !wasStopped) stops++;
      wasStopped = s;
    }
    expect(stops).toBe(ROVER.stations);
  });

  it('is parked before the EVA', () => {
    expect(driveAt(null)).toEqual({ dist: 0, v: 0, stopT: -2 });
    expect(driveAt(-30).dist).toBe(0);
  });
});

describe('rover clock (phone = projector, no visible jumps)', () => {
  it('absorbs a 300 ms clock correction smoothly', () => {
    const c = new RoverClock();
    let target = 10;
    c.update(DT, target);
    let prev = c.tau!;
    for (let i = 0; i < 600; i++) {
      target += DT;
      if (i === 100) target += 0.3; // the phone's clock offset is re-estimated
      const tau = c.update(DT, target)!;
      const step = tau - prev;
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(DT * 1.3); // ≤ 30 % speed change for a moment → invisible at 20 cm/s
      prev = tau;
    }
    expect(Math.abs(c.tau! - target)).toBeLessThan(0.01);
  });

  it('snaps on a big change (new mission) and parks when there is no EVA', () => {
    const c = new RoverClock();
    c.update(DT, 5);
    expect(c.update(DT, 50)).toBe(50);
    expect(c.update(DT, null)).toBeNull();
  });
});
