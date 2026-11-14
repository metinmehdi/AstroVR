/**
 * Guidance for the cadet: always know the NEXT step.
 *  - HUD (lazy-follows the head at eye level): 5 phase dots, big icon + instruction, vitals, Mission Control caption
 *  - active target: light beam + ground ring (places) or a pulsing halo (buttons)
 *  - glowing chevron path on the ground toward the next place
 *  - edge arrow when the target is outside the view
 *  - success burst + chime on every completed step
 */
import * as THREE from 'three';
import type { Lang } from '../shared/types';
import type { Objective } from '../shared/objective';

const ACCENT = 0xff7a1a;
const PHASES: Record<Lang, string[]> = {
  en: ['Briefing', 'Prep', 'Surface', 'Decision', 'Debrief'],
  az: ['Brifinq', 'Hazırlıq', 'Səth', 'Qərar', 'Final'],
};

function glow(rgb: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(${rgb},0.9)`);
  grad.addColorStop(0.4, `rgba(${rgb},0.35)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export interface Vitals {
  o2: number;
  dose: number;
  doseBudgetPct: number;
  clock: string;
  storm: boolean;
}

export class Guide {
  private hud = new THREE.Group();
  private hudCanvas = document.createElement('canvas');
  private hudTex: THREE.CanvasTexture;
  private hudMesh: THREE.Mesh;
  private beams: THREE.Group[] = [];
  private halo: THREE.Sprite;
  private chevrons: THREE.InstancedMesh;
  private arrow: THREE.Mesh;
  private burst: THREE.Mesh;
  private burstT = 1;
  private t = 0;
  private objective: Objective | null = null;
  private lang: Lang = 'en';
  private vitals: Vitals = { o2: 100, dose: 0, doseBudgetPct: 0, clock: '0:00', storm: false };
  private caption = '';
  private captionUntil = 0;
  private targets: THREE.Vector3[] = [];
  private moveTarget: THREE.Vector3 | null = null;
  private dirty = true;
  private yaw = NaN;
  private tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private heightAt: (x: number, z: number) => number,
  ) {
    // HUD panel
    this.hudCanvas.width = 1024;
    this.hudCanvas.height = 420;
    this.hudTex = new THREE.CanvasTexture(this.hudCanvas);
    this.hudTex.colorSpace = THREE.SRGBColorSpace;
    this.hudMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.41),
      new THREE.MeshBasicMaterial({ map: this.hudTex, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.hudMesh.renderOrder = 990;
    this.hud.add(this.hudMesh);
    scene.add(this.hud);

    // two beams (route choice shows two places at once)
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 30, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.position.y = 15;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.8, 40),
        new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      g.add(beam, ring);
      g.visible = false;
      scene.add(g);
      this.beams.push(g);
    }
    // halo behind button targets
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow('255,122,26'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.halo.visible = false;
    scene.add(this.halo);

    // chevron path
    const shape = new THREE.Shape();
    shape.moveTo(-0.22, -0.12);
    shape.lineTo(0, 0.12);
    shape.lineTo(0.22, -0.12);
    shape.lineTo(0.22, -0.02);
    shape.lineTo(0, 0.2);
    shape.lineTo(-0.22, -0.02);
    shape.closePath();
    const cg = new THREE.ShapeGeometry(shape);
    cg.rotateX(-Math.PI / 2);
    this.chevrons = new THREE.InstancedMesh(
      cg,
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      24,
    );
    this.chevrons.count = 0;
    this.chevrons.frustumCulled = false;
    scene.add(this.chevrons);

    // edge arrow (camera space)
    const as = new THREE.Shape();
    as.moveTo(0, 0.05);
    as.lineTo(0.035, -0.02);
    as.lineTo(0.012, -0.02);
    as.lineTo(0.012, -0.05);
    as.lineTo(-0.012, -0.05);
    as.lineTo(-0.012, -0.02);
    as.lineTo(-0.035, -0.02);
    as.closePath();
    this.arrow = new THREE.Mesh(
      new THREE.ShapeGeometry(as),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.arrow.renderOrder = 995;
    this.arrow.visible = false;
    camera.add(this.arrow);

    // success burst (camera space ring)
    this.burst = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.036, 48),
      new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0, depthTest: false }),
    );
    this.burst.position.z = -0.9;
    this.burst.renderOrder = 996;
    camera.add(this.burst);
  }

  setLang(lang: Lang) {
    if (lang !== this.lang) {
      this.lang = lang;
      this.dirty = true;
    }
  }

  setObjective(o: Objective, targets: THREE.Object3D[]) {
    const changed = !this.objective || this.objective.id !== o.id || this.objective.targets.join() !== o.targets.join();
    if (changed && this.objective) this.success();
    this.objective = o;
    this.targets = targets.map((t) => t.getWorldPosition(new THREE.Vector3()));
    const places = targets.filter((t) => t.name.startsWith('wp:'));
    this.moveTarget = places.length === 1 ? places[0].getWorldPosition(new THREE.Vector3()) : null;
    // beams on places, halo on a single button
    this.beams.forEach((b, i) => {
      const p = places[i];
      b.visible = Boolean(p);
      if (p) {
        const w = p.getWorldPosition(new THREE.Vector3());
        b.position.set(w.x, this.heightAt(w.x, w.z), w.z);
      }
    });
    const buttons = targets.filter((t) => !t.name.startsWith('wp:'));
    this.halo.visible = buttons.length === 1;
    if (buttons.length === 1) this.halo.position.copy(buttons[0].getWorldPosition(new THREE.Vector3()));
    if (changed) this.dirty = true;
  }

  setVitals(v: Vitals) {
    const k = `${Math.round(v.o2)}|${v.dose.toFixed(2)}|${v.clock}|${v.storm}`;
    const old = `${Math.round(this.vitals.o2)}|${this.vitals.dose.toFixed(2)}|${this.vitals.clock}|${this.vitals.storm}`;
    this.vitals = v;
    if (k !== old) this.dirty = true;
  }

  /** Show what Mission Control just said (subtitles for the radio call). */
  say(text: string) {
    this.caption = text;
    this.captionUntil = performance.now() + 7000;
    this.dirty = true;
  }

  success() {
    this.burstT = 0;
    window.dispatchEvent(new Event('astrovr:step'));
  }

  hideAll() {
    this.beams.forEach((b) => (b.visible = false));
    this.halo.visible = false;
    this.chevrons.count = 0;
    this.arrow.visible = false;
  }

  update(dt: number, moving: boolean) {
    this.t += dt;
    // HUD lazy-follows the head yaw, stays at eye level, a bit above centre
    const camPos = this.camera.getWorldPosition(this.tmp.clone());
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const targetYaw = Math.atan2(dir.x, dir.z);
    if (Number.isNaN(this.yaw)) this.yaw = targetYaw;
    let d = targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 0.35) this.yaw += d * Math.min(1, dt * 2.5); // only re-centre when looking well away
    this.hud.position.set(camPos.x + Math.sin(this.yaw) * 1.7, camPos.y + 0.42, camPos.z + Math.cos(this.yaw) * 1.7);
    this.hud.lookAt(camPos.x, camPos.y + 0.42, camPos.z);
    if (this.caption && performance.now() > this.captionUntil) {
      this.caption = '';
      this.dirty = true;
    }
    if (this.dirty) this.draw();

    // beams pulse
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
    for (const b of this.beams) {
      if (!b.visible) continue;
      ((b.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.25 * pulse;
      b.children[1].rotation.z += dt;
      b.children[1].scale.setScalar(1 + 0.15 * pulse);
    }
    if (this.halo.visible) this.halo.scale.setScalar(1.3 + 0.35 * pulse);

    // chevron path toward a single place
    if (this.moveTarget && !moving) {
      const from = camPos.clone();
      const to = this.moveTarget;
      const len = Math.hypot(to.x - from.x, to.z - from.z);
      const n = Math.min(24, Math.max(3, Math.floor(len / 1.2)));
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-(to.x - from.x), -(to.z - from.z)), 0));
      for (let i = 0; i < n; i++) {
        const u = ((i + ((this.t * 1.5) % 1)) / n) * 0.92 + 0.04;
        const x = from.x + (to.x - from.x) * u;
        const z = from.z + (to.z - from.z) * u;
        m.compose(new THREE.Vector3(x, this.heightAt(x, z) + 0.06, z), q, new THREE.Vector3(1, 1, 1));
        this.chevrons.setMatrixAt(i, m);
      }
      this.chevrons.count = n;
      this.chevrons.instanceMatrix.needsUpdate = true;
    } else this.chevrons.count = 0;

    // "turn your head this way" cue toward the NEAREST target when none is in comfortable view.
    // It slides outward (it is a direction, not a button) and is left/right first (a target behind you is a turn,
    // never "down"), up/down only when the target is ahead but above or below.
    if (this.targets.length && !moving) {
      let best = this.targets[0];
      let bestAng = Infinity;
      let bestLocal = new THREE.Vector3();
      for (const t of this.targets) {
        const l = this.camera.worldToLocal(t.clone());
        const ang = Math.atan2(Math.hypot(l.x, l.y), -l.z);
        if (ang < bestAng) {
          bestAng = ang;
          best = t;
          bestLocal = l;
        }
      }
      const off = bestAng > THREE.MathUtils.degToRad(24);
      this.arrow.visible = off;
      if (off) {
        let dy = Math.atan2(best.x - camPos.x, best.z - camPos.z) - targetYaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        const slide = 0.05 * ((this.t * 1.4) % 1);
        if (Math.abs(dy) > THREE.MathUtils.degToRad(24)) {
          const right = dy < 0;
          this.arrow.position.set((right ? 1 : -1) * (0.17 + slide), 0, -1);
          this.arrow.rotation.z = right ? -Math.PI / 2 : Math.PI / 2;
        } else {
          const up = bestLocal.y > 0;
          this.arrow.position.set(0, (up ? 1 : -1) * (0.15 + slide), -1);
          this.arrow.rotation.z = up ? 0 : Math.PI;
        }
        (this.arrow.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - ((this.t * 1.4) % 1) * 0.6);
      }
    } else this.arrow.visible = false;

    // success burst
    if (this.burstT < 1) {
      this.burstT = Math.min(1, this.burstT + dt * 1.8);
      this.burst.scale.setScalar(1 + this.burstT * 6);
      (this.burst.material as THREE.MeshBasicMaterial).opacity = 1 - this.burstT;
    }
  }

  private draw() {
    this.dirty = false;
    const g = this.hudCanvas.getContext('2d')!;
    const W = this.hudCanvas.width;
    g.clearRect(0, 0, W, this.hudCanvas.height);
    const o = this.objective;
    // card
    g.fillStyle = this.vitals.storm ? 'rgba(60,8,8,0.82)' : 'rgba(4,10,20,0.78)';
    rounded(g, 8, 8, W - 16, 300, 36);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = this.vitals.storm ? '#ff5a4f' : '#ff7a1a';
    g.stroke();
    // phase dots
    const names = PHASES[this.lang];
    const step = o?.phaseStep ?? 0;
    for (let i = 0; i < 5; i++) {
      const x = 120 + i * 196;
      g.beginPath();
      g.arc(x, 48, 13, 0, Math.PI * 2);
      g.fillStyle = i + 1 < step ? '#3ddc84' : i + 1 === step ? '#ff7a1a' : '#33414f';
      g.fill();
      g.fillStyle = i + 1 === step ? '#ffffff' : '#8ea0b5';
      g.font = `${i + 1 === step ? '700 ' : ''}26px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(names[i], x, 92);
    }
    // icon + instruction
    if (o) {
      g.font = '96px "Segoe UI Emoji", "Apple Color Emoji", system-ui';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(o.icon, 40, 192);
      g.fillStyle = '#ffffff';
      g.font = '700 46px system-ui, sans-serif';
      wrap(g, o.astro[this.lang], 170, 170, W - 200, 54, 2);
    }
    // vitals
    g.font = '600 30px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillStyle = '#cfd8e3';
    const v = this.vitals;
    g.fillText(`🫁 ${Math.round(v.o2)}%    ☢️ ${v.dose.toFixed(2)} mGy    ⏱ EVA ${v.clock}`, 40, 268);
    // how to walk (shown whenever the step is "go somewhere" and no radio caption is up)
    if (!this.caption && o && o.targets.some((t) => t.startsWith('wp:'))) {
      g.fillStyle = 'rgba(255,122,26,0.18)';
      rounded(g, 8, 322, W - 16, 90, 24);
      g.fill();
      g.fillStyle = '#ffb27a';
      g.font = '700 32px system-ui, sans-serif';
      g.textAlign = 'left';
      wrap(g, this.lang === 'az' ? '👁 Getmək üçün işıq sütununa və ya yerdəki oxlara 2 saniyə bax' : '👁 To walk, look at the light beam or the arrows on the ground for 2 seconds', 30, 352, W - 60, 36, 2);
    }
    // Mission Control caption
    if (this.caption) {
      g.fillStyle = 'rgba(0,0,0,0.72)';
      rounded(g, 8, 322, W - 16, 90, 24);
      g.fill();
      g.fillStyle = '#ffd27f';
      g.font = '600 32px system-ui, sans-serif';
      wrap(g, `📻 ${this.caption}`, 30, 352, W - 60, 36, 2);
    }
    this.hudTex.needsUpdate = true;
  }
}

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
  const words = text.split(' ');
  let line = '';
  let n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y + n * lh);
      line = w;
      if (++n >= maxLines) return;
    } else line = test;
  }
  if (line && n < maxLines) g.fillText(line, x, y + n * lh);
}
