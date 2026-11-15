import { describe, expect, it } from 'vitest';
import { NOBILE_MAY2024 as SC } from '../shared/scenario';
import { flightTotalS } from '../shared/flight';
import { applyControl, createInitialState, step } from '../sim/model';
import { telemetryNote } from './telemetry';

function run(s: ReturnType<typeof createInitialState>, seconds: number, dt = 0.25) {
  for (let i = 0; i < seconds / dt; i++) step(s, dt, SC);
}

describe('radio telemetry: where the crewmate is', () => {
  it('before landing it says AstroVR is not on the Moon and drops the surface lines', () => {
    const s = createInitialState(SC);
    expect(telemetryNote(s, 'en')).toContain('still on Earth');

    applyControl(s, { kind: 'start' });
    expect(s.flight?.status).toBe('pad');
    const pad = telemetryNote(s, 'az')!;
    expect(pad).toContain('start meydançasında');
    expect(pad).not.toContain('bazaya');
    expect(pad).not.toContain('Radiasiya dozası');

    applyControl(s, { kind: 'launch', short: false });
    const flying = telemetryNote(s, 'en')!;
    expect(flying).toContain('flying to the Moon');
    expect(flying).not.toContain('metres from base');
    expect(telemetryNote(s, 'az')).toContain('Aya uçur');
  });

  it('after landing it reports the surface state again', () => {
    const s = createInitialState(SC);
    applyControl(s, { kind: 'start' });
    applyControl(s, { kind: 'launch', short: true });
    run(s, flightTotalS(true) + 1);
    expect(s.flight?.status).toBe('landed');
    const note = telemetryNote(s, 'en')!;
    expect(note).toContain('metres from base');
    expect(note).toContain('Radiation dose');
    expect(note).not.toContain('flying to the Moon');
  });
});
