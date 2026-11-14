// node harness/live/phase4c-probe.cjs
// Gate probe for Phase 4C (stacks to Atlas levels), in the throwaway vault's Obsidian (role `fusion`, port 9311, Atlas
// 0.15.0). On two scratch copies of the cove (written by the probe, removed at the end) it asks of Atlas's own store:
//  - what a held map's state gives of a scene (its normalised objects, its image's size);
//  - whether `applyLevelScene` takes a scene with a new level and another scene's records on it, and `alignLevel`
//    then moves those records with the level's image, both outside the undo history (`untracked`);
//  - whether Atlas saves that as a scene with levels and reads it back the same (levels, alignment, explored memory);
//  - what becomes of an alignment Atlas's own UI would not make (a quarter turn, a place left of the origin);
//  - whether the 3D board shows the new level beside the first.
// It refuses any vault but the throwaway one. Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase4c-probe.json
const fs = require('fs'), path = require('path');
const { connect, sleep } = require('./obs.cjs');
const OUT = path.resolve(__dirname, '..', '..', '.superpowers/sdd/2026-11-13-atlas-fusion/phase4c-probe.json');

(async () => {
  const o = await connect(9311);
  for (let i = 0; i < 60; i++) { if (await o.ev("return !!app.plugins && !!app.plugins.plugins && !!app.workspace.layoutReady").catch(() => false)) break; await sleep(1000); }
  await sleep(4000);
  const out = await o.ev(`
    if (!/fusion-gate-vault/.test(String(app.vault.adapter.basePath))) return { refused: String(app.vault.adapter.basePath) };
    const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
    const CELLAR = DIR + 'Probe Cellar.atlasmap', COVE = DIR + 'Probe Cove.atlasmap';
    const BASE = DIR + 'Stack Probe Base.atlasmap', UPPER = DIR + 'Stack Probe Upper.atlasmap';
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ws = app.workspace;
    const tt = app.plugins.plugins['tabletop-for-atlas'];
    const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch {} await sleep(100); } return false; };
    const store = () => { const l = ws.getLeavesOfType('atlas-vtt')[0]; return l && l.view && l.view.atlasStore ? l.view.atlasStore : null; };
    const s = () => store().getState();
    const held = (p) => { const st = store() && s(); return !!st && st.mapPath === p && st.mapLoaded !== false && st.isMapLoading !== true; };
    const boardOf = (p) => ws.getLeavesOfType('atlas-tabletop-board').find((l) => l.view && l.view.mapPath === p) || null;
    const hold = async (p) => { if (!boardOf(p)) { await tt.openBoard(p); await until(() => boardOf(p) && boardOf(p).view.board && boardOf(p).view.map, 30000); } ws.setActiveLeaf(boardOf(p), { focus: true }); const ok = await until(() => held(p)); await sleep(800); return ok; };
    const file = async (p) => JSON.parse(await app.vault.adapter.read(p));
    const count = (objects) => Object.fromEntries(Object.entries(objects || {}).map(([kind, record]) => [kind, record && typeof record === 'object' ? Object.keys(record).length : 0]));
    const result = {};

    // Two scratch scenes: the cove twice (the same ids in both, as a scene duplicated to make a floor has).
    const cove = await app.vault.adapter.read(COVE);
    await app.vault.adapter.write(BASE, cove.split(COVE).join(BASE));
    await app.vault.adapter.write(UPPER, cove.split(COVE).join(UPPER));
    await sleep(1500);

    // The member, as Atlas holds it.
    result.heldUpper = await hold(UPPER);
    const upper = s();
    result.stateKeys = Object.keys(upper).filter((k) => typeof upper[k] !== 'function').sort();
    result.sizeKeys = result.stateKeys.filter((k) => /size|width|height|image|background|dimension/i.test(k)).map((k) => [k, typeof upper[k] === 'object' ? JSON.stringify(upper[k]).slice(0, 120) : upper[k]]);
    result.upperCounts = count(upper.objects);
    result.upperGrid = upper.grid;
    result.upperLevels = upper.levels || null;
    const member = { objects: JSON.parse(JSON.stringify(upper.objects)), background: upper.background, exploredMask: upper.exploredMask || null };
    result.boardSize = boardOf(UPPER).view.board.mapSize;

    // The base: a new level with the member's records on it.
    result.heldBase = await hold(BASE);
    const before = s();
    result.baseCounts = count(before.objects);
    result.fileVersionBefore = (await file(BASE)).state.version;
    const firstId = 'level_probe_first', upperId = 'level_probe_added';
    const KINDS = { tokens: 'level', pins: 'level', texts: 'level', drawings: 'level', fog: 'level', measures: 'level', liquids: 'level', mapFeatures: 'level', walls: 'levels', lights: 'levels', lightZones: 'levels', audios: 'levels' };
    const objects = JSON.parse(JSON.stringify(before.objects));
    const added = {};
    for (const [kind, tag] of Object.entries(KINDS)) {
      const from = member.objects[kind];
      if (!from || typeof from !== 'object') continue;
      objects[kind] = objects[kind] || {};
      for (const [id, record] of Object.entries(from)) {
        const newId = id + '_up';
        objects[kind][newId] = { ...record, id: newId, ...(tag === 'level' ? { level: upperId } : { levels: [upperId] }) };
        added[kind] = (added[kind] || 0) + 1;
      }
    }
    result.added = added;
    const levels = [
      { id: firstId, name: 'Ground', elevation: { bottom: 0, top: 10 }, background: before.background },
      { id: upperId, name: 'Upper', elevation: { bottom: 15, top: 25 }, background: member.background },
    ];
    const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const temporal = store().temporal.getState();
    result.hasUntracked = typeof temporal.untracked === 'function';
    const past = temporal.pastStates.length;
    const move = (p) => ({ x: p.x * 0.5 + 140, y: p.y * 0.5 + 70 });
    const alignment = { offset: { x: 140, y: 70 }, scale: 0.5, stretch: { x: 1, y: 1 } };
    const aToken = Object.keys(member.objects.tokens || {})[0];
    const aWall = Object.keys(member.objects.walls || {})[0];
    try {
      temporal.untracked(() => {
        s().applyLevelScene({ levels, background: before.background, objects, exploredMask: before.exploredMask ?? null, exploredMasks: { [upperId]: tiny }, levelAlignments: undefined, grid: before.grid });
        s().alignLevel(upperId, alignment, move);
      });
      result.applied = true;
    } catch (error) { result.applied = String(error && error.message || error); }
    const after = s();
    result.pastAfter = store().temporal.getState().pastStates.length - past;
    result.levelsInStore = (after.levels || []).map((l) => [l.id, l.elevation.bottom, !!l.background]);
    result.alignmentInStore = after.levelAlignments || null;
    result.countsAfter = count(after.objects);
    if (aToken) { const was = member.objects.tokens[aToken], now = after.objects.tokens[aToken + '_up']; result.tokenMoved = { was: [was.x, was.y], now: now && [now.x, now.y], want: [move(was).x, move(was).y], level: now && now.level }; }
    if (aWall) { const was = member.objects.walls[aWall], now = after.objects.walls[aWall + '_up']; result.wallMoved = { was: [was.p1.x, was.p1.y], now: now && [now.p1.x, now.p1.y], want: [move(was.p1).x, move(was.p1).y], levels: now && now.levels }; }
    // The base's own records did not move.
    const own = Object.keys(before.objects.tokens || {})[0];
    result.ownTokenStill = own ? JSON.stringify([before.objects.tokens[own].x, before.objects.tokens[own].y]) === JSON.stringify([after.objects.tokens[own].x, after.objects.tokens[own].y]) : null;
    result.exploredMasksInStore = after.exploredMasks ? Object.keys(after.exploredMasks) : null;

    // Atlas's save, and its reading it back.
    await sleep(2500);
    const saved = (await file(BASE)).state;
    result.fileVersionAfter = saved.version;
    result.fileLevels = (saved.levels || []).map((l) => ({ id: l.id, bottom: l.elevation && l.elevation.bottom, alignment: l.alignment || null }));
    result.fileCounts = count(saved.objects);
    result.fileExploredMasks = saved.exploredMasks ? Object.keys(saved.exploredMasks) : null;
    await hold(CELLAR);
    result.heldBaseAgain = await hold(BASE);
    const again = s();
    result.reloaded = { levels: (again.levels || []).map((l) => l.id), alignment: again.levelAlignments || null, counts: count(again.objects), exploredMasks: again.exploredMasks ? Object.keys(again.exploredMasks) : null,
      token: aToken && again.objects.tokens[aToken + '_up'] ? [again.objects.tokens[aToken + '_up'].x, again.objects.tokens[aToken + '_up'].y, again.objects.tokens[aToken + '_up'].level] : null };

    // The 3D board: the new level beside the first.
    const view = boardOf(BASE).view;
    await until(() => view.map && (view.map.levels || []).length === 2, 8000);
    await sleep(1500);
    result.board = { levels: (view.map.levels || []).map((l) => l.id), shown: view.map.level, otherLayers: (view.stackLayers || []).map((l) => [l.path, l.elevation]) };

    // An alignment Atlas's own UI would not make: a quarter turn, and a place left of and above the origin.
    try {
      store().temporal.getState().untracked(() => s().alignLevel(upperId, { offset: { x: -70, y: -35 }, scale: 0.5, stretch: { x: 1, y: 1, rotation: 90 } }));
      result.oddInStore = s().levelAlignments && s().levelAlignments[upperId];
    } catch (error) { result.oddInStore = 'threw: ' + String(error && error.message || error); }
    await sleep(2500);
    result.oddInFile = ((await file(BASE)).state.levels || []).map((l) => l.alignment || null);
    await hold(CELLAR);
    await hold(BASE);
    result.oddReloaded = s().levelAlignments || null;

    // Put away: the scratch scenes' boards closed, their files removed, Atlas back on the cellar.
    for (const p of [BASE, UPPER]) { const leaf = boardOf(p); if (leaf) leaf.detach(); }
    await hold(CELLAR);
    await sleep(800);
    for (const p of [BASE, UPPER]) { try { await app.vault.adapter.remove(p); } catch (error) { result.cleanup = String(error); } }
    const data = tt.boardData.toJSON();
    result.dataLeft = Object.keys(data).filter((k) => k.includes('Stack Probe'));
    return result;`);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
