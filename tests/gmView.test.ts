import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readGmView, writeGmView } from '../src/board/gmView';
import { shownToPlayers } from '../src/board/playerView';
import { at } from '../src/atlasPort/atlasText';
import { TOOLBAR_BUTTONS } from '../src/board/toolbarButtons';
import type { ToolbarButtonState } from '../src/board/toolbarButtons';

test("Atlas's GM view switch is read from the view's state, where it has one", () => {
  assert.equal(readGmView({ isGMView: true, setGMView: () => undefined }), true);
  assert.equal(readGmView({ isGMView: false, setGMView: () => undefined }), false);
  // No switch: an Atlas without it, a state of another shape, nothing at all.
  assert.equal(readGmView({ isGMView: true }), null);
  assert.equal(readGmView({ setGMView: () => undefined }), null);
  assert.equal(readGmView({ isGMView: 'yes', setGMView: () => undefined }), null);
  assert.equal(readGmView(null), null);
  assert.equal(readGmView(undefined), null);
});

test('throwing the switch goes through Atlas\'s own action, and says whether it did', () => {
  const state = { isGMView: true, setGMView(on: boolean) { this.isGMView = on; } };
  assert.equal(writeGmView(state, false), true);
  assert.equal(state.isGMView, false);
  assert.equal(readGmView(state), false);
  assert.equal(writeGmView({ isGMView: true }, false), false);
  assert.equal(writeGmView(null, false), false);
  assert.equal(writeGmView({ isGMView: true, setGMView: () => { throw new Error('boom'); } }, false), false);
});

test("the switch's texts are Atlas's own, with the key filled in", () => {
  assert.equal(at('toolbar.gmView', { key: 'Shift + D' }), 'GM view (Shift + D)');
  assert.equal(at('toolbar.sessionView', { key: 'Shift + D' }), 'Session view (Shift + D)');
});

test('the palette offers the switch in Play and Edit mode, lit while in GM view', () => {
  const spec = TOOLBAR_BUTTONS['gm-view'];
  assert.deepEqual([...spec.modes], ['play', 'edit']);
  let on = true;
  const state = { actions: { gmView: () => on, setGmView: () => undefined } } as unknown as ToolbarButtonState;
  assert.equal(spec.available(state), true);
  assert.equal(spec.active?.(state), true);
  on = false;
  assert.equal(spec.active?.(state), false);
  assert.equal(spec.available({ actions: {} } as unknown as ToolbarButtonState), false);
});

test("session view shows the pins Atlas's does: readable ones that link a note players could read (`shownToPlayers`)", () => {
  assert.equal(shownToPlayers({ readable: true, notePath: 'Notes/Tavern.md' }), true);
  assert.equal(shownToPlayers({ readable: true, notePath: 'Notes/Area.md#3. Slanted Room' }), true);
  // Not marked readable: the GM's alone.
  assert.equal(shownToPlayers({ notePath: 'Notes/Tavern.md' }), false);
  assert.equal(shownToPlayers({ readable: false, notePath: 'Notes/Tavern.md' }), false);
  // Readable, but it links a scene, an encounter folder or nothing: nothing players could read.
  assert.equal(shownToPlayers({ readable: true, notePath: 'maps/crypt.atlasmap' }), false);
  assert.equal(shownToPlayers({ readable: true, notePath: 'atlas-vtt/collections/goblins/encounters/Ambush' }), false);
  assert.equal(shownToPlayers({ readable: true, notePath: null }), false);
});
