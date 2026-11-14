#!/usr/bin/env node
/**
 * Supabase Realtime smoke test: two clients join the same room channel; one broadcasts, the other must receive.
 *   node --env-file=.env scripts/check-realtime.mjs
 * Prints round-trip latency. Never prints keys.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (run with --env-file=.env)');
  process.exit(1);
}

const room = `astrovr:selftest-${Math.random().toString(36).slice(2, 7)}`;
const mk = () => createClient(url, key, { auth: { persistSession: false } });
const a = mk().channel(room, { config: { broadcast: { self: false } } });
const b = mk().channel(room, { config: { broadcast: { self: false } } });

const subscribed = (ch) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('subscribe timeout')), 15000);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(t);
        res();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(t);
        rej(new Error(status));
      }
    });
  });

const N = 10;
const latencies = [];
const got = new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`only ${latencies.length}/${N} messages received in 20 s`)), 20000);
  b.on('broadcast', { event: 'ping' }, ({ payload }) => {
    latencies.push(Date.now() - payload.sent);
    if (latencies.length === N) {
      clearTimeout(t);
      res();
    }
  });
});

try {
  const t0 = Date.now();
  await Promise.all([subscribed(a), subscribed(b)]);
  console.log(`✓ both clients subscribed in ${Date.now() - t0} ms`);
  for (let i = 0; i < N; i++) {
    await a.send({ type: 'broadcast', event: 'ping', payload: { sent: Date.now(), i } });
    await new Promise((r) => setTimeout(r, 300));
  }
  await got;
  const sorted = [...latencies].sort((x, y) => x - y);
  console.log(`✓ ${N} broadcasts delivered. one-way latency ms: first ${latencies[0]}, median ${sorted[N >> 1]}, max ${sorted[N - 1]}`);
  process.exit(0);
} catch (e) {
  console.error('✗ realtime check failed:', e.message);
  process.exit(2);
}
