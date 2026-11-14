/**
 * Astronaut (phone in VR box). Owner: P2. Skeleton: join room → START (permissions) → stereo Moon scene
 * with gyroscope head tracking → publishes pose, receives SimState + radio.
 * TODO(P2): gaze reticle + 1.5 s fuse, waypoint lope (Apollo-style hops + comfort vignette),
 *           wrist panel (O2, dose clicks, walk-back), checklist + sample interactions, storm choice.
 */
import * as THREE from 'three';
import { createTransport } from '../shared/transport';
import { COMM_DELAY_MS, POSE_PUBLISH_HZ, roomFromLocation } from '../shared/protocol';
import { NOBILE_MAY2024 as SCENARIO } from '../shared/scenario';
import { t } from '../shared/i18n';
import type { Lang, RadioMessage, SimState } from '../shared/types';
import { createMoonScene, type Quality } from '../scene/createMoonScene';
import { HeadTracker, requestOrientationPermission } from './orientation';
import { StereoRenderer } from './stereo';

const EYE_HEIGHT = 1.65;
const params = new URLSearchParams(location.search);
const quality: Quality = params.get('q') === 'high' ? 'high' : 'low';

const overlay = document.getElementById('overlay') as HTMLDivElement;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const info = document.getElementById('info') as HTMLParagraphElement;
const banner = document.getElementById('banner') as HTMLDivElement;

let lang: Lang = 'en';
let state: SimState | null = null;

function applyLang() {
  startBtn.textContent = t(lang, 'astro.start');
  info.textContent = t(lang, 'astro.instructions');
  banner.textContent = t(lang, 'astro.signalLost');
}

async function main() {
  const code = roomFromLocation();
  applyLang();
  if (!code) {
    info.textContent = t(lang, 'astro.noRoom');
    startBtn.hidden = true;
    return;
  }

  const transport = await createTransport(code);
  transport.onMeta((m) => {
    if (m && m.lang !== lang) {
      lang = m.lang;
      applyLang();
    }
  });
  transport.onState((s) => (state = s));
  transport.onConnection((ok) => (banner.hidden = ok));
  // CAPCOM messages arrive after the real Earth–Moon light delay. Audio (P5) listens for this event.
  transport.onRadio((msg: RadioMessage) => {
    if (msg.lost) return;
    setTimeout(() => window.dispatchEvent(new CustomEvent<RadioMessage>('scvr:radio', { detail: msg })), COMM_DELAY_MS);
  });

  // ---- three.js
  const renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 2000);
  const rig = new THREE.Object3D();
  rig.add(camera);
  const moon = createMoonScene(SCENARIO, quality);
  moon.scene.add(rig);

  const placeRig = (waypointId: string) => {
    const w = SCENARIO.waypoints.find((x) => x.id === waypointId) ?? SCENARIO.waypoints[0];
    rig.position.set(w.x, moon.terrainHeight(w.x, w.z) + EYE_HEIGHT, w.z);
  };
  placeRig('airlock');

  const head = new HeadTracker(camera);
  const stereo = new StereoRenderer(renderer);

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  startBtn.onclick = async () => {
    await requestOrientationPermission();
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* iPhone Safari: no element fullscreen — use "Add to Home Screen" */
    }
    try {
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
    } catch {
      /* not supported everywhere */
    }
    try {
      await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock?.request('screen');
    } catch {
      /* optional */
    }
    window.dispatchEvent(new Event('scvr:audio-unlock')); // P5: resume AudioContext here
    overlay.hidden = true;
    setTimeout(() => head.recenter(), 1500); // time to slide the phone into the box
    transport.sendAction({ kind: 'ready' });
  };

  setInterval(() => {
    const q = camera.quaternion;
    transport.publishPose({
      q: [q.x, q.y, q.z, q.w],
      waypointId: state?.astronaut.waypointId ?? 'airlock',
      ts: Date.now(),
    });
  }, 1000 / POSE_PUBLISH_HZ);

  let lastWp = 'airlock';
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    head.update();
    if (state && state.astronaut.waypointId !== lastWp) {
      lastWp = state.astronaut.waypointId;
      placeRig(lastWp); // TODO(P2): animated lope instead of a jump
    }
    moon.update(dt, state);
    stereo.render(moon.scene, camera);
  });
}

void main();
