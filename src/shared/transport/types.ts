import type {
  ActionEnvelope,
  AstronautAction,
  AstronautPose,
  FastMsg,
  RadioMessage,
  RoomMeta,
  RtcSignal,
  SimState,
} from '../types';

export type Unsub = () => void;

/**
 * Room transport. Control publishes meta/state/radio; astronaut publishes pose/actions.
 * Queued channels (actions, radio) are de-duplicated by id inside each implementation.
 */
export interface Transport {
  readonly kind: 'local' | 'supabase';
  readonly code: string;

  setMeta(meta: RoomMeta): Promise<void>;
  onMeta(cb: (meta: RoomMeta | null) => void): Unsub;

  publishState(state: SimState): void;
  onState(cb: (state: SimState) => void): Unsub;

  publishPose(pose: AstronautPose): void;
  onPose(cb: (pose: AstronautPose) => void): Unsub;

  sendAction(action: AstronautAction): void;
  onAction(cb: (env: ActionEnvelope) => void): Unsub;

  sendRadio(msg: RadioMessage): void;
  onRadio(cb: (msg: RadioMessage) => void): Unsub;

  /** WebRTC signalling (reliable, de-duplicated by id) */
  sendSignal(sig: RtcSignal): void;
  onSignal(cb: (sig: RtcSignal) => void): Unsub;

  /** fire-and-forget, sent at once (clock sync pings, synchronized voice cues) */
  sendFast(msg: FastMsg): void;
  onFast(cb: (msg: FastMsg) => void): Unsub;

  onConnection(cb: (connected: boolean) => void): Unsub;

  /** Control only: clear queued actions/radio when a new mission starts. */
  resetQueues(): Promise<void>;
  close(): void;
}
