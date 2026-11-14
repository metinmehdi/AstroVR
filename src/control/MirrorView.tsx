/**
 * Live mirror of the astronaut's phone (WebRTC, see shared/rtc.ts). The phone renders side-by-side stereo, so only the
 * LEFT eye is shown. No stream within 8 s, or the stream drops → the locally rendered 3D helmet cam takes over.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AstronautPose, Lang, SimState } from '../shared/types';
import { HelmetCam } from './HelmetCam';
import { tr } from './strings';

const FALLBACK_AFTER_MS = 8000;

/** true while the stream has a live, unmuted video track */
function useStreamLive(stream: MediaStream | null) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const track = stream?.getVideoTracks()[0];
    if (!track) {
      setLive(false);
      return;
    }
    const update = () => setLive(track.readyState === 'live' && !track.muted);
    update();
    track.addEventListener('mute', update);
    track.addEventListener('unmute', update);
    track.addEventListener('ended', update);
    return () => {
      track.removeEventListener('mute', update);
      track.removeEventListener('unmute', update);
      track.removeEventListener('ended', update);
    };
  }, [stream]);
  return live;
}

function LeftEyeVideo({ stream, backdrop }: { stream: MediaStream; backdrop: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const bg = useRef<HTMLVideoElement>(null);
  const [dim, setDim] = useState({ vw: 0, vh: 0, cw: 0, ch: 0 });

  useEffect(() => {
    for (const v of [vid.current, bg.current]) {
      if (!v) continue;
      v.srcObject = stream;
      void v.play().catch(() => {});
    }
  }, [stream, backdrop]);

  useLayoutEffect(() => {
    const el = box.current!;
    const v = vid.current!;
    const measure = () => setDim({ vw: v.videoWidth, vh: v.videoHeight, cw: el.clientWidth, ch: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    v.addEventListener('loadedmetadata', measure);
    v.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      v.removeEventListener('loadedmetadata', measure);
      v.removeEventListener('resize', measure);
    };
  }, []);

  // contain-fit the left half (one eye) of the side-by-side frame
  const eyeAspect = dim.vw && dim.vh ? dim.vw / 2 / dim.vh : 16 / 9;
  let eyeW = dim.cw;
  let eyeH = dim.cw / eyeAspect;
  if (eyeH > dim.ch) {
    eyeH = dim.ch;
    eyeW = dim.ch * eyeAspect;
  }
  return (
    <div ref={box} className="eye-box">
      {backdrop && <video ref={bg} className="eye-backdrop" autoPlay muted playsInline aria-hidden="true" />}
      <div className="eye" style={{ width: eyeW, height: eyeH, left: (dim.cw - eyeW) / 2, top: (dim.ch - eyeH) / 2 }}>
        <video ref={vid} autoPlay muted playsInline style={{ width: eyeW * 2, height: eyeH, opacity: dim.vw ? 1 : 0 }} />
      </div>
    </div>
  );
}

export function MirrorView({
  stream,
  poseRef,
  state,
  lang,
  broadcast = false,
  children,
}: {
  stream: MediaStream | null;
  poseRef: { current: AstronautPose | null };
  state: SimState;
  lang: Lang;
  broadcast?: boolean;
  children?: ReactNode;
}) {
  const live = useStreamLive(stream);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), FALLBACK_AFTER_MS);
    return () => clearTimeout(id);
  }, []);

  const showVideo = Boolean(stream) && live;
  return (
    <div className={`mirror ${broadcast ? 'mirror-bc' : ''}`}>
      {showVideo ? <LeftEyeVideo stream={stream!} backdrop={broadcast} /> : <HelmetCam poseRef={poseRef} state={state} />}
      <div className="mirror-badges">
        {showVideo ? (
          <span className="badge live">
            <i className="dot" /> {tr(lang, 'mirror.live')}
          </span>
        ) : (
          <span className="badge">{waited ? tr(lang, 'mirror.fallback') : tr(lang, 'mirror.connecting')}</span>
        )}
      </div>
      {children}
    </div>
  );
}
