import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materialName, pickMaps, readMaterialSettings, roleOf, tuningOf } from '../src/materialMaps';

test('a map\'s role is read from its name as Poly Haven names them; the last map word counts', () => {
  assert.deepEqual(roleOf('brick_wall_001_diff_1k.jpg'), { role: 'color', directX: false });
  assert.deepEqual(roleOf('brick_wall_001_nor_gl_1k.jpg'), { role: 'normal', directX: false });
  assert.deepEqual(roleOf('brick_wall_001_nor_dx_1k.png'), { role: 'normal', directX: true });
  assert.deepEqual(roleOf('brick_wall_001_rough_1k.jpg'), { role: 'roughness', directX: false });
  assert.deepEqual(roleOf('brick_wall_001_arm_1k.jpg'), { role: 'arm', directX: false });
  assert.deepEqual(roleOf('metal_plate_diff_2k.jpg'), { role: 'color', directX: false });
  assert.deepEqual(roleOf('metal_plate_metal_2k.jpg'), { role: 'metalness', directX: false });
  assert.deepEqual(roleOf('brick_wall_001_disp_1k.png'), { role: 'height', directX: false });
  assert.equal(roleOf('brick_wall_001_bump_1k.png'), null);
  assert.equal(roleOf('brick_wall_001_diff_1k.exr'), null);
  assert.equal(roleOf('readme.txt'), null);
});

test('a material takes one map per role, an OpenGL normal map before a DirectX one, and needs a colour map', () => {
  assert.deepEqual(pickMaps(['m/x_nor_dx_1k.png', 'm/x_diff_1k.jpg', 'm/x_nor_gl_1k.png', 'm/x_arm_1k.jpg', 'm/x_disp_1k.png']), {
    color: 'm/x_diff_1k.jpg', normal: 'm/x_nor_gl_1k.png', normalDirectX: false, arm: 'm/x_arm_1k.jpg', height: 'm/x_disp_1k.png',
  });
  assert.deepEqual(pickMaps(['x_nor_dx_1k.png', 'x_diff_1k.jpg']), { color: 'x_diff_1k.jpg', normal: 'x_nor_dx_1k.png', normalDirectX: true });
  assert.equal(pickMaps(['x_rough_1k.jpg']), null);
});

test('a material is named after its zip or its maps', () => {
  assert.equal(materialName('brick_wall_001_1k.zip'), 'brick_wall_001');
  assert.equal(materialName('brick_wall_001_diff_1k.jpg'), 'brick_wall_001');
  assert.equal(materialName('wood_planks_nor_gl_2k.png'), 'wood_planks');
  assert.equal(materialName('Mossy Stones.zip'), 'Mossy Stones');
});

test('a material\'s settings: its texture scale, kept in range, 1 when unset or unreadable', () => {
  assert.deepEqual(readMaterialSettings('{"scale": 2.5}'), { scale: 2.5 });
  assert.deepEqual(readMaterialSettings('{"scale": 500}'), { scale: 20 });
  assert.deepEqual(readMaterialSettings('{"scale": 0}'), { scale: 0.1 });
  assert.deepEqual(readMaterialSettings('not json'), { scale: 1 });
  assert.deepEqual(readMaterialSettings(null), { scale: 1 });
});

test('a material\'s texture strength: kept in range, and written only when it differs from as made', () => {
  assert.deepEqual(readMaterialSettings('{"scale": 2, "relief": 2.5, "occlusion": 1.5, "shine": 0.4}'), { scale: 2, relief: 2.5, occlusion: 1.5, shine: 0.4 });
  assert.deepEqual(readMaterialSettings('{"depth": 0.6}'), { scale: 1, depth: 0.6 });
  assert.deepEqual(readMaterialSettings('{"depth": 9}'), { scale: 1, depth: 1.5 });
  assert.deepEqual(readMaterialSettings('{"displace": 0.5}'), { scale: 1, displace: 0.5 });
  assert.deepEqual(readMaterialSettings('{"outward": 0.5}'), { scale: 1, outward: 0.5 });
  assert.deepEqual(readMaterialSettings('{"outward": 4}'), { scale: 1, outward: 1 });
  assert.deepEqual(readMaterialSettings('{"displace": 9}'), { scale: 1, displace: 1.5 });
  assert.deepEqual(readMaterialSettings('{"relief": 99, "occlusion": -3, "shine": 7}'), { scale: 1, relief: 4, occlusion: 0, shine: 1 });
  assert.deepEqual(readMaterialSettings('{"relief": 1, "occlusion": 1, "shine": 0}'), { scale: 1 });
  assert.deepEqual(readMaterialSettings('{"relief": "much"}'), { scale: 1 });
  assert.deepEqual(tuningOf(readMaterialSettings('{"relief": 2}')), { relief: 2, occlusion: 1, shine: 0, depth: 0, displace: 0, outward: 0 });
});
