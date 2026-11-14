/**
 * Side-by-side stereo for phone VR boxes (Cardboard style). No WebXR → works on iPhone too.
 * Built for the optics of a VR box:
 *  - each eye's optical centre sits under its LENS (lens distance in mm, adjustable on the start screen), not at the
 *    middle of its half of the screen → no double images / eye strain on wide phones
 *  - parallel eye cameras (no convergence point) with a child-sized eye separation → objects at infinity line up
 */
import * as THREE from 'three';

const MM_PER_CSS_PX = 0.17; // typical phone (≈150 CSS px per inch); the lens setting absorbs the rest

export class StereoRenderer {
  enabled = true;
  /** distance between the two lens centres of the box (mm) */
  lensMm = 62;
  /** virtual eye separation (m) — a child's IPD */
  eyeSep = 0.058;
  private camL = new THREE.PerspectiveCamera();
  private camR = new THREE.PerspectiveCamera();
  private size = new THREE.Vector2();

  constructor(private renderer: THREE.WebGLRenderer) {
    for (const c of [this.camL, this.camR]) {
      c.matrixAutoUpdate = false;
      c.matrixWorldAutoUpdate = false; // we set matrixWorld from the head camera every frame
    }
  }

  setEyeSeparation(m: number) {
    this.eyeSep = m;
  }

  /** eye camera with an off-axis frustum whose axis is shifted by `shift` (NDC units, + = right) */
  private eye(cam: THREE.PerspectiveCamera, src: THREE.PerspectiveCamera, side: -1 | 1, aspect: number, shift: number) {
    cam.matrixWorld.copy(src.matrixWorld);
    cam.matrixWorld.multiply(new THREE.Matrix4().makeTranslation((side * this.eyeSep) / 2, 0, 0));
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const n = src.near;
    const top = n * Math.tan(THREE.MathUtils.degToRad(src.fov / 2));
    const hw = top * aspect;
    cam.projectionMatrix.makePerspective(-hw * (1 + shift), hw * (1 - shift), top, -top, n, src.far);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.near = n;
    cam.far = src.far;
    cam.layers.mask = src.layers.mask;
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
    r.getSize(this.size);
    const W = this.size.width;
    const H = this.size.height;
    const half = W / 2;
    // lens centre inside each half: (W/2 − lens/2) from the outer edge; shift relative to the half's middle
    const lensPx = this.lensMm / MM_PER_CSS_PX;
    const shift = THREE.MathUtils.clamp((half / 2 - lensPx / 2) / (half / 2), -0.6, 0.6);
    const aspect = half / H;
    this.eye(this.camL, camera, -1, aspect, shift); // left eye: axis moves right, toward the screen centre
    this.eye(this.camR, camera, 1, aspect, -shift);
    r.setScissorTest(true);
    r.setScissor(0, 0, half, H);
    r.setViewport(0, 0, half, H);
    r.render(scene, this.camL);
    r.setScissor(half, 0, half, H);
    r.setViewport(half, 0, half, H);
    r.render(scene, this.camR);
    r.setScissorTest(false);
  }
}
