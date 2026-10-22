/**
 * A die's solid and its readable faces, built with the kit. The kit lays out and reads a die by its name; a percentile
 * die whose pack gives it no layout of its own (no `faces` or `grid`) would get a d20's, so it is built as the d10 it
 * is, and numbered in tens as the kit numbers a d100.
 */
import type * as THREE from 'three';
import { dieFaceNormals, dieGeometry, packDie, type DicePack } from './kit/dieShapes';
import type { DieType, Vec3 } from './kit/faces';

export function buildDie(type: DieType, size: number, pack: DicePack): { geometry: THREE.BufferGeometry; normals: Vec3[]; numbers: number[] } {
  const entry = packDie(type, pack);
  if (type === 'd100' && !entry.faces && !entry.grid) {
    const { geometry: _solid, ...asD10 } = entry;
    const d10Pack: DicePack = { ...pack, dice: { ...pack.dice, d10: asD10 } };
    const geometry = dieGeometry('d10', size, d10Pack);
    const read = dieFaceNormals('d10', geometry);
    const own = Array.isArray(entry.numbers) && entry.numbers.length === read.numbers.length;
    return { geometry, normals: read.normals, numbers: own ? read.numbers : read.numbers.map((n) => n * 10) };
  }
  const geometry = dieGeometry(type, size, pack);
  return { geometry, ...dieFaceNormals(type, geometry) };
}
