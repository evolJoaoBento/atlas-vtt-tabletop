// node harness/live/phase1.cjs
// The Atlas fusion Phase 1 live check: drives the throwaway vault's Obsidian (role `fusion`, port 9311, the Atlas build in ATLAS_BUILD (0.15.0 unless set),
// the Tabletop and Connect builds under test) over DevTools. Each step records pass or fail with its evidence in
// .superpowers/sdd/2026-11-13-atlas-fusion/phase1-live/results.json; a failed step does not stop the run.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { connect, sleep } = require('./obs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const VAULT = 'C:/Users/joaoo/fusion-gate-vault';
const OUT = path.join(ROOT, '.superpowers/sdd/2026-11-13-atlas-fusion/phase1-live');
const ATLAS = (version) => `C:/Users/joaoo/2075/sound-downloads/atlas-${version}`;
const PORT = 9311;
fs.mkdirSync(OUT, { recursive: true });
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
// The builds under test: their versions and the fusion step their wire carries (re-run in later phases).
const TABLETOP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
const CONNECT_VERSION = JSON.parse(fs.readFileSync(path.join(process.env.CONNECT_REPO || 'C:/Users/joaoo/2075/atlas-vtt-connect-cutscenes-wt', 'manifest.json'), 'utf8')).version;
const FUSION = Number(/export const FUSION_PROTOCOL = (\d+)/.exec(fs.readFileSync(path.join(ROOT, 'src/connectWire.ts'), 'utf8'))[1]);
const only = process.argv[2] ? new Set(process.argv[2].split(',').map(Number)) : null;

const results = [];
const allLogs = [];
const record = (step, name, pass, evidence) => {
  results.push({ step, name, pass: !!pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}. ${name}${pass ? '' : `  ${JSON.stringify(evidence).slice(0, 600)}`}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
};

// What every step uses inside the page.
const PAGE = `
window.__L = (() => {
  const DIR = 'atlas-vtt/collections/The Gilded Flagon/scenes/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ws = app.workspace;
  const L = {
    sleep, CELLAR: DIR + 'Probe Cellar.atlasmap', COVE: DIR + 'Probe Cove.atlasmap', UPPER: DIR + 'Probe Upper.atlasmap',
    tt: () => app.plugins.plugins['tabletop-for-atlas'],
    connect: () => app.plugins.plugins['atlas-vtt-connect'],
    atlasLeaves: () => ws.getLeavesOfType('atlas-vtt'),
    boards: () => ws.getLeavesOfType('atlas-tabletop-board'),
    boardOf: (p) => L.boards().find((l) => l.view && l.view.mapPath === p) || null,
    store: () => { const l = L.atlasLeaves()[0]; return l && l.view && l.view.atlasStore ? l.view.atlasStore : null; },
    held: (p) => { const s = L.store() && L.store().getState(); return !!s && s.mapPath === p && s.mapLoaded !== false && s.isMapLoading !== true; },
    until: async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return Date.now() - t; } catch {} await sleep(100); } return null; },
    banner: (leaf) => { const el = leaf && leaf.view && leaf.view.contentEl.querySelector('.atlas-tabletop-banner'); if (!el || el.hidden) return null; const b = el.querySelector('button'); return { text: (el.firstChild && el.firstChild.textContent) || el.textContent, button: b ? b.textContent : null }; },
    clickBanner: (leaf) => { const b = leaf.view.contentEl.querySelector('.atlas-tabletop-banner button'); if (b) b.click(); return !!b; },
    active: () => ws.activeLeaf,
    openBoard: async (p) => { await L.tt().openBoard(p); await L.until(() => { const l = L.boardOf(p); return l && l.view.board && l.view.map; }, 30000); await sleep(800); return L.boardOf(p); },
    focus: async (leaf) => { ws.setActiveLeaf(leaf, { focus: true }); await sleep(300); },
    closeAll: async (type) => { for (const l of ws.getLeavesOfType(type)) l.detach(); await sleep(500); },
    notices: [],
    mtime: async (p) => (await app.vault.adapter.stat(p)).mtime,
    file: async (p) => JSON.parse(await app.vault.adapter.read(p)),
  };
  if (window.__noticeWatch) window.__noticeWatch.disconnect();
  {
    window.__noticeWatch = new MutationObserver(() => document.querySelectorAll('.notice').forEach((n) => { const text = n.innerText; if (text && !L.notices.includes(text)) L.notices.push(text); }));
    window.__noticeWatch.observe(document.body, { childList: true, subtree: true });
  }
  return L;
})();
return true;`;

async function open(settle = 4000) {
  const o = await connect(PORT);
  // The plugins load after the window is up.
  for (let i = 0; i < 60; i++) { if (await o.ev("return !!app.plugins && !!app.plugins.plugins && !!app.workspace.layoutReady").catch(() => false)) break; await sleep(1000); }
  // settle 0: the notices of the first seconds are wanted (Connect says what it needs three seconds after the layout is ready).
  await sleep(settle);
  await o.ev(PAGE);
  return o;
}
const launch = () => { execSync(`node "${path.join(__dirname, 'launch.cjs')}" fusion ${PORT} ${VAULT}`, { stdio: 'inherit' }); };
const kill = () => { try { execSync(`powershell -NoProfile -File "${path.join(__dirname, 'kill.ps1')}" -Role fusion`); } catch {} };
// The Atlas build the run is checked against (`ATLAS_BUILD=0.16.0 node harness/live/phase4c.cjs`): the version step
// expects it, and the floor step puts it back after showing an older Atlas.
const BUILD = process.env.ATLAS_BUILD || '0.15.0';
if (!/^\d+\.\d+\.\d+$/.test(BUILD)) throw new Error('ATLAS_BUILD is no version: ' + BUILD);
const install = (version) => execSync(`node "${path.join(__dirname, 'install.cjs')}" ${VAULT} --atlas "${ATLAS(version)}"`, { stdio: 'pipe' });

async function step(o, n, name, run) {
  if (only && !only.has(n)) return;
  try {
    const out = await run();
    record(n, name, out.pass, out.evidence);
  } catch (error) {
    record(n, name, false, { threw: String(error && error.message || error) });
  }
}

(async () => {
  let o = await open();

  await step(o, 1, 'versions and pairing', async () => {
    const e = await o.ev(`const L = window.__L; const tt = L.tt(), c = L.connect();
      return { atlas: app.plugins.manifests['atlas-vtt'].version, tabletop: app.plugins.manifests['tabletop-for-atlas'].version, connect: app.plugins.manifests['atlas-vtt-connect'].version,
        loaded: [!!tt, !!c], fusion: tt && tt.api ? tt.api.fusion : null, notices: L.notices.slice() };`);
    const pairing = e.notices.filter((n) => /do not match/.test(n));
    return { pass: e.atlas === BUILD && e.tabletop === TABLETOP_VERSION && e.connect === CONNECT_VERSION && e.loaded.every(Boolean) && e.fusion === FUSION && pairing.length === 0, evidence: e };
  });

  await step(o, 3, 'host from nothing: one hidden Atlas tab, the board in front', async () => {
    const e = await o.ev(`const L = window.__L;
      await L.closeAll('atlas-tabletop-board'); await L.closeAll('atlas-vtt');
      const before = L.atlasLeaves().length;
      const board = await L.openBoard(L.CELLAR);
      const ms = await L.until(() => L.held(L.CELLAR));
      await L.sleep(1000);
      const atlas = L.atlasLeaves();
      return { before, leaves: atlas.length, hidden: atlas[0] ? atlas[0].view.containerEl.offsetParent === null : null, boardActive: L.active() === board, heldMs: ms,
        mark: atlas[0] && atlas[0].__atlasFusionHost ? { openedBy: atlas[0].__atlasFusionHost.openedBy, claims: [...atlas[0].__atlasFusionHost.claims] } : null, banner: L.banner(board) };`);
    return { pass: e.before === 0 && e.leaves === 1 && e.hidden === true && e.boardActive && e.heldMs !== null && e.banner === null, evidence: e };
  });

  await step(o, 2, 'no asset-service error once a board and an Atlas view are up', async () => {
    await sleep(1500);
    const bad = o.logs.filter((l) => /Initializing asset service failed/.test(l.text));
    return { pass: bad.length === 0, evidence: { found: bad.length, sample: bad[0] || null } };
  });

  await step(o, 4, 'the host follows the focused board; the other board is view only; Edit here brings it back', async () => {
    const e = await o.ev(`const L = window.__L;
      const cellar = L.boardOf(L.CELLAR);
      const cove = await L.openBoard(L.COVE);
      await L.focus(cove);
      const coveMs = await L.until(() => L.held(L.COVE));
      await L.sleep(800);
      const a = { coveMs, coveActive: L.active() === cove, leaves: L.atlasLeaves().length, cellarBanner: L.banner(cellar), coveBanner: L.banner(cove) };
      L.clickBanner(cellar);
      const cellarMs = await L.until(() => L.held(L.CELLAR));
      await L.sleep(800);
      return { ...a, cellarMs, cellarActive: L.active() === cellar, leavesAfter: L.atlasLeaves().length, cellarBannerAfter: L.banner(cellar), coveBannerAfter: L.banner(cove),
        atlasHidden: L.atlasLeaves()[0].view.containerEl.offsetParent === null };`);
    const pass = e.coveMs !== null && e.coveActive && e.leaves === 1 && e.cellarBanner && e.cellarBanner.text === 'View only. Atlas holds Probe Cove.' && e.cellarBanner.button === 'Edit here' && e.coveBanner === null
      && e.cellarMs !== null && e.cellarActive && e.leavesAfter === 1 && e.cellarBannerAfter === null && e.coveBannerAfter && e.coveBannerAfter.text === 'View only. Atlas holds Probe Cellar.' && e.atlasHidden;
    await o.shot(path.join(OUT, 'step4-view-only.png'));
    return { pass, evidence: e };
  });

  await step(o, 5, 'an edit on the held board saves through Atlas; on the other board it is refused and no file is written', async () => {
    const e = await o.ev(`const L = window.__L;
      const cellar = L.boardOf(L.CELLAR), cove = L.boardOf(L.COVE);
      const writer = cellar.view.services.writer;
      const tokens = L.store().getState().objects.tokens; const id = Object.keys(tokens)[0]; const from = { x: tokens[id].x, y: tokens[id].y };
      const m0 = await L.mtime(L.CELLAR);
      // Since Phase 2 a write says nothing of where it went: Atlas's store is the only place it can go.
      await writer.move(L.CELLAR, id, from.x + 70, from.y);
      const savedMs = await L.until(async () => (await L.mtime(L.CELLAR)) !== m0, 5000);
      const fileX = (await L.file(L.CELLAR)).state.objects.tokens[id].x;
      await writer.move(L.CELLAR, id, from.x, from.y);
      const coveFile = await L.file(L.COVE); const coveId = Object.keys(coveFile.state.objects.tokens)[0];
      const c0 = await L.mtime(L.COVE);
      let refused = null;
      try { await writer.move(L.COVE, coveId, 10, 10); refused = 'not refused'; } catch (error) { refused = { name: error.name, message: error.message }; }
      await L.sleep(1500);
      return { savedMs, moved: fileX === from.x + 70, refused, coveUntouched: (await L.mtime(L.COVE)) === c0 };`);
    return { pass: e.savedMs !== null && e.savedMs <= 2500 && e.moved && e.refused && e.refused.name === 'NotHeldError' && e.coveUntouched, evidence: e };
  });

  await step(o, 6, 'a board in a popout: the Atlas tab stays in the main window, the popout board stays active', async () => {
    const e = await o.ev(`const L = window.__L; const ws = app.workspace;
      const cove = L.boardOf(L.COVE);
      const before = L.notices.length;
      const popped = ws.moveLeafToPopout(cove);
      await L.sleep(2500);
      const board = L.boardOf(L.COVE) || popped;
      await L.focus(board);
      const ms = await L.until(() => L.held(L.COVE));
      await L.sleep(1000);
      const atlas = L.atlasLeaves();
      const out = { ms, leaves: atlas.length, atlasInMain: atlas[0] ? atlas[0].getRoot() === ws.rootSplit : null, boardInPopout: board.getRoot() !== ws.rootSplit, boardActive: L.active() === board,
        notices: L.notices.slice(before), banner: L.banner(board) };
      board.detach(); await L.sleep(800);
      return out;`);
    return { pass: e.ms !== null && e.leaves === 1 && e.atlasInMain === true && e.boardInPopout && e.boardActive && e.banner === null && !e.notices.some((n) => /main window/i.test(n)), evidence: e };
  });

  await step(o, 7, 'the user closes the Atlas tab: editing is paused, Reopen holds the map again', async () => {
    const e = await o.ev(`const L = window.__L;
      const cellar = L.boardOf(L.CELLAR);
      await L.focus(cellar); await L.until(() => L.held(L.CELLAR));
      L.atlasLeaves()[0].detach(); await L.sleep(1200);
      const closed = { leaves: L.atlasLeaves().length, banner: L.banner(cellar) };
      L.clickBanner(cellar);
      const ms = await L.until(() => L.held(L.CELLAR));
      await L.sleep(800);
      return { closed, ms, leaves: L.atlasLeaves().length, banner: L.banner(cellar), boardActive: L.active() === cellar };`);
    return { pass: e.closed.leaves === 0 && e.closed.banner && e.closed.banner.text === 'Atlas closed this map. Editing is paused.' && e.closed.banner.button === 'Reopen' && e.ms !== null && e.leaves === 1 && e.banner === null && e.boardActive, evidence: e };
  });

  await step(o, 8, 'the host Tabletop opened closes with the last board; one the user opened stays', async () => {
    const e = await o.ev(`const L = window.__L; const ws = app.workspace;
      await L.closeAll('atlas-tabletop-board'); await L.sleep(1000);
      const afterBoards = L.atlasLeaves().length;
      const leaf = ws.getLeaf('tab');
      await leaf.openFile(app.vault.getAbstractFileByPath(L.UPPER), { active: true });
      await L.until(() => L.held(L.UPPER));
      const board = await L.openBoard(L.CELLAR);
      await L.until(() => L.held(L.CELLAR));
      board.detach(); await L.sleep(1200);
      return { afterBoards, userLeaves: L.atlasLeaves().length, tabs: L.atlasLeaves()[0] ? L.atlasLeaves()[0].view.tabMetaStore.getState().tabs.map((t) => t.displayName) : [] };`);
    return { pass: e.afterBoards === 0 && e.userLeaves === 1, evidence: e };
  });

  await step(o, 9, 'distances: Manhattan and a custom unit name, read from the collection', async () => {
    const e = await o.ev(`const L = window.__L;
      const board = await L.openBoard(L.CELLAR); await L.focus(board); await L.until(() => L.held(L.CELLAR));
      const svc = L.atlasLeaves()[0].view.serviceManager.getAssetService();
      const id = svc.getCollectionForMap(L.CELLAR);
      const before = structuredClone(svc.getCollectionSettings(id).gridDefaults ?? null);
      await svc.updateCollectionSettings(id, { gridDefaults: { ...(before ?? {}), measurementMode: 'metric', diagonalRule: 'manhattan', unitType: 'custom', unitName: 'mi', unitDistance: 1 } });
      // No reload is asked for: the board hears Atlas's change of the collection.
      await L.sleep(2500);
      const view = board.view; const size = view.map.grid.size, ox = view.map.grid.offsetX, oy = view.map.grid.offsetY;
      const at = (cx, cy) => ({ x: ox + size / 2 + size * cx, y: oy + size / 2 + size * cy });
      const label = view.board.distanceLabel([at(0, 0), at(3, 3), at(5, 3)]);
      const measurement = view.board.host.measurement();
      await svc.updateCollectionSettings(id, { gridDefaults: before ?? undefined });
      await L.sleep(1500);
      return { label, rule: measurement.diagonalRule, unitName: measurement.unitName, restored: JSON.stringify(svc.getCollectionSettings(id).gridDefaults ?? null) === JSON.stringify(before), gridType: view.map.grid.type };`);
    return { pass: e.label === '8 mi' && e.rule === 'manhattan' && e.unitName === 'mi' && e.restored, evidence: e };
  });

  await step(o, 10, "rooms: Atlas 0.15 converts them, the old wall settings move with a backup onto Atlas's own walls, no doubled outline", async () => {
    const e = await o.ev(`const L = window.__L; const MAP = ARG.map;
      const before = L.notices.length;
      const board = await L.openBoard(MAP); await L.focus(board);
      const ms = await L.until(() => L.held(MAP), 20000);
      await L.sleep(2500);
      const state = L.store().getState();
      const ids = Object.keys(state.objects.tokens);
      if (ids.length) { const t = state.objects.tokens[ids[0]]; state.updateToken(ids[0], { x: t.x + 1 }); await L.sleep(300); L.store().getState().updateToken(ids[0], { x: t.x }); }
      else L.store().getState().addWall({ type: 'solid', p1: { x: 10, y: 10 }, p2: { x: 20, y: 10 } });
      await L.sleep(3000);
      const file = await L.file(MAP);
      const walls = Object.values(file.state.objects.walls || {});
      const roomWalls = walls.filter((w) => String(w.id).startsWith('room_'));
      const data = L.tt().boardData.toJSON()[MAP] || {};
      // Since Phase 4A the settings ride on Atlas's own walls (their tabletop field); Tabletop's data keeps none.
      const onWalls = (key) => Object.fromEntries(walls.filter((w) => w.tabletop && w.tabletop[key] !== undefined).map((w) => [w.id, w.tabletop[key]]));
      const left = ['wallMaterials', 'doorProps', 'wallHeights', 'wallWidths', 'lightHeights', 'windows', 'doorFlips'].filter((key) => data[key] !== undefined);
      const day = new Date(); const two = (n) => String(n).padStart(2, '0'); const folder = 'Tabletop backups/' + day.getFullYear() + '-' + two(day.getMonth() + 1) + '-' + two(day.getDate());
      const backups = (await app.vault.adapter.exists(folder)) ? (await app.vault.adapter.list(folder)).files : [];
      const mapBackup = backups.find((f) => /Fusion Rooms(-\\d+)?\\.atlasmap$/.test(f));
      const backupHasRooms = mapBackup ? !!JSON.parse(await app.vault.adapter.read(mapBackup)).state.objects.rooms : null;
      const drawn = board.view.map.walls.map((w) => w.id);
      return { ms, fileHasRooms: file.state.objects.rooms !== undefined, roomWalls: roomWalls.length, chains: [...new Set(roomWalls.map((w) => w.chainId))], sampleIds: roomWalls.slice(0, 3).map((w) => w.id),
        heights: onWalls('height'), materials: onWalls('material'), left, extrasMoved: data.extrasMoved === true, moved: data.roomWallsMoved === true, backups, backupHasRooms,
        notices: L.notices.slice(before), drawn: drawn.length, unique: new Set(drawn).size, storeWalls: Object.keys(L.store().getState().objects.walls || {}).length };`, fixtures);
    const heightKeys = Object.keys(e.heights), materialKeys = Object.keys(e.materials);
    const pass = e.ms !== null && !e.fileHasRooms && e.roomWalls > 0 && e.chains.join() === 'rooms_' && e.moved
      && heightKeys.length === 1 && heightKeys[0].startsWith('room__') && e.heights[heightKeys[0]] === 3 && materialKeys.length === 1 && materialKeys[0].startsWith('room__') && e.materials[materialKeys[0]] === 'Materials/stone'
      && e.backups.some((f) => /Fusion Rooms(-\d+)?\.atlasmap$/.test(f)) && e.backups.some((f) => /Fusion Rooms(-\d+)?\.tabletop\.json$/.test(f)) && e.backupHasRooms === true
      && e.left.length === 0 && e.extrasMoved
      && e.notices.some((n) => /moved 2 wall settings to Atlas 0\.15's room walls on Fusion Rooms; backup in Tabletop backups\//.test(n))
      && e.notices.some((n) => /moved 2 wall, door and light settings onto Atlas's own records on Fusion Rooms; backup in Tabletop backups\//.test(n)) && e.drawn === e.unique && e.drawn === e.storeWalls;
    await o.shot(path.join(OUT, 'step10-rooms.png'));
    return { pass, evidence: e };
  });

  await step(o, 11, "the light level is Atlas's scene lighting: store and file, nothing in Tabletop's data", async () => {
    const e = await o.ev(`const L = window.__L;
      const board = L.boardOf(L.CELLAR) || await L.openBoard(L.CELLAR); await L.focus(board); await L.until(() => L.held(L.CELLAR));
      const before = structuredClone(L.store().getState().lighting);
      L.store().getState().setSceneLighting({ enabled: true }); await L.sleep(800);
      board.view.board.host.setAmbient(0.42);
      await L.sleep(2500);
      const out = { store: L.store().getState().lighting, file: (await L.file(L.CELLAR)).state.lighting, data: L.tt().boardData.toJSON()[L.CELLAR] || {}, shown: board.view.board.host.ambient(), lightingOn: board.view.board.host.lightingOn() };
      L.store().getState().setSceneLighting({ enabled: before.enabled === true, ambient: before.ambient }); await L.sleep(1500);
      return out;`);
    return { pass: e.store.ambient === 0.42 && e.file.ambient === 0.42 && !('ambient' in e.data) && !('tint' in e.data) && e.shown === 0.42 && e.lightingOn === true, evidence: e };
  });

  await step(o, 12, "the laser and the dice volume are Atlas's settings", async () => {
    const e = await o.ev(`const L = window.__L;
      const board = L.boardOf(L.CELLAR); const svc = app.plugins.plugins['atlas-vtt'].settingsService;
      const laser = svc.getLaserPointerSettings(); const volume = svc.getDiceVolume();
      board.view.services.setLaser({ color: '#00a9ff' }); await L.sleep(300);
      const set = { atlas: svc.getLaserPointerSettings().color, board: board.view.services.laser().color };
      const engine = board.view.sounds ? board.view.sounds() : null;
      const live = board.view.sound && board.view.sound.engine;
      svc.setDiceVolume(0.3); await L.sleep(1200);
      const gain = live ? live.groupGains.get('dice').gain.value : null;
      const minis = live ? live.groupGains.get('minis').gain.value : null;
      svc.setLaserPointerSettings(laser); svc.setDiceVolume(volume); await L.sleep(1000);
      return { set, gain, minis, hasEngine: !!live, restored: { laser: svc.getLaserPointerSettings().color === laser.color, volume: svc.getDiceVolume() === volume }, saved: 'laser' in (L.tt().settings || {}) };`);
    return { pass: e.set.atlas === '#00a9ff' && e.set.board === '#00a9ff' && e.hasEngine && Math.abs(e.gain - 0.3) < 0.03 && Math.abs(e.minis - 1) < 0.03 && e.restored.laser && e.restored.volume, evidence: e };
  });

  await step(o, 13, "scene tabs in Atlas 0.15's markup", async () => {
    const e = await o.ev(`const L = window.__L;
      const board = L.boardOf(L.CELLAR); await L.focus(board); await L.until(() => L.held(L.CELLAR)); await L.sleep(1000);
      const presented = app.plugins.plugins['atlas-vtt'].presentedScene;
      const view = L.atlasLeaves()[0].view; const tab = view.tabMetaStore.getState().tabs.find((t) => t.filePath === L.CELLAR);
      const was = presented.get();
      if (presented.set && tab) presented.set({ tabId: tab.id, filePath: tab.filePath }); await L.sleep(800);
      const tabs = [...board.view.contentEl.querySelectorAll('.atlas-tabletop-scene-tabs .atlas-scene-tab[role="tab"]')].map((el) => ({
        name: el.querySelector('.atlas-scene-tab__label > .atlas-scene-tab__name') ? el.querySelector('.atlas-scene-tab__name').textContent : null,
        start: el.querySelectorAll(':scope > .atlas-scene-tab__action--start').length, end: el.querySelectorAll(':scope > .atlas-scene-tab__action--end').length,
        presented: el.classList.contains('atlas-scene-tab--presented') }));
      if (presented.set) presented.set(was); await L.sleep(300);
      return { tabs };`);
    await o.shot(path.join(OUT, 'step13-scene-tabs.png'));
    return { pass: e.tabs.length > 0 && e.tabs.every((t) => t.name && t.start === 1 && t.end === 1) && e.tabs.filter((t) => t.presented).length === 1, evidence: e };
  });

  await step(o, 14, 'a pin the GM named shows its name on the board', async () => {
    const e = await o.ev(`const L = window.__L;
      const board = L.boardOf(L.CELLAR);
      const pins = board.view.map.pins.map((p) => ({ id: p.id, name: p.name ?? null, showName: p.showName ?? null, title: p.title ?? null }));
      const filePins = Object.values((await L.file(L.CELLAR)).state.objects.pins || {}).map((p) => ({ showName: p.showName ?? null, name: p.name ?? null, notePath: p.notePath ?? null }));
      return { pins, filePins };`);
    await o.shot(path.join(OUT, 'step14-pin-name.png'));
    const named = e.filePins.filter((p) => p.showName === true).length;
    return { pass: named > 0 && e.pins.filter((p) => p.showName === true).length === named, evidence: e };
  });

  allLogs.push(...o.logs);
  await step(o, 15, 'Atlas 0.14: both plugins say they need 0.15, publish nothing, and the board tab says why', async () => {
    await o.ev(`const L = window.__L; if (!L.boardOf(L.CELLAR)) await L.openBoard(L.CELLAR); return true;`);
    await sleep(1500);
    kill(); await sleep(2500);
    install('0.14.0');
    launch();
    let old;
    try {
      const p = await open(0);
      await sleep(12000);
      old = await p.ev(`const L = window.__L; const tt = L.tt();
        const board = L.boards()[0];
        if (board && board.loadIfDeferred) await board.loadIfDeferred();
        await L.sleep(1500);
        const box = board && board.view && board.view.contentEl ? board.view.contentEl.querySelector('.atlas-tabletop-no-atlas') : null;
        return { atlas: app.plugins.manifests['atlas-vtt'].version, api: tt ? tt.api : 'no plugin', notices: L.notices.slice(), boardText: box ? box.innerText : null,
          connectBound: !!(L.connect() && L.connect().link && L.connect().link.connected) };`);
      allLogs.push(...p.logs.map((l) => ({ ...l, during: 'atlas 0.14' })));
    } finally {
      kill(); await sleep(2500);
      install(BUILD);
      launch();
    }
    o = await open();
    const back = await o.ev(`return { atlas: app.plugins.manifests['atlas-vtt'].version, api: !!window.__L.tt().api };`);
    const tabletop = old.notices.filter((n) => n === 'Tabletop needs Atlas VTT 0.15 or later (found 0.14.0)').length;
    const connect = old.notices.filter((n) => n === 'Connect needs Atlas VTT 0.15 or later (found 0.14.0)').length;
    return { pass: old.atlas === '0.14.0' && old.api === null && tabletop === 1 && connect === 1 && /Tabletop needs Atlas VTT 0\.15 or later \(found 0\.14\.0\)/.test(old.boardText || '') && back.atlas === BUILD && back.api, evidence: { old, back, tabletop, connect } };
  });

  await step(o, 16, "no console error from Tabletop or Connect across the run", async () => {
    await sleep(3000);
    allLogs.push(...o.logs);
    const errors = allLogs.filter((l) => (l.type === 'error' || l.type === 'pageerror') && /tabletop-for-atlas|atlas-vtt-connect|Tabletop|Connect for Atlas/i.test(`${l.text} ${l.at}`) && l.during !== 'atlas 0.14');
    fs.writeFileSync(path.join(OUT, 'console.json'), JSON.stringify(allLogs, null, 2));
    return { pass: errors.length === 0, evidence: { errors: errors.slice(0, 8), total: allLogs.length } };
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} steps passed`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
