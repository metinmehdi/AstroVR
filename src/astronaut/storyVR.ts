/**
 * The story intro inside VR: a big cinema screen in front of the capsule window, on the SAME timeline as the
 * projector (Mission Control sends it in SimState.story). Silent on the phone — the room hears the projector.
 * A gaze button SKIP ends the story for everyone (Mission Control then launches the rocket).
 * The 3D shots use pre-rendered stills (shared/storyFrames.ts) so the phone never builds a second 3D world.
 */
import * as THREE from 'three';
import { StoryCanvas, type Timeline } from '../shared/storyFrames';
import type { Lang, SimState } from '../shared/types';
import type { Gaze } from './gaze';
import { makeButton, type Button3D } from './ui3d';

const SEAT_Y = 1.25;
const CW = 768;
const CH = 432;

export class StoryVR {
  readonly group = new THREE.Group();
  private sc = new StoryCanvas(CW, CH, false);
  private tex: THREE.CanvasTexture;
  private screenMat: THREE.MeshBasicMaterial;
  private frameMat: THREE.MeshBasicMaterial;
  private skip: Button3D;
  private current: { id: string; tl: Timeline; t0: number } | null = null;
  private loading: Promise<void> | null = null;
  private acc = 0;
  /** 0..1 how much the cinema is shown (fades) */
  level = 0;

  constructor(
    gaze: Gaze,
    private onSkip: () => void,
    private getLang: () => Lang,
  ) {
    this.tex = new THREE.CanvasTexture(this.sc.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.7), this.screenMat);
    this.frameMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0 });
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(4.92, 2.82), this.frameMat);
    frame.position.z = -0.01;
    const holder = new THREE.Group();
    holder.add(frame, screen);
    holder.position.set(0, SEAT_Y + 0.75, -4.2);
    holder.lookAt(0, SEAT_Y, 0);
    this.group.add(holder);

    // lower-right corner of the screen, above the canopy rim so the label is never hidden
    this.skip = makeButton('⏭', 'SKIP', '#ff7a1a', 0.9);
    this.skip.mesh.position.set(0.95, SEAT_Y - 0.4, -2.6); // between the canopy struts
    this.skip.mesh.lookAt(0, SEAT_Y, 0);
    this.skip.mesh.name = 'story:skip';
    this.group.add(this.skip.mesh);
    gaze.add({
      object: this.skip.mesh,
      onSelect: () => {
        this.current = null; // hide at once; Mission Control ends the projector story and launches
        this.onSkip();
      },
      enabled: () => this.current !== null && this.level > 0.5,
      fuse: 1.5,
    });
    this.group.visible = false;
  }

  get targets(): THREE.Object3D[] {
    return [this.skip.mesh];
  }

  get playing() {
    return this.current !== null;
  }

  /** Follow Mission Control's story (call every frame with the latest state). */
  sync(story: SimState['story']) {
    if (!story) {
      this.current = null;
      return;
    }
    if (this.current?.id === story.id) return;
    const total = story.starts.length ? story.starts[story.starts.length - 1] + story.durs[story.durs.length - 1] : 0;
    // the state arrives a few hundred ms after the projector started
    this.current = { id: story.id, tl: { starts: story.starts, durs: story.durs, total }, t0: performance.now() - 300 };
    if (!this.loading) this.loading = this.sc.load(true);
    const lang = this.getLang();
    this.skip.setText('⏭', lang === 'az' ? 'KEÇ' : 'SKIP');
  }

  update(dt: number) {
    const target = this.current ? 1 : 0;
    this.level += Math.sign(target - this.level) * Math.min(Math.abs(target - this.level), dt * 2);
    this.group.visible = this.level > 0.01;
    this.screenMat.opacity = this.level;
    this.frameMat.opacity = 0.7 * this.level;
    this.skip.mesh.visible = this.level > 0.5 && this.current !== null;
    if (!this.current) return;
    this.acc += dt;
    if (this.acc < 1 / 24) return; // ~24 fps texture updates are plenty and cheap
    this.acc = 0;
    const el = (performance.now() - this.current.t0) / 1000;
    this.sc.frame(Math.min(el, this.current.tl.total), this.current.tl, this.getLang());
    this.tex.needsUpdate = true;
  }
}
