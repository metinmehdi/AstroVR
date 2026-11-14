import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { ActionEnvelope, AstronautAction, AstronautPose, RadioMessage, RoomMeta, SimState } from '../types';
import { makeId } from '../protocol';
import type { Transport, Unsub } from './types';

type EventName = 'hello' | 'meta' | 'state' | 'pose' | 'action' | 'radio' | 'ack';
type Reliable = 'action' | 'radio';

/**
 * One client per transport: realtime-js reuses channels by topic, so a shared client would hand a new transport the
 * old (closing) channel after a React StrictMode remount or reconnect — it then never reaches SUBSCRIBED.
 */
function newClient(): SupabaseClient {
  return createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    // phone sends pose at 10 Hz + actions; control sends state at 4 Hz + meta + radio
    realtime: { params: { eventsPerSecond: 30 } },
  });
}

const RESEND_MS = 1200;
const MAX_TRIES = 25;

/**
 * Supabase Realtime Broadcast transport (no database tables needed), hardened for flaky venue Wi-Fi:
 * - nothing is sent before the channel is SUBSCRIBED (no silent REST fallback); latest-value streams
 *   (meta/state/pose) keep only the newest value and flush on (re)connect
 * - discrete messages (astronaut actions, CAPCOM radio) are RELIABLE: the receiver answers `ack {id}`,
 *   the sender resends until acked (receivers de-duplicate by id)
 * - Control answers a newcomer's `hello` with meta + state at once (late joiners / reconnects)
 */
export class SupabaseTransport implements Transport {
  readonly kind = 'supabase' as const;
  private client = newClient();
  private ch: RealtimeChannel;
  private handlers = new Map<EventName, Set<(payload: unknown) => void>>();
  private connListeners = new Set<(ok: boolean) => void>();
  private connected = false;
  private lastMeta: RoomMeta | null = null;
  private lastState: SimState | null = null;
  private pendingLatest = new Map<'meta' | 'state' | 'pose', unknown>();
  private outbox = new Map<string, { ev: Reliable; payload: { id: string }; tries: number; next: number }>();
  private seen = new Set<string>();
  private timer: ReturnType<typeof setInterval>;

  constructor(readonly code: string) {
    this.ch = this.client.channel(`astrovr:${code}`, { config: { broadcast: { self: false, ack: false } } });
    for (const ev of ['hello', 'meta', 'state', 'pose', 'action', 'radio', 'ack'] as EventName[]) {
      this.ch.on('broadcast', { event: ev }, ({ payload }) => this.dispatch(ev, payload));
    }
    this.ch.subscribe((status) => {
      const ok = status === 'SUBSCRIBED';
      if (ok !== this.connected) {
        this.connected = ok;
        this.connListeners.forEach((l) => l(ok));
      }
      if (ok) {
        this.raw('hello', {});
        for (const [ev, v] of this.pendingLatest) this.raw(ev, v);
        this.pendingLatest.clear();
        this.flushOutbox(true);
      }
    });
    this.timer = setInterval(() => this.flushOutbox(false), 400);
  }

  private dispatch(ev: EventName, payload: unknown) {
    if (ev === 'hello') {
      // only the side that owns meta/state (Control) has something to replay
      if (this.lastMeta) this.raw('meta', this.lastMeta);
      if (this.lastState) this.raw('state', this.lastState);
      return;
    }
    if (ev === 'ack') {
      this.outbox.delete((payload as { id: string }).id);
      return;
    }
    if (ev === 'action' || ev === 'radio') {
      const id = (payload as { id: string }).id;
      this.raw('ack', { id }); // always ack, also duplicates, so the sender stops resending
      if (this.seen.has(id)) return;
      this.seen.add(id);
    }
    this.handlers.get(ev)?.forEach((h) => h(payload));
  }

  private on(ev: EventName, cb: (payload: never) => void): Unsub {
    let set = this.handlers.get(ev);
    if (!set) this.handlers.set(ev, (set = new Set()));
    const h = cb as (payload: unknown) => void;
    set.add(h);
    return () => set!.delete(h);
  }

  /** Send now if connected (WebSocket only). */
  private raw(ev: EventName, payload: unknown) {
    if (!this.connected) return false;
    void this.ch.send({ type: 'broadcast', event: ev, payload });
    return true;
  }

  private latest(ev: 'meta' | 'state' | 'pose', payload: unknown) {
    if (!this.raw(ev, payload)) this.pendingLatest.set(ev, payload);
  }

  private reliable(ev: Reliable, payload: { id: string }) {
    this.outbox.set(payload.id, { ev, payload, tries: 0, next: 0 });
    this.flushOutbox(false);
  }

  private flushOutbox(force: boolean) {
    if (!this.connected) return;
    const now = Date.now();
    for (const [id, m] of this.outbox) {
      if (!force && m.next > now) continue;
      if (m.tries >= MAX_TRIES) {
        this.outbox.delete(id);
        continue;
      }
      m.tries++;
      m.next = now + RESEND_MS;
      this.raw(m.ev, m.payload);
    }
  }

  async setMeta(meta: RoomMeta) {
    this.lastMeta = meta;
    this.latest('meta', meta);
  }
  onMeta(cb: (meta: RoomMeta | null) => void) {
    return this.on('meta', cb);
  }
  publishState(state: SimState) {
    this.lastState = state;
    this.latest('state', state);
    // keep meta flowing for late joiners at a lower rate
    if (this.lastMeta && Math.random() < 0.25) this.raw('meta', this.lastMeta);
  }
  onState(cb: (state: SimState) => void) {
    return this.on('state', cb);
  }
  publishPose(pose: AstronautPose) {
    this.latest('pose', pose);
  }
  onPose(cb: (pose: AstronautPose) => void) {
    return this.on('pose', cb);
  }
  sendAction(action: AstronautAction) {
    const env: ActionEnvelope = { id: makeId(), ts: Date.now(), action };
    this.reliable('action', env);
  }
  onAction(cb: (env: ActionEnvelope) => void) {
    return this.on('action', cb);
  }
  sendRadio(msg: RadioMessage) {
    this.reliable('radio', msg);
  }
  onRadio(cb: (msg: RadioMessage) => void) {
    return this.on('radio', cb);
  }
  onConnection(cb: (connected: boolean) => void) {
    this.connListeners.add(cb);
    cb(this.connected);
    return () => this.connListeners.delete(cb);
  }
  async resetQueues() {
    this.seen.clear();
    this.outbox.clear();
  }
  close() {
    clearInterval(this.timer);
    this.handlers.clear();
    this.connListeners.clear();
    void this.client.removeAllChannels().then(() => this.client.realtime.disconnect());
  }
}
