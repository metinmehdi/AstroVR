/**
 * What the astronaut sees, for the projector. Default: a TWIN of the headset rendered here (twinWorld.ts — same scene,
 * same mission UI, the cadet's head direction): sharp and freeze-free. With ?mirror=video: the old WebRTC video of the
 * phone (shared/rtc.ts), falling back to the local helmet cam when the stream stalls.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AstronautPose, Lang, SimState } from '../shared/types';
import { HelmetCam } from './HelmetCam';
import { attachTwin } from './twinWorld';

export const VIDEO_MIRROR = new URLSearchParams(location.search).get('mirror') === 'video';

/** the headset's view rendered on this laptop */
function TwinView({ state, poseRef, lang }: { state: SimState; poseRef: { current: AstronautPose | null }; lang: Lang }) {
  const el = useRef<HTMLDivElement>(null);
  const s = useRef(state);
  s.current = state;
  const l = useRef(lang);
  l.current = lang;
  useEffect(() => attachTwin(el.current!, { getState: () => s.current, poseRef, getLang: () => l.current }), [poseRef]);
  return <div ref={el} className="twin-host" />;
}
import { tr } from './strings';

const FALLBACK_AFTER_MS = 8000;
/** no new video frame for this long → the phone stopped streaming (locked screen, app in background) */
const STALL_MS = 4000;
/** the 8 s wait counts from the first mount, so switching operator ↔ broadcast does not restart it */
let firstMount = 0;

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

function LeftEyeVideo({ stream, backdrop, onFrames }: { stream: MediaStream; backdrop: boolean; onFrames: (alive: boolean) => void }) {
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

  // frame watchdog: a muted/ended track is not the only way a mirror dies
  useEffect(() => {
    const v = vid.current!;
    let last = performance.now();
    let lastTime = -1;
    let alive = true;
    let handle = 0;
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
    const onFrame = () => {
      last = performance.now();
      handle = rvfc!.call(v, onFrame);
    };
    if (rvfc) handle = rvfc.call(v, onFrame);
    const id = setInterval(() => {
      if (!rvfc && v.currentTime !== lastTime) {
        lastTime = v.currentTime;
        last = performance.now();
      }
      const now = performance.now() - last < STALL_MS;
      if (now !== alive) {
        alive = now;
        onFrames(now);
      }
    }, 1000);
    return () => {
      clearInterval(id);
      const cancel = (v as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }).cancelVideoFrameCallback;
      if (handle && cancel) cancel.call(v, handle);
      onFrames(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

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

  // contain-fit the frame (already one eye)
  const eyeAspect = dim.vw && dim.vh ? dim.vw / dim.vh : 16 / 9;
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
        <video ref={vid} autoPlay muted playsInline style={{ width: eyeW, height: eyeH, opacity: dim.vw ? 1 : 0 }} />
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
  const [frames, setFrames] = useState(true);
  if (!firstMount) firstMount = performance.now();
  const [waited, setWaited] = useState(() => performance.now() - firstMount >= FALLBACK_AFTER_MS);
  useEffect(() => {
    if (waited) return;
    const id = setTimeout(() => setWaited(true), Math.max(0, FALLBACK_AFTER_MS - (performance.now() - firstMount)));
    return () => clearTimeout(id);
  }, [waited]);

  const hasVideo = Boolean(stream) && live;
  const showVideo = hasVideo && frames;
  if (!VIDEO_MIRROR) {
    return (
      <div className={`mirror ${broadcast ? 'mirror-bc' : ''}`}>
        <TwinView state={state} poseRef={poseRef} lang={lang} />
        <div className="mirror-badges">
          <span className="badge live">
            <i className="dot" /> {tr(lang, 'mirror.live')}
          </span>
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className={`mirror ${broadcast ? 'mirror-bc' : ''}`}>
      {/* the video stays mounted while stalled (covered by the 3D view) so recovery is detected */}
      {hasVideo && <LeftEyeVideo stream={stream!} backdrop onFrames={setFrames} />}
      {!showVideo && <HelmetCam poseRef={poseRef} state={state} />}
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
