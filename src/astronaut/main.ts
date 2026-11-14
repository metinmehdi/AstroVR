/**
 * Astronaut (phone in a VR box). Owner: P2.
 * Join room → START (sensors, audio, fullscreen, landscape, wake lock) → stereo Moon scene with gyroscope head
 * tracking → gaze-driven mission (src/astronaut/mission.ts) → publishes pose, receives SimState + radio.
 * Debug on a laptop: open a.html?room=CODE&mono=1 and drag the mouse to look.
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
import { AstronautMission } from './mission';
import { addVisor } from './visor';
import { MirrorTap, startMirrorSender } from '../shared/rtc';

const params = new URLSearchParams(location.search);
const quality: Quality = params.get('q') === 'high' ? 'high' : 'low';

const overlay = document.getElementById('overlay') as HTMLDivElement;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const info = document.getElementById('info') as HTMLParagraphElement;
const banner = document.getElementById('banner') as HTMLDivElement;

let lang: Lang = 'en';
let state: SimState | null = null;

let loaded = false;
function applyLang() {
  // START stays disabled until the transport, scene and handlers are ready (early taps were silently lost)
  startBtn.textContent = loaded ? t(lang, 'astro.start') : '…';
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

  // ---- three.js
  const renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 2000);
  const rig = new THREE.Object3D();
  rig.add(camera);
  // helmet lamp: Artemis suits carry lights for the dark south-pole shadows
  const lamp = new THREE.SpotLight(0xfff3dd, 28, 45, 0.78, 0.6, 1);
  lamp.position.set(0, 0.15, 0);
  lamp.target.position.set(0, -1.2, -6);
  camera.add(lamp, lamp.target);
  if (params.get('visor') !== '0') addVisor(camera);
  const moon = createMoonScene(SCENARIO, quality);
  moon.scene.add(rig);

  const mission = new AstronautMission({
    scene: moon.scene,
    rig,
    camera,
    scenario: SCENARIO,
    transport,
    terrainHeight: moon.terrainHeight,
    getState: () => state,
    getLang: () => lang,
  });

  const head = new HeadTracker(camera);
  if (params.has('debug')) Object.assign(window as object, { astrovr: mission, astrovrHead: head, astrovrRenderer: renderer, astrovrSun: moon.sun });

  transport.onMeta((m) => {
    if (m && m.lang !== lang) {
      lang = m.lang;
      applyLang();
      mission.relabel();
    }
  });
  transport.onState((s) => (state = s));
  transport.onConnection((ok) => (banner.hidden = ok));
  // CAPCOM messages arrive after the real Earth–Moon light delay (1.28 s)
  transport.onRadio((msg: RadioMessage) => {
    if (msg.lost) return;
    setTimeout(() => mission.onRadio(msg), COMM_DELAY_MS);
  });

  const stereo = new StereoRenderer(renderer);
  stereo.enabled = params.get('mono') !== '1';
  const mirrorTap = new MirrorTap(20, 540);

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  startBtn.onclick = async () => {
    mission.audio.unlock(); // must happen inside the tap
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
    overlay.hidden = true;
    setTimeout(() => head.recenter(), 1500); // time to slide the phone into the box
    transport.sendAction({ kind: 'ready' });
    // live mirror: Mission Control sees exactly this canvas (UI, visor, everything)
    startMirrorSender(transport, mirrorTap.stream);
    if (params.get('intro') !== '0') mission.startIntro();
  };
  loaded = true;
  startBtn.disabled = false;
  applyLang();

  setInterval(() => {
    const q = camera.quaternion;
    transport.publishPose({
      q: [q.x, q.y, q.z, q.w],
      waypointId: state?.astronaut.waypointId ?? 'airlock',
      ts: Date.now(),
    });
  }, 1000 / POSE_PUBLISH_HZ);

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.1);
    head.update();
    moon.update(dt, state);
    mission.update(dt);
    stereo.render(moon.scene, camera);
    mirrorTap.capture(renderer.domElement, stereo.enabled, now);
  });
}

void main();
