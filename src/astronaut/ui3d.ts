/** World-space UI for VR: icon buttons (gaze targets) and the wrist panel. Canvas textures, no DOM. */
import * as THREE from 'three';
import { EMOJI, UI, begin, centredLabel, crisp, glassCard, hiCanvas, roundPath } from './text';

export interface Button3D {
  mesh: THREE.Mesh;
  setText(icon: string, label: string, color?: string): void;
}

/** A floating icon button. Size in metres. Always faces the viewer (call faceCamera each frame). */
export function makeButton(icon: string, label: string, color = UI.accent, widthM = 0.9): Button3D {
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
    glassCard(g, 8, 8, 496, 240, 44, col);
    // coloured ring = what kind of target this is (thick enough to read from metres away)
    roundPath(g, 8, 8, 496, 240, 44);
    g.lineWidth = 7;
    g.strokeStyle = col;
    g.stroke();
    // icon in a tinted badge
    g.beginPath();
    g.arc(256, 84, 54, 0, Math.PI * 2);
    g.globalAlpha = 0.22;
    g.fillStyle = col;
    g.fill();
    g.globalAlpha = 1;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = `70px ${EMOJI}`;
    g.fillText(ic, 256, 88);
    g.fillStyle = UI.text;
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
    glassCard(g, 4, 4, 504, 312, 28);
    const bar = (y: number, icon: string, v: number, text: string) => {
      g.font = `40px ${EMOJI}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.fillText(icon, 20, y);
      roundPath(g, 80, y - 14, 300, 28, 14);
      g.fillStyle = UI.track;
      g.fill();
      const c = v > 50 ? UI.ok : v > 20 ? UI.warn : UI.danger;
      const fw = (300 * Math.max(0, Math.min(100, v))) / 100;
      if (fw > 2) {
        roundPath(g, 80, y - 14, Math.max(28, fw), 28, 14);
        g.fillStyle = c;
        g.fill();
      }
      g.fillStyle = UI.text;
      g.font = '700 30px system-ui, sans-serif';
      g.fillText(text, 392, y);
    };
    bar(54, '🫁', o2Pct, `${Math.round(o2Pct)}%`);
    bar(110, '🏠', walkbackPct * 2, walkbackPct >= 0 ? `+${Math.round(walkbackPct)}` : 'NO!');
    bar(166, '☢️', 100 - budgetPct, `${doseMGy.toFixed(2)}`);
    g.fillStyle = UI.muted;
    g.font = '22px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(`${rateMGyH.toFixed(2)} mGy/h`, 492, 198);
    g.fillStyle = 'rgba(157,187,255,0.14)';
    g.fillRect(24, 226, 464, 2);
    g.fillStyle = UI.accentSoft;
    centredLabel(g, task, 256, 268, 484, 34, 26);
    this.tex.needsUpdate = true;
  }
}
