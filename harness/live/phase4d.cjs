// node harness/live/phase4d.cjs [steps]
// The Atlas fusion Phase 4D live check, in the throwaway vault's Obsidian (role `fusion`, port 9311; ATLAS_BUILD names
// the Atlas build Phase 1 expects). It runs Phase 4C's check again (which runs Phases 1 to 4B: nothing regressed), then
// the steps 4D adds: on a lit scene the board's players' picture is Atlas's own sight, read from the Atlas tab that
// hosts the map (a token that sees is shown, one out of its sight is not, the dark is veiled; the GM's own board shows
// everything; a token moved into sight through the store shows); with lighting off no sight is drawn.
// It refuses any vault but the throwaway one, and puts back what it changed.
// Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase4d-live/results.json; a failed step does not stop the run.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { connect, sleep } = require('./obs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.superpowers/sdd/2026-11-13-atlas-fusion/phase4d-live');
const PORT = 9311;
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? new Set(process.argv[2].split(',').map(Number)) : null;
const results = [];
const record = (step, name, pass, evidence) => {
  results.push({ step, name, pass: !!pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}. ${name}${pass ? '' : `  ${JSON.stringify(evidence).slice(0, 1400)}`}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
};

const PAGE = `
if (!/fusion-gate-vault/.test(String(app.vault.adapter.basePath))) throw new Error('not the throwaway vault: ' + app.vault.adapter.basePath);
window.__D = (() => {
  const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ws = app.workspace;
  const D = {
    sleep, CELLAR: DIR + 'Probe Cellar.atlasmap',
    tt: () => app.plugins.plugins['tabletop-for-atlas'],
    boards: () => ws.getLeavesOfType('atlas-tabletop-board'),
    boardOf: (p) => D.boards().find((l) => l.view && l.view.mapPath === p) || null,
    store: () => { const l = ws.getLeavesOfType('atlas-vtt')[0]; return l && l.view && l.view.atlasStore ? l.view.atlasStore : null; },
    s: () => D.store().getState(),
    held: (p) => { const s = D.store() && D.s(); return !!s && s.mapPath === p && s.mapLoaded !== false && s.isMapLoading !== true; },
    until: async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return Date.now() - t; } catch {} await sleep(100); } return null; },
    openBoard: async (p) => { await D.tt().openBoard(p); await D.until(() => { const l = D.boardOf(p); return l && l.view.board && l.view.map; }, 30000); await sleep(800); return D.boardOf(p); },
    hold: async (p) => { const leaf = D.boardOf(p) || await D.openBoard(p); ws.setActiveLeaf(leaf, { focus: true }); await sleep(300); await D.until(() => D.held(p), 20000); await sleep(800); return leaf; },
  };
  return D;
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
  if (!only || only.has(0)) {
    let text = '';
    try { text = execSync(`node "${path.join(__dirname, 'phase4c.cjs')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 3600000 }); } catch (error) { text = String(error.stdout || error.message); }
    const summary = /(\d+)\/(\d+) steps passed\s*$/.exec(text.trim());
    record(0, "Phases 1 to 4C's live checks again: nothing regressed", summary && summary[1] === summary[2], { summary: summary ? summary[0] : null, failed: text.split('\n').filter((line) => line.startsWith('FAIL')) });
  }
  const o = await open();

  await step(53, "sight follows Atlas: on a lit scene the board's players' picture is Atlas's own sight from the tab that hosts the map; the GM's board shows everything; a token moved into sight shows", async () => {
    const out = await o.ev(`
      const D = window.__D;
      const leaf = await D.hold(D.CELLAR);
      const view = leaf.view;
      const lightingBefore = structuredClone(D.s().lighting);
      const tokens = Object.values(D.s().objects.tokens || {});
      const seer = tokens.find((t) => !t.level) || tokens[0];
      const seerBefore = { isHidden: seer.isHidden, vision: structuredClone(seer.vision) };
      const cell = (D.s().grid && D.s().grid.size) || 50;
      // A dark scene; the seer sees two squares; another token stands twelve squares off, on the same floor.
      D.s().setSceneLighting({ enabled: true, ambient: 0 });
      D.s().updateToken(seer.id, { isHidden: false, vision: { enabled: true, range: 10 } });
      const far = { x: seer.x + cell * 12, y: seer.y };
      const otherId = D.s().addToken({ ...structuredClone(seer), id: undefined, name: 'Probe far', x: far.x, y: far.y, isHidden: false, vision: { enabled: false }, layer: undefined });
      const board = () => view.board;
      const ready = await D.until(() => board().atlasSight && board().atlasSight.kind === 'ready' && board().sight !== null && board().tokens.has(otherId), 15000);
      await D.sleep(600);
      const look = (viewer) => {
        board().showFor(viewer);
        const piece = (id) => board().tokens.get(id) && board().tokens.get(id).piece.object3d.visible;
        return { seer: piece(seer.id), other: piece(otherId), veil: board().veilSight.object3d.visible, blocks: board().veilSight.object3d.geometry.getAttribute('position')?.count ?? 0 };
      };
      const lit = { kind: board().atlasSight.kind, sight: board().sight && [...board().sight].filter((k) => k.startsWith('t:')), player: look('player'), gm: look('gm') };
      // Moved next to the seer through Atlas's store: Atlas's sight takes it in, and so does the board's.
      D.s().updateToken(otherId, { x: seer.x + cell, y: seer.y });
      const movedMs = await D.until(() => board().sight && board().sight.has('t:' + otherId), 10000);
      const moved = { player: look('player') };
      // Lighting off: no sight drawn.
      D.s().setSceneLighting({ enabled: false });
      const offMs = await D.until(() => board().sight === null && board().atlasSight.kind === 'unlit', 10000);
      const off = { player: look('player') };
      board().showFor('gm');
      D.s().deleteToken(otherId);
      D.s().updateToken(seer.id, seerBefore);
      D.s().setSceneLighting(lightingBefore);
      await D.sleep(1200);
      return { readyMs: ready, lit, movedMs, moved, offMs, off, restored: D.s().lighting.enabled === lightingBefore.enabled && !D.s().objects.tokens[otherId] };
    `);
    const ok = out.readyMs !== null && out.lit.kind === 'ready'
      && out.lit.player.seer === true && out.lit.player.other === false && out.lit.player.veil === true && out.lit.player.blocks > 0
      && out.lit.gm.seer === true && out.lit.gm.other === true && out.lit.gm.veil === false
      && out.movedMs !== null && out.moved.player.other === true
      && out.offMs !== null && out.off.player.veil === false && out.off.player.other === true && out.restored;
    return { pass: ok, evidence: out };
  });

  await step(50, 'no console error from Tabletop or Connect across the run', async () => {
    await sleep(1500);
    const errors = o.logs.filter((l) => (l.type === 'error' || l.type === 'pageerror') && /tabletop|connect-for-atlas|Tabletop|Connect/i.test(l.text + l.at));
    return { pass: errors.length === 0, evidence: { errors: errors.slice(0, 8) } };
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} steps passed`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
