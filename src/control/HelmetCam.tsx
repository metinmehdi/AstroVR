/**
 * Helmet cam: Mission Control sees what the astronaut sees (like NASA's science team following the
 * Artemis III VR moonwalk through headset video). Rendered locally from the astronaut's head pose — no video stream.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createMoonScene } from '../scene/createMoonScene';
import { NOBILE_MAY2024 as SCENARIO } from '../shared/scenario';
import type { AstronautPose, SimState } from '../shared/types';

export function HelmetCam({ poseRef, state }: { poseRef: { current: AstronautPose | null }; state: SimState }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ state });
  latest.current = { state };
  const pose = poseRef.current;

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const moon = createMoonScene(SCENARIO, 'low');
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 2000);
    const lamp = new THREE.SpotLight(0xfff3dd, 6, 30, 0.55, 0.5, 1.2);
    lamp.target.position.set(0, -0.6, -4);
    camera.add(lamp, lamp.target);
    moon.scene.add(camera);
    const target = new THREE.Vector3();
    const resize = () => {
      const w = el.clientWidth;
      renderer.setSize(w, (w * 9) / 16);
      camera.aspect = 16 / 9;
      camera.updateProjectionMatrix();
    };
    resize();
    addEventListener('resize', resize);
    const timer = new THREE.Timer();
    renderer.setAnimationLoop((now) => {
      timer.update(now);
      const { state: s } = latest.current;
      const p = poseRef.current;
      const wpId = s.astronaut.waypointId;
      const w = SCENARIO.waypoints.find((x) => x.id === wpId) ?? SCENARIO.waypoints[0];
      target.set(w.x, moon.terrainHeight(w.x, w.z) + 1.65, w.z);
      camera.position.lerp(target, 0.05); // smooth: the phone lopes between waypoints
      if (p) camera.quaternion.slerp(new THREE.Quaternion(...p.q), 0.3);
      moon.update(timer.getDelta(), s);
      renderer.render(moon.scene, camera);
    });
    return () => {
      removeEventListener('resize', resize);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      moon.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="card cam">
      <div className="card-head">🎥 Helmet cam {pose ? '' : '· waiting for astronaut'}</div>
      <div ref={host} className="cam-host" />
    </div>
  );
}
