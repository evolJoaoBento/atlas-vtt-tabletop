// node harness/live/phase4d-probe.cjs
// Gate probe for Phase 4D, in the throwaway vault's Obsidian (role `fusion`, port 9311): whether the Atlas tab that
// Tabletop hosts hidden, behind the board, works out sight once the scene is lit, as Connect reads it (its
// `controllerOf` path: `renderer.lighting`, else `renderer.lightingFeature.controller`): a controller, `isEnabled()`,
// `sightIsCurrent()`, `currentSight()` (regions by token), `lightReaches()`, the players' frame perception, and
// whether the sight changes after a token is moved through the store. It puts the scene's lighting back as it was.
// It refuses any vault but the throwaway one. Results: .superpowers/sdd/2026-11-14-atlas-fusion-phase4d/probe-<build>.json
const fs = require('fs'), path = require('path');
const { connect, sleep } = require('./obs.cjs');
const BUILD = process.env.ATLAS_BUILD || '0.15.0';
const OUT = path.resolve(__dirname, '..', '..', `.superpowers/sdd/2026-11-14-atlas-fusion-phase4d/probe-${BUILD}.json`);

(async () => {
  const o = await connect(9311);
  for (let i = 0; i < 60; i++) { if (await o.ev("return !!app.plugins && !!app.plugins.plugins && !!app.workspace.layoutReady").catch(() => false)) break; await sleep(1000); }
  await sleep(4000);
  const out = await o.ev(`
    if (!/fusion-gate-vault/.test(String(app.vault.adapter.basePath))) return { refused: String(app.vault.adapter.basePath) };
    const CELLAR = 'atlas-vtt/collections/The Gilded Flagon/scenes/Probe Cellar.atlasmap';
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ws = app.workspace;
    const tt = app.plugins.plugins['tabletop-for-atlas'];
    const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return Date.now() - t; } catch {} await sleep(100); } return null; };
    const leaf = () => ws.getLeavesOfType('atlas-vtt')[0] || null;
    const store = () => { const l = leaf(); return l && l.view && l.view.atlasStore ? l.view.atlasStore : null; };
    const s = () => store().getState();
    const boardOf = (p) => ws.getLeavesOfType('atlas-tabletop-board').find((l) => l.view && l.view.mapPath === p) || null;
    for (const l of ws.getLeavesOfType('atlas-tabletop-board')) l.detach();
    for (const l of ws.getLeavesOfType('atlas-vtt')) l.detach();
    await sleep(800);
    await tt.openBoard(CELLAR);
    await until(() => boardOf(CELLAR) && boardOf(CELLAR).view.board && boardOf(CELLAR).view.map, 30000);
    ws.setActiveLeaf(boardOf(CELLAR), { focus: true });
    const heldMs = await until(() => store() && s().mapPath === CELLAR && s().mapLoaded !== false && s().isMapLoading !== true);
    const result = { build: ${JSON.stringify(BUILD)}, heldMs, hidden: leaf() ? leaf().view.containerEl.offsetParent === null : null };
    const before = structuredClone(s().lighting);
    s().setSceneLighting({ enabled: true });
    // One token that sees (Atlas counts a token with vision on among the players'), put back after.
    const all = Object.values(s().objects.tokens || {});
    result.tokens = all.map((t) => ({ id: t.id, hidden: !!t.isHidden, vision: t.vision || null, level: t.level ?? null, x: t.x, y: t.y }));
    const sees = all.find((t) => !t.level) || all[0] || null;
    const wasHidden = sees ? sees.isHidden : undefined;
    result.viewedLevel = s().viewedLevel ?? null;
    const hadVision = sees ? structuredClone(sees.vision) : undefined;
    if (sees) s().updateToken(sees.id, { isHidden: false, vision: { enabled: true, darkvision: 60 } });
    result.seer = sees ? sees.id : null;
    const field = (t, n) => (t && (typeof t === 'object' || typeof t === 'function') ? t[n] : undefined);
    const controller = () => {
      const r = leaf() && leaf().view.renderer;
      const own = field(r, 'lighting');
      return own && typeof own.playerSight === 'function' ? own : field(field(r, 'lightingFeature'), 'controller');
    };
    const read = () => {
      const c = controller();
      const lit = c && c.renderer;
      if (!c || !lit) return { controller: !!c, renderer: !!lit };
      const sight = lit.currentSight && lit.currentSight();
      const reaches = lit.lightReaches && lit.lightReaches();
      const r = leaf().view.renderer;
      const tokens = r.getTokenRenderer ? r.getTokenRenderer() : null;
      const perceive = tokens && tokens.playerFramePerception ? tokens.playerFramePerception(c.playerSight()) : null;
      const ids = Object.keys(s().objects.tokens || {});
      return {
        controller: true, viaOwn: typeof field(r, 'lighting')?.playerSight === 'function',
        enabled: lit.isEnabled(), current: lit.sightIsCurrent(),
        sight: sight ? { all: sight.all, regions: (sight.regions || []).map((g) => ({ tokenId: g.tokenId, sense: g.sense && g.sense.name, corners: g.polygon && g.polygon.length, radius: g.radius })) } : null,
        reaches: Array.isArray(reaches) ? reaches.length : null, reachKeys: Array.isArray(reaches) && reaches[0] ? Object.keys(reaches[0]) : null,
        perception: perceive ? Object.fromEntries(ids.map((id) => [id, perceive(id)])) : null,
        ref: sight,
      };
    };
    result.settleMs = await until(() => { const c = controller(); return c && c.renderer && c.renderer.isEnabled() && c.renderer.sightIsCurrent(); }, 15000);
    const first = read();
    result.first = { ...first, ref: undefined };
    await sleep(3000);
    result.later = { ...read(), ref: undefined };
    // The same, with the Atlas tab in front for a moment: does it work sight out only while drawn?
    const board = boardOf(CELLAR);
    ws.setActiveLeaf(leaf(), { focus: true });
    await sleep(3000);
    result.visible = { ...read(), ref: undefined, hidden: leaf().view.containerEl.offsetParent === null };
    ws.setActiveLeaf(board, { focus: true });
    await sleep(3000);
    result.hiddenAgain = { ...read(), ref: undefined, hidden: leaf().view.containerEl.offsetParent === null };
    // A token moved one square through the store: does the sight follow?
    const tokens = Object.values(s().objects.tokens || {});
    const seer = (first.sight && first.sight.regions[0] && tokens.find((t) => t.id === first.sight.regions[0].tokenId)) || tokens[0];
    const cell = (s().grid && s().grid.size) || 50;
    if (seer) {
      s().updateToken(seer.id, { x: seer.x + cell, y: seer.y });
      result.movedMs = await until(() => { const now = read(); return now.current && now.ref !== first.ref; }, 10000);
      const second = read();
      result.second = { ...second, ref: undefined };
      s().updateToken(seer.id, { x: seer.x, y: seer.y });
    }
    if (sees) s().updateToken(sees.id, { isHidden: wasHidden, vision: hadVision });
    s().setSceneLighting(before);
    await sleep(1500);
    result.restored = s().lighting.enabled === before.enabled;
    return result;
  `);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out).slice(0, 3000));
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
