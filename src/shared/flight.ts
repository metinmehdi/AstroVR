/**
 * Rocket flight to the Moon (story mode): the cadet sits in the capsule on the pad while Mission Control plays the
 * story intro, then lifts off, crosses the 384,400 km to the Moon (3 days compressed) and descends to the outpost.
 * Shared timing so the phone animation and the laptop simulation agree without extra messages.
 */
export const FLIGHT_S = 50; // pad countdown → liftoff → orbit → transit → arrival over the south pole
export const FLIGHT_SHORT_S = 25; // pitch / demo version
export const DESCENT_S = 9; // the existing descent to the airlock (Mission.startIntro)
export const EARTH_MOON_KM = 384_400; // mean distance
export const TRANSIT_DAYS = 3; // like Apollo (about three days)

export function flightTotalS(short: boolean): number {
  return (short ? FLIGHT_SHORT_S : FLIGHT_S) + DESCENT_S;
}
