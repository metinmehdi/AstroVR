/**
 * The terrain mesh: a warped regular grid (fine around the outpost, coarse at the edges) sampled from the analytic
 * height function, plus the EXACT height of the rendered triangles.
 *
 * Why both: the analytic height (LOLA + small craters + micro relief) varies between the mesh vertices (1.2 m apart near
 * the outpost), so the drawn triangles differ from it by up to ~10 cm. Anything that must touch the visible ground
 * (rover wheels, wheel tracks) uses meshHeightAt — otherwise a wheel would sink into or float above the drawn surface.
 */
import * as THREE from 'three';

/** vertex spacing ≈ 1.2 m around the outpost, growing to ≈ 11 m at the edges (t in −1..1) */
export const warp = (t: number) => Math.sign(t) * (0.27 * Math.abs(t) + 0.73 * Math.pow(Math.abs(t), 2.3));

export interface TerrainMesh {
  geometry: THREE.BufferGeometry;
  /** height of the drawn triangle surface at (x, z) (scene metres) */
  meshHeightAt(x: number, z: number): number;
}

/** largest i with arr[i] <= v, clamped to [0, arr.length − 2] */
function cell(arr: Float64Array, v: number): number {
  let lo = 0;
  let hi = arr.length - 2;
  if (v <= arr[0]) return 0;
  if (v >= arr[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function buildTerrainGeometry(heightAt: (x: number, z: number) => number, sizeM: number, seg: number): TerrainMesh {
  const geo = new THREE.PlaneGeometry(1, 1, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uvs = geo.attributes.uv as THREE.BufferAttribute;
  const half = sizeM / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = warp(pos.getX(i) * 2) * half;
    const z = warp(pos.getZ(i) * 2) * half;
    pos.setXYZ(i, x, heightAt(x, z), z);
    uvs.setXY(i, (x + half) / sizeM, 1 - (z + half) / sizeM);
  }
  geo.computeVertexNormals();

  // PlaneGeometry layout after rotateX(−90°): vertex (ix, iy) = ix + (seg+1)·iy, x grows with ix, z grows with iy;
  // each cell is split into triangles (a, b, d) and (b, c, d) with a=(ix,iy) b=(ix,iy+1) c=(ix+1,iy+1) d=(ix+1,iy)
  const n1 = seg + 1;
  const xs = new Float64Array(n1);
  const zs = new Float64Array(n1);
  for (let k = 0; k < n1; k++) {
    xs[k] = pos.getX(k);
    zs[k] = pos.getZ(k * n1);
  }
  const Y = pos.array as Float32Array;
  const h = (ix: number, iy: number) => Y[(ix + n1 * iy) * 3 + 1];
  return {
    geometry: geo,
    meshHeightAt(x, z) {
      const ix = cell(xs, x);
      const iy = cell(zs, z);
      const u = Math.min(1, Math.max(0, (x - xs[ix]) / (xs[ix + 1] - xs[ix])));
      const v = Math.min(1, Math.max(0, (z - zs[iy]) / (zs[iy + 1] - zs[iy])));
      const a = h(ix, iy);
      const b = h(ix, iy + 1);
      const c = h(ix + 1, iy + 1);
      const d = h(ix + 1, iy);
      return u + v <= 1 ? a + u * (d - a) + v * (b - a) : c + (1 - u) * (b - c) + (1 - v) * (d - c);
    },
  };
}
