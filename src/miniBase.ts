/** The base drawn under a mini that has none of its own, shared by the board and the picker's preview. */
import * as THREE from 'three';

/** How thick it is, and how much of the token's footprint it covers, as shares of the token's diameter. */
export const MINI_BASE_THICKNESS = 0.07;
export const MINI_BASE_FILL = 0.96;
export const MINI_BASE_COLOR = 0x2b2b30;

/** A round or square base for a token `diameter` wide, standing on y = 0. */
export function miniBaseGeometry(kind: 'round' | 'square', diameter: number): THREE.BufferGeometry {
  const size = diameter * MINI_BASE_FILL;
  const thickness = diameter * MINI_BASE_THICKNESS;
  return kind === 'square' ? new THREE.BoxGeometry(size, thickness, size) : new THREE.CylinderGeometry(size / 2, size / 2, thickness, 64);
}
