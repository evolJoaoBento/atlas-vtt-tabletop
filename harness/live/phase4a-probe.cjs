// node harness/live/phase4a-probe.cjs
// Gate probe for Phase 4A, in the throwaway vault's Obsidian (role `fusion`, port 9311, Atlas 0.15.0): whether a
// `tabletop` field put on a wall, a placed light and a token with Atlas's own update actions is kept in the store, in
// the map file after the save, after Atlas's own edits of the same record, and after switching map and back.
// Everything the probe changes is put back. Results: .superpowers/sdd/2026-11-13-atlas-fusion/phase4a-probe.json
const fs = require('fs'), path = require('path');
const { connect, sleep } = require('./obs.cjs');
const OUT = path.resolve(__dirname, '..', '..', '.superpowers/sdd/2026-11-13-atlas-fusion/phase4a-probe.json');

(async () => {
  const o = await connect(9311);
  for (let i = 0; i < 60; i++) { if (await o.ev("return !!app.plugins && !!app.plugins.plugins && !!app.workspace.layoutReady").catch(() => false)) break; await sleep(1000); }
  await sleep(4000);
  const out = await o.ev(`
    const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
    const CELLAR = DIR + 'Probe Cellar.atlasmap', COVE = DIR + 'Probe Cove.atlasmap';
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ws = app.workspace;
    const tt = app.plugins.plugins['tabletop-for-atlas'];
    const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch {} await sleep(100); } return false; };
    const store = () => { const l = ws.getLeavesOfType('atlas-vtt')[0]; return l && l.view && l.view.atlasStore ? l.view.atlasStore : null; };
    const s = () => store().getState();
    const held = (p) => { const st = store() && s(); return !!st && st.mapPath === p && st.mapLoaded !== false && st.isMapLoading !== true; };
    const boardOf = (p) => ws.getLeavesOfType('atlas-tabletop-board').find((l) => l.view && l.view.mapPath === p) || null;
    const hold = async (p) => { if (!boardOf(p)) { await tt.openBoard(p); await until(() => boardOf(p) && boardOf(p).view.board && boardOf(p).view.map, 30000); } ws.setActiveLeaf(boardOf(p), { focus: true }); await until(() => held(p)); await sleep(800); };
    const file = async (p) => JSON.parse(await app.vault.adapter.read(p)).state;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const result = {};
    await hold(CELLAR);
    result.actions = Object.keys(s()).filter((k) => typeof s()[k] === 'function' && /^(update|add|delete)(Wall|Walls|Light|Token|Tokens)$/.test(k)).sort();
    const extra = { v: 1, height: 2.5, width: 0.3, material: 'Materials/stone', window: { bottom: 1, top: 2 }, prop: 'Props/door.glb', hinge: true };

    // Walls: a plain wall and a door (made here, removed at the end).
    const wall = s().addWall({ type: 'solid', p1: { x: 2100, y: 2100 }, p2: { x: 2240, y: 2100 } });
    const door = s().addWall({ type: 'door', p1: { x: 2240, y: 2100 }, p2: { x: 2380, y: 2100 }, closed: true });
    s().updateWall(wall, { tabletop: extra });
    s().updateWall(door, { tabletop: extra });
    s().toggleDoor(door);
    s().updateWall(wall, { blocks: 'movement' });
    result.wall = { inStore: same(s().objects.walls[wall].tabletop, extra), doorAfterToggle: same(s().objects.walls[door].tabletop, extra), afterOwnEdit: same(s().objects.walls[wall].tabletop, extra) };

    // A placed light.
    const hasLights = typeof s().addLight === 'function' && typeof s().updateLight === 'function';
    let light = null;
    if (hasLights) {
      light = s().addLight({ x: 2100, y: 2300, emission: { bright: 10, dim: 20, color: '#ffffff', intensity: 1, animation: 'none' } });
      s().updateLight(light, { tabletop: { v: 1, height: 3 } });
      s().updateLight(light, { x: 2170 });
      result.light = { inStore: same(s().objects.lights[light].tabletop, { v: 1, height: 3 }), record: Object.keys(s().objects.lights[light]).sort() };
    } else result.light = { missing: true };

    // A token: the field, then Atlas's own move of it.
    const token = Object.values(s().objects.tokens).find((t) => !t.offMap);
    const before = token.tabletop;
    s().updateToken(token.id, { tabletop: { v: 1, lightHeight: 2 } });
    s().updateToken(token.id, { x: token.x + 70 });
    s().updateToken(token.id, { x: token.x });
    result.token = { inStore: same(s().objects.tokens[token.id].tabletop, { v: 1, lightHeight: 2 }) };

    await sleep(2800);
    const saved = await file(CELLAR);
    result.wall.inFile = same(saved.objects.walls[wall] && saved.objects.walls[wall].tabletop, extra) && same(saved.objects.walls[door] && saved.objects.walls[door].tabletop, extra);
    if (light) result.light.inFile = same(saved.objects.lights[light] && saved.objects.lights[light].tabletop, { v: 1, height: 3 });
    result.token.inFile = same(saved.objects.tokens[token.id].tabletop, { v: 1, lightHeight: 2 });

    // Away and back: the store reads the file again.
    await hold(COVE);
    await hold(CELLAR);
    result.wall.back = same(s().objects.walls[wall] && s().objects.walls[wall].tabletop, extra);
    if (light) result.light.back = same(s().objects.lights[light] && s().objects.lights[light].tabletop, { v: 1, height: 3 });
    result.token.back = same(s().objects.tokens[token.id].tabletop, { v: 1, lightHeight: 2 });
    // A field given as undefined: is it removed?
    s().updateWall(wall, { tabletop: undefined });
    s().updateToken(token.id, { tabletop: before });
    result.wall.removedByUndefined = !('tabletop' in s().objects.walls[wall]) || s().objects.walls[wall].tabletop === undefined;
    result.token.restored = same(s().objects.tokens[token.id].tabletop, before);

    // Clean up.
    s().deleteWalls([wall, door]);
    if (light && s().deleteLight) s().deleteLight(light);
    await sleep(2800);
    const end = await file(CELLAR);
    result.clean = !end.objects.walls[wall] && !end.objects.walls[door] && (!light || !end.objects.lights[light]) && same(end.objects.tokens[token.id].tabletop, before);
    return result;`);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
