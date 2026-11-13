// node harness/live/phase3-probe.cjs
// Phase 3's gate checks on Atlas 0.15.0, in the throwaway vault's Obsidian (role `fusion`, port 9311): what Atlas's
// store does with a spell kept as a measure. Reads and writes Atlas's store only; everything it adds it takes away.
// Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase3-probe.json
const fs = require('fs'), path = require('path');
const { connect, sleep } = require('./obs.cjs');
const OUT = path.resolve(__dirname, '..', '..', '.superpowers/sdd/2026-11-13-atlas-fusion/phase3-probe.json');

(async () => {
  const o = await connect(9311);
  for (let i = 0; i < 60; i++) { if (await o.ev("return !!app.plugins && !!app.workspace.layoutReady").catch(() => false)) break; await sleep(1000); }
  const out = await o.ev(`
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
    const CELLAR = DIR + 'Probe Cellar.atlasmap', COVE = DIR + 'Probe Cove.atlasmap';
    const ws = app.workspace;
    const tt = app.plugins.plugins['tabletop-for-atlas'];
    const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch {} await sleep(100); } return false; };
    const store = () => { const l = ws.getLeavesOfType('atlas-vtt')[0]; return l && l.view && l.view.atlasStore ? l.view.atlasStore : null; };
    const held = (p) => { const s = store() && store().getState(); return !!s && s.mapPath === p && s.mapLoaded !== false && s.isMapLoading !== true; };
    const boardOf = (p) => ws.getLeavesOfType('atlas-tabletop-board').find((l) => l.view && l.view.mapPath === p) || null;
    const hold = async (p) => { if (!boardOf(p)) { await tt.openBoard(p); await until(() => boardOf(p) && boardOf(p).view.board && boardOf(p).view.map, 30000); } ws.setActiveLeaf(boardOf(p), { focus: true }); await until(() => held(p)); await sleep(800); };
    const file = async (p) => JSON.parse(await app.vault.adapter.read(p)).state;
    const result = {};
    await hold(CELLAR);
    const s = () => store().getState();
    const history = store().temporal ? store().temporal.getState() : null;
    result.historyKeys = history ? Object.keys(history).sort() : null;
    result.actions = Object.keys(s()).filter((k) => typeof s()[k] === 'function' && /measure|wall|mapfeature|aura/i.test(k)).sort();
    const past = () => (store().temporal.getState().pastStates || store().temporal.getState().past || []).length;

    // P1: a measure with a nested extra of realistic size, an author, hidden, on the level shown.
    const about = { line: '3rd-level evocation', properties: [['Range', '150 feet'], ['Duration', 'Instantaneous']], text: 'x'.repeat(3900) };
    const extra = { v: 1, shape: 'sphere', from: 'point', h: 70, pitch: 0.1, roll: 0, effect: 'fire', owner: 'p-123', name: 'Fireball', about, rules: { wall: { blocks: 'both', look: 'stone' }, difficult: true, light: { bright: 20, dim: 20 } } };
    const before = past();
    const id = s().addMeasure({ shape: 'circle', points: [{ x: 700, y: 700 }, { x: 840, y: 700 }], color: '#ff8800', by: 'Anna', hidden: true, tabletop: extra });
    result.p1 = { id, steps: past() - before, inStore: JSON.stringify(s().objects.measures[id].tabletop) === JSON.stringify(extra), by: s().objects.measures[id].by, hidden: s().objects.measures[id].hidden, level: s().objects.measures[id].level ?? null };
    await sleep(2500);
    const saved = (await file(CELLAR)).objects.measures?.[id];
    result.p1.inFile = !!saved && JSON.stringify(saved.tabletop) === JSON.stringify(extra) && saved.by === 'Anna' && saved.hidden === true;

    // P2: one undo step for a cast and what it brings (a transaction), and writes that are no step (untracked).
    if (history && typeof history.transaction === 'function') {
      const t0 = past();
      let ids = {};
      store().temporal.getState().transaction(() => {
        ids.measure = s().addMeasure({ shape: 'line', points: [{ x: 300, y: 300 }, { x: 580, y: 300 }], width: 35, tabletop: { v: 1, shape: 'wall' } });
        ids.wall = s().addWall ? s().addWall({ type: 'solid', p1: { x: 300, y: 300 }, p2: { x: 580, y: 300 }, chainId: 'spell:' + ids.measure }) : null;
        ids.feature = s().addMapFeatures ? s().addMapFeatures([{ area: [[2400, 2400, 4000, 2400, 4000, 4000, 2400, 4000]], terrain: { difficult: true }, tabletop: { spell: ids.measure } }]) : null;
      });
      const walls = () => Object.values(s().objects.walls || {}).filter((w) => w.chainId === 'spell:' + ids.measure).length;
      const features = () => Object.values(s().objects.mapFeatures || {}).filter((f) => f.tabletop && f.tabletop.spell === ids.measure).length;
      const after = { steps: past() - t0, walls: walls(), features: features(), wallId: ids.wall, featureIds: ids.feature };
      store().temporal.getState().undo();
      const undone = { measure: !!s().objects.measures[ids.measure], walls: walls(), features: features() };
      store().temporal.getState().redo();
      const redone = { measure: !!s().objects.measures[ids.measure], walls: walls(), features: features() };
      const t1 = past();
      store().temporal.getState().untracked(() => { s().deleteMeasure(ids.measure); });
      const untracked = { steps: past() - t1, measure: !!s().objects.measures[ids.measure] };
      // Take the wall and the feature away again, untracked.
      store().temporal.getState().untracked(() => {
        const wallIds = Object.values(s().objects.walls || {}).filter((w) => w.chainId === 'spell:' + ids.measure).map((w) => w.id);
        if (s().deleteWalls) s().deleteWalls(wallIds); else for (const w of wallIds) s().deleteWall && s().deleteWall(w);
        for (const f of Object.values(s().objects.mapFeatures || {}).filter((f) => f.tabletop && f.tabletop.spell === ids.measure)) s().deleteMapFeature(f.id);
      });
      result.p2 = { after, undone, redone, untracked, cleaned: { walls: walls(), features: features() } };
    }

    // P3: an area's light and a darkness, as the store keeps them.
    const lit = s().addMeasure({ shape: 'circle', points: [{ x: 900, y: 300 }, { x: 1040, y: 300 }], light: { bright: 20, dim: 40, color: '#ffffff', intensity: 1, animation: { type: 'none', speed: 1, intensity: 1 } }, effect: 'radiance' });
    const dark = s().addMeasure({ shape: 'circle', points: [{ x: 1200, y: 300 }, { x: 1340, y: 300 }], light: { bright: 0, dim: 15, color: '#000000', intensity: 1, animation: { type: 'none', speed: 1, intensity: 1 }, darkness: true } });
    const square = s().addMeasure({ shape: 'square', points: [{ x: 1500, y: 300 }, { x: 1640, y: 300 }], light: { bright: 0, dim: 15, color: '#000000', intensity: 1, animation: { type: 'none', speed: 1, intensity: 1 }, darkness: true } });
    await sleep(2500);
    const f = (await file(CELLAR)).objects.measures || {};
    result.p3 = { lit: f[lit] ? { light: f[lit].light, effect: f[lit].effect } : null, dark: f[dark] ? f[dark].light : null, squareDark: f[square] ? f[square].light : null, lightingOn: s().lighting && s().lighting.enabled };

    // P4: away and back: the store reads the file again, extras and all.
    await hold(COVE);
    await hold(CELLAR);
    const back = s().objects.measures[id];
    result.p4 = { back: !!back, extra: !!back && JSON.stringify(back.tabletop) === JSON.stringify(extra), by: back && back.by };

    // Clean up: everything this probe added.
    for (const each of [id, lit, dark, square]) if (each && s().objects.measures[each]) s().deleteMeasure(each);
    await sleep(2500);
    result.clean = Object.keys((await file(CELLAR)).objects.measures || {}).filter((k) => [id, lit, dark, square].includes(k)).length === 0;
    return result;`);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
