/**
 * Gaze input for phone VR boxes (no controller): look at a target for FUSE_S seconds to select it.
 * The reticle is a 3D ring parented to the camera, so it renders correctly in both stereo eyes.
 */
import * as THREE from 'three';

export const FUSE_S = 1.5;

export interface GazeTarget {
  object: THREE.Object3D;
  onSelect: () => void;
  /** optional: only selectable while this returns true */
  enabled?: () => boolean;
  /** seconds of steady gaze needed (default FUSE_S); movement uses longer to avoid accidental moves */
  fuse?: number;
  /** custom hover feedback; when set, the object itself is NOT scaled (needed for invisible hit areas) */
  onHover?: (on: boolean) => void;
}

export class Gaze {
  private ray = new THREE.Raycaster();
  private targets = new Map<THREE.Object3D, GazeTarget>();
  private hovered: GazeTarget | null = null;
  private progress = 0;
  private reticle: THREE.Mesh;
  private ring: THREE.Mesh;
  private ringGeo: THREE.RingGeometry;
  private center = new THREE.Vector2(0, 0);
  private cooldown = 0;
  /** when set, only these targets can be selected (e.g. inside the rocket: just the story SKIP button) */
  only: THREE.Object3D[] | null = null;

  /** Ignore gaze for a moment (e.g. right after arriving somewhere) so targets in front do not fire by accident. */
  pause(seconds: number) {
    this.cooldown = Math.max(this.cooldown, seconds);
    this.progress = 0;
  }

  constructor(private camera: THREE.Camera) {
    this.ray.far = 60;
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.008, 0.012, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.reticle.position.z = -1;
    this.reticle.renderOrder = 999;
    this.ringGeo = new THREE.RingGeometry(0.014, 0.02, 32, 1, Math.PI / 2, 0.0001);
    this.ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xa3e635, depthTest: false, transparent: true }),
    );
    this.ring.position.z = -1;
    this.ring.renderOrder = 1000;
    camera.add(this.reticle, this.ring);
  }

  add(target: GazeTarget) {
    this.targets.set(target.object, target);
    return () => this.remove(target.object);
  }

  /** Debug/testing: select a target by its object name (same as a completed gaze). */
  selectByName(name: string): boolean {
    for (const t of this.targets.values()) {
      if (t.object.name === name && t.object.visible && (t.enabled?.() ?? true)) {
        t.onSelect();
        window.dispatchEvent(new Event('astrovr:select'));
        return true;
      }
    }
    return false;
  }

  /** Debug/testing: names of targets that can be selected right now. */
  selectableNames(): string[] {
    return [...this.targets.values()]
      .filter((t) => t.object.visible && (t.enabled?.() ?? true))
      .map((t) => t.object.name);
  }

  remove(object: THREE.Object3D) {
    this.targets.delete(object);
    if (this.hovered?.object === object) this.hovered = null;
  }

  update(dt: number) {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      this.drawRing(0);
      return;
    }
    this.ray.setFromCamera(this.center, this.camera);
    const pool = this.only ? [...this.targets.values()].filter((t) => this.only!.includes(t.object)) : [...this.targets.values()];
    const objects = pool.filter((t) => t.object.visible && (t.enabled?.() ?? true)).map((t) => t.object);
    const hit = this.ray.intersectObjects(objects, true)[0];
    let target: GazeTarget | null = null;
    if (hit) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !this.targets.has(o)) o = o.parent;
      target = o ? (this.targets.get(o) ?? null) : null;
    }
    if (target !== this.hovered) {
      this.setHover(this.hovered, false);
      this.hovered = target;
      this.setHover(target, true);
      this.progress = 0;
    }
    if (this.hovered) {
      this.progress += dt / (this.hovered.fuse ?? FUSE_S);
      if (this.progress >= 1) {
        const t = this.hovered;
        this.progress = 0;
        this.setHover(t, false);
        this.hovered = null;
        t.onSelect();
        window.dispatchEvent(new Event('astrovr:select'));
      }
    }
    this.drawRing(Math.min(this.progress, 1));
  }

  private setHover(t: GazeTarget | null, on: boolean) {
    if (!t) return;
    if (t.onHover) t.onHover(on);
    else t.object.scale.setScalar(on ? 1.15 : 1);
  }

  private drawRing(p: number) {
    this.ring.visible = p > 0.01;
    if (!this.ring.visible) return;
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.RingGeometry(0.014, 0.02, 32, 1, Math.PI / 2, -p * Math.PI * 2);
  }
}
