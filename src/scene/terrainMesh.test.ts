/** meshHeightAt must equal the height of the DRAWN triangles (checked against a real ray cast). */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTerrainGeometry } from './terrainMesh';

describe('terrain mesh height', () => {
  it('matches a downward ray cast on the rendered triangles (≤ 0.1 mm)', () => {
    const heightAt = (x: number, z: number) => 3 * Math.sin(x * 0.37) + 2 * Math.cos(z * 0.53) + 0.3 * Math.sin(x * 1.9 + z * 2.3);
    const size = 400;
    const { geometry, meshHeightAt } = buildTerrainGeometry(heightAt, size, 90);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let maxErr = 0;
    for (let i = 0; i < 500; i++) {
      // most points near the outpost (fine cells), some far out (coarse cells)
      const r = i % 5 === 0 ? 180 : 60;
      const x = (rnd() - 0.5) * 2 * r;
      const z = (rnd() - 0.5) * 2 * r;
      ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      expect(hit).toBeDefined();
      maxErr = Math.max(maxErr, Math.abs(hit.point.y - meshHeightAt(x, z)));
    }
    expect(maxErr).toBeLessThan(1e-4);
  });
});
