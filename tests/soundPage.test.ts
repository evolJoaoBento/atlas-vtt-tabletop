import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paletteStore } from '../src/palette/PaletteWindow';
import type { PaletteHost } from '../src/palette/paletteHost';
import { ATLAS_SOUND_VIEW, soundViewCreator } from '../src/board/SoundWindow';

function host(sound: boolean | undefined): { host: PaletteHost; calls: string[] } {
  const calls: string[] = [];
  const made = {
    selectTool: () => {}, setDiceLogOpen: () => {}, setLootRollerOpen: () => {}, initiativeOpen: () => false, setInitiativeOpen: () => {},
    openSceneBrowser: () => {}, playerViewOpen: () => false, togglePlayerView: () => {}, playerFrozen: () => false, togglePlayerFreeze: () => {},
    presentInAtlas: () => {}, openInAtlas: (page?: string) => calls.push(`atlas:${page}`),
    ...(sound !== undefined && { openSoundPage: () => { calls.push('sound'); return sound; } }),
  } as PaletteHost;
  return { host: made, calls };
}

/** What Atlas's palette entries do: the Sound page entry names the page, then opens the DM screen. */
function openScreen(store: { getState(): { setDMScreenPage(page: string): void; setDMScreenOpen(open: boolean): void } }, page: string): void {
  store.getState().setDMScreenPage(page);
  store.getState().setDMScreenOpen(true);
}

test("the palette's Open Sound page shows Atlas's Sound page on the board", () => {
  const { host: made, calls } = host(true);
  openScreen(paletteStore(made, () => {}), 'sound');
  assert.deepEqual(calls, ['sound']);
});

test("the DM screen's other page, or no Atlas Sound page, still opens Atlas's DM screen in Atlas", () => {
  const shown = host(true);
  openScreen(paletteStore(shown.host, () => {}), 'statblocks');
  assert.deepEqual(shown.calls, ['atlas:dm-screen']);
  const none = host(false);
  openScreen(paletteStore(none.host, () => {}), 'sound');
  assert.deepEqual(none.calls, ['sound', 'atlas:dm-screen']);
  const older = host(undefined);
  openScreen(paletteStore(older.host, () => {}), 'sound');
  assert.deepEqual(older.calls, ['atlas:dm-screen']);
});

test('the page chosen is used once: opening the DM screen again afterwards is the DM screen', () => {
  const { host: made, calls } = host(true);
  const store = paletteStore(made, () => {});
  openScreen(store, 'sound');
  store.getState().setDMScreenOpen(true);
  assert.deepEqual(calls, ['sound', 'atlas:dm-screen']);
});

test("Atlas's Sound page is found by the view type Atlas registers it under", () => {
  const creator = () => ({}) as never;
  assert.equal(soundViewCreator({ viewRegistry: { getViewCreatorByType: (type: string) => (type === ATLAS_SOUND_VIEW ? creator : undefined) } } as never), creator);
  assert.equal(soundViewCreator({ viewRegistry: { viewByType: { [ATLAS_SOUND_VIEW]: creator } } } as never), creator);
  assert.equal(soundViewCreator({ viewRegistry: { getViewCreatorByType: () => undefined } } as never), null);
  assert.equal(soundViewCreator({} as never), null);
});
