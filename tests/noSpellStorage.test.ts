import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The tests run from the repository root (`npm test`).
const source = (path: string): string => readFileSync(path, 'utf8');

test("spells and templates are kept nowhere but in Atlas's measures: the GM's board has no list of its own, and asks Connect for none", () => {
  const view = source('src/board/BoardView.ts');
  assert.doesNotMatch(view, /localSpells|nextLocalSpell/, 'the board view keeps spells of its own');
  assert.doesNotMatch(view, /overlay\.(templates|spells)/, "the board view reads Connect's lists");
  assert.doesNotMatch(view, /\.(castSpell|eraseSpell|clearSpells|addTemplate|eraseTemplate|clearTemplates)\b/, 'the board view keeps spells or templates through Connect');
  assert.match(view, /castsOfMeasures\(/, "the board's spells are read from the map's measures");
  assert.match(view, /marksOfMeasures\(/, "the board's templates are read from the map's measures");
  const contract = source('src/connectContract.ts');
  assert.doesNotMatch(contract, /\b(castSpell|eraseSpell|clearSpells|addTemplate|eraseTemplate|clearTemplates)\??\(/, "Connect's session keeps no spell or template for the board");
  assert.doesNotMatch(contract, /templates: readonly BoardSessionTemplate\[\]/, "Connect's session hands the board no list");
});
