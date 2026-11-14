/**
 * Crisp text in a phone VR box. Canvas textures are drawn at 2× (TEXT_SCALE) with the same layout code
 * (ctx.setTransform), use the GPU's best anisotropic filtering, and skip tone mapping (full contrast).
 */
import * as THREE from 'three';

export const TEXT_SCALE = 2;
let maxAniso = 8;

export function setMaxAnisotropy(n: number) {
  maxAniso = Math.max(1, n);
}

export function crisp<T extends THREE.Texture>(tex: T): T {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** a canvas of logical size w×h, backed by TEXT_SCALE× pixels */
export function hiCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w * TEXT_SCALE;
  c.height = h * TEXT_SCALE;
  return c;
}

/** clear and switch to logical units */
export function begin(g: CanvasRenderingContext2D) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  g.setTransform(TEXT_SCALE, 0, 0, TEXT_SCALE, 0, 0);
}

/** biggest font (≤ max) at which `text` fits `width`; below `min` the caller should wrap */
export function fitFont(g: CanvasRenderingContext2D, text: string, width: number, max: number, min: number, weight = 700) {
  let size = max;
  for (; size > min; size -= 2) {
    g.font = `${weight} ${size}px system-ui, sans-serif`;
    if (g.measureText(text).width <= width) return size;
  }
  g.font = `${weight} ${min}px system-ui, sans-serif`;
  return min;
}

/** draw `text` centred at (x, y): one line if it fits, otherwise two lines (no squeezing) */
export function centredLabel(g: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, max: number, min: number) {
  const size = fitFont(g, text, width, max, min);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (g.measureText(text).width <= width) {
    g.fillText(text, x, y);
    return;
  }
  const words = text.split(' ');
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(g.measureText(words.slice(0, i).join(' ')).width - g.measureText(words.slice(i).join(' ')).width);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  const lh = size * 1.05;
  g.fillText(words.slice(0, best).join(' '), x, y - lh / 2, width);
  g.fillText(words.slice(best).join(' '), x, y + lh / 2, width);
}
