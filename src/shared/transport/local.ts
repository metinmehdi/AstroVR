import type { ActionEnvelope, AstronautAction, AstronautPose, RadioMessage, RoomMeta, SimState } from '../types';
import { makeId } from '../protocol';
import type { Transport, Unsub } from './types';

type Packet =
  | { t: 'hello' }
  | { t: 'meta'; v: RoomMeta }
  | { t: 'state'; v: SimState }
  | { t: 'pose'; v: AstronautPose }
  | { t: 'action'; v: ActionEnvelope }
  | { t: 'radio'; v: RadioMessage };

/**
 * Same-browser transport (two tabs/windows) for development without Firebase.
 * Not usable across devices — use Firebase for phone ↔ laptop.
 */
export class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  private ch: BroadcastChannel;
  private listeners = new Set<(p: Packet) => void>();
  private lastMeta: RoomMeta | null = null;
  private lastState: SimState | null = null;
  private seen = new Set<string>();

  constructor(readonly code: string) {
    this.ch = new BroadcastChannel(`scvr-${code}`);
    this.ch.onmessage = (e: MessageEvent<Packet>) => this.dispatch(e.data);
    this.ch.postMessage({ t: 'hello' } satisfies Packet);
  }

  private dispatch(p: Packet) {
    if (p.t === 'hello') {
      if (this.lastMeta) this.ch.postMessage({ t: 'meta', v: this.lastMeta } satisfies Packet);
      if (this.lastState) this.ch.postMessage({ t: 'state', v: this.lastState } satisfies Packet);
      return;
    }
    if (p.t === 'meta') this.lastMeta = p.v;
    if (p.t === 'state') this.lastState = p.v;
    if (p.t === 'action' || p.t === 'radio') {
      const id = p.v.id;
      if (this.seen.has(id)) return;
      this.seen.add(id);
    }
    this.listeners.forEach((l) => l(p));
  }

  private on<T extends Packet['t']>(t: T, cb: (v: Extract<Packet, { t: T }>['v']) => void): Unsub {
    const l = (p: Packet) => {
      if (p.t === t) cb((p as Extract<Packet, { t: T }>).v);
    };
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private send(p: Packet) {
    this.ch.postMessage(p);
  }

  async setMeta(meta: RoomMeta) {
    this.lastMeta = meta;
    this.send({ t: 'meta', v: meta });
  }
  onMeta(cb: (meta: RoomMeta | null) => void) {
    if (this.lastMeta) cb(this.lastMeta);
    return this.on('meta', cb);
  }
  publishState(state: SimState) {
    this.lastState = state;
    this.send({ t: 'state', v: state });
  }
  onState(cb: (state: SimState) => void) {
    if (this.lastState) cb(this.lastState);
    return this.on('state', cb);
  }
  publishPose(pose: AstronautPose) {
    this.send({ t: 'pose', v: pose });
  }
  onPose(cb: (pose: AstronautPose) => void) {
    return this.on('pose', cb);
  }
  sendAction(action: AstronautAction) {
    const env: ActionEnvelope = { id: makeId(), ts: Date.now(), action };
    this.seen.add(env.id);
    this.send({ t: 'action', v: env });
  }
  onAction(cb: (env: ActionEnvelope) => void) {
    return this.on('action', cb);
  }
  sendRadio(msg: RadioMessage) {
    this.seen.add(msg.id);
    this.send({ t: 'radio', v: msg });
  }
  onRadio(cb: (msg: RadioMessage) => void) {
    return this.on('radio', cb);
  }
  onConnection(cb: (connected: boolean) => void) {
    cb(true);
    return () => {};
  }
  async resetQueues() {
    this.seen.clear();
  }
  close() {
    this.listeners.clear();
    this.ch.close();
  }
}
