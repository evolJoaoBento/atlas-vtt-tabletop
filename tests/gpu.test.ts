import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chipName, gpuChoices, parseAdapters, readPreference, readRegValue, withPreference } from '../src/gpu';

test('graphics cards are read from PowerShell\'s JSON, one or many', () => {
  const many = '[{"Name":"NVIDIA GeForce RTX 3070 Laptop GPU","AdapterRAM":4293918720},{"Name":"Intel(R) UHD Graphics","AdapterRAM":1073741824}]';
  assert.deepEqual(parseAdapters(many), [
    { name: 'NVIDIA GeForce RTX 3070 Laptop GPU', memory: 4293918720 },
    { name: 'Intel(R) UHD Graphics', memory: 1073741824 },
  ]);
  assert.deepEqual(parseAdapters('{"Name":"Intel(R) UHD Graphics","AdapterRAM":null}'), [{ name: 'Intel(R) UHD Graphics', memory: 0 }]);
  assert.deepEqual(parseAdapters(''), []);
  assert.deepEqual(parseAdapters('nope'), []);
});

test('with two cards, the high-performance one is the one with more memory, not the built-in chip', () => {
  const choices = gpuChoices([{ name: 'Intel(R) UHD Graphics', memory: 1073741824 }, { name: 'NVIDIA GeForce RTX 3070 Laptop GPU', memory: 4293918720 }]);
  assert.deepEqual(choices, { power: 'Intel(R) UHD Graphics', performance: 'NVIDIA GeForce RTX 3070 Laptop GPU' });
  // Memory unknown: the built-in chip is told by its name.
  assert.deepEqual(gpuChoices([{ name: 'AMD Radeon RX 6600M', memory: 0 }, { name: 'Intel(R) Iris(R) Xe Graphics', memory: 0 }]), { power: 'Intel(R) Iris(R) Xe Graphics', performance: 'AMD Radeon RX 6600M' });
  assert.equal(gpuChoices([{ name: 'Intel(R) UHD Graphics', memory: 1 }]), null);
  // A remote-desktop or virtual adapter is not a card to choose.
  assert.equal(gpuChoices([{ name: 'Intel(R) UHD Graphics', memory: 1 }, { name: 'Microsoft Basic Display Adapter', memory: 0 }]), null);
});

test('the chip WebGL draws on, from ANGLE\'s renderer string', () => {
  assert.equal(chipName('ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'Intel(R) UHD Graphics');
  assert.equal(chipName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x0000249D) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'NVIDIA GeForce RTX 3070 Laptop GPU');
  assert.equal(chipName('Apple M2'), 'Apple M2');
});

test('Windows\' per-app setting: read, and changed keeping whatever else the value holds', () => {
  assert.equal(readPreference(null), 0);
  assert.equal(readPreference('GpuPreference=2;'), 2);
  assert.equal(readPreference('SwapEffectUpgradeEnable=1;GpuPreference=1;'), 1);
  assert.equal(withPreference(null, 2), 'GpuPreference=2;');
  assert.equal(withPreference('GpuPreference=1;', 2), 'GpuPreference=2;');
  assert.equal(withPreference('SwapEffectUpgradeEnable=1;', 2), 'SwapEffectUpgradeEnable=1;GpuPreference=2;');
  assert.equal(withPreference('AutoHDREnable=1;GpuPreference=2;', 0), 'AutoHDREnable=1;GpuPreference=0;');
});

test('reg query\'s output gives the value\'s data', () => {
  const out = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\DirectX\\UserGpuPreferences\r\n    C:\\Users\\x\\AppData\\Local\\Obsidian\\Obsidian.exe    REG_SZ    GpuPreference=2;\r\n\r\n';
  assert.equal(readRegValue(out), 'GpuPreference=2;');
  assert.equal(readRegValue(''), null);
});
