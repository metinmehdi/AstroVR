/**
 * Moon Base Radio — one push-to-talk Gemini Live session, straight from the
 * browser with an ephemeral token (no relay server).
 *
 * Adapted from TeatrAi apps/stage/lib/liveSession.ts, keeping its measured
 * wire facts:
 *   - the token only opens the `...Constrained` socket (`?access_token=`)
 *   - mic audio is `realtimeInput.audio`; the transcript is
 *     `serverContent.outputTranscription.text`
 *   - `realtimeInputConfig` and `sessionResumption` go in the CLIENT setup
 *     frame (locked in the token they silently override ours)
 *   - with VAD disabled the model answers ~0.8 s after `activityEnd`
 *
 * Push-to-talk is HALF duplex, so the echo detector is gone: the moment the
 * button goes down the player is silenced and the server is told a new
 * activity started (START_OF_ACTIVITY_INTERRUPTS).
 *
 * The light delay: the answer is held until 2.56 s after key-up (1.28 s to the
 * Moon + 1.28 s back). The model's own latency hides inside that window, and
 * the buffer it builds swallows network jitter (TeatrAi M2: most audible gaps
 * were in a turn's first second).
 */

import type { Lang } from '../shared/types';

const WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const MIC_RATE = 16000;
const OUT_RATE = 24000;
export const LIGHT_DELAY_MS = 1280;
/** A tap shorter than this is a slip of the finger, not a transmission. */
const MIN_HOLD_MS = 250;
/** Stuck finger guard. */
const MAX_HOLD_MS = 30000;
/** No audio this long after the answer was due → "say again". */
const NO_ANSWER_MS = 7000;
/** A turn cut by key-down that the server never closes must not mute the commander forever. */
const DISCARD_WATCHDOG_MS = 6000;
const QUINDAR_DOWN = 2525;
const QUINDAR_UP = 2475;

export type RadioPhase =
  | 'off' // not armed yet
  | 'connecting'
  | 'ready'
  | 'talking' // button down, mic streaming
  | 'uplink' // key-up → signal travelling to the Moon
  | 'downlink' // answer travelling back / being generated
  | 'receiving' // commander's voice playing
  | 'nosignal'
  | 'error';

export interface RadioEvents {
  phase(p: RadioPhase, detail?: string): void;
  /** the child's words as the model heard them (fragments of the current transmission) */
  userText(fragment: string): void;
  /** commander's words, released roughly in step with the voice */
  novaText(fragment: string): void;
  /** commander's turn is over */
  turnDone(): void;
  micLevel(peak: number): void;
  outLevel(peak: number): void;
  /** delay countdown for the UI: when (performance.now ms) the uplink / downlink legs end */
  legs(uplinkEndsAt: number, downlinkEndsAt: number): void;
}

export interface RadioOptions {
  lang: Lang;
  name?: string;
  /** one-way light delay in ms (0 = off) */
  delayMs: number;
  fx: boolean;
}

export class LiveRadio {
  private ctx: AudioContext | null = null;
  private player: AudioWorkletNode | null = null;
  private recorder: AudioWorkletNode | null = null;
  private micStream: MediaStream | null = null;
  private ws: WebSocket | null = null;
  private handle: string | null = null;
  private keyIndex = 1;
  private keyCount = 1;
  private retries = 0;
  private disposed = false;
  private connecting = false;

  private pressed = false;
  private pressAt = 0;
  private activityOpen = false;
  private preroll: ArrayBuffer[] = [];
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private maxHoldTimer: ReturnType<typeof setTimeout> | null = null;

  /** The model is still streaming the current answer (no turnComplete/interrupted yet). */
  private turnOpen = false;
  /** Drop the rest of an answer that key-down cut off, until the server closes it. */
  private discarding = false;
  private discardTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingAnswer = false;
  private noAnswerTimer: ReturnType<typeof setTimeout> | null = null;

  /** context time when everything queued so far will have played */
  private queuedEnd = 0;
  private holdUntil = 0;
  private textTimers = new Set<ReturnType<typeof setTimeout>>();
  private playerOpen = false;
  private phaseNow: RadioPhase = 'off';
  private lastNote = '';

  constructor(
    private opts: RadioOptions,
    private ev: RadioEvents,
    private getNote: () => string | null = () => null,
  ) {}

  get phase(): RadioPhase {
    return this.phaseNow;
  }

  private setPhase(p: RadioPhase, detail?: string) {
    this.phaseNow = p;
    this.ev.phase(p, detail);
  }

  /** Must run inside a user gesture: audio unlock + mic permission + worklets. */
  async arm(): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    for (const f of ['radio-player.js', 'ptt-recorder.js']) {
      try {
        await ctx.audioWorklet.addModule(`/worklets/${f}`);
      } catch (e) {
        throw new Error(`worklets/${f}: ${(e as Error).message}`);
      }
    }

    this.player = new AudioWorkletNode(ctx, 'radio-player', { outputChannelCount: [2] });
    this.player.port.postMessage({ fx: this.opts.fx });
    this.player.port.onmessage = (e) => {
      const d = e.data;
      if (typeof d?.level === 'number') this.ev.outLevel(d.level);
      if (typeof d?.open === 'boolean' && d.open !== this.playerOpen) {
        this.playerOpen = d.open;
        if (d.open) {
          this.clearNoAnswer();
          this.awaitingAnswer = false;
          if (!this.pressed) this.setPhase('receiving');
        } else if (!this.pressed && !this.awaitingAnswer && this.phaseNow === 'receiving') {
          this.setPhase('ready');
          this.ev.turnDone();
        }
      }
    };
    this.player.connect(ctx.destination);

    // PTT is half duplex: no echo canceller needed. Leaving AEC off also keeps
    // Android Chrome out of "call mode", so the commander plays at media volume.
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    const src = ctx.createMediaStreamSource(this.micStream);
    this.recorder = new AudioWorkletNode(ctx, 'ptt-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      processorOptions: { targetRate: MIC_RATE },
    });
    this.recorder.port.onmessage = (e) => this.onMicChunk(e.data);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    src.connect(this.recorder);
    this.recorder.connect(sink).connect(ctx.destination);
  }

  async connect(): Promise<void> {
    if (this.disposed || this.connecting) return;
    this.connecting = true;
    this.setPhase('connecting');
    try {
      const q = new URLSearchParams({ lang: this.opts.lang, key: String(this.keyIndex) });
      if (this.opts.name) q.set('name', this.opts.name);
      const res = await fetch(`/api/live-token?${q}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; keys?: number };
      if (body.keys) this.keyCount = body.keys;
      if (!res.ok || !body.token) throw new Error(body.error || `token HTTP ${res.status}`);
      this.openSocket(body.token);
    } catch (e) {
      this.connecting = false;
      this.retryLater((e as Error).message, true);
    }
  }

  private openSocket(token: string) {
    const ws = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(token)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          setup: {
            realtimeInputConfig: {
              automaticActivityDetection: { disabled: true },
              activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
            },
            sessionResumption: this.handle ? { handle: this.handle } : {},
          },
        }),
      );
    };
    ws.onmessage = (e) => this.onMessage(e);
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connecting = false;
      this.activityOpen = false;
      if (this.disposed) return;
      const reason = `${e.code}${e.reason ? ' ' + e.reason : ''}`;
      // Quota / refused session → next key, fresh session (a handle is bound to its project).
      if (e.code === 1011 || /quota|exhaust|limit|429/i.test(e.reason)) {
        this.keyIndex = (this.keyIndex % Math.max(1, this.keyCount)) + 1;
        this.handle = null;
        this.retryLater(reason, true);
      } else {
        this.retryLater(reason, false);
      }
    };
  }

  private retryLater(reason: string, countIt: boolean) {
    if (this.disposed) return;
    if (countIt) this.retries++;
    if (this.retries > Math.max(4, this.keyCount * 2)) {
      this.setPhase('error', reason);
      return;
    }
    this.setPhase('connecting', reason);
    setTimeout(() => void this.connect(), Math.min(4000, 400 * 2 ** Math.min(this.retries, 3)));
  }

  /** Manual retry from the UI after 'error'. */
  retry() {
    this.retries = 0;
    void this.connect();
  }

  private send(obj: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  private onMessage(ev: MessageEvent) {
    const raw = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.setupComplete) {
      this.connecting = false;
      this.retries = 0;
      if (!this.pressed && !this.awaitingAnswer && !this.playerOpen) this.setPhase('ready');
      return;
    }
    if (msg.sessionResumptionUpdate?.newHandle) this.handle = msg.sessionResumptionUpdate.newHandle;
    if (msg.goAway) {
      // ~10 min connection ceiling: reconnect on a new token, resuming the conversation.
      if (!this.pressed && !this.turnOpen) this.reconnectNow();
      else setTimeout(() => this.reconnectNow(), 4000);
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.inputTranscription?.text) this.ev.userText(sc.inputTranscription.text);

    if (sc.interrupted) {
      this.turnOpen = false;
      this.endDiscard();
      return;
    }
    if (this.discarding) {
      if (sc.turnComplete) {
        this.turnOpen = false;
        this.endDiscard();
      }
      return;
    }

    const ctx = this.ctx;
    for (const part of sc.modelTurn?.parts ?? []) {
      const b64 = part.inlineData?.data;
      if (!b64 || !ctx || !this.player) continue;
      const pcm = base64ToInt16(b64);
      if (!pcm) continue;
      this.turnOpen = true;
      const startAt = Math.max(ctx.currentTime, this.holdUntil, this.queuedEnd);
      this.queuedEnd = startAt + pcm.length / OUT_RATE;
      this.player.port.postMessage({ pcm: pcm.buffer }, [pcm.buffer]);
    }

    const text = sc.outputTranscription?.text;
    if (text && ctx) {
      // Release words about when the voice says them: the audio arrives ~3× faster than it plays.
      const at = Math.max(ctx.currentTime, this.holdUntil, this.queuedEnd - 1.2);
      this.later((at - ctx.currentTime) * 1000, () => this.ev.novaText(text));
    }

    if (sc.turnComplete) {
      this.turnOpen = false;
      this.player?.port.postMessage({ turnEnd: true });
      if (this.awaitingAnswer && this.queuedEnd === 0) {
        // The model closed the turn without a word (proactive audio can do that).
        this.clearNoAnswer();
        this.awaitingAnswer = false;
        this.setPhase('nosignal');
      }
    }
  }

  private later(ms: number, fn: () => void) {
    if (ms < 30) return fn();
    const t = setTimeout(() => {
      this.textTimers.delete(t);
      fn();
    }, ms);
    this.textTimers.add(t);
  }

  private reconnectNow() {
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      try {
        old.close();
      } catch {
        /* closing */
      }
    }
    this.connecting = false;
    void this.connect();
  }

  /* ───────────────────────── push-to-talk ───────────────────────── */

  pressStart() {
    if (!this.ctx || !this.player || this.pressed) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.pressed = true;
    this.pressAt = performance.now();
    this.preroll = [];
    this.clearNoAnswer();
    this.awaitingAnswer = false;

    // Key-down: Quindar tone, and the commander stops talking at once.
    this.player.port.postMessage({ clear: true });
    this.player.port.postMessage({ beep: QUINDAR_DOWN });
    this.clearText();
    this.queuedEnd = 0;
    this.holdUntil = 0;
    if (this.turnOpen) this.startDiscard();
    this.setPhase('talking');

    // Only a real hold becomes a transmission (accidental taps are dropped).
    this.holdTimer = setTimeout(() => this.openActivity(), MIN_HOLD_MS);
    this.maxHoldTimer = setTimeout(() => this.pressEnd(), MAX_HOLD_MS);
  }

  private openActivity() {
    this.holdTimer = null;
    if (!this.pressed) return;
    const note = this.getNote();
    if (note && note !== this.lastNote && this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: note }] }], turnComplete: false } })) {
      this.lastNote = note;
    }
    if (!this.send({ realtimeInput: { activityStart: {} } })) return;
    this.activityOpen = true;
    for (const buf of this.preroll) this.sendPcm(buf);
    this.preroll = [];
  }

  pressEnd() {
    if (!this.pressed) return;
    this.pressed = false;
    if (this.holdTimer) clearTimeout(this.holdTimer);
    if (this.maxHoldTimer) clearTimeout(this.maxHoldTimer);
    this.holdTimer = this.maxHoldTimer = null;
    this.player?.port.postMessage({ beep: QUINDAR_UP });
    this.preroll = [];

    if (!this.activityOpen) {
      // A slip of the finger: nothing was sent.
      this.setPhase(this.ws ? 'ready' : 'connecting');
      return;
    }
    this.activityOpen = false;
    this.send({ realtimeInput: { activityEnd: {} } });

    const ctx = this.ctx!;
    const oneWay = this.opts.delayMs;
    this.holdUntil = ctx.currentTime + (2 * oneWay) / 1000;
    this.player?.port.postMessage({ holdUntil: this.holdUntil });
    const now = performance.now();
    this.ev.legs(now + oneWay, now + 2 * oneWay);
    this.awaitingAnswer = true;
    this.setPhase(oneWay > 0 ? 'uplink' : 'downlink');
    if (oneWay > 0) {
      setTimeout(() => {
        if (this.awaitingAnswer && !this.pressed && this.phaseNow === 'uplink') this.setPhase('downlink');
      }, oneWay);
    }
    this.noAnswerTimer = setTimeout(() => {
      if (!this.awaitingAnswer || this.pressed) return;
      this.awaitingAnswer = false;
      this.player?.port.postMessage({ clear: true });
      this.setPhase('nosignal');
    }, 2 * oneWay + NO_ANSWER_MS);
  }

  private onMicChunk(d: { pcm?: ArrayBuffer; peak?: number }) {
    if (typeof d?.peak === 'number' && this.pressed) this.ev.micLevel(d.peak);
    if (!d?.pcm || !this.pressed) return;
    if (this.activityOpen) this.sendPcm(d.pcm);
    else if (performance.now() - this.pressAt < MIN_HOLD_MS + 200) this.preroll.push(d.pcm);
  }

  private sendPcm(buf: ArrayBuffer) {
    this.send({ realtimeInput: { audio: { data: int16ToBase64(new Int16Array(buf)), mimeType: `audio/pcm;rate=${MIC_RATE}` } } });
  }

  private startDiscard() {
    this.discarding = true;
    if (this.discardTimer) clearTimeout(this.discardTimer);
    this.discardTimer = setTimeout(() => {
      this.discarding = false;
      this.turnOpen = false;
    }, DISCARD_WATCHDOG_MS);
  }

  private endDiscard() {
    this.discarding = false;
    if (this.discardTimer) clearTimeout(this.discardTimer);
    this.discardTimer = null;
  }

  private clearNoAnswer() {
    if (this.noAnswerTimer) clearTimeout(this.noAnswerTimer);
    this.noAnswerTimer = null;
  }

  private clearText() {
    for (const t of this.textTimers) clearTimeout(t);
    this.textTimers.clear();
  }

  /* ───────────────────────── settings ───────────────────────── */

  setFx(on: boolean) {
    this.opts.fx = on;
    this.player?.port.postMessage({ fx: on });
  }

  setDelay(ms: number) {
    this.opts.delayMs = ms;
  }

  /** New language or name → new persona → new token (conversation restarts). */
  restart(next: Partial<Pick<RadioOptions, 'lang' | 'name'>>) {
    Object.assign(this.opts, next);
    this.handle = null;
    this.lastNote = '';
    this.reconnectNow();
  }

  dispose() {
    this.disposed = true;
    this.clearText();
    this.clearNoAnswer();
    try {
      this.ws?.close();
    } catch {
      /* closing */
    }
    this.ws = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
  }
}

function base64ToInt16(b64: string): Int16Array | null {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  const n = bin.length - (bin.length % 2);
  if (n <= 0) return null;
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
