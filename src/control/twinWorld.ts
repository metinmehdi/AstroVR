/**
 * The cadet's Moon view, rendered HERE on the laptop as an exact twin of the headset (same scene, same mission UI:
 * HUD, light beams, buttons, samples, dust, helmet lamp and visor), driven by the laptop's own simulation state and
 * the phone's head direction. Nothing is streamed but the head pose, so the projector picture is sharp and never
 * freezes. One renderer for the whole session (moved between containers), so no WebGL contexts leak.
 */
import * as THREE from 'three';
import { AstronautMission } from '../astronaut/mission';
import { addVisor } from '../astronaut/visor';
import { createMoonScene, type MoonScene } from '../scene/createMoonScene';
import { NOBILE_MAY2024 as SCENARIO } from '../shared/scenario';
import type { Transport } from '../shared/transport/types';
import type { AstronautPose, Lang, SimState } from '../shared/types';

interface Feed {
  getState: () => SimState;
  poseRef: { current: AstronautPose | null };
  getLang: () => Lang;
}

let world: {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  moon: MoonScene;
  mission: AstronautMission;
  lamp: THREE.SpotLight;
} | null = null;
let feed: Feed | null = null;
let host: HTMLElement | null = null;
let raf = 0;
let ro: ResizeObserver | null = null;

/** the spectator never acts: its gaze selects nothing and it sends nothing */
const silentTransport = new Proxy({}, { get: () => () => () => {} }) as unknown as Transport;

function build() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.domElement.className = 'twin-canvas';
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 2000);
  const rig = new THREE.Object3D();
  rig.add(camera);
  const lamp = new THREE.SpotLight(0xfff3dd, 28, 45, 0.78, 0.6, 1); // same helmet lamp as the headset
  lamp.position.set(0, 0.15, 0);
  lamp.target.position.set(0, -1.2, -6);
  camera.add(lamp, lamp.target);
  addVisor(camera);
  const moon = createMoonScene(SCENARIO, 'low');
  moon.scene.add(rig);
  const mission = new AstronautMission({
    scene: moon.scene,
    rig,
    camera,
    scenario: SCENARIO,
    transport: silentTransport,
    terrainHeight: moon.terrainHeight,
    getState: () => feed!.getState(),
    getLang: () => feed!.getLang(),
  });
  world = { renderer, camera, moon, mission, lamp };
}

function fit() {
  if (!world || !host) return;
  const w = Math.max(1, host.clientWidth);
  const h = Math.max(1, host.clientHeight);
  world.renderer.setSize(w, h);
  world.camera.aspect = w / h;
  world.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(1 / world.camera.aspect)), 55, 84);
  world.camera.updateProjectionMatrix();
}

let last = 0;
let prevFlight: string | undefined;
let prevPhase: string | undefined;
const q = new THREE.Quaternion();
function loop(now: number) {
  raf = requestAnimationFrame(loop);
  if (!world || !feed) return;
  const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
  last = now;
  const s = feed.getState();
  const flying = s.flight?.status === 'flying' || s.flight?.status === 'pad';
  // the descent to the airlock, like on the headset: after the flight, or at once when the flight is skipped
  const fs = s.flight?.status;
  if ((prevFlight === 'flying' && fs === 'landed') || (prevPhase === 'lobby' && s.phase === 'briefing' && fs !== 'flying' && fs !== 'pad')) world.mission.startIntro();
  prevFlight = fs;
  prevPhase = s.phase;
  if (flying) return; // the flight has its own twin (TwinFlight)
  const p = feed.poseRef.current;
  if (p) world.camera.quaternion.slerp(q.set(p.q[0], p.q[1], p.q[2], p.q[3]), 1 - Math.exp(-dt * 9));
  world.mission.gazeInput.only = []; // look, never select
  world.moon.update(dt, s);
  world.mission.update(dt);
  world.renderer.render(world.moon.scene, world.camera);
}

/** show the twin inside `el` (the newest caller wins); returns a detach function */
export function attachTwin(el: HTMLElement, f: Feed): () => void {
  feed = f;
  if (!world) build();
  host = el;
  el.appendChild(world!.renderer.domElement);
  ro?.disconnect();
  ro = new ResizeObserver(fit);
  ro.observe(el);
  fit();
  if (!raf) raf = requestAnimationFrame(loop);
  return () => {
    if (host !== el) return;
    ro?.disconnect();
    ro = null;
    host = null;
    world?.renderer.domElement.remove();
    cancelAnimationFrame(raf);
    raf = 0;
  };
}
