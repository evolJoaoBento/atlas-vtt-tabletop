// node harness/live/phase4b.cjs [steps]
// The Atlas fusion Phase 4B live check, in the throwaway vault's Obsidian (role `fusion`, port 9311, Atlas 0.15.0, the
// Tabletop and Connect builds under test). It runs Phase 4A's check again (which runs Phases 1 to 3: nothing
// regressed), then the steps 4B adds: water painted before is moved to Atlas's liquids with a backup, a stroke is
// Atlas's liquids and one step of its undo, a liquid made in Atlas is drawn and left alone by the brush and by a motion
// change, and painting on a map Atlas does not hold is refused.
// Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase4b-live/results.json; a failed step does not stop the run.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { connect, sleep } = require('./obs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.superpowers/sdd/2026-11-13-atlas-fusion/phase4b-live');
const PORT = 9311;
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? new Set(process.argv[2].split(',').map(Number)) : null;
const results = [];
const record = (step, name, pass, evidence) => {
  results.push({ step, name, pass: !!pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}. ${name}${pass ? '' : `  ${JSON.stringify(evidence).slice(0, 900)}`}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
};

const PAGE = `
window.__W = (() => {
  const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ws = app.workspace;
  const W = {
    sleep, CELLAR: DIR + 'Probe Cellar.atlasmap', COVE: DIR + 'Probe Cove.atlasmap',
    tt: () => app.plugins.plugins['tabletop-for-atlas'],
    boards: () => ws.getLeavesOfType('atlas-tabletop-board'),
    boardOf: (p) => W.boards().find((l) => l.view && l.view.mapPath === p) || null,
    store: () => { const l = ws.getLeavesOfType('atlas-vtt')[0]; return l && l.view && l.view.atlasStore ? l.view.atlasStore : null; },
    s: () => W.store().getState(),
    past: () => W.store().temporal.getState().pastStates.length,
    held: (p) => { const s = W.store() && W.s(); return !!s && s.mapPath === p && s.mapLoaded !== false && s.isMapLoading !== true; },
    until: async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return Date.now() - t; } catch {} await sleep(100); } return null; },
    openBoard: async (p) => { await W.tt().openBoard(p); await W.until(() => { const l = W.boardOf(p); return l && l.view.board && l.view.map; }, 30000); await sleep(800); return W.boardOf(p); },
    focus: async (leaf) => { ws.setActiveLeaf(leaf, { focus: true }); await sleep(300); },
    hold: async (p) => { const leaf = W.boardOf(p) || await W.openBoard(p); await W.focus(leaf); await W.until(() => W.held(p), 20000); await sleep(800); return leaf; },
    file: async (p) => JSON.parse(await app.vault.adapter.read(p)).state,
    liquids: () => Object.values(W.s().objects.liquids || {}),
    brush: () => W.liquids().filter((l) => l.tabletop && l.tabletop.brush === true),
    // A brush mask as Tabletop saves one, for a map of this size: the rectangles (map pixels) wet.
    mask: (size, cell, rects) => {
      const texel = Math.max(Math.max(1, cell) / 8, Math.max(size.width, size.height) / 2048);
      const width = Math.max(1, Math.ceil(size.width / texel)), height = Math.max(1, Math.ceil(size.height / texel));
      const data = new Uint8Array(width * height);
      for (const r of rects) for (let j = Math.max(0, Math.round(r.y / texel)); j < Math.min(height, Math.round((r.y + r.h) / texel)); j++) for (let i = Math.max(0, Math.round(r.x / texel)); i < Math.min(width, Math.round((r.x + r.w) / texel)); i++) data[j * width + i] = 255;
      const bytes = [];
      const push = (run) => { do { let b = run % 128; run = Math.floor(run / 128); if (run > 0) b |= 0x80; bytes.push(b); } while (run > 0); };
      let wet = false, run = 0;
      for (const v of data) { if ((v > 0) === wet) { run++; continue; } push(run); wet = !wet; run = 1; }
      push(run);
      let text = '';
      for (const b of bytes) text += String.fromCharCode(b);
      return { width, height, data: btoa(text) };
    },
    // Whether the board draws water under a map point.
    wet: (leaf, x, y) => { const water = leaf.view.board.water; return !!water && water.mask.at(x, y) > 0; },
    // Takes off every liquid a step made.
    sweep: async (before) => { for (const l of W.liquids()) if (!before.includes(l.id)) W.s().deleteLiquid(l.id); await sleep(900); },
  };
  return W;
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
    try { text = execSync(`node "${path.join(__dirname, 'phase4a.cjs')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 2700000 }); } catch (error) { text = String(error.stdout || error.message); }
    const summary = /(\d+)\/(\d+) steps passed\s*$/.exec(text.trim());
    record(0, "Phases 1 to 4A's live checks again: nothing regressed", summary && summary[1] === summary[2], { summary: summary ? summary[0] : null, failed: text.split('\n').filter((line) => line.startsWith('FAIL')) });
  }
  const o = await open();

  await step(37, "water painted before water was Atlas's is moved to Atlas's liquids on its own: a backup first, the brush's liquids with their motion in the store and the file, nothing left in Tabletop's data", async () => {
    const out = await o.ev(`
      const W = window.__W;
      const leaf = await W.hold(W.CELLAR);
      const view = leaf.view, data = W.tt().boardData;
      const before = W.liquids().map((l) => l.id);
      const size = view.board.mapSize, cell = view.map.grid.size;
      const motion = { kind: 'flow', amount: 0.4, direction: 90, tint: '#336699', clarity: 0.5 };
      const old = { ...(data.toJSON()[W.CELLAR] || {}) };
      delete old.waterMoved;
      // As a vault of before had it: a brush mask and its motion in Tabletop's data, and no mark of a move.
      data.data = { ...data.data, [W.CELLAR]: { ...old, water: { mask: W.mask(size, cell, [{ x: 140, y: 140, w: 280, h: 140 }, { x: 700, y: 700, w: 140, h: 140 }]), motion } } };
      const hadLegacy = data.legacyWater(W.CELLAR) !== null;
      const notices = [];
      const watch = new MutationObserver(() => document.querySelectorAll('.notice').forEach((n) => { if (!notices.includes(n.innerText)) notices.push(n.innerText); }));
      watch.observe(document.body, { childList: true, subtree: true });
      const steps = W.past();
      await view.moveWater(W.CELLAR);
      const moved = await W.until(() => W.brush().length === 2 && data.legacyWater(W.CELLAR) === null, 8000);
      const shown = await W.until(() => W.wet(leaf, 200, 200) && W.wet(leaf, 760, 760) && !W.wet(leaf, 560, 400), 6000);
      await W.sleep(2800);
      watch.disconnect();
      const saved = Object.values((await W.file(W.CELLAR)).objects.liquids || {}).filter((l) => l.tabletop && l.tabletop.brush === true);
      const day = new Date(); const two = (n) => String(n).padStart(2, '0'); const folder = 'Tabletop backups/' + day.getFullYear() + '-' + two(day.getMonth() + 1) + '-' + two(day.getDate());
      const backups = (await app.vault.adapter.exists(folder)) ? (await app.vault.adapter.list(folder)).files : [];
      const kept = data.toJSON()[W.CELLAR] || {};
      const brush = W.brush();
      const out = { hadLegacy, moved, shown, stepsAfter: W.past() - steps, liquids: brush.map((l) => ({ liquid: l.liquid, corners: l.polygon.length, surface: l.colors && l.colors.surface, flow: l.flow || null, motion: l.tabletop.motion })),
        inFile: saved.length, backup: backups.some((f) => /Probe Cellar(-\\d+)?\\.tabletop\\.json$/.test(f)), waterLeft: kept.water !== undefined, waterMoved: kept.waterMoved === true,
        notice: notices.find((n) => /water painted on Probe Cellar is now Atlas's own/.test(n)) || null };
      await W.sweep(before);
      return out;`);
    const ok = out.hadLegacy && out.moved !== null && out.shown !== null && out.stepsAfter <= 0 && out.liquids.length === 2
      && out.liquids.every((l) => l.liquid === 'water' && l.corners === 4 && l.surface === '#336699' && l.flow && l.flow.x === 1 && l.motion && l.motion.kind === 'flow')
      && out.inFile === 2 && out.backup && !out.waterLeft && out.waterMoved && !!out.notice;
    return { pass: ok, evidence: out };
  });

  await step(38, "a finished stroke is Atlas's liquids: the brush's water in the store and the map file, one step of Atlas's undo, drawn by the board; Atlas's undo dries it", async () => {
    const out = await o.ev(`
      const W = window.__W;
      const leaf = await W.hold(W.CELLAR);
      const view = leaf.view;
      const before = W.liquids().map((l) => l.id);
      const size = view.board.mapSize, cell = view.map.grid.size;
      const steps = W.past();
      // The board hands its host the mask as painted, as it does when the brush is let go.
      view.board.host.saveWater(W.mask(size, cell, [{ x: 280, y: 280, w: 210, h: 140 }]));
      const written = await W.until(() => W.brush().length === 1, 4000);
      const stepsAfter = W.past() - steps;
      const drawn = await W.until(() => W.wet(leaf, 350, 350) && !W.wet(leaf, 700, 700), 4000);
      const first = W.brush()[0];
      // Painted on: the brush's liquids are replaced by the new outlines, in one more step.
      view.board.host.saveWater(W.mask(size, cell, [{ x: 280, y: 280, w: 210, h: 140 }, { x: 840, y: 280, w: 70, h: 70 }]));
      const two = await W.until(() => W.brush().length === 2 && !W.brush().some((l) => l.id === first.id), 4000);
      const stepsTwo = W.past() - steps;
      await W.sleep(2800);
      const inFile = Object.values((await W.file(W.CELLAR)).objects.liquids || {}).filter((l) => l.tabletop && l.tabletop.brush === true).length;
      W.store().temporal.getState().undo();
      const undone = await W.until(() => W.brush().length === 1 && W.wet(leaf, 350, 350) && !W.wet(leaf, 860, 300), 4000);
      W.store().temporal.getState().undo();
      const dry = await W.until(() => W.brush().length === 0 && !W.wet(leaf, 350, 350), 4000);
      const data = W.tt().boardData.toJSON()[W.CELLAR] || {};
      await W.sweep(before);
      return { written, stepsAfter, drawn, corners: first && first.polygon.length, level: first && (first.level ?? null), shownLevel: view.map.level, two, stepsTwo, inFile, undone, dry, inData: data.water !== undefined };`);
    return { pass: out.written !== null && out.stepsAfter === 1 && out.drawn !== null && out.corners === 4 && out.level === out.shownLevel && out.two !== null && out.stepsTwo === 2 && out.inFile === 2 && out.undone !== null && out.dry !== null && !out.inData, evidence: out };
  });

  await step(39, "a liquid made in Atlas is drawn on the board and left as it is: by a stroke that erases over it, and by a change of the water's motion, which re-writes only the brush's water", async () => {
    const out = await o.ev(`
      const W = window.__W;
      const leaf = await W.hold(W.CELLAR);
      const view = leaf.view;
      const before = W.liquids().map((l) => l.id);
      const size = view.board.mapSize, cell = view.map.grid.size;
      const [lava] = W.s().addLiquids([{ liquid: 'lava', polygon: [{ x: 980, y: 700 }, { x: 980, y: 840 }, { x: 1120, y: 840 }, { x: 1120, y: 700 }], colors: { surface: '#ea580c', deep: '#7c2d12', glint: '#fde047' }, art: 'engraved' }]);
      const drawn = await W.until(() => W.wet(leaf, 1050, 770), 5000);
      // A stroke elsewhere whose mask is dry where the lava lies (as if erased over it).
      view.board.host.saveWater(W.mask(size, cell, [{ x: 280, y: 700, w: 140, h: 140 }]));
      const painted = await W.until(() => W.brush().length === 1, 4000);
      const after = W.s().objects.liquids[lava];
      const still = !!after && after.liquid === 'lava' && after.art === 'engraved' && after.polygon.length === 4 && !after.tabletop;
      const stillDrawn = await W.until(() => W.wet(leaf, 1050, 770) && W.wet(leaf, 350, 770), 4000);
      // A stroke that covers the lava: the brush's water is written without the part that is Atlas's.
      view.board.host.saveWater(W.mask(size, cell, [{ x: 280, y: 700, w: 140, h: 140 }, { x: 980, y: 700, w: 140, h: 140 }]));
      await W.sleep(1200);
      const notDoubled = W.brush().length === 1;
      const steps = W.past();
      const brushBefore = W.brush()[0];
      view.board.host.saveWaterMotion({ kind: 'still', amount: 0.2, direction: 0, tint: '#225577', clarity: 0.8 });
      view.board.host.saveWaterMotion({ kind: 'still', amount: 0.2, direction: 0, tint: '#113355', clarity: 0.8 });
      const retinted = await W.until(() => W.brush().length === 1 && W.brush()[0].colors.surface === '#113355' && W.brush()[0].tabletop.motion.kind === 'still' && W.brush()[0].id !== brushBefore.id, 5000);
      const motionSteps = W.past() - steps;
      const lavaAfter = W.s().objects.liquids[lava];
      const out = { drawn, painted, still, stillDrawn, notDoubled, retinted, motionSteps, lavaSame: !!lavaAfter && lavaAfter.colors.surface === '#ea580c' && lavaAfter.art === 'engraved', flowGone: !W.brush()[0].flow };
      await W.sweep(before);
      return out;`);
    return { pass: out.drawn !== null && out.painted !== null && out.still && out.stillDrawn !== null && out.notDoubled && out.retinted !== null && out.motionSteps === 1 && out.lavaSame && out.flowGone, evidence: out };
  });

  await step(40, 'on a map Atlas does not hold water is refused: nothing is written, no map file changes', async () => {
    const out = await o.ev(`
      const W = window.__W;
      await W.hold(W.CELLAR);
      const cove = W.boardOf(W.COVE) || await W.openBoard(W.COVE);
      await W.hold(W.CELLAR);
      const files = app.vault.getFiles().filter((f) => f.extension === 'atlasmap');
      const before = Object.fromEntries(files.map((f) => [f.path, f.stat.mtime]));
      const count = W.liquids().length;
      const writer = cove.view.services.writer;
      const wait = writer.deps.held;
      writer.deps.held = async () => null;
      const refused = [];
      const triangle = [{ x: 0, y: 0 }, { x: 0, y: 70 }, { x: 70, y: 70 }];
      for (const run of [
        () => writer.replaceLiquids(W.COVE, [], [{ liquid: 'water', polygon: triangle, colors: { surface: '#3b82f6', deep: '#1e3a8a', glint: '#93c5fd' } }]),
        () => writer.applyWaterMove(W.COVE, [{ liquid: 'water', polygon: triangle, colors: { surface: '#3b82f6', deep: '#1e3a8a', glint: '#93c5fd' } }]),
      ]) { try { await run(); refused.push('taken'); } catch (error) { refused.push(error && error.name); } }
      writer.deps.held = wait;
      await W.sleep(2500);
      const after = Object.fromEntries(app.vault.getFiles().filter((f) => f.extension === 'atlasmap').map((f) => [f.path, f.stat.mtime]));
      return { refused, changed: Object.keys(after).filter((p) => after[p] !== before[p]), liquids: W.liquids().length - count, held: W.held(W.CELLAR) };`);
    return { pass: out.refused.every((r) => r === 'NotHeldError') && out.changed.length === 0 && out.liquids === 0, evidence: out };
  });

  await step(41, "no console error from Tabletop or Connect across the run; the cellar is left with no brush water, and Tabletop's data keeps none for it", async () => {
    await sleep(1500);
    const left = await o.ev(`
      const W = window.__W;
      await W.hold(W.CELLAR);
      const data = W.tt().boardData.toJSON()[W.CELLAR] || {};
      return { brush: W.brush().length, inData: data.water !== undefined };`);
    const errors = o.logs.filter((l) => (l.type === 'error' || l.type === 'pageerror') && /tabletop|connect-for-atlas|Tabletop|Connect/i.test(l.text + l.at));
    return { pass: errors.length === 0 && left.brush === 0 && !left.inData, evidence: { errors: errors.slice(0, 8), left } };
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} steps passed`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
