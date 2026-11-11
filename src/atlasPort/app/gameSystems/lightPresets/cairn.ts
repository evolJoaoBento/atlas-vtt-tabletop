// Atlas source: src/app/gameSystems/lightPresets/cairn.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { TORCH_LOOK, lightsOf } from './lightPresetHelpers';

/** Cairn 2e: "Torches and other radial sources of light illuminate 40ft of dungeon." */
export const CAIRN_LIGHTS = lightsOf('cairn', 'feet', {
  torch: { name: 'Torch', bright: 40, dim: 40, ...TORCH_LOOK },
});
