import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { ActionEnvelope, AstronautAction, AstronautPose, RadioMessage, RoomMeta, SimState } from '../types';
import { makeId } from '../protocol';
import type { Transport, Unsub } from './types';

type EventName = 'hello' | 'meta' | 'state' | 'pose' | 'action' | 'radio';

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  client ??= createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    // phone sends pose at 10 Hz + actions; control sends state at 4 Hz + meta + radio
    realtime: { params: { eventsPerSecond: 25 } },
  });
  return client;
}

/**
 * Supabase Realtime Broadcast transport (no database tables needed).
 * Control re-broadcasts meta + state continuously, and answers a newcomer's `hello` at once,
 * so a phone that (re)connects gets the current mission state immediately.
 */
export class SupabaseTransport implements Transport {
  readonly kind = 'supabase' as const;
  private ch: RealtimeChannel;
  private handlers = new Map<EventName, Set<(payload: unknown) => void>>();
  private connListeners = new Set<(ok: boolean) => void>();
  private connected = false;
  private lastMeta: RoomMeta | null = null;
  private lastState: SimState | null = null;
  private seen = new Set<string>();

  constructor(readonly code: string) {
    this.ch = supabase().channel(`astrovr:${code}`, { config: { broadcast: { self: false, ack: false } } });
    for (const ev of ['hello', 'meta', 'state', 'pose', 'action', 'radio'] as EventName[]) {
      this.ch.on('broadcast', { event: ev }, ({ payload }) => this.dispatch(ev, payload));
    }
    this.ch.subscribe((status) => {
      const ok = status === 'SUBSCRIBED';
      if (ok !== this.connected) {
        this.connected = ok;
        this.connListeners.forEach((l) => l(ok));
      }
      if (ok) this.send('hello', {});
    });
  }

  private dispatch(ev: EventName, payload: unknown) {
    if (ev === 'hello') {
      // only the side that owns meta/state (Control) has something to replay
      if (this.lastMeta) this.send('meta', this.lastMeta);
      if (this.lastState) this.send('state', this.lastState);
      return;
    }
    if (ev === 'action' || ev === 'radio') {
      const id = (payload as { id: string }).id;
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

  private send(ev: EventName, payload: unknown) {
    void this.ch.send({ type: 'broadcast', event: ev, payload });
  }

  async setMeta(meta: RoomMeta) {
    this.lastMeta = meta;
    this.send('meta', meta);
  }
  onMeta(cb: (meta: RoomMeta | null) => void) {
    return this.on('meta', cb);
  }
  publishState(state: SimState) {
    this.lastState = state;
    this.send('state', state);
    // keep meta flowing for late joiners at a lower rate
    if (this.lastMeta && Math.random() < 0.25) this.send('meta', this.lastMeta);
  }
  onState(cb: (state: SimState) => void) {
    return this.on('state', cb);
  }
  publishPose(pose: AstronautPose) {
    this.send('pose', pose);
  }
  onPose(cb: (pose: AstronautPose) => void) {
    return this.on('pose', cb);
  }
  sendAction(action: AstronautAction) {
    const env: ActionEnvelope = { id: makeId(), ts: Date.now(), action };
    this.send('action', env);
  }
  onAction(cb: (env: ActionEnvelope) => void) {
    return this.on('action', cb);
  }
  sendRadio(msg: RadioMessage) {
    this.send('radio', msg);
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
  }
  close() {
    this.handlers.clear();
    this.connListeners.clear();
    void supabase().removeChannel(this.ch);
  }
}
