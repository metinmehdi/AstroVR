/**
 * Head tracking from the phone gyroscope (DeviceOrientation). Works on Android Chrome and iOS Safari
 * (iOS needs requestPermission() from a user gesture over HTTPS). Desktop fallback: drag the mouse.
 * Math follows the classic three.js DeviceOrientationControls.
 */
import * as THREE from 'three';

type IOSOrientationEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

const ZEE = new THREE.Vector3(0, 0, 1);
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° around X: camera looks out the back of the device

export async function requestOrientationPermission(): Promise<boolean> {
  const DOE = (window as unknown as { DeviceOrientationEvent?: IOSOrientationEvent }).DeviceOrientationEvent;
  if (!DOE) return false;
  if (typeof DOE.requestPermission === 'function') {
    try {
      return (await DOE.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}

export class HeadTracker {
  private alpha = 0;
  private beta = 90;
  private gamma = 0;
  private hasSensor = false;
  private yawOffset = 0;
  private euler = new THREE.Euler();
  private q0 = new THREE.Quaternion();
  // mouse fallback
  private mouseYaw = 0;
  private mousePitch = 0;
  private dragging = false;

  constructor(private camera: THREE.Camera) {
    window.addEventListener('deviceorientation', this.onOrient, true);
    window.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.hasSensor) return;
      this.mouseYaw -= e.movementX * 0.004;
      this.mousePitch = THREE.MathUtils.clamp(this.mousePitch - e.movementY * 0.004, -1.4, 1.4);
    });
  }

  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.alpha === null) return;
    this.hasSensor = true;
    this.alpha = e.alpha;
    this.beta = e.beta ?? 90;
    this.gamma = e.gamma ?? 0;
  };

  /** Make the current heading "forward" (call when the phone goes into the VR box). */
  recenter() {
    this.yawOffset = THREE.MathUtils.degToRad(this.alpha);
  }

  get sensorActive() {
    return this.hasSensor;
  }

  update() {
    if (!this.hasSensor) {
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.mousePitch, this.mouseYaw, 0, 'YXZ'));
      return;
    }
    const orient = THREE.MathUtils.degToRad(screen.orientation?.angle ?? 0);
    const alpha = THREE.MathUtils.degToRad(this.alpha) - this.yawOffset;
    const beta = THREE.MathUtils.degToRad(this.beta);
    const gamma = THREE.MathUtils.degToRad(this.gamma);
    this.euler.set(beta, alpha, -gamma, 'YXZ');
    const q = this.camera.quaternion;
    q.setFromEuler(this.euler);
    q.multiply(Q1);
    q.multiply(this.q0.setFromAxisAngle(ZEE, -orient));
  }

  dispose() {
    window.removeEventListener('deviceorientation', this.onOrient, true);
  }
}
