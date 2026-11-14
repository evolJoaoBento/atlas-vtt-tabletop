// node harness/live/phase4c-probe2.cjs
// Second gate probe for Phase 4C, in the throwaway vault's Obsidian (role `fusion`, port 9311, Atlas 0.15.0), on a
// member with every kind of record (the cellar without its levels) under a base (the cove), both scratch copies:
//  - whether Atlas (or a plugin) writes a member's file when the host is only made to hold it, with no board;
//  - a member that lies BELOW the base: it becomes the scene's first level (Atlas reads "below" off the order of the
//    levels), the base's records name their level, the scene's background is the member's;
//  - whether `alignLevel` moves every kind of record on the level it aligns (walls, lights, measures, liquids, map
//    features, tokens, pins) and none of the base's;
//  - when Atlas saves: how long after the write the file shows the levels, and whether leaving the map at once saves it.
// It refuses any vault but the throwaway one. Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase4c-probe2.json
const fs = require('fs'), path = require('path');
const { connect, sleep } = require('./obs.cjs');
const OUT = path.resolve(__dirname, '..', '..', '.superpowers/sdd/2026-11-13-atlas-fusion/phase4c-probe2.json');

(async () => {
  const o = await connect(9311);
  for (let i = 0; i < 60; i++) { if (await o.ev("return !!app.plugins && !!app.plugins.plugins && !!app.workspace.layoutReady").catch(() => false)) break; await sleep(1000); }
  await sleep(4000);
  const out = await o.ev(`
    if (!/fusion-gate-vault/.test(String(app.vault.adapter.basePath))) return { refused: String(app.vault.adapter.basePath) };
    const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
    const CELLAR = DIR + 'Probe Cellar.atlasmap', COVE = DIR + 'Probe Cove.atlasmap';
    const BASE = DIR + 'Stack Probe Base.atlasmap', LOWER = DIR + 'Stack Probe Lower.atlasmap';
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ws = app.workspace;
    const tt = app.plugins.plugins['tabletop-for-atlas'];
    const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return Date.now() - t; } catch {} await sleep(100); } return null; };
    const store = () => { const l = ws.getLeavesOfType('atlas-vtt')[0]; return l && l.view && l.view.atlasStore ? l.view.atlasStore : null; };
    const s = () => store().getState();
    const held = (p) => { const st = store() && s(); return !!st && st.mapPath === p && st.mapLoaded !== false && st.isMapLoading !== true; };
    const boardOf = (p) => ws.getLeavesOfType('atlas-tabletop-board').find((l) => l.view && l.view.mapPath === p) || null;
    const hold = async (p) => { if (!boardOf(p)) { await tt.openBoard(p); await until(() => boardOf(p) && boardOf(p).view.board && boardOf(p).view.map, 30000); } ws.setActiveLeaf(boardOf(p), { focus: true }); const ok = await until(() => held(p)); await sleep(800); return ok !== null; };
    const file = async (p) => JSON.parse(await app.vault.adapter.read(p));
    const mtime = async (p) => (await app.vault.adapter.stat(p)).mtime;
    const count = (objects) => Object.fromEntries(Object.entries(objects || {}).map(([kind, record]) => [kind, record && typeof record === 'object' ? Object.keys(record).length : 0]));
    const result = {};

    // The base: the cove. The member: the cellar as one floor (its levels and their tags taken off).
    const cove = await app.vault.adapter.read(COVE);
    await app.vault.adapter.write(BASE, cove.split(COVE).join(BASE));
    const cellar = JSON.parse(await app.vault.adapter.read(CELLAR));
    cellar.state.mapPath = LOWER;
    delete cellar.state.levels; delete cellar.state.levelAlignments; delete cellar.state.viewedLevel; delete cellar.state.exploredMasks;
    cellar.state.version = 4;
    for (const record of Object.values(cellar.state.objects)) if (record && typeof record === 'object') for (const entry of Object.values(record)) if (entry && typeof entry === 'object') { delete entry.level; delete entry.levels; }
    await app.vault.adapter.write(LOWER, JSON.stringify(cellar));
    await sleep(1500);
    await hold(CELLAR);

    // The host made to hold the member, with no board of it: does anything write its file?
    const text0 = await app.vault.adapter.read(LOWER);
    const m0 = await mtime(LOWER);
    const followed = await tt.host.follow(LOWER, ws.getLeavesOfType('atlas-tabletop-board')[0]);
    result.followed = followed;
    result.heldLower = (await until(() => held(LOWER), 20000)) !== null;
    await sleep(4000);
    result.memberWritten = { mtimeChanged: (await mtime(LOWER)) !== m0, textChanged: (await app.vault.adapter.read(LOWER)) !== text0 };
    const lower = s();
    result.lowerCounts = count(lower.objects);
    result.lowerGrid = { size: lower.grid.size, offsetX: lower.grid.offsetX, offsetY: lower.grid.offsetY, unitDistance: lower.grid.unitDistance, mapStretch: lower.grid.mapStretch || null };
    result.lowerLevels = lower.levels || null;
    const member = { objects: JSON.parse(JSON.stringify(lower.objects)), background: lower.background };

    // The base, held; the member goes under it.
    result.heldBase = await hold(BASE);
    const before = s();
    const baseId = 'level_probe_base', lowerId = 'level_probe_lower';
    const ONE = ['tokens', 'fog', 'pins', 'texts', 'drawings', 'mapFeatures', 'liquids', 'measures'];
    const MANY = ['walls', 'lights', 'audios', 'lightZones'];
    const objects = {};
    for (const [kind, record] of Object.entries(before.objects)) {
      if (!record || typeof record !== 'object') { objects[kind] = record; continue; }
      objects[kind] = Object.fromEntries(Object.entries(record).map(([id, entry]) => [id, ONE.includes(kind) ? { ...entry, level: baseId } : MANY.includes(kind) ? { ...entry, levels: [baseId] } : entry]));
    }
    const first = {};
    for (const kind of [...ONE, ...MANY]) {
      const from = member.objects[kind];
      if (!from || typeof from !== 'object') continue;
      objects[kind] = objects[kind] || {};
      for (const [id, entry] of Object.entries(from)) {
        const newId = id + '_low';
        if (!first[kind]) first[kind] = newId;
        objects[kind][newId] = { ...entry, id: newId, ...(ONE.includes(kind) ? { level: lowerId } : { levels: [lowerId] }) };
      }
    }
    const levels = [
      { id: lowerId, name: 'Cellar', elevation: { bottom: -15, top: 0 }, background: member.background },
      { id: baseId, name: 'Cove', elevation: { bottom: 0, top: 10 }, background: before.background },
    ];
    const k = before.grid.size / lower.grid.size;
    const offset = { x: 100, y: 50 };
    const move = (p) => ({ x: p.x * k + offset.x, y: p.y * k + offset.y });
    const alignment = { offset, scale: k, stretch: { x: 1, y: 1 } };
    const temporal = store().temporal.getState();
    const past = temporal.pastStates.length;
    const wrote = Date.now();
    try {
      temporal.untracked(() => {
        s().applyLevelScene({ levels, background: member.background, objects, exploredMask: null, exploredMasks: before.exploredMask ? { [baseId]: before.exploredMask } : undefined, levelAlignments: undefined, grid: before.grid });
        s().alignLevel(lowerId, alignment, move);
      });
      result.applied = true;
    } catch (error) { result.applied = String(error && error.message || error); }
    const after = s();
    result.k = k;
    result.pastAfter = store().temporal.getState().pastStates.length - past;
    result.background = { now: after.background, members: member.background, bases: before.background };
    const near = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
    const moved = {};
    for (const [kind, id] of Object.entries(first)) {
      const was = member.objects[kind][id.replace(/_low$/, '')], now = after.objects[kind] && after.objects[kind][id];
      if (!now) { moved[kind] = 'missing'; continue; }
      const point = (r) => (r.p1 ? r.p1 : Array.isArray(r.polygon) ? r.polygon[0] : Array.isArray(r.points) ? r.points[0] : typeof r.x === 'number' ? { x: r.x, y: r.y } : null);
      const a = point(was), b = point(now);
      moved[kind] = a && b ? { ok: near(move(a), b), was: [a.x, a.y], now: [b.x, b.y], tag: now.level || now.levels, shape: now.shape || now.type || null } : { noPoint: Object.keys(now).slice(0, 12) };
    }
    result.moved = moved;
    const own = Object.keys(before.objects.tokens || {})[0];
    result.ownToken = own ? { still: before.objects.tokens[own].x === after.objects.tokens[own].x, level: after.objects.tokens[own].level } : null;
    // A measure that follows a token, and one that started on tokens: do they name tokens by id?
    result.measureRefs = Object.values(member.objects.measures || {}).map((m) => ({ shape: m.shape, follows: m.follows || null, origin: m.origin ? m.origin.tokenIds : null, tabletop: m.tabletop ? Object.keys(m.tabletop) : null }));
    result.wallChains = [...new Set(Object.values(member.objects.walls || {}).map((w) => w.chainId).filter(Boolean))].slice(0, 6);

    // When the file shows the levels.
    result.savedAfterMs = await until(async () => ((await file(BASE)).state.levels || []).length === 2, 15000);
    result.savedAfterMsFromWrite = Date.now() - wrote;
    const saved = (await file(BASE)).state;
    result.file = { version: saved.version, levels: (saved.levels || []).map((l) => [l.id, l.elevation.bottom, l.alignment || null]), background: saved.background, counts: count(saved.objects) };

    // Read back.
    await hold(CELLAR);
    result.heldBaseAgain = await hold(BASE);
    const again = s();
    result.reloaded = { levels: (again.levels || []).map((l) => l.id), alignment: again.levelAlignments || null, counts: count(again.objects), background: again.background, viewed: again.viewedLevel || null };
    const view = boardOf(BASE).view;
    await until(() => view.map && (view.map.levels || []).length === 2, 8000);
    await sleep(1500);
    result.board = { levels: (view.map.levels || []).map((l) => l.id), shown: view.map.level, otherLayers: (view.stackLayers || []).map((l) => [l.path, l.elevation]), walls: view.map.walls.length, tokens: view.map.tokens.length };

    // A write, and leaving the map at once: is it saved?
    const mark = 'level_probe_base';
    store().temporal.getState().untracked(() => s().setLevels(s().levels.map((l) => (l.id === mark ? { ...l, name: 'Cove renamed' } : l))));
    await hold(CELLAR);
    await sleep(300);
    result.savedOnLeaving = ((await file(BASE)).state.levels || []).some((l) => l.name === 'Cove renamed');
    await sleep(3000);
    result.savedLater = ((await file(BASE)).state.levels || []).some((l) => l.name === 'Cove renamed');

    // Put away.
    for (const p of [BASE, LOWER]) { const leaf = boardOf(p); if (leaf) leaf.detach(); }
    await hold(CELLAR);
    await sleep(800);
    for (const p of [BASE, LOWER]) { try { await app.vault.adapter.remove(p); } catch (error) { result.cleanup = String(error); } }
    result.dataLeft = Object.keys(tt.boardData.toJSON()).filter((key) => key.includes('Stack Probe'));
    return result;`);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
