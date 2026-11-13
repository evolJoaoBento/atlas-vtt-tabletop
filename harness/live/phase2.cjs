// node harness/live/phase2.cjs [steps]
// The Atlas fusion Phase 2 live check, in the throwaway vault's Obsidian (role `fusion`, port 9311, Atlas 0.15.0, the
// Tabletop and Connect builds under test). It runs Phase 1's check again (nothing regressed: its own results land in
// phase1-live/), then the steps Phase 2 adds: token height, a measure that counts it, movement steps and the
// drag-distance choice on the drag ruler, a Large token's snap on a hex scene, and no map file written by refused edits.
// Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase2-live/results.json; a failed step does not stop the run.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { connect, sleep } = require('./obs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.superpowers/sdd/2026-11-13-atlas-fusion/phase2-live');
const PORT = 9311;
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? new Set(process.argv[2].split(',').map(Number)) : null;
const results = [];
const record = (step, name, pass, evidence) => {
  results.push({ step, name, pass: !!pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}. ${name}${pass ? '' : `  ${JSON.stringify(evidence).slice(0, 800)}`}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
};

// What the steps use inside the page, beside Phase 1's helpers (`window.__L`, set up again here).
const PAGE = `
window.__P = (() => {
  const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ws = app.workspace;
  const P = {
    sleep, CELLAR: DIR + 'Probe Cellar.atlasmap', COVE: DIR + 'Probe Cove.atlasmap', HEX: DIR + 'Fusion Hex.atlasmap',
    tt: () => app.plugins.plugins['tabletop-for-atlas'],
    atlas: () => app.plugins.plugins['atlas-vtt'],
    boards: () => ws.getLeavesOfType('atlas-tabletop-board'),
    boardOf: (p) => P.boards().find((l) => l.view && l.view.mapPath === p) || null,
    atlasView: () => { const l = ws.getLeavesOfType('atlas-vtt')[0]; return l ? l.view : null; },
    store: () => { const v = P.atlasView(); return v && v.atlasStore ? v.atlasStore : null; },
    held: (p) => { const s = P.store() && P.store().getState(); return !!s && s.mapPath === p && s.mapLoaded !== false && s.isMapLoading !== true; },
    renderer: () => { try { return P.atlasView().serviceManager.getRendererService().getRenderer().getTokenRenderer(); } catch { return null; } },
    until: async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return Date.now() - t; } catch {} await sleep(100); } return null; },
    openBoard: async (p) => { await P.tt().openBoard(p); await P.until(() => { const l = P.boardOf(p); return l && l.view.board && l.view.map; }, 30000); await sleep(800); return P.boardOf(p); },
    focus: async (leaf) => { ws.setActiveLeaf(leaf, { focus: true }); await sleep(300); },
    hold: async (p) => { const leaf = P.boardOf(p) || await P.openBoard(p); await P.focus(leaf); await P.until(() => P.held(p), 20000); await sleep(800); return leaf; },
    collection: () => { const a = P.atlasView().serviceManager.getAssetService(); const id = a.getCollectionForMap(P.CELLAR); return { a, id, settings: a.getCollectionSettings(id) }; },
    firstTokens: (n = 2) => Object.values(P.store().getState().objects.tokens).filter((t) => !t.offMap).slice(0, n),
  };
  return P;
})();
return true;`;

async function open() {
  const o = await connect(PORT);
  for (let i = 0; i < 60; i++) { if (await o.ev("return !!app.plugins && !!app.plugins.plugins && !!app.workspace.layoutReady").catch(() => false)) break; await sleep(1000); }
  await sleep(4000);
  await o.ev(PAGE);
  return o;
}

async function step(n, name, run) {
  if (only && !only.has(n)) return;
  try {
    const out = await run();
    record(n, name, out.pass, out.evidence);
  } catch (error) {
    record(n, name, false, { threw: String(error && error.message || error) });
  }
}

(async () => {
  // Phase 1's steps first, in its own run (it restarts Obsidian for its Atlas 0.14 step and ends on 0.15.0).
  if (!only || only.has(0)) {
    let text = '';
    try { text = execSync(`node "${path.join(__dirname, 'phase1.cjs')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 900000 }); } catch (error) { text = String(error.stdout || error.message); }
    const summary = /(\d+)\/(\d+) steps passed/.exec(text);
    record(0, "Phase 1's live check again: nothing regressed", summary && summary[1] === summary[2], { summary: summary ? summary[0] : null, failed: text.split('\n').filter((line) => line.startsWith('FAIL')) });
  }
  const o = await open();

  await step(17, 'a token given a height through Atlas stands that high on the board, and lands when set back', async () => {
    const out = await o.ev(`
      const P = window.__P;
      const leaf = await P.hold(P.CELLAR);
      const board = leaf.view.board;
      const [token] = P.firstTokens(1);
      const unit = board.host.measurement().unitDistance;
      const cell = board.map.grid.size;
      const entryY = () => board.tokens.get(token.id).piece.object3d.position.y;
      // On the floor first, and settled there (a figure eases to where it stands).
      const original = token.elevation;
      P.store().getState().updateToken(token.id, { elevation: undefined });
      board.wake(true);
      let last = NaN;
      await P.until(async () => { const y = entryY(); const still = Math.abs(y - last) < 0.01; last = y; await P.sleep(150); return still; }, 6000);
      const floor = entryY();
      P.store().getState().updateToken(token.id, { elevation: unit * 3 });
      const rose = await P.until(() => Math.abs(entryY() - floor - 3 * cell) < 1, 2000);
      const drop = board.tokens.get(token.id).piece.dropDepth;
      P.store().getState().updateToken(token.id, { elevation: original });
      const landed = await P.until(() => Math.abs(entryY() - floor) < 1, 3000);
      return { original: original ?? null, token: token.id, unit, cell, floor, rose, drop, landed, after: entryY() };`);
    return { pass: out.rose !== null && Math.abs(out.drop - 3 * out.cell) < 1 && out.landed !== null, evidence: out };
  });

  await step(18, "a ruler from a lifted token to one on the floor reads Atlas's distance with the height counted", async () => {
    const out = await o.ev(`
      const P = window.__P;
      const leaf = await P.hold(P.CELLAR);
      const board = leaf.view.board;
      const [a, b] = P.firstTokens(2);
      const m = board.host.measurement();
      const cell = board.map.grid.size;
      // b two squares east of a, a three squares up.
      P.store().getState().updateToken(b.id, { x: a.x + 2 * cell, y: a.y });
      P.store().getState().updateToken(a.id, { elevation: m.unitDistance * 3 });
      await P.until(() => board.tokens.get(b.id).at.x === a.x + 2 * cell && board.tokens.get(a.id).token.elevation > 0, 4000);
      await P.sleep(500);
      const seen = [];
      const set = board.marks.setOverlay.bind(board.marks);
      board.marks.setOverlay = (measure, ...rest) => { if (measure) seen.push(measure.label); return set(measure, ...rest); };
      board.toolbarActions().selectMeasure('line');
      board.tools.down({ x: a.x, y: a.y }, 0);
      board.tools.move({ x: a.x + 2 * cell, y: a.y }, 16);
      board.showToolOverlay();
      board.tools.cancel();
      board.marks.setOverlay = set;
      board.toolbarActions().selectMeasure('line');
      P.store().getState().updateToken(a.id, { elevation: undefined });
      P.store().getState().updateToken(b.id, { x: b.x, y: b.y });
      // Atlas's own count: 2 across and 3 up, by the collection's diagonal rule, in its units.
      const rule = m.diagonalRule;
      const cells = rule === 'manhattan' ? 5 : rule === 'euclidean' ? Math.hypot(2, 3) : 3;
      return { label: seen[0] ?? null, rule, unit: m.unitDistance, unitName: m.unitName ?? null, unitType: m.unitType, cells, expected: cells * m.unitDistance };`);
    const number = out.label ? Number(String(out.label).replace(/[^0-9.]/g, '')) : NaN;
    return { pass: Math.abs(number - out.expected) < 0.06 * out.expected + 0.01, evidence: out };
  });

  await step(19, 'movement steps colour the drag ruler against the speed; the drag-distance choice hides it', async () => {
    const out = await o.ev(`
      const P = window.__P;
      const leaf = await P.hold(P.CELLAR);
      const board = leaf.view.board;
      const { a, id, settings } = P.collection();
      const before = settings.movement;
      const steps = [{ name: 'Move', multiple: 1, color: '#22c55e' }, { name: 'Dash', multiple: 2, color: '#eab308' }];
      await a.updateCollectionSettings(id, { movement: { steps, countPerTurn: false } });
      const [token] = P.firstTokens(1);
      P.store().getState().updateToken(token.id, { speed: 30 });
      await P.sleep(800);
      const cell = board.map.grid.size;
      const entry = board.tokens.get(token.id);
      const home = { ...entry.at };
      const drag = (cells) => {
        board.press = { kind: 'token', id: token.id, x: home.x, y: home.y, moved: true, grab: { dx: 0, dy: 0 }, start: { ...home }, waypoints: [] };
        entry.at = { x: home.x + cells * cell, y: home.y };
        board.clearRuler();
        board.drawRuler();
        const state = board.rulerState ? { label: board.rulerState.label, color: board.rulerState.color ?? null } : null;
        board.press = null; entry.at = { ...home }; board.clearRuler();
        return state;
      };
      const unit = board.host.measurement().unitDistance;
      const four = drag(4);
      const settingsService = P.atlas().settingsService;
      const choice = settingsService.getDragDistance();
      settingsService.setDragDistance('never');
      const hidden = drag(4);
      settingsService.setDragDistance(choice);
      P.store().getState().updateToken(token.id, { speed: undefined });
      await a.updateCollectionSettings(id, { movement: before });
      return { unit, four, hidden, choice, restored: settingsService.getDragDistance() };`);
    const expected = `${4 * out.unit} / 30`;
    return { pass: out.unit === 5 ? (out.four && out.four.label.startsWith(expected) && out.four.color === '#22c55e' && out.hidden === null && out.restored === out.choice) : false, evidence: { ...out, expected } };
  });

  await step(20, "a Large token dragged on a hex scene lands where Atlas's own snap puts it", async () => {
    const out = await o.ev(`
      const P = window.__P;
      const leaf = await P.hold(P.HEX);
      const board = leaf.view.board;
      const grid = P.renderer().gridSystem;
      const points = [{ x: 333, y: 271 }, { x: 512, y: 640 }, { x: 901, y: 455 }];
      const sizes = [1, 1.5, 2];
      const rows = [];
      // The board's landing for a dragged token is the end of its drag ruler (\`rulerPoints\`): carried to \`p\` from far away.
      const entry = [...board.tokens.values()][0];
      const kept = { at: { ...entry.at }, token: entry.token };
      for (const size of sizes) for (const p of points) {
        const atlas = grid.snapTokenCenter(p.x, p.y, size);
        entry.token = { ...kept.token, size };
        entry.at = { ...p };
        board.press = { kind: 'token', id: entry.token.id, x: 0, y: 0, moved: true, grab: { dx: 0, dy: 0 }, start: { x: -5000, y: -5000 }, waypoints: [] };
        const landing = (board.rulerPoints() || []).at(-1) || null;
        rows.push({ size, p, atlas: { x: atlas.x, y: atlas.y }, ours: landing });
      }
      board.press = null; entry.at = kept.at; entry.token = kept.token;
      return { type: board.map.grid.type, rows };`);
    const off = out.rows.filter((r) => !r.ours || Math.hypot(r.atlas.x - r.ours.x, r.atlas.y - r.ours.y) > 0.5);
    return { pass: /hex/.test(out.type) && off.length === 0, evidence: { type: out.type, off, rows: out.rows.length } };
  });

  await step(21, 'edits on a map Atlas does not hold are refused, and no map file is written', async () => {
    const out = await o.ev(`
      const P = window.__P;
      await P.hold(P.CELLAR);
      const cove = P.boardOf(P.COVE) || await P.openBoard(P.COVE);
      await P.hold(P.CELLAR);
      const files = app.vault.getFiles().filter((f) => f.extension === 'atlasmap');
      const before = Object.fromEntries(files.map((f) => [f.path, f.stat.mtime]));
      // Writes Atlas does not come to take: the host's wait answers null while it holds another map.
      const writer = cove.view.services.writer;
      const tokenId = cove.view.map.tokens[0] && cove.view.map.tokens[0].id;
      const wait = writer.deps.held;
      writer.deps.held = async () => null;
      const refused = [];
      for (const run of [
        () => writer.move(P.COVE, tokenId, 10, 10),
        () => writer.resource(P.COVE, tokenId, 'hp', (v) => v, false),
        () => writer.initiativeAction(P.COVE, { type: 'next' }),
        () => writer.toggleDoor(P.COVE, 'none'),
      ]) { try { await run(); refused.push('taken'); } catch (error) { refused.push(error && error.name); } }
      writer.deps.held = wait;
      await P.sleep(2500);
      const after = Object.fromEntries(app.vault.getFiles().filter((f) => f.extension === 'atlasmap').map((f) => [f.path, f.stat.mtime]));
      const changed = Object.keys(after).filter((p) => after[p] !== before[p] && p !== P.CELLAR);
      return { refused, changed, held: P.held(P.CELLAR) };`);
    return { pass: out.refused.every((r) => r === 'NotHeldError') && out.changed.length === 0, evidence: out };
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} steps passed`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
