/**
 * Small light helpers shared by the sky, the outpost and the rover.
 * In vacuum there is no air to scatter light: a lamp shows as a bright point plus the soft glare that the eye / visor /
 * camera optics add around it (the same glare the Sun gets). No visible beams or light cones.
 */
import * as THREE from 'three';

/** Soft radial glow texture (sun glare, Earth halo, lamp glare). */
export function glowTexture(rgb: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(' + rgb + ',1)');
  grad.addColorStop(0.15, 'rgba(' + rgb + ',0.55)');
  grad.addColorStop(0.45, 'rgba(' + rgb + ',0.12)');
  grad.addColorStop(1, 'rgba(' + rgb + ',0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

let whiteGlow: THREE.CanvasTexture | null = null;

export interface Lamp {
  group: THREE.Group;
  /** level 0..1 (0 = off: the lens shows its dark colour, no glare); optional new colour */
  set(level: number, color?: number): void;
}

/**
 * A small signal lamp: an emissive lens (unlit, not tone-mapped) + an additive optical glare sprite.
 * No THREE.Light → costs nothing in the shaders of the rest of the scene.
 */
export function makeLamp(color: number, lensRadius: number, glareSize: number): Lamp {
  whiteGlow ??= glowTexture('255,255,255');
  const group = new THREE.Group();
  const lensMat = new THREE.MeshBasicMaterial({ color });
  lensMat.toneMapped = false;
  const lens = new THREE.Mesh(new THREE.SphereGeometry(lensRadius, 10, 8), lensMat);
  const glareMat = new THREE.SpriteMaterial({
    map: whiteGlow,
    color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  glareMat.toneMapped = false;
  const glare = new THREE.Sprite(glareMat);
  glare.scale.set(glareSize, glareSize, 1);
  group.add(lens, glare);
  const on = new THREE.Color(color);
  const off = new THREE.Color();
  let current = color;
  return {
    group,
    set(level, c) {
      if (c !== undefined && c !== current) {
        current = c;
        on.setHex(c);
        glareMat.color.setHex(c);
      }
      const l = Math.min(1, Math.max(0, level));
      // unlit lens: a dim tint of its colour, lit lens: full colour
      off.copy(on).multiplyScalar(0.12);
      lensMat.color.copy(off).lerp(on, l);
      glareMat.opacity = l;
      glare.visible = l > 0.01;
    },
  };
}
