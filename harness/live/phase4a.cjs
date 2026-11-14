// node harness/live/phase4a.cjs [steps]
// The Atlas fusion Phase 4A live check, in the throwaway vault's Obsidian (role `fusion`, port 9311, Atlas 0.15.0, the
// Tabletop and Connect builds under test). It runs Phase 3's check again (which runs Phases 1 and 2: nothing regressed;
// Phase 1's rooms step now also checks the move of old wall settings onto Atlas's walls), then the steps 4A adds: what
// the GM sets on a wall, a door or a light in 3D lands on Atlas's own record and in the map file, one undo step each,
// and is refused on a map Atlas does not hold.
// Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase4a-live/results.json; a failed step does not stop the run.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { connect, sleep } = require('./obs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.superpowers/sdd/2026-11-13-atlas-fusion/phase4a-live');
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
window.__R = (() => {
  const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ws = app.workspace;
  const R = {
    sleep, CELLAR: DIR + 'Probe Cellar.atlasmap', COVE: DIR + 'Probe Cove.atlasmap',
    tt: () => app.plugins.plugins['tabletop-for-atlas'],
    boards: () => ws.getLeavesOfType('atlas-tabletop-board'),
    boardOf: (p) => R.boards().find((l) => l.view && l.view.mapPath === p) || null,
    store: () => { const l = ws.getLeavesOfType('atlas-vtt')[0]; return l && l.view && l.view.atlasStore ? l.view.atlasStore : null; },
    s: () => R.store().getState(),
    past: () => R.store().temporal.getState().pastStates.length,
    held: (p) => { const s = R.store() && R.s(); return !!s && s.mapPath === p && s.mapLoaded !== false && s.isMapLoading !== true; },
    until: async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return Date.now() - t; } catch {} await sleep(100); } return null; },
    openBoard: async (p) => { await R.tt().openBoard(p); await R.until(() => { const l = R.boardOf(p); return l && l.view.board && l.view.map; }, 30000); await sleep(800); return R.boardOf(p); },
    focus: async (leaf) => { ws.setActiveLeaf(leaf, { focus: true }); await sleep(300); },
    hold: async (p) => { const leaf = R.boardOf(p) || await R.openBoard(p); await R.focus(leaf); await R.until(() => R.held(p), 20000); await sleep(800); return leaf; },
    file: async (p) => JSON.parse(await app.vault.adapter.read(p)).state,
    same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    // A wall and a door made for the check, on the map and (once read) on the board; removed by \`sweep\`.
    walls: async (leaf) => {
      const wall = R.s().addWall({ type: 'solid', p1: { x: 2100, y: 2100 }, p2: { x: 2240, y: 2100 } });
      const door = R.s().addWall({ type: 'door', p1: { x: 2240, y: 2100 }, p2: { x: 2380, y: 2100 }, closed: true });
      await R.until(() => leaf.view.map.walls.some((w) => w.id === wall) && leaf.view.map.walls.some((w) => w.id === door), 6000);
      return { wall, door };
    },
    sweep: async (ids) => { R.s().deleteWalls(ids.filter((id) => R.s().objects.walls[id])); await sleep(900); },
  };
  return R;
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
    try { text = execSync(`node "${path.join(__dirname, 'phase3.cjs')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 2400000 }); } catch (error) { text = String(error.stdout || error.message); }
    const summary = /(\d+)\/(\d+) steps passed\s*$/.exec(text.trim());
    record(0, "Phases 1 to 3's live checks again: nothing regressed, and the rooms map's old wall settings ended on Atlas's walls", summary && summary[1] === summary[2], { summary: summary ? summary[0] : null, failed: text.split('\n').filter((line) => line.startsWith('FAIL')) });
  }
  const o = await open();

  await step(32, "a wall's height set from the board is on Atlas's own wall, in the map file, one step of Atlas's undo, shown at once; Atlas's undo takes it back", async () => {
    const out = await o.ev(`
      const R = window.__R;
      const leaf = await R.hold(R.CELLAR);
      const { wall, door } = await R.walls(leaf);
      const view = leaf.view;
      const steps = R.past();
      view.board.host.setWallHeight(wall, 2.5, false);
      const onRecord = await R.until(() => R.same(R.s().objects.walls[wall].tabletop, { v: 1, height: 2.5 }), 3000);
      const stepsAfter = R.past() - steps;
      const shown = await R.until(() => view.extras().wallHeight(wall) === 2.5 && view.board.host.wallHeight(wall) === 2.5, 1500);
      await R.sleep(2800);
      const saved = (await R.file(R.CELLAR)).objects.walls[wall];
      R.store().temporal.getState().undo();
      const undone = await R.until(() => !R.s().objects.walls[wall].tabletop && view.extras().wallHeight(wall) === null, 3000);
      const data = R.tt().boardData.toJSON()[R.CELLAR] || {};
      await R.sweep([wall, door]);
      return { onRecord, stepsAfter, shown, inFile: !!saved && R.same(saved.tabletop, { v: 1, height: 2.5 }), undone, inData: ['wallHeights', 'wallMaterials', 'wallWidths', 'windows', 'doorProps', 'doorFlips', 'lightHeights'].filter((key) => data[key] !== undefined) };`);
    return { pass: out.onRecord !== null && out.stepsAfter === 1 && out.shown !== null && out.inFile && out.undone !== null && out.inData.length === 0, evidence: out };
  });

  await step(33, "a material, a width, a window's opening and a door's prop and turn each go onto the record, beside what is there; back to the default takes the key off", async () => {
    const out = await o.ev(`
      const R = window.__R;
      const leaf = await R.hold(R.CELLAR);
      const { wall, door } = await R.walls(leaf);
      const view = leaf.view;
      const steps = R.past();
      view.setExtras(R.CELLAR, [wall], { material: 'Materials/stone' });
      view.board.host.setWallWidth(wall, 0.3, false);
      view.setExtras(R.CELLAR, [wall], { window: { bottom: 1, top: 2 } });
      view.setExtras(R.CELLAR, [door], { prop: 'Props/door.glb' });
      view.turnDoor(R.CELLAR, door, (flip) => ({ hinge: !flip.hinge, side: !flip.side }));
      const set = await R.until(() => R.same(R.s().objects.walls[wall].tabletop, { v: 1, material: 'Materials/stone', width: 0.3, window: { bottom: 1, top: 2 } })
        && R.same(R.s().objects.walls[door].tabletop, { v: 1, prop: 'Props/door.glb', hinge: true, side: true }), 3000);
      const stepsAfter = R.past() - steps;
      const read = await R.until(() => view.extras().wallMaterial(wall) === 'Materials/stone' && view.extras().wallWidth(wall) === 0.3 && R.same(view.extras().windowOf(wall), { bottom: 1, top: 2 })
        && view.extras().doorProp(door) === 'Props/door.glb' && R.same(view.extras().doorFlip(door), { hinge: true, side: true }), 2000);
      // Back to the defaults: each key goes, and a field with nothing left goes whole.
      view.setExtras(R.CELLAR, [wall], { material: null, width: null, window: null });
      view.setExtras(R.CELLAR, [door], { prop: null });
      view.turnDoor(R.CELLAR, door, (flip) => ({ hinge: !flip.hinge, side: !flip.side }));
      const cleared = await R.until(() => !R.s().objects.walls[wall].tabletop && !R.s().objects.walls[door].tabletop, 3000);
      const wallNow = R.s().objects.walls[wall], doorNow = R.s().objects.walls[door];
      await R.sweep([wall, door]);
      return { set, stepsAfter, read, cleared, wallNow: wallNow && wallNow.tabletop, doorNow: doorNow && doorNow.tabletop };`);
    return { pass: out.set !== null && out.stepsAfter === 5 && out.read !== null && out.cleared !== null, evidence: out };
  });

  await step(34, "a placed light's height is on the light's record, a carried light's on its token; both are in the file and taken off again", async () => {
    const out = await o.ev(`
      const R = window.__R;
      const leaf = await R.hold(R.CELLAR);
      const view = leaf.view;
      const emission = { bright: 10, dim: 20, color: '#ffffff', intensity: 1, animation: 'none' };
      const light = R.s().addLight({ x: 2100, y: 2300, emission });
      const token = Object.values(R.s().objects.tokens).find((t) => !t.offMap);
      const hadLight = token.light, hadExtra = token.tabletop;
      R.s().updateToken(token.id, { light: emission });
      await R.until(() => view.map.lights.some((l) => l.id === light) && view.map.lights.some((l) => l.tokenId === token.id), 6000);
      view.board.host.setLightHeight(light, 3);
      view.setLightHeight(R.CELLAR, token.id, 1.5);
      const set = await R.until(() => R.same(R.s().objects.lights[light].tabletop, { v: 1, height: 3 }) && R.s().objects.tokens[token.id].tabletop && R.s().objects.tokens[token.id].tabletop.lightHeight === 1.5, 3000);
      const read = await R.until(() => view.extras().lightHeight(light) === 3 && view.extras().lightHeight(token.id) === 1.5, 2000);
      await R.sleep(2800);
      const saved = await R.file(R.CELLAR);
      const inFile = R.same(saved.objects.lights[light] && saved.objects.lights[light].tabletop, { v: 1, height: 3 }) && saved.objects.tokens[token.id].tabletop.lightHeight === 1.5;
      view.setLightHeight(R.CELLAR, light, null);
      view.setLightHeight(R.CELLAR, token.id, null);
      const cleared = await R.until(() => !R.s().objects.lights[light].tabletop && R.same(R.s().objects.tokens[token.id].tabletop, hadExtra), 3000);
      R.s().deleteLight(light);
      R.s().updateToken(token.id, { light: hadLight, tabletop: hadExtra });
      await R.sleep(900);
      return { set, read, inFile, cleared };`);
    return { pass: out.set !== null && out.read !== null && out.inFile && out.cleared !== null, evidence: out };
  });

  await step(35, 'on a map Atlas does not hold a wall or a light setting is refused: nothing is written, no map file changes', async () => {
    const out = await o.ev(`
      const R = window.__R;
      await R.hold(R.CELLAR);
      const cove = R.boardOf(R.COVE) || await R.openBoard(R.COVE);
      await R.hold(R.CELLAR);
      const files = app.vault.getFiles().filter((f) => f.extension === 'atlasmap');
      const before = Object.fromEntries(files.map((f) => [f.path, f.stat.mtime]));
      const dataBefore = JSON.stringify(R.tt().boardData.toJSON());
      const writer = cove.view.services.writer;
      const wallId = cove.view.map.walls[0] ? cove.view.map.walls[0].id : 'none';
      const wait = writer.deps.held;
      writer.deps.held = async () => null;
      const refused = [];
      for (const run of [
        () => writer.setWallExtras(R.COVE, [wallId], { height: 3 }),
        () => writer.setLightHeight(R.COVE, 'none', 2),
        () => writer.applyExtrasMove(R.COVE, { walls: [{ id: wallId, change: { height: 3 } }], lights: [], tokens: [], moved: 1, dropped: 0 }),
      ]) { try { await run(); refused.push('taken'); } catch (error) { refused.push(error && error.name); } }
      writer.deps.held = wait;
      await R.sleep(2500);
      const after = Object.fromEntries(app.vault.getFiles().filter((f) => f.extension === 'atlasmap').map((f) => [f.path, f.stat.mtime]));
      return { refused, changed: Object.keys(after).filter((p) => after[p] !== before[p]), dataSame: JSON.stringify(R.tt().boardData.toJSON()) === dataBefore, held: R.held(R.CELLAR) };`);
    return { pass: out.refused.every((r) => r === 'NotHeldError') && out.changed.length === 0 && out.dataSame, evidence: out };
  });

  await step(36, "no console error from Tabletop or Connect across the run; no map of Tabletop's data keeps a wall's or a light's setting of a map Atlas has held", async () => {
    await sleep(1500);
    const left = await o.ev(`
      const R = window.__R;
      const data = R.tt().boardData.toJSON();
      const keys = ['wallHeights', 'wallMaterials', 'wallWidths', 'windows', 'doorProps', 'doorFlips', 'lightHeights'];
      return Object.fromEntries(Object.entries(data).filter(([, map]) => keys.some((key) => map[key] !== undefined)).map(([p, map]) => [p, keys.filter((key) => map[key] !== undefined)]));`);
    const errors = o.logs.filter((l) => (l.type === 'error' || l.type === 'pageerror') && /tabletop|connect-for-atlas|Tabletop|Connect/i.test(l.text + l.at));
    // A map the run never brought Atlas to may still keep its own (it moves when Atlas first holds it).
    const heldMaps = ['Probe Cellar.atlasmap', 'Probe Cove.atlasmap', 'Fusion Rooms.atlasmap', 'Fusion Hex.atlasmap'];
    const kept = Object.keys(left).filter((p) => heldMaps.some((name) => p.endsWith(name)));
    return { pass: errors.length === 0 && kept.length === 0, evidence: { errors: errors.slice(0, 8), left } };
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} steps passed`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
