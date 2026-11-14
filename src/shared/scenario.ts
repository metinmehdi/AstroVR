import type { Scenario } from './types';

/**
 * Demo scenario: Nobile Rim 1 (Artemis III candidate region) + the real solar storm of 11 May 2024.
 * DONKI records (api.nasa.gov/DONKI/SEP, saved in ../../raw/nasa-data-samples/):
 *   flare 2024-05-11T01:10:00-FLR-001 → SEP 2024-05-11T02:10:00-SEP-001 (GOES-P SEISS >100 MeV)
 *   → the real warning time between flare and >100 MeV protons was ~60 min.
 *   With TIME_COMPRESSION = 60 (1 real s = 1 mission min) that is exactly 60 real seconds in game.
 * Intensity: DONKI does not store flux curves. The normalized profile shape below is simplified;
 * absolute dose is anchored to the Artemis I reference storm (see sim/constants.ts). Shown openly in the Science panel.
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
      en: 'On 11 May 2024 a powerful solar flare erupted at 01:10 UTC. About one hour later, very energetic protons (>100 MeV) reached near-Earth space. NASA recorded it in its space-weather database DONKI.',
      az: '11 may 2024-cü ildə saat 01:10-da (UTC) Günəşdə güclü alov baş verdi. Təxminən bir saat sonra çox enerjili protonlar (>100 MeV) Yer ətrafına çatdı. NASA bunu kosmik hava bazası DONKI-də qeydə alıb.',
    },
    fluxProfile: [
      [0, 0],
      [55, 0],
      [60, 0.15],
      [75, 0.6],
      [90, 1],
      [130, 0.8],
      [180, 0.5],
      [260, 0.25],
    ],
    peakFluxPfu: null, // TODO(P4): fill from GOES >10 MeV record if available
    source: 'NASA CCMC DONKI (FLR + SEP records), api.nasa.gov',
  },
  timeline: { sunBlockedAfterEvaS: 50, sepWarningAfterEvaS: 70 },
  distanceScale: 10,
  waypoints: [
    { id: 'airlock', x: 0, z: 0, label: { en: 'Airlock (storm shelter)', az: 'Hava kamerası (sığınacaq)' } },
    { id: 'base', x: 0, z: -4, label: { en: 'Outside the hatch', az: 'Lyukun qarşısı' } },
    { id: 'a1', x: 8, z: -14, label: { en: 'Sunlit slope', az: 'Günəşli yamac' } },
    {
      id: 'siteA',
      x: 14,
      z: -24,
      siteId: 'siteA',
      label: { en: 'Sample site A: boulder field', az: 'Nümunə A: daş sahəsi' },
    },
    { id: 'b1', x: -9, z: -15, label: { en: 'Crater path', az: 'Krater yolu' } },
    {
      id: 'b2',
      x: -19,
      z: -27,
      shadowRefuge: true,
      label: { en: 'Crater-wall shadow', az: 'Krater divarının kölgəsi' },
    },
    {
      id: 'siteB',
      x: -27,
      z: -38,
      siteId: 'siteB',
      label: { en: 'Sample site B: crater rim', az: 'Nümunə B: krater kənarı' },
    },
  ],
  routes: {
    A: ['airlock', 'base', 'a1', 'siteA'],
    B: ['airlock', 'base', 'b1', 'b2', 'siteB'],
  },
};

export const SCENARIOS: Record<string, Scenario> = { [NOBILE_MAY2024.id]: NOBILE_MAY2024 };
