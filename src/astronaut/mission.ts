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
import { faceCamera, makeButton, WristPanel, type Button3D } from './ui3d';

const EYE = 1.65;
const LOPE_SPEED = 2.2; // scene m/s
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

  constructor(private c: Ctx) {
    this.gaze = new Gaze(c.camera);
    this.wrist = new WristPanel(c.camera, c.rig);
    c.scene.add(this.ui);
    this.vignette = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false }),
    );
    this.vignette.renderOrder = 998;
    c.camera.add(this.vignette);
    window.addEventListener('astrovr:select', () => this.audio.tick());
    this.buildAirlock();
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

  /* ---------------------------------------------------------------- airlock = storm shelter */
  private buildAirlock() {
    const w = this.wp('airlock');
    const y0 = this.ground(w.x, w.z);
    const g = new THREE.Group();
    g.position.set(w.x, y0, w.z);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    // wall with a wide window facing north (az ~288..72 deg): the hatch side, the low Sun (~57 deg) and Earth (~318 deg)
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 2.8, 48, 1, true, Math.PI * 1.4, Math.PI * 1.2), mat);
    wall.position.y = 1.4;
    wall.castShadow = true;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48), new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    const roof = new THREE.Mesh(new THREE.CircleGeometry(2.45, 48), mat);
    roof.rotation.x = Math.PI / 2;
    roof.position.y = 2.8;
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(2.38, 2.38, 2.6, 24, 1, true, Math.PI * 0.6, Math.PI * 0.8),
      new THREE.MeshPhysicalMaterial({ color: 0x9fc7ff, transparent: true, opacity: 0.12, roughness: 0, side: THREE.DoubleSide }),
    );
    glass.position.y = 1.4;
    g.add(wall, floor, roof, glass);
    this.c.scene.add(g);
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
      const b = makeButton(s.icon, this.t(s.label), s.item === 'lookTraining' ? '#7fe3ff' : '#ffc847', 0.7);
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
      void this.audio.suit('lookDone', lineText(SUIT, 'lookDone', lang));
      void this.audio.suit('commCheck', lineText(SUIT, 'commCheck', lang));
    }
    if (item === 'suitCheck') void this.audio.suit('suitCheck', lineText(SUIT, 'suitCheck', lang));
    if (item === 'toolCheck') void this.audio.suit('toolCheck', lineText(SUIT, 'toolCheck', lang));
  }

  /* ---------------------------------------------------------------- 3. routes and movement */
  private buildRouteBeacons() {
    for (const w of this.c.scenario.waypoints) {
      if (w.id === 'airlock') continue;
      const icon = w.siteId ? '🪨' : w.shadowRefuge ? '🌑' : w.id === 'base' ? '🚪' : '➡️';
      const b = makeButton(icon, w.label[this.c.getLang()], w.shadowRefuge ? '#9fb3ff' : w.siteId ? '#ffc847' : '#5fd3ff', 1.1);
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
    if (this.localWp === 'airlock' && id === 'base') void this.audio.suit('hatchOpen', lineText(SUIT, 'hatchOpen', this.c.getLang()));
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
      m.opacity = Math.max(0, m.opacity - dt * 2);
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
    }
    p.y = ground + Math.abs(Math.sin(hopPhase * Math.PI)) * HOP_H; // 1/6 g bunny-hop
    this.c.rig.position.copy(p);
    m.opacity = Math.min(0.45, m.opacity + dt * 3); // comfort vignette
    if (u >= 1) {
      this.localWp = L0.wp;
      this.lope = null;
      this.gaze.pause(1.5);
      const w = this.wp(L0.wp);
      if (w.siteId) void this.audio.suit('photoFirst', lineText(SUIT, 'photoFirst', this.c.getLang()));
      if (L0.wp === 'base' && !this.flags.has('routeHint')) {
        this.flags.add('routeHint');
        void this.audio.suit('chooseRoute', lineText(SUIT, 'chooseRoute', this.c.getLang()));
      }
      if (L0.wp === 'airlock' && this.c.getState()?.sep.warning) void this.audio.suit('inShelter', lineText(SUIT, 'inShelter', this.c.getLang()));
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
        const b = makeButton(icon, this.t(label), '#ffc847', 0.6);
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
        if (line) void this.audio.suit(line, lineText(SUIT, line, this.c.getLang()));
      };
      this.sampleUI.set(siteId, {
        photo: mk('📷', L('Photo + scale', 'Foto + miqyas'), -0.7, send('samplePhoto', null), () => here() && !rec()?.photo, 'photo'),
        collect: mk('🪨', L('Collect', 'Topla'), 0, send('sampleCollect', 'collected'), () => here() && !rec()?.collected, 'collect'),
        mark: mk('📍', L('Mark location', 'Yeri qeyd et'), 0.7, send('sampleMark', 'marked'), () => here() && Boolean(rec()?.collected) && !rec()?.marked, 'mark'),
      });
    }
  }

  /* ---------------------------------------------------------------- radio + storm */
  onRadio(msg: RadioMessage) {
    const lang = this.c.getLang();
    void this.audio.radio(msg.type, lineText(RADIO, msg.type, lang));
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

  /* ---------------------------------------------------------------- per frame */
  relabel() {
    for (const o of this.buttons) (o.userData.relabel as (() => void) | undefined)?.();
    this.audio.lang = this.c.getLang();
  }

  update(dt: number) {
    const s = this.c.getState();
    const lang = this.c.getLang();
    this.audio.lang = lang;

    // first state → welcome
    if (s && s.phase === 'briefing' && !this.flags.has('welcome')) {
      this.flags.add('welcome');
      void this.audio.suit('welcome', lineText(SUIT, 'welcome', lang));
    }
    // storm warning → decision buttons once
    if (s?.sep.warning && !this.flags.has('storm')) {
      this.flags.add('storm');
      void this.audio.suit('stormChoice', lineText(SUIT, 'stormChoice', lang));
      if (!s.astronaut.inAirlock) this.showStormChoice();
    }
    if (s?.sep.active && !this.flags.has('protons')) {
      this.flags.add('protons');
      void this.audio.suit('protonsArrived', lineText(SUIT, 'protonsArrived', lang));
    }

    // server disagrees (abort auto-return, reconnect) → follow the authoritative position
    if (s && !this.lope && s.astronaut.waypointId !== this.localWp) {
      if (s.phase === 'aborted' || s.phase === 'debrief') this.placeRig(s.astronaut.waypointId);
      else if (this.neighbours(this.localWp).includes(s.astronaut.waypointId)) this.startLope(s.astronaut.waypointId);
      else this.placeRig(s.astronaut.waypointId);
    }
    this.updateLope(dt);

    // beacons: show neighbours of where we stand during EVA
    const eva = s && (s.phase === 'surface' || s.phase === 'crisis');
    // shelter rule: once the storm warning is out, a crew in the airlock stays inside until the debrief
    const sheltered = Boolean(s?.sep.warning) && this.localWp === 'airlock';
    const nb = eva && !this.lope && !sheltered ? this.neighbours(this.localWp) : [];
    for (const [id, b] of this.beacons) b.mesh.visible = nb.includes(id);
    // checklist stations visible in the airlock before EVA
    for (const o of this.ui.children) {
      if (o.name.startsWith('check:')) o.visible = Boolean(s && (s.phase === 'briefing' || s.phase === 'prep')) && this.checkVisible(o.name.slice(6) as ChecklistItem);
    }
    // sample buttons
    for (const [siteId, ui] of this.sampleUI) for (const b of [ui.photo, ui.collect, ui.mark]) b.mesh.visible = !this.lope && this.localWp === siteId;
    // radio copy expiry
    if (this.pendingCopy && performance.now() > this.pendingCopy.until) this.clearCopy();

    // billboards
    for (const o of this.buttons) if (o.visible) faceCamera(o, this.c.camera);
    this.gaze.update(dt);

    // wrist + audio
    if (s) {
      const task = this.taskText(s);
      this.wrist.draw(s.o2.suitPct, s.o2.walkbackMarginPct, s.dose.totalMGy, s.dose.budgetPct, s.dose.rateMGyPerH, task);
      const stress = Math.min(1, (s.sep.active ? 0.5 : 0) + (s.o2.walkbackMarginPct < 15 ? 0.3 : 0) + s.dose.budgetPct / 200);
      this.audio.update(s.dose.rateMGyPerH, stress);
    }
  }

  private checkVisible(item: ChecklistItem) {
    const s = this.c.getState();
    if (!s || s.checklist[item]) return false;
    return item === 'lookTraining' || s.checklist.lookTraining;
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
