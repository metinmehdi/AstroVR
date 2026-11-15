/**
 * Guidance for the cadet: always know the NEXT step.
 *  - HUD (lazy-follows the head at eye level): 5 phase dots, big icon + instruction, vitals, Mission Control caption
 *  - active target: light beam + ground ring (places) or a pulsing halo (buttons)
 *  - glowing chevron path on the ground toward the next place
 *  - edge arrow when the target is outside the view
 *  - success burst + chime on every completed step
 */
import * as THREE from 'three';
import { EMOJI, TEXT_SCALE, UI, begin, crisp, glassCard, roundPath, wrapLines } from './text';
import type { Lang } from '../shared/types';
import type { Objective } from '../shared/objective';

const ACCENT = 0x4d84ff; // dashboard blue
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
    this.hudCanvas.width = 1024 * TEXT_SCALE;
    this.hudCanvas.height = 420 * TEXT_SCALE;
    this.hudTex = crisp(new THREE.CanvasTexture(this.hudCanvas));
    this.hudMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.25, 0.5125),
      new THREE.MeshBasicMaterial({ map: this.hudTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
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
      new THREE.SpriteMaterial({ map: glow('77,132,255'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
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
      new THREE.MeshBasicMaterial({ color: 0xa3e635, transparent: true, opacity: 0, depthTest: false }),
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

  /** false on the projector twin: Mission Control shows the same information in its own panels */
  hudEnabled = true;

  hideAll() {
    this.hud.visible = false; // update() shows it again (intro title / flight never sit on top of the card)
    this.beams.forEach((b) => (b.visible = false));
    this.halo.visible = false;
    this.chevrons.count = 0;
    this.arrow.visible = false;
  }

  update(dt: number, moving: boolean) {
    this.t += dt;
    this.hud.visible = this.hudEnabled;
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
    const W = 1024; // logical units (the canvas is TEXT_SCALE× sharper)
    begin(g);
    const o = this.objective;
    const v = this.vitals;
    glassCard(g, 8, 8, W - 16, 300, 34, UI.accent, v.storm);

    // phase tracker: a rail with five stations (done = lime check, current = blue with a ring)
    const names = PHASES[this.lang];
    const step = o?.phaseStep ?? 0;
    const x0 = 120;
    const dx = 196;
    const y = 50;
    g.lineCap = 'round';
    g.lineWidth = 6;
    g.strokeStyle = UI.track;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x0 + 4 * dx, y);
    g.stroke();
    if (step > 1) {
      g.strokeStyle = UI.ok;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + (Math.min(step, 5) - 1) * dx, y);
      g.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = x0 + i * dx;
      const n = i + 1;
      const done = n < step;
      const cur = n === step;
      if (cur) {
        g.beginPath();
        g.arc(x, y, 24, 0, Math.PI * 2);
        g.fillStyle = 'rgba(77,132,255,0.25)';
        g.fill();
      }
      g.beginPath();
      g.arc(x, y, cur ? 16 : 13, 0, Math.PI * 2);
      g.fillStyle = done ? UI.ok : cur ? UI.accent : '#1a2538';
      g.fill();
      if (!done && !cur) {
        g.lineWidth = 3;
        g.strokeStyle = '#3a4a66';
        g.stroke();
      }
      if (done) {
        // check mark
        g.lineWidth = 4;
        g.strokeStyle = '#0b1400';
        g.beginPath();
        g.moveTo(x - 6, y);
        g.lineTo(x - 1, y + 5);
        g.lineTo(x + 7, y - 5);
        g.stroke();
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = cur ? '#ffffff' : done ? '#cfe9a8' : UI.muted;
      g.font = `${cur ? 700 : 600} 28px system-ui, sans-serif`;
      g.fillText(names[i], x, 92);
    }
    // divider
    g.fillStyle = 'rgba(157,187,255,0.14)';
    g.fillRect(36, 114, W - 72, 2);

    // icon badge + instruction (vertically centred, never overlapping)
    if (o) {
      const cy = 180;
      g.beginPath();
      g.arc(92, cy, 48, 0, Math.PI * 2);
      g.fillStyle = v.storm ? 'rgba(255,90,79,0.18)' : 'rgba(77,132,255,0.18)';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = v.storm ? UI.danger : UI.accent;
      g.stroke();
      g.font = `60px ${EMOJI}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      g.fillText(o.icon, 92, cy + 3);

      g.textAlign = 'left';
      g.fillStyle = UI.text;
      g.font = '700 46px system-ui, sans-serif';
      let lines = wrapLines(g, o.astro[this.lang], W - 210, 2);
      if (lines.length === 2) {
        g.font = '700 40px system-ui, sans-serif'; // two lines: a bit smaller so both sit inside the card
        lines = wrapLines(g, o.astro[this.lang], W - 210, 2);
      }
      const lh = 52;
      const top = cy - ((lines.length - 1) * lh) / 2;
      lines.forEach((l, i) => g.fillText(l, 168, top + i * lh));
    }

    // vitals as chips
    const chip = (x: number, icon: string, text: string, color: string) => {
      g.font = '700 30px system-ui, sans-serif';
      const tw = g.measureText(text).width;
      const w = tw + 92;
      roundPath(g, x, 248, w, 44, 22);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(157,187,255,0.22)';
      g.stroke();
      g.beginPath();
      g.arc(x + 26, 270, 7, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = `26px ${EMOJI}`;
      g.fillText(icon, x + 40, 271);
      g.font = '700 30px system-ui, sans-serif';
      g.fillStyle = UI.text;
      g.fillText(text, x + 76, 271);
      return x + w + 14;
    };
    const o2c = v.o2 > 50 ? UI.ok : v.o2 > 20 ? UI.warn : UI.danger;
    const dc = v.doseBudgetPct <= 50 ? UI.ok : v.doseBudgetPct <= 80 ? UI.warn : UI.danger;
    let cx = chip(36, '🫁', `${Math.round(v.o2)}%`, o2c);
    cx = chip(cx, '☢️', `${v.dose.toFixed(2)} mGy`, dc);
    chip(cx, '⏱', `EVA ${v.clock}`, UI.accent);

    // strip under the card: radio caption (priority) or the how-to-walk hint
    const strip = (text: string, label: string, color: string) => {
      glassCard(g, 8, 322, W - 16, 90, 24, color);
      g.fillStyle = color;
      roundPath(g, 22, 340, 8, 54, 4);
      g.fill();
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = '800 20px system-ui, sans-serif';
      g.fillStyle = color;
      g.fillText(label, 48, 342);
      g.fillStyle = UI.text;
      let size = 32;
      for (; size > 26; size -= 2) {
        g.font = `700 ${size}px system-ui, sans-serif`;
        if (g.measureText(text).width <= W - 80) break;
      }
      g.font = `700 ${size}px system-ui, sans-serif`;
      const ls = wrapLines(g, text, W - 80, 2);
      if (ls.length === 1) g.fillText(ls[0], 48, 378);
      else ls.forEach((l, i) => g.fillText(l, 48, 366 + i * 30));
    };
    if (this.caption) strip(this.caption, this.lang === 'az' ? '📻  MİSSİYA İDARƏSİ' : '📻  MISSION CONTROL', UI.ok);
    else if (o && o.targets.some((t) => t.startsWith('wp:')))
      strip(
        this.lang === 'az' ? 'Getmək üçün işıq sütununa və ya yerdəki oxlara 2 saniyə bax' : 'To walk, look at the light beam or the arrows on the ground for 2 seconds',
        this.lang === 'az' ? '👁  NECƏ GETMƏLİ' : '👁  HOW TO WALK',
        UI.accentSoft,
      );
    this.hudTex.needsUpdate = true;
  }
}

