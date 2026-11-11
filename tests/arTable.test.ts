import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placedTable, placeSurvey, readSavedTable, readSurvey, surveyToMap, type ArSurvey, type SavedArTable } from '../src/arTable';
import { BoardData, readBoardData } from '../src/board/boardData';
import { arTableOf } from '../src/boardLook';
import { isAugmentedView } from '../src/board/augmented';

const close = (a: number, b: number, what: string, tolerance = 1e-6): void => assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b}`);

const survey: ArSurvey = {
  squareMm: 25,
  groups: [
    { group: 'mat-0', x: 0, y: 0, heading: 0, w: 210, h: 297 },
    { group: 'mat-1', x: 230, y: 10, heading: 0.1, w: 210, h: 297 },
    { group: 'card-14', x: -150, y: 200, heading: -0.4, w: 70, h: 68 },
  ],
};

test('a survey must be well formed', () => {
  assert.deepEqual(readSurvey(survey), survey);
  assert.equal(readSurvey({ ...survey, groups: [] }), null);
  assert.equal(readSurvey({ ...survey, groups: [...survey.groups, survey.groups[0]] }), null, 'a sheet twice');
  assert.equal(readSurvey({ ...survey, groups: [{ ...survey.groups[0], group: 'other' }] }), null);
  assert.equal(readSurvey({ ...survey, squareMm: Number.NaN }), null);
});

test('the placed table puts each sheet on the map in millimetres from its top left, turned with it', () => {
  const saved: SavedArTable = { survey, place: { x: 10, y: 4, turn: Math.PI / 2 } };
  const table = placedTable(saved);
  assert.equal(table.squareMm, 25);
  // The survey's origin on square (10, 4): 250 mm, 100 mm.
  close(table.groups[0].x, 250, 'origin x');
  close(table.groups[0].y, 100, 'origin y');
  // A quarter turn takes the survey's x to the map's y.
  close(table.groups[1].x, 250 - 10, 'turned x');
  close(table.groups[1].y, 100 + 230, 'turned y');
  close(table.groups[1].heading, 0.1 + Math.PI / 2, 'heading turned');
});

test('a new survey lands in the middle of the view, unturned', () => {
  const saved = placeSurvey(survey, null, { x: 20, y: 15 });
  assert.equal(saved.place.turn, 0);
  const xs = survey.groups.map((g) => surveyToMap(saved, g.x, g.y).x);
  close((Math.min(...xs) + Math.max(...xs)) / 2, 20 * 25, 'middle x');
});

test('a survey taken again keeps the sheets where the GM placed them (another origin, another turn)', () => {
  const before: SavedArTable = { survey, place: { x: 12, y: 9, turn: 0.3 } };
  // The same sheets seen from another first sheet: shifted and turned in the new survey's frame.
  const shift = { x: -230, y: -10, turn: -0.1 };
  const c = Math.cos(shift.turn);
  const s = Math.sin(shift.turn);
  const again: ArSurvey = {
    squareMm: 30,
    groups: survey.groups.map((g) => ({ ...g, x: c * (g.x + shift.x) - s * (g.y + shift.y), y: s * (g.x + shift.x) + c * (g.y + shift.y), heading: g.heading + shift.turn })),
  };
  const after = placeSurvey(again, before, { x: 0, y: 0 });
  assert.equal(after.survey.squareMm, 25, 'the GM\'s square size stays');
  for (const [i, g] of again.groups.entries()) {
    const was = surveyToMap(before, survey.groups[i].x, survey.groups[i].y);
    const now = surveyToMap(after, g.x, g.y);
    close(now.x, was.x, `${g.group} x`, 1e-6);
    close(now.y, was.y, `${g.group} y`, 1e-6);
  }
});

test('a map keeps its AR table through a save and a load, and gives it placed to the phones', () => {
  const data = new BoardData();
  const saved: SavedArTable = { survey, place: { x: 3, y: 2, turn: 0 } };
  data.setArTable('a.atlasmap', saved);
  const loaded = new BoardData(readBoardData(JSON.parse(JSON.stringify(data.toJSON()))));
  assert.deepEqual(loaded.arTable('a.atlasmap'), saved);
  assert.deepEqual(arTableOf(loaded, 'a.atlasmap').arTable, placedTable(saved));
  loaded.setArTable('a.atlasmap', null);
  assert.equal(loaded.arTable('a.atlasmap'), null);
  assert.deepEqual(arTableOf(loaded, 'a.atlasmap'), {});
  assert.equal(readSavedTable({ survey, place: { x: 'x', y: 0, turn: 0 } }), null);
});

test('an AR view may say where on the map the sheet\'s origin is', () => {
  const view = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 400], squareMm: 25, anchor: null, frustum: { left: -0.5, right: 0.5, top: -0.7, bottom: 0.7 } };
  assert.ok(isAugmentedView({ ...view, origin: { x: 0, y: 0 } }));
  assert.ok(!isAugmentedView({ ...view, origin: { x: Number.NaN, y: 0 } }));
});
