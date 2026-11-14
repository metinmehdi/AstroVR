import { describe, expect, it } from 'vitest';
import { NOBILE_MAY2024 as SC } from '../shared/scenario';
import type { SimState } from '../shared/types';
import { applyAction, applyControl, createInitialState, protonsAt, step } from './model';
import { computeDebrief } from './scoring';
import * as C from './constants';

function run(s: SimState, seconds: number, dt = 0.25) {
  for (let i = 0; i < seconds / dt; i++) step(s, dt, SC);
}

function toSurface(): SimState {
  const s = createInitialState(SC);
  applyControl(s, { kind: 'start' });
  applyControl(s, { kind: 'next' }); // briefing → prep
  for (const item of ['lookTraining', 'commCheck', 'suitCheck', 'toolCheck'] as const) {
    applyAction(s, { kind: 'checklist', item }, SC);
  }
  step(s, 0.1, SC); // all checks done → surface
  return s;
}

function walk(s: SimState, ids: string[]) {
  for (const id of ids) applyAction(s, { kind: 'moveTo', waypointId: id }, SC);
}

describe('phases', () => {
  it('briefing auto-advances to prep, completed checklist opens the hatch', () => {
    const s = createInitialState(SC);
    applyControl(s, { kind: 'start' });
    run(s, C.BRIEFING_S + 1);
    expect(s.phase).toBe('prep');
    const t = toSurface();
    expect(t.phase).toBe('surface');
    expect(t.evaStartedAt).not.toBeNull();
  });

  it('Sun drops behind the ridge, then the real SEP warning arrives', () => {
    const s = toSurface();
    run(s, SC.timeline.sunBlockedAfterEvaS + 1);
    expect(s.sun.blocked).toBe(true);
    expect(s.phase).toBe('crisis');
    run(s, SC.timeline.sepWarningAfterEvaS - SC.timeline.sunBlockedAfterEvaS + 1);
    expect(s.sep.warning).toBe(true);
  });
});

describe('movement', () => {
  it('only allows adjacent moves along a route and sets the route', () => {
    const s = toSurface();
    applyAction(s, { kind: 'moveTo', waypointId: 'siteB' }, SC); // not adjacent
    expect(s.astronaut.waypointId).toBe('airlock');
    walk(s, ['base', 'b1']);
    expect(s.route).toBe('B');
    expect(s.astronaut.inAirlock).toBe(false);
  });
});

describe('radiation trade-offs (real anchors)', () => {
  it('shelter with protection powered gets ~4x less dose than standing in the open', () => {
    const open = toSurface();
    const shelter = toSurface();
    walk(open, ['base', 'a1']);
    applyControl(shelter, { kind: 'switch', key: 'shelter', on: true });
    applyControl(shelter, { kind: 'switch', key: 'greenhouse', on: false }); // keep the battery alive
    // run both into the storm
    for (const s of [open, shelter]) {
      run(s, SC.timeline.sepWarningAfterEvaS + 85, 0.5);
    }
    const ratio = shelter.dose.rateMGyPerH / open.dose.rateMGyPerH;
    expect(ratio).toBeCloseTo(C.SHELTER_FACTOR_POWERED, 1);
  });

  it('crater-wall shadow cuts the storm dose rate by 40%', () => {
    const shadow = toSurface();
    const open = toSurface();
    walk(shadow, ['base', 'b1', 'b2']);
    walk(open, ['base', 'b1']);
    for (const s of [shadow, open]) run(s, SC.timeline.sepWarningAfterEvaS + 90, 0.5);
    expect(shadow.dose.rateMGyPerH / open.dose.rateMGyPerH).toBeCloseTo(C.SHADOW_FACTOR, 2);
  });

  it('staying in the open through the storm peak triggers a soft abort and safe return', () => {
    const s = toSurface();
    walk(s, ['base', 'b1', 'b2', 'siteB']);
    run(s, SC.timeline.sepWarningAfterEvaS + 140, 0.5);
    expect(['aborted', 'debrief']).toContain(s.phase);
    expect(s.abortReason).toBe('dose');
    expect(s.astronaut.inAirlock).toBe(true);
  });
});

describe('power trade-offs', () => {
  it('raising the VSAT mast restores most solar power after the Sun is blocked', () => {
    const s = toSurface();
    run(s, SC.timeline.sunBlockedAfterEvaS + 1);
    expect(s.power.solarInKW).toBe(C.SOLAR_BLOCKED_KW);
    applyControl(s, { kind: 'raiseVsat' });
    run(s, C.VSAT_RAISE_S + 1);
    expect(s.switches.vsat).toBe('up');
    expect(s.power.solarInKW).toBe(C.SOLAR_VSAT_UP_KW);
  });

  it('greenhouse lights off saves power but stresses the plants', () => {
    const s = toSurface();
    applyControl(s, { kind: 'switch', key: 'greenhouse', on: false });
    run(s, 60);
    expect(s.greenhouseHealth).toBeLessThan(0.8);
    expect(s.power.loadKW).toBeCloseTo(C.LOAD_LIFE_SUPPORT_KW + C.LOAD_ANTENNA_KW, 5);
  });

  it('flat battery sheds non-essential loads (life support first)', () => {
    const s = toSurface();
    applyControl(s, { kind: 'switch', key: 'shelter', on: true });
    s.power.batteryKWh = 0.01;
    run(s, SC.timeline.sunBlockedAfterEvaS + 2);
    expect(s.switches.greenhouse).toBe(false);
    expect(s.switches.shelter).toBe(false);
  });
});

describe('comms + debrief', () => {
  it('radio sent with antenna off is lost; copy within window counts', () => {
    const s = toSurface();
    applyControl(s, { kind: 'radio', msgId: 'm1', type: 'statusRequest' });
    applyAction(s, { kind: 'copy', msgId: 'm1' }, SC);
    expect(s.comms.acked).toBe(1);
    applyControl(s, { kind: 'switch', key: 'antenna', on: false });
    applyControl(s, { kind: 'radio', msgId: 'm2', type: 'statusRequest' });
    expect(s.comms.lost).toBe(1);
  });

  it('skipping the tool check leaves samples without bag numbers', () => {
    const s = createInitialState(SC);
    applyControl(s, { kind: 'start' });
    applyControl(s, { kind: 'next' });
    applyControl(s, { kind: 'next' }); // GO for EVA with everything skipped
    walk(s, ['base', 'a1', 'siteA']);
    applyAction(s, { kind: 'samplePhoto', siteId: 'siteA' }, SC);
    applyAction(s, { kind: 'sampleCollect', siteId: 'siteA' }, SC);
    applyAction(s, { kind: 'sampleMark', siteId: 'siteA' }, SC);
    const d = computeDebrief(s);
    expect(s.samples[0].bagNumber).toBeNull();
    expect(d.prep).toBe(1);
    expect(d.science).toBe(1);
    expect(d.notes).toContain('note.skippedToolCheck');
  });

  it('uses the real SOHO/EPHIN profile: quiet at the warning, ~1 min to arrival, strong rise after', () => {
    const p = SC.realEvent.protonProfile;
    expect(p.length).toBeGreaterThan(10);
    expect(protonsAt(SC, 0)).toBeLessThan(1);
    expect(protonsAt(SC, 40)).toBeLessThan(1.5); // still quiet ~40 s after the warning
    expect(protonsAt(SC, 100)).toBeGreaterThan(10); // penetrating protons up >10× after arrival
  });

  it('dose from real protons: open > budget > shadow over the storm (training flight rule)', () => {
    const rate = (p: number, f: number) => (C.GCR_MGY_PER_H + C.DOSE_MGY_PER_H_PER_INTENSITY * p) * f;
    let open = 0;
    let shadow = 0;
    for (let s = 0; s < 140; s += 0.1) {
      open += (rate(protonsAt(SC, s), C.OPEN_FACTOR) * 0.1) / 60;
      shadow += (rate(protonsAt(SC, s), C.SHADOW_FACTOR) * 0.1) / 60;
    }
    expect(open).toBeGreaterThan(C.MISSION_DOSE_BUDGET_MGY);
    expect(shadow).toBeLessThan(C.MISSION_DOSE_BUDGET_MGY);
  });
});
