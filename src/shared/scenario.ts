import type { Scenario } from './types';
import { PROTON_PROFILE, STORM_MINUTES_PER_REAL_SECOND } from './realdata';

/**
 * Demo scenario: Nobile Rim 1 (Artemis III candidate region) + the REAL solar storm of 11 May 2024.
 * - Timing: NASA DONKI — flare 2024-05-11T01:10:00-FLR-001 → SEP 2024-05-11T02:10:00-SEP-001.
 * - Intensity: REAL hourly proton measurements from SOHO/EPHIN (NASA SPDF CDAWeb), see src/data/ephin-2024-05.json.
 *   Replayed STORM_MINUTES_PER_REAL_SECOND (4) storm-minutes per real second so the real ~4 h delay fits a mission.
 * - Dose: computed from the measured protons with textbook physics (sim/constants.ts) — no invented curve.
 * Waypoints are scene metres around the airlock (x east, z south). TODO(P1): align with the LOLA terrain crop.
 */
export const NOBILE_MAY2024: Scenario = {
  id: 'nobile-may2024',
  title: { en: 'My First Moon Mission', az: 'İlk Ay Missiyam' },
  site: {
    name: 'Nobile Rim 1',
    latDeg: -85.4, // TODO(P1): exact centre from NASA Artemis III region list / PGDA
    lonDeg: 37.0,
    source:
      'Terrain: NASA LRO LOLA (PGDA 5 m/px south-pole DEM). Same Artemis III candidate region NASA used for its 2024 VR moonwalk simulation at Johnson Space Center.',
  },
  realEvent: {
    donkiIds: ['2024-05-11T01:10:00-FLR-001', '2024-05-11T02:10:00-SEP-001'],
    date: '2024-05-11',
    description: {
      en: 'On 11 May 2024 a powerful solar flare erupted at 01:10 UTC. About one hour later the first very energetic protons (>100 MeV) arrived, and over the next hours the SOHO spacecraft measured penetrating protons rising about 25 times. NASA recorded the event in its space-weather database DONKI.',
      az: '11 may 2024-cü ildə saat 01:10-da (UTC) Günəşdə güclü alov baş verdi. Təxminən bir saat sonra ilk çox enerjili protonlar (>100 MeV) gəldi, növbəti saatlarda SOHO kosmik aparatı nüfuzedici protonların təxminən 25 dəfə artdığını ölçdü. NASA bunu kosmik hava bazası DONKI-də qeydə alıb.',
    },
    protonProfile: PROTON_PROFILE,
    stormMinutesPerRealSecond: STORM_MINUTES_PER_REAL_SECOND,
    source: 'NASA CCMC DONKI (timing) + SOHO/EPHIN via NASA SPDF CDAWeb (proton intensity)',
  },
  timeline: { sunBlockedAfterEvaS: 50, sepWarningAfterEvaS: 70 },
  distanceScale: 10,
  // Waypoints in scene metres (x east, z south) on the REAL LOLA terrain. b2 is in REAL terrain shadow at the
  // mission time (ray-marched from the JPL Horizons Sun direction over the LOLA DEM); everything else is sunlit.
  waypoints: [
    { id: 'airlock', x: 0, z: 0, label: { en: 'Airlock (storm shelter)', az: 'Hava kamerası (sığınacaq)' } },
    { id: 'base', x: 0, z: -4, label: { en: 'Outside the hatch', az: 'Lyukun qarşısı' } },
    { id: 'a1', x: 10, z: -12, label: { en: 'Sunlit ridge', az: 'Günəşli silsilə' } },
    {
      id: 'siteA',
      x: 20,
      z: -24,
      siteId: 'siteA',
      label: { en: 'Sample A: ridge rocks (sunny)', az: 'Nümunə A: silsilə daşları (günəşli)' },
    },
    { id: 'b1', x: -16, z: 8, label: { en: 'Down the slope', az: 'Yamacla aşağı' } },
    {
      id: 'b2',
      x: -44,
      z: 30,
      shadowRefuge: true,
      label: { en: 'Real terrain shadow', az: 'Real relyef kölgəsi' },
    },
    {
      id: 'siteB',
      x: -50,
      z: 24,
      siteId: 'siteB',
      label: { en: 'Sample B: shadow edge (colder soil)', az: 'Nümunə B: kölgə kənarı (soyuq torpaq)' },
    },
  ],
  routes: {
    A: ['airlock', 'base', 'a1', 'siteA'],
    B: ['airlock', 'base', 'b1', 'b2', 'siteB'],
  },
};

export const SCENARIOS: Record<string, Scenario> = { [NOBILE_MAY2024.id]: NOBILE_MAY2024 };
