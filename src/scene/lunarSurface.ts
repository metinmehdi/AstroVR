/**
 * How lunar regolith looks, for the terrain and the rocks:
 *  - a tileable REGOLITH height field (multi-octave noise + micro-craters + pebbles) → normal map + detail albedo,
 *    sampled at two scales so it never visibly repeats
 *  - the Moon's own light scattering: Lommel–Seeliger (the "flat", dusty look — no darkening toward the limb) plus
 *    the opposition surge (regolith brightens when the Sun is behind you), instead of a plastic Lambert surface
 * Everything is generated in code (no downloads); the large-scale albedo is the REAL LROC NAC orthomosaic.
 */
import * as THREE from 'three';

const N = 512; // texture size (tileable)

/** deterministic hash noise */
function h2(x: number, y: number, s: number) {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/** tileable value noise on an N×N torus */
function tileNoise(f: Float32Array, cells: number, amp: number, seed: number) {
  const step = N / cells;
  for (let y = 0; y < N; y++) {
    const gy = y / step;
    const y0 = Math.floor(gy);
    const ty = gy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < N; x++) {
      const gx = x / step;
      const x0 = Math.floor(gx);
      const tx = gx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a = h2(x0 % cells, y0 % cells, seed);
      const b = h2((x0 + 1) % cells, y0 % cells, seed);
      const c = h2(x0 % cells, (y0 + 1) % cells, seed);
      const d = h2((x0 + 1) % cells, (y0 + 1) % cells, seed);
      f[y * N + x] += ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy - 0.5) * amp;
    }
  }
}

/** bowl + raised rim, wrapped around the tile edges */
function addCrater(f: Float32Array, cx: number, cy: number, r: number, depth: number) {
  const ext = Math.ceil(r * 1.8);
  for (let dy = -ext; dy <= ext; dy++) {
    for (let dx = -ext; dx <= ext; dx++) {
      const d = Math.hypot(dx, dy) / r;
      let v = 0;
      if (d < 1) v = -depth * (1 - d * d) + depth * 0.25;
      else if (d < 1.8) v = depth * 0.25 * Math.pow(1 - (d - 1) / 0.8, 2);
      else continue;
      const x = (((cx + dx) % N) + N) % N;
      const y = (((cy + dy) % N) + N) % N;
      f[y * N + x] += v;
    }
  }
}

let cache: { normal: THREE.Texture; detail: THREE.Texture } | null = null;

/** regolith normal map (tangent space) + detail albedo, generated once per page */
export function regolithTextures(): { normal: THREE.Texture; detail: THREE.Texture } {
  if (cache) return cache;
  const f = new Float32Array(N * N);
  tileNoise(f, 4, 1.0, 1);
  tileNoise(f, 8, 0.55, 2);
  tileNoise(f, 16, 0.3, 3);
  tileNoise(f, 32, 0.16, 4);
  tileNoise(f, 64, 0.09, 5);
  tileNoise(f, 128, 0.05, 6);
  // micro-craters: many small, few large (lunar size-frequency)
  for (let i = 0; i < 22; i++) {
    const r = 4 + Math.pow(h2(i, 1, 9), 3) * 30;
    addCrater(f, Math.floor(h2(i, 2, 9) * N), Math.floor(h2(i, 3, 9) * N), r, r * 0.022);
  }
  // pebbles: small bumps
  const pebble = new Float32Array(N * N);
  for (let i = 0; i < 1400; i++) {
    const r = 1 + Math.pow(h2(i, 5, 11), 4) * 5;
    const cx = Math.floor(h2(i, 6, 11) * N);
    const cy = Math.floor(h2(i, 7, 11) * N);
    const ext = Math.ceil(r);
    for (let dy = -ext; dy <= ext; dy++)
      for (let dx = -ext; dx <= ext; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d >= 1) continue;
        const x = (((cx + dx) % N) + N) % N;
        const y = (((cy + dy) % N) + N) % N;
        pebble[y * N + x] = Math.max(pebble[y * N + x], Math.sqrt(1 - d * d) * r * 0.06);
      }
  }
  for (let i = 0; i < N * N; i++) f[i] += pebble[i];

  // normals by central differences (wrapping) → RGB
  const nc = document.createElement('canvas');
  nc.width = nc.height = N;
  const ng = nc.getContext('2d')!;
  const nimg = ng.createImageData(N, N);
  const dc = document.createElement('canvas');
  dc.width = dc.height = N;
  const dg = dc.getContext('2d')!;
  const dimg = dg.createImageData(N, N);
  const k = 5.5; // slope gain
  const at = (x: number, y: number) => f[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      nimg.data[o] = (-dx * inv * 0.5 + 0.5) * 255;
      nimg.data[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      nimg.data[o + 2] = (inv * 0.5 + 0.5) * 255;
      nimg.data[o + 3] = 255;
      // detail albedo: cavities a little darker, pebbles a little brighter, fine speckle
      const cav = at(x, y) - (at(x + 3, y) + at(x - 3, y) + at(x, y + 3) + at(x, y - 3)) / 4;
      const v = 0.86 + cav * 0.35 + pebble[y * N + x] * 0.9 + (h2(x, y, 13) - 0.5) * 0.12;
      const c = Math.max(0, Math.min(255, v * 200));
      dimg.data[o] = c;
      dimg.data[o + 1] = c;
      dimg.data[o + 2] = c;
      dimg.data[o + 3] = 255;
    }
  ng.putImageData(nimg, 0, 0);
  dg.putImageData(dimg, 0, 0);
  const normal = new THREE.CanvasTexture(nc);
  const detail = new THREE.CanvasTexture(dc);
  for (const t of [normal, detail]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.NoColorSpace;
  }
  cache = { normal, detail };
  return cache;
}

/**
 * Turn a MeshStandardMaterial into lunar regolith.
 * `tile` = metres per regolith tile, `uvMetres` = how many metres one unit of the geometry's uv spans.
 */
export function makeLunar(
  mat: THREE.MeshStandardMaterial,
  opts: { uvMetres: number; tile?: number; detailStrength?: number; fadeNear?: number; fadeFar?: number },
) {
  const { normal, detail } = regolithTextures();
  const tile = opts.tile ?? 1.8;
  const reps = opts.uvMetres / tile;
  mat.normalMap = normal;
  // gentle: at a 4° Sun every cm-scale facet facing the Sun would otherwise flash white (snow-like speckle)
  mat.normalScale = new THREE.Vector2(0.6, 0.6);
  mat.roughness = 1;
  mat.metalness = 0;
  const uniforms = {
    uDetail: { value: detail },
    uReps: { value: reps },
    uDetailK: { value: opts.detailStrength ?? 0.85 },
    uFadeNear: { value: opts.fadeNear ?? 18 },
    uFadeFar: { value: opts.fadeFar ?? 70 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLunarUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLunarUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vLunarUv;\nvec3 lunarGeoN = vec3(0.0, 0.0, 1.0);\nuniform sampler2D uDetail;\nuniform float uReps;\nuniform float uDetailK;\nuniform float uFadeNear;\nuniform float uFadeFar;',
      )
      // detail albedo at two scales (×1 and ×1/5.3, rotated) multiplies the real albedo
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 u1 = vLunarUv * uReps;
          vec2 u2 = mat2(0.8, -0.6, 0.6, 0.8) * vLunarUv * uReps * 0.19;
          float d = texture2D(uDetail, u1).r * texture2D(uDetail, u2).r * 1.35;
          diffuseColor.rgb *= mix(1.0, d, uDetailK);
        }`,
      )
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nlunarGeoN = nonPerturbedNormal;')
      // regolith normals at the same two scales, blended
      .replace(
        '#include <normal_fragment_maps>',
        `{
          vec2 u1 = vLunarUv * uReps;
          vec2 u2 = mat2(0.8, -0.6, 0.6, 0.8) * vLunarUv * uReps * 0.19;
          vec3 n1 = texture2D(normalMap, u1).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, u2).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(vec3(n1.xy + n2.xy * 1.2, n1.z * n2.z));
          // fine regolith relief only up close: far away the repeating tile would shimmer into stripes (moiré)
          float lunarFade = 1.0 - smoothstep(uFadeNear, uFadeFar, length(vViewPosition));
          mapN.xy *= normalScale * lunarFade;
          normal = normalize(tbn * mapN);
        }`,
      )
      // the Moon's scattering law instead of Lambert: Lommel–Seeliger blend + opposition surge
      .replace(
        '#include <lights_physical_pars_fragment>',
        THREE.ShaderChunk.lights_physical_pars_fragment.replace(
          'vec3 irradiance = dotNL * directLight.color;',
          `float muV = saturate( dot( geometryNormal, geometryViewDir ) );
          // lunar-Lambert: equals Lambert at normal incidence/view, much flatter at grazing light (low polar Sun)
          float lunarL = mix( dotNL, min( 2.0 * dotNL / ( dotNL + muV + 1e-4 ), 1.4 ), 0.5 ) * smoothstep( 0.0, 0.03, dotNL );
          float g = acos( clamp( dot( directLight.direction, geometryViewDir ), -1.0, 1.0 ) );
          // the cm-scale regolith relief only MODULATES the terrain's own (macro) lighting, within limits:
          // a grain facing away from the 4° Sun is dim, never a black hole; one facing it is brighter, never white snow
          // (cast shadows stay black: they are already inside directLight.color)
          float dotNLg = saturate( dot( lunarGeoN, directLight.direction ) );
          float muVg = saturate( dot( lunarGeoN, geometryViewDir ) );
          float lunarG = mix( dotNLg, min( 2.0 * dotNLg / ( dotNLg + muVg + 1e-4 ), 1.4 ), 0.5 ) * smoothstep( 0.0, 0.03, dotNLg );
          lunarL = lunarG * clamp( lunarL / max( lunarG, 1e-3 ), 0.35, 1.6 );
          lunarL *= 1.0 + 0.45 * exp( -g / 0.09 );
          vec3 irradiance = lunarL * directLight.color;`,
        )
        // dusty regolith has no shine; GGX on facets seen edge-on (N·V ≈ 0) also returns huge values → white flecks
        .replace(
          'reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;',
          '/* regolith: no direct specular (GGX at grazing normal-mapped facets blows up to white flecks) */',
        ),
      );
  };
  mat.customProgramCacheKey = () => 'lunar-regolith-v6';
  mat.needsUpdate = true;
  return mat;
}
