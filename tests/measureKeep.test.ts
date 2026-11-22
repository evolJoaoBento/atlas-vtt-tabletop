import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAtlasMeasureTool, writeAtlasMeasureTool } from '../src/board/atlasMeasureTool';
import { DEFAULT_MEASURE_TOOL } from '../src/board/measureOptions';
import { LIVE_DISSOLVE_MS, MEASURE_FADE_MS, releaseKeeps, releasedAlpha } from '../src/board/measureRelease';

test("Atlas's Measure tool choices are read from the view's state, where it has them", () => {
  const state = { measureTool: { ...DEFAULT_MEASURE_TOOL, mode: 'cone', keep: true }, setMeasureTool: () => undefined };
  assert.deepEqual(readAtlasMeasureTool(state), { ...DEFAULT_MEASURE_TOOL, mode: 'cone', keep: true });
  // No such choices: an Atlas without them, another shape, nothing at all.
  assert.equal(readAtlasMeasureTool({ measureTool: DEFAULT_MEASURE_TOOL }), null);
  assert.equal(readAtlasMeasureTool({ setMeasureTool: () => undefined }), null);
  assert.equal(readAtlasMeasureTool({ measureTool: 'x', setMeasureTool: () => undefined }), null);
  assert.equal(readAtlasMeasureTool(null), null);
});

test('a choice goes through Atlas\'s own action, and says whether it did', () => {
  const state = { measureTool: { ...DEFAULT_MEASURE_TOOL }, setMeasureTool(changes: object) { this.measureTool = { ...this.measureTool, ...changes }; } };
  assert.equal(writeAtlasMeasureTool(state, { keep: true }), true);
  assert.equal(readAtlasMeasureTool(state)?.keep, true);
  assert.equal(writeAtlasMeasureTool({ measureTool: DEFAULT_MEASURE_TOOL }, { keep: true }), false);
  assert.equal(writeAtlasMeasureTool(null, { keep: true }), false);
  assert.equal(writeAtlasMeasureTool({ measureTool: DEFAULT_MEASURE_TOOL, setMeasureTool: () => { throw new Error('boom'); } }, { keep: true }), false);
});

test('a released measurement is kept when Keep and Shift differ; the held ruler counts as Keep off', () => {
  assert.equal(releaseKeeps(true, false, false), true);
  assert.equal(releaseKeeps(false, false, false), false);
  assert.equal(releaseKeeps(true, false, true), false);
  assert.equal(releaseKeeps(false, false, true), true);
  assert.equal(releaseKeeps(true, true, false), false);
  assert.equal(releaseKeeps(true, true, true), true);
});

test('one that is not kept stays in full for two seconds less the dissolve, then dissolves', () => {
  assert.equal(MEASURE_FADE_MS, 2000);
  assert.equal(LIVE_DISSOLVE_MS, 360);
  assert.equal(releasedAlpha(0), 1);
  assert.equal(releasedAlpha(MEASURE_FADE_MS - LIVE_DISSOLVE_MS), 1);
  assert.ok(Math.abs(releasedAlpha(MEASURE_FADE_MS - LIVE_DISSOLVE_MS / 2) - 0.5) < 1e-9);
  assert.equal(releasedAlpha(MEASURE_FADE_MS), 0);
  assert.equal(releasedAlpha(MEASURE_FADE_MS + 500), 0);
});
