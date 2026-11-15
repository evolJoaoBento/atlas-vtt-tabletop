// node harness/live/phase4e.cjs [steps]
// The Atlas fusion Phase 4E live check, in the throwaway vault's Obsidian (role `fusion`, port 9311; ATLAS_BUILD names
// the Atlas build Phase 1 expects). It runs Phase 4D's check again (which runs Phases 1 to 4C: nothing regressed), then
// the steps 4E adds: the dice's body colour follows Atlas's dice look (dark, accent, light) set in Atlas's own settings.
// It refuses any vault but the throwaway one, and puts back what it changed.
// Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase4e-live/results.json; a failed step does not stop the run.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { connect, sleep } = require('./obs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.superpowers/sdd/2026-11-13-atlas-fusion/phase4e-live');
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
    try { text = execSync(`node "${path.join(__dirname, 'phase4d.cjs')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 5400000 }); } catch (error) { text = String(error.stdout || error.message); }
    const summary = /(\d+)\/(\d+) steps passed\s*$/.exec(text.trim());
    record(0, "Phases 1 to 4D's live checks again: nothing regressed", summary && summary[1] === summary[2], { summary: summary ? summary[0] : null, failed: text.split('\n').filter((line) => line.startsWith('FAIL')) });
  }
  const o = await open();

  await step(54, "the dice's body is Atlas's dice look, set in Atlas's own settings: dark gives Atlas's dark body, accent the theme's accent, light the pack's own", async () => {
    const out = await o.ev(`
      const D = window.__D;
      const leaf = await D.hold(D.CELLAR);
      const view = leaf.view;
      const settings = app.plugins.plugins['atlas-vtt'].settingsService;
      const before = settings.getDiceLook();
      const body = () => view.services.diceBody();
      const seen = {};
      for (const colour of ['dark', 'accent', 'light']) {
        settings.setDiceLook({ colour });
        await D.sleep(300);
        seen[colour] = { look: settings.getDiceLook().colour, body: body() };
      }
      settings.setDiceLook(before);
      await D.sleep(300);
      return { seen, restored: JSON.stringify(settings.getDiceLook()) === JSON.stringify(before) };
    `);
    const ok = out.seen.dark.body === '#1f1e21' && /^#[0-9a-f]{6}$/.test(out.seen.accent.body || '') && out.seen.light.body === null && out.restored;
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
