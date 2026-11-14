/**
 * Helmet visor overlay: you are INSIDE a spacesuit. Dark rounded edges + a faint gold-tinted reflection at the top
 * (Artemis/Apollo visors have a gold sun-shield layer). Rendered as a quad close to the eyes so both stereo eyes see it.
 */
import * as THREE from 'three';

export function addVisor(camera: THREE.PerspectiveCamera) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d')!;
  // vignette: transparent centre → dark rim
  const rim = g.createRadialGradient(256, 270, 150, 256, 256, 330);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(0.75, 'rgba(0,0,0,0.35)');
  rim.addColorStop(1, 'rgba(0,0,0,0.95)');
  g.fillStyle = rim;
  g.fillRect(0, 0, 512, 512);
  // faint gold reflection arc at the top of the visor
  const refl = g.createLinearGradient(0, 30, 0, 140);
  refl.addColorStop(0, 'rgba(255,200,120,0.10)');
  refl.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = refl;
  g.beginPath();
  g.ellipse(256, 150, 260, 120, 0, Math.PI, 0);
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dist = 0.12;
  // size the quad to cover the field of view at that distance (+ margin)
  const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.25;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(h * Math.max(1, camera.aspect / 2), h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
  );
  mesh.position.z = -dist;
  mesh.renderOrder = 997;
  camera.add(mesh);
  return mesh;
}
