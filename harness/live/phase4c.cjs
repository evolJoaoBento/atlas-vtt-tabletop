// node harness/live/phase4c.cjs [steps]
// The Atlas fusion Phase 4C live check, in the throwaway vault's Obsidian (role `fusion`, port 9311, Atlas 0.15.0, the
// Tabletop and Connect builds under test, the stack written by `fixtures.cjs`). It runs Phase 4B's check again (which
// runs Phases 1 to 4A: nothing regressed), then the steps 4C adds: the ask is shown and Later leaves everything; Move
// makes the stack the levels of its base scene through Atlas's store, with a backup, Tabletop's data following;
// a rerun and a move that stopped half way add nothing twice; a shot on a level is shown on its level; the move is
// refused while a session is hosted.
// It presses Move: it refuses any vault but the throwaway one.
// Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase4c-live/results.json; a failed step does not stop the run.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { connect, sleep } = require('./obs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.superpowers/sdd/2026-11-13-atlas-fusion/phase4c-live');
const PORT = 9311;
fs.mkdirSync(OUT, { recursive: true });
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8')).stack;
if (!FIX) throw new Error('run harness/live/fixtures.cjs first: no stack in fixtures.json');
const only = process.argv[2] ? new Set(process.argv[2].split(',').map(Number)) : null;
const results = [];
const record = (step, name, pass, evidence) => {
  results.push({ step, name, pass: !!pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}. ${name}${pass ? '' : `  ${JSON.stringify(evidence).slice(0, 1400)}`}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
};

const PAGE = `
if (!/fusion-gate-vault/.test(String(app.vault.adapter.basePath))) throw new Error('not the throwaway vault: ' + app.vault.adapter.basePath);
window.__S = (() => {
  const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ws = app.workspace;
  window.ws = ws;
  const FIX = ${JSON.stringify(FIX)};
  const S = {
    sleep, FIX, CELLAR: DIR + 'Probe Cellar.atlasmap', BASE: FIX.base, UPPER: FIX.upper, LOWER: FIX.lower,
    tt: () => app.plugins.plugins['tabletop-for-atlas'],
    data: () => S.tt().boardData,
    boards: () => ws.getLeavesOfType('atlas-tabletop-board'),
    boardOf: (p) => S.boards().find((l) => l.view && l.view.mapPath === p) || null,
    store: () => { const l = ws.getLeavesOfType('atlas-vtt')[0]; return l && l.view && l.view.atlasStore ? l.view.atlasStore : null; },
    s: () => S.store().getState(),
    held: (p) => { const s = S.store() && S.s(); return !!s && s.mapPath === p && s.mapLoaded !== false && s.isMapLoading !== true; },
    until: async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return Date.now() - t; } catch {} await sleep(100); } return null; },
    openBoard: async (p) => { await S.tt().openBoard(p); await S.until(() => { const l = S.boardOf(p); return l && l.view.board && l.view.map; }, 30000); await sleep(800); return S.boardOf(p); },
    hold: async (p) => { const leaf = S.boardOf(p) || await S.openBoard(p); ws.setActiveLeaf(leaf, { focus: true }); await sleep(300); await S.until(() => S.held(p), 20000); await sleep(800); return leaf; },
    file: async (p) => JSON.parse(await app.vault.adapter.read(p)).state,
    mtimes: async () => Object.fromEntries(await Promise.all(app.vault.getFiles().filter((f) => f.extension === 'atlasmap').map(async (f) => [f.path, (await app.vault.adapter.stat(f.path)).mtime]))),
    notices: () => [...document.querySelectorAll('.notice')].map((n) => n.innerText),
    // Stacks other than the fixture's are kept out of a Move (the vault has one of its own), and put back after.
    others: () => S.data().stacks().filter((stack) => stack.base !== S.BASE).flatMap((stack) => stack.members.map((member) => member.path)),
    // A brush mask as Tabletop saved one, for a map of this size: the rectangles (map pixels) wet.
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
    imageSize: (vaultPath) => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => resolve(null); image.src = app.vault.adapter.getResourcePath(vaultPath); }),
  };
  return S;
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
    try { text = execSync(`node "${path.join(__dirname, 'phase4b.cjs')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 3000000 }); } catch (error) { text = String(error.stdout || error.message); }
    const summary = /(\d+)\/(\d+) steps passed\s*$/.exec(text.trim());
    record(0, "Phases 1 to 4B's live checks again: nothing regressed", summary && summary[1] === summary[2], { summary: summary ? summary[0] : null, failed: text.split('\n').filter((line) => line.startsWith('FAIL')) });
  }
  const o = await open();

  await step(44, 'the ask: a notice since the start says stacks can become levels; the review tells what each would become and what is not kept; Later leaves every scene and all of Tabletop\'s data as they were', async () => {
    const out = await o.ev(`
      const S = window.__S;
      const before = await S.mtimes();
      const dataBefore = JSON.stringify(S.data().toJSON());
      const notice = S.notices().find((text) => /scene stacks? from before can become Atlas levels/.test(text)) || null;
      const pending = S.tt().stackMigration.pending().map((stack) => [stack.base, stack.members.map((member) => [member.path, member.elevation])]);
      const told = await S.tt().stackMigration.preview();
      const mine = told.find((outcome) => outcome.base === S.BASE) || null;
      // Later, pressed on the notice.
      const later = [...document.querySelectorAll('.notice button')].find((button) => button.innerText === 'Later');
      if (later) later.click();
      await S.sleep(600);
      const gone = !S.notices().some((text) => /scene stacks? from before/.test(text));
      const after = await S.mtimes();
      return { notice, pending, mine, hadLater: !!later, gone, changed: Object.keys(after).filter((p) => after[p] !== before[p]), dataSame: JSON.stringify(S.data().toJSON()) === dataBefore, held: S.s().mapPath };`);
    const mine = out.mine;
    const ok = !!out.notice && out.pending.some(([base, members]) => base === FIX.base && members.length === 2) && mine && mine.skipped === null
      && JSON.stringify(mine.levels) === JSON.stringify(['Stack Lower', 'Stack Base', 'Stack Upper']) && mine.lost.some((line) => /Stack Upper: .*initiative/.test(line))
      && out.hadLater && out.gone && out.changed.length === 0 && out.dataSame;
    return { pass: ok, evidence: out };
  });

  await step(45, "Move makes the stack the levels of its base through Atlas's store: a backup first; three levels in order at their heights, the upper fitted (scale, offset) and every kind of its records moved with it, ids given anew where the base had them, its wall height and old water on its records; saved and read back; Tabletop's data adopted; Atlas back where it was", async () => {
    const out = await o.ev(`
      const S = window.__S;
      await S.hold(S.CELLAR);
      const data = S.data(), minis = S.tt().assignments;
      // The vault's own stack is kept out of this move, and put back.
      const kept = S.others().map((p) => [p, data.snapshot(p)]);
      for (const [p, map] of kept) { const { layer, ...rest } = map; data.restore(p, rest); }
      // The upper floor's old painted water, as a vault of before had it (its mask needs the image's size).
      const upperFile = await S.file(S.UPPER);
      const size = await S.imageSize(upperFile.background);
      data.restore(S.UPPER, { ...data.snapshot(S.UPPER), water: { mask: S.mask(size, upperFile.grid.size, [{ x: 280, y: 420, w: 280, h: 140 }]), motion: { kind: 'still', amount: 0.3, direction: 0, tint: '#2a6f97', clarity: 0.5 } } });
      const upperWall = upperFile.objects.walls[S.FIX.wall];
      const upperToken = upperFile.objects.tokens[S.FIX.token];
      const upperCounts = Object.fromEntries(Object.entries(upperFile.objects).map(([kind, record]) => [kind, Object.keys(record || {}).length]));
      const baseFile = await S.file(S.BASE);
      const baseTokens = Object.keys(baseFile.objects.tokens);
      const memberTimes = { upper: (await app.vault.adapter.stat(S.UPPER)).mtime, lower: (await app.vault.adapter.stat(S.LOWER)).mtime };
      const day = new Date(); const two = (n) => String(n).padStart(2, '0'); const folder = 'Tabletop backups/' + day.getFullYear() + '-' + two(day.getMonth() + 1) + '-' + two(day.getDate());
      const backupsBefore = (await app.vault.adapter.exists(folder)) ? (await app.vault.adapter.list(folder)).files.length : 0;
      // The base is what players are shown, naming no level (as a scene without levels is presented): after the move
      // they must still be shown the base's floor, though the lower floor is the scene's first.
      await S.hold(S.BASE);
      const presented = app.plugins.plugins['atlas-vtt'].presentedScene;
      const presentedBefore = presented.get();
      const baseTab = (ws.getLeavesOfType('atlas-vtt')[0].view.tabMetaStore.getState().tabs || []).find((tab) => tab.filePath === S.BASE);
      if (baseTab) presented.set({ tabId: baseTab.id, filePath: S.BASE });
      await S.hold(S.CELLAR);
      const t0 = Date.now();
      const result = await S.tt().stackMigration.move();
      const presentedAfter = presented.get();
      presented.set(presentedBefore);
      const took = Date.now() - t0;
      for (const [p, map] of kept) data.restore(p, map);
      const outcome = result.outcomes.find((each) => each.base === S.BASE) || null;
      const backAt = S.s().mapPath;
      const backups = (await app.vault.adapter.exists(folder)) ? (await app.vault.adapter.list(folder)).files.map((f) => f.split('/').pop()) : [];
      // The base as Atlas has it now.
      await S.hold(S.BASE);
      const s = S.s();
      const levels = (s.levels || []).map((l) => ({ id: l.id, name: l.name, bottom: l.elevation.bottom, top: l.elevation.top, background: l.background }));
      const [lower, base, upper] = levels;
      const journalLevels = { base: base && base.id, upper: upper && upper.id, lower: lower && lower.id };
      const on = (kind, level) => Object.values(s.objects[kind] || {}).filter((r) => (r.level ? r.level === level : Array.isArray(r.levels) && r.levels.includes(level)));
      const k = baseFile.grid.size / upperFile.grid.size;
      const move = (p) => ({ x: p.x * k + 200, y: p.y * k + 100 });
      const near = (a, b) => !!a && !!b && Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
      const wall = s.objects.walls[S.FIX.wall];
      const token = s.objects.tokens[S.FIX.token];
      const water = on('liquids', upper && upper.id).filter((l) => l.tabletop && l.tabletop.brush === true);
      const out = {
        refused: result.refused, backup: result.backup, took, outcome, backAt,
        presented: { set: !!baseTab, after: presentedAfter }, undoLeft: S.tt().history.canUndo([S.BASE]),
        backups: { added: backups.length - backupsBefore, names: backups.filter((n) => /^Stack |^Stacks moved/.test(n)) },
        levels, alignment: s.levelAlignments || null, viewed: s.viewedLevel || null, background: s.background,
        upper: {
          counts: Object.fromEntries(['tokens', 'walls', 'lights', 'pins', 'measures', 'mapFeatures', 'liquids'].map((kind) => [kind, on(kind, upper && upper.id).length])), was: upperCounts,
          wallMoved: near(wall && wall.p1, move(upperWall.p1)), wallHeight: wall && wall.tabletop, tokenMoved: near(token, move(upperToken)), water: water.map((l) => [l.polygon.length, l.colors.surface]),
        },
        lower: { tokens: on('tokens', lower && lower.id).map((t) => t.id), aligned: !!(s.levelAlignments && lower && s.levelAlignments[lower.id]) },
        base: { tokens: baseTokens.map((id) => [id, s.objects.tokens[id] && s.objects.tokens[id].level]) },
      };
      // Saved and read back.
      await S.sleep(2500);
      const saved = await S.file(S.BASE);
      out.file = { version: saved.version, levels: (saved.levels || []).map((l) => l.id), tokens: Object.keys(saved.objects.tokens).length };
      // Tabletop's data.
      const baseData = data.toJSON()[S.BASE] || {};
      const shot = ((baseData.cutscenes || [])[0] || { shots: [] }).shots.find((each) => each.id === 's2');
      const baseShot = ((baseData.cutscenes || [])[0] || { shots: [] }).shots.find((each) => each.id === 's1');
      const prop = (baseData.props || []).find((each) => /^prop_stack@/.test(each.id));
      out.data = {
        stackLeft: data.stacks().some((stack) => stack.base === S.BASE), journal: data.stackJournal(S.BASE),
        style: data.style(S.BASE, S.FIX.token), mini: (minis.get(S.BASE, S.FIX.token) || {}).mini || null,
        prop: prop && { level: prop.level, moved: near(prop, move({ x: 280, y: 280 })) },
        hidden: lower ? data.layerHidden(S.BASE + '#atlas-level:' + lower.id) : null,
        shot: shot && { mapPath: shot.mapPath, level: shot.level, eye: shot.eye, wantEye: { ...move({ x: 700, y: 1400 }), up: 840 * k } },
        baseShot: baseShot && { mapPath: baseShot.mapPath, level: baseShot.level },
        memberKeeps: { style: data.style(S.UPPER, S.FIX.token), layer: data.layerOf(S.UPPER), water: !!(data.toJSON()[S.UPPER] || {}).water },
      };
      out.members = { upperChanged: (await app.vault.adapter.stat(S.UPPER)).mtime !== memberTimes.upper, lowerChanged: (await app.vault.adapter.stat(S.LOWER)).mtime !== memberTimes.lower,
        upperStillAScene: Object.keys((await S.file(S.UPPER)).objects.walls).length, lowerStillAScene: Object.keys((await S.file(S.LOWER)).objects.tokens).length };
      window.__S.levelsOf = journalLevels;
      return out;`);
    const o45 = out;
    const lv = o45.levels || [];
    const ok = o45.refused === null && !!o45.backup && o45.outcome && o45.outcome.moved === true && JSON.stringify(o45.outcome.levels) === JSON.stringify(['Stack Lower', 'Stack Base', 'Stack Upper'])
      && lv.length === 3 && lv[0].bottom === -10 && lv[1].bottom === 0 && lv[2].bottom === 15 && lv[0].name === 'Stack Lower' && lv[2].name === 'Stack Upper'
      && o45.alignment && o45.alignment[lv[2].id] && Math.abs(o45.alignment[lv[2].id].scale - 100 / 140) < 1e-3 && o45.alignment[lv[2].id].offset.x === 200 && o45.alignment[lv[2].id].offset.y === 100
      && !o45.lower.aligned && o45.viewed === lv[1].id
      && o45.upper.counts.walls === o45.upper.was.walls && o45.upper.counts.tokens === o45.upper.was.tokens && o45.upper.counts.lights === o45.upper.was.lights && o45.upper.counts.measures === o45.upper.was.measures
      && o45.upper.wallMoved && o45.upper.tokenMoved && o45.upper.wallHeight && o45.upper.wallHeight.height === 3 && o45.upper.water.length >= 1 && o45.upper.water.every(([, surface]) => surface === '#2a6f97')
      && o45.lower.tokens.length === 3 && o45.lower.tokens.every((id) => /_s\d/.test(id)) && o45.base.tokens.every(([, level]) => level === lv[1].id)
      && o45.file.version === 5 && o45.file.levels.length === 3
      && !o45.data.stackLeft && o45.data.journal === null && o45.data.style === 'standee' && o45.data.mini === FIX.glb && o45.data.prop && o45.data.prop.level === lv[2].id && o45.data.prop.moved
      && o45.data.hidden === true && o45.data.shot && o45.data.shot.mapPath === FIX.base && o45.data.shot.level === lv[2].id
      && Math.abs(o45.data.shot.eye.x - o45.data.shot.wantEye.x) < 0.05 && Math.abs(o45.data.shot.eye.z - o45.data.shot.wantEye.y) < 0.05 && Math.abs(o45.data.shot.eye.y - o45.data.shot.wantEye.up) < 0.05
      && o45.data.memberKeeps.style === 'standee' && o45.data.memberKeeps.layer === null
      && o45.data.baseShot && o45.data.baseShot.level === lv[1].id
      && o45.presented.set && o45.presented.after && o45.presented.after.filePath === FIX.base && o45.presented.after.levelId === lv[1].id && o45.undoLeft === false
      && o45.backups.names.some((n) => /^Stack Base.*\.atlasmap$/.test(n)) && o45.backups.names.some((n) => /^Stack Upper.*\.minis\.json$/.test(n)) && o45.backups.names.some((n) => /^Stacks moved/.test(n))
      && o45.members.upperStillAScene > 0 && o45.members.lowerStillAScene > 0 && /Probe Cellar/.test(o45.backAt || '');
    return { pass: ok, evidence: out };
  });

  await step(46, 'the 3D board of the base shows its three floors: the base shown, the other two as layers below and above; the upper floor\'s wall stands as high as it was set, its mini stands on its token', async () => {
    const out = await o.ev(`
      const S = window.__S;
      const leaf = await S.hold(S.BASE);
      const view = leaf.view;
      await S.until(() => view.map && view.map.levels.length === 3 && (view.stackLayers || []).length === 2, 12000);
      await S.sleep(1500);
      const levels = S.levelsOf || {};
      const layers = (view.stackLayers || []).map((l) => [l.path, l.elevation]).sort((a, b) => a[1] - b[1]);
      const upperLayer = (view.stackLayers || []).find((l) => l.path === 'atlas-level:' + levels.upper);
      return { levels: view.map.levels.map((l) => l.id), shown: view.map.level, want: levels, layers,
        upperWalls: upperLayer ? upperLayer.map.walls.length : null, upperWallHeight: upperLayer ? upperLayer.wallHeight(S.FIX.wall) : null,
        upperMini: upperLayer ? (upperLayer.placement(S.FIX.token) || {}).mini || null : null };`);
    const ok = out.levels.length === 3 && out.shown === out.want.base && out.layers.length === 2 && out.layers[0][1] === -2 && out.layers[1][1] === 3
      && out.upperWalls > 0 && out.upperWallHeight === 3 && out.upperMini === FIX.glb;
    return { pass: ok, evidence: out };
  });

  await step(47, 'asked again there is nothing to move; a journal left by a move that stopped after Atlas was written is finished at start without a level added twice; one whose write never landed is dropped and its stack is as it was', async () => {
    const out = await o.ev(`
      const S = window.__S;
      await S.hold(S.BASE);
      const data = S.data();
      const levels = S.levelsOf;
      const kept = S.others().map((p) => [p, data.snapshot(p)]);
      for (const [p, map] of kept) { const { layer, ...rest } = map; data.restore(p, rest); }
      const again = await S.tt().stackMigration.move();
      // As after a stop between Atlas's save and Tabletop's side: the stack's record and the journal are back.
      const upperData = data.snapshot(S.UPPER) || {};
      data.restore(S.UPPER, { ...upperData, layer: { base: S.BASE, elevation: 3, x: 200, y: 100 } });
      data.setStackJournal(S.BASE, { baseLevel: levels.base, members: [{ path: S.UPPER, level: levels.upper, ids: {}, frame: { k: 100 / 140, x: 200, y: 100 } }] });
      const propsBefore = data.props(S.BASE).length;
      await S.tt().stackMigration.finishJournals();
      const finished = { stack: data.stacks().some((stack) => stack.base === S.BASE), journal: data.stackJournal(S.BASE), levels: (S.s().levels || []).length, props: data.props(S.BASE).length - propsBefore };
      // A journal whose levels the file never got.
      data.restore(S.UPPER, { ...(data.snapshot(S.UPPER) || {}), layer: { base: S.BASE, elevation: 3 } });
      data.setStackJournal(S.BASE, { baseLevel: 'level_never', members: [{ path: S.UPPER, level: 'level_never_2', ids: {}, frame: { k: 1, x: 0, y: 0 } }] });
      await S.tt().stackMigration.finishJournals();
      const dropped = { stack: data.stacks().some((stack) => stack.base === S.BASE), journal: data.stackJournal(S.BASE), levels: (S.s().levels || []).length };
      // Put away: the base has its levels, so that record is no stack to keep.
      const { layer, ...rest } = data.snapshot(S.UPPER) || {};
      data.restore(S.UPPER, rest);
      for (const [p, map] of kept) data.restore(p, map);
      return { again: { outcomes: again.outcomes.length, backup: again.backup, refused: again.refused }, finished, dropped };`);
    const ok = out.again.outcomes === 0 && out.again.backup === null && !out.finished.stack && out.finished.journal === null && out.finished.levels === 3 && out.finished.props === 0
      && out.dropped.stack && out.dropped.journal === null && out.dropped.levels === 3;
    return { pass: ok, evidence: out };
  });

  await step(48, "a cutscene's shot on a level is shown on its level: the board goes to the upper floor for the re-pointed shot, says it is there, and comes back to the base's", async () => {
    const out = await o.ev(`
      const S = window.__S;
      const leaf = await S.hold(S.BASE);
      const view = leaf.view;
      const levels = S.levelsOf;
      const host = view.studioHost();
      const shot = ((S.data().toJSON()[S.BASE].cutscenes || [])[0] || { shots: [] }).shots.find((each) => each.id === 's2');
      const place = shot.mapPath + '\\n' + shot.level;
      const before = { place: host.place(), at: host.at(place), level: view.map.level };
      const shown = await host.showPlace(place);
      await S.sleep(1200);
      const there = { place: host.place(), at: host.at(place), level: view.map.level, atlas: S.s().viewedLevel || null };
      const back = await host.showPlace(S.BASE + '\\n' + levels.base);
      await S.sleep(1200);
      const home = { level: view.map.level, at: host.at(S.BASE + '\\n' + levels.base), atMap: host.at(S.BASE) };
      return { shot: { mapPath: shot.mapPath, level: shot.level }, before, shown, there, back, home, levels };`);
    const ok = out.shot.level === out.levels.upper && !out.before.at && out.shown === true && out.there.at && out.there.level === out.levels.upper && out.there.atlas === out.levels.upper
      && out.back === true && out.home.level === out.levels.base && out.home.at && out.home.atMap === false;
    return { pass: ok, evidence: out };
  });

  await step(49, 'while Connect hosts a session nothing is moved, and it is said why', async () => {
    const out = await o.ev(`
      const S = window.__S;
      const tt = S.tt();
      const real = tt.session;
      tt.session = { hosting: () => true };
      let result;
      try { result = await tt.stackMigration.move(); } finally { tt.session = real; }
      return { refused: result.refused, outcomes: result.outcomes.length, backup: result.backup };`);
    return { pass: /session is hosted/.test(out.refused || '') && out.outcomes === 0 && out.backup === null, evidence: out };
  });

  await step(51, "a floor that lay left of the base's corner sets the whole scene aside by whole squares: the base's own level is aligned and its records moved with it, every floor keeps its place against the others, and Atlas reads it back so after a reload", async () => {
    const side = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8')).side;
    const out = await o.ev(`
      const S = window.__S;
      const SIDE = ${JSON.stringify(side)};
      await S.hold(S.CELLAR);
      const data = S.data();
      const kept = data.stacks().filter((stack) => stack.base !== SIDE.base).flatMap((stack) => stack.members.map((member) => member.path)).map((p) => [p, data.snapshot(p)]);
      for (const [p, map] of kept) { const { layer, ...rest } = map; data.restore(p, rest); }
      const before = await S.file(SIDE.base);
      const upperBefore = await S.file(SIDE.upper);
      const cell = before.grid.size;
      const tokenId = Object.keys(before.objects.tokens)[0];
      const upperToken = Object.keys(upperBefore.objects.tokens)[0];
      const result = await S.tt().stackMigration.move();
      for (const [p, map] of kept) data.restore(p, map);
      const outcome = result.outcomes.find((each) => each.base === SIDE.base) || null;
      await S.hold(SIDE.base);
      await S.hold(S.CELLAR);
      await S.hold(SIDE.base);
      const s = S.s();
      const levels = (s.levels || []).map((l) => l.id);
      const [baseLevel, upperLevel] = levels;
      const moved = s.objects.tokens[tokenId];
      const upperId = Object.keys(s.objects.tokens).find((id) => id.startsWith(upperToken) && id !== tokenId && s.objects.tokens[id].level === upperLevel);
      const upper = upperId ? s.objects.tokens[upperId] : null;
      return { refused: result.refused, moved: outcome && outcome.moved, lost: outcome && outcome.lost, cell, levels, alignments: s.levelAlignments || null,
        baseToken: { was: [before.objects.tokens[tokenId].x, before.objects.tokens[tokenId].y], now: moved && [moved.x, moved.y] },
        upperToken: { was: [upperBefore.objects.tokens[upperToken].x, upperBefore.objects.tokens[upperToken].y], now: upper && [upper.x, upper.y] } };`);
    const a = out.alignments || {};
    const [baseLevel, upperLevel] = out.levels || [];
    const shift = 3 * out.cell;
    const ok = out.refused === null && out.moved === true && out.levels.length === 2
      && a[baseLevel] && a[baseLevel].offset.x === shift && a[baseLevel].offset.y === 0 && a[upperLevel] && a[upperLevel].offset.x === shift - 250
      && out.baseToken.now && Math.abs(out.baseToken.now[0] - (out.baseToken.was[0] + shift)) < 0.01 && out.baseToken.now[1] === out.baseToken.was[1]
      && out.upperToken.now && Math.abs(out.upperToken.now[0] - (out.upperToken.was[0] + shift - 250)) < 0.01
      && out.lost.some((line) => /whole scene stands 3 squares to the right/.test(line));
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
