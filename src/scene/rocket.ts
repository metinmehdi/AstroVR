/**
 * Rocket, launch tower, pad and an altitude-aware sky — shared by the story intro (Mission Control) and the
 * rocket flight (phone). A generic, unbranded heavy rocket (no agency logos): core stage, two side boosters,
 * upper stage, crew capsule and launch-abort tower. Units: metres, +Y up, origin at the base.
 */
import * as THREE from 'three';

function label(text: string, w = 512, h = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f2';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#1d2733';
  g.font = `800 ${h * 0.62}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRocket(): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.55, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.7 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xd9772b, roughness: 0.75 }); // insulation foam colour
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.35, metalness: 0.8 });
  const cyl = (r1: number, r2: number, h: number, m: THREE.Material, y: number, x = 0) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 40), m);
    mesh.position.set(x, y + h / 2, 0);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  // core stage
  cyl(4.2, 4.2, 62, orange, 0);
  cyl(4.25, 4.25, 1.2, dark, 0);
  cyl(4.25, 4.25, 1.2, dark, 61);
  // engines
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 3, 24, 1, true), metal);
    bell.position.set(Math.cos(a) * 2, -1.4, Math.sin(a) * 2);
    g.add(bell);
  }
  // side boosters with nose cones
  for (const x of [-6.3, 6.3]) {
    cyl(1.9, 1.9, 54, white, 0, x);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.9, 6, 32), white);
    nose.position.set(x, 57, 0);
    g.add(nose);
    cyl(1.95, 1.95, 0.8, dark, 10, x);
    cyl(1.95, 1.95, 0.8, dark, 40, x);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 2.6, 24, 1, true), dark);
    nozzle.position.set(x, -1.2, 0);
    g.add(nozzle);
  }
  // interstage + upper stage
  cyl(4.2, 3.0, 4, white, 62);
  cyl(3.0, 3.0, 12, white, 66);
  // name band (not an agency logo)
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(3.02, 3.02, 3, 40, 1, true, -0.6, 1.2),
    new THREE.MeshStandardMaterial({ map: label('AstroVR'), roughness: 0.6 }),
  );
  band.position.set(0, 71, 0);
  band.rotation.y = Math.PI / 2;
  g.add(band);
  // service module + crew capsule + abort tower
  cyl(2.6, 2.6, 4, white, 78);
  cyl(2.62, 2.62, 0.5, dark, 82);
  const capsule = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.6, 40), new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.4, metalness: 0.3 }));
  capsule.position.set(0, 84.3, 0);
  g.add(capsule);
  cyl(0.35, 0.35, 6, white, 86);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2, 16), dark);
  tip.position.set(0, 93, 0);
  g.add(tip);
  return g;
}

/** Steel lattice launch tower with crew-access arm, beside the rocket at +X. */
export function createLaunchTower(height = 100): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x6f7780, roughness: 0.6, metalness: 0.6 });
  const W = 9;
  const beams: THREE.Matrix4[] = [];
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0) =>
    beams.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, sz)));
  for (const x of [-W / 2, W / 2]) for (const z of [-W / 2, W / 2]) box(x, height / 2, z, 0.6, height, 0.6);
  for (let y = 4; y < height; y += 6) {
    box(0, y, -W / 2, W, 0.35, 0.35);
    box(0, y, W / 2, W, 0.35, 0.35);
    box(-W / 2, y, 0, 0.35, 0.35, W);
    box(W / 2, y, 0, 0.35, 0.35, W);
    box(0, y + 3, -W / 2, Math.hypot(W, 6), 0.25, 0.25, Math.atan2(6, W) * (y % 12 < 6 ? 1 : -1));
    box(0, y + 3, W / 2, Math.hypot(W, 6), 0.25, 0.25, -Math.atan2(6, W) * (y % 12 < 6 ? 1 : -1));
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, beams.length);
  beams.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.castShadow = true;
  g.add(inst);
  // crew access arm toward the capsule (rocket at the origin, tower at +X)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(9, 2.4, 2.4), steel);
  arm.position.set(-W / 2 - 4.5, 84.5, 0);
  g.add(arm);
  // warning lights on top
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
  red.position.set(0, height + 0.6, 0);
  g.add(red);
  return g;
}

/** Concrete pad + grass/sand ring (canvas texture). */
export function createPadGround(radius = 1500): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(256, 256, 10, 256, 256, 256);
  grd.addColorStop(0, '#8d8f8f');
  grd.addColorStop(0.06, '#7d807e');
  grd.addColorStop(0.08, '#5d6b45');
  grd.addColorStop(0.5, '#4e5e3a');
  grd.addColorStop(0.8, '#3f5560');
  grd.addColorStop(1, '#2f4d66');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // flame trench
  g.fillStyle = '#2a2a2a';
  g.fillRect(250, 256, 12, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

/**
 * Sky dome whose colour follows altitude: 0 = Earth day sky (or dawn), 1 = the black of space.
 * Unlit shader, so it works in any scene.
 */
export function createSkyDome(radius = 900, mode: boolean | 'day' | 'dawn' | 'night' = false): { mesh: THREE.Mesh; setAltitude: (a: number) => void } {
  const m = mode === true ? 'dawn' : mode === false ? 'day' : mode;
  const H = { day: 0xbcd8f2, dawn: 0xffa25c, night: 0x1a2236 }[m];
  const Z = { day: 0x2f6fc4, dawn: 0x1d3a72, night: 0x020309 }[m];
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
    uniforms: {
      alt: { value: 0 },
      horizonCol: { value: new THREE.Color(H) },
      zenithCol: { value: new THREE.Color(Z) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float alt; uniform vec3 horizonCol; uniform vec3 zenithCol; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 col = mix(horizonCol, zenithCol, pow(max(h,0.0), 0.45));
        col = mix(col, horizonCol * 0.55, smoothstep(0.0, -0.2, h));
        float a = 1.0 - smoothstep(0.15, 1.0, alt);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.renderOrder = -1;
  return { mesh, setAltitude: (a: number) => (mat.uniforms.alt.value = a) };
}
