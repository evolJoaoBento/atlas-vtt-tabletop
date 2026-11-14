// node harness/live/phase3.cjs [steps]
// The Atlas fusion Phase 3 live check, in the throwaway vault's Obsidian (role `fusion`, port 9311, Atlas 0.15.0, the
// Tabletop and Connect builds under test). It runs Phase 2's check again (which runs Phase 1's: nothing regressed),
// then the steps Phase 3 adds: a cast is one of Atlas's measures and one undo step, Atlas's undo takes it off the
// board, an area made in Atlas shows on the board, a measure moved in Atlas moves the 3D spell, what a spell stands in
// Atlas (walls, difficult ground, light) follows its measure, a cast on a map Atlas does not hold writes nothing, an
// instantaneous spell is kept nowhere, and reopening a board casts nothing again.
// Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase3-live/results.json; a failed step does not stop the run.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { connect, sleep } = require('./obs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.superpowers/sdd/2026-11-13-atlas-fusion/phase3-live');
const PORT = 9311;
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? new Set(process.argv[2].split(',').map(Number)) : null;
const results = [];
const record = (step, name, pass, evidence) => {
  results.push({ step, name, pass: !!pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}. ${name}${pass ? '' : `  ${JSON.stringify(evidence).slice(0, 900)}`}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
};

// What the steps use inside the page.
const PAGE = `
window.__Q = (() => {
  const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ws = app.workspace;
  const Q = {
    sleep, CELLAR: DIR + 'Probe Cellar.atlasmap', COVE: DIR + 'Probe Cove.atlasmap',
    tt: () => app.plugins.plugins['tabletop-for-atlas'],
    boards: () => ws.getLeavesOfType('atlas-tabletop-board'),
    boardOf: (p) => Q.boards().find((l) => l.view && l.view.mapPath === p) || null,
    atlasView: () => { const l = ws.getLeavesOfType('atlas-vtt')[0]; return l ? l.view : null; },
    store: () => { const v = Q.atlasView(); return v && v.atlasStore ? v.atlasStore : null; },
    s: () => Q.store().getState(),
    past: () => Q.store().temporal.getState().pastStates.length,
    held: (p) => { const s = Q.store() && Q.s(); return !!s && s.mapPath === p && s.mapLoaded !== false && s.isMapLoading !== true; },
    until: async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return Date.now() - t; } catch {} await sleep(100); } return null; },
    openBoard: async (p) => { await Q.tt().openBoard(p); await Q.until(() => { const l = Q.boardOf(p); return l && l.view.board && l.view.map; }, 30000); await sleep(800); return Q.boardOf(p); },
    focus: async (leaf) => { ws.setActiveLeaf(leaf, { focus: true }); await sleep(300); },
    hold: async (p) => { const leaf = Q.boardOf(p) || await Q.openBoard(p); await Q.focus(leaf); await Q.until(() => Q.held(p), 20000); await sleep(800); return leaf; },
    file: async (p) => JSON.parse(await app.vault.adapter.read(p)).state,
    measures: () => Q.s().objects.measures || {},
    spellWalls: (id) => Object.values(Q.s().objects.walls || {}).filter((w) => w.chainId === 'spell:' + id),
    spellFeatures: (id) => Object.values(Q.s().objects.mapFeatures || {}).filter((f) => f.tabletop && f.tabletop.spell === id),
    casts: (leaf) => leaf.view.board.castSpells.map((c) => c.id),
    sphere: (x, y, size) => ({ shape: 'sphere', from: 'point', at: { x, y, h: 0 }, yaw: 0, pitch: 0, roll: 0, size, length: 0, angle: 1, effect: 'fire' }),
    lasting: { line: '2nd-level conjuration', properties: [['Duration', 'Concentration, up to 1 minute']], text: 'It lasts.' },
    instant: { line: '3rd-level evocation', properties: [['Duration', 'Instantaneous']], text: 'Boom.' },
    // A cast as the board's own caster makes it: through the board's host, to the view.
    cast: (leaf, change) => leaf.view.board.host.playerAction({ type: 'spell', change }),
    newMeasure: async (before) => { let id = null; await Q.until(() => { id = Object.keys(Q.measures()).find((k) => !before.includes(k)) || null; return id !== null; }, 4000); return id; },
    // Leaves the map as it was found: every measure a step made, and what stood for it.
    sweep: async (before) => {
      for (const id of Object.keys(Q.measures())) if (!before.includes(id)) Q.s().deleteMeasure(id);
      await sleep(900);
    },
  };
  return Q;
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
  // Phases 1 and 2 first, in their own run (Phase 1 restarts Obsidian for its Atlas 0.14 step and ends on 0.15.0).
  if (!only || only.has(0)) {
    let text = '';
    try { text = execSync(`node "${path.join(__dirname, 'phase2.cjs')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 1800000 }); } catch (error) { text = String(error.stdout || error.message); }
    const summary = /(\d+)\/(\d+) steps passed\s*$/.exec(text.trim());
    record(0, "Phase 1's and Phase 2's live checks again: nothing regressed", summary && summary[1] === summary[2], { summary: summary ? summary[0] : null, failed: text.split('\n').filter((line) => line.startsWith('FAIL')) });
  }
  const o = await open();

  await step(23, "a cast that lasts is one of Atlas's measures and one step of its undo; the board draws it from there, and it is saved in the map", async () => {
    const out = await o.ev(`
      const Q = window.__Q;
      const leaf = await Q.hold(Q.CELLAR);
      const before = Object.keys(Q.measures());
      const steps = Q.past();
      Q.cast(leaf, { add: Q.sphere(700, 700, 140), name: 'Fog Cloud', about: Q.lasting });
      const id = await Q.newMeasure(before);
      const stepsAfter = Q.past() - steps;
      const shown = await Q.until(() => Q.casts(leaf).includes(id), 3000);
      const kept = id ? Q.measures()[id] : null;
      await Q.sleep(2500);
      const saved = id ? ((await Q.file(Q.CELLAR)).objects.measures || {})[id] : null;
      return { id, count: Object.keys(Q.measures()).length - before.length, stepsAfter, shown, shape: kept && kept.shape, kind: kept && kept.tabletop && kept.tabletop.kind, name: kept && kept.tabletop && kept.tabletop.name,
        inFile: !!saved && saved.tabletop && saved.tabletop.kind === 'spell', local: 'localSpells' in leaf.view, before };`);
    return { pass: !!out.id && out.count === 1 && out.stepsAfter === 1 && out.shown !== null && out.shape === 'circle' && out.kind === 'spell' && out.name === 'Fog Cloud' && out.inFile && !out.local, evidence: out };
  });

  await step(24, "Atlas's undo takes the spell off the board, its redo brings it back, and the board's own remove is one step more", async () => {
    const out = await o.ev(`
      const Q = window.__Q;
      const leaf = await Q.hold(Q.CELLAR);
      const id = Object.keys(Q.measures()).find((k) => Q.measures()[k].tabletop && Q.measures()[k].tabletop.name === 'Fog Cloud');
      if (!id) return { id: null };
      Q.store().temporal.getState().undo();
      const undone = await Q.until(() => !Q.casts(leaf).includes(id) && !Q.measures()[id], 3000);
      Q.store().temporal.getState().redo();
      const redone = await Q.until(() => Q.casts(leaf).includes(id) && !!Q.measures()[id], 3000);
      const steps = Q.past();
      Q.cast(leaf, { remove: id });
      const removed = await Q.until(() => !Q.casts(leaf).includes(id) && !Q.measures()[id], 3000);
      return { id, undone, redone, removed, removeSteps: Q.past() - steps };`);
    return { pass: !!out.id && out.undone !== null && out.redone !== null && out.removed !== null && out.removeSteps === 1, evidence: out };
  });

  await step(25, 'an area and a ruler kept in Atlas show flat on the board, and go when Atlas removes them; no spell is made of them', async () => {
    const out = await o.ev(`
      const Q = window.__Q;
      const leaf = await Q.hold(Q.CELLAR);
      const before = Object.keys(Q.measures());
      const area = Q.s().addMeasure({ shape: 'circle', points: [{ x: 420, y: 420 }, { x: 560, y: 420 }], effect: 'frost' });
      const ruler = Q.s().addMeasure({ shape: 'ruler', points: [{ x: 140, y: 140 }, { x: 280, y: 140 }, { x: 280, y: 280 }] });
      const marks = () => leaf.view.board.tools.shown.map((m) => [m.id, m.shape, m.kind, m.ruler === true]);
      const shown = await Q.until(() => marks().some((m) => m[0] === area) && marks().some((m) => m[0] === ruler + ':1'), 3000);
      const seen = marks().filter((m) => m[0] === area || m[0].startsWith(ruler));
      const noCast = !Q.casts(leaf).includes(area);
      Q.s().deleteMeasure(area);
      Q.s().deleteMeasure(ruler);
      const gone = await Q.until(() => !marks().some((m) => m[0] === area || m[0].startsWith(ruler)), 3000);
      await Q.sweep(before);
      return { area, ruler, shown, seen, noCast, gone };`);
    return { pass: out.shown !== null && out.noCast && out.gone !== null && out.seen.length === 3 && out.seen.every((m) => m[2] === 'area'), evidence: out };
  });

  await step(26, 'a spell whose measure is moved in Atlas moves on the board: its 3D shape is read from where its measure lies', async () => {
    const out = await o.ev(`
      const Q = window.__Q;
      const leaf = await Q.hold(Q.CELLAR);
      const before = Object.keys(Q.measures());
      Q.cast(leaf, { add: Q.sphere(700, 700, 140), name: 'Silence', about: Q.lasting });
      const id = await Q.newMeasure(before);
      await Q.until(() => Q.casts(leaf).includes(id), 3000);
      const at = () => { const c = leaf.view.board.castSpells.find((c) => c.id === id); return c ? { x: Math.round(c.spell.at.x), y: Math.round(c.spell.at.y), size: Math.round(c.spell.size) } : null; };
      const first = at();
      const points = Q.measures()[id].points.map((p) => ({ x: p.x + 210, y: p.y - 70 }));
      Q.s().updateMeasure(id, { points });
      const moved = await Q.until(() => at() && at().x === first.x + 210 && at().y === first.y - 70, 3000);
      const after = at();
      await Q.sweep(before);
      return { id, first, after, moved };`);
    return { pass: !!out.id && out.moved !== null && out.after.size === out.first.size, evidence: out };
  });

  await step(27, "what a spell stands is Atlas's own: a wall spell's wall, a web's difficult ground and a light's light follow the measure, outside the undo, and go with it", async () => {
    const out = await o.ev(`
      const Q = window.__Q;
      const leaf = await Q.hold(Q.CELLAR);
      const before = Object.keys(Q.measures());
      const mapWalls = leaf.view.map.walls.length;
      const steps = Q.past();
      const wall = { shape: 'wall', from: 'point', at: { x: 300, y: 980, h: 0 }, to: { x: 580, y: 980 }, yaw: 0, pitch: 0, roll: 0, size: 14, length: 140, angle: 1 };
      Q.cast(leaf, { add: wall, name: 'Wall of Stone', about: Q.lasting, rules: { wall: { look: 'stone', blocks: 'both' } } });
      const wallId = await Q.newMeasure(before);
      Q.cast(leaf, { add: Q.sphere(980, 420, 140), name: 'Web', about: Q.lasting, rules: { difficult: true, light: { bright: 20, dim: 20 } } });
      const webId = await Q.newMeasure([...before, wallId]);
      const stood = await Q.until(() => Q.spellWalls(wallId).length === 1 && Q.spellFeatures(webId).length === 1 && !!Q.measures()[webId].light, 5000);
      const castSteps = Q.past() - steps;
      const standing = Q.spellWalls(wallId)[0] || null;
      const feature = Q.spellFeatures(webId)[0] || null;
      const light = Q.measures()[webId].light || null;
      await Q.sleep(1200);
      // The board builds no wall of the map for it: it stands the spell's wall from the spell.
      const boardWalls = leaf.view.map.walls.length - mapWalls;
      const ruled = leaf.view.board.ruleState();
      await Q.sleep(2000);
      const state = await Q.file(Q.CELLAR);
      const inFile = { wall: Object.values(state.objects.walls || {}).filter((w) => w.chainId === 'spell:' + wallId).length, feature: Object.values(state.objects.mapFeatures || {}).filter((f) => f.tabletop && f.tabletop.spell === webId).length };
      // Moved in Atlas: the wall is made again where the spell lies now.
      Q.s().updateMeasure(wallId, { points: Q.measures()[wallId].points.map((p) => ({ x: p.x, y: p.y + 140 })) });
      const followed = await Q.until(() => { const w = Q.spellWalls(wallId); return w.length === 1 && Math.round(w[0].p1.y) === 1120 && Math.round(w[0].p2.y) === 1120; }, 5000);
      // Removed in Atlas: nothing of it stays.
      const undoSteps = Q.past();
      Q.s().deleteMeasure(wallId);
      Q.s().deleteMeasure(webId);
      const cleaned = await Q.until(() => Q.spellWalls(wallId).length === 0 && Q.spellFeatures(webId).length === 0, 5000);
      await Q.sweep(before);
      return { wallId, webId, stood, castSteps, standing: standing && { p1: standing.p1, p2: standing.p2, blocks: standing.blocks ?? null }, feature: feature && { corners: feature.polygon.length, terrain: feature.terrain, name: feature.name }, light, boardWalls, ruled, inFile, followed, cleaned, removeSteps: Q.past() - undoSteps };`);
    return {
      pass: out.stood !== null && out.castSteps === 2 && out.standing && out.standing.blocks === null && out.feature && out.feature.terrain && out.feature.terrain.difficult === true
        && out.light && out.light.dim === 2 * out.light.bright && out.boardWalls === 0 && out.ruled.walls >= 1 && out.inFile.wall === 1 && out.inFile.feature === 1
        && out.followed !== null && out.cleaned !== null && out.removeSteps === 2,
      evidence: out,
    };
  });

  await step(28, 'an instantaneous spell goes off on the board and is kept nowhere: no measure, no undo step', async () => {
    const out = await o.ev(`
      const Q = window.__Q;
      const leaf = await Q.hold(Q.CELLAR);
      const before = Object.keys(Q.measures());
      const steps = Q.past();
      Q.cast(leaf, { add: Q.sphere(560, 560, 140), name: 'Fireball', about: Q.instant });
      const flashed = await Q.until(() => Q.casts(leaf).some((id) => id.startsWith('flash:')), 2000);
      const written = Object.keys(Q.measures()).length - before.length;
      const stepsAfter = Q.past() - steps;
      const gone = await Q.until(() => !Q.casts(leaf).some((id) => id.startsWith('flash:')), 9000);
      return { flashed, written, stepsAfter, gone };`);
    return { pass: out.flashed !== null && out.written === 0 && out.stepsAfter === 0 && out.gone !== null, evidence: out };
  });

  await step(29, 'a cast and a template on a map Atlas does not hold are refused: nothing is written, no map file changes', async () => {
    const out = await o.ev(`
      const Q = window.__Q;
      await Q.hold(Q.CELLAR);
      const cove = Q.boardOf(Q.COVE) || await Q.openBoard(Q.COVE);
      await Q.hold(Q.CELLAR);
      const files = app.vault.getFiles().filter((f) => f.extension === 'atlasmap');
      const before = Object.fromEntries(files.map((f) => [f.path, f.stat.mtime]));
      const count = Object.keys(Q.measures()).length;
      // Writes Atlas does not come to take: the host's wait answers null while it holds another map.
      const writer = cove.view.services.writer;
      const wait = writer.deps.held;
      writer.deps.held = async () => null;
      const refused = [];
      for (const run of [
        () => writer.addMeasure(Q.COVE, { shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], tabletop: { v: 1, kind: 'spell' } }),
        () => writer.removeMeasures(Q.COVE, ['none']),
      ]) { try { await run(); refused.push('taken'); } catch (error) { refused.push(error && error.name); } }
      writer.deps.held = wait;
      await Q.sleep(2500);
      const after = Object.fromEntries(app.vault.getFiles().filter((f) => f.extension === 'atlasmap').map((f) => [f.path, f.stat.mtime]));
      const changed = Object.keys(after).filter((p) => after[p] !== before[p]);
      return { refused, changed, measures: Object.keys(Q.measures()).length - count, held: Q.held(Q.CELLAR) };`);
    return { pass: out.refused.every((r) => r === 'NotHeldError') && out.changed.length === 0 && out.measures === 0, evidence: out };
  });

  await step(30, 'a board opened again on a map with a kept spell shows it standing: no cast sound, nothing carried out, nothing written', async () => {
    const out = await o.ev(`
      const Q = window.__Q;
      let leaf = await Q.hold(Q.CELLAR);
      const before = Object.keys(Q.measures());
      Q.cast(leaf, { add: Q.sphere(840, 840, 140), name: 'Spirit Guardians', about: Q.lasting, rules: { push: 10 } });
      const id = await Q.newMeasure(before);
      await Q.until(() => Q.casts(leaf).includes(id), 3000);
      await Q.sleep(2500);
      // Every sound a board plays from here on, whichever board it is.
      const engine = leaf.view.soundEngine && leaf.view.soundEngine();
      const proto = engine ? Object.getPrototypeOf(engine) : null;
      const played = [];
      const play = proto ? proto.play : null;
      if (proto) proto.play = function (soundId, ...rest) { played.push(String(soundId)); return play.call(this, soundId, ...rest); };
      const steps = Q.past();
      leaf.detach();
      await Q.sleep(1500);
      leaf = await Q.openBoard(Q.CELLAR);
      await Q.focus(leaf);
      await Q.until(() => Q.held(Q.CELLAR), 20000);
      const back = await Q.until(() => Q.casts(leaf).includes(id), 8000);
      await Q.sleep(2500);
      if (proto) proto.play = play;
      const board = leaf.view.board;
      const review = !!(board.rulePanel && board.rulePanel.pendingFor && board.rulePanel.pendingFor(id));
      const out = { id, hooked: !!proto, back, impacts: played.filter((s) => s.startsWith('spell.impact')), fresh: [...board.newCasts], growing: board.growingSpells.size, review, stepsAfter: Q.past() - steps, stillOne: Object.keys(Q.measures()).filter((k) => !before.includes(k)).length };
      await Q.sweep(before);
      return out;`);
    return { pass: !!out.id && out.hooked && out.back !== null && out.impacts.length === 0 && out.fresh.length === 0 && out.growing === 0 && !out.review && out.stepsAfter === 0 && out.stillOne === 1, evidence: out };
  });

  await step(31, 'no console error from Tabletop or Connect across the run, and the map is left with no measure, wall or ground of a spell', async () => {
    await sleep(1500);
    const left = await o.ev(`
      const Q = window.__Q;
      await Q.hold(Q.CELLAR);
      const s = Q.s();
      return {
        // The gate probes' own records (an extra field that is not of a spell) stay as they are: read as plain areas, never touched.
        spells: Object.values(s.objects.measures || {}).filter((m) => m.tabletop && (m.tabletop.kind === 'spell' || m.tabletop.kind === 'template')).length,
        probes: Object.values(s.objects.measures || {}).filter((m) => m.tabletop && m.tabletop.probe).length + Object.values(s.objects.mapFeatures || {}).filter((f) => f.tabletop && f.tabletop.probe).length,
        walls: Object.values(s.objects.walls || {}).filter((w) => typeof w.chainId === 'string' && w.chainId.startsWith('spell:')).length,
        features: Object.values(s.objects.mapFeatures || {}).filter((f) => f.tabletop && typeof f.tabletop.spell === 'string').length,
      };`);
    const errors = o.logs.filter((l) => (l.type === 'error' || l.type === 'pageerror') && /tabletop|connect-for-atlas|Tabletop|Connect/i.test(l.text + l.at));
    return { pass: errors.length === 0 && left.spells === 0 && left.walls === 0 && left.features === 0, evidence: { errors: errors.slice(0, 8), left } };
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} steps passed`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
