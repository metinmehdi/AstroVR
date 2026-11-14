/**
 * One shared clock for the laptop (Mission Control, the time authority) and the phone, so a voice line can start on
 * both devices at the same instant. NTP-style: the phone pings, the laptop answers with its clock; the sample with the
 * smallest round trip gives the offset (error ≤ half the round-trip asymmetry, typically ±10–25 ms over Supabase).
 * Time unit: epoch milliseconds (performance.timeOrigin + performance.now(), monotonic within a page).
 */
import type { Transport } from './transport/types';

export const localNow = () => performance.timeOrigin + performance.now();

let offset = 0; // phone: laptop clock − phone clock
let synced = false;
let authority = false;
const samples: { rtt: number; off: number; at: number }[] = [];

/** shared time (ms): the laptop's clock, on both devices */
export const sharedNow = () => (authority ? localNow() : localNow() + offset);
export const clockSynced = () => authority || synced;

/** Mission Control: answer pings with our clock. */
export function startClockServer(transport: Transport): () => void {
  authority = true;
  return transport.onFast((m) => {
    if (m.k === 'ping') transport.sendFast({ k: 'pong', id: m.id, t0: m.t0, tl: localNow() });
  });
}

/** Phone: measure the offset to the laptop clock (burst at start, then every 2 s). */
export function startClockClient(transport: Transport): () => void {
  let n = 0;
  const ping = () => transport.sendFast({ k: 'ping', id: ++n, t0: localNow() });
  const off = transport.onFast((m) => {
    if (m.k !== 'pong') return;
    const t1 = localNow();
    const rtt = t1 - m.t0;
    if (rtt < 0 || rtt > 3000) return;
    samples.push({ rtt, off: m.tl + rtt / 2 - t1, at: t1 });
    // keep the last 2 minutes; the best (smallest round trip) of the newest 20 wins
    while (samples.length > 40 || (samples.length && t1 - samples[0].at > 120_000)) samples.shift();
    const best = samples.slice(-20).reduce((a, b) => (b.rtt < a.rtt ? b : a));
    offset = best.off;
    synced = true;
  });
  const burst: number[] = [];
  for (let i = 0; i < 8; i++) burst.push(window.setTimeout(ping, 200 + i * 180));
  const timer = window.setInterval(ping, 2000);
  return () => {
    off();
    burst.forEach(clearTimeout);
    clearInterval(timer);
  };
}

/** debugging / tests */
export const clockInfo = () => ({ authority, synced, offset: Math.round(offset), best: samples.length ? Math.round(Math.min(...samples.map((s) => s.rtt))) : null });
