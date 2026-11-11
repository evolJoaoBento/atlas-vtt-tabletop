import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { augmentedCamera, augmentedProjection, isAugmentedView, roomPlacement, type AugmentedView } from '../src/board/augmented';

const close = (a: number, b: number, what: string, tolerance = 1e-6): void => assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b}`);

function view(rotation: number[], translation: number[], squareMm = 25): AugmentedView {
  return { rotation, translation, squareMm, anchor: null, frustum: { left: -0.5, right: 0.5, top: -0.7, bottom: 0.7 } };
}

test('a camera straight over the sheet stands over the anchor, looking down with the map up the picture', () => {
  // 400 mm over the middle, the picture's right along the sheet's right and its down along the page.
  const camera = augmentedCamera(view([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 400]), 50, { x: 300, z: 200 });
  close(camera.position.x, 300, 'x');
  close(camera.position.y, 400 * (50 / 25), 'height in board units');
  close(camera.position.z, 200, 'z');
  const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  close(ahead.y, -1, 'looks down');
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  close(up.z, -1, 'the map\'s top is up the picture');
});

test('a board point shows where the tracked camera sees the sheet point under it', () => {
  // Any turn and place of the camera.
  const turn = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(2.3, -0.4, 0.7));
  const e = turn.elements;
  const rotation = [e[0]!, e[4]!, e[8]!, e[1]!, e[5]!, e[9]!, e[2]!, e[6]!, e[10]!];
  const translation = [30, -45, 380];
  const pose = view(rotation, translation, 20);
  const unitsPerSquare = 64;
  const anchor = { x: 500, z: 260 };
  const camera = augmentedCamera(pose, unitsPerSquare, anchor);
  const three = new THREE.PerspectiveCamera();
  three.position.copy(camera.position);
  three.quaternion.copy(camera.quaternion);
  three.updateMatrixWorld();
  three.projectionMatrix.copy(augmentedProjection(pose.frustum, 1, 100_000));
  const scale = unitsPerSquare / pose.squareMm;
  for (const sheet of [[0, 0, 0], [40, -60, 0], [-80, 25, -15]] as const) {
    // The vision camera's picture point of the sheet point, as a tangent.
    const [x, y, z] = sheet;
    const cx = rotation[0]! * x + rotation[1]! * y + rotation[2]! * z + translation[0]!;
    const cy = rotation[3]! * x + rotation[4]! * y + rotation[5]! * z + translation[1]!;
    const cz = rotation[6]! * x + rotation[7]! * y + rotation[8]! * z + translation[2]!;
    // The same point on the board: sheet (x, y, z) is board (x, -z, y), grown to board units about the anchor.
    const board = new THREE.Vector3(anchor.x + x * scale, -z * scale, anchor.z + y * scale);
    const ndc = board.clone().project(three);
    const { left, right, top, bottom } = pose.frustum;
    close(ndc.x, ((cx / cz - left) / (right - left)) * 2 - 1, 'picture x', 1e-6);
    close(ndc.y, -(((cy / cz - top) / (bottom - top)) * 2 - 1), 'picture y', 1e-6);
  }
});

test('only a whole pose is taken', () => {
  assert.equal(isAugmentedView(view([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1])), true);
  assert.equal(isAugmentedView(view([1, 0, 0], [0, 0, 1])), false);
  assert.equal(isAugmentedView(view([1, 0, 0, 0, 1, 0, 0, 0, Number.NaN], [0, 0, 1])), false);
  assert.equal(isAugmentedView({ ...view([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1]), squareMm: 0 }), false);
  assert.equal(isAugmentedView({ ...view([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1]), frustum: { left: 1, right: -1, top: -1, bottom: 1 } }), false);
  assert.equal(isAugmentedView(null), false);
});

test('room tracking stands the board at the point, at its size on the table, facing the way asked', () => {
  const anchor = { x: 700, z: 500 };
  const rig = roomPlacement({ position: [1, 0.8, -2], yaw: Math.PI / 2, squareMm: 25, anchor: null }, 50, anchor)!;
  const at = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).applyMatrix4(rig);
  const point = at(1, 0.8, -2);
  close(point.x, 700, 'anchor x');
  close(point.y, 0, 'on the table');
  close(point.z, 500, 'anchor z');
  // A metre is 1000 / 25 squares of 50 units; 10 cm up is 200 units up.
  close(at(1, 0.9, -2).y, 200, 'height', 1e-6);
  // Facing a quarter turn: the map's up (−z on the board) points along the room's −x.
  const up = at(0.9, 0.8, -2).sub(point);
  close(up.z, -200, 'map up', 1e-6);
  close(up.x, 0, 'no sideways', 1e-6);
  assert.equal(roomPlacement({ position: [0, 0], yaw: 0, squareMm: 25, anchor: null }, 50, anchor), null);
});

test('the lowest scene of a stack is the table: a scene stacked higher stands above it', () => {
  // The scene shown is 3 squares above the lowest one (its floor 150 units up from the lowest's).
  const base = augmentedCamera(view([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 400]), 50, { x: 0, y: -150, z: 0 });
  // The camera 400 mm over the table is 800 units over the lowest floor: 650 over the shown one.
  close(base.position.y, 800 - 150, 'over the shown floor');
  const rig = roomPlacement({ position: [0, 0, 0], yaw: 0, squareMm: 25, anchor: null }, 50, { x: 0, y: -150, z: 0 })!;
  // The table's surface is the lowest floor.
  close(new THREE.Vector3(0, 0, 0).applyMatrix4(rig).y, -150, 'the table is the lowest floor');
});
