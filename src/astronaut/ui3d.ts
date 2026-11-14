/** World-space UI for VR: icon buttons (gaze targets) and the wrist panel. Canvas textures, no DOM. */
import * as THREE from 'three';
import { begin, centredLabel, crisp, hiCanvas } from './text';

export interface Button3D {
  mesh: THREE.Mesh;
  setText(icon: string, label: string, color?: string): void;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A floating icon button. Size in metres. Always faces the viewer (call faceCamera each frame). */
export function makeButton(icon: string, label: string, color = '#ffc847', widthM = 0.9): Button3D {
  const canvas = hiCanvas(512, 256);
  const g = canvas.getContext('2d')!;
  const tex = crisp(new THREE.CanvasTexture(canvas));
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, widthM / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.renderOrder = 10;
  const setText = (ic: string, lb: string, col = color) => {
    begin(g);
    roundRect(g, 8, 8, 496, 240, 48);
    g.fillStyle = 'rgba(5,10,18,0.82)';
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = col;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = '84px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    g.fillText(ic, 256, 84);
    g.fillStyle = '#ffffff';
    centredLabel(g, lb, 256, 186, 468, 58, 40); // big, never squeezed: two lines if needed
    tex.needsUpdate = true;
  };
  setText(icon, label, color);
  return { mesh, setText };
}

export function faceCamera(obj: THREE.Object3D, camera: THREE.Camera) {
  const p = new THREE.Vector3();
  camera.getWorldPosition(p);
  obj.lookAt(p.x, obj.getWorldPosition(new THREE.Vector3()).y, p.z);
}

/** Wrist panel: look down-left to read O2, dose, walk-back margin and the current task. */
export class WristPanel {
  readonly mesh: THREE.Mesh;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;

  constructor(camera: THREE.Camera, parent: THREE.Object3D) {
    const canvas = hiCanvas(512, 320);
    this.g = canvas.getContext('2d')!;
    this.tex = crisp(new THREE.CanvasTexture(canvas));
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.225),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    // attached to the rig (body), not the head: bottom-left, tilted up toward the eyes
    this.mesh.position.set(-0.22, -0.55, -0.42);
    this.mesh.rotation.set(-0.9, 0.35, 0);
    this.mesh.renderOrder = 20;
    parent.add(this.mesh);
    void camera;
  }

  draw(o2Pct: number, walkbackPct: number, doseMGy: number, budgetPct: number, rateMGyH: number, task: string) {
    const g = this.g;
    begin(g);
    roundRect(g, 4, 4, 504, 312, 28);
    g.fillStyle = 'rgba(3,8,14,0.9)';
    g.fill();
    g.strokeStyle = '#2b3a4d';
    g.lineWidth = 6;
    g.stroke();
    const bar = (y: number, icon: string, v: number, text: string) => {
      g.font = '44px system-ui, "Segoe UI Emoji", sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.fillText(icon, 20, y);
      g.fillStyle = '#16212e';
      g.fillRect(80, y - 16, 300, 32);
      const c = v > 50 ? '#3ddc84' : v > 20 ? '#ffc847' : '#ff5a4f';
      g.fillStyle = c;
      g.fillRect(80, y - 16, (300 * Math.max(0, Math.min(100, v))) / 100, 32);
      g.fillStyle = '#e8eef7';
      g.font = '700 30px system-ui, sans-serif';
      g.fillText(text, 392, y);
    };
    bar(54, '🫁', o2Pct, `${Math.round(o2Pct)}%`);
    bar(110, '🏠', walkbackPct * 2, walkbackPct >= 0 ? `+${Math.round(walkbackPct)}` : 'NO!');
    bar(166, '☢️', 100 - budgetPct, `${doseMGy.toFixed(2)}`);
    g.fillStyle = '#8ea0b5';
    g.font = '24px system-ui, sans-serif';
    g.fillText(`${rateMGyH.toFixed(2)} mGy/h`, 392, 196);
    g.fillStyle = '#ffc847';
    centredLabel(g, task, 256, 268, 484, 34, 26);
    this.tex.needsUpdate = true;
  }
}
