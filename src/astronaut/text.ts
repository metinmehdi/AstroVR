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

/* ------------------------------------------------------------------ shared look (matches the Mission Control dashboard) */

export const UI = {
  accent: '#4d84ff',
  accentSoft: '#9dbbff',
  ok: '#a3e635',
  warn: '#f5b544',
  danger: '#ff5a4f',
  text: '#f2f6ff',
  muted: '#93a3bd',
  track: '#26344d',
};
export const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif';

export function roundPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** dark glass card: near-opaque (the Moon behind never shows through the text), thin bright edge, soft top sheen */
export function glassCard(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, edge: string = UI.accent, danger = false) {
  const bg = g.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, danger ? 'rgba(58,12,16,0.94)' : 'rgba(14,24,46,0.94)');
  bg.addColorStop(1, danger ? 'rgba(30,6,8,0.94)' : 'rgba(5,9,20,0.94)');
  roundPath(g, x, y, w, h, r);
  g.fillStyle = bg;
  g.fill();
  // sheen
  const sh = g.createLinearGradient(0, y, 0, y + h * 0.45);
  sh.addColorStop(0, 'rgba(255,255,255,0.07)');
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = danger ? UI.danger : 'rgba(157,187,255,0.35)';
  g.stroke();
  // accent line along the top edge
  const ac = g.createLinearGradient(x, 0, x + w, 0);
  ac.addColorStop(0, 'rgba(0,0,0,0)');
  ac.addColorStop(0.5, danger ? UI.danger : edge);
  ac.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = ac;
  g.fillRect(x + r, y + 1, w - 2 * r, 4);
}

/** greedy word wrap → lines (at most maxLines; the last line gets an ellipsis if text is left over) */
export function wrapLines(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] += '…';
    return kept;
  }
  return lines;
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
