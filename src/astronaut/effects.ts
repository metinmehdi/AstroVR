/**
 * Small effects that make the Moon feel physical:
 *  - regolith dust kicked up on every hop, flying on ballistic arcs in 1/6 g with NO air drag (no lingering clouds)
 *  - bootprints left behind on the route
 *  - radiation "light flashes" in the visor during the storm: Apollo astronauts reported seeing brief flashes and
 *    streaks with their eyes closed — energetic particles passing through the eye (NASA Apollo light-flash studies)
 */
import * as THREE from 'three';

const G_MOON = 1.62; // m/s²

interface Grain {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
}

export class Effects {
  private grains: Grain[] = [];
  private dust: THREE.Points;
  private dustPos: Float32Array;
  private prints: THREE.InstancedMesh;
  private printN = 0;
  private flashes: THREE.Mesh[] = [];
  private flashT: number[] = [];

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    private heightAt: (x: number, z: number) => number,
  ) {
    const MAX = 400;
    this.dustPos = new Float32Array(MAX * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    g.setDrawRange(0, 0);
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xb9b2a6, size: 0.035, transparent: true, opacity: 0.9 }));
    this.dust.frustumCulled = false;
    scene.add(this.dust);

    const shape = new THREE.Shape();
    shape.absellipse(0, 0, 0.09, 0.16, 0, Math.PI * 2, false, 0);
    const pg = new THREE.ShapeGeometry(shape);
    pg.rotateX(-Math.PI / 2);
    this.prints = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ color: 0x2b2824, transparent: true, opacity: 0.55, depthWrite: false }), 200);
    this.prints.count = 0;
    this.prints.frustumCulled = false;
    scene.add(this.prints);

    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.004, 0.06),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending }),
      );
      m.renderOrder = 999;
      camera.add(m);
      this.flashes.push(m);
      this.flashT.push(1);
    }
  }

  /** A hop touches the ground at (x, z) heading in direction `heading` (radians). */
  hop(x: number, z: number, heading: number, side: number) {
    const y = this.heightAt(x, z);
    for (let i = 0; i < 26; i++) {
      const a = heading + Math.PI + (Math.random() - 0.5) * 1.6;
      const speed = 0.6 + Math.random() * 1.4;
      this.grains.push({
        p: new THREE.Vector3(x, y + 0.02, z),
        v: new THREE.Vector3(Math.sin(a) * speed * 0.6, 0.5 + Math.random() * 1.3, Math.cos(a) * speed * 0.6),
        life: 0,
      });
    }
    if (this.grains.length > 400) this.grains.splice(0, this.grains.length - 400);
    // bootprint, alternating left/right of the path
    const ox = Math.cos(heading) * 0.12 * side;
    const oz = -Math.sin(heading) * 0.12 * side;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x + ox, this.heightAt(x + ox, z + oz) + 0.015, z + oz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, heading, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    this.prints.setMatrixAt(this.printN % 200, m);
    this.printN++;
    this.prints.count = Math.min(200, this.printN);
    this.prints.instanceMatrix.needsUpdate = true;
  }

  /** stormLevel 0..1 from the real proton intensity → how often light flashes appear. */
  update(dt: number, stormLevel: number) {
    // dust: ballistic, no air drag on the Moon
    let n = 0;
    for (const gr of this.grains) {
      gr.life += dt;
      gr.v.y -= G_MOON * dt;
      gr.p.addScaledVector(gr.v, dt);
      const ground = this.heightAt(gr.p.x, gr.p.z);
      if (gr.p.y < ground) continue;
      this.dustPos.set([gr.p.x, gr.p.y, gr.p.z], n * 3);
      n++;
    }
    this.grains = this.grains.filter((g) => g.p.y >= this.heightAt(g.p.x, g.p.z) - 0.01 && g.life < 4);
    this.dust.geometry.setDrawRange(0, n);
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // radiation light flashes
    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i];
      if (this.flashT[i] < 1) {
        this.flashT[i] += dt * 7;
        (f.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - this.flashT[i]);
      } else if (stormLevel > 0.05 && Math.random() < dt * 3.5 * stormLevel) {
        this.flashT[i] = 0;
        const r = 0.05 + Math.random() * 0.25;
        const a = Math.random() * Math.PI * 2;
        f.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.7, -0.6);
        f.rotation.z = Math.random() * Math.PI;
        f.scale.set(1, 0.4 + Math.random() * 1.6, 1);
      }
    }
  }
}
