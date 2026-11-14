/**
 * Simulation constants. Every number has a source or is explicitly marked as a simplification.
 * The Science panel reads SOURCES to show kids/judges where each number comes from.
 * Time: 1 real second = 1 mission minute (TIME_COMPRESSION in shared/protocol.ts).
 * TODO(P4): verify the items marked VERIFY against the cited NASA documents.
 */

// ---------- Power (simplified outpost model; ratios matter more than absolutes) ----------
export const BATTERY_MAX_KWH = 12;
export const BATTERY_START_KWH = 9;
export const SOLAR_LIT_KW = 4.0; // arrays in sunlight
export const SOLAR_BLOCKED_KW = 0.4; // Sun behind the ridge, arrays near the ground
export const SOLAR_VSAT_UP_KW = 3.6; // arrays raised ~10 m on a mast catch the low polar Sun (NASA VSAT rationale)
export const VSAT_RAISE_S = 30; // real seconds (= 30 mission minutes) to raise the mast
export const VSAT_MOTOR_KW = 0.8;
export const LOAD_LIFE_SUPPORT_KW = 2.0; // always on, cannot be switched off
export const LOAD_GREENHOUSE_KW = 1.5;
export const LOAD_SHELTER_KW = 1.2;
export const LOAD_ANTENNA_KW = 0.3;

// ---------- Oxygen / EVA ----------
export const EVA_DESIGN_HOURS = 8; // Artemis-era suits are designed for ~8 h EVAs (VERIFY: Axiom AxEMU spec)
/** % of suit O2 used per real second at rest = 100% over 8 mission hours (480 real s). */
export const O2_PCT_PER_S = 100 / (EVA_DESIGN_HOURS * 60);
export const O2_ACTIVITY_MOVING = 1.4; // loping/walking costs more oxygen than standing
export const O2_ACTIVITY_SAMPLING = 1.2;
export const O2_LEAK_FACTOR = 1.15; // skipped suit check → small undetected leak (training consequence)
export const O2_RESERVE_PCT = 10; // walk-back reserve that must remain on arrival (flight-rule style)
/** Lope speed in mission metres per mission second (Apollo crews moved ~1 m/s in 1/6 g; VERIFY). */
export const LOPE_SPEED_MPS = 1.0;

// ---------- Radiation (simplified) ----------
/** Background galactic cosmic rays on the lunar surface, order of magnitude (VERIFY: LRO CRaTER publications). */
export const GCR_MGY_PER_H = 0.01;
/**
 * Storm dose is COMPUTED from the real measured protons (SOHO/EPHIN 25–53 MeV, see shared/realdata.ts):
 *   dose rate = I(25–53 MeV) [(cm² s sr)⁻¹] × Ω × S × (MeV→J) ÷ (g→kg) × 3600 s/h × 1000 mGy/Gy
 * Ω  = 2π sr: on the surface the Moon itself blocks half of the sky.
 * S  ≈ 16 MeV·cm²/g: proton stopping power in water (tissue) for 25–53 MeV (NIST PSTAR, ~19 at 30 MeV, ~12.5 at 50 MeV).
 * Protons below ~25 MeV are treated as stopped by the suit + body surface (simplification).
 */
export const SOLID_ANGLE_SR = 2 * Math.PI;
export const PROTON_STOPPING_POWER_MEV_CM2_PER_G = 16;
const MEV_TO_J = 1.602e-13;
/** mGy per hour per unit of integral intensity (cm² s sr)⁻¹  ≈ 0.058 */
export const DOSE_MGY_PER_H_PER_INTENSITY =
  (SOLID_ANGLE_SR * PROTON_STOPPING_POWER_MEV_CM2_PER_G * MEV_TO_J * 3600 * 1000) / 1e-3;
/** Arrival = protons rise above this multiple of the pre-warning level. */
export const SEP_ARRIVAL_FACTOR = 3;
/** Artemis I storm shelter vs crew area: 95 / 414 ≈ 0.23 (≈ 4× less). */
export const SHELTER_FACTOR_POWERED = 95 / 414;
/** Habitat walls only (protection system unpowered) — simplification. */
export const SHELTER_FACTOR_UNPOWERED = 0.5;
/** NASA modelling (LRO/CRaTER): inside craters SEP dose is reduced by at least 40%. */
export const SHADOW_FACTOR = 0.6;
export const OPEN_FACTOR = 1.0;
/**
 * Training flight rule for this EVA: return before the EVA dose reaches this value.
 * It follows NASA's ALARA principle (As Low As Reasonably Achievable, NASA-STD-3001) — a conservative
 * mission rule, far below NASA's 30-day limit (250 mGy-Eq, blood-forming organs). With the real
 * 11 May 2024 protons: staying in the open ≈ 1.2 mGy, crater shadow ≈ 0.7 mGy, shelter ≈ 0.3 mGy.
 */
export const MISSION_DOSE_BUDGET_MGY = 0.8;

// ---------- Greenhouse ----------
/** Health loss per real second with grow lights off (plants stress quickly; cf. OSDR OSD-476). */
export const GREENHOUSE_DECAY_PER_S = 0.004;
export const GREENHOUSE_RECOVER_PER_S = 0.001;

// ---------- Phases ----------
export const BRIEFING_S = 35; // narration length; Control can skip
export const SOFT_ABORT_RETURN_S = 6; // announcement before auto-return
export const ABORT_TO_DEBRIEF_S = 8;
export const COPY_WINDOW_S = 15; // astronaut must answer "Copy" within this many real seconds

export const SOURCES = {
  commDelay: 'Earth–Moon light time ≈ 1.28 s (384,400 km ÷ speed of light).',
  shelter: 'Artemis I radiation measurements (Nature, 2024): storm shelter ≈ 4× lower dose than crew area (414 → 95 µGy/min, Oct-1989 storm simulation).',
  shadow: 'Standing low against terrain blocks part of the sky. NASA lunar radiation modelling (LRO/CRaTER): inside craters solar-storm dose is reduced by ≥40%. The shadow spot is a REAL terrain shadow (LOLA + JPL Horizons).',
  vsat: 'NASA Vertical Solar Array Technology (VSAT): ~10 m masts keep arrays in light at the lunar south pole.',
  greenhouse: 'NASA OSDR OSD-476: plants grown in real Apollo lunar soil showed stress responses.',
  storm: 'NASA DONKI: 11 May 2024 flare (01:10 UTC) → >100 MeV protons (02:10 UTC). Proton intensity: SOHO/EPHIN hourly data (NASA SPDF CDAWeb).',
  stormDose: 'Dose computed from the measured protons: intensity × 2π sr × stopping power in water (NIST PSTAR).',
  doseBudget: 'Training flight rule (ALARA, NASA-STD-3001): end the EVA before 0.8 mGy. NASA 30-day limit: 250 mGy-Eq.',
  time: '1 real minute ≈ 1 EVA hour. The storm data is replayed 4× faster than the mission clock. Distances are compressed 10×.',
  sun: 'Sun and Earth positions at the site: NASA JPL Horizons.',
  earth: 'Earth image: NASA EPIC camera on DSCOVR.',
} as const;
