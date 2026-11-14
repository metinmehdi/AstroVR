/**
 * Live mirror: the phone streams its actual WebGL canvas to Mission Control over WebRTC, so the laptop/projector
 * shows EXACTLY what the cadet sees (UI, visor, everything). Signalling rides on the reliable room transport.
 * Mission Control asks ("request") every few seconds until a stream arrives; the phone answers with an offer.
 */
import type { Transport } from './transport';
import type { RtcSignal } from './types';
import { makeId } from './protocol';

const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

function signal(transport: Transport, to: RtcSignal['to'], kind: RtcSignal['kind'], data?: unknown) {
  transport.sendSignal({ id: makeId(), to, kind, data });
}

type CaptureCanvas = HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };
type CanvasTrack = MediaStreamTrack & { requestFrame?: () => void };

/**
 * Phone side: copies ONE eye of the side-by-side stereo canvas into a small canvas (≤540 px high, ≤20 fps) and
 * exposes it as the stream Mission Control receives. Half the pixels of the full stereo frame, so a phone encoder
 * keeps up (sharper picture, no freezes). Call capture() right after rendering, in the same frame, while the WebGL
 * drawing buffer is still valid.
 */
export class MirrorTap {
  readonly canvas = document.createElement('canvas') as CaptureCanvas;
  readonly stream: MediaStream | null = null;
  private g: CanvasRenderingContext2D | null;
  private track: CanvasTrack | null = null;
  private manual = false;
  private last = 0;

  constructor(
    private fps = 20,
    private maxH = 540,
  ) {
    this.canvas.width = 16;
    this.canvas.height = 16;
    this.g = this.canvas.getContext('2d', { alpha: false });
    if (typeof this.canvas.captureStream !== 'function' || !this.g) return;
    // frames on demand (requestFrame) where supported, else a fixed-rate capture
    let stream = this.canvas.captureStream(0);
    let track = stream.getVideoTracks()[0] as CanvasTrack | undefined;
    if (track && typeof track.requestFrame === 'function') this.manual = true;
    else {
      track?.stop();
      stream = this.canvas.captureStream(fps);
      track = stream.getVideoTracks()[0] as CanvasTrack | undefined;
    }
    if (!track) return;
    try {
      track.contentHint = 'motion';
    } catch {
      /* optional */
    }
    this.stream = stream;
    this.track = track;
  }

  capture(src: HTMLCanvasElement, stereo: boolean, now = performance.now()) {
    if (!this.track || !this.g || now - this.last < 1000 / this.fps) return;
    this.last = now;
    const sw = stereo ? Math.floor(src.width / 2) : src.width;
    const sh = src.height;
    if (!sw || !sh) return;
    const h = Math.min(this.maxH, sh) & ~1;
    const w = Math.round(((sw / sh) * h) / 2) * 2;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.g.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
    if (this.manual) this.track.requestFrame?.();
  }
}

/** Hardware-friendly codec order: H.264 (phones have hardware encoders) before VP8/VP9/AV1 (software on many phones). */
function preferH264(tr: RTCRtpTransceiver) {
  const caps = typeof RTCRtpSender.getCapabilities === 'function' ? RTCRtpSender.getCapabilities('video') : null;
  if (!caps || typeof tr.setCodecPreferences !== 'function') return;
  const rank = (c: { mimeType: string; sdpFmtpLine?: string }) => {
    const m = c.mimeType.toLowerCase();
    if (m === 'video/h264') return /42e01f/.test(c.sdpFmtpLine ?? '') && /packetization-mode=1/.test(c.sdpFmtpLine ?? '') ? 0 : 1;
    if (m === 'video/vp8') return 2;
    if (m === 'video/rtx' || m === 'video/red' || m === 'video/ulpfec' || m === 'video/flexfec-03') return 5;
    return 3;
  };
  const sorted = [...caps.codecs].sort((a, b) => rank(a) - rank(b));
  try {
    tr.setCodecPreferences(sorted);
  } catch {
    /* keep the browser default */
  }
}

/** Phone side: stream the mirror (see MirrorTap). Returns a stop function. */
export function startMirrorSender(transport: Transport, stream: MediaStream | null, fps = 20): () => void {
  if (!stream || typeof RTCPeerConnection === 'undefined') return () => {};
  let pc: RTCPeerConnection | null = null;
  let pendingIce: RTCIceCandidateInit[] = [];

  const offer = async () => {
    pc?.close();
    const peer = (pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }));
    pendingIce = [];
    for (const track of stream.getVideoTracks()) {
      const tr = peer.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
      preferH264(tr);
    }
    peer.onicecandidate = (e) => {
      if (e.candidate) signal(transport, 'control', 'ice', e.candidate.toJSON());
    };
    const o = await peer.createOffer();
    await peer.setLocalDescription(o);
    for (const sender of peer.getSenders()) {
      const p = sender.getParameters();
      p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: 2_500_000, maxFramerate: fps, scaleResolutionDownBy: 1 }];
      (p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'maintain-framerate';
      await sender.setParameters(p).catch(() => {});
    }
    signal(transport, 'control', 'offer', { type: o.type, sdp: o.sdp });
  };

  const unsub = transport.onSignal(async (sig) => {
    if (sig.to !== 'astronaut') return;
    try {
      if (sig.kind === 'request') await offer();
      else if (sig.kind === 'answer' && pc && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(sig.data as RTCSessionDescriptionInit);
        for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
        pendingIce = [];
      } else if (sig.kind === 'ice' && pc) {
        if (pc.remoteDescription) await pc.addIceCandidate(sig.data as RTCIceCandidateInit).catch(() => {});
        else pendingIce.push(sig.data as RTCIceCandidateInit);
      }
    } catch (e) {
      console.warn('[mirror sender]', e);
    }
  });
  return () => {
    unsub();
    pc?.close();
  };
}

/** Mission Control side: receive the phone stream. onStream(null) when it drops. Returns a stop function. */
export function startMirrorReceiver(transport: Transport, onStream: (s: MediaStream | null) => void): () => void {
  if (typeof RTCPeerConnection === 'undefined') return () => {};
  let pc: RTCPeerConnection | null = null;
  let live = false;
  let pendingIce: RTCIceCandidateInit[] = [];

  const unsub = transport.onSignal(async (sig) => {
    if (sig.to !== 'control') return;
    try {
      if (sig.kind === 'offer') {
        pc?.close();
        const peer = (pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }));
        (window as unknown as { __astrovrMirrorPc?: RTCPeerConnection }).__astrovrMirrorPc = peer; // diagnostics (getStats)
        peer.ontrack = (e) => {
          live = true;
          onStream(e.streams[0] ?? new MediaStream([e.track]));
        };
        peer.onicecandidate = (e) => {
          if (e.candidate) signal(transport, 'astronaut', 'ice', e.candidate.toJSON());
        };
        peer.onconnectionstatechange = () => {
          if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
            live = false;
            onStream(null);
          }
        };
        await peer.setRemoteDescription(sig.data as RTCSessionDescriptionInit);
        for (const c of pendingIce) await peer.addIceCandidate(c).catch(() => {});
        pendingIce = [];
        const a = await peer.createAnswer();
        await peer.setLocalDescription(a);
        signal(transport, 'astronaut', 'answer', { type: a.type, sdp: a.sdp });
      } else if (sig.kind === 'ice') {
        if (pc?.remoteDescription) await pc.addIceCandidate(sig.data as RTCIceCandidateInit).catch(() => {});
        else pendingIce.push(sig.data as RTCIceCandidateInit);
      }
    } catch (e) {
      console.warn('[mirror receiver]', e);
    }
  });
  const ask = () => {
    if (!live) signal(transport, 'astronaut', 'request');
  };
  ask();
  const timer = setInterval(ask, 7000);
  return () => {
    clearInterval(timer);
    unsub();
    pc?.close();
  };
}
