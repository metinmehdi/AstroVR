/**
 * Side-by-side stereo for phone VR boxes (Cardboard style). No WebXR → works on iPhone too.
 * TODO(P2): optional barrel-distortion pass if the box lenses need it; IPD slider in a settings overlay.
 */
import * as THREE from 'three';

export class StereoRenderer {
  readonly stereo = new THREE.StereoCamera();
  enabled = true;

  constructor(
    private renderer: THREE.WebGLRenderer,
    eyeSep = 0.064,
  ) {
    this.stereo.eyeSep = eyeSep;
    this.stereo.aspect = 0.5;
  }

  setEyeSeparation(m: number) {
    this.stereo.eyeSep = m;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setScissorTest(false);
      r.setViewport(0, 0, r.domElement.clientWidth, r.domElement.clientHeight);
      r.render(scene, camera);
      return;
    }
    camera.updateMatrixWorld();
    this.stereo.update(camera);
    const size = r.getSize(new THREE.Vector2());
    const half = size.width / 2;
    r.setScissorTest(true);
    r.setScissor(0, 0, half, size.height);
    r.setViewport(0, 0, half, size.height);
    r.render(scene, this.stereo.cameraL);
    r.setScissor(half, 0, half, size.height);
    r.setViewport(half, 0, half, size.height);
    r.render(scene, this.stereo.cameraR);
    r.setScissorTest(false);
  }
}
