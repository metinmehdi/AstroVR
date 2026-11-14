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

/** Phone side: stream the renderer canvas. Returns a stop function. */
export function startMirrorSender(transport: Transport, canvas: HTMLCanvasElement, fps = 24): () => void {
  const capture = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream;
  if (typeof capture !== 'function' || typeof RTCPeerConnection === 'undefined') return () => {};
  const stream = capture.call(canvas, fps);
  let pc: RTCPeerConnection | null = null;
  let pendingIce: RTCIceCandidateInit[] = [];

  const offer = async () => {
    pc?.close();
    const peer = (pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }));
    pendingIce = [];
    for (const track of stream.getTracks()) peer.addTrack(track, stream);
    peer.onicecandidate = (e) => {
      if (e.candidate) signal(transport, 'control', 'ice', e.candidate.toJSON());
    };
    const o = await peer.createOffer();
    await peer.setLocalDescription(o);
    for (const sender of peer.getSenders()) {
      const p = sender.getParameters();
      p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: 1_500_000, maxFramerate: fps, scaleResolutionDownBy: 1.5 }];
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
    stream.getTracks().forEach((t) => t.stop());
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
