import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materialName, pickMaps, roleOf } from '../src/materialMaps';

test('a map\'s role is read from its name as Poly Haven names them; the last map word counts', () => {
  assert.deepEqual(roleOf('brick_wall_001_diff_1k.jpg'), { role: 'color', directX: false });
  assert.deepEqual(roleOf('brick_wall_001_nor_gl_1k.jpg'), { role: 'normal', directX: false });
  assert.deepEqual(roleOf('brick_wall_001_nor_dx_1k.png'), { role: 'normal', directX: true });
  assert.deepEqual(roleOf('brick_wall_001_rough_1k.jpg'), { role: 'roughness', directX: false });
  assert.deepEqual(roleOf('brick_wall_001_arm_1k.jpg'), { role: 'arm', directX: false });
  assert.deepEqual(roleOf('metal_plate_diff_2k.jpg'), { role: 'color', directX: false });
  assert.deepEqual(roleOf('metal_plate_metal_2k.jpg'), { role: 'metalness', directX: false });
  assert.equal(roleOf('brick_wall_001_disp_1k.png'), null);
  assert.equal(roleOf('brick_wall_001_diff_1k.exr'), null);
  assert.equal(roleOf('readme.txt'), null);
});

test('a material takes one map per role, an OpenGL normal map before a DirectX one, and needs a colour map', () => {
  assert.deepEqual(pickMaps(['m/x_nor_dx_1k.png', 'm/x_diff_1k.jpg', 'm/x_nor_gl_1k.png', 'm/x_arm_1k.jpg', 'm/x_disp_1k.png']), {
    color: 'm/x_diff_1k.jpg', normal: 'm/x_nor_gl_1k.png', normalDirectX: false, arm: 'm/x_arm_1k.jpg',
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
