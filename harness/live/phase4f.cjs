// node harness/live/phase4f.cjs [steps]
// The Atlas fusion Phase 4F live check, in the throwaway vault's Obsidian (role `fusion`, port 9311; ATLAS_BUILD names
// the Atlas build Phase 1 expects). It runs Phase 4E's check again (which runs Phases 1 to 4D: nothing regressed), then
// the step 4F adds: the Atlas panels Tabletop copies from Atlas 0.15.0 (command palette, loot and random tables, asset
// manager) open on the board in Obsidian, draw their content, and close.
// It refuses any vault but the throwaway one. Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase4f-live/results.json.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { connect, sleep } = require('./obs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.superpowers/sdd/2026-11-13-atlas-fusion/phase4f-live');
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
    try { text = execSync(`node "${path.join(__dirname, 'phase4e.cjs')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 7200000 }); } catch (error) { text = String(error.stdout || error.message); }
    const summary = /(\d+)\/(\d+) steps passed\s*$/.exec(text.trim());
    record(0, "Phases 1 to 4E's live checks again: nothing regressed", summary && summary[1] === summary[2], { summary: summary ? summary[0] : null, failed: text.split('\n').filter((line) => line.startsWith('FAIL')) });
  }
  const o = await open();

  await step(55, "the Atlas panels Tabletop copies from Atlas 0.15.0 open on the board, draw their content, and close: the command palette (with Tabletop's commands), the loot roller with its random tables, the asset manager", async () => {
    const out = await o.ev(`
      const D = window.__D;
      const leaf = await D.hold(D.CELLAR);
      const view = leaf.view;
      await D.until(() => view.atlasTools, 10000);
      const tools = view.atlasTools;
      const panel = async (id, win) => {
        tools.run(id);
        const openMs = await D.until(() => win.isOpen() && win.el && win.el.querySelectorAll('*').length > 5, 10000);
        await D.sleep(800);
        const el = win.el;
        const info = { openMs, open: win.isOpen(), text: el ? (el.innerText || '').length : 0, nodes: el ? el.querySelectorAll('*').length : 0, sample: el ? (el.innerText || '').slice(0, 160) : null };
        tools.run(id);
        await D.until(() => !win.isOpen(), 5000);
        info.closed = !win.isOpen();
        return info;
      };
      const palette = await panel('palette', tools.palette);
      const loot = await panel('loot', tools.loot);
      const assets = tools.assets.available() ? await panel('assets', tools.assets) : { unavailable: true };
      return { atlas: app.plugins.manifests['atlas-vtt'].version, palette, loot, assets };
    `);
    const good = (p) => p && p.openMs !== null && p.nodes > 5 && p.closed;
    return { pass: good(out.palette) && good(out.loot) && good(out.assets), evidence: out };
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
