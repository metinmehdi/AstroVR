/** Room protocol helpers shared by control and astronaut. */

/** Earth–Moon one-way light time ≈ 384,400 km / c ≈ 1.28 s. */
export const COMM_DELAY_MS = 1280;

/** 1 real second = 60 mission seconds → 1 real minute ≈ 1 EVA hour (shown openly in the UI). */
export const TIME_COMPRESSION = 60;

/** How often Control publishes SimState, and the phone publishes its pose. */
export const STATE_PUBLISH_HZ = 4;
export const POSE_PUBLISH_HZ = 10;

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 confusion

export function makeRoomCode(len = 4): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return s;
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** URL the QR code points to (astronaut page). */
export function astronautUrl(origin: string, code: string): string {
  return `${origin}/a.html?room=${encodeURIComponent(code)}`;
}

export function roomFromLocation(loc: Location = window.location): string | null {
  const code = new URLSearchParams(loc.search).get('room');
  return code ? code.toUpperCase() : null;
}

/** Format real seconds as compressed EVA clock "h:mm". */
export function evaClock(realSeconds: number): string {
  const missionMin = Math.floor((realSeconds * TIME_COMPRESSION) / 60);
  const h = Math.floor(missionMin / 60);
  const m = missionMin % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}
