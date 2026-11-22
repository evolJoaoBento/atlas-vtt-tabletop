import assert from 'node:assert/strict';
import { test } from 'node:test';
import { at } from '../src/atlasPort/atlasText';
import { peekButtonState, pointerKindOf } from '../src/board/lightingPeek';

test("the peek's texts are Atlas's own: the key's hint and the button's name", () => {
  assert.equal(at('hotkey.lightingPeek'), 'Hold to see what the players see');
  assert.equal(at('toolbar.peek'), 'Hold to see what the players see');
});

test("a finger is a coarse pointer, as Atlas's device profile tells it", () => {
  assert.equal(pointerKindOf(false, true, false), 'coarse');
  assert.equal(pointerKindOf(false, false, true), 'fine');
  assert.equal(pointerKindOf(false, null, false), 'fine');
  // On a mobile device a fine pointer counts only where it hovers (a mouse or trackpad).
  assert.equal(pointerKindOf(true, false, false), 'coarse');
  assert.equal(pointerKindOf(true, false, true), 'fine');
});

test("the peek button is offered to a finger, in Play and Edit mode, where the board has the peek", () => {
  const base = { coarse: true, mode: 'play' as const, hasPeek: true, gmView: true, held: false };
  assert.deepEqual(peekButtonState(base), { shown: true, disabled: false, pressed: false });
  assert.equal(peekButtonState({ ...base, mode: 'edit' }).shown, true);
  assert.equal(peekButtonState({ ...base, coarse: false }).shown, false);
  assert.equal(peekButtonState({ ...base, hasPeek: false }).shown, false);
  assert.equal(peekButtonState({ ...base, mode: 'cinematic' }).shown, false);
  assert.equal(peekButtonState({ ...base, mode: null }).shown, false);
});

test("in session view the map shows the players' picture already: the button takes no press, and is never held", () => {
  const base = { coarse: true, mode: 'play' as const, hasPeek: true, gmView: false, held: true };
  assert.deepEqual(peekButtonState(base), { shown: true, disabled: true, pressed: false });
  assert.deepEqual(peekButtonState({ ...base, gmView: true }), { shown: true, disabled: false, pressed: true });
});
