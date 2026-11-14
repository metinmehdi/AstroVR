/**
 * Helmet cam (fallback when the live phone mirror is unavailable): Mission Control renders the same Moon scene locally
 * from the astronaut's head pose (like NASA's science team following the Artemis III VR moonwalk). Fills its container.
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

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const moon = createMoonScene(SCENARIO, 'low');
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 2000);
    const lamp = new THREE.SpotLight(0xfff3dd, 6, 30, 0.55, 0.5, 1.2);
    lamp.target.position.set(0, -0.6, -4);
    camera.add(lamp, lamp.target);
    moon.scene.add(camera);
    // fallback view only: a soft fill light so the projector picture stays readable in deep polar shadow
    const fill = new THREE.HemisphereLight(0xc8d8ff, 0x2a241c, 0.45);
    moon.scene.add(fill);
    const target = new THREE.Vector3();
    const resize = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const timer = new THREE.Timer();
    const q = new THREE.Quaternion();
    renderer.setAnimationLoop((now) => {
      timer.update(now);
      const { state: s } = latest.current;
      const p = poseRef.current;
      const wpId = s.astronaut.waypointId;
      const w = SCENARIO.waypoints.find((x) => x.id === wpId) ?? SCENARIO.waypoints[0];
      target.set(w.x, moon.terrainHeight(w.x, w.z) + 1.65, w.z);
      camera.position.lerp(target, 0.05); // smooth: the phone lopes between waypoints
      if (p) camera.quaternion.slerp(q.set(...p.q), 0.3);
      moon.update(timer.getDelta(), s);
      renderer.render(moon.scene, camera);
    });
    return () => {
      ro.disconnect();
      renderer.setAnimationLoop(null);
      renderer.dispose();
      moon.dispose();
      moon.scene.remove(fill);
      el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="cam-host" />;
}
