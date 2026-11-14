/**
 * The astronaut's view of the rocket flight, rendered HERE on the laptop (not streamed): the same capsule scene as
 * the headset (src/astronaut/flight.ts — the real Orion 360° photo, real footage in the windows), on the same shared
 * clock, looking where the cadet looks (head pose from the phone, smoothed). Sharp at any projector size and it never
 * freezes on slow Wi-Fi — only the head direction travels over the network.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SuitAudio } from '../audio/engine';
import { Flight } from '../astronaut/flight';
import { sharedNow } from '../shared/clock';
import type { AstronautPose, Lang, SimState } from '../shared/types';

export function TwinFlight({ state, poseRef, lang }: { state: SimState; poseRef: { current: AstronautPose | null }; lang: Lang }) {
  const host = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    el.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.05, 2000);
    const rig = new THREE.Object3D();
    rig.add(camera);
    const silent = { score: () => null } as unknown as SuitAudio; // the room hears the scheduled sound, not a 2nd engine
    const flight = new Flight(camera, rig, silent, () => langRef.current);
    flight.enterPad();
    const fit = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // ≈90° across, like one eye of the VR box
      camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(1 / camera.aspect)), 58, 84);
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);

    let launchAt: number | null = null;
    let raf = 0;
    let last = performance.now();
    const q = new THREE.Quaternion();
    const loop = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const s = stateRef.current;
      const f = s.flight;
      if (f?.status === 'flying' && !flight.isFlying && !flight.done) {
        launchAt = f.wall ?? sharedNow() - (s.t - f.at) * 1000;
        flight.launch(f.short, Math.max(0, (sharedNow() - launchAt) / 1000), () => {});
      }
      if (launchAt !== null) flight.syncClock((sharedNow() - launchAt) / 1000);
      const p = poseRef.current;
      if (p) camera.quaternion.slerp(q.set(p.q[0], p.q[1], p.q[2], p.q[3]), 1 - Math.exp(-dt * 9));
      flight.update(dt);
      renderer.render(flight.scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      flight.abort();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="ff-twin" />;
}
