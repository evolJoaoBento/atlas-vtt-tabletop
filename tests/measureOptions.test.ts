import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MEASURE_TOOL } from '../src/atlasPort/app/measure/measureTypes';
import {
  ACCENT_SWATCH,
  MEASURE_COLOR_SWATCHES,
  MEASURE_MODES,
  colourWithEffect,
  measureColorOfSwatch,
  readMeasureToolOptions,
  swatchOfMeasureColor,
} from '../src/board/measureOptions';
import { marksOfMeasures, measureWrite, readMeasures } from '../src/board/boardMeasures';
import { shapeOutline } from '../src/board/marks';
import { PlayerToolState } from '../src/board/playerTools';

test('MEASURE_MODES lists Atlas modes in exact order', () => {
  assert.deepEqual(MEASURE_MODES, ['ruler', 'circle', 'cone', 'square', 'line', 'ranges']);
});

test('MEASURE_COLOR_SWATCHES puts accent first and excludes black', () => {
  assert.equal(MEASURE_COLOR_SWATCHES[0]?.value, ACCENT_SWATCH);
  assert.equal(MEASURE_COLOR_SWATCHES.some((s) => s.value === '#000000'), false);
  assert.equal(swatchOfMeasureColor(null), ACCENT_SWATCH);
  assert.equal(swatchOfMeasureColor('#e93147'), '#e93147');
  assert.equal(measureColorOfSwatch(ACCENT_SWATCH), null);
  assert.equal(measureColorOfSwatch('#086ddd'), '#086ddd');
});

test('colourWithEffect takes the effect default colour unless a custom colour was chosen for the previous effect', () => {
  assert.equal(colourWithEffect(null, null, 'fire'), '#ec7500');
  assert.equal(colourWithEffect('#ec7500', 'fire', 'frost'), '#8ad1f8');
  // Custom colour chosen while fire was active stays when switching to frost.
  assert.equal(colourWithEffect('#e93147', 'fire', 'frost'), '#e93147');
});

test('readMeasureToolOptions validates persisted values and falls back to DEFAULT_MEASURE_TOOL', () => {
  assert.deepEqual(readMeasureToolOptions(undefined), DEFAULT_MEASURE_TOOL);
  assert.deepEqual(readMeasureToolOptions({ mode: 'bogus', keep: 'yes', players: 0, color: 'red', lineWidth: -2, effect: 'lava' }), DEFAULT_MEASURE_TOOL);
  assert.deepEqual(
    readMeasureToolOptions({ mode: 'square', keep: true, players: false, color: '#08b94e', lineWidth: 2, effect: 'mist' }),
    { mode: 'square', keep: true, players: false, color: '#08b94e', lineWidth: 2, effect: 'mist' },
  );
  // Ranges is never persisted as the active mode if invalid; valid modes stay.
  assert.equal(readMeasureToolOptions({ mode: 'line' }).mode, 'line');
});

test('measureWrite keeps ruler, square, and wide line with colour, hidden, effect, and level; clear removes all kept on level', () => {
  const added = measureWrite(
    {
      add: {
        shape: 'square',
        points: [{ x: 10, y: 20 }, { x: 110, y: 20 }],
        color: '#ec7500',
        hidden: true,
        effect: 'fire',
      },
    },
    [],
    'upper',
  );
  assert.deepEqual(added, {
    add: {
      shape: 'square',
      points: [{ x: 10, y: 20 }, { x: 110, y: 20 }],
      color: '#ec7500',
      hidden: true,
      effect: 'fire',
      level: 'upper',
    },
  });

  // Reading that kept measure back marks it gmOnly (hidden from players) and preserves shape & colour.
  const marks = marksOfMeasures(readMeasures({ m1: { ...(added as { add: object }).add, id: 'm1', kind: 'measure' } }), { cell: 70, accent: '#7c5cff' });
  assert.equal(marks.length, 1);
  assert.equal(marks[0]?.shape, 'square');
  assert.equal(marks[0]?.color, '#ec7500');
  assert.equal(marks[0]?.gmOnly, true);

  // Ruler drops effect (Atlas: a ruler takes no effect) and keeps waypoints.
  const ruler = measureWrite(
    {
      add: {
        shape: 'ruler',
        points: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }],
        effect: 'fire',
      },
    },
    [],
    null,
  );
  assert.deepEqual(ruler, {
    add: {
      shape: 'ruler',
      points: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }],
    },
  });

  // Line keeps its width in pixels.
  const wideLine = measureWrite(
    {
      add: {
        shape: 'line',
        points: [{ x: 0, y: 0 }, { x: 210, y: 0 }],
        width: 70,
      },
    },
    [],
    null,
  );
  assert.deepEqual(wideLine, {
    add: {
      shape: 'line',
      points: [{ x: 0, y: 0 }, { x: 210, y: 0 }],
      width: 70,
    },
  });

  // Clear removes all measures on the shown level in one batch.
  const kept = readMeasures({
    a: { id: 'a', kind: 'measure', shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] },
    b: { id: 'b', kind: 'measure', shape: 'square', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] },
  });
  assert.deepEqual(measureWrite({ clear: true }, kept, null), { remove: ['a', 'b'] });
});

test('PlayerToolState supports square shape and ruler waypoints', () => {
  const tools = new PlayerToolState();
  tools.selectShape('square');
  tools.down({ x: 0, y: 0 }, 0);
  tools.move({ x: 100, y: 0 }, 10);
  assert.deepEqual(tools.overlay().measure, { shape: 'square', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
  const outline = shapeOutline('square', { x: 0, y: 0 }, { x: 100, y: 0 }, Math.PI / 2);
  assert.equal(outline.closed, true);
  assert.equal(outline.points.length, 4);

  tools.selectShape('ruler');
  tools.down({ x: 0, y: 0 }, 0);
  tools.move({ x: 70, y: 0 }, 10);
  assert.equal(tools.addWaypoint(), true);
  tools.move({ x: 70, y: 70 }, 20);
  assert.deepEqual(tools.overlay().measure, {
    shape: 'ruler',
    start: { x: 0, y: 0 },
    end: { x: 70, y: 70 },
    waypoints: [{ x: 70, y: 0 }],
  });
});
