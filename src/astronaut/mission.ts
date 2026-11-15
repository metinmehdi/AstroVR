/**
 * Astronaut mission flow on the phone (owner: P2). Builds the airlock, checklist stations, route beacons,
 * sample interactions, radio "Copy" and the storm decision, all driven by gaze.
 * Movement is OPTIMISTIC: the lope starts locally at once and the action is sent to Mission Control
 * (the laptop sim stays authoritative for resources; state snaps back only if it disagrees, e.g. abort).
 */
import * as THREE from 'three';
import type { Transport } from '../shared/transport';
import type { ChecklistItem, Lang, RadioMessage, Scenario, SimState, SiteId, StormChoice, Waypoint } from '../shared/types';
import { SuitAudio } from '../audio/engine';
import { RADIO, SUIT, lineText } from '../audio/lines';
import { Gaze } from './gaze';
import { Guide } from './guide';
import { Effects } from './effects';
import { currentObjective } from '../shared/objective';
import { evaClock } from '../shared/protocol';
import { faceCamera, makeButton, WristPanel, type Button3D } from './ui3d';
import { UI, begin, crisp, hiCanvas, roundPath } from './text';

const EYE = 1.65;
const LOPE_SPEED = 2.6; // scene m/s
const HOP_LEN = 1.4;
const HOP_H = 0.35;

interface Ctx {
  scene: THREE.Scene;
  rig: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  scenario: Scenario;
  transport: Transport;
  terrainHeight: (x: number, z: number) => number;
  getState: () => SimState | null;
  getLang: () => Lang;
}

type Label = { en: string; az: string };
const L = (en: string, az: string): Label => ({ en, az });

export class AstronautMission {
  readonly audio = new SuitAudio();
  private gaze: Gaze;
  private wrist: WristPanel;
  private buttons = new Set<THREE.Object3D>();
  private ui = new THREE.Group();
  private localWp = 'airlock';
  private lope: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; hops: number; lastHop: number; wp: string } | null =
    null;
  private vignette: THREE.Mesh;
  private flags = new Set<string>();
  private pendingCopy: { msg: RadioMessage; btn: Button3D; until: number } | null = null;
  private stormButtons: THREE.Object3D[] = [];
  private sampleUI = new Map<SiteId, { photo: Button3D; collect: Button3D; mark: Button3D }>();
  private beacons = new Map<string, Button3D>();
  /** invisible, generous hit areas for movement: the light beam column and the ground path (a small far label is hard to hold with a phone gyro) */
  private pathHit!: THREE.Mesh;
  private pathTarget: string | null = null;
  private guide: Guide;
  private fx: Effects;
  private hopSide = 1;
  private inFlight = false;
  private intro: { t: number; dur: number; title: THREE.Mesh } | null = null;
  private wristAcc = 0;

  constructor(private c: Ctx) {
    this.gaze = new Gaze(c.camera);
    this.guide = new Guide(c.scene, c.camera, (x, z) => c.terrainHeight(x, z));
    this.fx = new Effects(c.scene, c.camera, (x, z) => c.terrainHeight(x, z));
    window.addEventListener('astrovr:step', () => this.audio.chime());
    this.wrist = new WristPanel(c.camera, c.rig);
    c.scene.add(this.ui);
    this.vignette = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false }),
    );
    this.vignette.renderOrder = 998;
    c.camera.add(this.vignette);
    window.addEventListener('astrovr:select', () => this.audio.tick());
    this.buildChecklist();
    this.buildRouteBeacons();
    this.buildSamples();
    this.placeRig('airlock');
  }

  private t(l: Label) {
    return l[this.c.getLang()];
  }

  private wp(id: string): Waypoint {
    return this.c.scenario.waypoints.find((w) => w.id === id)!;
  }

  private ground(x: number, z: number) {
    return this.c.terrainHeight(x, z);
  }

  private placeRig(id: string) {
    const w = this.wp(id);
    this.c.rig.position.set(w.x, this.ground(w.x, w.z) + EYE, w.z);
    this.localWp = id;
  }

  /* ---------------------------------------------------------------- 2. preparation checklist */
  private buildChecklist() {
    const w = this.wp('airlock');
    const y = this.ground(w.x, w.z) + EYE - 0.15;
    // nothing sits straight ahead at start: the cadet must actively turn the head to the light (that is the training)
    const stations: { item: ChecklistItem; icon: string; label: Label; angle: number; dy?: number }[] = [
      { item: 'lookTraining', icon: '✨', label: L('Look here', 'Bura bax'), angle: -0.45, dy: 0.45 },
      { item: 'commCheck', icon: '📡', label: L('Radio check', 'Rabitə yoxlaması'), angle: -0.9 },
      { item: 'suitCheck', icon: '🧑‍🚀', label: L('Suit check', 'Skafandr yoxlaması'), angle: 0.9 },
      { item: 'toolCheck', icon: '🧰', label: L('Tools', 'Alətlər'), angle: 1.8 },
    ];
    for (const s of stations) {
      const b = makeButton(s.icon, this.t(s.label), s.item === 'lookTraining' ? '#7fe3ff' : UI.accent, 0.7);
      // angle 0 = straight ahead (-z), positive = to the right
      b.mesh.position.set(w.x + Math.sin(s.angle) * 1.6, y + (s.dy ?? 0), w.z - Math.cos(s.angle) * 1.6);
      b.mesh.name = `check:${s.item}`;
      b.mesh.userData.relabel = () => b.setText(s.icon, this.t(s.label));
      this.ui.add(b.mesh);
      this.buttons.add(b.mesh);
      this.gaze.add({
        object: b.mesh,
        enabled: () => this.checkEnabled(s.item),
        onSelect: () => this.onCheck(s.item),
      });
    }
  }

  private checkEnabled(item: ChecklistItem) {
    const s = this.c.getState();
    if (!s || (s.phase !== 'briefing' && s.phase !== 'prep') || s.checklist[item]) return false;
    if (item === 'lookTraining') return true;
    if (!s.checklist.lookTraining) return false;
    if (item === 'commCheck') return Boolean(this.pendingCopy && this.pendingCopy.msg.type === 'radioCheck');
    return true;
  }

  private onCheck(item: ChecklistItem) {
    const lang = this.c.getLang();
    if (item === 'commCheck' && this.pendingCopy) {
      this.c.transport.sendAction({ kind: 'copy', msgId: this.pendingCopy.msg.id });
      this.clearCopy();
    }
    this.c.transport.sendAction({ kind: 'checklist', item });
    if (item === 'lookTraining') {
      this.audio.suit('lookDone', lineText(SUIT, 'lookDone', lang));
      this.audio.suit('commCheck', lineText(SUIT, 'commCheck', lang));
    }
    if (item === 'suitCheck') this.audio.suit('suitCheck', lineText(SUIT, 'suitCheck', lang));
    if (item === 'toolCheck') this.audio.suit('toolCheck', lineText(SUIT, 'toolCheck', lang));
  }

  /* ---------------------------------------------------------------- 3. routes and movement */
  private buildRouteBeacons() {
    for (const w of this.c.scenario.waypoints) {
      if (w.id === 'airlock') continue;
      const icon = w.siteId ? '🪨' : w.shadowRefuge ? '🌑' : w.id === 'base' ? '🚪' : '➡️';
      const b = makeButton(icon, w.label[this.c.getLang()], w.shadowRefuge ? UI.ok : w.siteId ? UI.warn : '#5fd3ff', 1.1);
      b.mesh.position.set(w.x, this.ground(w.x, w.z) + 1.4, w.z);
      b.mesh.userData.relabel = () => b.setText(icon, w.label[this.c.getLang()]);
      b.mesh.visible = false;
      b.mesh.name = `wp:${w.id}`;
      this.ui.add(b.mesh);
      this.buttons.add(b.mesh);
      this.beacons.set(w.id, b);
      this.gaze.add({ object: b.mesh, onSelect: () => this.goTo(w.id), fuse: 2 });
    }
    // "home" beacon over the airlock for the way back
    const home = makeButton('🏠', this.t(L('Shelter', 'Sığınacaq')), '#3ddc84', 1.1);
    const a = this.wp('airlock');
    home.mesh.position.set(a.x, this.ground(a.x, a.z) + 3.4, a.z);
    home.mesh.userData.relabel = () => home.setText('🏠', this.t(L('Shelter', 'Sığınacaq')));
    home.mesh.visible = false;
    home.mesh.name = 'wp:airlock';
    this.ui.add(home.mesh);
    this.buttons.add(home.mesh);
    this.beacons.set('airlock', home);
    this.gaze.add({ object: home.mesh, onSelect: () => this.goTo('airlock'), fuse: 2 });

    // hit areas: a 5 m wide, 30 m tall column around each place's light beam …
    const hidden = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    for (const [id, b] of this.beacons) {
      const w = this.wp(id);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 30, 12, 1, false), hidden);
      col.position.set(w.x, this.ground(w.x, w.z) + 14, w.z);
      col.name = `hit:${id}`;
      this.ui.add(col);
      this.gaze.add({
        object: col,
        onSelect: () => this.goTo(id),
        enabled: () => b.mesh.visible && !this.lope,
        fuse: 2,
        onHover: (on) => b.mesh.scale.setScalar(on ? 1.15 : 1),
      });
    }
    // … and a 3 m wide strip along the glowing ground path (looking at the arrows on the ground works too)
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.pathHit = new THREE.Mesh(g, hidden);
    this.pathHit.name = 'hit:path';
    this.pathHit.frustumCulled = false;
    this.ui.add(this.pathHit);
    this.gaze.add({
      object: this.pathHit,
      onSelect: () => this.pathTarget && this.goTo(this.pathTarget),
      enabled: () => this.pathTarget !== null && !this.lope,
      fuse: 2,
      onHover: (on) => this.pathTarget && this.beacons.get(this.pathTarget)?.mesh.scale.setScalar(on ? 1.15 : 1),
    });
  }

  /** Keep the ground-path hit strip under the arrows: from 1.5 m in front of the astronaut to the target place. */
  private updatePathHit(targets: string[]) {
    const wps = targets.filter((t) => t.startsWith('wp:'));
    this.pathTarget = wps.length === 1 && !this.lope ? wps[0].slice(3) : null;
    if (!this.pathTarget) return;
    const to = this.wp(this.pathTarget);
    const p = this.c.rig.position;
    const dx = to.x - p.x;
    const dz = to.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 2) return;
    const ux = dx / len;
    const uz = dz / len;
    const sx = p.x + ux * 1.5;
    const sz = p.z + uz * 1.5;
    const W = 1.5; // half width
    const y0 = this.ground(sx, sz) + 0.1;
    const y1 = this.ground(to.x, to.z) + 0.1;
    const a = this.pathHit.geometry.attributes.position as THREE.BufferAttribute;
    a.setXYZ(0, sx - uz * W, y0, sz + ux * W);
    a.setXYZ(1, sx + uz * W, y0, sz - ux * W);
    a.setXYZ(2, to.x - uz * W, y1, to.z + ux * W);
    a.setXYZ(3, to.x + uz * W, y1, to.z - ux * W);
    a.needsUpdate = true;
    this.pathHit.geometry.computeBoundingSphere();
  }

  private neighbours(id: string): string[] {
    const out = new Set<string>();
    for (const route of Object.values(this.c.scenario.routes)) {
      const i = route.indexOf(id);
      if (i < 0) continue;
      if (i > 0) out.add(route[i - 1]);
      if (i < route.length - 1) out.add(route[i + 1]);
    }
    return [...out];
  }

  private goTo(id: string) {
    if (this.lope || !this.neighbours(this.localWp).includes(id)) return;
    const s = this.c.getState();
    if (!s || (s.phase !== 'surface' && s.phase !== 'crisis')) return;
    this.c.transport.sendAction({ kind: 'moveTo', waypointId: id });
    this.startLope(id);
    if (this.localWp === 'airlock' && id === 'base') this.audio.suit('hatchOpen', lineText(SUIT, 'hatchOpen', this.c.getLang()));
  }

  private startLope(id: string) {
    const w = this.wp(id);
    const from = this.c.rig.position.clone();
    const to = new THREE.Vector3(w.x, this.ground(w.x, w.z) + EYE, w.z);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    this.lope = { from, to, t: 0, dur: Math.max(0.6, dist / LOPE_SPEED), hops: Math.max(1, Math.round(dist / HOP_LEN)), lastHop: -1, wp: id };
  }

  private updateLope(dt: number) {
    const m = (this.vignette.material as THREE.MeshBasicMaterial);
    if (!this.lope) {
      m.opacity = Math.min(0.45, Math.max(0, m.opacity - dt * 2));
      return;
    }
    const L0 = this.lope;
    L0.t += dt;
    const u = Math.min(1, L0.t / L0.dur);
    const p = L0.from.clone().lerp(L0.to, u);
    const ground = this.ground(p.x, p.z) + EYE;
    const hopPhase = u * L0.hops;
    const hop = Math.floor(hopPhase);
    if (hop !== L0.lastHop) {
      L0.lastHop = hop;
      this.audio.step(); // felt through the suit, not heard through vacuum
      this.hopSide = -this.hopSide;
      this.fx.hop(p.x, p.z, Math.atan2(L0.to.x - L0.from.x, L0.to.z - L0.from.z), this.hopSide);
    }
    p.y = ground + Math.abs(Math.sin(hopPhase * Math.PI)) * HOP_H; // 1/6 g bunny-hop
    this.c.rig.position.copy(p);
    m.opacity = Math.max(0, Math.min(0.45, m.opacity + dt * 3)); // comfort vignette
    if (u >= 1) {
      this.localWp = L0.wp;
      this.lope = null;
      this.gaze.pause(1.5);
      const w = this.wp(L0.wp);
      if (w.siteId) this.audio.suit('photoFirst', lineText(SUIT, 'photoFirst', this.c.getLang()));
      if (L0.wp === 'base' && !this.flags.has('routeHint')) {
        this.flags.add('routeHint');
        this.audio.suit('chooseRoute', lineText(SUIT, 'chooseRoute', this.c.getLang()));
      }
      if (L0.wp === 'airlock' && this.c.getState()?.sep.warning) this.audio.suit('inShelter', lineText(SUIT, 'inShelter', this.c.getLang()));
    }
  }

  /* ---------------------------------------------------------------- sample sites (Apollo documentation) */
  private buildSamples() {
    for (const w of this.c.scenario.waypoints.filter((x) => x.siteId)) {
      const siteId = w.siteId!;
      const gy = this.ground(w.x, w.z);
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.35, 1),
        new THREE.MeshStandardMaterial({ color: siteId === 'siteA' ? 0xd9d6cf : 0x8f8a83, roughness: 1, flatShading: true }),
      );
      rock.position.set(w.x + 1.2, gy + 0.2, w.z - 1.2);
      rock.castShadow = true;
      rock.name = `rock:${siteId}`;
      this.c.scene.add(rock);
      const mk = (icon: string, label: Label, dx: number, onSel: () => void, enabled: () => boolean, name: string) => {
        const b = makeButton(icon, this.t(label), UI.accent, 0.6);
        b.mesh.name = `sample:${siteId}:${name}`;
        b.mesh.position.set(rock.position.x + dx, gy + 1.25, rock.position.z);
        b.mesh.userData.relabel = () => b.setText(icon, this.t(label));
        b.mesh.visible = false;
        this.ui.add(b.mesh);
        this.buttons.add(b.mesh);
        this.gaze.add({ object: b.mesh, onSelect: onSel, enabled });
        return b;
      };
      const here = () => this.localWp === w.id && !this.lope;
      const rec = () => this.c.getState()?.samples.find((x) => x.siteId === siteId);
      const send = (kind: 'samplePhoto' | 'sampleCollect' | 'sampleMark', line: string | null) => () => {
        this.c.transport.sendAction({ kind, siteId });
        if (line) this.audio.suit(line, lineText(SUIT, line, this.c.getLang()));
      };
      this.sampleUI.set(siteId, {
        photo: mk('📷', L('Photo + scale', 'Foto + miqyas'), -0.7, send('samplePhoto', null), () => here() && !rec()?.photo, 'photo'),
        collect: mk('🪨', L('Collect', 'Topla'), 0, send('sampleCollect', 'collected'), () => here() && !rec()?.collected, 'collect'),
        mark: mk('📍', L('Mark location', 'Yeri qeyd et'), 0.7, send('sampleMark', 'marked'), () => here() && Boolean(rec()?.collected) && !rec()?.marked, 'mark'),
      });
    }
  }

  /* ---------------------------------------------------------------- radio + storm */
  onRadio(msg: RadioMessage, withSound = true) {
    const lang = this.c.getLang();
    if (withSound) this.audio.radio(msg.type, msg.at);
    this.guide.say(lineText(RADIO, msg.type, lang));
    this.clearCopy();
    const btn = makeButton('✅', 'COPY', '#3ddc84', 0.7);
    btn.mesh.name = 'copy';
    this.placeInView(btn.mesh, 1.8, -0.15);
    this.ui.add(btn.mesh);
    this.buttons.add(btn.mesh);
    // radio check during prep is answered at the radio station (teaches the checklist), elsewhere here
    const atStation = msg.type === 'radioCheck' && this.c.getState()?.phase === 'prep';
    btn.mesh.visible = !atStation;
    this.gaze.add({
      object: btn.mesh,
      onSelect: () => {
        this.c.transport.sendAction({ kind: 'copy', msgId: msg.id });
        this.clearCopy();
      },
    });
    this.pendingCopy = { msg, btn, until: performance.now() + 15000 };
  }

  private clearCopy() {
    if (!this.pendingCopy) return;
    const m = this.pendingCopy.btn.mesh;
    this.gaze.remove(m);
    this.ui.remove(m);
    this.buttons.delete(m);
    this.pendingCopy = null;
  }

  private placeInView(obj: THREE.Object3D, dist: number, dy: number) {
    const dir = new THREE.Vector3();
    this.c.camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    const p = new THREE.Vector3();
    this.c.camera.getWorldPosition(p);
    obj.position.copy(p).addScaledVector(dir, dist);
    obj.position.y = p.y + dy;
  }

  private showStormChoice() {
    const choices: { c: StormChoice; icon: string; label: Label; color: string }[] = [
      { c: 'returnNow', icon: '🏠', label: L('Go home now', 'Dərhal evə'), color: '#3ddc84' },
      { c: 'finishInShadow', icon: '🌑', label: L('Crater shadow', 'Krater kölgəsi'), color: '#9fb3ff' },
      { c: 'continueOpen', icon: '⛏️', label: L('Keep working', 'İşə davam'), color: '#ff5a4f' },
    ];
    choices.forEach((ch, i) => {
      const b = makeButton(ch.icon, this.t(ch.label), ch.color, 0.75);
      b.mesh.name = `storm:${ch.c}`;
      this.placeInView(b.mesh, 2.2, 0.1);
      const right = new THREE.Vector3();
      this.c.camera.getWorldDirection(right);
      right.set(-right.z, 0, right.x).normalize();
      b.mesh.position.addScaledVector(right, (i - 1) * 0.85);
      this.ui.add(b.mesh);
      this.buttons.add(b.mesh);
      this.stormButtons.push(b.mesh);
      this.gaze.add({
        object: b.mesh,
        onSelect: () => {
          this.c.transport.sendAction({ kind: 'stormChoice', choice: ch.c });
          for (const o of this.stormButtons) {
            this.gaze.remove(o);
            this.ui.remove(o);
            this.buttons.delete(o);
          }
          this.stormButtons = [];
        },
      });
    });
  }

  /* ---------------------------------------------------------------- cinematic intro */
  /** Slow 9 s descent from 250 m over the real LOLA terrain to the airlock (comfort: eased, no rotation forced). */
  startIntro() {
    // AstroVR wordmark + site line (same brand as the Mission Control header)
    const c = hiCanvas(1024, 300);
    const g = c.getContext('2d')!;
    const tex = crisp(new THREE.CanvasTexture(c));
    const sub = this.c.getLang() === 'az' ? 'Nobile Rim 1 · Ayın cənub qütbü' : 'Nobile Rim 1 · Moon south pole';
    const paint = (logo: HTMLImageElement | null) => {
      begin(g);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (logo) {
        const h = 170;
        const w = (logo.naturalWidth / logo.naturalHeight) * h;
        g.drawImage(logo, 512 - w / 2, 8, w, h);
      } else {
        g.fillStyle = '#ffffff';
        g.font = '800 120px system-ui, sans-serif';
        g.fillText('AstroVR', 512, 95);
      }
      g.font = '600 40px system-ui, sans-serif';
      const tw = g.measureText(sub).width + 64;
      roundPath(g, 512 - tw / 2, 206, tw, 64, 32);
      g.fillStyle = 'rgba(8,14,30,0.78)';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(157,187,255,0.45)';
      g.stroke();
      g.fillStyle = UI.accentSoft;
      g.fillText(sub, 512, 239);
      tex.needsUpdate = true;
    };
    paint(null);
    const logo = new Image();
    logo.onload = () => paint(logo);
    logo.src = '/images/astrovr-wordmark.png';
    const title = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.35), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
    title.position.set(0, 0.15, -2);
    title.renderOrder = 994;
    this.c.camera.add(title);
    this.intro = { t: 0, dur: 9, title };
    this.audio.suit('intro', lineText(SUIT, 'intro', this.c.getLang()));
  }

  private updateIntro(dt: number): boolean {
    const I = this.intro;
    if (!I) return false;
    I.t += dt;
    const u = Math.min(1, I.t / I.dur);
    const e = u * u * (3 - 2 * u); // ease in-out
    const a = this.wp('airlock');
    const end = new THREE.Vector3(a.x, this.ground(a.x, a.z) + EYE, a.z);
    const start = new THREE.Vector3(a.x + 22, end.y + 48, a.z + 70);
    const mid = new THREE.Vector3(a.x + 6, end.y + 14, a.z + 20);
    // quadratic Bezier start → mid → end
    const p = start.clone().multiplyScalar((1 - e) * (1 - e)).add(mid.clone().multiplyScalar(2 * (1 - e) * e)).add(end.clone().multiplyScalar(e * e));
    this.c.rig.position.copy(p);
    (I.title.material as THREE.MeshBasicMaterial).opacity = u < 0.15 ? u / 0.15 : u > 0.75 ? Math.max(0, (1 - u) / 0.25) : 1;
    if (u >= 1) {
      this.c.camera.remove(I.title);
      this.intro = null;
      this.placeRig('airlock');
    }
    return true;
  }

  /* ---------------------------------------------------------------- debug (a.html?debug=1) */
  debugSelect(name: string) {
    return this.gaze.selectByName(name);
  }
  debugTargets() {
    return this.gaze.selectableNames();
  }
  debugWaypoint() {
    return this.localWp;
  }
  debugPlace(id: string) {
    this.placeRig(id);
  }

  /* ---------------------------------------------------------------- per frame */
  relabel() {
    for (const o of this.buttons) (o.userData.relabel as (() => void) | undefined)?.();
    this.audio.lang = this.c.getLang();
  }

  /** While the cadet is in the rocket (Flight), the Moon mission UI sleeps (no gaze, no HUD). */
  setInFlight(v: boolean, only: THREE.Object3D[] = []) {
    this.gaze.only = v ? only : null;
    if (v === this.inFlight) return;
    this.inFlight = v;
    if (v) this.guide.hideAll();
  }

  /** the in-view HUD card (off on the projector twin, where Mission Control's panels show the same) */
  showHud(v: boolean) {
    this.guide.hudEnabled = v;
  }

  /** the gaze input, so the capsule's story screen can add its SKIP button */
  get gazeInput(): Gaze {
    return this.gaze;
  }

  update(dt: number) {
    const s = this.c.getState();
    const lang = this.c.getLang();
    this.audio.lang = lang;
    if (this.inFlight) {
      this.guide.hideAll();
      this.gaze.update(dt); // only the capsule's targets (story SKIP) are active
      return;
    }

    // first state on the Moon → welcome
    const onMoon = !s?.flight || s.flight.status === 'landed';
    if (s && s.phase === 'briefing' && onMoon && !this.intro && !this.flags.has('welcome')) {
      this.flags.add('welcome');
      this.audio.suit('welcome', lineText(SUIT, 'welcome', lang));
    }
    // storm warning → decision buttons once
    if (s?.sep.warning && !this.flags.has('storm')) {
      this.flags.add('storm');
      this.audio.suit('stormChoice', lineText(SUIT, 'stormChoice', lang));
      if (!s.astronaut.inAirlock) this.showStormChoice();
    }
    if (s?.sep.active && !this.flags.has('protons')) {
      this.flags.add('protons');
      this.audio.suit('protonsArrived', lineText(SUIT, 'protonsArrived', lang));
    }

    if (this.updateIntro(dt)) {
      this.guide.hideAll();
      this.gaze.update(dt);
      return;
    }

    // server disagrees (abort auto-return, reconnect) → follow the authoritative position
    if (s && !this.lope && s.astronaut.waypointId !== this.localWp) {
      if (s.phase === 'aborted' || s.phase === 'debrief') this.placeRig(s.astronaut.waypointId);
      else if (this.neighbours(this.localWp).includes(s.astronaut.waypointId)) this.startLope(s.astronaut.waypointId);
      else this.placeRig(s.astronaut.waypointId);
    }
    this.updateLope(dt);

    // ---- guidance: the ONE thing to do now (same objective logic as Mission Control)
    const local = s ? { ...s, astronaut: { ...s.astronaut, waypointId: this.localWp } } : null;
    const obj = currentObjective(local, {
      radioCheckPending: this.pendingCopy?.msg.type === 'radioCheck',
      routes: this.c.scenario.routes,
    });
    const active = new Set(this.lope ? [] : obj.targets);
    for (const o of this.buttons) {
      if (o.name.startsWith('check:') || o.name.startsWith('wp:') || o.name.startsWith('sample:')) o.visible = active.has(o.name);
    }
    this.updatePathHit([...active]);
    this.guide.setLang(lang);
    this.guide.setObjective(obj, [...this.buttons].filter((o) => active.has(o.name)));
    if (s) {
      this.guide.setVitals({
        o2: s.o2.suitPct,
        dose: s.dose.totalMGy,
        doseBudgetPct: s.dose.budgetPct,
        clock: evaClock(s.evaStartedAt === null ? 0 : s.t - s.evaStartedAt),
        storm: s.sep.warning && s.phase !== 'debrief',
      });
    }
    this.guide.update(dt, Boolean(this.lope));
    this.fx.update(dt, s?.sep.active && s.phase !== 'debrief' && !s.astronaut.inAirlock ? s.sep.fluxNorm : 0);
    // radio copy expiry
    if (this.pendingCopy && performance.now() > this.pendingCopy.until) this.clearCopy();

    // billboards
    for (const o of this.buttons) if (o.visible) faceCamera(o, this.c.camera);
    this.gaze.update(dt);

    // wrist + audio
    this.wristAcc += dt;
    if (s && this.wristAcc > 0.25) {
      this.wristAcc = 0;
      const task = this.taskText(s);
      this.wrist.draw(s.o2.suitPct, s.o2.walkbackMarginPct, s.dose.totalMGy, s.dose.budgetPct, s.dose.rateMGyPerH, task);
    }
    if (s) {
      const stress = Math.min(1, (s.sep.active ? 0.5 : 0) + (s.o2.walkbackMarginPct < 15 ? 0.3 : 0) + s.dose.budgetPct / 200);
      this.audio.update(s.dose.rateMGyPerH, stress);
    }
  }

  private taskText(s: SimState): string {
    const T = (en: string, az: string) => this.t(L(en, az));
    switch (s.phase) {
      case 'lobby':
        return T('Waiting for Mission Control', 'Missiya İdarəsi gözlənilir');
      case 'briefing':
      case 'prep':
        return T('Checklist before EVA', 'EVA-dan əvvəl yoxlama');
      case 'surface':
        return s.samples.some((x) => x.marked) ? T('Science done — or explore', 'Elm tamam — davam et') : T('Find a rock sample', 'Daş nümunəsi tap');
      case 'crisis':
        return s.sep.warning ? T('☢️ STORM — get safe!', '☢️ FIRTINA — qorun!') : T('⚡ Power is dropping', '⚡ Enerji azalır');
      case 'aborted':
        return T('ABORT — returning home', 'DAYANDIRILDI — qayıdış');
      case 'debrief':
        return T('Mission complete!', 'Missiya tamamlandı!');
    }
  }
}
