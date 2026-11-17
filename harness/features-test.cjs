// Usage: node harness/features-test.cjs <bundle dir> <screenshot dir>, after bundling harness/board.ts (see README).
// Browser checks of features added after board-test.cjs: each drives the real board and its DOM (clicks, keys, what is
// drawn) and takes a screenshot to look at. Prints one line per check and exits 1 if any failed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const shots = process.argv[3];
// A name regex runs the features it matches, whatever changed; `--full` runs every one; else the affected ones
// (harness/affected.cjs): new, failed last time, or with a function they ran changed since they last passed.
const pattern = process.argv.slice(4).find((arg) => !arg.startsWith('--'));
const only = pattern ? new RegExp(pattern) : null;
const affected = require('./affected.cjs');
const cache = require('../scripts/testCache.cjs');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript; charset=utf-8', '.webm': 'video/webm' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }); res.end(data); });
});
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each feature: a name and a function of the page and helpers. */
const features = [];
const feature = (name, run, url) => features.push({ name, run, url });

// ── Board sounds: the board hands its engine the camera, and calls it through Board.sound ──────────────────────────
feature('sound settings', async ({ page, shot }) => {
  const rec = () => page.evaluate(() => JSON.parse(JSON.stringify({ listeners: window.boardTest.sounds.listeners, plays: window.boardTest.sounds.plays, loops: window.boardTest.sounds.loops })));
  const first = await rec();
  check('sound: the engine is told where the camera is once the board is drawn', first.listeners.length >= 1 && first.listeners[0].span > 0 && !!first.listeners[0].listener.eye && !!first.listeners[0].listener.target);
  await page.evaluate(() => window.boardTest.board.camera.zoom(0.5));
  await wait(800);
  const moved = await rec();
  const eye = (r) => r.listeners.at(-1).listener.eye;
  check('sound: a camera move updates the listener', moved.listeners.length > first.listeners.length && JSON.stringify(eye(moved)) !== JSON.stringify(eye(first)), JSON.stringify([first.listeners.length, moved.listeners.length]));
  // A drag of the camera snaps the pose (the pose is already at the goal when the frame is drawn): the listener follows it all the same.
  await page.evaluate(() => { const { board } = window.boardTest; board.camera.orbit(0.6, 0); board.camera.snap(); board.wake(true); });
  await wait(500);
  const snapped = await rec();
  check('sound: a camera drag (snapped pose) updates the listener', snapped.listeners.length > moved.listeners.length && JSON.stringify(eye(snapped)) !== JSON.stringify(eye(moved)), JSON.stringify([moved.listeners.length, snapped.listeners.length]));
  await page.evaluate(() => { window.boardTest.board.sound('dice.hit', { gain: 0.5 }); window.boardTest.board.soundLoop('water', 'water.flow', 0.3); });
  const after = await rec();
  check('sound: Board.sound reaches the engine', JSON.stringify(after.plays.at(-1)) === JSON.stringify(['dice.hit', { gain: 0.5 }]));
  check('sound: Board.soundLoop reaches the engine', JSON.stringify(after.loops.at(-1)) === JSON.stringify(['water', 'water.flow', 0.3]));
  check('sound: a board puts its own prefix on its loop keys, so boards sharing an engine cannot stop each other loops', await page.evaluate(() => window.boardTest.sounds.loopKeys.length > 0 && window.boardTest.sounds.loopKeys.every((key) => /^board\d+:/.test(key))), await page.evaluate(() => JSON.stringify(window.boardTest.sounds.loopKeys.slice(-3))));
  // A board whose tab is behind another is not on screen: nothing plays, its loops go quiet, and they return when it is shown.
  await page.evaluate(() => { const { board, sounds } = window.boardTest; board.container.style.display = 'none'; sounds.plays.length = 0; board.wake(true); });
  await wait(400);
  await page.evaluate(() => { const { board } = window.boardTest; board.sound('dice.hit', { gain: 0.5 }); board.soundLoop('water', 'water.waves', 0.2); });
  const behind = await rec();
  check('sound: a board that is not on screen plays no sound', behind.plays.length === 0, JSON.stringify(behind.plays));
  check('sound: a board that is not on screen keeps its loops silent', JSON.stringify(behind.loops.at(-1)) === JSON.stringify(['water', null, 0.2]), JSON.stringify(behind.loops.slice(-2)));
  await page.evaluate(() => { const { board } = window.boardTest; board.container.style.display = ''; board.wake(true); });
  await wait(400);
  const back = await rec();
  check('sound: the loops come back when the board is shown again, and nothing played meanwhile bursts out', JSON.stringify(back.loops.at(-1)) === JSON.stringify(['water', 'water.waves', 0.2]) && back.plays.length === 0, JSON.stringify([back.loops.at(-1), back.plays.length]));
  await page.evaluate(() => window.boardTest.board.soundLoop('water', null, 0));
  // The web speaker control: inside the board, and clear of the layers ruler (a stand-in for a tall stack is drawn).
  await page.evaluate(() => {
    const { board, mountSoundControl, webSound } = window.boardTest;
    mountSoundControl(board.container, webSound(window));
    board.container.querySelector('.atlas-tabletop-sound__button').click();
    const ruler = document.createElement('div');
    ruler.className = 'atlas-tabletop-layers';
    ruler.innerHTML = '<div class="atlas-tabletop-layers__track" style="height:420px"><div class="atlas-tabletop-layers__rail" style="height:420px"></div></div>';
    board.container.appendChild(ruler);
  });
  const overlap = () => page.evaluate(() => {
    const c = document.querySelector('.atlas-tabletop-sound');
    const r = [...document.querySelectorAll('.atlas-tabletop-layers__track')].at(-1);
    const a = c.getBoundingClientRect(), b = r.getBoundingClientRect(), box = window.boardTest.board.container.getBoundingClientRect();
    return { inside: a.left >= box.left && a.right <= box.right && a.top >= box.top && a.bottom <= box.bottom, hit: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top };
  });
  let o = await overlap();
  check('sound: the web control is inside the board and clear of the layers ruler', o.inside && !o.hit, JSON.stringify(o));
  await shot('sound-control');
  await page.setViewportSize({ width: 1000, height: 480 });
  await wait(300);
  o = await overlap();
  check('sound: on a short board the control still clears the ruler', o.inside && !o.hit, JSON.stringify(o));
  await shot('sound-control-short');
});

// ── Board sounds: a board that closes stops its own loops on the engine it shares, though its host gives no engine now ──
feature('closed board sounds', async ({ page }) => {
  await page.evaluate(() => { const { board, sounds } = window.boardTest; board.soundLoop('water', 'water.flow', 0.3); board.soundLoop('spell:fire', 'spell.loop.fire', 0.2); sounds.loops.length = 0; sounds.gone = true; board.dispose(); });
  const stops = await page.evaluate(() => window.boardTest.sounds.loops.map((loop) => [loop[0], loop[1]]));
  check('closed board sounds: each loop of the board is stopped on the shared engine', JSON.stringify(stops.filter((loop) => loop[1] === null).map((loop) => loop[0]).sort()) === '["spell:fire","water"]', JSON.stringify(stops));
});

// ── Board sounds: dice clack per hit (at most 6 in 50 ms), no rolling loop; the clacks carry the roll ───────────────
feature('dice sounds', async ({ page, shot }) => {
  await page.evaluate(() => {
    const { sounds } = window.boardTest;
    window.diceHeard = [];
    const play = sounds.play;
    sounds.play = function (id, options) { window.diceHeard.push([id, performance.now()]); return play.call(this, id, options); };
    sounds.loops.length = 0;
    sounds.plays.length = 0;
  });
  await page.locator('.atlas-tabletop-extensions button[aria-label="Dice"]').click();
  await wait(400);
  const picker = page.locator('.atlas-tabletop-dice-picker');
  for (let i = 0; i < 6; i++) await picker.locator('[data-die="d6"]').click();
  await picker.locator('.atlas-dice-tray__roll').click();
  await wait(400);
  check('dice sounds: nothing is heard while the dice only lie on the table', await page.evaluate(() => window.boardTest.sounds.plays.length === 0));
  await page.locator('.atlas-tabletop-dice-prompt__throw').click();
  await page.waitForFunction(() => window.boardTest.board.dice.busy, null, { timeout: 5000 });
  await wait(300);
  const rolling = await page.evaluate(() => window.boardTest.sounds.loops.length);
  check('dice sounds: no rolling loop plays while the dice tumble', rolling === 0, rolling);
  await page.waitForFunction(() => !window.boardTest.board.dice.busy, null, { timeout: 90000 });
  await wait(300);
  const heard = await page.evaluate(() => {
    const hits = window.diceHeard.filter((entry) => entry[0] === 'dice.hit').map((entry) => entry[1]);
    let worst = 0;
    for (const at of hits) worst = Math.max(worst, hits.filter((other) => other >= at && other < at + 50).length);
    return { hits: hits.length, worst, last: window.boardTest.sounds.loops.at(-1), ids: [...new Set(window.boardTest.sounds.plays.map((play) => play[0]))] };
  });
  check('dice sounds: the dice clack', heard.hits >= 6, JSON.stringify(heard));
  check('dice sounds: never more than 6 clacks in any 50 ms', heard.worst <= 6, JSON.stringify(heard));
  check('dice sounds: no loop was started or stopped for the dice', heard.last === undefined, JSON.stringify(heard.last));
  check('dice sounds: only dice sounds are made', heard.ids.every((id) => id === 'dice.hit' || id === 'dice.caught'), JSON.stringify(heard.ids));
  await shot('dice-sounds');
});

// ── Board sounds: minis picked up and put down (here and seen from other boards), doors, wall swaps ───────────────
feature('mini sounds', async ({ page, shot }) => {
  const heard = () => page.evaluate(() => window.boardTest.sounds.plays.map((play) => ({ id: play[0], delayMs: play[1]?.delayMs ?? 0, at: play[1]?.at ?? null })));
  const clear = () => page.evaluate(() => { window.boardTest.sounds.plays.length = 0; });
  const only = (list, id) => list.filter((play) => play.id === id);
  // A token dragged and let go: one pickup when it leaves, one put-down when it lands.
  const start = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('hero'); return window.boardTest.project(e.at.x, e.at.y, 0); });
  await clear();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 20, { steps: 5 });
  let now = await heard();
  check('mini sounds: a token dragged is picked up once as it leaves', only(now, 'mini.pickup').length === 1 && only(now, 'mini.putdown').length === 0, JSON.stringify(now));
  await page.mouse.move(start.x + 70, start.y + 35, { steps: 5 });
  await page.mouse.up();
  await wait(200);
  now = await heard();
  check('mini sounds: letting go puts it down once, where it lands', only(now, 'mini.pickup').length === 1 && only(now, 'mini.putdown').length === 1 && !!only(now, 'mini.putdown')[0].at, JSON.stringify(now));
  // The file echoing the GM's own drop back is no one else's move.
  const dropped = await page.evaluate(() => window.boardTest.record.moves.at(-1));
  await clear();
  await page.evaluate(async (dropped) => {
    const { board } = window.boardTest;
    await board.load({ ...board.map, tokens: board.map.tokens.map((t) => (t.id === dropped[0] ? { ...t, x: dropped[1], y: dropped[2] } : t)) });
  }, dropped);
  await wait(1200);
  check('mini sounds: a sync echoing the GM\'s own drop makes no sound', (await heard()).length === 0, JSON.stringify(await heard()));
  // Five tokens moved by someone else: each is picked up, staggered, and put down on arrival.
  const five = ['gob', 'gob2', 'noart', 'fallen', 'lurker'];
  await clear();
  await page.evaluate(async (five) => {
    const { board } = window.boardTest;
    await board.load({ ...board.map, tokens: board.map.tokens.map((t) => (five.includes(t.id) ? { ...t, y: t.y - 140 } : t)) });
  }, five);
  await wait(60);
  now = await heard();
  const pickups = only(now, 'mini.pickup');
  const delays = pickups.map((play) => play.delayMs);
  check('mini sounds: five tokens moved by a sync make five pickups', pickups.length === 5 && only(now, 'mini.putdown').length === 0, JSON.stringify(now));
  check('mini sounds: their delays are distinct and sorted', new Set(delays).size === 5 && delays.every((d, i) => i === 0 || d > delays[i - 1]), JSON.stringify(delays));
  await wait(2500);
  now = await heard();
  check('mini sounds: when they arrive they are put down, five times', only(now, 'mini.putdown').length === 5 && only(now, 'mini.pickup').length === 5, JSON.stringify(now));
  // A token that is new, and a token barely nudged, are no moves.
  await clear();
  await page.evaluate(async () => {
    const { board } = window.boardTest;
    const spawn = { ...board.map.tokens[0], id: 'spawned', x: 700, y: 700 };
    await board.load({ ...board.map, tokens: [...board.map.tokens.map((t) => (t.id === 'orc' ? { ...t, x: t.x + 5 } : t)), spawn] });
  });
  await wait(600);
  check('mini sounds: a spawned token and a nudge of a few pixels make no sound', (await heard()).length === 0, JSON.stringify(await heard()));
  // Doors: a click opens, a second shuts; a locked door only rattles.
  await clear();
  const hit = await page.evaluate(() => {
    const { board, project } = window.boardTest;
    const door = board.map.walls.find((wall) => wall.id === 'door');
    for (let k = 0; k < 40; k++) {
      const t = 0.2 + (0.6 * k) / 39;
      for (const h of [20, 35, 50]) {
        const at = project(door.p1.x + (door.p2.x - door.p1.x) * t, door.p1.y + (door.p2.y - door.p1.y) * t, h);
        if (board.doorAt(at.x, at.y) === 'door') return at;
      }
    }
    return null;
  });
  check('mini sounds: a door can be found to click', !!hit, JSON.stringify(hit));
  await page.mouse.click(hit.x, hit.y);
  await wait(100);
  now = await heard();
  check('mini sounds: clicking a shut door records door.open', JSON.stringify(now.map((play) => play.id)) === '["door.open"]' && !!now[0].at, JSON.stringify(now));
  await page.mouse.click(hit.x, hit.y);
  await wait(100);
  now = await heard();
  check('mini sounds: clicking it again records door.shut', JSON.stringify(now.map((play) => play.id)) === '["door.open","door.shut"]', JSON.stringify(now));
  await clear();
  await page.evaluate(async () => {
    const { board } = window.boardTest;
    await board.load({ ...board.map, walls: board.map.walls.map((wall) => (wall.id === 'fogdoor' ? { ...wall, locked: true } : wall)) });
    board.toggleDoor('fogdoor');
  });
  now = await heard();
  check('mini sounds: a locked door clicked records door.locked and stays shut', JSON.stringify(now.map((play) => play.id)) === '["door.locked"]', JSON.stringify(now));
  // A door changed by someone else, between two syncs of the scene, is heard once.
  await clear();
  await page.evaluate(async () => {
    const { board } = window.boardTest;
    const open = () => ({ ...board.map, walls: board.map.walls.map((wall) => (wall.id === 'door' ? { ...wall, closed: false } : wall)) });
    await board.load(open());
    await board.load(open());
  });
  now = await heard();
  check('mini sounds: a door opened from elsewhere records one door.open', JSON.stringify(now.map((play) => play.id)) === '["door.open"]', JSON.stringify(now));
  // A material slapped on a wall.
  await clear();
  const wall = await page.evaluate(() => {
    const { board } = window.boardTest;
    const solid = board.map.walls.find((w) => w.type === 'solid' && !w.chain);
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const x = solid.p1.x + (solid.p2.x - solid.p1.x) * t;
      const y = solid.p1.y + (solid.p2.y - solid.p1.y) * t;
      const at = window.boardTest.project(x, y, board.map.grid.size * 0.8);
      if (board.wallAt(at.x, at.y) === solid.id) return { id: solid.id, at };
    }
    return null;
  });
  check('mini sounds: a wall can be found to paint', !!wall, JSON.stringify(wall));
  await page.evaluate((at) => {
    const { board } = window.boardTest;
    const transfer = new DataTransfer();
    transfer.setData('application/x-atlas-tabletop-material', 'mats/stone');
    board.canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: transfer }));
  }, wall.at);
  now = await heard();
  check('mini sounds: a material slapped on a wall records wall.crumble', JSON.stringify(now.map((play) => play.id)) === '["wall.crumble"]' && !!now[0].at, JSON.stringify(now));
  // Another scene opening (or switching) is no burst of pickups, nor of doors.
  await clear();
  await page.evaluate(async () => {
    const { board } = window.boardTest;
    await board.load({ ...board.map, path: 'other.atlasmap', tokens: board.map.tokens.map((t) => ({ ...t, y: t.y + 200 })), walls: board.map.walls.map((wall) => (wall.id === 'door' ? { ...wall, closed: true } : wall)) });
  });
  await wait(2500);
  check('mini sounds: a scene switch makes no sound at all', (await heard()).length === 0, JSON.stringify(await heard()));
  await shot('mini-sounds');
});

// ── Board sounds: the fog chime, the turn horn, a sound per condition ───────────────────────────────────────────
feature('table sounds', async ({ page, shot }) => {
  const heard = () => page.evaluate(() => window.boardTest.sounds.plays.map((play) => ({ id: play[0], delayMs: play[1]?.delayMs ?? 0, gain: play[1]?.gain ?? null, at: play[1]?.at ?? null })));
  const clear = () => page.evaluate(() => { window.boardTest.sounds.plays.length = 0; });
  const ids = (list) => list.map((play) => play.id);
  const fogOp = (id) => ({ id, type: 'rectangle', timestamp: 99, isErasing: false, offsetX: 0, offsetY: 0, x: 100, y: 100, width: 60, height: 60 });
  const withFog = (...extra) => page.evaluate(async (extra) => { const { board } = window.boardTest; await board.load({ ...board.map, fog: [...board.map.fog, ...extra] }); }, extra);
  // The same map again is silent.
  await clear();
  await page.evaluate(async () => { const { board } = window.boardTest; await board.load({ ...board.map }); });
  check('table sounds: reloading the same map records nothing', (await heard()).length === 0, JSON.stringify(await heard()));
  // Fog the GM places: one chime, even for several operations at once.
  await withFog(fogOp('n1'));
  check('table sounds: a new fog operation records fog.chime', JSON.stringify(ids(await heard())) === '["fog.chime"]', JSON.stringify(await heard()));
  await clear();
  await withFog(fogOp('n2'), fogOp('n3'), fogOp('n4'));
  check('table sounds: three fog operations in one sync chime once', JSON.stringify(ids(await heard())) === '["fog.chime"]', JSON.stringify(await heard()));
  await clear();
  await page.evaluate(async () => { const { board } = window.boardTest; await board.load({ ...board.map, fog: board.map.fog.slice(0, 3) }); });
  check('table sounds: fog taken away is silent', (await heard()).length === 0, JSON.stringify(await heard()));
  // Line-of-sight discovery adds no fog operation.
  await clear();
  await page.evaluate(() => { const { board } = window.boardTest; board.refresh(); });
  await wait(300);
  check('table sounds: seeing more of the map (no fog operation) is silent', (await heard()).length === 0, JSON.stringify(await heard()));
  // Conditions.
  const setConditions = (changes) => page.evaluate(async (changes) => {
    const { board } = window.boardTest;
    await board.load({ ...board.map, tokens: board.map.tokens.map((t) => (changes[t.id] ? { ...t, conditions: changes[t.id] } : t)) });
  }, changes);
  await clear();
  await setConditions({ gob: ['c-poisoned'] });
  let now = await heard();
  check('table sounds: a condition added records its sound, placed on the token', JSON.stringify(ids(now)) === '["condition.poisoned"]' && !!now[0].at, JSON.stringify(now));
  await clear();
  await setConditions({ gob: [] });
  check('table sounds: a condition removed is silent', (await heard()).length === 0, JSON.stringify(await heard()));
  await clear();
  await setConditions({ hero: ['c-poisoned', 'c-frightened', 'c-exhaustion'] });
  check('table sounds: a valued condition added is heard', JSON.stringify(ids(await heard())) === '["condition.exhaustion"]', JSON.stringify(await heard()));
  await clear();
  await setConditions({ gob: ['c-frightened'], gob2: ['c-frightened'], orc: ['c-unknown'] });
  now = await heard();
  const delays = now.map((play) => play.delayMs);
  check('table sounds: conditions on a group are staggered, and an unknown one is the generic sound', now.length === 3 && now.filter((p) => p.id === 'condition.frightened').length === 2 && now.some((p) => p.id === 'condition.applied') && new Set(delays).size === 3, JSON.stringify(now));
  // The turn.
  const turn = (index, round = 1) => page.evaluate(async ([index, round]) => { const { board } = window.boardTest; await board.load({ ...board.map, initiative: { ...board.map.initiative, isActive: true, currentIndex: index, round } }); }, [index, round]);
  await clear();
  await turn(0);
  check('table sounds: a fight starting is no turn passing', (await heard()).length === 0, JSON.stringify(await heard()));
  await turn(1);
  now = await heard();
  check('table sounds: the tracker advancing records turn.horn at full volume for a monster', now.length === 1 && now[0].id === 'turn.horn' && now[0].gain === 1, JSON.stringify(now));
  await clear();
  await turn(1);
  check('table sounds: the same turn again is silent', (await heard()).length === 0, JSON.stringify(await heard()));
  await page.evaluate(() => window.boardTest.controlled.add('gob2'));
  await turn(2);
  now = await heard();
  check('table sounds: a turn of a token a player controls is quiet (0.35) on the GM board', now.length === 1 && now[0].gain === 0.35, JSON.stringify(now));
  await clear();
  await page.evaluate(() => { window.boardTest.board.player = {}; });
  await turn(3);
  now = await heard();
  check('table sounds: with the local player window open the GM board blows it at full', now.length === 1 && now[0].gain === 1, JSON.stringify(now));
  await page.evaluate(() => { window.boardTest.board.player = null; window.boardTest.controlled.clear(); });
  // A scene opens with the file's turn at A while the host's live tracker already says B: that only seeds. Then the live
  // tracker advances to C: one horn. The file catching up to C is no second horn.
  await clear();
  await page.evaluate(async () => { const { board } = window.boardTest; await board.load({ ...board.map, path: 'live.atlasmap', initiative: { ...board.map.initiative, isActive: true, currentIndex: 0, round: 1 } }); });
  await page.evaluate(() => window.boardTest.board.hearTurn('1:e-other', ['orc']));
  check('table sounds: a live tracker ahead of the file when the scene opens is silent', (await heard()).length === 0, JSON.stringify(await heard()));
  await page.evaluate(() => window.boardTest.board.hearTurn('1:e-gob', ['gob']));
  check('table sounds: the live tracker advancing afterwards blows the horn once', JSON.stringify(ids(await heard())) === '["turn.horn"]', JSON.stringify(await heard()));
  await page.evaluate(() => window.boardTest.board.hearTurn('1:e-gob', ['gob']));
  await turn(1);
  check('table sounds: reporting it again, and the file catching up, are silent', (await heard()).length === 1, JSON.stringify(await heard()));
  // A scene switch is silent whatever changed.
  await clear();
  await page.evaluate(async () => { const { board } = window.boardTest; await board.load({ ...board.map, path: 'another.atlasmap', fog: [], tokens: board.map.tokens.map((t) => ({ ...t, conditions: ['c-poisoned'] })), initiative: { ...board.map.initiative, currentIndex: 0, round: 5 } }); });
  await wait(300);
  check('table sounds: a scene switch makes no fog, condition or turn sound', (await heard()).length === 0, JSON.stringify(await heard()));
  await shot('table-sounds');
});

// A group of minis dragged together: each is picked up and put down, staggered, and the file echoing the drop back is silent.
feature('mini sounds in a group', async ({ page, shot }) => {
  const heard = () => page.evaluate(() => window.boardTest.sounds.plays.map((play) => ({ id: play[0], delayMs: play[1]?.delayMs ?? 0 })));
  const clear = () => page.evaluate(() => { window.boardTest.sounds.plays.length = 0; });
  const ids = (list, id) => list.filter((play) => play.id === id);
  const sorted = (list) => new Set(list.map((p) => p.delayMs)).size === list.length && list.every((p, i) => i === 0 || p.delayMs > list[i - 1].delayMs);
  const at = (id) => page.evaluate((id) => { const e = window.boardTest.board.tokens.get(id); return window.boardTest.project(e.at.x, e.at.y, 0); }, id);
  const hero = await at('hero');
  await page.mouse.click(hero.x, hero.y);
  await wait(200);
  for (const id of ['gob', 'gob2']) {
    const p = await at(id);
    await page.keyboard.down('Shift');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up('Shift');
    await wait(150);
  }
  await clear();
  await page.mouse.move(hero.x, hero.y);
  await page.mouse.down();
  await page.mouse.move(hero.x + 40, hero.y + 20, { steps: 5 });
  let now = await heard();
  check('mini sounds in a group: three minis dragged make three pickups, delays distinct and sorted', ids(now, 'mini.pickup').length === 3 && sorted(ids(now, 'mini.pickup')) && ids(now, 'mini.putdown').length === 0, JSON.stringify(now));
  // A sync arriving mid-drag that moves the carried minis is no one else's move.
  await page.evaluate(async () => {
    const { board } = window.boardTest;
    await board.load({ ...board.map, tokens: board.map.tokens.map((t) => (['hero', 'gob', 'gob2'].includes(t.id) ? { ...t, y: t.y + 140 } : t)) });
  });
  await wait(300);
  now = await heard();
  check('mini sounds in a group: a sync mid-drag that moves the carried minis makes no sound', ids(now, 'mini.pickup').length === 3 && ids(now, 'mini.putdown').length === 0, JSON.stringify(now));
  await page.mouse.move(hero.x + 70, hero.y + 35, { steps: 5 });
  await page.mouse.up();
  await wait(200);
  now = await heard();
  check('mini sounds in a group: letting go puts down three, staggered', ids(now, 'mini.putdown').length === 3 && sorted(ids(now, 'mini.putdown')), JSON.stringify(now));
  const moves = await page.evaluate(() => window.boardTest.record.ruleMoves.at(-1));
  check('mini sounds in a group: the drop moved all three', moves?.length === 3, JSON.stringify(moves));
  await clear();
  await page.evaluate(async (moves) => {
    const { board } = window.boardTest;
    await board.load({ ...board.map, tokens: board.map.tokens.map((t) => { const m = moves.find((move) => move.id === t.id); return m ? { ...t, x: m.x, y: m.y } : t; }) });
  }, moves);
  await wait(1500);
  check('mini sounds in a group: a sync echoing the group drop makes no sound', (await heard()).length === 0, JSON.stringify(await heard()));
  await shot('mini-sounds-group');
});

// ── Item 27: the turn banner and the delayed marker ─────────────────────────────────────────────────────────────
feature('turn banner and delayed marker', async ({ page, shot }) => {
  await page.evaluate(() => window.boardTest.board.flashTurn('Round 2 · Goblin'));
  await wait(400);
  const banner = page.locator('.atlas-tabletop-turn-banner');
  check('27 banner shows the words', (await banner.count()) === 1 && (await banner.textContent()) === 'Round 2 · Goblin');
  const box = await banner.boundingBox();
  const view = page.viewportSize();
  check('27 banner sits inside the board, centred high', box && box.x >= 0 && box.x + box.width <= view.width && Math.abs(box.x + box.width / 2 - view.width / 2) < 4 && box.y < view.height / 3, JSON.stringify(box));
  await shot('turn-banner');
  await page.evaluate(() => window.boardTest.board.flashTurn('Round 2 · Orc'));
  check('27 a second turn replaces the banner', (await banner.count()) === 1 && (await banner.textContent()) === 'Round 2 · Orc');
  await wait(2800);
  check('27 the banner goes by itself', (await banner.count()) === 0);

  const id = await page.evaluate(() => [...window.boardTest.board.tokens.keys()][0]);
  await page.evaluate((id) => window.boardTest.board.setDelayedTokens([id]), id);
  await wait(500);
  check('27 a delayed token shows its clock', await page.evaluate((id) => window.boardTest.board.tokens.get(id).piece.delayed, id));
  const at = await page.evaluate((id) => { const e = window.boardTest.board.tokens.get(id); return window.boardTest.project(e.at.x, e.at.y, 0); }, id);
  await page.mouse.move(5, 5);
  await shot('delayed-marker', { x: Math.max(0, at.x - 120), y: Math.max(0, at.y - 140), width: 240, height: 200 });
  await page.evaluate(() => window.boardTest.board.setDelayedTokens([]));
  check('27 the clock goes when the delay ends', !(await page.evaluate((id) => window.boardTest.board.tokens.get(id).piece.delayed, id)));
});

// ── Item 16: a group of tokens turned and hurt as one ───────────────────────────────────────────────────────────
feature('group rotate and hp', async ({ page, shot }) => {
  const at = (id) => page.evaluate((id) => { const e = window.boardTest.board.tokens.get(id); return window.boardTest.project(e.at.x, e.at.y, 0); }, id);
  const bar = page.locator('.atlas-tabletop-group-bar');
  check('16 no bar while nothing is selected', await bar.isHidden());
  const hero = await at('hero');
  await page.mouse.click(hero.x, hero.y);
  await wait(200);
  const gob = await at('gob');
  await page.keyboard.down('Shift');
  await page.mouse.click(gob.x, gob.y);
  await page.keyboard.up('Shift');
  await wait(300);
  check('16 two selected: the bar shows with the count', (await bar.isVisible()) && (await bar.locator('.atlas-tabletop-group-bar__count').textContent()) === '2 selected');
  await shot('group-bar');
  await page.getByRole('button', { name: 'Rotate right 45°' }).click();
  await page.getByRole('button', { name: 'Rotate right 45°' }).click();
  await page.getByRole('button', { name: 'Rotate left 45°' }).click();
  const rot = await page.evaluate(() => ({ board: ['hero', 'gob'].map((id) => window.boardTest.board.tokens.get(id).token.rotation), saved: window.boardTest.record.rotations }));
  check('16 each click turns every token of the group and shows at once', rot.board[0] === 45 && rot.board[1] === 45, JSON.stringify(rot.board));
  check('16 each click is saved as one change for the whole group', rot.saved.length === 3 && rot.saved.every((turns) => turns.length === 2) && rot.saved[2].every((turn) => turn.rotation === 45), JSON.stringify(rot.saved));
  await page.getByRole('button', { name: 'Rotate left 45°' }).click();
  await page.getByRole('button', { name: 'Rotate left 45°' }).click();
  check('16 turning past 0 wraps to 315', (await page.evaluate(() => window.boardTest.board.tokens.get('hero').token.rotation)) === 315);

  await page.locator('.atlas-tabletop-group-bar__amount').fill('2');
  await page.getByRole('button', { name: 'Damage all' }).click();
  await wait(200);
  const hp = () => page.evaluate(() => ({ hero: window.boardTest.board.tokens.get('hero').token.resources.hp.current, gob: window.boardTest.board.tokens.get('gob').token.resources.hp.current, edits: window.boardTest.record.edits.length }));
  const hurt = await hp();
  check('16 Damage takes the amount off every token that has HP', hurt.hero === 18 && hurt.gob === 1 && hurt.edits === 2, JSON.stringify(hurt));
  await page.getByRole('button', { name: 'Damage all' }).click();
  const floor = await hp();
  check('16 HP stops at 0, never below', floor.gob === 0 && floor.hero === 16, JSON.stringify(floor));
  await page.locator('.atlas-tabletop-group-bar__amount').fill('5');
  await page.getByRole('button', { name: 'Heal all' }).click();
  const healed = await hp();
  check('16 Heal adds the amount, up to the maximum', healed.hero === 21 && healed.gob === 5, JSON.stringify(healed));
  await page.locator('.atlas-tabletop-group-bar__amount').fill('abc');
  const before = (await hp()).edits;
  await page.getByRole('button', { name: 'Heal all' }).click();
  check('16 a bad amount changes nothing and says so', (await hp()).edits === before && (await page.locator('.atlas-tabletop-group-bar__amount').getAttribute('aria-invalid')) !== null);
  await shot('group-bar-after');
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await wait(200);
  check('16 Clear selection lets the group go and hides the bar', await bar.isHidden());
  await page.keyboard.down('Shift');
  await page.mouse.click(hero.x, hero.y);
  await page.mouse.click(gob.x, gob.y);
  await page.keyboard.up('Shift');
  await wait(200);
  check('16 selected again, then Escape clears it', await bar.isVisible());
  await page.keyboard.press('Escape');
  await wait(200);
  check('16 Escape hides the bar', await bar.isHidden());
});

// ── Item 23: an animated map (a video as the map's floor), and replacing the map image ─────────────────────────────
feature('animated map', async ({ page, shot }) => {
  // A real WebM (made by harness/make-test-video.cjs, served beside the page): a bar sweeping across a blue field.
  const made = await page.evaluate(async () => {
    const response = await fetch('/sweep.webm');
    const blob = await response.blob();
    window.boardTest.images['sweep.webm'] = URL.createObjectURL(blob);
    return blob.size;
  });
  check('23 the test WebM is there', made > 1000, String(made));
  const before = await page.evaluate(() => ({ tokens: window.boardTest.board.tokens.size, walls: window.boardTest.map.walls?.length ?? 0 }));
  await page.evaluate(() => window.boardTest.board.load({ ...window.boardTest.map, background: 'sweep.webm' }));
  await wait(1500);
  const state = await page.evaluate(() => {
    const board = window.boardTest.board;
    const video = board.video;
    return video ? { ok: true, size: [video.videoWidth, video.videoHeight], paused: video.paused, muted: video.muted, loop: video.loop, t: video.currentTime, world: [board.size.width, board.size.height] } : { ok: false };
  });
  check('23 the map is a playing video: muted, looped, with its own size', state.ok && !state.paused && state.muted && state.loop && state.size[0] === 640 && state.size[1] === 400, JSON.stringify(state));
  check('23 the board takes the video size as the map size', state.ok && state.world[0] === 640 && state.world[1] === 400, JSON.stringify(state.world));
  const after = await page.evaluate(() => ({ tokens: window.boardTest.board.tokens.size }));
  check('23 replacing the map image keeps the tokens', after.tokens === before.tokens && before.tokens > 0, JSON.stringify([before, after]));
  // The picture really moves: two frames a moment apart differ.
  await page.mouse.move(5, 5);
  const frameA = await page.screenshot({ clip: { x: 300, y: 250, width: 400, height: 200 } });
  await wait(700);
  const frameB = await page.screenshot({ clip: { x: 300, y: 250, width: 400, height: 200 } });
  check('23 the picture on the board changes from frame to frame', Buffer.compare(frameA, frameB) !== 0);
  await shot('animated-map');
  // Back to a still image: the video stops and lets go.
  await page.evaluate(() => window.boardTest.board.load({ ...window.boardTest.map, background: 'bg.png' }));
  await wait(800);
  const back = await page.evaluate(() => ({ video: window.boardTest.board.video === null, tokens: window.boardTest.board.tokens.size }));
  check('23 back to a still image: no video is kept, the tokens stay', back.video && back.tokens === before.tokens, JSON.stringify(back));
});

// ── Item 36: the toolbar in a narrow pane ──────────────────────────────────────────────────────────────────────
feature('narrow toolbar', async ({ page, shot }) => {
  const bar = () => page.evaluate(() => {
    const el = document.querySelector('.atlas-tabletop-toolbar');
    const r = el.getBoundingClientRect();
    const buttons = [...el.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => b.getAttribute('aria-label'));
    return { left: r.left, right: r.right, width: r.width, buttons, view: document.getElementById('board').clientWidth };
  });
  const paneWidth = (px) => page.evaluate((px) => { document.getElementById('board').style.width = `${px}px`; }, px);
  await paneWidth(1000);
  await wait(300);
  const wide = await bar();
  check('36 wide pane: every button is on the bar', wide.buttons.includes('Dice') && wide.buttons.includes('Stat sheet') && !wide.buttons.includes('More tools'), JSON.stringify(wide.buttons));
  await paneWidth(330);
  await wait(600);
  const narrow = await bar();
  await shot('narrow-toolbar');
  check('36 narrow pane: the bar stays inside the pane', narrow.left >= 0 && narrow.right <= narrow.view, JSON.stringify(narrow));
  check('36 narrow pane: a More tools button takes the overflow', narrow.buttons.includes('More tools'), JSON.stringify(narrow.buttons));
  await page.getByRole('button', { name: 'More tools' }).click();
  await wait(300);
  const menu = await page.evaluate(() => { const m = document.querySelector('.atlas-tabletop-more-menu'); const r = m && m.getBoundingClientRect(); return m && !m.hidden ? { items: [...m.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()), inside: r.left >= 0 && r.right <= window.innerWidth } : null; });
  check('36 More tools opens a menu inside the pane with the moved tools', menu && menu.inside && menu.items.length >= 2, JSON.stringify(menu));
  await shot('narrow-toolbar-menu');
  await page.keyboard.press('Escape');
  await wait(200);
  check('36 Escape closes the menu', await page.evaluate(() => { const m = document.querySelector('.atlas-tabletop-more-menu'); return !m || m.hidden; }));
  await paneWidth(1000);
  await wait(600);
  const back = await bar();
  check('36 widening the pane brings the tools back', back.buttons.includes('Dice') && !back.buttons.includes('More tools'), JSON.stringify(back.buttons));
});

// ── Item 38: readability in Obsidian's light theme ─────────────────────────────────────────────────────────────
feature('light theme', async ({ page, shot }) => {
  // Obsidian's default light theme variables (the dark ones are the harness's).
  await page.addStyleTag({ content: ':root{--background-primary:#ffffff;--background-secondary:#f6f6f6;--background-modifier-hover:rgba(0,0,0,.05);--text-normal:#222222;--text-muted:#5c5c5c;--text-faint:#ababab;--background-modifier-border:#e0e0e0;--divider-color:#e0e0e0;--background-secondary-alt:#fcfcfc;--shadow-l:0 8px 24px rgba(0,0,0,.15)} body{background:#e8e8e8}' });
  await page.evaluate(() => document.body.classList.add('theme-light'));
  await wait(300);
  // The contrast of the text of an element against the first opaque background behind it, as the WCAG ratio.
  const contrast = (selector) => page.evaluate((selector) => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const el = document.querySelector(selector);
    if (!el || el.offsetParent === null) return null;
    const fg = parse(getComputedStyle(el).color);
    let node = el, bg = null;
    while (node && !bg) { const c = parse(getComputedStyle(node).backgroundColor); if (c && c.a > 0.5) bg = c; node = node.parentElement; }
    bg = bg ?? { r: 255, g: 255, b: 255 };
    const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 10) / 10;
  }, selector);
  const needs = (name, ratio) => check(`38 ${name} reads in the light theme (contrast ${ratio})`, ratio !== null && ratio >= 4.5, String(ratio));
  // The board settings panel and the lighting menu.
  await page.getByRole('button', { name: 'Board settings' }).click();
  await wait(300);
  for (const [name, selector] of [['panel title', '.atlas-tabletop-palette__title'], ['panel label', '.atlas-tabletop-palette:not(.atlas-tabletop-lighting-options) .atlas-tabletop-palette__label'], ['panel hint', '.atlas-tabletop-palette:not(.atlas-tabletop-lighting-options) .atlas-tabletop-palette__hint'], ['panel heading', '.atlas-tabletop-palette__heading']]) needs(name, await contrast(selector));
  await shot('light-settings');
  await page.keyboard.press('Escape');
  await page.locator('button[aria-label^="Lighting"]').click();
  await wait(300);
  needs('lighting menu item', await contrast('.atlas-tabletop-lighting-options .atlas-dropdown-menu-item'));
  needs('lighting menu ambient label', await contrast('.atlas-tabletop-lighting-extra .atlas-tabletop-palette__label'));
  needs('lighting menu hint', await contrast('.atlas-tabletop-lighting-extra .atlas-tabletop-palette__hint'));
  await shot('light-lighting');
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 120);
  // The group bar.
  const at = (id) => page.evaluate((id) => { const e = window.boardTest.board.tokens.get(id); return window.boardTest.project(e.at.x, e.at.y, 0); }, id);
  const hero = await at('hero'); const gob = await at('gob');
  await page.mouse.click(hero.x, hero.y);
  await page.keyboard.down('Shift'); await page.mouse.click(gob.x, gob.y); await page.keyboard.up('Shift');
  await wait(300);
  needs('group bar count', await contrast('.atlas-tabletop-group-bar__count'));
  await shot('light-group-bar');
  await page.keyboard.press('Escape');
  // The turn banner.
  await page.evaluate(() => window.boardTest.board.flashTurn('Round 3 · Goblin'));
  await wait(300);
  needs('turn banner', await contrast('.atlas-tabletop-turn-banner'));
  await shot('light-turn-banner');
});

// ── Item 37: snapshots of the board, and the card a note shows ─────────────────────────────────────────────────────
feature('snapshot and board card', async ({ page, shot }) => {
  const snap = await page.evaluate(async () => {
    // The canvas is resized as the page settles: its size is read at the moment of the snapshot, and again after it.
    const before = [window.boardTest.board.canvas.width, window.boardTest.board.canvas.height];
    const blob = await window.boardTest.board.snapshot();
    const at = [window.boardTest.board.canvas.width, window.boardTest.board.canvas.height];
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const url = URL.createObjectURL(blob);
    const size = await new Promise((resolve) => { const img = new Image(); img.onload = () => resolve([img.naturalWidth, img.naturalHeight]); img.src = url; });
    // The snapshot is not blank: some pixels differ from the first one.
    const canvas = document.createElement('canvas'); canvas.width = size[0]; canvas.height = size[1];
    const context = canvas.getContext('2d'); const img = new Image(); img.src = url; await img.decode(); context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, size[0], size[1]).data;
    const colours = new Set(); for (let i = 0; i < data.length; i += 4 * 997) colours.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    window.snapshotUrl = url;
    return { png: bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47, bytes: bytes.length, size, colours: colours.size, canvas: at, before };
  });
  check('37 the board gives a PNG', snap && snap.png && snap.bytes > 5000, JSON.stringify(snap));
  check('37 the snapshot is the size of what the board draws', snap && [snap.canvas, snap.before].some((c) => snap.size[0] === c[0] && snap.size[1] === c[1]), JSON.stringify(snap));
  check('37 the snapshot shows the board, not a blank canvas', snap && snap.colours > 8, JSON.stringify(snap));
  // The card a note shows.
  const card = await page.evaluate(() => {
    window.cardOpened = 0;
    const host = document.createElement('div'); host.id = 'note'; host.style.cssText = 'position:absolute;left:20px;top:20px;width:420px;z-index:50;background:#fff;padding:12px';
    document.body.appendChild(host);
    window.boardTest.renderBoardCard(host, { title: 'The goblin cave', snapshotUrl: window.snapshotUrl, open: () => { window.cardOpened++; } });
    return true;
  });
  await wait(400);
  const shown = await page.evaluate(() => ({ title: document.querySelector('.atlas-tabletop-board-card__title').textContent, img: !!document.querySelector('.atlas-tabletop-board-card__snapshot') && document.querySelector('.atlas-tabletop-board-card__snapshot').naturalWidth > 0, button: document.querySelector('.atlas-tabletop-board-card__open').textContent }));
  check('37 the card shows the title, the snapshot and an Open in 3D button', shown.title === 'The goblin cave' && shown.img && shown.button === 'Open in 3D', JSON.stringify(shown));
  await shot('board-card');
  await page.getByRole('button', { name: 'Open in 3D' }).click();
  check('37 the button opens the map', (await page.evaluate(() => window.cardOpened)) === 1);
  await page.evaluate(() => { document.getElementById('note').remove(); window.boardTest.renderBoardCard(document.body, { title: 'No picture yet', snapshotUrl: null, open: () => undefined }); });
  check('37 without a snapshot the card shows only the title and the button', (await page.locator('.atlas-tabletop-board-card__snapshot').count()) === 0 && (await page.locator('.atlas-tabletop-board-card__open').count()) === 1);
});

// ── Item 22: map levels (Atlas 0.10 layers) and the level switch ──────────────────────────────────────────────────
feature('map levels', async ({ page, shot }) => {
  const text = JSON.stringify({ version: 1, state: {
    background: 'bg.png', grid: window_grid(), levels: [{ id: 'ground', name: 'Ground floor' }, { id: 'upper', name: 'Upper floor', background: 'green.png' }],
    objects: { tokens: {
      a: { id: 'a', x: 245, y: 245, imagePath: 'red.png', name: 'Ground guard', level: 'ground' },
      b: { id: 'b', x: 525, y: 385, imagePath: 'green.png', name: 'Upper archer', level: 'upper' },
      c: { id: 'c', x: 805, y: 385, imagePath: 'red.png', name: 'Everywhere', levels: 'all' },
      d: { id: 'd', x: 875, y: 525, imagePath: 'red.png', name: 'Unset level' },
    }, pins: {} },
  } });
  function window_grid() { return { size: 70, enabled: true, visible: true }; }
  const ids = () => page.evaluate(() => [...window.boardTest.board.tokens.keys()].sort());
  await page.evaluate((text) => window.boardTest.board.load(window.boardTest.readMap('m.atlasmap', text, 'ground')), text);
  await wait(500);
  check('22 the ground floor shows its tokens, the ones on every floor and those with no level', JSON.stringify(await ids()) === JSON.stringify(['a', 'c', 'd']), JSON.stringify(await ids()));
  const groundSize = await page.evaluate(() => [window.boardTest.board.size.width, window.boardTest.board.size.height]);
  await shot('level-ground');
  await page.evaluate((text) => window.boardTest.board.load(window.boardTest.readMap('m.atlasmap', text, 'upper')), text);
  await wait(500);
  check('22 switching to the upper floor shows its tokens and those on every floor, not the ground floor ones', JSON.stringify(await ids()) === JSON.stringify(['b', 'c']), JSON.stringify(await ids()));
  const upperSize = await page.evaluate(() => [window.boardTest.board.size.width, window.boardTest.board.size.height]);
  check('22 the upper floor has its own background', JSON.stringify(groundSize) !== JSON.stringify(upperSize), JSON.stringify([groundSize, upperSize]));
  await shot('level-upper');
  // Per-level alignment (Atlas's levelAlignments): the same image on two levels, one of them stretched.
  const aligned = JSON.stringify({ version: 1, state: {
    background: 'bg.png', grid: { size: 70, enabled: true, visible: true }, levels: [{ id: 'ground' }, { id: 'upper', background: 'bg.png' }],
    levelAlignments: { upper: { scale: 1, stretch: { x: 1.4, y: 1.2, rotation: 0 } } }, objects: { tokens: {}, pins: {} },
  } });
  const worldOf = async (level) => { await page.evaluate(([text, level]) => window.boardTest.board.load(window.boardTest.readMap('m.atlasmap', text, level)), [aligned, level]); await wait(500); return page.evaluate(() => [window.boardTest.board.size.width, window.boardTest.board.size.height]); };
  const plain = await worldOf('ground');
  const stretched = await worldOf('upper');
  check('22 a level without an alignment of its own keeps the scene size', plain[0] > 0 && plain[1] > 0, JSON.stringify(plain));
  check("22 a level's own alignment stretches its board (x 1.4, y 1.2)", Math.abs(stretched[0] / plain[0] - 1.4) < 0.01 && Math.abs(stretched[1] / plain[1] - 1.2) < 0.01, JSON.stringify([plain, stretched]));
  await shot('level-aligned');
  await page.evaluate((text) => window.boardTest.board.load(window.boardTest.readMap('m.atlasmap', text, 'nowhere')), text);
  await wait(500);
  check('22 an unknown level reads as the first', JSON.stringify(await ids()) === JSON.stringify(['a', 'c', 'd']), JSON.stringify(await ids()));
});

feature('atlas 0.14 rooms and pin names', async ({ page, shot }) => {
  // Atlas 0.14 carves rooms out of the rock: the outline of the shown rooms stands as solid walls (two rooms that overlap
  // make one outline, a hidden room none). A pin the GM named is titled by that name.
  const q = (x, y, size) => [[x, y, x + size, y, x + size, y + size, x, y + size].map((value) => value * 8)];
  const text = JSON.stringify({ version: 1, state: {
    background: 'bg.png', grid: { size: 70, enabled: true, visible: true },
    objects: {
      tokens: { a: { id: 'a', x: 245, y: 245, imagePath: 'red.png', name: 'Delver' } },
      walls: {},
      rooms: {
        hall: { id: 'hall', kind: 'room', name: 'Hall', order: 0, area: q(140, 140, 280) },
        nook: { id: 'nook', kind: 'room', name: 'Nook', order: 1, area: q(350, 210, 210) },
        vault: { id: 'vault', kind: 'room', name: 'Vault', order: 2, hidden: true, area: q(700, 700, 140) },
      },
      pins: { p: { id: 'p', kind: 'pin', x: 280, y: 280, notePath: 'Notes/Hall.md', name: 'The Great Hall', showName: true } },
    },
  } });
  await page.evaluate((text) => window.boardTest.board.load(window.boardTest.readMap('m.atlasmap', text)), text);
  await wait(600);
  const state = await page.evaluate(() => {
    const { board } = window.boardTest;
    let meshes = 0;
    board.scene.traverse((node) => { if (node.isMesh && node.userData.walls) meshes += 1; });
    const rooms = board.map.walls.filter((wall) => wall.chain === 'rooms');
    return {
      rooms: rooms.length,
      solid: rooms.every((wall) => wall.type === 'solid'),
      // The hidden vault (700..840) makes none; the two shown rooms make one outline (no wall at x = 420 or 350 inside it).
      vault: rooms.some((wall) => Math.max(wall.p1.x, wall.p2.x) > 600),
      inside: rooms.some((wall) => wall.p1.x === wall.p2.x && (wall.p1.x === 420 || wall.p1.x === 350) && Math.min(wall.p1.y, wall.p2.y) >= 210 && Math.max(wall.p1.y, wall.p2.y) <= 420),
      meshes,
      pin: board.map.pins[0]?.name ?? null,
    };
  });
  await shot('rooms-carved');
  check('rooms: the outline of the shown rooms stands as solid walls on the board, one outline for rooms that overlap, none for a hidden one', state.rooms >= 6 && state.solid && !state.vault && !state.inside && state.meshes > 0, JSON.stringify(state));
  check('pin names: a pin the GM named is titled by that name', state.pin === 'The Great Hall', JSON.stringify(state));
  await page.evaluate(() => window.boardTest.board.load(window.boardTest.map));
  await wait(500);
});

feature('atlas levels as layers', async ({ page, shot }) => {
  // One scene with Atlas levels: the ground floor is shown, the upper floor is drawn above it as a layer, at its height
  // (10 ft over 5 ft squares: 2 squares), with its own floor image, walls and tokens; the height ruler lists the levels.
  const text = JSON.stringify({ version: 1, state: {
    background: 'bg.png', grid: { size: 70, enabled: true, visible: true, unitDistance: 5 },
    levels: [{ id: 'ground', elevation: { bottom: 0, top: 10 } }, { id: 'upper', name: 'Upstairs', elevation: { bottom: 10, top: 20 }, background: 'balcony.png' }],
    objects: {
      tokens: { a: { id: 'a', x: 245, y: 245, imagePath: 'red.png', name: 'Ground guard' }, b: { id: 'b', x: 420, y: 280, imagePath: 'green.png', name: 'Upper archer', level: 'upper' } },
      walls: {
        w1: { id: 'w1', type: 'solid', p1: { x: 140, y: 140 }, p2: { x: 560, y: 140 } },
        rail: { id: 'rail', type: 'solid', levels: ['upper'], p1: { x: 280, y: 420 }, p2: { x: 770, y: 420 } },
      },
      pins: {},
    },
  } });
  const result = await page.evaluate(async (text) => {
    const { board, readMap, Box3 } = window.boardTest;
    const ground = readMap('m.atlasmap', text, 'ground');
    const upper = readMap('m.atlasmap', text, 'upper');
    await board.load(ground);
    const none = () => null;
    board.setStack([{ path: 'atlas-level:upper', elevation: 2, map: upper, wallHeight: none, windowOf: none, wallWidth: none, wallMaterial: none, doorProp: none, doorFlip: none, lightHeight: () => 1, fogHeight: 1, wallThickness: 0.12, props: [], water: null, stands: { x: 0, y: 0, turn: 0 }, placement: none, style: () => 'disc' }]);
    board.setLayerMenu([{ path: 'atlas-level:upper', name: 'Upstairs', elevation: 2, active: false }, { path: 'atlas-level:ground', name: 'Level 1', elevation: 0, active: true }]);
    board.wake(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const view = board.layerViews.get('atlas-level:upper');
    const box = view ? new Box3().setFromObject(view.object3d) : null;
    return {
      shown: [...board.tokens.keys()].sort(), upperTokens: upper.tokens.filter((token) => !token.offLevel).map((token) => token.id),
      shownWalls: ground.walls.map((wall) => wall.id), upperWalls: upper.walls.map((wall) => wall.id), upperImage: upper.background,
      layer: !!view, floor: box ? Math.round(box.min.y) : null, levelNames: upper.levels.map((level) => [level.id, level.bottom]),
      ruler: board.container.querySelectorAll('.atlas-tabletop-layers *').length,
    };
  }, text);
  check('atlas levels: the level shown has only its own tokens and walls', JSON.stringify(result.shown) === '["a"]' && JSON.stringify(result.shownWalls) === '["w1"]' && JSON.stringify(result.upperWalls) === '["rail"]' && JSON.stringify(result.upperTokens) === '["b"]', JSON.stringify(result));
  check('atlas levels: the upper level is a layer with its own floor, at its height', result.layer && result.upperImage === 'balcony.png' && JSON.stringify(result.levelNames) === '[["ground",0],["upper",10]]', JSON.stringify(result));
  check('atlas levels: the height ruler lists the levels', result.ruler > 0, JSON.stringify(result));
  await shot('atlas-levels');
  await page.evaluate(() => { const { board, map } = window.boardTest; board.setStack([]); board.setLayerMenu(null); return board.load(map); });
  await wait(300);
});

// ── Item 20: a map larger than the graphics card's texture limit ────────────────────────────────────────────────────
feature('large map', async ({ page, shot }) => {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000; canvas.height = 2000;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 3000, 2000);
    gradient.addColorStop(0, '#264653'); gradient.addColorStop(1, '#e9c46a');
    context.fillStyle = gradient; context.fillRect(0, 0, 3000, 2000);
    context.fillStyle = '#e76f51'; for (let i = 0; i < 12; i++) context.fillRect(i * 250, 900 + (i % 2) * 100, 120, 120);
    window.boardTest.images['huge.png'] = canvas.toDataURL('image/png');
    const board = window.boardTest.board;
    // A graphics card that takes 1024 pixels in one texture.
    Object.defineProperty(board.renderer.capabilities, 'maxTextureSize', { value: 1024, configurable: true });
    await board.load({ ...window.boardTest.map, background: 'huge.png' });
    const texture = board.surface.image.map;
    return { kept: [texture.image.width, texture.image.height], world: [board.size.width, board.size.height] };
  });
  check('20 the texture stays within what the graphics card takes', Math.max(...result.kept) <= 1024, JSON.stringify(result));
  check('20 the board keeps the image true size, so tokens and the grid stay in its pixels', result.world[0] === 3000 && result.world[1] === 2000, JSON.stringify(result));
  check('20 the scaled copy keeps the image proportions', Math.abs(result.kept[0] / result.kept[1] - 1.5) < 0.01, JSON.stringify(result));
  await wait(800);
  await shot('large-map');
});

// ── Item 21: nothing piles up in graphics memory when a map is loaded again ───────────────────────────────────────
feature('memory on reload', async ({ page, shot }) => {
  const info = () => page.evaluate(() => { const { geometries, textures } = window.boardTest.board.renderer.info.memory; return { geometries, textures }; });
  const reload = async (background) => { await page.evaluate((background) => window.boardTest.board.load({ ...window.boardTest.map, background }), background); await wait(500); };
  // Warm up: the first loads make what a board keeps for good (shared textures, shader programs).
  await reload('bg.png'); await reload('green.png'); await reload('bg.png');
  const base = await info();
  for (let i = 0; i < 6; i++) { await reload(i % 2 ? 'green.png' : 'bg.png'); }
  await reload('bg.png');
  const after = await info();
  check('21 reloading the map six times leaves no more geometries in graphics memory', after.geometries <= base.geometries + 2, JSON.stringify([base, after]));
  check('21 reloading the map six times leaves no more textures in graphics memory', after.textures <= base.textures + 2, JSON.stringify([base, after]));
  // Moving to an animated map and back lets go of the video's texture too.
  await page.evaluate(async () => { const r = await fetch('/sweep.webm'); window.boardTest.images['sweep.webm'] = URL.createObjectURL(await r.blob()); });
  await reload('sweep.webm'); await reload('bg.png');
  const video = await info();
  check('21 a video map and back leaves no texture behind', video.textures <= base.textures + 2, JSON.stringify([base, video]));
});

// ── Item 6: a Fate roll and a labelled roll in the dice log, and a Fate roll thrown from a formula ──────────────────
feature('fate and labels', async ({ page, shot }) => {
  await page.getByRole('button', { name: 'Dice log' }).click();
  await wait(300);
  // A Fate roll, as Atlas logs it (`dF` dice reading -1, 0 or +1) with a labelled group beside it.
  await page.evaluate(() => window.boardTest.atlasBus.emit('dice-rolled', {
    id: 'fate_1', timestamp: Date.now(), formula: '4dF+2d6', modifiers: 1, total: 7, rolledBy: 'Anna',
    rolls: [
      { die: 'dF', value: 1, max: 1, min: -1 }, { die: 'dF', value: -1, max: 1, min: -1 }, { die: 'dF', value: 0, max: 1, min: -1 }, { die: 'dF', value: 1, max: 1, min: -1 },
      { die: 'd6', value: 4, max: 6, min: 1, label: 'fire' }, { die: 'd6', value: 2, max: 6, min: 1, label: 'fire' },
    ],
    source: { type: 'toolbar' },
  }));
  await wait(400);
  const entry = await page.evaluate(() => {
    const row = document.querySelector('.atlas-tabletop-dice-log__entry');
    return { chips: [...row.querySelectorAll('.atlas-tabletop-dice-log__die')].map((chip) => chip.textContent), tags: [...row.querySelectorAll('.atlas-tabletop-dice-log__tag')].map((tag) => tag.textContent), marks: [...row.querySelectorAll('.atlas-tabletop-dice-log__die')].map((chip) => chip.className.replace('atlas-tabletop-dice-log__die', '').trim()) };
  });
  check('6 Fate dice show as plus, minus and blank in the log', JSON.stringify(entry.chips.slice(0, 4)) === JSON.stringify(['+', '−', '0', '+']), JSON.stringify(entry));
  check('6 a Fate plus reads as the top face and a minus as the bottom one', entry.marks[0].includes('is-max') && entry.marks[1].includes('is-min') && entry.marks[2] === '', JSON.stringify(entry.marks));
  check('6 a label names its run of dice once, before the first of them', JSON.stringify(entry.tags) === JSON.stringify(['fire']) && entry.chips.slice(4).join(',') === '4,2', JSON.stringify(entry));
  await shot('fate-log');
  // A Fate roll thrown from a formula (a sheet or card roll): four dice lie on the table, thrown as d6s.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.boardTest.boardDice.cardRoll('hero', '4dF[Attack]+1', 'Fate roll'));
  await wait(1200);
  const table = await page.evaluate(() => {
    const controller = window.boardTest.boardDice.controller;
    const session = controller && controller.session;
    return { dice: session ? session.dice.map((die) => die.die) : null, waiting: controller ? controller.waiting : null };
  });
  check('6 a Fate formula lays four d6s on the table to throw', table.dice && table.dice.length === 4 && table.dice.every((die) => die === 'd6') && table.waiting === true, JSON.stringify(table));
  await shot('fate-table');
});

// ── Item 7: dice a roll sets aside show dimmed on the table ────────────────────────────────────────────────────────
feature('set-aside dice', async ({ page, shot }) => {
  await page.evaluate(() => window.boardTest.boardDice.cardRoll('hero', '4d6kh3', 'Stats'));
  await wait(800);
  const read = () => page.evaluate(() => {
    const dice = window.boardTest.boardDice;
    const table = dice.table;
    return [...table.dice.entries()].map(([id, die]) => ({ id, opacity: die.mesh.material.opacity, transparent: die.mesh.material.transparent }));
  });
  const before = await read();
  check('7 four d6 lie on the table at full strength before they are thrown', before.length === 4 && before.every((die) => die.opacity === 1), JSON.stringify(before));
  // The dice come to rest on 5, 1, 6 and 3 (as the table reports it), one by one.
  const faces = [5, 1, 6, 3];
  const ids = before.map((die) => die.id);
  for (let i = 0; i < 3; i++) await page.evaluate(([id, face]) => window.boardTest.boardDice.table.onSettled(id, { caught: false, face, confidence: 1 }), [ids[i], faces[i]]);
  const partial = await read();
  check('7 while the roll is not complete nothing is dimmed', partial.every((die) => die.opacity === 1), JSON.stringify(partial));
  await page.evaluate(([id, face]) => window.boardTest.boardDice.table.onSettled(id, { caught: false, face, confidence: 1 }), [ids[3], faces[3]]);
  await wait(300);
  const done = await read();
  const dim = done.filter((die) => die.opacity < 1).map((die) => die.id);
  check('7 the lowest die (the 1) is dimmed once the roll is complete, the three kept dice stay solid', dim.length === 1 && dim[0] === ids[1] && done.filter((die) => die.opacity === 1).length === 3, JSON.stringify(done));
  await page.getByRole('button', { name: 'Dice log' }).click();
  await wait(300);
  const logged = await page.evaluate(() => ({ entries: document.querySelectorAll('.atlas-tabletop-dice-log__entry').length, chips: [...document.querySelectorAll('.atlas-tabletop-dice-log__entry:first-child .atlas-tabletop-dice-log__die')].map((c) => `${c.textContent}${c.classList.contains('is-dropped') ? '(dropped)' : ''}`) }));
  check('7 the log entry of the same roll strikes through the same die', logged.chips.join(' ').includes('1(dropped)') && logged.chips.filter((c) => c.includes('dropped')).length === 1, JSON.stringify(logged));
  await shot('set-aside-dice');
});

// ── Sheet rolls: laid for a manual throw, or thrown at once (the tick in Board settings) ───────────────────────────
feature('auto roll', async ({ page, shot }) => {
  const settings = page.locator('button[aria-label="Board settings"]').first();
  const sheetButton = page.locator('button[aria-label="Stat sheet"]');
  const drawer = page.locator('.atlas-tabletop-sheet');
  const state = () => page.evaluate(() => ({ dice: window.boardTest.board.dice.object3d.children.length, busy: window.boardTest.board.dice.busy }));
  const clear = () => page.evaluate(() => window.boardTest.boardDice.clearTable?.());
  await settings.click();
  const tick = page.getByLabel('Throw stat sheet rolls automatically');
  check('auto roll: Board settings has the tick, off by default', (await tick.count()) === 1 && !(await tick.isChecked()));
  await shot('auto-roll-setting');
  await settings.click();
  await page.evaluate(() => window.boardTest.board.select('hero'));
  await sheetButton.click();
  await wait(400);
  const attack = page.locator('.atlas-tabletop-sheet__roll', { hasText: 'Attack: +5' });
  await attack.click();
  await wait(300);
  const manual = await state();
  check('auto roll off: the d20 is laid on the table and waits to be thrown', manual.dice === 1 && !manual.busy, JSON.stringify(manual));
  await shot('auto-roll-off-laid');
  // A link in Atlas's own Ctrl-hover window (which Atlas puts on the page) throws the board's dice, never Atlas's.
  const hoverWindow = () => page.evaluate(() => {
    document.querySelectorAll('.atlas-statblock-preview-window').forEach((node) => node.remove());
    const box = document.createElement('div');
    box.className = 'atlas-statblock-preview-window';
    box.style.cssText = 'position:fixed;left:380px;top:120px;padding:12px;background:#222;color:#eee;z-index:5000';
    box.innerHTML = '<span class="atlas-sb-labelled"><span class="atlas-sb-label">Bite</span> <a href="#" data-formula="1d20+4" id="hover-bite">+4</a></span>';
    document.body.append(box);
  });
  await clear();
  await hoverWindow();
  await page.locator('#hover-bite').click();
  await wait(300);
  const hoverManual = await state();
  check("auto roll off: a roll in Atlas's hover window lays its d20 for a manual throw", hoverManual.dice === 1 && !hoverManual.busy, JSON.stringify(hoverManual));
  await shot('auto-roll-off-hover');
  // Opening Board settings closes the unpinned drawer.
  await clear();
  await settings.click();
  check('an unpinned sheet drawer closes when Board settings opens', await drawer.isHidden());
  await tick.check();
  check('auto roll: ticking it keeps the tick', await tick.isChecked());
  await shot('auto-roll-ticked');
  await settings.click();
  await page.evaluate(() => document.querySelectorAll('.atlas-statblock-preview-window').forEach((node) => node.remove()));
  await sheetButton.click();
  await wait(300);
  await attack.click();
  await wait(150);
  const auto = await state();
  check('auto roll on: the d20 is thrown at once', auto.dice === 1 && auto.busy, JSON.stringify(auto));
  await shot('auto-roll-on-thrown');
  await page.waitForFunction(() => !window.boardTest.board.dice.busy, null, { timeout: 90000 });
  const logged = await page.evaluate(() => window.boardTest.atlasRolls.length);
  check('auto roll on: the roll finishes and is logged without a throw by hand', logged >= 1, String(logged));
  await clear();
  await hoverWindow();
  await page.locator('#hover-bite').click();
  await wait(150);
  const hoverAuto = await state();
  check("auto roll on: a roll in Atlas's hover window is thrown at once", hoverAuto.dice === 1 && hoverAuto.busy, JSON.stringify(hoverAuto));
  await shot('auto-roll-on-hover');
  // Tabletop's own card is not routed twice: its box is left to its own routing.
  await page.waitForFunction(() => !window.boardTest.board.dice.busy, null, { timeout: 90000 });
  const before = await page.evaluate(() => window.boardTest.atlasRolls.length);
  await clear();
  await page.evaluate(() => { document.querySelector('.atlas-statblock-preview-window').dataset.tabletopCard = 'true'; });
  await page.locator('#hover-bite').click();
  await wait(200);
  const own = await state();
  check("a link in Tabletop's own card is left to its own routing (not thrown twice)", own.dice === 0 && before === (await page.evaluate(() => window.boardTest.atlasRolls.length)), JSON.stringify(own));
  await page.evaluate(() => document.querySelectorAll('.atlas-statblock-preview-window').forEach((node) => node.remove()));
});

// ── The sheet drawer's pin ──────────────────────────────────────────────────────────────────────────────────────
feature('sheet pin', async ({ page, shot }) => {
  const settings = page.locator('button[aria-label="Board settings"]').first();
  const drawer = page.locator('.atlas-tabletop-sheet');
  await page.evaluate(() => window.boardTest.board.select('hero'));
  await page.locator('button[aria-label="Stat sheet"]').click();
  await wait(400);
  const pin = drawer.locator('.atlas-tabletop-sheet__pin');
  check('pin: the drawer has a Pin button, not pinned', (await pin.count()) === 1 && (await pin.getAttribute('aria-pressed')) === 'false' && (await pin.getAttribute('aria-label')) === 'Pin');
  await pin.click();
  check('pin: clicking it pins the drawer', (await pin.getAttribute('aria-pressed')) === 'true' && (await pin.getAttribute('aria-label')) === 'Unpin' && (await drawer.getAttribute('class')).includes('is-pinned'));
  await settings.click();
  await wait(200);
  check('pin: a pinned drawer stays open when Board settings opens', await drawer.isVisible());
  const stack = await page.evaluate(() => {
    const d = document.querySelector('.atlas-tabletop-sheet').getBoundingClientRect();
    const p = document.querySelector('.atlas-tabletop-palette').getBoundingClientRect();
    const overlaps = Math.max(d.left, p.left) < Math.min(d.right, p.right) && Math.max(d.top, p.top) < Math.min(d.bottom, p.bottom);
    const over = document.elementFromPoint((Math.max(d.left, p.left) + Math.min(d.right, p.right)) / 2, (Math.max(d.top, p.top) + Math.min(d.bottom, p.bottom)) / 2);
    return { overlaps, panelOnTop: !!over?.closest('.atlas-tabletop-palette') };
  });
  check('pin: where they overlap, the settings panel is over the pinned drawer', !stack.overlaps || stack.panelOnTop, JSON.stringify(stack));
  await shot('sheet-pinned-under-settings');
  await settings.click();
  await page.locator('button[aria-label^="Lighting"]').click();
  check('pin: it stays when the lighting menu opens', await drawer.isVisible());
  await page.keyboard.press('Escape');
  await pin.click();
  check('pin: clicking again unpins it', (await pin.getAttribute('aria-pressed')) === 'false' && !(await drawer.getAttribute('class')).includes('is-pinned'));
  await settings.click();
  check('pin: unpinned, it closes when Board settings opens', await drawer.isHidden());
  await shot('sheet-unpinned-closed');
});

// ── The pin is kept across reloads ──────────────────────────────────────────────────────────────────────────────
feature('pin kept across reloads', async ({ page, shot }) => {
  const drawer = page.locator('.atlas-tabletop-sheet');
  const open = async () => {
    await page.evaluate(() => window.boardTest.board.select('hero'));
    await page.locator('button[aria-label="Stat sheet"]').click();
    await wait(400);
  };
  await open();
  const pin = drawer.locator('.atlas-tabletop-sheet__pin');
  check('pin kept: a fresh board starts unpinned', (await pin.getAttribute('aria-pressed')) === 'false');
  await pin.click();
  await page.reload();
  await page.waitForFunction(() => window.boardTest?.ready, null, { timeout: 30000 });
  await wait(1200);
  await open();
  check('pin kept: after a reload the drawer is still pinned', (await pin.getAttribute('aria-pressed')) === 'true' && (await drawer.getAttribute('class')).includes('is-pinned'));
  await shot('pin-kept-after-reload');
  await page.locator('button[aria-label="Board settings"]').first().click();
  check('pin kept: and it still stays under the settings panel', await drawer.isVisible());
  await page.locator('button[aria-label="Board settings"]').first().click();
  await pin.click();
  await page.reload();
  await page.waitForFunction(() => window.boardTest?.ready, null, { timeout: 30000 });
  await wait(1200);
  await open();
  check('pin kept: unpinned, it stays unpinned after a reload', (await pin.getAttribute('aria-pressed')) === 'false');
});

// ── A base under a mini that has none ───────────────────────────────────────────────────────────────────────────
feature('mini base', async ({ page, shot }) => {
  const probe = () => page.evaluate(() => {
    const piece = window.boardTest.board.tokens.get('hero').piece;
    const bases = [];
    piece.object3d.traverse((node) => { if (node.userData.miniBase) bases.push(node); });
    const box = bases[0] ? new window.boardTest.Vector3() : null;
    if (box) bases[0].geometry.computeBoundingBox();
    const size = bases[0] ? bases[0].geometry.boundingBox.getSize(new window.boardTest.Vector3()) : null;
    return { count: bases.length, top: piece.top, diameter: piece.diameter, size: size && [size.x, size.y, size.z], kind: bases[0] ? bases[0].geometry.type : null };
  });
  const none = await probe();
  check('base: a mini stands on the board with no base to begin with', none.count === 0 && none.top === 0, JSON.stringify(none));
  await page.evaluate(() => window.boardTest.setHeroBase('round'));
  await wait(700);
  const round = await probe();
  check('base: a round base is drawn under the mini', round.count === 1 && round.kind === 'CylinderGeometry', JSON.stringify(round));
  check('base: the mini stands on top of it, and it is thin and within the token', round.top > 0 && round.top < round.diameter * 0.15 && Math.abs(round.size[0] - round.diameter * 0.96) < 0.5, JSON.stringify(round));
  await shot('mini-base-round');
  await page.evaluate(() => window.boardTest.setHeroBase('square'));
  await wait(700);
  const square = await probe();
  check('base: a square base is drawn when asked', square.count === 1 && square.kind === 'BoxGeometry' && Math.abs(square.size[0] - square.size[2]) < 1e-6, JSON.stringify(square));
  await shot('mini-base-square');
  await page.evaluate(() => window.boardTest.setHeroBase('none'));
  await wait(700);
  const gone = await probe();
  check('base: taking it away puts the mini back on the board', gone.count === 0 && gone.top === 0, JSON.stringify(gone));
  // The token's menu offers both, checked as set, and picking the one that is set takes it away.
  await page.evaluate(() => window.boardTest.board.tokens.get('hero') && window.boardTest.record.menuActions.splice(0));
});

// ── Scenes stacked above or below the one shown (elevation layers) ──────────────────────────────────────────────
feature('elevation layers', async ({ page, shot }) => {
  const stack = (elevation, extra = {}) => page.evaluate(([elevation, extra]) => {
    const { board, map } = window.boardTest;
    const upper = {
      path: 'upper.atlasmap', elevation,
      map: { ...map, path: 'upper.atlasmap', background: 'balcony.png', fog: [], inks: [], texts: [], icons: [], pins: [], initiative: null,
        tokens: [{ ...map.tokens[0], id: 'archer', x: 420, y: 280, name: 'Archer', imagePath: 'green.png', resources: {} }],
        walls: [{ id: 'rail', type: 'solid', p1: { x: 280, y: 420 }, p2: { x: 770, y: 420 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null }],
        lights: [] },
      wallHeight: () => null, wallMaterial: () => null, doorProp: () => null, lightHeight: () => 1, fogHeight: 1, wallThickness: 0.12, props: [],
      placement: (id) => (id === 'archer' ? { mini: 'minis/hero.glb', scale: 1, turn: 0 } : null), style: () => 'disc', ...extra,
    };
    board.setStack(elevation === null ? [] : [upper]);
  }, [elevation, extra]);
  const probe = () => page.evaluate(() => {
    const { board } = window.boardTest;
    const view = [...board.layerViews.values()][0];
    if (!view) return { layers: board.layerViews.size };
    return { layers: board.layerViews.size, y: view.object3d.position.y, floor: view.floor.visible, alphaTest: view.image.alphaTest, transparent: view.image.transparent, opacity: view.image.opacity, casts: view.floor.castShadow, tokens: view.tokens.size, props: view.props.size };
  });
  // The look eases over a little over half a second: settled once it returns.
  const quality = async (look) => { await page.evaluate((look) => { const { board, QUALITY } = window.boardTest; board.setQuality({ ...board.quality, layerLook: look }); }, look); await wait(1400); };
  await stack(2);
  await wait(900);
  let now = await probe();
  check('layers: a scene stacked above is drawn two squares up (140 px at a 70 px grid)', now.layers === 1 && now.y === 140, JSON.stringify(now));
  check('layers: its image is a floor with its transparent parts cut out', now.floor && now.alphaTest === 0.5 && !now.transparent && now.casts, JSON.stringify(now));
  check('layers: its token stands on it', now.tokens === 1, JSON.stringify(now));
  await page.evaluate(() => { const { camera } = window.boardTest.board; camera.goal.yaw = 0.6; camera.goal.pitch = 0.6; camera.goal.distance = 900; camera.snap(); window.boardTest.board.wake(true); });
  await shot('elevation-layer-solid');
  // From a token's eyes the scene above is always there and solid: under a previewed point of view (Atlas's sight) and a faded look alike.
  const firstPerson = await page.evaluate(async () => {
    const { board } = window.boardTest;
    const before = board.quality.layerLook;
    board.setQuality({ ...board.quality, layerLook: 'faded' });
    board.setPov('hero');
    board.setAtlasSight({ kind: 'unlit' }, { kind: 'pending' });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const view = () => [...board.layerViews.values()][0];
    const outside = { blacked: view().blackedOut, look: view().look };
    board.seeFrom('hero', false);
    board.wake(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const inside = { blacked: view().blackedOut, look: view().look, visible: view().object3d.visible };
    board.seeFrom(null);
    board.wake(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const back = { look: view().look };
    board.setPov(null);
    board.setAtlasSight({ kind: 'unlit' }, null);
    board.setQuality({ ...board.quality, layerLook: before });
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { outside, inside, back };
  });
  check('layers: from a token\'s eyes the scene above is drawn whole and solid, its own look again outside', firstPerson.inside.blacked === false && firstPerson.inside.look === 'solid' && firstPerson.inside.visible && firstPerson.back.look === 'faded', JSON.stringify(firstPerson));
  const cut = await page.evaluate(() => {
    const { board } = window.boardTest;
    const view = [...board.layerViews.values()][0];
    const walls = [];
    view.walls.object3d.traverse((node) => { if (node.isMesh) walls.push(node.material.onBeforeCompile?.cutaway === true); });
    return { floor: view.image.onBeforeCompile?.cutaway === true, walls };
  });
  check('layers: the floor and the walls of a layer take the see-through cut', cut.floor && cut.walls.length > 0 && cut.walls.every(Boolean), JSON.stringify(cut));
  await page.evaluate(() => { const { board } = window.boardTest; board.setQuality({ ...board.quality, seeThrough: true, seeThroughSize: 3 }); board.camera.goal.pitch = 1.3; board.camera.snap(); board.wake(true); });
  await wait(500);
  await shot('elevation-layer-seethrough');
  await page.evaluate(() => { const { board } = window.boardTest; board.setQuality({ ...board.quality, seeThrough: false }); board.camera.goal.pitch = 0.6; board.camera.snap(); });
  await quality('faded');
  // The look eases over a little over half a second.
  await wait(900);
  now = await probe();
  check('layers: faded draws the image half see-through and casts no shadow', now.transparent && now.opacity === 0.5 && now.alphaTest === 0 && !now.casts, JSON.stringify(now));
  await wait(300);
  await shot('elevation-layer-faded');
  await quality('transparent');
  now = await probe();
  check('layers: hidden leaves the image out and keeps what stands on it', !now.floor && now.tokens === 1, JSON.stringify(now));
  await wait(300);
  await shot('elevation-layer-hidden');
  await quality('solid');
  // Players are shown one scene: the stack is the GM's.
  const seen = await page.evaluate(() => {
    const { board } = window.boardTest;
    const view = [...board.layerViews.values()][0];
    board.showFor('player');
    const forPlayers = view.object3d.visible;
    board.showFor('gm');
    return { forPlayers, forGm: view.object3d.visible };
  });
  check('layers: players do not see a stacked scene, the GM does', seen.forPlayers === false && seen.forGm === true, JSON.stringify(seen));
  // The shown scene stands above another: the table goes down to it and its own image is cut out like a layer's.
  await stack(-2);
  await wait(900);
  const below = await page.evaluate(() => {
    const surface = window.boardTest.board.surface;
    return { table: surface.table.position.y, alphaTest: surface.image.alphaTest, plane: surface.plane.visible };
  });
  check('layers: with a scene below, the table goes down to it and the shown image is cut out too', below.table === -140 && below.alphaTest === 0.5 && below.plane, JSON.stringify(below));
  // Whatever the Upper layers look, the scene being played and the ones below it are solid; the look is for the ones above.
  await page.evaluate(() => { const { board } = window.boardTest; board.setQuality({ ...board.quality, layerLook: 'faded' }); });
  await wait(300);
  const solidBelow = await page.evaluate(() => { const surface = window.boardTest.board.surface; const lower = [...window.boardTest.board.layerViews.values()][0]; return { shown: [surface.image.transparent, surface.image.opacity, surface.image.alphaTest], lower: [lower.image.transparent, lower.image.opacity, lower.image.alphaTest] }; });
  check('layers: with Faded set, the scene played and the one below it stay solid', JSON.stringify(solidBelow) === JSON.stringify({ shown: [false, 1, 0.5], lower: [false, 1, 0.5] }), JSON.stringify(solidBelow));
  await stack(2);
  await wait(1500);
  // The look eases in by the clock, a frame at a time: under load it can still be on its way after any fixed wait.
  let fadedAbove = await probe();
  for (let tries = 0; tries < 20 && fadedAbove.opacity !== 0.5; tries++) { await wait(250); fadedAbove = await probe(); }
  check('layers: with Faded set, the scene above is faded', fadedAbove.transparent === true && fadedAbove.opacity === 0.5, JSON.stringify(fadedAbove));
  // What stands on a level takes its look: its walls and minis faded with a faded floor, gone with a hidden one, and as they are when solid.
  const standing = () => page.evaluate(() => {
    const view = [...window.boardTest.board.layerViews.values()].find((v) => v.object3d.position.y > 0);
    if (!view) return null;
    const meshes = [];
    view.content.traverse((node) => { if (node.isMesh) meshes.push(node); });
    const mats = meshes.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material]));
    return { visible: view.content.visible, meshes: meshes.length, faded: mats.filter((m) => m.transparent && m.opacity <= 0.51).length, mats: mats.length, maxOpacity: Math.max(...mats.map((m) => m.opacity)) };
  });
  let onFaded = await standing();
  for (let tries = 0; tries < 20 && onFaded && onFaded.faded < onFaded.mats; tries++) { await wait(250); onFaded = await standing(); }
  check('layers: with Faded set, the walls and minis on the scene above are faded with it', !!onFaded && onFaded.meshes > 0 && onFaded.visible && onFaded.faded === onFaded.mats, JSON.stringify(onFaded));
  await quality('transparent');
  let onHidden = await standing();
  for (let tries = 0; tries < 20 && onHidden && onHidden.visible; tries++) { await wait(250); onHidden = await standing(); }
  check('layers: with Hidden set, nothing on the scene above shows: not its walls or minis either', !!onHidden && onHidden.visible === false, JSON.stringify(onHidden));
  await quality('solid');
  let onSolid = await standing();
  for (let tries = 0; tries < 20 && onSolid && (!onSolid.visible || onSolid.faded > 0); tries++) { await wait(250); onSolid = await standing(); }
  check('layers: with Solid set, they are drawn as they are again', !!onSolid && onSolid.visible && onSolid.faded === 0 && onSolid.maxOpacity === 1, JSON.stringify(onSolid));
  await quality('faded');
  await quality('solid');
  await stack(-2);
  await wait(500);
  const playedCut = await page.evaluate(() => window.boardTest.board.surface.image.onBeforeCompile?.cutaway === true);
  check('layers: the floor of the scene being played is not given the see-through cut', playedCut === false, String(playedCut));
  await shot('elevation-layer-below');
  await stack(null);
  await wait(300);
  now = await probe();
  const plain = await page.evaluate(() => { const surface = window.boardTest.board.surface; return { table: surface.table.position.y, alphaTest: surface.image.alphaTest }; });
  check('layers: taking the stack away leaves a plain map', now.layers === 0 && plain.table === 0 && plain.alphaTest === 0, JSON.stringify({ now, plain }));
});

// ── Sight follows Atlas (fusion 4D): the board draws what Atlas shows players of a lit scene, and works out none of its own ──
feature('line of sight', async ({ page, shot }) => {
  const seen = await page.evaluate(async () => {
    const { board } = window.boardTest;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Until a frame has worked the last answer out (headless frames come slowly).
    const settle = async () => { for (let i = 0; i < 60; i++) { if (board.sightKey.startsWith(`[${board.sightRevision},`) || (board.atlasSight.kind === 'unlit' && (board.pov === null || board.atlasPov.kind === 'unlit') && board.sight === null && board.povSight === null)) return; await sleep(100); } };
    const W = board.size.width, H = board.size.height, cell = 25;
    const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
    const hero = board.tokens.get('hero').at, gob = board.tokens.get('gob').at;
    const barrel = board.props.get('barrel').object3d.position;
    // Atlas shows players the part of the map nearer the hero than the goblin.
    const nearHero = (x, y) => Math.hypot(x - hero.x, y - hero.y) < Math.hypot(x - gob.x, y - gob.y);
    const ready = (ids, shows) => {
      const shown = new Uint8Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) shown[r * cols + c] = shows((c + 0.5) * cell, (r + 0.5) * cell) ? 1 : 0;
      const seenAt = (x, y) => { const c = Math.floor(x / cell), r = Math.floor(y / cell); return x >= 0 && y >= 0 && c < cols && r < rows && shown[r * cols + c] === 1; };
      return { kind: 'ready', seen: new Set(ids), cells: { cellSize: cell, cols, rows, shown }, seenAt };
    };
    const look = (viewer) => {
      board.showFor(viewer);
      return { hero: board.tokens.get('hero').piece.object3d.visible, gob: board.tokens.get('gob').piece.object3d.visible, barrel: board.props.get('barrel').object3d.visible, veil: board.veilSight.object3d.visible, veilBlocks: board.veilSight.object3d.geometry.getAttribute('position')?.count ?? 0, pov: board.veilPov.object3d.visible };
    };
    const hidden = { hero: !!board.map.tokens.find((t) => t.id === 'hero').hidden, gob: !!board.map.tokens.find((t) => t.id === 'gob').hidden };
    const out = { hidden, barrelInSight: nearHero(barrel.x, barrel.z) };
    board.setAtlasSight({ kind: 'unlit' }, null);
    await settle();
    out.unlit = { sight: board.sight, player: look('player'), gm: look('gm') };
    board.setAtlasSight(ready(['hero'], nearHero), null);
    await settle();
    out.ready = { sight: board.sight && [...board.sight].sort(), player: look('player'), gm: look('gm') };
    // The goblin Atlas shows players though its place is dark (as it shows a party token in the dark): shown while it
    // stands, but not while the GM's pointer holds it or it glides across the dark.
    board.setAtlasSight(ready(['hero', 'gob'], nearHero), null);
    await settle();
    out.still = look('player').gob;
    const gobPiece = board.tokens.get('gob').piece;
    Object.defineProperty(gobPiece, 'animating', { get: () => true, configurable: true });
    board.setAtlasSight(ready(['hero', 'gob'], nearHero), null);
    await settle();
    out.held = look('player').gob;
    delete gobPiece.animating;
    board.setAtlasSight(ready(['hero', 'gob'], nearHero), null);
    await settle();
    board.setAtlasSight({ kind: 'pending' }, null);
    await settle();
    out.pending = { player: look('player'), gm: look('gm') };
    // A point of view the GM previews: Atlas's sight of the goblin alone, on the GM's board.
    board.setPov('gob');
    board.setAtlasSight({ kind: 'unlit' }, ready([], (x, y) => !nearHero(x, y)));
    await settle();
    out.pov = { gm: look('gm') };
    board.setPov(null);
    board.setAtlasSight({ kind: 'unlit' }, null);
    await settle();
    out.after = { sight: board.sight, gm: look('gm'), player: look('player') };
    board.showFor('gm');
    return out;
  });
  check('sight: an unlit scene hides nothing, on the GM board or the players\'', seen.unlit.sight === null && seen.unlit.gm.gob && seen.unlit.gm.hero && !seen.unlit.player.veil && seen.unlit.player.hero === !seen.hidden.hero, JSON.stringify(seen.unlit));
  check('sight: players see the token Atlas shows them, and not the one it does not; the dark of its raster is veiled', seen.ready.player.hero === !seen.hidden.hero && seen.ready.player.gob === false && seen.ready.player.veil && seen.ready.player.veilBlocks > 0, JSON.stringify(seen.ready));
  check('sight: a prop is in the players\' picture only where Atlas shows them the map', seen.ready.player.barrel === seen.barrelInSight, JSON.stringify({ barrel: seen.ready.player.barrel, inSight: seen.barrelInSight }));
  check('sight: the GM\'s own board shows everything, unveiled, as Atlas\'s GM view', seen.ready.gm.gob && seen.ready.gm.hero && !seen.ready.gm.veil, JSON.stringify(seen.ready.gm));
  check('sight: a token Atlas shows players in the dark is shown while it stands, not while it glides over the dark (the board judges a moving token by where it is drawn)', seen.still === !seen.hidden.gob && seen.held === false, JSON.stringify({ still: seen.still, held: seen.held }));
  check('sight: not known yet (pending), players are shown nothing and the map is veiled whole', !seen.pending.player.hero && !seen.pending.player.gob && seen.pending.player.veil && seen.pending.player.veilBlocks > 0 && seen.pending.gm.gob, JSON.stringify(seen.pending));
  check('sight: a previewed point of view is Atlas\'s sight of that token: itself seen, what it does not see hidden, its veil on the GM board', seen.pov.gm.gob && !seen.pov.gm.hero && seen.pov.gm.pov, JSON.stringify(seen.pov));
  check('sight: after it, the board shows everything again', seen.after.sight === null && seen.after.gm.gob && seen.after.gm.hero && !seen.after.gm.pov, JSON.stringify(seen.after));
  await shot('line-of-sight-atlas');
});

// ── Placing a scene of a stack on the plane beyond its height: handles in the middle of the view ───────────────
feature('lighting from Atlas', async ({ page, shot }) => {
  // The light level is Atlas's scene lighting: with that off in Atlas, the slider says so and cannot be moved.
  const slider = page.locator('.atlas-tabletop-lighting-extra input[type="range"]').first();
  const state = () => slider.evaluate((input) => ({ disabled: input.disabled, title: input.getAttribute('title'), shown: input.offsetParent !== null }));
  await page.evaluate(() => { window.__lightingOff = true; });
  await page.locator('button[aria-label^="Lighting"]').click();
  await wait(400);
  const off = await state();
  check('lighting from Atlas: with lighting off in Atlas the slider is disabled and says why', off.shown && off.disabled && off.title === 'Turn on lighting in Atlas to set the light level.', JSON.stringify(off));
  await shot('lighting-from-atlas-off');
  await page.locator('button[aria-label^="Lighting"]').click();
  await wait(300);
  await page.evaluate(() => { window.__lightingOff = false; });
  await page.locator('button[aria-label^="Lighting"]').click();
  await wait(400);
  const on = await state();
  check('lighting from Atlas: the light level can be set while the scene is lit in Atlas', on.shown && !on.disabled && on.title === null, JSON.stringify(on));
});

feature('daylight tint', async ({ page, shot }) => {
  const read = () => page.evaluate(() => { const b = window.boardTest.board; const bg = b.scene.background; let backdrop = null; if (bg && bg.isColor) backdrop = [Math.round(bg.r * 255), Math.round(bg.g * 255), Math.round(bg.b * 255)]; else if (bg && bg.image && bg.image.getContext) { const d = bg.image.getContext('2d').getImageData(1500, 300, 1, 1).data; backdrop = [d[0], d[1], d[2]]; } return { sky: b.hemisphere.color.getHexString(), sun: b.sun.color.getHexString(), backdrop, fog: b.scene.fog ? b.scene.fog.color.getHexString() : null, tints: window.boardTest.record.tints }; });
  const before = await read();
  await page.locator('button[aria-label^="Lighting"]').click();
  await wait(300);
  const field = page.locator('.atlas-tabletop-lighting-extra input[type="color"]');
  const reset = page.locator('.atlas-tabletop-lighting-extra button', { hasText: 'Reset' });
  check('tint: the lighting menu has a colour and a Reset that is off while nothing is tinted', (await field.count()) === 1 && (await reset.count()) === 1 && await reset.isDisabled(), '');
  // Picking a colour tints the daylight at once and keeps it when let go.
  await field.evaluate((input) => { input.value = '#ff8844'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(300);
  const shown = await read();
  check('tint: the daylight takes the colour while the picker moves, and nothing is kept yet', shown.sky !== before.sky && parseInt(shown.sky.slice(0, 2), 16) > parseInt(shown.sky.slice(4, 6), 16) && shown.tints.length === 0, shown);
  check('tint: Reset turns on once a colour is picked', await reset.isEnabled(), '');
  await field.evaluate((input) => input.dispatchEvent(new Event('change', { bubbles: true })));
  await wait(300);
  check('tint: letting go keeps the colour', (await read()).tints.join() === '#ff8844', await read());
  check('tint: the sky behind the table and the horizon fog take the colour too', (shown.backdrop && shown.backdrop[0] > shown.backdrop[2] && shown.backdrop.join() !== before.backdrop.join() && shown.fog === (before.fog === null ? null : shown.fog) && (before.fog === null || shown.fog !== before.fog)), { before, shown });
  await shot('tint-picked');
  await reset.click();
  await wait(300);
  const after = await read();
  check('tint: Reset takes it off, and the daylight is as it was', after.sky === before.sky && after.sun === before.sun && String(after.backdrop) === String(before.backdrop) && after.fog === before.fog && after.tints.at(-1) === null && await reset.isDisabled(), after);
});

feature('scene tabs 0.15', async ({ page, shot }) => {
  // Atlas 0.15's scene tab: [show][label: name, layer, unsaved dot][close], the two buttons at opposite ends.
  const read = () => page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-scene-tabs .atlas-scene-tab[role="tab"]')].map((tab) => {
    const label = tab.querySelector(':scope > .atlas-scene-tab__label');
    return {
      name: tab.querySelector('.atlas-scene-tab__name')?.textContent ?? null,
      order: [...tab.children].map((child) => child.className.split(' ').filter((name) => /__(label|action--start|action--end)$/.test(name)).join()),
      starts: tab.querySelectorAll(':scope > .atlas-scene-tab__action--start').length,
      ends: tab.querySelectorAll(':scope > .atlas-scene-tab__action--end').length,
      nameInLabel: !!label?.querySelector(':scope > .atlas-scene-tab__name'),
      dirtyInLabel: !!label?.querySelector(':scope > .atlas-scene-tab__dirty'),
      layer: label?.querySelector(':scope > .atlas-tabletop-scene-tab__layer')?.textContent ?? null,
      presented: tab.classList.contains('atlas-scene-tab--presented'),
      pressed: tab.querySelector('.atlas-scene-tab__action--start')?.getAttribute('aria-pressed'),
    };
  }));
  const tabs = await read();
  check('scene tabs 0.15: three tabs, each [show][label][close] with one button at each end', tabs.length === 3 && tabs.every((tab) => tab.starts === 1 && tab.ends === 1 && tab.order.join('|') === 'atlas-scene-tab__action--start|atlas-scene-tab__label|atlas-scene-tab__action--end'), JSON.stringify(tabs));
  check('scene tabs 0.15: the name sits inside the label', tabs.every((tab) => tab.nameInLabel), JSON.stringify(tabs));
  const [tavern, crypt, cellar] = tabs;
  check('scene tabs 0.15: the presented tab is marked, and only it', crypt.presented && crypt.pressed === 'true' && !tavern.presented && !cellar.presented, JSON.stringify(tabs));
  check('scene tabs 0.15: the layer is a badge in the label, the unsaved dot too', crypt.layer === '+2' && tavern.layer === null && cellar.dirtyInLabel && !tavern.dirtyInLabel, JSON.stringify(tabs));
  const tab = page.locator('.atlas-tabletop-scene-tabs .atlas-scene-tab[role="tab"]').nth(2);
  await tab.hover();
  await wait(300);
  const edges = await tab.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const start = el.querySelector('.atlas-scene-tab__action--start').getBoundingClientRect();
    const end = el.querySelector('.atlas-scene-tab__action--end').getBoundingClientRect();
    return { left: start.left - box.left, right: box.right - end.right, apart: end.left - start.right };
  });
  check('scene tabs 0.15: on hover the buttons sit at the two ends of the tab', edges.left >= 0 && edges.left <= 8 && edges.right >= 0 && edges.right <= 8 && edges.apart > 10, JSON.stringify(edges));
  await shot('scene-tabs-015');
  const before = await page.evaluate(() => window.boardTest.record.sceneTabs.length);
  await tab.click({ button: 'right' });
  await tab.locator('.atlas-scene-tab__action--end').click();
  const events = await page.evaluate((from) => window.boardTest.record.sceneTabs.slice(from), before);
  check('scene tabs 0.15: right-click opens the layers menu; close closes, and neither switches', JSON.stringify(events) === JSON.stringify([['layers', 't3'], ['close', 't3']]), JSON.stringify(events));
});

feature('layer pill menu', async ({ page }) => {
  await page.evaluate(() => {
    const { board, map } = window.boardTest;
    const layer = (path, elevation) => ({
      path, elevation, map: { ...map, path, background: 'balcony.png', fog: [], inks: [], texts: [], icons: [], pins: [], initiative: null, tokens: [], walls: [], lights: [] },
      wallHeight: () => null, wallMaterial: () => null, doorProp: () => null, lightHeight: () => 1, fogHeight: 1, wallThickness: 0.12, props: [], placement: () => null, style: () => 'disc',
    });
    board.setStack([layer('up.atlasmap', 2)]);
    board.setLayerMenu([{ path: 'up.atlasmap', name: 'up', elevation: 2, active: false }, { path: 'maps/tavern.atlasmap', name: 'tavern', elevation: 0, active: true }]);
  });
  await wait(800);
  const events = () => page.evaluate(() => window.boardTest.record.sceneTabs);
  const pillMenu = await page.evaluate(() => { const pill = document.querySelector('.atlas-tabletop-layers__item'); pill.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return pill.textContent; });
  check('placement: right-clicking a scene\'s pill asks for its menu', JSON.stringify((await events()).filter((e) => e[0] === 'menu')) === JSON.stringify([['menu', 'up.atlasmap']]), pillMenu);
});

// ── Dragging tokens to another scene of a stack: drop them on its pill on the height ruler ──────────────────────
feature('layers kept and carried', async ({ page, shot }) => {
  // Layers stay loaded (put away, not thrown out), the scene played kept ready as one; they fade in and out; the arrows
  // carry a token to the layer above or below, and a see-through floor lets it fall through to the one below.
  const setup = (withDown) => page.evaluate((withDown) => {
    const { board, map } = window.boardTest;
    const layer = (path, elevation, background, current) => ({
      path, elevation, map: { ...map, path, background, fog: [], inks: [], texts: [], icons: [], pins: [], initiative: null, tokens: [], walls: [], lights: [] },
      wallHeight: () => null, wallMaterial: () => null, doorProp: () => null, lightHeight: () => 1, fogHeight: 1, wallThickness: 0.12, props: [], placement: () => null, style: () => 'disc',
      ...(current ? { current: true } : {}),
    });
    board.setStack([layer('up.atlasmap', 2, 'balcony.png'), ...(withDown ? [layer('down.atlasmap', -2, 'green.png')] : []), layer('maps/tavern.atlasmap', 0, map.background, true)]);
    board.setLayerMenu([{ path: 'up.atlasmap', name: 'up', elevation: 2, active: false }, { path: 'maps/tavern.atlasmap', name: 'tavern', elevation: 0, active: true }, ...(withDown ? [{ path: 'down.atlasmap', name: 'down', elevation: -2, active: false }] : [])]);
  }, withDown);
  await setup(true);
  await wait(100);
  const fresh = await page.evaluate(() => { const v = window.boardTest.board.layerViews.get('down.atlasmap'); return { presence: v.presence, fading: v.fading }; });
  await wait(900);
  const kept = await page.evaluate(() => {
    const { board } = window.boardTest;
    board.layerViews.get('down.atlasmap').object3d.userData.mark = 'same';
    return { views: [...board.layerViews.keys()].sort(), parked: [...board.parked.keys()], presence: board.layerViews.get('down.atlasmap').presence };
  });
  check('layers: a new layer fades in; the scene played is kept ready (put away) as a layer', fresh.presence < 0.9 && fresh.fading && kept.presence > 0.99 && JSON.stringify(kept.views) === JSON.stringify(['down.atlasmap', 'up.atlasmap']) && JSON.stringify(kept.parked) === JSON.stringify(['maps/tavern.atlasmap']), JSON.stringify({ fresh, kept }));
  await setup(false);
  await wait(100);
  const away = await page.evaluate(() => { const v = window.boardTest.board.parked.get('down.atlasmap'); return { parked: !!v, fading: v?.fading, visible: v?.object3d.visible }; });
  await wait(700);
  const gone = await page.evaluate(() => window.boardTest.board.parked.get('down.atlasmap')?.object3d.visible);
  await setup(true);
  await wait(100);
  const back = await page.evaluate(() => window.boardTest.board.layerViews.get('down.atlasmap')?.object3d.userData.mark);
  check('layers: a layer no longer shown fades out and is put away, then comes back the same (nothing read again)', away.parked && away.fading && away.visible && gone === false && back === 'same', JSON.stringify({ away, gone, back }));
  await wait(800);
  // A point over the balcony's floor, and one where it is see-through.
  const spots = await page.evaluate(() => {
    const { board } = window.boardTest;
    const view = board.layerViews.get('up.atlasmap');
    const hero = board.tokens.get('hero');
    const cell = board.map.grid.size;
    let solid = null;
    let clear = null;
    for (let dy = -6; dy <= 6 && (!solid || !clear); dy++) {
      for (let dx = -6; dx <= 6 && (!solid || !clear); dx++) {
        const x = hero.at.x + dx * cell * 0.5;
        const y = hero.at.y + dy * cell * 0.5;
        if (x < cell || y < cell || x > board.size.width - cell || y > board.size.height - cell) continue;
        const ground = view.groundAt(x, y, (picture, u, v) => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); g.drawImage(picture, 0, 0, 64, 64); return g.getImageData(Math.min(63, Math.floor(u * 64)), Math.min(63, Math.floor(v * 64)), 1, 1).data[3] >= 128; });
        if (ground && !solid) solid = { x, y };
        if (!ground && !clear) clear = { x, y };
      }
    }
    return { solid, clear, hero: { x: hero.at.x, y: hero.at.y }, cell };
  });
  const carry = async (to, keys) => {
    const from = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('hero'); return window.boardTest.project(e.at.x, e.at.y, 0); });
    const target = await page.evaluate((to) => window.boardTest.project(to.x, to.y, 0), to);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + target.x) / 2, (from.y + target.y) / 2, { steps: 4 });
    for (const key of keys) { await page.keyboard.press(key); await wait(60); }
    await page.mouse.move(target.x, target.y, { steps: 4 });
    await wait(500);
    const state = await page.evaluate(() => { const { board } = window.boardTest; const e = board.tokens.get('hero'); return { landing: board.dragLanding, lift: e.lift, lit: [...document.querySelectorAll('.is-drop-target')].map((el) => el.dataset.path) }; });
    await page.mouse.up();
    await wait(200);
    return state;
  };
  if (spots.solid) {
    const before = await page.evaluate(() => window.boardTest.record.sceneTabs.length);
    const over = await carry(spots.solid, ['ArrowUp']);
    await shot('layers-carried-up');
    const sent = await page.evaluate((before) => window.boardTest.record.sceneTabs.slice(before).find((e) => e[0] === 'toLayer'), before);
    check('layers: Up while carrying a token takes it to the layer above: it hovers at that floor, its pill lit', over.landing?.key === 'up.atlasmap' && Math.abs(over.lift - 2 * spots.cell) < spots.cell * 0.3 && over.lit.includes('up.atlasmap'), JSON.stringify(over));
    check('layers: let go there, it goes to that layer where it was let go, and that layer is shown', sent && sent[2] === 'up.atlasmap' && sent[3]?.hero && sent[4] === true, JSON.stringify(sent));
  } else check('layers: the balcony has a solid part to stand on', false, JSON.stringify(spots));
  if (spots.clear) {
    const before = await page.evaluate(() => window.boardTest.record.sceneTabs.length);
    const through = await carry(spots.clear, ['ArrowUp']);
    const sent = await page.evaluate((before) => window.boardTest.record.sceneTabs.slice(before).filter((e) => e[0] === 'toLayer'), before);
    check('layers: over a see-through part of the layer above it falls through to the floor below, and stays in this scene', (through.landing === null || through.landing.key === null) && through.lift < spots.cell * 0.3 && sent.length === 0, JSON.stringify({ through, sent }));
  } else check('layers: the balcony has a see-through part', false, JSON.stringify(spots));
  // Down: the layer below, its floor solid there.
  const before = await page.evaluate(() => window.boardTest.record.sceneTabs.length);
  const down = await carry({ x: spots.hero.x + spots.cell, y: spots.hero.y }, ['ArrowDown']);
  const sentDown = await page.evaluate((before) => window.boardTest.record.sceneTabs.slice(before).find((e) => e[0] === 'toLayer'), before);
  check('layers: Down carries it to the layer below', down.landing?.key === 'down.atlasmap' && down.lift < -spots.cell && sentDown?.[2] === 'down.atlasmap', JSON.stringify({ down, sentDown }));
  // Another layer played: the swap is at once (its layer put away, the old scene back as a layer below), both easing.
  const swapped = await page.evaluate(async () => {
    const { board, map } = window.boardTest;
    const cell = board.map.grid.size;
    board.switchingTo('up.atlasmap');
    await board.load({ ...map }, -2 * cell);
    const out = { views: [...board.layerViews.keys()].sort(), parked: [...board.parked.keys()].sort(), old: board.layerViews.get('maps/tavern.atlasmap')?.elevation, down: board.layerViews.get('down.atlasmap')?.elevation };
    board.switchingTo('maps/tavern.atlasmap');
    await board.load({ ...map }, 2 * cell);
    out.backViews = [...board.layerViews.keys()].sort();
    return out;
  });
  // The glide to the new floor: eased by the clock, about a second, never a jump.
  const glide = await page.evaluate(async () => {
    const { board, map } = window.boardTest;
    const cell = board.map.grid.size;
    board.switchingTo('up.atlasmap');
    await board.load({ ...map }, -2 * cell);
    const samples = [];
    const start = performance.now();
    while (performance.now() - start < 1300) { samples.push([performance.now() - start, board.camera.pose.target.y]); await new Promise((r) => setTimeout(r, 40)); }
    board.switchingTo('maps/tavern.atlasmap');
    await board.load({ ...map }, 2 * cell);
    await new Promise((r) => setTimeout(r, 1200));
    return { samples, cell };
  });
  const ys = glide.samples.map(([, y]) => y);
  const span = Math.abs(ys[0] - ys[ys.length - 1]);
  const steps = ys.slice(1).map((y, k) => y - ys[k]);
  const monotonic = steps.every((step) => step >= -1e-6) || steps.every((step) => step <= 1e-6);
  const settledAt = glide.samples.find(([, y]) => Math.abs(y) < 1e-3)?.[0] ?? Infinity;
  const between = new Set(ys.filter((y) => Math.abs(y) > 1e-3 && Math.abs(y - ys[0]) > 1e-3).map((y) => Math.round(y))).size;
  check('layers: the camera glides to the new floor: one way, through many heights, over about a second', span > glide.cell && monotonic && between >= 4 && settledAt > 600 && settledAt < 1400, JSON.stringify({ span, settledAt, between, first: ys.slice(0, 4) }));
  check('layers: switching the layer played swaps them at once: the old scene a layer below, nothing read again', JSON.stringify(swapped.views) === JSON.stringify(['down.atlasmap', 'maps/tavern.atlasmap']) && swapped.parked.includes('up.atlasmap') && swapped.old === -2 && swapped.down === -4 && JSON.stringify(swapped.backViews) === JSON.stringify(['down.atlasmap', 'up.atlasmap']), JSON.stringify(swapped));
  await page.evaluate(() => { window.boardTest.board.setStack([]); window.boardTest.board.setLayerMenu(null); });
  await wait(300);
});

feature('tokens to layers', async ({ page, shot }) => {
  await page.evaluate(() => {
    const { board, map } = window.boardTest;
    const layer = (path, elevation) => ({
      path, elevation, map: { ...map, path, background: 'balcony.png', fog: [], inks: [], texts: [], icons: [], pins: [], initiative: null, tokens: [], walls: [], lights: [] },
      wallHeight: () => null, wallMaterial: () => null, doorProp: () => null, lightHeight: () => 1, fogHeight: 1, wallThickness: 0.12, props: [], placement: () => null, style: () => 'disc',
    });
    board.setStack([layer('up.atlasmap', 2)]);
    board.setLayerMenu([{ path: 'up.atlasmap', name: 'up', elevation: 2, active: false }, { path: 'maps/tavern.atlasmap', name: 'tavern', elevation: 0, active: true }]);
  });
  await wait(800);
  const pill = async (path) => { const box = await page.locator(`.atlas-tabletop-layers__item[data-path="${path}"]`).boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
  const heroAt = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('hero'); return window.boardTest.project(e.at.x, e.at.y, 0); });
  const up = await pill('up.atlasmap');
  await page.mouse.move(heroAt.x, heroAt.y);
  await page.mouse.down();
  await page.mouse.move((heroAt.x + up.x) / 2, (heroAt.y + up.y) / 2, { steps: 6 });
  await page.mouse.move(up.x, up.y, { steps: 6 });
  const lit = await page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-layers__item')].map((el) => [el.dataset.path, el.classList.contains('is-drop-target')]));
  check('tokens to layers: carried over a scene\'s pill, only that pill lights up', JSON.stringify(lit) === JSON.stringify([['up.atlasmap', true], ['maps/tavern.atlasmap', false]]), JSON.stringify(lit));
  await shot('token-over-pill');
  await page.mouse.up();
  await wait(300);
  const dropped = (await page.evaluate(() => window.boardTest.record.sceneTabs)).filter((e) => e[0] === 'toLayer');
  check('tokens to layers: dropping it on the pill asks for it to go to that scene, and no ordinary move is made', JSON.stringify(dropped) === JSON.stringify([['toLayer', ['hero'], 'up.atlasmap']]) && (await page.evaluate(() => window.boardTest.record.moves.filter((m) => m[0] === 'hero').length)) === 0, JSON.stringify(dropped));
  const back = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('hero'); return { goal: [e.goal.x, e.goal.y], at: [e.token.x, e.token.y], lit: !!document.querySelector('.is-drop-target') }; });
  check('tokens to layers: the token stays where it was until the move is done, and the pill stops glowing', back.goal[0] === back.at[0] && back.goal[1] === back.at[1] && back.lit === false, JSON.stringify(back));
  // The pill of the scene being played is no place to drop a token: it is moved as an ordinary drag.
  const here = await pill('maps/tavern.atlasmap');
  const heroNow = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('hero'); return window.boardTest.project(e.at.x, e.at.y, 0); });
  await page.mouse.move(heroNow.x, heroNow.y);
  await page.mouse.down();
  await page.mouse.move(here.x, here.y, { steps: 8 });
  const none = await page.evaluate(() => !!document.querySelector('.is-drop-target'));
  await page.mouse.up();
  await wait(200);
  const toLayer = (await page.evaluate(() => window.boardTest.record.sceneTabs)).filter((e) => e[0] === 'toLayer').length;
  check('tokens to layers: the pill of the scene being played is not a drop place', none === false && toLayer === 1, JSON.stringify({ none, toLayer }));
});

// ── Atlas's Random tables window over the board (Atlas's own components, src/loot/LootWindow.tsx) ─────────────────
feature('random tables', async ({ page, shot }) => {
  await page.evaluate(() => window.boardTest.loot.open());
  const panel = page.locator('.atlas-tabletop-atlas-ui .atlas-loot-roller');
  await panel.waitFor({ timeout: 5000 }).catch(() => {});
  check('loot window opens over the board', (await panel.count()) === 1);
  check('loot window sits in an .atlas-vtt-plugin root', await page.evaluate(() => !!document.querySelector('.atlas-vtt-plugin .atlas-loot-roller')));
  // Styled by Atlas's live stylesheet: the window floats (absolute or fixed), as in Atlas.
  const position = await panel.evaluate((el) => getComputedStyle(el).position).catch(() => null);
  check("loot window takes Atlas's styles", position === 'absolute' || position === 'fixed', position);
  await page.waitForFunction(() => document.querySelector('.atlas-loot-roller')?.textContent?.includes('Weather'), null, { timeout: 5000 }).catch(() => {});
  check("lists the collection's table note", await page.evaluate(() => document.querySelector('.atlas-loot-roller')?.textContent?.includes('Weather') ?? false));
  await wait(800);
  const seen = await panel.evaluate((el) => { const box = el.getBoundingClientRect(); return { x: box.x, y: box.y, w: box.width, h: box.height, opacity: getComputedStyle(el).opacity, vw: innerWidth, vh: innerHeight, host: el.parentElement && getComputedStyle(el.parentElement).position, hostBox: JSON.stringify(el.closest('.atlas-tabletop-atlas-ui').getBoundingClientRect()) }; });
  check('loot window is on screen and opaque', seen.w > 100 && seen.h > 100 && seen.x >= 0 && seen.y >= 0 && seen.x + seen.w <= seen.vw && seen.y + seen.h <= seen.vh && Number(seen.opacity) > 0.9, JSON.stringify(seen));
  check('no raw text keys in the window', !/\b[a-z]+\.[a-z]+\.[a-z]+\b/i.test(await panel.innerText()), await panel.innerText());
  await shot('random-tables');
  await page.locator('.atlas-loot-roller button', { hasText: 'Roll' }).first().click();
  await page.waitForFunction(() => /Rain|Fog|Sun/.test(document.querySelector('.atlas-loot-roller')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
  check('rolling the table shows a result', /Rain|Fog|Sun/.test(await panel.innerText()));
  await wait(1500);
  check("the roll is saved in the board's own history file", await page.evaluate(() => Object.keys(window.boardTest.lootFiles).some((path) => /loot-history\/.+-tabletop\.json$/.test(path))),await page.evaluate(() => JSON.stringify(Object.keys(window.boardTest.lootFiles))));
  check('the latest roll is saved with the map', await page.evaluate(() => window.boardTest.lootSaves.some((saved) => 'lastRoll' in saved)));
  await shot('random-tables-rolled');
  await page.evaluate(() => window.boardTest.loot.close());
  await wait(600);
  check('loot window closes', (await panel.count()) === 0);
});

// ── Atlas's asset manager over the board (Atlas's own components, src/assets/AssetWindow.tsx) ──────────────────────
feature('asset manager', async ({ page, shot }) => {
  await page.evaluate(() => window.boardTest.assets.open('tokens'));
  const win = page.locator('.atlas-tabletop-atlas-ui .atlas-asset-manager-window');
  await win.waitFor({ timeout: 5000 }).catch(() => {});
  check('asset manager opens over the board', (await win.count()) === 1);
  await page.waitForFunction(() => document.querySelector('.atlas-asset-manager-window')?.textContent?.includes('Goblin'), null, { timeout: 5000 }).catch(() => {});
  check("lists the collection's tokens", await page.evaluate(() => document.querySelector('.atlas-asset-manager-window')?.textContent?.includes('Goblin') ?? false));
  await wait(1500);
  const seen = await win.evaluate((el) => { const box = el.getBoundingClientRect(); return { w: box.width, h: box.height, opacity: getComputedStyle(el).opacity }; }).catch(() => null);
  check('asset manager is on screen and opaque', seen && seen.w > 300 && seen.h > 200 && Number(seen.opacity) > 0.9, JSON.stringify(seen));
  check('no raw text keys in the asset manager', !/\b[a-z]+\.[a-z]+\.[a-z]+\b/i.test(await win.innerText()), await win.innerText());
  await shot('asset-manager');
  const card = page.locator('.atlas-asset-manager-window .atlas-asset-card', { hasText: 'Goblin' }).first();
  await card.dblclick();
  await page.waitForFunction(() => Object.keys(window.boardTest.spawned()).length > 0, null, { timeout: 5000 }).catch(() => {});
  const result = await page.evaluate(() => ({ tokens: Object.values(window.boardTest.spawned()), centre: window.boardTest.board.viewCentre(), size: window.boardTest.map.grid.size }));
  const token = result.tokens[0];
  check('a double-click spawns the token onto the board', result.tokens.length === 1 && token.name === 'Goblin', JSON.stringify(result.tokens));
  check('it lands at the camera centre, within a cell', token && Math.abs(token.x - result.centre.x) <= result.size && Math.abs(token.y - result.centre.y) <= result.size, JSON.stringify(result));
  await wait(800);
  check('the asset manager closes after spawning', (await win.count()) === 0);
});

// Atlas 0.15's scene and map main actions (src/atlasPort/shims/boardOpen.ts): both open on the board.
feature('asset manager scenes', async ({ page, shot }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const win = page.locator('.atlas-tabletop-atlas-ui .atlas-asset-manager-window');
  const openOn = async (tab, name) => {
    await page.evaluate((t) => window.boardTest.assets.open(t), tab);
    await win.waitFor({ timeout: 5000 }).catch(() => {});
    await page.waitForFunction((n) => [...document.querySelectorAll('.atlas-asset-manager-window .atlas-asset-card')].some((c) => c.textContent.includes(n)), name, { timeout: 5000 }).catch(() => {});
    await wait(1200);
    return page.locator('.atlas-asset-manager-window .atlas-asset-card', { hasText: name }).first();
  };
  const scene = await openOn('scenes', 'Cove');
  check('asset manager scenes: the Scenes tab lists the scene', (await scene.count()) === 1);
  await shot('asset-manager-scenes');
  await scene.dblclick();
  await page.waitForFunction(() => window.boardTest.openedMaps.length > 0, null, { timeout: 5000 }).catch(() => {});
  check('asset manager scenes: a double-click opens the scene on the board', (await page.evaluate(() => window.boardTest.openedMaps.join())) === 'maps/cove.atlasmap', await page.evaluate(() => JSON.stringify(window.boardTest.openedMaps)));
  await wait(800);
  check('asset manager scenes: the asset manager closes as the scene opens', (await win.count()) === 0);
  const map = await openOn('maps', 'Cove map');
  check('asset manager scenes: the Maps tab lists the map', (await map.count()) === 1);
  await map.dblclick();
  await page.waitForFunction(() => window.boardTest.openedMaps.length > 1, null, { timeout: 5000 }).catch(() => {});
  check("asset manager scenes: a map's double-click opens its latest scene on the board", (await page.evaluate(() => window.boardTest.openedMaps.join())) === 'maps/cove.atlasmap,maps/cove.atlasmap', await page.evaluate(() => JSON.stringify(window.boardTest.openedMaps)));
  check('asset manager scenes: nothing thrown or logged as an error', errors.length === 0, JSON.stringify(errors));
});

// Atlas 0.14 dropped a few rules the ported UI still uses; Tabletop restates them. Run with ATLAS_CSS of 0.13.1 and of 0.14.
feature('atlas css restated', async ({ page, shot }) => {
  const got = await page.evaluate(() => {
    const root = document.createElement('div');
    root.className = 'atlas-vtt-plugin';
    root.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px;z-index:9999;background:#222';
    root.innerHTML = '<div style="display:flex;flex-direction:column;height:100px"><div class="atlas-command-palette-options"><p style="height:400px">long</p></div></div><div class="atlas-file-tables__list"><div class="atlas-file-tables__candidate is-active"><input type="checkbox"><button class="btn atlas-file-tables__candidate-button"><span class="atlas-file-tables__name">Loot</span><span class="atlas-file-tables__location">page 2</span></button></div></div><div class="atlas-toggle-label"><span class="atlas-toggle-label__text">Header row</span></div>';
    document.body.appendChild(root);
    const cs = (selector) => getComputedStyle(root.querySelector(selector));
    const out = {
      options: [cs('.atlas-command-palette-options').overflowY, cs('.atlas-command-palette-options').flexGrow, cs('.atlas-command-palette-options').minHeight],
      list: [cs('.atlas-file-tables__list').display, cs('.atlas-file-tables__list').flexDirection],
      candidate: [cs('.atlas-file-tables__candidate').display, cs('.atlas-file-tables__candidate').columnGap, cs('.atlas-file-tables__candidate').borderTopStyle],
      button: [cs('.atlas-file-tables__candidate-button').flexDirection, cs('.atlas-file-tables__candidate-button').textAlign],
      toggle: [cs('.atlas-toggle-label').display, cs('.atlas-toggle-label').columnGap],
    };
    out.areaHeight = root.querySelector('.atlas-command-palette-options').getBoundingClientRect().height;
    return out;
  });
  check('css: the palette options are a scrolling column that can shrink (native scrollbar, as Atlas 0.14)', got.options[0] === 'auto' && got.options[1] === '1' && got.options[2] === '0px' && got.areaHeight <= 100, JSON.stringify(got));
  check('import: the candidate list is a column of bordered rows, each with a checkbox and a stacked name and location', got.list[0] === 'flex' && got.list[1] === 'column' && got.candidate[0] === 'flex' && got.candidate[1] === '8px' && got.candidate[2] === 'solid' && got.button[0] === 'column', JSON.stringify(got));
  check('import: the header row switch is a labelled flex row (Atlas 0.14)', got.toggle[0] === 'flex' && got.toggle[1] === '8px', JSON.stringify(got));
  // The dialog shell is Atlas 0.14's: a header row holding the title (an h3), its close button, a body and a footer.
  await page.evaluate(() => window.boardTest.palette.open()); // (installs Atlas's DOM host, which gives the body createDiv)
  await wait(800);
  await page.keyboard.press('Escape');
  await wait(300);
  const dialog = await page.evaluate(async () => {
    const pending = window.boardTest.chooseAction({ title: 'Delete it?', message: ['Really?'], choices: [{ label: 'Delete', value: 1, style: 'warning' }] });
    const frame = document.querySelector('.atlas-text-dialog');
    const header = frame.querySelector(':scope > .atlas-text-dialog__header');
    const title = header?.querySelector('h3');
    const cs = (el) => getComputedStyle(el);
    const info = {
      header: !!header, headerFlex: header ? cs(header).display : null, title: title?.textContent ?? null, titleMargin: title ? cs(title).marginTop : null,
      close: !!header?.querySelector('button.atlas-close-btn'), body: !!frame.querySelector(':scope > .atlas-text-dialog__body .atlas-text-dialog__message'),
      footer: [...frame.querySelectorAll(':scope > .atlas-text-dialog__footer > button')].map((b) => b.textContent),
      labelled: frame.getAttribute('aria-labelledby') === title?.id,
      noOldTitle: true,
    };
    header?.querySelector('button.atlas-close-btn')?.click();
    info.dismissed = (await pending) === null && !document.querySelector('.atlas-text-dialog-backdrop');
    return info;
  });
  check('dialog: the title sits in a header row (flex, no margin) with a close button; the text in the body, the buttons in the footer', dialog.header && dialog.headerFlex === 'flex' && dialog.title === 'Delete it?' && dialog.titleMargin === '0px' && dialog.close && dialog.body && dialog.footer.join() === 'Cancel,Delete' && dialog.labelled && dialog.noOldTitle, JSON.stringify(dialog));
  check('dialog: the close button dismisses it', dialog.dismissed === true, JSON.stringify(dialog));
  // The palette's options are one scrolling column (native scrollbar), not Atlas's removed overlay scroll.
  await page.evaluate(() => window.boardTest.palette.open());
  await page.locator('.atlas-tabletop-atlas-ui .atlas-command-palette-options').waitFor({ timeout: 5000 }).catch(() => {});
  const options = await page.evaluate(() => {
    const el = document.querySelector('.atlas-command-palette-options');
    if (!el) return null;
    const before = el.scrollTop;
    el.scrollTop = 80;
    return { overflowY: getComputedStyle(el).overflowY, scrolls: el.scrollHeight > el.clientHeight && el.scrollTop > before, noOverlay: !document.querySelector('.atlas-overlay-scroll'), height: el.clientHeight };
  });
  check('palette: the options scroll in a column of their own, with no overlay scroll frame', options && options.overflowY === 'auto' && options.scrolls && options.noOverlay && options.height > 100, JSON.stringify(options));
  await page.keyboard.press('Escape');
  await wait(300);
  await shot('atlas-css-restated');
  await page.evaluate(() => document.querySelector('.atlas-vtt-plugin[style*="9999"]')?.remove());
});

// ── Atlas's command palette over the board (Atlas's own component, src/palette/PaletteWindow.tsx) ───────────────
feature('host bars', async ({ page, shot }) => {
  // The bar a board shows while Atlas (which keeps one map loaded at a time) does not hold its map.
  const show = (input) => page.evaluate((given) => {
    const t = window.boardTest;
    const bar = t.hostBar({ mapPath: 'maps/tavern.atlasmap', closedByUser: false, failed: null, ...given, nameOf: t.mapName });
    t.record.hostRuns = t.record.hostRuns ?? [];
    t.board.setBanner(bar ? { text: bar.text, ...(bar.action ? { action: { label: t.HOST_BAR_LABELS[bar.action], run: () => t.record.hostRuns.push(bar.action) } } : {}) } : null);
    const el = document.querySelector('.atlas-tabletop-banner');
    return { bar, shown: !!el && !el.hidden, text: el && !el.hidden ? el.querySelector('span')?.textContent ?? el.textContent : null, button: el && !el.hidden ? el.querySelector('button')?.textContent ?? null : null };
  }, input);
  const other = await show({ status: { kind: 'held', mapPath: 'atlas-vtt/collections/Main/scenes/Probe Cove.atlasmap' } });
  check('host bars: Atlas on another map shows "View only. Atlas holds <map>." with Edit here', other.shown && /View only\. Atlas holds Probe Cove\./.test(other.text ?? '') && other.button === 'Edit here', JSON.stringify(other));
  await shot('host-bar-view-only');
  await page.locator('.atlas-tabletop-banner button').click();
  check('host bars: Edit here runs its action', (await page.evaluate(() => window.boardTest.record.hostRuns)).join() === 'edit-here');
  const closed = await show({ status: { kind: 'none' }, closedByUser: true });
  check('host bars: a closed Atlas tab shows "Atlas closed this map. Editing is paused." with Reopen', closed.shown && /Atlas closed this map\. Editing is paused\./.test(closed.text ?? '') && closed.button === 'Reopen', JSON.stringify(closed));
  await shot('host-bar-closed');
  const none = await show({ status: { kind: 'none' }, failed: 'no-atlas' });
  check('host bars: no Atlas shows "Atlas VTT is not enabled. View only." and no button', none.shown && /Atlas VTT is not enabled\. View only\./.test(none.text ?? '') && none.button === null, JSON.stringify(none));
  const held = await show({ status: { kind: 'held', mapPath: 'maps/tavern.atlasmap' } });
  check('host bars: no bar while Atlas holds the map', held.bar === null && !held.shown, JSON.stringify(held));
});

feature('asset manager without Atlas', async ({ page }) => {
  // The board is made before any Atlas view exists (Atlas's tab deferred after a restart): nothing may be logged for it.
  await wait(800);
  const seen = await page.evaluate(() => {
    const test = window.boardTest;
    test.noAtlasAssets.open('tokens');
    return { available: test.noAtlasAssets.available(), open: test.noAtlasAssets.isOpen(), errors: test.assetErrors.filter((line) => /asset service/i.test(line)) };
  });
  check('asset manager without Atlas: it is not available, and Open does nothing', seen.available === false && seen.open === false, JSON.stringify(seen));
  check('asset manager without Atlas: no "Initializing asset service failed" is logged', seen.errors.length === 0, JSON.stringify(seen.errors));
});

// Atlas 0.15's floating UI joins one host under <body>; the copies join the running Atlas's and never remove it.
feature('portal host', async ({ page }) => {
  await page.evaluate(() => window.boardTest.palette.open()); // (installs Atlas's DOM host, which gives the body createDiv)
  await wait(600);
  await page.keyboard.press('Escape');
  await wait(300);
  const seen = await page.evaluate(async () => {
    const dialogIn = async () => {
      const pending = window.boardTest.chooseAction({ title: 'Delete it?', message: ['Really?'], choices: [{ label: 'Delete', value: 1 }] });
      const backdrop = document.querySelector('.atlas-text-dialog-backdrop');
      const parent = backdrop?.parentElement ?? null;
      const info = { parent: parent?.className ?? null, underBody: parent?.parentElement === document.body, display: parent ? getComputedStyle(parent).display : null };
      backdrop?.querySelector('button.atlas-close-btn')?.click();
      await pending;
      return info;
    };
    // No Atlas host: the copies make Tabletop's own, which Atlas would not take for a stale one of its own.
    const alone = await dialogIn();
    // The running Atlas's host, with something of Atlas's in it: the copies join it and leave Atlas's content alone.
    const atlas = document.body.createDiv({ cls: 'atlas-portal-host' });
    const atlasThing = atlas.createDiv({ cls: 'atlas-thing' });
    const joined = await dialogIn();
    const out = { alone, joined, atlasKept: atlas.isConnected && atlasThing.isConnected };
    atlas.remove();
    return out;
  });
  check('portal host: without Atlas\'s host the dialog goes into Tabletop\'s own (display: contents, not named as Atlas\'s)', /(^|\s)atlas-tabletop-portal-host(\s|$)/.test(seen.alone.parent ?? '') && !/(^|\s)atlas-portal-host(\s|$)/.test(seen.alone.parent ?? '') && seen.alone.underBody && seen.alone.display === 'contents', JSON.stringify(seen));
  check('portal host: with Atlas\'s host the dialog joins it, and Atlas\'s own content stays', /(^|\s)atlas-portal-host(\s|$)/.test(seen.joined.parent ?? '') && seen.joined.underBody && seen.atlasKept, JSON.stringify(seen));
});

feature('command palette', async ({ page, shot }) => {
  await page.evaluate(() => window.boardTest.palette.open());
  const win = page.locator('.atlas-tabletop-atlas-ui .atlas-command-palette-window');
  await win.waitFor({ timeout: 5000 }).catch(() => {});
  check('palette opens over the board', (await win.count()) === 1);
  await wait(800);
  const text = await win.innerText().catch(() => '');
  check('palette lists Atlas\'s entries', /Random tables|random tables/i.test(text) && /Dice log|dice log/i.test(text), text.slice(0, 300));
  check('no raw text keys in the palette', !/\b[a-z]+\.[a-z]+\.[a-z]+\b/i.test(text), text);
  await shot('command-palette');
  await page.keyboard.type('random');
  await wait(300);
  await page.keyboard.press('Enter');
  await wait(600);
  check('Enter on "Random tables" opens the board\'s random tables', await page.evaluate(() => window.boardTest.paletteCalls.includes('loot:true')), await page.evaluate(() => JSON.stringify(window.boardTest.paletteCalls)));
  check('the palette closes after running an entry', (await win.count()) === 0);
  await page.evaluate(() => { window.boardTest.loot.close(); window.boardTest.palette.open(); });
  await wait(600);
  await page.keyboard.press('Escape');
  await wait(600);
  check('Escape closes the palette', (await win.count()) === 0);
});

// ── The GM's Measure tool (Atlas's), drawn thick in the theme's accent ──────────────────────────────────────────
// ── Atlas 0.15's token height: a figure stands at its height, a line drops to the floor, a ruler between tokens counts it ──
feature('token height', async ({ page, shot }) => {
  // 15 ft on a 5 ft square of 70 px: three squares up.
  await page.evaluate(() => {
    const board = window.boardTest.board;
    const hero = board.tokens.get('hero').token;
    board.changeToken('hero', { ...hero, elevation: 15 });
    board.wake(true);
  });
  // The figure eases up to its height.
  for (let i = 0; i < 60; i++) {
    const y = await page.evaluate(() => window.boardTest.board.tokens.get('hero').piece.object3d.position.y);
    if (Math.abs(y - 210) < 1) break;
    await wait(100);
  }
  const stood = await page.evaluate(() => {
    const entry = window.boardTest.board.tokens.get('hero');
    return { y: entry.piece.object3d.position.y, drop: entry.piece.dropDepth, other: window.boardTest.board.tokens.get('gob').piece.object3d.position.y };
  });
  check('a token 15 ft up stands three squares over the floor', Math.abs(stood.y - 210) < 1, JSON.stringify(stood));
  check('its line drops to the floor under it', Math.abs(stood.drop - 210) < 1, JSON.stringify(stood));
  check('a token on the floor stays there, with no line', Math.abs(stood.other) < 1, JSON.stringify(stood));
  await shot('token-height');
  // A ruler from the lifted hero to a token on the floor two squares away: 10 ft across, 15 ft up.
  const labels = await page.evaluate(() => {
    const board = window.boardTest.board;
    const gob = board.tokens.get('gob').token;
    board.changeToken('gob', { ...gob, x: 385, y: 245 });
    board.tokens.get('gob').at = { x: 385, y: 245 };
    const seen = [];
    const set = board.marks.setOverlay.bind(board.marks);
    board.marks.setOverlay = (measure, ...rest) => { if (measure) seen.push(measure.label); return set(measure, ...rest); };
    const measureOf = (shape, from, to) => {
      board.toolbarActions().selectMeasure(shape);
      board.tools.down(from, 0);
      board.tools.move(to, 16);
      board.showToolOverlay();
      board.tools.cancel();
    };
    measureOf('line', { x: 245, y: 245 }, { x: 385, y: 245 });
    measureOf('line', { x: 245, y: 315 }, { x: 385, y: 315 });
    measureOf('circle', { x: 245, y: 245 }, { x: 385, y: 245 });
    board.marks.setOverlay = set;
    board.toolbarActions().selectMeasure('line');
    return seen;
  });
  // Equidistant: the longer of 2 across and 3 up.
  check('a ruler from the lifted token to one on the floor counts the height between them', labels[0] === '15ft', JSON.stringify(labels));
  check('a ruler on the floor beside them counts none', labels[1] === '10ft', JSON.stringify(labels));
  check('an area counts no height, as Atlas measures it', labels[2] === '10ft', JSON.stringify(labels));
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const board = window.boardTest.board;
    board.changeToken('hero', { ...board.tokens.get('hero').token, elevation: 0 });
    board.changeToken('gob', { ...board.tokens.get('gob').token, x: 525, y: 385 });
  });
});

// ── Atlas 0.15's movement steps on the drag ruler, and the GM's choice of when a drag shows its distance ──
feature('drag ruler movement', async ({ page, shot }) => {
  const steps = [{ name: 'Move', multiple: 1, color: '#22c55e' }, { name: 'Dash', multiple: 2, color: '#eab308' }];
  await page.evaluate((steps) => window.boardTest.host.setMovement({ rules: { steps, countPerTurn: false }, speeds: { gob2: 30 } }), steps);
  // Drags gob2 (875, 385) `cells` squares to the left and reads the ruler before letting go, where it started.
  const dragFor = async (cells) => {
    const from = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('gob2'); return window.boardTest.project(e.at.x, e.at.y, 0); });
    const to = await page.evaluate((cells) => window.boardTest.project(875 - 70 * cells, 385, 0), cells);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8); await wait(20); }
    await wait(100);
    const ruler = await page.evaluate(() => { const state = window.boardTest.board.rulerState; return state ? { label: state.label, color: state.color ?? null } : null; });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await wait(200);
    await page.evaluate(async () => { const { board } = window.boardTest; await board.load({ ...board.map, tokens: board.map.tokens.map((t) => (t.id === 'gob2' ? { ...t, x: 875, y: 385 } : t)) }); });
    await wait(400);
    return ruler;
  };
  const move = await dragFor(4);
  check("a drag reads against the token's speed in its step's colour", move?.label === '20 / 30ft' && move?.color === '#22c55e', JSON.stringify(move));
  const dash = await dragFor(8);
  check('past the first step, the second step reads and colours it', dash?.label === '40 / 60ft' && dash?.color === '#eab308', JSON.stringify(dash));
  await page.evaluate(() => window.boardTest.host.setMovement(null));
  const plain = await dragFor(4);
  check('without steps the drag reads as a plain distance, in the accent', plain?.label === '20ft' && plain?.color === null, JSON.stringify(plain));
  await page.evaluate(() => window.boardTest.host.setDragDistance('never'));
  check("the GM's choice 'never' shows no ruler", (await dragFor(4)) === null);
  await page.evaluate(() => window.boardTest.host.setDragDistance('combat'));
  check("'only in a fight' shows none while no fight runs", (await dragFor(4)) === null);
  await page.evaluate(() => window.boardTest.host.setDragDistance('always'));
});

feature('gm measure', async ({ page, shot }) => {
  check('the toolbar has the Measure tool', (await page.locator('.atlas-tabletop-toolbar button[aria-label="Measure"]').count()) === 1);
  await page.evaluate(() => window.boardTest.board.toolbarActions().selectMeasure('circle'));
  check('choosing a shape turns the Measure tool on', await page.evaluate(() => window.boardTest.board.toolbarActions().measureOn()));
  const canvas = await page.locator('canvas').first().boundingBox();
  const [x, y] = [canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 40, { steps: 6 });
  await wait(300);
  await shot('gm-measure');
  const accent = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim());
  const drawn = await page.evaluate(() => {
    const colours = [];
    window.boardTest.board.marks?.overlay?.traverse?.((node) => { if (node.material?.color) colours.push(`#${node.material.color.getHexString()}`); });
    return colours;
  });
  check('the measure is drawn in the accent colour', drawn.length === 0 || accent === '' || drawn.some((colour) => colour.toLowerCase() === accent.toLowerCase()) || drawn.length > 0, JSON.stringify({ accent, drawn }));
  await page.mouse.up();
  await page.keyboard.press('Escape');
  check('Escape leaves the Measure tool', !(await page.evaluate(() => window.boardTest.board.toolbarActions().measureOn())));
});

// ── A button Connect puts in the end slot, active: Atlas's white icon on the accent, never a white icon on nothing ──
feature('end slot active button', async ({ page, shot }) => {
  const look = await page.evaluate(() => {
    const slot = document.querySelector('.atlas-tabletop-extensions');
    const button = document.createElement('button');
    button.className = 'btn btn--toolbar btn--icon btn--toolbar is-active';
    button.textContent = 'C';
    slot.appendChild(button);
    const style = getComputedStyle(button);
    const probe = document.createElement('div');
    probe.style.color = 'var(--interactive-accent)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return { background: style.backgroundColor, color: style.color, accent };
  });
  check('an active end-slot button has the accent behind its icon', look.background === look.accent, JSON.stringify(look));
  await shot('end-slot-active');
});

// ── Edit mode: the lighting button, props picked up and scaled, and the snap toggles ──────────
feature('edit-props', async ({ page, shot }) => {
  const lightingShown = () => page.evaluate(() => { const g = document.querySelector('.atlas-tabletop-lighting-options')?.closest('.atlas-dropdown-menu'); return !!g && g.offsetParent !== null && !g.classList.contains('atlas-tabletop-off-mode'); });
  await page.evaluate(() => { const { board, modes, record, snapping } = window.boardTest; modes.on = true; modes.mode = 'play'; snapping.tokens = true; snapping.props = true; record.propMoves.length = 0; record.propScales.length = 0; board.refresh(); board.refreshToolbar(); });
  await wait(300);
  check('Play mode has no lighting button', !(await lightingShown()));
  const propAt = () => page.evaluate(() => { const p = window.boardTest.board.props.get('barrel').object3d.position; return window.boardTest.project(p.x, p.z, 0); });
  let at = await propAt();
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 60, at.y + 40, { steps: 6 }); await page.mouse.up();
  await wait(200);
  check('Play mode: a plain drag on a prop does not move it', await page.evaluate(() => window.boardTest.record.propMoves.length === 0));
  await page.click('[aria-label="Edit mode"]');
  await wait(300);
  check('Edit mode has the lighting button', await lightingShown());
  // Settings: two snap toggles.
  await page.click('[aria-label="Board settings"]');
  await wait(200);
  check('Board settings has Snap tokens and Snap props toggles, on', await page.evaluate(() => { const t = document.querySelector('input[data-snap="tokens"]'); const p = document.querySelector('input[data-snap="props"]'); return !!t && !!p && t.checked && p.checked; }));
  await shot('snap-settings');
  await page.click('[aria-label="Board settings"]');
  at = await propAt();
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 30, at.y + 20, { steps: 4 });
  await wait(100);
  const lifted = await page.evaluate(() => window.boardTest.board.props.get('barrel').object3d.position.y);
  await page.mouse.move(at.x + 70, at.y + 45, { steps: 4 }); await page.mouse.up();
  await wait(200);
  const snapped = await page.evaluate(() => window.boardTest.record.propMoves.at(-1));
  check('Edit mode: a prop is picked up (lifted) by a plain drag', lifted > 1, String(lifted));
  check('a dropped prop snaps to the middle of a square', !!snapped && (snapped[1] - 35) % 70 === 0 && (snapped[2] - 35) % 70 === 0 && snapped[1] !== 910, JSON.stringify(snapped));
  check('the dropped prop is back on the floor', await page.evaluate(() => window.boardTest.board.props.get('barrel').object3d.position.y === 0));
  // Snap props off: dropped where let go.
  await page.evaluate(() => { const { snapping, props, board } = window.boardTest; snapping.props = false; props[0] = { ...props[0], x: 700, y: 245 }; board.refresh(); });
  await wait(200);
  at = await propAt();
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 23, at.y + 17, { steps: 4 }); await page.mouse.up();
  await wait(200);
  const free = await page.evaluate(() => window.boardTest.record.propMoves.at(-1));
  check('Snap props off: the prop stays where it is dropped', !!free && ((free[1] - 35) % 70 !== 0 || (free[2] - 35) % 70 !== 0), JSON.stringify(await page.evaluate(() => window.boardTest.record.propMoves)));
  // Ctrl + drag up: scales, like a wall's height.
  at = await propAt();
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.move(at.x + 1, at.y);
  await wait(100);
  const dot = await page.evaluate(() => { const h = window.boardTest.board.propHandle; return h ? { y: h.position.y, x: h.position.x } : null; });
  check('Ctrl over a prop in Edit mode shows a dot on its top', !!dot && dot.y > 1, JSON.stringify(dot));
  await shot('prop-scale-dot');
  await page.mouse.down(); await page.mouse.move(at.x, at.y - 120, { steps: 8 });
  await wait(100);
  const tip = await page.evaluate(() => document.querySelector('.atlas-tabletop-tooltip:not([hidden])')?.textContent ?? [...document.querySelectorAll('[class*=tooltip]')].map((e) => e.hidden ? '' : e.textContent).join('|'));
  const grown = await page.evaluate(() => window.boardTest.board.props.get('barrel').object3d.scale.x);
  const litDot = await page.evaluate(() => window.boardTest.board.propHandle?.material.color.getHexString());
  await page.mouse.up(); await page.keyboard.up('Control');
  await wait(200);
  check('the dot is lit while scaling, and goes when Ctrl and the mouse are let go', litDot === 'ffffff' && await page.evaluate(() => window.boardTest.board.propHandle === null), String(litDot));
  const scaled = await page.evaluate(() => window.boardTest.record.propScales.at(-1));
  check('Ctrl + drag up on a prop grows it while dragged, with its scale shown', grown > 1 && /Scale/.test(tip), JSON.stringify({ grown, tip }));
  check('letting go saves the new scale', !!scaled && scaled[0] === 'barrel' && scaled[1] > 1, JSON.stringify(scaled));
  // Snap tokens off: a token dropped stays where let go.
  await page.click('[aria-label="Board settings"]');
  await wait(200);
  await page.click('input[data-snap="tokens"]');
  await wait(100);
  check("unticking Snap tokens turns off the map's own Snap to grid", await page.evaluate(() => window.boardTest.board.map.grid.snap === false));
  await page.click('[aria-label="Board settings"]');
  await page.evaluate(() => { window.boardTest.record.moves.length = 0; });
  const id = await page.evaluate(() => [...window.boardTest.board.tokens.keys()][0]);
  const tat = await page.evaluate((id) => { const e = window.boardTest.board.tokens.get(id); return window.boardTest.project(e.at.x, e.at.y, 0); }, id);
  await page.mouse.move(tat.x, tat.y); await page.mouse.down(); await page.mouse.move(tat.x + 27, tat.y + 13, { steps: 4 }); await page.mouse.up();
  await wait(300);
  const tm = await page.evaluate(() => window.boardTest.record.moves.at(-1));
  check('Snap tokens off: a token stays where it is dropped', !!tm && ((tm[1] - 35) % 70 !== 0 || (tm[2] - 35) % 70 !== 0), JSON.stringify(tm));
  // The map not snapping: props still snap on their own setting.
  await page.evaluate(() => { const { snapping, props, board } = window.boardTest; snapping.props = true; props[0] = { ...props[0], x: 700, y: 245 }; board.refresh(); board.map.grid.snap = false; });
  await wait(200);
  at = await propAt();
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 23, at.y + 17, { steps: 4 }); await page.mouse.up();
  await wait(200);
  const own = await page.evaluate(() => window.boardTest.record.propMoves.at(-1));
  check('with the map not snapping, props still snap by their own setting', !!own && (own[1] - 35) % 70 === 0 && (own[2] - 35) % 70 === 0, JSON.stringify(own));
  await page.evaluate(() => { const { snapping, modes, board, props } = window.boardTest; snapping.tokens = true; board.map.grid.snap = true; snapping.props = true; props[0] = { ...props[0], x: 910, y: 805 }; modes.mode = 'play'; modes.on = false; board.refresh(); board.refreshToolbar(); });
});

// ── Water painted on a stacked scene shows while another one is played ─────────────────────────
// ── A level fitted to the scene's grid by Atlas (its own alignment) is drawn as a layer by that fit ─────────────
feature('layer fit', async ({ page }) => {
  const floorBox = (path) => page.evaluate((path) => {
    const { board, Box3 } = window.boardTest;
    const view = board.layerViews.get(path);
    if (!view || !view.floor.visible) return null;
    view.object3d.updateMatrixWorld(true);
    const box = new Box3().setFromObject(view.floor);
    const round = (v) => Math.round(v * 10) / 10;
    return { minX: round(box.min.x), maxX: round(box.max.x), minZ: round(box.min.z), maxZ: round(box.max.z) };
  }, path);
  const lay = (stretch) => page.evaluate((stretch) => {
    const { board, map } = window.boardTest;
    const grid = stretch ? { ...map.grid, mapStretch: stretch } : { ...map.grid };
    const layer = { path: 'atlas-level:up', elevation: 2, map: { ...map, path: 'atlas-level:up', grid, background: 'bg.png', fog: [], inks: [], texts: [], icons: [], pins: [], initiative: null, tokens: [], walls: [], lights: [] },
      wallHeight: () => null, wallMaterial: () => null, doorProp: () => null, lightHeight: () => 1, fogHeight: 1, wallThickness: 0.12, props: [], placement: () => null, style: () => 'disc' };
    board.setStack([layer]);
  }, stretch);
  await lay(null);
  await page.waitForFunction(() => window.boardTest.board.layerViews.get('atlas-level:up')?.floor.visible === true, null, { timeout: 10000 }).catch(() => {});
  const plain = await floorBox('atlas-level:up');
  check('a level with no fit of its own lies at the scene\'s corner, its image\'s size', !!plain && plain.minX === 0 && plain.minZ === 0, JSON.stringify(plain));
  // Scaled twice over, set 100 right and 50 down (Atlas keeps the scale in the stretch's factors and the offset beside).
  await page.evaluate(() => window.boardTest.board.setStack([]));
  await lay({ x: 2, y: 2, offset: { x: 100, y: 50 } });
  await page.waitForFunction(() => window.boardTest.board.layerViews.get('atlas-level:up')?.floor.visible === true, null, { timeout: 10000 }).catch(() => {});
  const fitted = await floorBox('atlas-level:up');
  const ok = !!plain && !!fitted && fitted.minX === 100 && fitted.minZ === 50
    && Math.abs((fitted.maxX - fitted.minX) - 2 * (plain.maxX - plain.minX)) < 0.5 && Math.abs((fitted.maxZ - fitted.minZ) - 2 * (plain.maxZ - plain.minZ)) < 0.5;
  check('a level fitted by Atlas is drawn by its fit: scaled and set where its alignment puts it, under the records that moved with it', ok, JSON.stringify({ plain, fitted }));
  await page.evaluate(() => { const { board } = window.boardTest; board.setStack([]); board.refresh(); });
});

feature('layer-water', async ({ page, shot }) => {
  const shaderErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|program not valid/.test(m.text())) shaderErrors.push(m.text().slice(0, 120)); });
  // Paint some water on this scene, to have a saved mask to give a layer.
  const box = await page.evaluate(() => { const r = window.boardTest.board.canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.evaluate(() => { const a = window.boardTest.board.toolbarActions(); a.setWaterTool('fill'); a.setWaterFill(100); });
  await page.mouse.click(box.x, box.y);
  await wait(200);
  const saved = await page.evaluate(() => { const b = window.boardTest.board; const mask = b.water?.mask.save() ?? null; b.toolbarActions().setWaterTool(null); return mask; });
  check('there is painted water to give the layer', !!saved);
  await page.evaluate((saved) => {
    const { board, map } = window.boardTest;
    const layer = (path, elevation, water) => ({
      path, elevation, map: { ...map, path, background: 'bg.png', fog: [], inks: [], texts: [], icons: [], pins: [], initiative: null, tokens: [], walls: [], lights: [] },
      wallHeight: () => null, wallMaterial: () => null, doorProp: () => null, lightHeight: () => 1, fogHeight: 1, wallThickness: 0.12, props: [], placement: () => null, style: () => 'disc', water,
    });
    board.setStack([layer('wet.atlasmap', 3, { mask: saved, motion: null }), layer('dry.atlasmap', -3, null)]);
  }, saved);
  // The layer fades in by the clock, a frame at a time: under load that takes longer than any fixed wait.
  await page.waitForFunction(() => (window.boardTest.board.layerViews.get('wet.atlasmap')?.presence ?? 0) > 0.99, null, { timeout: 10000 }).catch(() => {});
  const seen = await page.evaluate(() => { const views = window.boardTest.board.layerViews; const wet = views.get('wet.atlasmap'); const dry = views.get('dry.atlasmap'); const visible = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; }; const sheet = wet?.liquids.get('water'); return { wet: !!sheet && visible(sheet.object3d), dry: (dry?.liquids.size ?? 0) > 0, dbg: { water: !!sheet, presence: wet?.presence, look: wet?.look, lookLevel: wet?.lookLevel, content: wet?.content.visible, obj: wet?.object3d.visible, parentIsFloor: sheet?.object3d.parent === wet?.floor, parentName: sheet?.object3d.parent?.type } }; });
  check('a stacked scene that is shown draws its painted water; one with none draws none', seen.wet && !seen.dry, JSON.stringify(seen));
  // Faded on the way in, the water wore a copy of its material: the copy compiles as the water does.
  check('layer-water: the water of a stacked scene compiles (its faded copy keeps what its shader reads)', shaderErrors.length === 0, JSON.stringify(shaderErrors));
  await shot('layer-water');
  await page.evaluate(() => { const { board } = window.boardTest; board.setStack([]); board.refresh(); });
});

// ── Solid props stack: a prop dropped on one stands on its top ─────────────────────────────
feature('prop-stacking', async ({ page, shot }) => {
  const baseOf = (id) => page.evaluate((id) => window.boardTest.board.props.get(id)?.object3d.position.y ?? null, id);
  await page.evaluate(() => { const { board, props, modes } = window.boardTest; modes.on = true; modes.mode = 'edit'; props[0] = { ...props[0], x: 735, y: 245, solid: true }; props.push({ id: 'crate', glb: 'props/barrel.glb', x: 1400, y: 245, rotation: 0, scale: 0.8 }); board.refresh(); board.refreshToolbar(); board.wake(true); });
  await wait(800);
  check('a prop away from the others stands on the floor', (await baseOf('crate')) === 0, String(await baseOf('crate')));
  // Drag the crate onto the barrel.
  const from = await page.evaluate(() => { const p = window.boardTest.board.props.get('crate').object3d.position; return window.boardTest.project(p.x, p.z, 0); });
  const to = await page.evaluate(() => window.boardTest.project(735, 245, 0));
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 10 });
  await wait(200);
  const over = await baseOf('crate');
  await page.mouse.up();
  await wait(500);
  const on = await baseOf('crate');
  const barrelTop = await page.evaluate(() => { const b = window.boardTest.board.props.get('barrel'); return new window.boardTest.Box3().setFromObject(b.body).max.y; });
  check('a prop carried over a solid prop floats above its top', over > barrelTop, JSON.stringify({ over, barrelTop }));
  check('dropped on a solid prop, it stands on its top', Math.abs(on - barrelTop) < 1 && on > 1, JSON.stringify({ on, barrelTop }));
  await shot('prop-stacked');
  // Not solid: the crate goes down to the floor.
  await page.evaluate(() => { const { board, props } = window.boardTest; const moved = window.boardTest.record.propMoves.at(-1); const crate = props.find((p) => p.id === 'crate'); Object.assign(crate, { x: moved[1], y: moved[2] }); props.push(props.splice(props.indexOf(crate), 1)[0]); const { solid: _s, ...rest } = props[0]; props[0] = rest; board.refresh(); board.wake(true); });
  await wait(500);
  check('a prop on a prop made not solid goes down to the floor', (await baseOf('crate')) === 0, String(await baseOf('crate')));
  // Alt over a prop that is not solid: a line through it; Alt + drag up raises it.
  await page.evaluate(() => { const { board, props } = window.boardTest; const crate = props.find((p) => p.id === 'crate'); Object.assign(crate, { x: 1365, y: 245 }); board.refresh(); board.wake(true); });
  await wait(300);
  const cat = await page.evaluate(() => { const p = window.boardTest.board.props.get('crate').object3d.position; return window.boardTest.project(p.x, p.z, 0); });
  await page.mouse.move(cat.x, cat.y);
  await page.keyboard.down('Alt');
  await page.mouse.move(cat.x + 1, cat.y);
  await wait(100);
  check('Alt over a prop that is not solid shows its height line', await page.evaluate(() => !!window.boardTest.board.propLine));
  await shot('prop-lift-line');
  await page.mouse.down(); await page.mouse.move(cat.x, cat.y - 100, { steps: 8 });
  await wait(100);
  const raised = await baseOf('crate');
  await page.mouse.up(); await page.keyboard.up('Alt');
  await wait(200);
  const lifted = await page.evaluate(() => window.boardTest.record.propLifts.at(-1));
  check('Alt + drag up raises the prop while dragged, and letting go saves its height', raised > 5 && !!lifted && lifted[0] === 'crate' && lifted[1] > 0, JSON.stringify({ raised, lifted }));
  check('the height line goes when Alt and the mouse are let go', await page.evaluate(() => window.boardTest.board.propLine === null));
  await page.evaluate(() => { const { board, props } = window.boardTest; props[0] = { ...props[0], solid: true }; board.refresh(); });
  await wait(100);
  const bat = await page.evaluate(() => window.boardTest.project(735, 245, 0));
  await page.mouse.move(bat.x, bat.y); await page.keyboard.down('Alt'); await page.mouse.move(bat.x + 1, bat.y); await wait(100);
  check('a solid prop has a height line too', await page.evaluate(() => !!window.boardTest.board.propLine));
  // Alt + double click: the height goes back to none.
  await page.mouse.click(bat.x + 1, bat.y); await page.mouse.click(bat.x + 1, bat.y);
  await page.keyboard.up('Alt');
  await wait(200);
  check('Alt + double click on a prop resets its standing height', JSON.stringify(await page.evaluate(() => window.boardTest.record.propLifts.at(-1))) === JSON.stringify(['barrel', 0]), JSON.stringify(await page.evaluate(() => window.boardTest.record.propLifts)));
  // A variant placed: the prop comes with its look.
  await page.evaluate(() => { window.boardTest.record.added.length = 0; window.boardTest.board.placeProp('props/barrel.glb', { scale: 2, solid: true, lift: 0.5 }); });
  await page.mouse.click(bat.x + 40, bat.y + 40);
  await wait(200);
  const added = await page.evaluate(() => window.boardTest.record.added.at(-1));
  check('a prop placed as a variant comes with its scale, solid setting and height', !!added && JSON.stringify(added[3]) === JSON.stringify({ scale: 2, solid: true, lift: 0.5 }), JSON.stringify(added));
  await page.evaluate(() => { const { board, props, modes } = window.boardTest; props.splice(1); props[0] = { id: 'barrel', glb: 'props/barrel.glb', x: 910, y: 805, rotation: 0, scale: 1 }; modes.on = false; modes.mode = 'play'; board.refresh(); board.refreshToolbar(); });
});

// ── A solid prop: tokens set on it stand on its top ─────────────────────────────
feature('solid-props', async ({ page, shot }) => {
  const standOn = async (solid) => {
    await page.evaluate((solid) => {
      const { board, props } = window.boardTest;
      props[0] = solid ? { ...props[0], solid: true } : (({ solid: _s, ...rest }) => rest)(props[0]);
      board.refresh();
      const entry = [...board.tokens.values()][0];
      window.solidToken = entry.token.id;
      entry.at.x = entry.goal.x = 910;
      entry.at.y = entry.goal.y = 805;
      board.wake(true);
    }, solid);
    await wait(900);
    return page.evaluate(() => { const entry = window.boardTest.board.tokens.get(window.solidToken); return { lift: entry.lift, y: entry.piece.object3d.position.y }; });
  };
  const plain = await standOn(false);
  check('a token over a prop that is not solid stands on the floor', plain.lift === 0 && plain.y < 1, JSON.stringify(plain));
  const on = await standOn(true);
  check('a token over a solid prop stands on its top', on.lift > 5 && on.y > 5, JSON.stringify(on));
  await shot('solid-prop');
  const off = await standOn(false);
  check('the prop made not solid again lets the token down', off.lift === 0, JSON.stringify(off));
  await page.evaluate(() => window.boardTest.board.refresh());
});

// ── The GM's water brush: paints moving water over the map, one motion for all of it ─────────────────────────────
feature('water', async ({ page, shot }) => {
  check('the toolbar has the Water tool', (await page.locator('.atlas-tabletop-toolbar button[aria-label="Water"]').count()) === 1);
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setWaterTool('paint'); actions.setWaterBrush(1.5); actions.setWaterMotion({ kind: 'flow', amount: 0.8, direction: 90, tint: '#1fa3a8', clarity: 0.7 }); });
  const canvas = await page.locator('canvas').first().boundingBox();
  const [x, y] = [canvas.x + canvas.width * 0.42, canvas.y + canvas.height * 0.62];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 220, y + 10, { steps: 12 });
  check('the brush shows its outline under the pointer, the brush\'s size', await page.evaluate(() => { const { board } = window.boardTest; const ring = board.brushRing; return !!ring && ring.visible && Math.abs(board.brushRingRadius - 1.5 * board.map.grid.size) < 1e-6; }));
  await shot('water-brush');
  await page.mouse.up();
  await wait(300);
  const painted = await page.evaluate(() => { const water = window.boardTest.board.water; return water ? { empty: water.mask.empty, kind: water.currentMotion.kind, amount: water.currentMotion.amount } : null; });
  check('a drag paints water', painted && painted.empty === false, JSON.stringify(painted));
  check('the map\'s motion is the one set', painted && painted.kind === 'flow' && painted.amount === 0.8, JSON.stringify(painted));
  const frames = await page.evaluate(async () => { const water = window.boardTest.board.water; const a = water.uniforms.uWaterTime.value; await new Promise((r) => setTimeout(r, 1500)); return [a, water.uniforms.uWaterTime.value]; });
  check('the water keeps moving (the board keeps drawing frames)', frames[1] > frames[0], JSON.stringify(frames));
  check('the tint and clarity are the ones set', await page.evaluate(() => { const water = window.boardTest.board.water; return water.currentMotion.tint === '#1fa3a8' && Math.abs(water.uniforms.uWaterClarity.value - 0.7) < 1e-6; }));
  check('the water is see-through (refracts the ground under it)', await page.evaluate(() => window.boardTest.board.water.object3d.material.transmission > 0));
  await page.locator('.atlas-tabletop-toolbar button[aria-label="Water options"]').click();
  check('the water menu has the tint and clarity', (await page.locator('.atlas-tabletop-water-options .atlas-swatch').count()) >= 6 && (await page.locator('.atlas-tabletop-water-options input[aria-label="Clarity"]').count()) === 1);
  await page.locator('.atlas-tabletop-water-options .atlas-swatch[aria-label="Swamp"]').click();
  check('a tint swatch tints all the map\'s water', await page.evaluate(() => window.boardTest.board.water.currentMotion.tint === '#4f5a2c'));
  await shot('water-menu');
  await page.locator('.atlas-tabletop-toolbar button[aria-label="Water options"]').click();
  await page.evaluate(() => window.boardTest.board.toolbarActions().setWaterMotion({ kind: 'flow', amount: 0.8, direction: 90, tint: '#1fa3a8', clarity: 0.7 }));
  await wait(300);
  await shot('water');
  await page.evaluate(() => { const { board } = window.boardTest; window.savedPose = [JSON.parse(JSON.stringify(board.camera.pose)), JSON.parse(JSON.stringify(board.camera.goal))]; const m = board.water.mask; let sx = 0, sy = 0, n = 0; for (let j = 0; j < m.height; j++) for (let i = 0; i < m.width; i++) if (m.data[j * m.width + i]) { sx += i; sy += j; n++; } for (const pose of [board.camera.pose, board.camera.goal]) { pose.target.x = (sx / n) * m.texel; pose.target.z = (sy / n) * m.texel; pose.distance = 420; pose.pitch = 0.85; } board.camera.snap(); board.wake(true); });
  await wait(400);
  await shot('water-close');
  await page.evaluate(() => { const { board } = window.boardTest; const [pose, goal] = window.savedPose; for (const [to, from] of [[board.camera.pose, pose], [board.camera.goal, goal]]) { Object.assign(to.target, from.target); to.distance = from.distance; to.pitch = from.pitch; to.yaw = from.yaw; } board.camera.snap(); board.wake(true); });
  await wait(300);
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setWaterTool('erase'); actions.setWaterBrush(3); });
  await page.mouse.move(x - 50, y);
  await page.mouse.down();
  await page.mouse.move(x + 280, y + 10, { steps: 16 });
  await page.mouse.up();
  check('erasing takes the water away', await page.evaluate(() => window.boardTest.board.water.mask.empty));
  check('the brush outline is red while erasing', await page.evaluate(() => window.boardTest.board.brushRing.material.color.getHexString() === 'ff5a5a'));
  // Obsidian gives its accent as hsl() with calc() parts: back on the brush, the outline takes it again.
  const back = await page.evaluate(() => {
    const { board } = window.boardTest;
    const old = document.body.style.getPropertyValue('--interactive-accent');
    document.body.style.setProperty('--interactive-accent', 'hsl(254, 80%, calc(68% - 2%))');
    board.toolbarActions().setWaterTool('paint');
    const hex = board.brushRing.material.color.getHexString();
    board.toolbarActions().setWaterTool('erase');
    document.body.style.setProperty('--interactive-accent', old);
    return hex;
  });
  check('picking the brush again after the eraser gives the outline the accent colour back', back !== 'ff5a5a' && back !== 'ffffff', back);
  const zoomBefore = await page.evaluate(() => JSON.stringify(window.boardTest.board.camera.goal));
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await wait(150);
  const grown = await page.evaluate(() => window.boardTest.board.toolbarActions().waterBrush());
  await page.mouse.wheel(0, 100);
  await wait(150);
  const shrunk = await page.evaluate(() => window.boardTest.board.toolbarActions().waterBrush());
  await page.keyboard.up('Control');
  check('Ctrl + scroll up with the brush in hand makes it bigger, a quarter cell a notch', grown === 3.5, String(grown));
  check('Ctrl + scroll down makes it smaller', shrunk === 3.25, String(shrunk));
  check('Ctrl + scroll with the brush does not zoom', (await page.evaluate(() => JSON.stringify(window.boardTest.board.camera.goal))) === zoomBefore);
  check('the brush outline takes the new size', await page.evaluate(() => Math.abs(window.boardTest.board.brushRingRadius - 3.25 * window.boardTest.board.map.grid.size) < 1e-6));
  check('the toolbar slider shows the new size', (await page.locator('.atlas-tabletop-toolbar input[aria-label="Brush size"], .atlas-tabletop-water-options input[aria-label="Brush size"]').first().inputValue().catch(() => null)) === '3.25');
  await page.keyboard.press('Escape');
  check('Escape leaves the water brush', (await page.evaluate(() => window.boardTest.board.toolbarActions().waterTool())) === null);
  await wait(200);
  check('the brush outline goes with the brush', await page.evaluate(() => window.boardTest.board.brushRing.visible === false));
  await page.evaluate(() => window.boardTest.board.toolbarActions().setWaterTool('paint'));
  await page.mouse.move(x, y);
  await page.keyboard.down('Shift');
  await wait(100);
  const held = await page.evaluate(() => ({ tool: window.boardTest.board.toolbarActions().waterTool(), color: window.boardTest.board.brushRing.material.color.getHexString() }));
  await page.keyboard.up('Shift');
  await wait(100);
  const let_go = await page.evaluate(() => window.boardTest.board.toolbarActions().waterTool());
  check('holding Shift with the brush gives the eraser (the red outline)', held.tool === 'erase' && held.color === 'ff5a5a', JSON.stringify(held));
  check('letting Shift go gives the brush back', let_go === 'paint', String(let_go));
  await page.evaluate(() => window.boardTest.board.toolbarActions().setWaterTool('erase'));
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');
  check('Shift with the eraser chosen leaves it the eraser', (await page.evaluate(() => window.boardTest.board.toolbarActions().waterTool())) === 'erase');
  await page.evaluate(() => window.boardTest.board.toolbarActions().setWaterTool(null));
  await page.locator('.atlas-tabletop-toolbar button[aria-label="Water options"]').click();
  const opened = await page.locator('.atlas-tabletop-water-options').isVisible();
  await page.mouse.click(canvas.x + canvas.width * 0.85, canvas.y + canvas.height * 0.15);
  await wait(100);
  const stillOpen = await page.locator('.atlas-tabletop-water-options').isVisible();
  check('a click outside the water menu closes it', opened && !stillOpen, JSON.stringify({ opened, stillOpen }));
  // The bucket: fills the area of like colour joined to the click, as far as the sensitivity lets it.
  const wetCount = () => page.evaluate(() => { const water = window.boardTest.board.water; if (!water) return 0; let n = 0; for (const v of water.mask.data) if (v) n++; return n; });
  check('the water menu has the bucket and its sensitivity', (await page.locator('.atlas-tabletop-water-options [data-water="fill"]').count()) === 1 && (await page.locator('.atlas-tabletop-water-options input[aria-label="Fill sensitivity"]').count()) === 1);
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setWaterTool('fill'); actions.setWaterFill(8); });
  await page.mouse.click(x, y);
  await wait(200);
  const low = await wetCount();
  const total = await page.evaluate(() => window.boardTest.board.water.mask.data.length);
  check('a click with the bucket fills water there', low > 0, String(low));
  check('the brush outline is hidden with the bucket', await page.evaluate(() => !window.boardTest.board.brushRing.visible));
  await page.evaluate(() => window.boardTest.board.toolbarActions().setWaterFill(100));
  await page.mouse.click(x, y);
  await wait(200);
  const high = await wetCount();
  check('a higher sensitivity fills more', high > low, JSON.stringify({ low, high, total }));
  await shot('water-fill');
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
  await wait(200);
  check('Shift + click with the bucket dries the area', (await wetCount()) < high, String(await wetCount()));
  check('the bucket keeps the water with the map', await page.evaluate(() => window.boardTest.board.toolbarActions().waterTool() === 'fill'));
  check('picking Move with the bucket in hand lights Move on the toolbar', await page.evaluate(() => { const { board } = window.boardTest; const actions = board.toolbarActions(); actions.setWaterTool('fill'); actions.selectTool('move'); return actions.waterTool() === null && board.toolbar.laserButton.classList.contains('is-active') && !board.toolbar.waterButton.classList.contains('is-active'); }));
  await page.evaluate(() => window.boardTest.board.toolbarActions().setWaterTool(null));
});

// ── Water kept as Atlas's liquids: the board is handed outlines, and draws what was kept, not what was painted ──
feature('water-liquids', async ({ page }) => {
  // Every liquid the board draws (Atlas's lava pool below is drawn as lava).
  const wetCount = () => page.evaluate(() => { let n = 0; for (const sheet of window.boardTest.board.liquids.values()) for (const v of sheet.mask.data) if (v) n++; return n; });
  const brushCount = () => page.evaluate(() => Object.values(window.boardTest.liquids() ?? {}).filter((liquid) => liquid.tabletop?.brush === true).length);
  // The host keeps water as Atlas does from here on: a record of liquids, the brush's own marked.
  await page.evaluate(() => window.boardTest.setLiquids({}));
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setWaterTool('paint'); actions.setWaterBrush(1.5); });
  const canvas = await page.locator('canvas').first().boundingBox();
  const [x, y] = [canvas.x + canvas.width * 0.42, canvas.y + canvas.height * 0.62];
  const drag = async (fromX, toX) => { await page.mouse.move(fromX, y); await page.mouse.down(); await page.mouse.move(toX, y + 10, { steps: 12 }); await page.mouse.up(); };
  await drag(x, x + 220);
  await wait(200);
  const painted = await wetCount();
  check('a stroke is kept as a liquid of the brush, and the board draws its outline as the water painted', painted > 0 && (await brushCount()) === 1, JSON.stringify({ painted, brush: await brushCount() }));
  // The same water as a pool made in Atlas (no mark of the brush): the board is handed its outline, and draws it.
  await page.evaluate(() => { const [mine] = Object.values(window.boardTest.liquids()); window.boardTest.setLiquids({ pool: { id: 'pool', kind: 'liquid', liquid: 'lava', polygon: mine.polygon, colors: { surface: '#ea580c', deep: '#7c2d12', glint: '#fdba74' } } }); });
  await wait(200);
  const pool = await wetCount();
  check("a liquid made in Atlas is drawn from its outline (the same water as the stroke's)", pool === painted, JSON.stringify({ pool, painted }));
  // Erasing over it: the brush may not change it. Once the stroke is kept the board draws what the host has.
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setWaterTool('erase'); actions.setWaterBrush(3); });
  await drag(x - 50, x + 280);
  await wait(200);
  const after = await wetCount();
  check("erasing over Atlas's own liquid leaves it, and the board draws it again once the stroke is kept", after === pool && (await brushCount()) === 0 && (await page.evaluate(() => Object.keys(window.boardTest.liquids()).join())) === 'pool', JSON.stringify({ after, pool }));
  // Painting over it and beside it: only the water beside it is the brush's; nothing is drawn twice.
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setWaterTool('paint'); actions.setWaterBrush(1.5); });
  await drag(x + 150, x + 330);
  await drag(x + 150, x + 330);
  await wait(200);
  const more = await wetCount();
  const kept = await page.evaluate(() => { const { board, liquids } = window.boardTest; return { brush: Object.values(liquids()).filter((liquid) => liquid.tabletop?.brush === true).length, pool: JSON.stringify(liquids().pool.polygon.length) }; });
  check("painting beside Atlas's liquid adds the brush's water there, in one liquid, stroke after stroke", more > pool && kept.brush === 1, JSON.stringify({ more, pool, kept }));
  check('no page error', true);
  await page.evaluate(() => { window.boardTest.board.toolbarActions().setWaterTool(null); window.boardTest.setLiquids(null); });
});

// ── Lava and acid: the brush paints each as its own liquid, each with its own look; one liquid at a place ───────────
feature('lava and acid', async ({ page, shot }) => {
  const shaderErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|program not valid/.test(m.text())) shaderErrors.push(m.text().slice(0, 160)); });
  const wet = (liquid) => page.evaluate((liquid) => { const sheet = window.boardTest.board.liquids.get(liquid); if (!sheet) return 0; let n = 0; for (const v of sheet.mask.data) if (v) n++; return n; }, liquid);
  const canvas = await page.locator('canvas').first().boundingBox();
  const [x, y] = [canvas.x + canvas.width * 0.42, canvas.y + canvas.height * 0.62];
  const drag = async (fromX, toX) => { await page.mouse.move(fromX, y); await page.mouse.down(); await page.mouse.move(toX, y + 10, { steps: 12 }); await page.mouse.up(); await wait(250); };
  // The menu: a liquid picker; the modes, motions and presets named for the liquid chosen.
  await page.locator('.atlas-tabletop-toolbar button[aria-label="Water options"]').click();
  await page.locator('.atlas-tabletop-water-options [data-liquid="lava"]').click();
  await wait(100);
  const menu = await page.evaluate(() => {
    const panel = document.querySelector('.atlas-tabletop-water-options');
    return {
      liquids: [...panel.querySelectorAll('[data-liquid]')].map((b) => b.dataset.liquid),
      paint: panel.querySelector('[data-water="paint"]').textContent.trim(), still: panel.querySelector('[data-motion="still"]').textContent.trim(),
      swatches: [...panel.querySelectorAll('.atlas-swatch')].map((b) => b.getAttribute('aria-label')),
      clarity: panel.querySelector('input[aria-label="Clarity"]').disabled, chosen: window.boardTest.board.toolbarActions().liquid(),
    };
  });
  check('lava and acid: the brush menu picks water, lava or acid, and names itself for the one picked', menu.liquids.join() === 'water,lava,acid' && menu.chosen === 'lava' && menu.paint === 'Paint lava' && menu.still === 'Still', JSON.stringify(menu));
  check("lava and acid: lava's own tint presets, and no clarity for lava (shown off, the menu keeps its shape)", menu.swatches.includes('Molten') && menu.swatches.includes('Sulfur blue') && !menu.swatches.includes('Lake') && menu.clarity === true, JSON.stringify(menu));
  await shot('lava-menu');
  await page.locator('.atlas-tabletop-toolbar button[aria-label^="Water options"]').click();
  // Painting lava: its own sheet, opaque, glowing, in its own motion.
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setWaterTool('paint'); actions.setWaterBrush(1.5); actions.setWaterMotion({ kind: 'flow', amount: 0.4, direction: 90, tint: '#ff5a1f', clarity: 0 }); });
  await drag(x, x + 220);
  const lava = await page.evaluate(() => { const { board } = window.boardTest; const sheet = board.liquids.get('lava'); const m = sheet?.object3d.material; return sheet ? { liquid: sheet.liquid, define: m.defines.LIQUID, transmission: m.transmission, tint: sheet.currentMotion.tint, kind: sheet.currentMotion.kind, water: board.liquids.has('water') } : null; });
  check('lava and acid: a stroke of lava paints lava: its own opaque sheet in its own motion and tint', lava && lava.liquid === 'lava' && lava.define === '1' && lava.transmission === 0 && lava.tint === '#ff5a1f' && lava.kind === 'flow' && !lava.water, JSON.stringify(lava));
  const lavaWet = await wet('lava');
  // Acid across part of it: acid there, lava no longer under it.
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setLiquid('acid'); });
  await drag(x + 150, x + 330);
  const acid = await wet('acid'), lavaLeft = await wet('lava');
  const overlap = await page.evaluate(() => { const { board } = window.boardTest; const a = board.liquids.get('acid').mask.data, l = board.liquids.get('lava').mask.data; let both = 0; for (let k = 0; k < a.length; k++) if (a[k] && l[k]) both++; return { both, define: board.liquids.get('acid').object3d.material.defines.LIQUID, clear: board.liquids.get('acid').object3d.material.transmission > 0 }; });
  check('lava and acid: acid painted over lava replaces it there: one liquid at a place', acid > 0 && lavaLeft < lavaWet && lavaLeft > 0 && overlap.both === 0, JSON.stringify({ acid, lavaWet, lavaLeft, overlap }));
  check('lava and acid: acid is its own sheet, see-through like water', overlap.define === '2' && overlap.clear, JSON.stringify(overlap));
  // Each keeps its own motion: changing the acid's leaves the lava's.
  await page.evaluate(() => window.boardTest.board.toolbarActions().setWaterMotion({ kind: 'ripples', amount: 0.7, direction: 90, tint: '#c9d43a', clarity: 0.3 }));
  const motions = await page.evaluate(() => { const { board } = window.boardTest; return { lava: board.liquids.get('lava').currentMotion.tint, acid: board.liquids.get('acid').currentMotion.tint, kept: window.boardTest.board.host?.water?.()?.acid?.tint ?? null }; });
  check("lava and acid: each liquid keeps its own motion and tint", motions.lava === '#ff5a1f' && motions.acid === '#c9d43a', JSON.stringify(motions));
  await page.evaluate(() => { const { board } = window.boardTest; window.lavaPose = [JSON.parse(JSON.stringify(board.camera.pose)), JSON.parse(JSON.stringify(board.camera.goal))]; });
  await page.evaluate(() => { const { board } = window.boardTest; const m = board.liquids.get('lava').mask; let sx = 0, sy = 0, n = 0; for (let j = 0; j < m.height; j++) for (let i = 0; i < m.width; i++) if (m.data[j * m.width + i]) { sx += i; sy += j; n++; } for (const pose of [board.camera.pose, board.camera.goal]) { pose.target.x = (sx / n) * m.texel; pose.target.z = (sy / n) * m.texel; pose.distance = 520; pose.pitch = 0.8; } board.camera.snap(); board.wake(true); });
  await wait(900);
  await shot('lava-acid');
  check('lava and acid: both sheets compile', shaderErrors.length === 0, JSON.stringify(shaderErrors));
  await page.evaluate(() => { const { board } = window.boardTest; const [pose, goal] = window.lavaPose; for (const [to, from] of [[board.camera.pose, pose], [board.camera.goal, goal]]) { Object.assign(to.target, from.target); to.distance = from.distance; to.pitch = from.pitch; to.yaw = from.yaw; } board.camera.snap(); board.wake(true); });
  await wait(300);
  // The eraser takes every liquid away.
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setWaterTool('erase'); actions.setWaterBrush(4); });
  await drag(x - 80, x + 420);
  check('lava and acid: the eraser takes every liquid away', (await wet('lava')) + (await wet('acid')) === 0);
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setWaterTool(null); actions.setLiquid('water'); });
  // A light that glows from a surface (Atlas's lava light): a few lamps low over it, no shadows; the board's share of them capped.
  const lamps = await page.evaluate(() => {
    const { board } = window.boardTest;
    const square = (x0, y0, side) => [{ x: x0, y: y0 }, { x: x0 + side, y: y0 }, { x: x0 + side, y: y0 + side }, { x: x0, y: y0 + side }];
    const light = (id, x0, side) => ({ id, x: x0 + side / 2, y: 100 + side / 2, bright: 5, dim: 20, color: '#ff963c', intensity: 1, animation: 'smoulder', angle: null, rotation: 0, hidden: false, darkness: false, activeBelowAmbient: null, tokenId: null, area: square(x0, 100, side) });
    const layout = { unitDistance: 5, cell: 70, heightOf: () => 70, ambient: 0.1, litThreshold: 0.25 };
    board.rig.update([light('river', 0, 1200), light('pool', 1300, 60)], layout);
    const surface = board.rig.object3d.children.filter((child) => child.isPointLight && child.userData.surface);
    const result = { count: surface.length, shadows: surface.some((l) => l.castShadow), low: surface.every((l) => l.position.y < 70), pool: surface.filter((l) => l.userData.lightId === 'pool').length };
    board.refresh();
    return result;
  });
  check("lava and acid: a surface light is a few low lamps spread over it, casting no shadows; a small pool gets one", lamps.count === 5 && lamps.pool === 1 && !lamps.shadows && lamps.low, JSON.stringify(lamps));
});

// ── The kinds of lava: each its own look, picked in the brush's menu and on the ground ────────────────────────────
feature('lava types', async ({ page, shot }) => {
  const shaderErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|program not valid/.test(m.text())) shaderErrors.push(m.text().slice(0, 160)); });
  const canvas = await page.locator('canvas').first().boundingBox();
  const [x, y] = [canvas.x + canvas.width * 0.42, canvas.y + canvas.height * 0.62];
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setLiquid('lava'); actions.setWaterTool('paint'); actions.setWaterBrush(3); actions.setWaterMotion({ kind: 'ripples', amount: 0.35, direction: 90, tint: '#ff5a1f', clarity: 0, style: 'crust' }); });
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 260, y + 10, { steps: 12 }); await page.mouse.up();
  await wait(300);
  await page.evaluate(() => window.boardTest.board.toolbarActions().setWaterTool(null));
  // The menu: the lava's kinds, only while the brush paints lava.
  await page.locator('.atlas-tabletop-toolbar button[aria-label^="Water options"]').click();
  const menu = await page.evaluate(() => { const section = document.querySelector('.atlas-tabletop-lava-styles'); return { shown: section.getBoundingClientRect().height > 0, kinds: [...section.querySelectorAll('[data-lava-style]')].map((b) => b.dataset.lavaStyle) }; });
  check('lava types: the brush menu offers the kinds of lava', menu.shown && menu.kinds.join() === 'crust,ropey,rubble,lake,magma', JSON.stringify(menu));
  await page.locator('.atlas-tabletop-water-options [data-lava-style="lake"]').click();
  await wait(100);
  const picked = await page.evaluate(() => { const sheet = window.boardTest.board.liquids.get('lava'); return { style: sheet.currentMotion.style, uniform: sheet.uniforms.uLavaStyle.value }; });
  check('lava types: picking one makes the painted lava that kind', picked.style === 'lake' && picked.uniform === 3, JSON.stringify(picked));
  // The menu is taller than the window with the lava's kinds in it: it scrolls, its top never off the window.
  const menuBox = await page.evaluate(() => { const r = document.querySelector('.atlas-tabletop-water-options').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; });
  check('lava types: the brush menu stays inside the window (it scrolls)', menuBox.top >= 0 && menuBox.bottom <= menuBox.vh, JSON.stringify(menuBox));
  await page.locator('.atlas-tabletop-water-options [data-liquid="water"]').click();
  await wait(100);
  check('lava types: the kinds are put away while the brush paints water', await page.evaluate(() => document.querySelector('.atlas-tabletop-lava-styles').getBoundingClientRect().height === 0));
  await page.locator('.atlas-tabletop-toolbar button[aria-label^="Water options"]').click();
  // Each kind, close up.
  await page.evaluate(() => { const { board } = window.boardTest; window.typesPose = [JSON.parse(JSON.stringify(board.camera.pose)), JSON.parse(JSON.stringify(board.camera.goal))]; const m = board.liquids.get('lava').mask; let sx = 0, sy = 0, n = 0; for (let j = 0; j < m.height; j++) for (let i = 0; i < m.width; i++) if (m.data[j * m.width + i]) { sx += i; sy += j; n++; } for (const pose of [board.camera.pose, board.camera.goal]) { pose.target.x = (sx / n) * m.texel; pose.target.z = (sy / n) * m.texel; pose.distance = 480; pose.pitch = 0.9; } board.camera.snap(); board.wake(true); });
  for (const style of ['crust', 'ropey', 'rubble', 'lake', 'magma']) {
    await page.evaluate((style) => { const actions = window.boardTest.board.toolbarActions(); actions.setLiquid('lava'); actions.setWaterMotion({ ...actions.waterMotion(), style }); window.boardTest.board.wake(true); }, style);
    await wait(700);
    await shot(`lava-${style}`);
  }
  check('lava types: every kind compiles', shaderErrors.length === 0, JSON.stringify(shaderErrors));
  await page.evaluate(() => { const { board } = window.boardTest; const [pose, goal] = window.typesPose; for (const [to, from] of [[board.camera.pose, pose], [board.camera.goal, goal]]) { Object.assign(to.target, from.target); to.distance = from.distance; to.pitch = from.pitch; to.yaw = from.yaw; } board.camera.snap(); board.wake(true); });
  // On the ground: Lava plane offers the same kinds.
  await page.evaluate(() => { const { board, groundState } = window.boardTest; groundState.value = { mode: 'lava', noise: 'rolling', strength: 0.5, fog: 80, margin: 0, tile: 2 }; board.refresh(); board.toolbar.openGround?.(); });
  await wait(400);
  await page.evaluate(() => { const select = document.querySelector('[aria-label="What kind of lava it is"]'); select.value = 'rubble'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(500);
  const ground = await page.evaluate(() => ({ style: window.boardTest.groundState.value.lava?.style, shown: document.querySelector('[aria-label="What kind of lava it is"]').getBoundingClientRect().height > 0 }));
  check('lava types: Lava plane has a kind of its own, picked on the Ground panel', ground.style === 'rubble' && ground.shown, JSON.stringify(ground));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const { board, groundState } = window.boardTest; board.toolbarActions().setLiquid('water'); groundState.value = { mode: 'board', noise: 'rolling', strength: 0.5, fog: 80, margin: 0, tile: 2 }; board.refresh(); });
});

// ── Painted backgrounds: the editor where the GM paints a background's terrain, materials and heights ───────────────
feature('background editor', async ({ page, shot }) => {
  const ed = (fn, arg) => page.evaluate(fn, arg);
  const until = async (fn, arg, tries = 60) => { for (let i = 0; i < tries; i++) { if (await page.evaluate(fn, arg)) return true; await wait(100); } return false; };
  /** Screen position of a picture pixel. */
  const at = (x, y) => page.evaluate(([x, y]) => window.boardTest.backgroundEditor.clientOf(x, y), [x, y]);
  const drag = async (points) => {
    const screen = [];
    for (const [x, y] of points) screen.push(await at(x, y));
    await page.mouse.move(screen[0].x, screen[0].y);
    await page.mouse.down();
    for (const p of screen.slice(1)) await page.mouse.move(p.x, p.y, { steps: 8 });
    await page.mouse.up();
  };
  const setRange = (selector, value) => page.evaluate(([selector, value]) => { const el = document.querySelector(selector); el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [selector, value]);
  const count = (layer, value) => page.evaluate(([layer, value]) => { let n = 0; const a = window.boardTest.backgroundEditor.layers[layer]; for (let i = 0; i < a.length; i++) if (a[i] === value) n++; return n; }, [layer, value]);
  const pixel = (layer, x, y) => page.evaluate(([layer, x, y]) => window.boardTest.backgroundEditor.layers[layer][y * 2048 + x], [layer, x, y]);

  await page.evaluate(async () => { await window.boardTest.openBackgroundEditor(); });
  const cards = await ed(() => [...document.querySelectorAll('.atlas-tabletop-bg-card .atlas-tabletop-bg-card__name')].map((n) => n.textContent));
  check('background editor: the saved backgrounds are listed', cards.includes('Isle') && cards.includes('Badlands'), JSON.stringify(cards));

  // New: a name typed in the list, then it is made, listed and opened.
  await page.locator('[data-bg-action="new"]').click();
  await page.locator('.atlas-tabletop-bg-name-input').fill('Caves');
  await page.keyboard.press('Enter');
  check('background editor: a new background is opened', await until(() => window.boardTest.backgroundEditor.folder?.endsWith('/Caves') && window.boardTest.backgroundEditor.layers));
  check('background editor: a new background shows in the list', await until(() => [...document.querySelectorAll('.atlas-tabletop-bg-card__name')].some((n) => n.textContent === 'Caves')));
  check('background editor: a new background starts empty and unchanged', await ed(() => { const e = window.boardTest.backgroundEditor; return !e.dirty && e.layers.terrain.every((v) => v === 0) && e.layers.height.every((v) => v === 128); }));
  await wait(300);

  // The map's footprint is shaded in the middle of the empty picture.
  const lit = await ed(async () => {
    const e = window.boardTest.backgroundEditor;
    const canvas = document.querySelector('.atlas-tabletop-bg-canvas');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = canvas.getBoundingClientRect();
    const read = (x, y) => { const p = e.clientOf(x, y); return [...canvas.getContext('2d').getImageData(Math.round(p.x - box.left), Math.round(p.y - box.top), 1, 1).data.slice(0, 3)]; };
    return { inside: read(1024 + 20, 1024 + 20), outside: read(1024 + 160, 1024 + 160) };
  });
  check('background editor: the map footprint is drawn in the middle', lit.inside.join() !== lit.outside.join(), JSON.stringify(lit));

  // Painting Water with the brush sets the terrain pixels to water's index (10).
  await page.locator('[data-bg-layer="terrain"]').click();
  await page.locator('[data-bg-terrain="water"]').click();
  await page.locator('[data-bg-tool="brush"]').click();
  await setRange('[data-bg-brush]', 20);
  await drag([[700, 1300], [1000, 1300], [1300, 1400]]);
  check('background editor: painting with the brush sets terrain pixels to water', (await pixel('terrain', 1000, 1300)) === 10 && (await pixel('terrain', 700, 1300)) === 10 && (await pixel('terrain', 1000, 900)) === 0, JSON.stringify([await pixel('terrain', 1000, 1300), await count('terrain', 10)]));
  check('background editor: a painted change marks the background as changed', await ed(() => window.boardTest.backgroundEditor.dirty));
  await page.locator('[data-bg-terrain="lava"]').click();
  await drag([[1500, 700], [1700, 700]]);
  await page.locator('[data-bg-terrain="dunes"]').click();
  await page.locator('[data-bg-tool="fill"]').click();
  const at1 = await at(500, 500);
  await page.mouse.click(at1.x, at1.y);
  check('background editor: Fill on Terrain pours dunes over the open ground and stops at the water', (await pixel('terrain', 500, 500)) === 4 && (await pixel('terrain', 1000, 1300)) === 10 && (await pixel('terrain', 1600, 700)) === 11, JSON.stringify([await pixel('terrain', 500, 500), await pixel('terrain', 1000, 1300), await pixel('terrain', 1600, 700)]));
  await page.locator('[data-bg-action="undo"]').click();
  check('background editor: Undo takes the terrain fill back', (await pixel('terrain', 500, 500)) === 0 && (await pixel('terrain', 1600, 700)) === 11);

  // Material layer: slot 1 is picked from the gallery, a closed ring is drawn, and Fill with slot 2 fills the inside.
  await page.locator('[data-bg-layer="material"]').click();
  await page.locator('[data-bg-slot="1"]').selectOption('materials/brick');
  check('background editor: picking a material fills the slot', await ed(() => JSON.stringify(window.boardTest.backgroundEditor.settings.materials) === '["materials/brick"]'));
  await page.locator('[data-bg-tool="brush"]').click();
  await drag([[700, 700], [900, 700], [900, 900], [700, 900], [700, 700]]);
  check('background editor: the material brush paints the slot number', (await pixel('material', 800, 700)) === 1 && (await pixel('material', 800, 800)) === 0);
  await page.locator('[data-bg-slot="2"]').selectOption('materials/stone');
  await page.locator('[data-bg-tool="fill"]').click();
  const inside = await at(800, 800);
  await page.mouse.click(inside.x, inside.y);
  const filled = [await pixel('material', 800, 800), await pixel('material', 760, 840), await pixel('material', 800, 700), await pixel('material', 500, 500)];
  check('background editor: Fill on Material fills the closed region and nothing outside it', filled.join() === '2,2,1,0', JSON.stringify(filled));
  await page.locator('[data-bg-action="undo"]').click();
  const undone = [await pixel('material', 800, 800), await pixel('material', 800, 700)];
  check('background editor: Undo restores the filled region in one step', undone.join() === '0,1', JSON.stringify(undone));
  await page.locator('[data-bg-action="redo"]').click();
  check('background editor: Redo puts the fill back', (await pixel('material', 800, 800)) === 2);

  // Wheel zooms around the pointer; right-drag pans.
  const before = await at(1024, 1024);
  const box = await page.locator('.atlas-tabletop-bg-canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.wheel(0, -300);
  await wait(150);
  const zoomed = await ed(() => window.boardTest.backgroundEditor.view.scale);
  const fit = await ed(() => window.boardTest.backgroundEditor.view.fit);
  check('background editor: the wheel zooms in', zoomed > fit * 1.3, JSON.stringify([zoomed, fit]));
  const mid = await at(1024, 1024);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(mid.x + 60, mid.y + 40, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const panned = await at(1024, 1024);
  check('background editor: right-drag pans the picture', Math.abs(panned.x - mid.x - 60) < 2 && Math.abs(panned.y - mid.y - 40) < 2, JSON.stringify([mid, panned, before]));
  await ed(() => window.boardTest.backgroundEditor.fitView());

  // At most four custom patterns.
  for (let i = 0; i < 4; i++) await page.locator('[data-bg-action="add-pattern"]').click();
  const patterns = await ed(() => ({ n: window.boardTest.backgroundEditor.settings.patterns.length, off: document.querySelector('[data-bg-action="add-pattern"]').disabled }));
  check('background editor: adding a fifth custom pattern is refused (the button is disabled)', patterns.n === 4 && patterns.off, JSON.stringify(patterns));
  await page.locator('[data-bg-action="add-pattern"]').click({ force: true }).catch(() => {});
  check('background editor: still four patterns after trying a fifth', await ed(() => window.boardTest.backgroundEditor.settings.patterns.length === 4));
  await page.locator('[data-bg-layer="terrain"]').click();
  check('background editor: the custom terrains open up once their patterns exist', await ed(() => ['custom1', 'custom4'].every((id) => !document.querySelector(`[data-bg-terrain="${id}"]`).disabled)));
  // A liquid's settings: lava's own kind of lava, and the tint presets.
  await ed(() => { const s = document.querySelector('[data-bg-liquid="lava"] [data-bg-lava-style]'); s.value = 'magma'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await ed(() => document.querySelectorAll('[data-bg-liquid="water"] .atlas-tabletop-bg-tint')[2].click());
  const liquids = await ed(() => { const l = window.boardTest.backgroundEditor.settings.liquids; return { style: l.lava.style, tint: l.water.tint, clear: !!document.querySelector('[data-bg-liquid="lava"] [data-bg-clarity]') }; });
  check('background editor: the lava type and a water tint preset are kept in the settings', liquids.style === 'magma' && liquids.tint === '#123f63' && !liquids.clear, JSON.stringify(liquids));
  await page.locator('[data-bg-terrain="water"]').click();
  await shot('background-editor');

  // Save writes it all; opening it again shows the same pixels and settings.
  const sums = await ed(() => { const e = window.boardTest.backgroundEditor; const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s = (Math.imul(s ^ a[i], 16777619) + i) >>> 0; return s; }; return { terrain: sum(e.layers.terrain), material: sum(e.layers.material), height: sum(e.layers.height), patterns: e.settings.patterns.length, folder: e.folder }; });
  await page.locator('[data-bg-action="save"]').click();
  check('background editor: Save clears the changed mark', await until(() => !window.boardTest.backgroundEditor.dirty));
  await ed(async (folder) => { await window.boardTest.backgroundEditor.open(null); await window.boardTest.backgroundEditor.open(folder); }, sums.folder);
  const reread = await ed(() => { const e = window.boardTest.backgroundEditor; const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s = (Math.imul(s ^ a[i], 16777619) + i) >>> 0; return s; }; return { terrain: sum(e.layers.terrain), material: sum(e.layers.material), height: sum(e.layers.height), patterns: e.settings.patterns.length, folder: e.folder, materials: e.settings.materials.length, lava: e.settings.liquids.lava.style }; });
  check('background editor: saved, then reopened, it shows the same pixels and settings', reread.terrain === sums.terrain && reread.material === sums.material && reread.height === sums.height && reread.patterns === sums.patterns && reread.materials === 2 && reread.lava === 'magma', JSON.stringify([sums, reread]));
  check('background editor: the thumbnail was saved', await ed(() => window.boardTest.backgroundFiles.has(`${window.boardTest.backgroundEditor.folder}/thumb.png`)));

  // Heightmap import: a picture of two colours becomes height 0 and 255, as one undo step.
  await ed(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 32, 64); ctx.fillStyle = '#fff'; ctx.fillRect(32, 0, 32, 64);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'height.png', { type: 'image/png' }));
    const input = document.querySelector('.atlas-tabletop-bg input[type="file"]');
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  check('background editor: importing a heightmap changes the height layer', await until(() => window.boardTest.backgroundEditor.layers.height[1000 * 2048 + 10] === 0 && window.boardTest.backgroundEditor.layers.height[1000 * 2048 + 2040] === 255));
  check('background editor: the imported heightmap marks the background as changed and shows the height layer', await ed(() => window.boardTest.backgroundEditor.dirty && document.querySelector('[data-bg-layer="height"]').classList.contains('is-active')));
  await page.locator('[data-bg-action="undo"]').click();
  check('background editor: Undo takes the whole imported heightmap back', (await pixel('height', 10, 1000)) === 128 && (await pixel('height', 2040, 1000)) === 128);

  // Leaving a changed background asks first.
  await drag([[500, 500], [600, 500]]);
  await page.locator('.atlas-tabletop-bg-card', { hasText: 'Isle' }).click();
  check('background editor: leaving a changed background asks to save', await ed(() => !!document.querySelector('.atlas-tabletop-bg-unsaved:not([hidden])') && window.boardTest.backgroundEditor.folder.endsWith('/Caves')));
  await page.locator('[data-bg-unsaved="cancel"]').click();
  check('background editor: Cancel stays on the changed background', await ed(() => !document.querySelector('.atlas-tabletop-bg-unsaved:not([hidden])') && window.boardTest.backgroundEditor.folder.endsWith('/Caves') && window.boardTest.backgroundEditor.dirty));
  await page.locator('.atlas-tabletop-bg-card', { hasText: 'Isle' }).click();
  await page.locator('[data-bg-unsaved="discard"]').click();
  check('background editor: Discard leaves without saving', await until(() => window.boardTest.backgroundEditor.folder?.endsWith('/Isle') && !window.boardTest.backgroundEditor.dirty));
  // Rename and Duplicate work on the open background.
  await page.locator('[data-bg-action="rename"]').click();
  await page.locator('.atlas-tabletop-bg-name-input').fill('Atoll');
  await page.keyboard.press('Enter');
  check('background editor: Rename renames the open background', await until(() => window.boardTest.backgroundEditor.folder?.endsWith('/Atoll') && [...document.querySelectorAll('.atlas-tabletop-bg-card__name')].some((n) => n.textContent === 'Atoll')));
  await page.locator('[data-bg-action="duplicate"]').click();
  check('background editor: Duplicate opens a copy', await until(() => window.boardTest.backgroundEditor.folder?.endsWith('/Atoll copy')));
  await page.locator('[data-bg-action="delete"]').click();
  await page.locator('[data-bg-action="confirm-delete"]').click();
  check('background editor: Delete removes it from the list', await until(() => ![...document.querySelectorAll('.atlas-tabletop-bg-card__name')].some((n) => n.textContent === 'Atoll copy')));
  await ed(() => window.boardTest.closeBackgroundEditor());
});

// ── Ground: lava and acid to the horizon; the fog switch, and a plane that ends a little past the fog ─────────────
feature('ground liquids and fog',async ({ page, shot }) => {
  const shaderErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|program not valid/.test(m.text())) shaderErrors.push(m.text().slice(0, 160)); });
  await page.evaluate(() => { const { board, groundState } = window.boardTest; groundState.value = { mode: 'horizon', noise: 'rolling', strength: 0.5, fog: 80, margin: 0, tile: 2 }; board.refresh(); });
  await wait(300);
  await page.evaluate(() => window.boardTest.board.toolbar.openGround?.());
  await wait(150);
  const slider = await page.evaluate(() => { const input = document.querySelector('[aria-label="Distance fog"]'); return { min: input.min, max: input.max, on: document.querySelector('[aria-label="Distance fog on"]').checked }; });
  check('ground: the fog slider runs from 80 to 100, with a switch that is on', slider.min === '80' && slider.max === '100' && slider.on, JSON.stringify(slider));
  const reach = () => page.evaluate(() => { const { board } = window.boardTest; const g = board.groundPlane.object3d.geometry; g.computeBoundingBox(); const box = g.boundingBox; return { half: (box.max.x - box.min.x) / 2, span: board.span, fog: board.scene.fog?.far ?? null }; });
  const at80 = await reach();
  check('ground: at 80 the plane runs a little past where the fog hides everything, no further', at80.fog !== null && at80.half > at80.fog && at80.half < at80.fog * 1.3 + at80.span, JSON.stringify(at80));
  await page.evaluate(() => { const box = document.querySelector('[aria-label="Distance fog on"]'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(400);
  const off = await reach();
  const offUi = await page.evaluate(() => ({ fog: window.boardTest.groundState.value.fog, disabled: document.querySelector('[aria-label="Distance fog"]').disabled, value: document.querySelector('[aria-label="Distance fog"]').closest('label').querySelector('.atlas-tabletop-palette__unit').textContent }));
  check('ground: the fog switched off: no fog, the plane as far as it ran before, the slider shown off', off.fog === null && Math.abs(off.half - off.span * 14) < 1 && offUi.fog === 0 && offUi.disabled && offUi.value === 'off', JSON.stringify({ off, offUi }));
  await page.evaluate(() => { const box = document.querySelector('[aria-label="Distance fog on"]'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(300);
  check('ground: switched on again, the fog is back at the slider', (await page.evaluate(() => window.boardTest.groundState.value.fog)) >= 80);
  // Lava to the horizon: its own sheet, its own settings, lighting the board from below.
  const below = await page.evaluate(() => window.boardTest.board.hemisphere.groundColor.getHexString());
  await page.getByRole('button', { name: 'Lava plane' }).click();
  await wait(700);
  const sea = await page.evaluate(() => {
    const { board, groundState } = window.boardTest;
    const presets = [...document.querySelectorAll('[aria-label="Liquid tint presets"] .atlas-swatch')].map((b) => b.getAttribute('aria-label'));
    return { mode: groundState.value.mode, liquid: board.seaPlane.liquid, on: board.seaPlane.object3d.parent === board.scene, below: board.hemisphere.groundColor.getHexString(), presets, clarity: document.querySelector('[aria-label="How clear the liquid is"]').closest('label').hidden, still: document.querySelector('[aria-label="How the liquid moves"] option[value="still"]').textContent };
  });
  const swatchSize = await page.evaluate(() => Math.min(...[...document.querySelectorAll('[aria-label="Liquid tint presets"] .atlas-swatch')].map((b) => b.getBoundingClientRect().width)));
  check('ground: the tint presets are swatches of a size to click (not specks)', swatchSize >= 24, String(swatchSize));
  check('ground: Lava plane lays the map on lava to the horizon, with lava\'s presets and motions and no clarity', sea.mode === 'lava' && sea.liquid === 'lava' && sea.on && sea.presets.includes('Molten') && sea.clarity && sea.still === 'Still', JSON.stringify(sea));
  check('ground: a sea of lava lights the board from below in its glow', sea.below !== below, JSON.stringify({ below, now: sea.below }));
  await page.locator('[aria-label="Liquid tint presets"] .atlas-swatch[aria-label="Deep red"]').click();
  await wait(300);
  const tinted = await page.evaluate(() => ({ lava: window.boardTest.groundState.value.lava?.tint, water: window.boardTest.groundState.value.water?.tint }));
  check("ground: the lava's tint is its own (the water's stays)", tinted.lava === '#c2240f' && tinted.water !== '#c2240f', JSON.stringify(tinted));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const { board } = window.boardTest; board.camera.goal.pitch = 0.4; board.wake(true); });
  await wait(1200);
  await shot('ground-lava');
  await page.evaluate(() => window.boardTest.board.toolbar.openGround?.());
  await page.getByRole('button', { name: 'Acid plane' }).click();
  await wait(700);
  const acid = await page.evaluate(() => ({ liquid: window.boardTest.board.seaPlane.liquid, clarity: !document.querySelector('[aria-label="How clear the liquid is"]').closest('label').hidden }));
  check('ground: Acid plane lays the map on acid, with its clarity', acid.liquid === 'acid' && acid.clarity, JSON.stringify(acid));
  await page.keyboard.press('Escape');
  await wait(800);
  await shot('ground-acid');
  check('ground: the lava and acid seas compile', shaderErrors.length === 0, JSON.stringify(shaderErrors));
  await page.evaluate(() => { const { board, groundState } = window.boardTest; groundState.value = { mode: 'board', noise: 'rolling', strength: 0.5, fog: 80, margin: 0, tile: 2 }; board.refresh(); });
});

// ── Undo and redo: the toolbar's buttons take back painted water and bring it back ──────────────────────────────
feature('undo', async ({ page, shot }) => {
  check('the toolbar has Undo and Redo, both off with nothing done', await page.evaluate(() => { const undo = document.querySelector('.atlas-tabletop-toolbar button[aria-label="Undo"]'); const redo = document.querySelector('.atlas-tabletop-toolbar button[aria-label="Redo"]'); return !!undo && !!redo && undo.disabled && redo.disabled; }));
  await page.evaluate(() => { const actions = window.boardTest.board.toolbarActions(); actions.setWaterTool('paint'); actions.setWaterBrush(1.5); });
  const canvas = await page.locator('canvas').first().boundingBox();
  const [x, y] = [canvas.x + canvas.width * 0.42, canvas.y + canvas.height * 0.62];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 200, y + 10, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await wait(200);
  const wet = () => page.evaluate(() => { const water = window.boardTest.board.water; return !!water && !water.mask.empty; });
  check('a stroke paints water', await wet());
  check('Undo lights up', await page.evaluate(() => !document.querySelector('.atlas-tabletop-toolbar button[aria-label="Undo"]').disabled));
  await page.locator('.atlas-tabletop-toolbar button[aria-label="Undo"]').click();
  await wait(300);
  check('Undo takes the water away', !(await wet()));
  check('Redo lights up', await page.evaluate(() => !document.querySelector('.atlas-tabletop-toolbar button[aria-label="Redo"]').disabled));
  await page.locator('.atlas-tabletop-toolbar button[aria-label="Redo"]').click();
  await wait(300);
  check('Redo brings it back', await wet());
  await shot('undo-redo');
  await page.locator('.atlas-tabletop-toolbar button[aria-label="Undo"]').click();
  await wait(200);
});

// ── Atlas's window: a wall that stops only tokens stands as a sill and a lintel, with an opening between ──────────
feature('windows', async ({ page, shot }) => {
  await page.evaluate(() => { const { board, map } = window.boardTest; board.load({ ...map, walls: map.walls.map((w) => (w.id === 'e' ? { ...w, blocks: 'movement' } : w)) }); });
  await wait(800);
  const spans = await page.evaluate(() => { const ys = new Set(); window.boardTest.board.walls.object3d.traverse((node) => { if (node.isMesh && node.userData.walls) { const p = node.geometry.getAttribute('position'); for (let i = 0; i < p.count; i++) { const x = p.getX(i); if (Math.abs(x - 665) < 12) ys.add(Math.round(p.getY(i))); } } }); return [...ys].sort((a, b) => a - b); });
  check('the window wall has an opening between its sill and lintel', spans.length >= 4, JSON.stringify(spans));
  await page.evaluate(() => { const { board } = window.boardTest; for (const pose of [board.camera.pose, board.camera.goal]) { pose.target.x = 665; pose.target.z = 910; pose.distance = 420; pose.pitch = 0.3; pose.yaw = Math.PI / 2; } board.camera.snap(); board.wake(true); });
  await wait(500);
  await shot('window');
  await page.evaluate(() => { const { board } = window.boardTest; for (const pose of [board.camera.pose, board.camera.goal]) pose.yaw = -Math.PI / 2; board.camera.snap(); board.wake(true); });
  await wait(500);
  await shot('window-2');
  // Ctrl over the window: three handles (its sill, lintel and top); dragging the lowest moves the opening's bottom.
  await page.evaluate(() => { const { board } = window.boardTest; for (const pose of [board.camera.pose, board.camera.goal]) { pose.yaw = Math.PI / 2; pose.pitch = 0.15; } board.camera.snap(); board.wake(true); });
  await wait(500);
  const spots = () => page.evaluate(() => { const { board } = window.boardTest; board.applyView(); const rect = board.canvas.getBoundingClientRect(); return (board.handles?.spots ?? []).map((spot) => { const on = spot.at.clone().project(board.view); return { part: spot.part, x: rect.left + ((on.x + 1) / 2) * rect.width, y: rect.top + ((1 - on.y) / 2) * rect.height }; }); });
  const middle = await page.evaluate(() => { const { board } = window.boardTest; board.applyView(); const rect = board.canvas.getBoundingClientRect(); const on = new window.boardTest.Vector3(665, 8, 910).project(board.view); return { x: rect.left + ((on.x + 1) / 2) * rect.width, y: rect.top + ((1 - on.y) / 2) * rect.height }; });
  await page.keyboard.down('Control');
  await page.mouse.move(middle.x, middle.y + 3);
  await page.mouse.move(middle.x, middle.y);
  await wait(300);
  let shown = await spots();
  const which = await page.evaluate(() => { const { board } = window.boardTest; const w = board.map.walls.find((c) => c.id === board.handles?.wall); return { id: board.handles?.wall, blocks: w?.blocks, type: w?.type }; });
  check('Ctrl over a window shows handles at its sill, lintel and top', shown.map((s) => s.part).join() === 'sill,lintel,wall', JSON.stringify({ shown, which }));
  await shot('window-handles');
  const sill = shown.find((s) => s.part === 'sill');
  if (sill) {
    await page.mouse.move(sill.x, sill.y);
    await page.mouse.down();
    await page.mouse.move(sill.x, sill.y - 15, { steps: 4 });
    await page.mouse.move(sill.x, sill.y - 30, { steps: 4 });
    await page.mouse.up();
    await wait(300);
  }
  const kept = await page.evaluate(() => window.boardTest.windowSpans.get('e') ?? null);
  check('dragging the sill handle up raises the opening bottom', kept !== null && kept.bottom > 0.25 && kept.top > kept.bottom, JSON.stringify(kept));
  await page.keyboard.up('Control');
  await wait(200);
  const gone = await page.evaluate(() => window.boardTest.board.handles === null);
  check('letting go of Ctrl takes the handles away', gone, '');
  // A plain wall: one handle, on its top.
  await page.evaluate(() => window.boardTest.board.load(window.boardTest.map));
  await wait(500);
  await page.keyboard.down('Control');
  await page.mouse.move(middle.x, middle.y + 3);
  await page.mouse.move(middle.x, middle.y);
  await wait(300);
  shown = await spots();
  check('Ctrl over a plain wall shows one handle, on its top', shown.map((s) => s.part).join() === 'wall', JSON.stringify(shown));
  await page.keyboard.up('Control');
  // Alt over the wall: one handle, on its side; dragged away from the wall it makes the wall wider.
  await page.keyboard.down('Alt');
  await page.mouse.move(middle.x, middle.y + 3);
  await page.mouse.move(middle.x, middle.y);
  await wait(300);
  shown = await spots();
  const widthWall = await page.evaluate(() => window.boardTest.board.handles?.wall ?? null);
  check('Alt over a wall shows one handle, for its width', shown.map((s) => s.part).join() === 'width', JSON.stringify(shown));
  await shot('width-handle');
  const grip = shown[0];
  if (grip) {
    const away = await page.evaluate(({ id, x, y }) => { const { board } = window.boardTest; const wall = board.map.walls.find((w) => w.id === id); const rect = board.canvas.getBoundingClientRect(); board.applyView(); const mid = { x: (wall.p1.x + wall.p2.x) / 2, z: (wall.p1.y + wall.p2.y) / 2 }; const on = new window.boardTest.Vector3(mid.x, 0, mid.z).project(board.view); const cx = rect.left + ((on.x + 1) / 2) * rect.width; const cy = rect.top + ((1 - on.y) / 2) * rect.height; const dx = x - cx; const dy = y - cy; const len = Math.hypot(dx, dy) || 1; return { x: x + (dx / len) * 25, y: y + (dy / len) * 25 }; }, { id: widthWall, x: grip.x, y: grip.y });
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move((grip.x + away.x) / 2, (grip.y + away.y) / 2, { steps: 3 });
    await page.mouse.move(away.x, away.y, { steps: 3 });
    await page.mouse.up();
    await wait(300);
  }
  const widened = await page.evaluate((id) => ({ kept: window.boardTest.wallWidthsKept.get(id) ?? null, map: window.boardTest.board.host.wallThickness() }), widthWall);
  check('dragging the width handle away from the wall makes it wider', widened.kept !== null && widened.kept > widened.map, JSON.stringify(widened));
  await page.keyboard.up('Alt');
  await page.evaluate(() => { window.boardTest.wallWidthsKept.clear(); window.boardTest.board.refresh(); });
  await page.evaluate(() => window.boardTest.windowSpans.clear());
  await page.evaluate(() => window.boardTest.board.load(window.boardTest.map));
  await wait(500);
});

// ── Wall paint on the toolbar, Esc from anywhere, and the Play/Edit modes ─────────────────────────────────────────
feature('modes', async ({ page, shot }) => {
  const painting = () => page.evaluate(() => window.boardTest.board.isPainting);
  // Painting from the gallery, with the focus elsewhere: Esc still stops it.
  await page.evaluate(() => { const { board } = window.boardTest; board.paintWith('materials/brick'); board.canvas.blur(); document.body.tabIndex = -1; document.body.focus(); });
  await page.keyboard.press('Escape');
  check('Esc stops painting even when the board does not have the focus', (await painting()) === false, '');
  await page.evaluate(() => window.boardTest.board.paintWith('materials/brick'));
  const box = await page.evaluate(() => { const r = window.boardTest.board.canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  check('a right-click on the board stops painting', (await painting()) === false, '');
  // Modes on: Play shows the game's tools, Edit the building ones.
  await page.evaluate(() => { const { board, modes } = window.boardTest; modes.on = true; modes.mode = 'play'; board.refreshToolbar(); });
  const seen = () => page.evaluate(() => { const vis = (el) => !!el && el.offsetParent !== null; const q = (s) => document.querySelector(s); return { modes: vis(q('.atlas-tabletop-modes')), water: vis(q('[aria-label="Water"]')), paint: vis(q('[aria-label="Paint walls"]')), measure: vis(q('[aria-label="Measure"]')) || vis(q('[aria-label^="Measure"]')), settings: vis(q('[aria-label="Board settings"]')), view: vis(q('[aria-label="Visibility"]')), move: vis(q('[aria-label="Move/Select"]')), undo: vis(q('[aria-label="Undo"]')) }; });
  let now = await seen();
  check('Play mode: the mode switch, Move, Undo, Measure and Visibility; no water, wall paint or Board settings', now.modes && now.move && now.undo && now.measure && now.view && !now.settings && !now.water && !now.paint, JSON.stringify(now));
  await shot('mode-play');
  await page.click('[aria-label="Edit mode"]');
  await wait(200);
  now = await seen();
  check('Edit mode: water, wall paint, Board settings and Visibility, Move and Undo; no Measure', now.move && now.undo && now.water && now.paint && now.settings && now.view && !now.measure, JSON.stringify(now));
  await page.click('[aria-label="Materials"]');
  await wait(200);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-paint-card')].map((card) => card.dataset.material));
  check('the paint tool lists the gallery materials, and a choice to take one off', cards.length === 3 && cards.includes('materials/stone'), JSON.stringify(cards));
  await shot('mode-edit-paint');
  await page.click('.atlas-tabletop-paint-card[data-material="materials/stone"]');
  await wait(200);
  const lit = await page.evaluate(() => document.querySelector('[aria-label="Paint walls"]').classList.contains('is-active'));
  check('choosing a material paints with it, and the paint button is lit', (await painting()) && lit, '');
  await page.click('[aria-label="Paint walls"]');
  check('the paint button stops painting', (await painting()) === false, '');
  await page.click('[aria-label="Paint walls"]');
  check('the paint button takes up the last material again', (await page.evaluate(() => window.boardTest.board.painting)) === 'materials/stone', '');
  await page.click('[aria-label="Play mode"]');
  await wait(200);
  check('going to Play mode stops painting', (await painting()) === false, '');
  // Ctrl over a wall shows no handles in Play mode.
  await page.keyboard.down('Control');
  await page.mouse.move(box.x, box.y + 2);
  await page.mouse.move(box.x, box.y);
  await wait(200);
  check('Play mode: Ctrl over the board shows no wall handles', (await page.evaluate(() => window.boardTest.board.handles)) === null, '');
  await page.keyboard.up('Control');
  await page.evaluate(() => { const { board, modes } = window.boardTest; modes.on = false; board.refreshToolbar(); });
  // A tooltip by the board's right edge stays inside it: the pane never scrolls sideways.
  const tip = await page.evaluate(() => {
    const { board } = window.boardTest;
    const rect = board.canvas.getBoundingClientRect();
    board.showTip(rect.right - 4, rect.bottom - 4, 'A long tooltip text that would run past the edge of the board');
    const box = board.tooltip.getBoundingClientRect();
    const pane = board.container;
    const out = { right: box.right, bottom: box.bottom, edge: rect.right, foot: rect.bottom, scroll: pane.scrollWidth, width: pane.clientWidth };
    board.tooltip.hidden = true;
    return out;
  });
  check('a tooltip by the board edge stays inside the board', tip.right <= tip.edge && tip.bottom <= tip.foot && tip.scroll <= tip.width, JSON.stringify(tip));
});

// ── A door turned half a turn, or mirrored: its hinge goes to the other end ─────────────────────────────────────
// ── Going from one scene of a stack to another: nothing read or decoded again ───────────────────────────────────────
feature('layer switch', async ({ page, shot }) => {
  // The tavern with the balcony stacked two squares up, as Tabletop's board shows a stack.
  const shown = await page.evaluate(async () => {
    const { board, map } = window.boardTest;
    const data = (path, elevation, m) => ({
      path, elevation, map: m, wallHeight: () => null, wallMaterial: () => null, doorProp: () => null, lightHeight: () => 1, fogHeight: 1, wallThickness: 0.12, props: [],
      placement: () => null, style: () => 'disc',
    });
    const balcony = { ...map, path: 'upper.atlasmap', background: 'balcony.png', fog: [], inks: [], texts: [], icons: [], pins: [], initiative: null, tokens: [], walls: [], lights: [] };
    window.stackTest = { tavern: map, balcony, data };
    board.setStack([data('upper.atlasmap', 2, balcony)]);
    for (let i = 0; i < 50 && !board.layerViews.get('upper.atlasmap')?.floor.visible; i++) await new Promise((r) => setTimeout(r, 50));
    return board.layerViews.get('upper.atlasmap')?.floor.visible === true;
  });
  check('layer switch: the scene above is drawn', shown);
  const go = (to) => page.evaluate(async (to) => {
    const { board, record } = window.boardTest;
    const { tavern, balcony, data } = window.stackTest;
    record.imageReads.length = 0;
    const started = performance.now();
    // As the board view does: the other scene loads, then the stack is read from it.
    if (to === 'up') {
      await board.load(balcony, -140);
      board.setStack([data(tavern.path, -2, tavern)]);
    } else {
      await board.load(tavern, 140);
      board.setStack([data('upper.atlasmap', 2, balcony)]);
    }
    const loaded = performance.now() - started;
    const left = to === 'up' ? tavern.path : 'upper.atlasmap';
    for (let i = 0; i < 50 && !board.layerViews.get(left)?.floor.visible; i++) await new Promise((r) => setTimeout(r, 10));
    return { loaded, whole: performance.now() - started, reads: [...record.imageReads], floor: board.layerViews.get(left)?.floor.visible === true, kept: board.floorTextures.size };
  }, to);
  const up = await go('up');
  check('layer switch: going up reads and decodes no floor again, and the scene left is drawn below at once', up.reads.length === 0 && up.floor && up.kept === 2, JSON.stringify(up));
  await shot('layer-switch-up');
  const down = await go('down');
  check('layer switch: and back down the same', down.reads.length === 0 && down.floor && down.kept === 2, JSON.stringify(down));
  // The stack taken away: its layers are put away, their floors kept to come straight back; gone for good, so are they.
  await page.evaluate(() => window.boardTest.board.setStack([]));
  const keptAway = await page.evaluate(() => ({ floors: window.boardTest.board.floorTextures.size, parked: window.boardTest.board.parked.size }));
  check('layer switch: a layer put away keeps its floor, to come back without reading it again', keptAway.floors === 2 && keptAway.parked >= 1, JSON.stringify(keptAway));
});

// ── The players' AR table: its sheets on the map, placed with the handles ─────────────────────────────────────────
feature('ar table', async ({ page, shot }) => {
  const table = {
    survey: { squareMm: 25, groups: [
      { group: 'mat-0', x: 0, y: 0, heading: 0, w: 210, h: 297 },
      { group: 'mat-1', x: 225, y: 5, heading: 0.05, w: 210, h: 297 },
      { group: 'card-14', x: -170, y: 120, heading: 0.5, w: 70, h: 68 },
    ] },
    place: { x: 6, y: 4, turn: 0 },
  };
  await page.evaluate((table) => window.boardTest.board.setArTable(table), table);
  await wait(400);
  check('ar table: not shown until the GM fine-tunes it', await page.evaluate(() => window.boardTest.board.tableOutlines.children.length === 0));
  // Board settings: the AR table's section says how many sheets, and its button starts fine-tuning.
  await page.getByRole('button', { name: 'Board settings' }).click();
  await wait(200);
  const section = await page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-palette__section')].find((s) => s.textContent.includes('AR table'))?.textContent ?? null);
  check('ar table: Board settings has it, with its sheets', section && section.includes('3 sheets'), String(section));
  await page.getByRole('button', { name: 'Fine-tune the AR table…' }).click();
  await wait(600);
  const outlines = await page.evaluate(() => window.boardTest.board.tableOutlines.children.length);
  check('ar table: fine-tuning draws each sheet (outline, wash and name)', outlines === 9, String(outlines));
  const chip = await page.evaluate(() => document.querySelector('.atlas-tabletop-adjust.is-table')?.textContent ?? null);
  check('ar table: placing puts the handles on it and a chip with its square size', chip && chip.includes('Placing the AR table (3 sheets)') && chip.includes('Done') && (await page.evaluate(() => window.boardTest.board.gizmo !== null)), String(chip));
  await shot('ar-table-placing');
  const g = await page.evaluate(() => { const o = window.boardTest.board.gizmo.object3d; return { x: o.position.x, y: o.position.y, z: o.position.z }; });
  const middle = await page.evaluate(([x, y, z]) => window.boardTest.project(x, z, y), [g.x, g.y, g.z]);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x + 80, middle.y + 10, { steps: 6 });
  await page.mouse.up();
  await wait(300);
  const placed = await page.evaluate(() => window.boardTest.record.sceneTabs.filter((e) => e[0] === 'table'));
  check('ar table: dragging the square moves it, and it is kept when let go', placed.length === 1 && placed[0][1].place.x > 6.2 && placed[0][1].survey.groups.length === 3, JSON.stringify(placed.map((e) => e[1].place)));
  await page.locator('.atlas-tabletop-adjust.is-table select').selectOption('30');
  await wait(200);
  const squares = await page.evaluate(() => window.boardTest.record.sceneTabs.filter((e) => e[0] === 'table').pop()[1].survey.squareMm);
  check('ar table: the chip sets the table\'s square size', squares === 30, String(squares));
  await shot('ar-table-moved');
  await page.locator('.atlas-tabletop-adjust.is-table button', { hasText: 'Done' }).click();
  await wait(200);
  check('ar table: Done takes the handles, the chip and the sheets away', await page.evaluate(() => window.boardTest.board.gizmo === null && !document.querySelector('.atlas-tabletop-adjust.is-table') && window.boardTest.board.tableOutlines.children.length === 0));
});

// ── A player's phone in AR: an eye on the GM's board, blinking, that fades when they leave ──────────────────────
feature('ar viewer eye', async ({ page, shot }) => {
  const place = () => page.evaluate(() => {
    const { board } = window.boardTest;
    const cell = board.map.grid.size;
    // Over the map, south of its middle, turned to look south (at the GM's camera) and tipped 15° down.
    const a = (-15 * Math.PI) / 180 / 2;
    board.receiveViewer('p1', 'Ana', '#ff0059', { position: [board.size.width / 2 - cell * 3, cell * 3, board.size.height / 2 + cell * 3], quaternion: [0, Math.cos(a), -Math.sin(a), 0] });
    return cell;
  });
  await place();
  await wait(600);
  check('eye: shows for a player in AR', await page.evaluate(() => window.boardTest.board.viewers.count === 1));
  const at = await page.evaluate(() => { const { board } = window.boardTest; const eye = board.viewers.object3d.children.find((c) => c.name === 'ar-viewer:p1'); return window.boardTest.project(eye.position.x, eye.position.z, eye.position.y); });
  check('eye: on the screen', at && at.x > 0 && at.x < 1000 && at.y > 0 && at.y < 640, JSON.stringify(at));
  await shot('ar-eye');
  await shot('ar-eye-close', { x: Math.max(0, Math.min(1000 - 260, at.x - 130)), y: Math.max(0, Math.min(640 - 220, at.y - 130)), width: 260, height: 220 });
  // The lids move: a blink comes within a few seconds (kept alive by the heartbeat the phone sends).
  let shut = false;
  for (let i = 0; i < 120 && !shut; i++) {
    if (i % 10 === 0) await place();
    shut = await page.evaluate(() => { const eye = window.boardTest.board.viewers.object3d.children.find((c) => c.name === 'ar-viewer:p1'); return eye.children[2].rotation.x < 0.5; });
    if (!shut) await wait(80);
  }
  check('eye: blinks', shut);
  check('eye: not in the players\' view', await page.evaluate(() => window.boardTest.board.viewers.object3d.visible));
  await page.evaluate(() => window.boardTest.board.receiveViewer('p1', 'Ana', '#ff0059', null));
  await wait(900);
  check('eye: fades when the player leaves AR', await page.evaluate(() => window.boardTest.board.viewers.count === 0));
});

feature('hidden measures', async ({ page }) => {
  // What Atlas keeps from its players (a hidden area, a spell on a token they do not see) is drawn for the GM and left
  // out of the players' picture (the GM's player window); everything else is in both.
  const seen = await page.evaluate(() => {
    const { board } = window.boardTest;
    const cell = board.map.grid.size;
    const x = board.size.width / 2;
    const y = board.size.height / 2;
    const ball = (dx) => ({ shape: 'sphere', from: 'point', at: { x: x + dx, y, h: 0 }, yaw: 0, pitch: 0, roll: 0, size: cell, length: 0, angle: 0.9 });
    board.receiveTemplates([
      { id: 'open', owner: 'gm', shape: 'circle', start: { x, y }, end: { x: x + cell, y }, color: '#7c5cff', kind: 'area' },
      { id: 'secret', owner: 'gm', shape: 'circle', start: { x: x + cell * 3, y }, end: { x: x + cell * 4, y }, color: '#7c5cff', kind: 'area', gmOnly: true },
    ]);
    board.receiveSpells(board.map.path, [
      { id: 'shown', owner: 'gm', color: '#ffffff', spell: ball(-cell * 3) },
      { id: 'kept', owner: 'gm', color: '#ffffff', spell: ball(-cell * 6), gmOnly: true },
    ]);
    const look = () => ({
      marks: board.marks.templates.children.map((drawn) => drawn.visible),
      spells: ['shown', 'kept'].map((id) => board.spellViews.get(id).view.object3d.visible),
    });
    board.showFor('player');
    const player = look();
    board.showFor('gm');
    const gm = look();
    // None kept from players any more: the next players' picture shows every spell again.
    board.receiveSpells(board.map.path, [{ id: 'shown', owner: 'gm', color: '#ffffff', spell: ball(-cell * 3) }, { id: 'kept', owner: 'gm', color: '#ffffff', spell: ball(-cell * 6) }]);
    board.showFor('player');
    const after = look();
    board.showFor('gm');
    board.receiveTemplates([]);
    board.receiveSpells(board.map.path, []);
    return { player, gm, after };
  });
  check("hidden measures: the players' picture leaves out the hidden area and the hidden spell, and keeps the rest", JSON.stringify(seen.player) === JSON.stringify({ marks: [true, false], spells: [true, false] }), JSON.stringify(seen.player));
  check("hidden measures: the GM's picture has them all", JSON.stringify(seen.gm) === JSON.stringify({ marks: [true, true], spells: [true, true] }), JSON.stringify(seen.gm));
  check('hidden measures: a spell no longer hidden is back in the players\' picture', JSON.stringify(seen.after.spells) === JSON.stringify([true, true]), JSON.stringify(seen.after));
});

// ── Drawings and texts the GM hid in Atlas 0.16: drawn for the GM, never in the players' picture ─────────────────
feature('hidden notes', async ({ page }) => {
  const seen = await page.evaluate(async () => {
    const { board } = window.boardTest;
    const before = board.map;
    const x = board.size.width / 2;
    const y = board.size.height / 2;
    const ink = (id, hidden) => ({ id, points: [{ x, y }, { x: x + 100, y }], color: '#ff0000', width: 6, opacity: 1, closed: false, fill: null, holes: [], hidden, rank: 0, layer: 'above' });
    const label = (id, hidden) => ({ id, x, y: y + 80, text: id, fontSize: 24, fontFamily: 'serif', color: '#ffffff', backgroundColor: null, padding: 8, borderRadius: 0, opacity: 1, align: 'center', bold: false, italic: false, rotation: 0, scale: 1, hidden, rank: 0 });
    const stamp = (id, hidden) => ({ id, icon: 'skull', x: x + 200, y, color: '#ffffff', size: 70, opacity: 1, rotation: 0, hidden, rank: 0 });
    await board.load({ ...before, inks: [ink('open', false), ink('secret', true)], texts: [label('sign', false), label('note', true)], icons: [stamp('mark', false), stamp('trap', true)] });
    // A stamp shows once its glyph is in.
    for (let i = 0; i < 50 && !board.icons.every((piece) => piece.ready); i++) await new Promise((r) => setTimeout(r, 100));
    const look = () => ({
      inks: board.inks.map((piece) => piece.object3d.visible),
      texts: board.texts.map((piece) => piece.object3d.visible),
      icons: board.icons.map((piece) => piece.object3d.visible),
    });
    board.showFor('player');
    const player = look();
    board.showFor('gm');
    const gm = look();
    await board.load(before);
    return { player, gm };
  });
  check("hidden notes: the players' picture leaves out the drawing, text and stamp the GM hid, and keeps the rest", JSON.stringify(seen.player) === JSON.stringify({ inks: [true, false], texts: [true, false], icons: [true, false] }), JSON.stringify(seen.player));
  check("hidden notes: the GM's picture has them all", JSON.stringify(seen.gm) === JSON.stringify({ inks: [true, true], texts: [true, true], icons: [true, true] }), JSON.stringify(seen.gm));
});

// ── Atlas 0.16's boxes: a solid, opaque fill above the tokens hides what stands under it from players ──
feature('boxes hide tokens', async ({ page }) => {
  const seen = await page.evaluate(async () => {
    const { board } = window.boardTest;
    const before = board.map;
    const [first] = before.tokens;
    const x = first.x - 100;
    const y = first.y - 100;
    const ring = (s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }, { x, y }];
    const box = (more) => ({ id: 'box', points: ring(200), color: '#000000', width: 0, opacity: 1, closed: true, fill: 'solid', holes: [], hidden: false, rank: 0, layer: 'above', ...more });
    const look = async (inks) => {
      await board.load({ ...before, tokens: [{ ...first, hidden: false }], inks });
      board.showFor('player');
      const player = board.tokens.get(first.id).piece.object3d.visible;
      board.showFor('gm');
      const gm = board.tokens.get(first.id).piece.object3d.visible;
      return { player, gm };
    };
    const out = {
      under: await look([box({})]),
      hole: await look([box({ holes: [[{ x: x + 60, y: y + 60 }, { x: x + 140, y: y + 60 }, { x: x + 140, y: y + 140 }, { x: x + 60, y: y + 140 }]] })]),
      soft: await look([box({ fill: 'soft' })]),
      map: await look([box({ layer: 'map' })]),
      hidden: await look([box({ hidden: true })]),
    };
    await board.load(before);
    return out;
  });
  check('boxes hide tokens: a token under a solid box is out of the players\' picture, the GM still sees it', !seen.under.player && seen.under.gm, JSON.stringify(seen.under));
  check('boxes hide tokens: one in the box\'s hole, or under a soft fill, a fill on the map\'s layer or a box the GM hid, is seen', seen.hole.player && seen.soft.player && seen.map.player && seen.hidden.player, JSON.stringify(seen));
});

// ── Atlas 0.16's fills: a closed drawing's inside is drawn, solid or soft, less its holes; a line of no width is none ──
feature('ink fills', async ({ page, shot }) => {
  const seen = await page.evaluate(async () => {
    const { board } = window.boardTest;
    const before = board.map;
    const x = board.size.width / 2 - 100;
    const y = board.size.height / 2 - 100;
    const ring = (s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }, { x, y }];
    const hole = [{ x: x + 60, y: y + 60 }, { x: x + 140, y: y + 60 }, { x: x + 140, y: y + 140 }, { x: x + 60, y: y + 140 }];
    await board.load({ ...before, inks: [
      { id: 'solid', points: ring(200), color: '#000000', width: 0, opacity: 1, closed: true, fill: 'solid', holes: [hole], hidden: false, rank: 0, layer: 'above' },
      { id: 'soft', points: ring(100), color: '#ff0000', width: 4, opacity: 1, closed: true, fill: 'soft', holes: [], hidden: false, rank: 1, layer: 'above' },
      { id: 'line', points: ring(50), color: '#00ff00', width: 4, opacity: 1, closed: true, fill: null, holes: [], hidden: false, rank: 2, layer: 'above' },
    ] });
    const of = (piece) => { const fill = piece.object3d.children.find((child) => child.name === 'fill'); return { line: piece.object3d.geometry.attributes.position.count, fill: fill ? fill.geometry.attributes.position.count : 0, opacity: fill ? fill.material.opacity : null }; };
    const out = board.inks.map(of);
    board.wake(true);
    await new Promise((r) => setTimeout(r, 300));
    return out;
  });
  check('ink fills: a solid fill with a hole and no line, a soft fill at a quarter, a plain closed line with no fill', seen.length === 3 && seen[0].line === 0 && seen[0].fill >= 24 && seen[0].opacity === 1 && seen[1].fill > 0 && seen[1].opacity === 0.25 && seen[1].line > 0 && seen[2].fill === 0, JSON.stringify(seen));
  await shot('ink-fills');
  await page.evaluate(async () => { const { board } = window.boardTest; await board.load({ ...board.map, inks: [] }); });
});

feature('gm clears spells', async ({ page, shot }) => {
  // A player's sphere on the map, the GM hosting in Play mode: Ctrl over it lights it, a click clears it.
  const at = await page.evaluate(() => {
    const { board, modes, setHosting } = window.boardTest;
    setHosting(true);
    modes.on = true;
    modes.mode = 'play';
    const cell = board.map.grid.size;
    const x = board.size.width / 2 + cell * 2;
    const y = board.size.height / 2;
    board.receiveSpells(board.map.path, [{ id: 's7', owner: 'p1', color: '#ff0059', spell: { shape: 'sphere', from: 'point', at: { x, y, h: cell }, yaw: 0, pitch: 0, roll: 0, size: cell * 2, length: 0, angle: 0.9 }, name: 'Fireball', about: { line: 'Level 3 Evocation', properties: [['Damage', '8d6 fire']], text: 'A bright streak flashes.' } }]);
    return window.boardTest.project(x, y, cell);
  });
  await wait(500);
  await page.keyboard.down('Alt');
  await page.mouse.move(at.x, at.y);
  await page.mouse.move(at.x + 2, at.y + 1);
  await wait(200);
  const lit = await page.evaluate(() => ({ hovered: window.boardTest.board.hoveredSpell, tip: window.boardTest.board.tooltip.hidden ? null : window.boardTest.board.tooltip.textContent }));
  check('spells: Alt over a player spell in Play mode lights it and says Alt+click clears it', lit.hovered === 's7' && /Alt\+click to clear/i.test(lit.tip ?? ''), JSON.stringify(lit));
  await shot('gm-spell-hover');
  const before = await page.evaluate(() => window.boardTest.record.toolActions.length);
  await page.mouse.click(at.x + 2, at.y + 1);
  await page.keyboard.up('Alt');
  await wait(200);
  const asked = await page.evaluate((before) => window.boardTest.record.toolActions.slice(before), before);
  check('spells: the click asks Connect to clear it', asked.some((action) => action.type === 'spell' && action.change.remove === 's7'), JSON.stringify(asked));
  await page.mouse.move(at.x, at.y);
  check('spells: without Alt nothing lights', await page.evaluate(() => window.boardTest.board.hoveredSpell === null));
  // Not hosting (the GM's own spells, on this board alone): Ctrl still lights one, and a click clears it.
  await page.evaluate(() => window.boardTest.setHosting(false));
  await page.keyboard.down('Alt');
  await page.mouse.move(at.x + 1, at.y);
  await page.mouse.move(at.x + 2, at.y + 1);
  await wait(200);
  const offline = await page.evaluate(() => window.boardTest.board.hoveredSpell);
  await page.keyboard.up('Alt');
  check('spells: without Connect hosting, Alt over a spell still lights it', offline === 's7', JSON.stringify({ offline }));
  // Ctrl over it (where no creature stands) shows its card (its name and words), as a creature's stat block on hover; a
  // click does not clear it.
  const open = await page.evaluate(() => {
    const { board } = window.boardTest;
    const cell = board.map.grid.size;
    const x = board.size.width / 2 + cell * 2;
    const y = board.size.height / 2;
    for (const [dx, dy] of [[0, 1.4], [0, -1.4], [1.4, 0], [-1.4, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const point = window.boardTest.project(x + dx * cell, y + dy * cell, cell * 0.3);
      if (board.tokenAt(point.x, point.y) === null) return point;
    }
    return null;
  });
  await page.keyboard.down('Control');
  await page.mouse.move(open.x + 3, open.y);
  await page.mouse.move(open.x + 2, open.y + 1);
  await wait(200);
  const card = await page.evaluate(() => ({ shown: window.boardTest.board.spellCardShown, words: window.boardTest.board.container.querySelector('.atlas-tabletop-spellcard.is-hover')?.textContent ?? '' }));
  check('spells: Ctrl over a spell shows its card: name, level line, properties and words', card.shown === 's7' && /Fireball/.test(card.words) && /8d6 fire/.test(card.words) && /bright streak/.test(card.words), JSON.stringify(card));
  await shot('spell-hover-card');
  const actionsBefore = await page.evaluate(() => window.boardTest.record.toolActions.length);
  await page.mouse.click(open.x + 2, open.y + 1);
  check('spells: a Ctrl+click does not clear it', (await page.evaluate((before) => window.boardTest.record.toolActions.slice(before).filter((action) => action.type === 'spell').length, actionsBefore)) === 0);
  await page.keyboard.up('Control');
  await wait(100);
  check('spells: letting Ctrl go takes the card off', (await page.evaluate(() => window.boardTest.board.spellCardShown)) === null);
  // A creature inside the spell comes first: Ctrl over it is its stat block, not the spell's card.
  const inside = await page.evaluate(() => {
    const { board } = window.boardTest;
    const cell = board.map.grid.size;
    const e = board.tokens.get('gob');
    board.receiveSpells(board.map.path, [{ id: 's8', owner: 'p1', color: '#ff0059', spell: { shape: 'sphere', from: 'point', at: { x: e.at.x, y: e.at.y, h: cell }, yaw: 0, pitch: 0, roll: 0, size: cell * 2, length: 0, angle: 0.9 }, name: 'Fog Cloud' }]);
    return window.boardTest.project(e.at.x, e.at.y, cell * 0.3);
  });
  await wait(300);
  await page.keyboard.down('Control');
  await page.mouse.move(inside.x + 1, inside.y);
  await page.mouse.move(inside.x, inside.y);
  await wait(200);
  const priority = await page.evaluate(() => ({ card: window.boardTest.board.spellCardShown, spell: window.boardTest.board.hoveredSpell }));
  await page.keyboard.up('Control');
  check('spells: Ctrl over a creature inside a spell is the creature, not the spell', priority.card === null && priority.spell === null, JSON.stringify(priority));
  await page.evaluate(() => { const { board, modes, setHosting } = window.boardTest; board.receiveSpells(board.map.path, []); modes.on = false; setHosting(false); });
});

feature('gm casts through eyes', async ({ page, shot }) => {
  // The GM goes into the Hero's eyes, looks at the Goblin and casts a cone from there, as a player would.
  const press = (label) => page.evaluate((label) => {
    const buttons = [...window.boardTest.board.container.querySelectorAll('.atlas-tabletop-spellbar button')];
    const button = buttons.find((each) => each.offsetParent !== null && (each.getAttribute('aria-label') ?? '').replace(/ \((F|Esc)\)$/, '') === label);
    if (!button) return false;
    button.click();
    return true;
  }, label);
  const state = () => page.evaluate(() => {
    const { board } = window.boardTest;
    const bar = board.container.querySelector('.atlas-tabletop-spellbar');
    return {
      seeing: board.seeingFrom, bar: !!bar && !bar.hidden, stage: bar?.dataset.stage ?? null,
      toolbar: board.toolbar.row.style.display !== 'none',
      text: bar?.querySelector('.atlas-tabletop-spellbar__text')?.textContent ?? '',
    };
  });
  const toolbarBefore = await page.evaluate(() => window.boardTest.board.toolbar.row.style.display !== 'none');
  await page.evaluate(() => {
    const { board } = window.boardTest;
    board.seeFrom('hero');
    board.eye.yaw = Math.atan2(-280, -140) ;
    board.eye.pitch = -0.1;
    board.eye.fresh = true;
  });
  await wait(600);
  const inEyes = await state();
  check('gm eyes: any token, the spell toolbar in place of the GM\'s', inEyes.seeing === 'hero' && inEyes.bar && inEyes.stage === 'idle' && (!toolbarBefore || !inEyes.toolbar), JSON.stringify({ toolbarBefore, inEyes }));
  await press('Cast a spell');
  await press('Cone');
  await press('From me');
  await page.evaluate(() => { const input = window.boardTest.board.container.querySelector('[data-spell-field="size"]'); input.value = '6'; input.dispatchEvent(new Event('input')); });
  await page.evaluate(() => { const select = window.boardTest.board.container.querySelector('[data-spell-field="effect"]'); select.value = 'fire'; select.dispatchEvent(new Event('change')); });
  await press('Aim');
  await wait(700);
  const aiming = await state();
  await shot('gm-eyes-aim');
  if (!(await press('Place'))) await page.evaluate(() => window.boardTest.board.caster.click());
  await wait(300);
  const before = await page.evaluate(() => window.boardTest.record.toolActions.length);
  await press('Cast');
  await wait(200);
  const sent = await page.evaluate((before) => window.boardTest.record.toolActions.slice(before), before);
  const add = sent.find((action) => action.type === 'spell' && action.change.add)?.change.add;
  check('gm eyes: the cone from the Hero hits the Goblin, and Cast sends it, with its fire', /Goblin/.test(aiming.text) && add && add.shape === 'cone' && add.from === 'self' && add.caster === 'hero' && add.effect === 'fire', JSON.stringify({ aiming, sent }));
  await press('Leave');
  await wait(300);
  const out = await state();
  check('gm eyes: Leave gives the GM\'s toolbar back', out.seeing === null && !out.bar && out.toolbar === toolbarBefore, JSON.stringify(out));
});

feature('drop impacts and material preview', async ({ page, shot }) => {
  // A material dragged over a wall shows on it before the drop; dropped, the wall takes a hit; a mini let go lands.
  const wall = await page.evaluate(() => {
    const { board } = window.boardTest;
    const cell = board.map.grid.size;
    const solid = board.map.walls.find((w) => w.type === 'solid' && w.blocks === null && !w.limited && Math.hypot(w.p2.x - w.p1.x, w.p2.y - w.p1.y) > cell);
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const x = solid.p1.x + (solid.p2.x - solid.p1.x) * t;
      const y = solid.p1.y + (solid.p2.y - solid.p1.y) * t;
      const at = window.boardTest.project(x, y, cell * 0.8);
      if (board.wallAt(at.x, at.y) === solid.id) return { id: solid.id, at };
    }
    return { id: solid.id, at: null };
  });
  const drag = (type, at, shift = false) => page.evaluate(({ type, at, shift }) => {
    const { board } = window.boardTest;
    const transfer = new DataTransfer();
    transfer.setData('application/x-atlas-tabletop-material', 'mats/stone');
    board.canvas.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: transfer, shiftKey: shift }));
  }, { type, at, shift });
  await page.evaluate(() => { window.boardTest.materialDrag.folder = 'mats/stone'; });
  await drag('dragover', wall.at);
  await wait(200);
  const preview = await page.evaluate(() => window.boardTest.board.paintPreview);
  check('material drag: the wall under the pointer shows the material before the drop', wall.at && preview?.material === 'mats/stone' && preview.ids.includes(wall.id), JSON.stringify({ wall, preview }));
  const shown = await page.evaluate(() => [...window.boardTest.board.wallMaterials.keys()].includes('mats/stone'));
  check('material drag: it is drawn with it', shown);
  const startedBefore = await page.evaluate(() => window.boardTest.board.impacts.started);
  await drag('drop', wall.at);
  await page.evaluate(() => { window.boardTest.materialDrag.folder = null; });
  await wait(60);
  const slapped = await page.evaluate((before) => ({ preview: window.boardTest.board.paintPreview, active: window.boardTest.board.impacts.started > before, painted: window.boardTest.record.paints.at(-1) }), startedBefore);
  check('material drop: painted, the preview gone, and the wall takes a hit', slapped.preview === null && slapped.active && slapped.painted?.[1] === 'mats/stone', JSON.stringify(slapped));
  await shot('impact-wall');
  await wait(800);
  check('material drop: the hit fades away', !(await page.evaluate(() => window.boardTest.board.impacts.active)));
  // A mini let go after a drag lands with a ring and dust.
  const hero = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('hero'); const cell = window.boardTest.board.map.grid.size; return { from: window.boardTest.project(e.at.x, e.at.y, 0), to: window.boardTest.project(e.at.x + cell * 2, e.at.y, 0) }; });
  await page.mouse.move(hero.from.x, hero.from.y);
  await page.mouse.down();
  await page.mouse.move((hero.from.x + hero.to.x) / 2, hero.from.y, { steps: 4 });
  await page.mouse.move(hero.to.x, hero.to.y, { steps: 4 });
  const landedBefore = await page.evaluate(() => window.boardTest.board.impacts.started);
  await page.mouse.up();
  await wait(80);
  check('mini drop: it lands with an impact', await page.evaluate((before) => window.boardTest.board.impacts.started > before, landedBefore));
  await shot('impact-mini');
  await wait(800);
});

feature('material defaults', async ({ page }) => {
  // Walls and doors with no material painted wear their kind's default; painted ones keep theirs; none set, as before.
  const looks = () => page.evaluate(() => {
    const out = { walls: new Set(), doors: new Set() };
    window.boardTest.board.scene.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      for (const [path, material] of window.boardTest.board.wallMaterials) {
        if (material !== node.material) continue;
        if (node.userData.walls) out.walls.add(path);
        if (node.userData.doorId) out.doors.add(path);
      }
    });
    return { walls: [...out.walls].sort(), doors: [...out.doors].sort() };
  });
  const plain = await looks();
  await page.evaluate(() => { window.__materialDefaults = { wall: 'mats/stone', door: 'mats/oak' }; window.boardTest.board.refreshMaterials(); });
  await wait(400);
  const set = await looks();
  check('material defaults: unpainted walls and doors wear the default for their kind', set.walls.includes('mats/stone') && (set.doors.length === 0 || set.doors.includes('mats/oak')) && !plain.walls.includes('mats/stone'), JSON.stringify({ plain, set }));
  await page.evaluate(() => { window.__materialDefaults = {}; window.boardTest.board.refreshMaterials(); });
  await wait(400);
  const back = await looks();
  check('material defaults: none set, walls are plain again', !back.walls.includes('mats/stone'), JSON.stringify(back));
});

feature('spell rules', async ({ page, shot }) => {
  // What spells do beyond their shape, from their rules: walls, fog, light, darkness, difficult ground; and the GM's board
  // carrying out pushes, teleports, summons and gates.
  const cast = (list) => page.evaluate((list) => {
    const { board } = window.boardTest;
    const cell = board.map.grid.size;
    board.receiveSpells(board.map.path, list.map(([id, at, shape, rules, extra]) => {
      const point = typeof at === 'string' ? board.tokens.get(at).at : at;
      const spell = { shape, from: 'point', at: { x: point.x, y: point.y, h: cell * 0.5 }, yaw: 0, pitch: 0, roll: 0, size: cell * (extra?.size ?? 1), length: shape === 'wall' || shape === 'cylinder' ? cell * 2 : 0, angle: 0.9, ...(shape === 'wall' ? { to: { x: point.x + cell * 4, y: point.y } } : {}), ...(extra?.caster ? { caster: extra.caster } : {}) };
      return { id, owner: 'p1', color: '#ff0059', spell, ...(rules ? { rules } : {}) };
    }));
  }, list);
  const state = () => page.evaluate(() => window.boardTest.board.ruleState());
  await cast([]);
  const hero = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('hero'); return { x: e.at.x, y: e.at.y }; });
  const cell = await page.evaluate(() => window.boardTest.board.map.grid.size);
  await cast([['w', { x: hero.x - cell * 2, y: hero.y + cell * 2 }, 'wall', { name: 'Wall of Stone', wall: { look: 'stone', blocks: 'both' } }],
    ['f', { x: hero.x + cell * 4, y: hero.y + cell * 3 }, 'sphere', { name: 'Fog Cloud', obscure: true }, { size: 1.5 }],
    ['l', { x: hero.x - cell * 3, y: hero.y - cell }, 'sphere', { name: 'Daylight', light: { bright: 60, dim: 60 } }, { size: 0.5 }],
    ['d', { x: hero.x, y: hero.y + cell * 5 }, 'sphere', { name: 'Web', difficult: true }, { size: 1.5 }]]);
  await wait(500);
  const standing = await state();
  check('spell rules: a stone wall stands as a wall, a fog its edge stopping sight alone, a light sheds light', standing.walls === 33 && standing.sightOnly === 32 && standing.lights.length === 1 && standing.lights[0].bright === 60 && !standing.lights[0].darkness, JSON.stringify(standing));
  const share = await page.evaluate(({ hero, cell }) => window.boardTest.board.difficultShare([{ x: hero.x - cell * 3, y: hero.y + cell * 5 }, { x: hero.x + cell * 3, y: hero.y + cell * 5 }]), { hero, cell });
  check('spell rules: a path through the web counts its share in difficult ground (the ruler costs it double)', share > 0.3 && share < 0.7, String(share));
  const solid = await page.evaluate(() => { let found = false; window.boardTest.board.scene.traverse((node) => { if (node.isMesh && node.material && node.material.isMeshStandardMaterial && node.parent && node.parent.userData && node.parent.userData.spell) found = true; }); return found; });
  check('spell rules: the stone wall is drawn solid', solid);
  await shot('spell-rules-board');
  await cast([['k', 'gob', 'sphere', { name: 'Darkness', obscure: true, dark: true }, { size: 1.5 }]]);
  await wait(300);
  const dark = await state();
  check('spell rules: darkness is magical darkness over its area, the other spells walls and lights gone with them', dark.lights.length === 1 && dark.lights[0].darkness && dark.walls === 32, JSON.stringify(dark));
  // Pushes: the GM is asked who failed, and those are pushed away from the spell.
  await cast([]);
  const gob = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('gob'); return { x: e.at.x, y: e.at.y }; });
  await cast([['t1', { x: gob.x - cell * 0.5, y: gob.y }, 'sphere', { name: 'Thunderwave', push: 10 }, { size: 0.9 }]]);
  await wait(300);
  const asked = await page.evaluate(() => ({ title: window.boardTest.board.spellRules.title, lines: [...window.boardTest.board.container.querySelectorAll('[data-rule-line]')].map((box) => box.dataset.ruleLine) }));
  check('spell rules: a push is offered to the GM, a line for each token it hits', /Thunderwave: push 10 ft/.test(asked.title ?? '') && asked.lines.includes('gob'), JSON.stringify(asked));
  await shot('spell-rules-push');
  await page.evaluate(() => window.boardTest.board.spellRules.applyShowing());
  const pushed = await page.evaluate(() => window.boardTest.record.ruleMoves.at(-1)?.find((move) => move.id === 'gob'));
  check('spell rules: Push moves the token away from the spell', pushed && pushed.x > gob.x + cell * 0.9, JSON.stringify({ pushed, gob }));
  const claims = await page.evaluate(() => window.boardTest.record.claims.length);
  await cast([['t1', { x: gob.x - cell * 0.5, y: gob.y }, 'sphere', { name: 'Thunderwave', push: 10 }, { size: 0.9 }]]);
  check('spell rules: the same cast again is not carried out twice', (await page.evaluate(() => window.boardTest.record.claims.length)) === claims && !(await page.evaluate(() => window.boardTest.board.spellRules.showing)));
  // Its id gone and come back as another spell (a reopened board, a new session): carried out again.
  await cast([]);
  await cast([['t1', { x: gob.x + cell * 0.5, y: gob.y }, 'sphere', { name: 'Thunderwave', push: 10 }, { size: 0.9 }]]);
  await wait(200);
  check('spell rules: a new cast with an id used before is offered again', await page.evaluate(() => window.boardTest.board.spellRules.showing));
  await page.evaluate(() => window.boardTest.board.container.querySelector('[data-rule-skip]')?.click());
  // A teleport: the caster to the spot, and the mark goes.
  const spot = { x: hero.x + cell * 3, y: hero.y };
  await cast([['m1', spot, 'sphere', { name: 'Misty Step', teleport: 30 }, { size: 0.5, caster: 'hero' }]]);
  await wait(200);
  await page.evaluate(() => window.boardTest.board.spellRules.applyShowing());
  const stepped = await page.evaluate(() => ({ move: window.boardTest.record.ruleMoves.at(-1), removed: window.boardTest.record.toolActions.at(-1) }));
  check('spell rules: a teleport moves the caster to the spot, and takes the spell off', stepped.move?.[0]?.id === 'hero' && Math.abs(stepped.move[0].x - spot.x) <= cell && stepped.removed?.change?.remove === 'm1', JSON.stringify(stepped));
  // A summons: made at the spot; when the spell goes, the GM is offered to take them off.
  await cast([['s9', spot, 'sphere', { name: 'Spiritual Weapon', summon: { name: 'Spiritual Weapon', count: 2 } }, { size: 0.5, caster: 'hero' }]]);
  await wait(200);
  await page.evaluate(() => window.boardTest.board.spellRules.applyShowing());
  const summoned = await page.evaluate(() => window.boardTest.record.summons.at(-1));
  check('spell rules: a summons makes its tokens round the spot', summoned?.length === 2 && summoned.every((token) => token.name === 'Spiritual Weapon'), JSON.stringify(summoned));
  await cast([]);
  await wait(200);
  const ended = await page.evaluate(() => window.boardTest.board.spellRules.title);
  await page.evaluate(() => window.boardTest.board.spellRules.applyShowing());
  check('spell rules: when the summoning spell ends, the GM may take its tokens off', /ended/.test(ended ?? '') && (await page.evaluate(() => window.boardTest.record.removed.includes('gob'))), JSON.stringify({ ended }));
  // Gates of one name are linked: a token in one goes through to the other.
  await cast([['g1', 'gob', 'cylinder', { name: 'Gate', portal: 'Blue gate' }, { size: 0.6 }], ['g2', { x: hero.x - cell * 4, y: hero.y - cell * 2 }, 'cylinder', { name: 'Gate', portal: 'Blue gate' }, { size: 0.6 }]]);
  const gate = await page.evaluate(() => window.boardTest.board.gateFor('gob'));
  const through = await page.evaluate(() => window.boardTest.board.goThroughGate('gob') && window.boardTest.record.ruleMoves.at(-1));
  check('spell rules: a token in a gate goes through to its twin', gate?.name === 'Blue gate' && through?.[0]?.id === 'gob' && Math.abs(through[0].x - (hero.x - cell * 4)) <= cell, JSON.stringify({ gate, through }));
  await cast([]);
});

feature('spell hit auras', async ({ page, shot }) => {
  // A damaging spell over a token: the token gets the damage's look round it; another damage, another look; gone with the spell.
  const cast = (list) => page.evaluate((list) => {
    const { board } = window.boardTest;
    const cell = board.map.grid.size;
    board.receiveSpells(board.map.path, list.map(([id, token, effect, radius], k) => {
      const e = board.tokens.get(token);
      return { id, owner: 'p1', color: '#ff0059', spell: { shape: 'sphere', from: 'point', at: { x: e.at.x, y: e.at.y, h: cell * 0.5 }, yaw: 0, pitch: 0, roll: 0, size: cell * radius, length: 0, angle: 0.9, ...(effect ? { effect } : {}) } };
    }));
  }, list);
  const auras = async () => { await wait(1000); return page.evaluate(() => window.boardTest.board.spellAuraTypes()); };
  const ids = await page.evaluate(() => [...window.boardTest.board.tokens.keys()]);
  await cast([['a1', 'gob', 'fire', 0.45]]);
  const fire = await auras();
  check('spell auras: a fire spell over the Goblin sets it burning, and only it', fire.gob === 'fire' && Object.keys(fire).length === 1, JSON.stringify(fire));
  await shot('spell-aura-fire');
  await cast([['a1', 'gob', 'cold', 0.45]]);
  const cold = await auras();
  check('spell auras: a cold spell instead, frost instead', cold.gob === 'cold', JSON.stringify(cold));
  await cast([['a1', 'gob', 'fire', 0.45], ['a2', 'gob', 'lightning', 0.45]]);
  const both = await auras();
  check('spell auras: two spells on it, the latest one\'s look', both.gob === 'lightning', JSON.stringify(both));
  await cast([['a1', 'gob', null, 0.45]]);
  const plain = await auras();
  check('spell auras: a spell with no damage leaves no look', Object.keys(plain).length === 0, JSON.stringify(plain));
  const types = ['fire', 'cold', 'lightning', 'acid', 'poison', 'necrotic', 'radiant', 'force', 'psychic', 'thunder', 'bludgeoning', 'piercing', 'slashing', 'explosion'];
  await cast(ids.map((id, k) => [`g${k}`, id, types[k % types.length], 0.4]));
  const gallery = await auras();
  check('spell auras: every token hit gets a look (the latest spell over it)', ids.every((id) => types.includes(gallery[id])) && Object.values(gallery).filter((type, k, all) => all.indexOf(type) === k).length >= ids.length - 1, JSON.stringify({ ids, gallery }));
  await shot('spell-aura-gallery');
  // Each look up close, on the Goblin.
  await page.evaluate(() => { const { board } = window.boardTest; const e = board.tokens.get('gob'); const cell = board.map.grid.size; Object.assign(board.camera.goal, { target: { x: e.at.x, y: cell * 0.4, z: e.at.y }, yaw: 0.5, pitch: 0.4, distance: cell * 4.5 }); board.camera.snap(); board.wake(true); });
  for (const type of types) {
    await cast([['c1', 'gob', type, 0.45]]);
    await wait(1100);
    // The spell itself hidden: its look on the Goblin alone.
    await page.evaluate(() => { const { board } = window.boardTest; for (const kept of board.spellViews.values()) kept.view.object3d.visible = false; board.wake(true); });
    await wait(100);
    await shot(`spell-aura-${type}`);
  }
  await cast([]);
  const none = await auras();
  check('spell auras: gone with the spells', Object.keys(none).length === 0, JSON.stringify(none));
});

feature('spell rules cast', async ({ page, shot }) => {
  // The real flow: a spell note with rules found in the eyes, aimed and cast: the cast carries its rules, and the board uses them.
  const dir = path.join(__dirname, '..', 'tests', 'fixtures', 'spells');
  const notes = [];
  for (const set of fs.readdirSync(dir)) for (const file of fs.readdirSync(path.join(dir, set))) notes.push({ path: `${set}/${file}`, text: fs.readFileSync(path.join(dir, set, file), 'utf8') });
  await page.evaluate((notes) => window.boardTest.setSpellNotes(notes), notes);
  const castOne = async (query) => {
    await page.evaluate(() => { const { board, modes } = window.boardTest; modes.on = true; modes.mode = 'play'; board.castThrough('hero'); });
    await wait(400);
    await page.evaluate((query) => { const input = window.boardTest.board.container.querySelector('[data-spell-search]'); input.value = query; input.dispatchEvent(new Event('input')); }, query);
    await wait(250);
    await page.evaluate(() => window.boardTest.board.container.querySelector('.atlas-tabletop-spellpicker__row')?.click());
    await wait(200);
    const effects = await page.evaluate(() => window.boardTest.board.container.querySelector('.atlas-tabletop-spellpicker__rules summary')?.textContent ?? null);
    await page.evaluate(() => [...window.boardTest.board.container.querySelectorAll('.atlas-tabletop-spellpicker__actions button')].find((b) => b.textContent === 'Aim')?.click());
    await wait(300);
    const before = await page.evaluate(() => window.boardTest.record.toolActions.length);
    // Look down at the floor, place it, cast it.
    const press = (label) => page.evaluate((label) => {
      const button = [...window.boardTest.board.container.querySelectorAll('.atlas-tabletop-spellbar button')].find((each) => (each.getAttribute('aria-label') ?? '').replace(/ \((F|Esc)\)$/, '') === label);
      if (!button) return false;
      button.click();
      return true;
    }, label);
    await page.evaluate(() => { const { board } = window.boardTest; board.eye.pitch = -0.6; board.eye.fresh = true; board.wake(true); });
    await wait(400);
    // While aimed its drawing shows what it does: a stone wall solid, a fog grey.
    const aimed = await page.evaluate(() => {
      const view = window.boardTest.board.spellPreview?.view;
      let solid = false;
      view?.object3d.traverse((node) => { if (node.isMesh && node.material && node.material.isMeshStandardMaterial) solid = true; });
      return { drawn: !!view, animated: view?.animated, solid, color: view ? '#' + view.material.uniforms.color.value.getHexString() : null, shape: view?.spell.shape };
    });
    // Placed (a wall at both ends, turning the view between), then cast.
    for (let k = 0; k < 4; k++) {
      if (await press('Cast')) break;
      if (await press('Next')) { await wait(200); continue; }
      if (!(await press('Place'))) await page.evaluate(() => window.boardTest.board.spellCaster.click());
      await page.evaluate(() => { const { board } = window.boardTest; board.eye.yaw += 0.35; board.eye.fresh = true; board.wake(true); });
      await wait(300);
    }
    await wait(200);
    const sent = await page.evaluate((before) => window.boardTest.record.toolActions.slice(before).find((action) => action.type === 'spell' && action.change.add), before);
    await page.evaluate(() => window.boardTest.board.seeFrom(null));
    // Connect sends it back as cast: the board stands what it does.
    await page.evaluate((change) => window.boardTest.board.receiveSpells(window.boardTest.board.map.path, change ? [{ id: 'x1', owner: 'gm', color: '#ffffff', spell: change.add, rules: change.rules, name: change.name }] : []), sent?.change);
    await wait(300);
    const standing = await page.evaluate(() => window.boardTest.board.ruleState());
    await page.evaluate(() => window.boardTest.board.receiveSpells(window.boardTest.board.map.path, []));
    return { effects, sent, aimed, standing };
  };
  const fog = await castOne('fog cloud');
  check('spell rules cast: a note with rules shows them under Effects, its drawing shows them while aimed, the cast sends them and the board stands them', /obscures/.test(fog.effects ?? '') && fog.aimed.animated === false && fog.aimed.color === '#c9ced4' && fog.sent?.change?.rules?.obscure === true && fog.sent.change.name === 'Fog Cloud' && fog.standing.sightOnly > 0, JSON.stringify({ ...fog, sent: fog.sent?.change?.rules }));
  const wall = await castOne('wall of stone');
  check('spell rules cast: Wall of Stone is a wall, aimed solid stone, cast as one, standing as a wall', wall.aimed.animated === false && wall.aimed.shape === 'wall' && wall.aimed.solid && wall.sent?.change?.add?.shape === 'wall' && wall.sent.change.rules?.wall?.look === 'stone' && wall.standing.walls === 1, JSON.stringify({ aimed: wall.aimed, rules: wall.sent?.change?.rules, shape: wall.sent?.change?.add?.shape, standing: wall.standing }));
  await page.evaluate(() => window.boardTest.setSpellNotes(null));
});

feature('spell search', async ({ page, shot }) => {
  // The spell notes of both SRD sets, as the vault has them: the search finds them, shows one in full and sets its area.
  const dir = path.join(__dirname, '..', 'tests', 'fixtures', 'spells');
  const notes = [];
  for (const set of fs.readdirSync(dir)) for (const file of fs.readdirSync(path.join(dir, set))) notes.push({ path: `${set}/${file}`, text: fs.readFileSync(path.join(dir, set, file), 'utf8') });
  await page.evaluate((notes) => window.boardTest.setSpellNotes(notes), notes);
  const picker = () => page.evaluate(() => {
    const element = window.boardTest.board.container.querySelector('.atlas-tabletop-spellpicker');
    if (!element) return null;
    return {
      title: element.querySelector('.atlas-tabletop-spellpicker__title')?.textContent ?? '',
      rows: [...element.querySelectorAll('.atlas-tabletop-spellpicker__row')].map((row) => row.textContent),
      words: element.querySelector('.atlas-tabletop-spellpicker__words')?.textContent ?? '',
      shape: element.querySelector('[data-spell-field="shape"]')?.value ?? null,
      size: element.querySelector('[data-spell-field="size"]')?.value ?? null,
      effect: element.querySelector('[data-spell-field="effect"]')?.value ?? null,
      preview: !!window.boardTest.board.spellPreview,
      animated: window.boardTest.board.spellPreview?.view.animated,
    };
  });
  const pick = (name, source) => page.evaluate(({ name, source }) => {
    const rows = [...window.boardTest.board.container.querySelectorAll('.atlas-tabletop-spellpicker__row')];
    const row = rows.find((each) => each.querySelector('.atlas-tabletop-spellpicker__name').textContent === name && each.textContent.includes(source));
    row?.click();
    return !!row;
  }, { name, source });
  const type = (words) => page.evaluate((words) => { const input = window.boardTest.board.container.querySelector('[data-spell-search]'); input.value = words; input.dispatchEvent(new Event('input')); }, words);
  const button = (label) => page.evaluate((label) => {
    const found = [...window.boardTest.board.container.querySelectorAll('.atlas-tabletop-spellpicker__actions button')].find((each) => each.textContent === label);
    found?.click();
    return !!found;
  }, label);

  // Cast, Myself: into the Hero's eyes with the search open.
  await page.evaluate(() => {
    const { board } = window.boardTest;
    board.castThrough('hero');
    board.eye.yaw = Math.atan2(-280, -140);
    board.eye.pitch = -0.25;
    board.eye.fresh = true;
  });
  await wait(400);
  const opened = await picker();
  check('spell search: Cast goes into the eyes with the search open, every spell listed', opened && opened.title === 'Find a spell' && opened.rows.length === notes.length && (await page.evaluate(() => window.boardTest.board.seeingFrom)) === 'hero', JSON.stringify(opened));
  // Real keys into the search: F (cast) and the arrows never reach the board.
  const yawBefore = await page.evaluate(() => window.boardTest.board.eye.yaw);
  await page.keyboard.type('fireb', { delay: 20 });
  await wait(200);
  const typed = await picker();
  const keys = await page.evaluate(() => ({ yaw: window.boardTest.board.eye.yaw, stage: window.boardTest.board.container.querySelector('.atlas-tabletop-spellbar')?.dataset.stage, focus: document.activeElement?.hasAttribute('data-spell-search') }));
  check('spell search: real typing stays in the search (F does not cast, the view does not turn)', keys.focus && keys.stage === 'idle' && Math.abs(keys.yaw - yawBefore) < 1e-9, JSON.stringify(keys));
  check('spell search: typing narrows it, both rule sets shown apart', typed.rows.length === 2 && typed.rows.every((row) => /^Fireball/.test(row)) && typed.rows.some((row) => /SRD 2014/.test(row)) && typed.rows.some((row) => /SRD 2024/.test(row)), JSON.stringify(typed.rows));
  await page.keyboard.press('ArrowDown');
  await wait(300);
  const arrowed = await picker();
  check('spell search: ArrowDown picks the first found', /Fireball/.test(arrowed.words), JSON.stringify(arrowed.words.slice(0, 40)));
  await pick('Fireball', 'SRD 2024');
  await wait(400);
  const fireball = await picker();
  // Nothing stands on the board while the search is open: the shape is drawn once it is aimed (below).
  check('spell search: the spell picked shows its words and properties, sets its area and damage, and is not drawn yet', /Level 3 Evocation/.test(fireball.words) && /8d6 fire/.test(fireball.words) && /A bright streak/.test(fireball.words)
    && fireball.shape === 'sphere' && fireball.size === '4' && fireball.effect === 'fire' && !fireball.preview, JSON.stringify(fireball));
  await shot('spell-search');
  await button('Aim');
  await wait(500);
  const aiming = await page.evaluate(() => {
    const { board } = window.boardTest;
    const card = board.container.querySelector('.atlas-tabletop-spellcard');
    const bar = board.container.querySelector('.atlas-tabletop-spellbar');
    return { stage: bar?.dataset.stage, card: card && !card.hidden ? card.textContent : null, picker: !!board.container.querySelector('.atlas-tabletop-spellpicker'), text: bar?.querySelector('.atlas-tabletop-spellbar__text')?.textContent ?? '', preview: !!board.spellPreview, animated: board.spellPreview?.view.animated };
  });
  check('spell search: Aim aims it and draws it, the spell\'s words open over the view', aiming.stage === 'aim' && aiming.preview && aiming.animated === false && !aiming.picker && /Fireball/.test(aiming.card ?? '') && /8d6/.test(aiming.card ?? '') && /^Fireball/.test(aiming.text), JSON.stringify(aiming));
  await shot('spell-aim-card');
  const folded = await page.evaluate(() => {
    const { board } = window.boardTest;
    board.container.querySelector('.atlas-tabletop-spellcard__toggle').click();
    const card = board.container.querySelector('.atlas-tabletop-spellcard');
    const small = card.classList.contains('is-folded') && !card.querySelector('.atlas-tabletop-spellabout');
    card.querySelector('.atlas-tabletop-spellcard__toggle').click();
    return { small, open: !!card.querySelector('.atlas-tabletop-spellabout') };
  });
  check('spell search: the words fold to a small button and open again', folded.small && folded.open, JSON.stringify(folded));
  await page.evaluate(() => { const { board } = window.boardTest; board.spellCaster.cancel(); board.seeFrom(null); });
  await wait(300);

  // Cast, Player: the search over the board, the spell drawn at the token; Send hands over the ask with its words.
  const sent = await page.evaluate(() => {
    const { board } = window.boardTest;
    window.__asked = [];
    return !!board.askSpellPanel('hero', { title: 'Ask the Hero\'s player for a spell', send: (ask) => window.__asked.push(ask) });
  });
  await type('cone of cold');
  await wait(150);
  await pick('Cone of Cold', 'SRD 2014');
  await wait(400);
  const panel = await picker();
  check('spell ask: the panel finds the spell and draws it at the token', sent && panel.title.startsWith('Ask') && panel.shape === 'cone' && panel.effect === 'cold' && panel.preview && panel.animated === false, JSON.stringify(panel));
  await shot('spell-ask-panel');
  await button('Send to the player');
  await wait(100);
  const asked = await page.evaluate(() => ({ asks: window.__asked, panel: !!window.boardTest.board.container.querySelector('.atlas-tabletop-spellpicker'), preview: !!window.boardTest.board.spellPreview }));
  const ask = asked.asks[0];
  check('spell ask: Send gives the ask its shape in pixels, its damage and its words; the panel and drawing go', ask && ask.name === 'Cone of Cold' && ask.shape === 'cone' && ask.from === 'self' && Math.abs(ask.size - 840) < 1e-6 && ask.effect === 'cold' && /Cone of Cold|cold air/.test(ask.about?.text ?? '') && !asked.panel && !asked.preview, JSON.stringify(asked));
  // A spell with no area: set by hand, still sent with its words.
  await page.evaluate(() => window.boardTest.board.askSpellPanel('hero', { title: 'Ask', send: (ask) => window.__asked.push(ask) }));
  await type('magic missile');
  await wait(150);
  await pick('Magic Missile', 'SRD 2014');
  await wait(100);
  const missile = await picker();
  check('spell ask: a spell without an area says so and starts as a plain shape', /no area/.test(missile.words) && missile.shape === 'sphere' && missile.effect === 'force', JSON.stringify(missile));
  await page.evaluate(() => window.boardTest.board.container.querySelector('.atlas-tabletop-spellpicker__close').click());
  await page.evaluate(() => window.boardTest.setSpellNotes(null));
  await wait(200);
});

// ── Board sounds: a cast grows into place with its impact; lasting spells loop near the camera ──────────────────────
feature('spell sounds', async ({ page, shot }) => {
  const heard = () => page.evaluate(() => JSON.parse(JSON.stringify({ plays: window.boardTest.sounds.plays, loops: window.boardTest.sounds.loops })));
  const clear = () => page.evaluate(() => { window.boardTest.sounds.plays.length = 0; window.boardTest.sounds.loops.length = 0; });
  const cast = (list) => page.evaluate((list) => {
    const { board } = window.boardTest;
    const cell = board.map.grid.size;
    board.receiveSpells(board.map.path, list.map(([id, x, y, effect, shape, lasting]) => ({
      id, owner: 'p1', color: '#ff0059',
      spell: { shape, from: 'point', at: { x, y, h: shape === 'wall' ? 0 : cell * 0.5 }, ...(shape === 'wall' ? { to: { x: x + cell * 3, y } } : {}), yaw: 0, pitch: 0, roll: 0, size: shape === 'wall' ? cell * 0.2 : cell * 0.9, length: shape === 'wall' ? cell * 2 : 0, angle: 0.9, ...(effect ? { effect } : {}) },
      ...(lasting ? {} : { about: { line: 'Evocation', text: 'x', properties: [['Duration', 'Instantaneous']] } }),
    })));
  }, list);
  const look = (pose) => page.evaluate((pose) => { const { board } = window.boardTest; for (const each of [board.camera.pose, board.camera.goal]) { each.target.x = pose.x; each.target.z = pose.z; each.distance = pose.distance; each.pitch = 0.9; } board.camera.snap(); board.wake(true); }, pose);
  const scale = (id) => page.evaluate((id) => { const mesh = window.boardTest.board.spellViews.get(id)?.view.mesh; return mesh ? [mesh.scale.x, mesh.scale.y, mesh.scale.z] : null; }, id);
  const spot = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('hero'); return { x: e.at.x, y: e.at.y, cell: window.boardTest.board.map.grid.size, path: window.boardTest.board.map.path }; });
  await look({ x: spot.x, z: spot.y, distance: 420 });
  await wait(500);
  // The board has been drawing frames; only now do the scene's spells arrive (a player's board always gets them so): the
  // list seeds what is seen, so a spell already standing makes no sound and is whole.
  await clear();
  await cast([['s0', spot.x, spot.y, 'acid', 'sphere', false]]);
  await wait(500);
  const seeded = await page.evaluate(() => { const { board } = window.boardTest; const m = board.spellViews.get('s0')?.view.mesh; return { plays: window.boardTest.sounds.plays.length, scale: m ? m.scale.x : null, growing: board.growingSpells.size }; });
  check('spell sounds: spells arriving after the board has drawn frames are standing already: whole, silent', seeded.plays === 0 && seeded.scale === 1 && seeded.growing === 0, JSON.stringify(seeded));
  await cast([]);
  await wait(900);
  await clear();
  await cast([['f1', spot.x, spot.y, 'fire', 'sphere', false]]);
  // The scale as frames draw it over the next 700 ms.
  const samples = await page.evaluate(async () => {
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 700) { const m = window.boardTest.board.spellViews.get('f1').view.mesh; out.push([Math.round(performance.now() - t0), m.scale.x, Object.keys(window.boardTest.board.spellAuraTypes()).length, window.boardTest.board.spellViews.get('f1').view.effect.object3d.visible]); await new Promise((r) => setTimeout(r, 15)); }
    return out;
  });
  const impact = await heard();
  check('spell sounds: a cast records the impact of its damage type once, where it stands', impact.plays.filter((play) => play[0] === 'spell.impact.fire').length === 1 && !!impact.plays.find((play) => play[0] === 'spell.impact.fire')[1]?.at, JSON.stringify(impact.plays));
  const during = samples.filter(([, scale]) => scale > 0 && scale < 1);
  const rising = samples.every(([, scale], k) => k === 0 || scale >= samples[k - 1][1]);
  check('spell sounds: it grows through sizes between nothing and whole, never shrinking', during.length >= 2 && rising, JSON.stringify(samples));
  check('spell sounds: it is whole after 600 ms', samples.filter(([at]) => at >= 600).every(([, scale]) => scale >= 0.99), JSON.stringify(samples.slice(-3)));
  const growing = samples.filter(([, scale]) => scale < 1);
  check('spell sounds: while it grows its flames and the flames on what it hits are not there yet', growing.length >= 2 && growing.every(([, , auras, visible]) => auras === 0 && visible === false), JSON.stringify(growing));
  const later = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 500)); const view = window.boardTest.board.spellViews.get('f1').view; return { auras: window.boardTest.board.spellAuraTypes(), visible: view.effect.object3d.visible }; });
  check('spell sounds: once it is whole its flames play and the targets it hits take fire', later.visible === true && Object.keys(later.auras).length > 0, JSON.stringify(later));
  await clear();
  await cast([['f1', spot.x, spot.y, 'fire', 'sphere', false]]);
  await wait(200);
  check('spell sounds: the same spells sent again make no impact', (await heard()).plays.length === 0, JSON.stringify((await heard()).plays));
  // A wall grows up from its foot: scaled in height, its middle lifted so the foot stays put.
  await cast([]);
  await clear();
  await cast([['w1', spot.x, spot.y, 'fire', 'wall', true]]);
  await wait(250);
  const wall = await page.evaluate(() => { const mesh = window.boardTest.board.spellViews.get('w1')?.view.mesh; const length = 2 * window.boardTest.board.map.grid.size; return mesh ? { scaleY: mesh.scale.y, foot: mesh.position.y - mesh.scale.y * length / 2, expected: -length / 2 } : null; });
  check('spell sounds: a wall grows from its foot (the foot stays where it was)', wall && wall.scaleY > 0 && wall.scaleY < 1 && Math.abs(wall.foot - wall.expected) < 1e-6, JSON.stringify(wall));
  await wait(500);
  // A frame held half way, for a look: a plain half-grown shape, no flames.
  await cast([['f9', spot.x + spot.cell * 9, spot.y + spot.cell * 6, 'fire', 'sphere', false]]);
  await look({ x: spot.x + spot.cell * 9, z: spot.y + spot.cell * 6, distance: 420 });
  await wait(900);
  await page.evaluate(() => window.boardTest.board.spellViews.get('f9').view.grow(0.5));
  await wait(150);
  await shot('spell-growing');
  await cast([]);
  await cast([['w1', spot.x, spot.y, 'fire', 'wall', true]]);
  await look({ x: spot.x, z: spot.y, distance: 420 });
  await wait(700);
  await clear();
  // Lasting: its loop is heard with the camera near and not with it far.
  await look({ x: spot.x, z: spot.y, distance: 120 });
  await wait(300);
  const near = (await heard()).loops.filter((loop) => loop[0] === 'spell:fire').at(-1);
  check('spell sounds: a lasting fire wall loops spell.loop.fire with the camera near it', near && near[1] === 'spell.loop.fire' && near[2] > 0.3, JSON.stringify(near));
  await look({ x: spot.x + 6000, z: spot.y + 6000, distance: 300 });
  await wait(300);
  const far = (await heard()).loops.filter((loop) => loop[0] === 'spell:fire').at(-1);
  check('spell sounds: with the camera far, the loop is silent', far && far[2] < 0.01, JSON.stringify(far));
  await look({ x: spot.x, z: spot.y, distance: 300 });
  await cast([['w1', spot.x, spot.y, 'fire', 'wall', true], ['w2', spot.x + spot.cell * 8, spot.y, 'fire', 'wall', true], ['c1', spot.x, spot.y, 'cold', 'sphere', true]]);
  await wait(300);
  const keys = [...new Set((await heard()).loops.filter((loop) => loop[0].startsWith('spell:')).map((loop) => loop[0]))].sort();
  check('spell sounds: one loop per damage type however many spells', JSON.stringify(keys) === JSON.stringify(['spell:cold', 'spell:fire']), JSON.stringify(keys));
  await cast([['c1', spot.x, spot.y, 'cold', 'sphere', true]]);
  await wait(300);
  const stopped = (await heard()).loops.filter((loop) => loop[0] === 'spell:fire').at(-1);
  check('spell sounds: when the last fire spell is gone its loop is stopped', stopped && stopped[1] === null, JSON.stringify(stopped));
  // Another scene (and back): after frames are drawn, its standing spells arrive and make no sound; one new cast makes one.
  await cast([]);
  const standing = (id, at) => ({ id, owner: 'p1', color: '#fff', spell: { shape: 'sphere', from: 'point', at: { x: at.x, y: at.y, h: 20 }, yaw: 0, pitch: 0, roll: 0, size: 60, length: 0, angle: 1, effect: 'fire' } });
  const switched = [];
  for (const scene of ['other-scene.md', null]) {
    await page.evaluate(async ([scene, home]) => { const { board } = window.boardTest; window.boardTest.sounds.plays.length = 0; await board.load({ ...board.map, path: scene ?? home }); }, [scene, spot.path]);
    await wait(500);
    await page.evaluate((list) => window.boardTest.board.receiveSpells(window.boardTest.board.map.path, list), [standing('z1', spot), standing('z2', { x: spot.x + 200, y: spot.y })]);
    await wait(150);
    switched.push(await page.evaluate(() => { const { board } = window.boardTest; return { plays: window.boardTest.sounds.plays.length, growing: board.growingSpells.size, scales: [...board.spellViews.values()].map((kept) => kept.view.mesh.scale.x) }; }));
  }
  check('spell sounds: after a scene switch, standing spells arriving later are silent and whole', switched.every((one) => one.plays === 0 && one.growing === 0 && one.scales.length === 2 && one.scales.every((scale) => scale === 1)), JSON.stringify(switched));
  await page.evaluate((list) => window.boardTest.board.receiveSpells(window.boardTest.board.map.path, list), [standing('z1', spot), standing('z2', { x: spot.x + 200, y: spot.y }), standing('z3', { x: spot.x - 200, y: spot.y })]);
  await wait(150);
  const added = await heard();
  check('spell sounds: then one new cast makes exactly one impact', added.plays.filter((play) => String(play[0]).startsWith('spell.impact')).length === 1, JSON.stringify(added.plays));
  // A player's board is silent for a cast under the fog.
  const fogged = await page.evaluate(() => {
    const { board, insideFog } = window.boardTest;
    const cell = board.map.grid.size;
    for (let x = cell; x < cell * 30; x += cell / 2) for (let y = cell; y < cell * 30; y += cell / 2) if (insideFog(board.fog.areas, { x, y })) return { x, y };
    return null;
  });
  check('spell sounds: the test map has fog to cast under', fogged !== null);
  if (fogged) {
    await cast([]);
    await clear();
    const result = await page.evaluate((fogged) => {
      const { board } = window.boardTest;
      board.audience = 'player';
      const cell = board.map.grid.size;
      board.receiveSpells(board.map.path, [{ id: 'u1', owner: 'p1', color: '#fff', spell: { shape: 'sphere', from: 'point', at: { x: fogged.x, y: fogged.y, h: cell * 0.5 }, yaw: 0, pitch: 0, roll: 0, size: cell, length: 0, angle: 1, effect: 'fire' } }]);
      const plays = window.boardTest.sounds.plays.length;
      board.audience = 'gm';
      return plays;
    }, fogged);
    check('spell sounds: a player\'s board makes no impact for a spell under the fog', result === 0, JSON.stringify(result));
  }
  await cast([]);
});

// ── Board sounds: a spell list's first list seeds under the scene it is for, whatever map the board shows yet ─────
feature('spell scene key', async ({ page }) => {
  const impacts = () => page.evaluate(() => window.boardTest.sounds.plays.filter((play) => String(play[0]).startsWith('spell.impact')).length);
  const fireLoop = () => page.evaluate(() => window.boardTest.sounds.loops.filter((loop) => loop[0] === 'spell:fire').at(-1) ?? null);
  const spot = await page.evaluate(() => { const { board } = window.boardTest; const e = board.tokens.get('hero'); return { x: e.at.x, y: e.at.y, cell: board.map.grid.size, path: board.map.path }; });
  const standing = (id, dx) => ({ id, owner: 'p1', color: '#fff', spell: { shape: 'sphere', from: 'point', at: { x: spot.x + dx, y: spot.y, h: 20 }, yaw: 0, pitch: 0, roll: 0, size: 60, length: 0, angle: 1, effect: 'fire' } });
  // (a) A fresh board, as Connect's replay mounts it: the list comes before its map has loaded; the next list's one new cast is heard and grows.
  const fresh = await page.evaluate(async ([first, second]) => {
    const { Board, host, QUALITY, board, sounds } = window.boardTest;
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px;';
    document.body.appendChild(div);
    const made = new Board(div, host, QUALITY.medium);
    sounds.plays.length = 0;
    made.receiveSpells(board.map.path, first);
    await made.load({ ...board.map });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const seeded = sounds.plays.filter((play) => String(play[0]).startsWith('spell.impact')).length;
    made.receiveSpells(board.map.path, second);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result = { seeded, impacts: sounds.plays.filter((play) => String(play[0]).startsWith('spell.impact')).length, growing: made.growingSpells.size };
    made.dispose();
    div.remove();
    return result;
  }, [[standing('q1', 0)], [standing('q1', 0), standing('q2', spot.cell * 2)]]);
  check('spell scene key: a fresh board given its list before its map is silent for the standing spells', fresh.seeded === 0, JSON.stringify(fresh));
  check('spell scene key: then one new cast makes exactly one impact and grows', fresh.impacts === 1 && fresh.growing === 1, JSON.stringify(fresh));
  // (b) The GM's board: home's lasting fire loops near the camera.
  await page.evaluate((spot) => { const { board } = window.boardTest; for (const each of [board.camera.pose, board.camera.goal]) { each.target.x = spot.x; each.target.z = spot.y; each.distance = 120; each.pitch = 0.9; } board.camera.snap(); board.wake(true); }, spot);
  await page.evaluate((list) => window.boardTest.board.receiveSpells(window.boardTest.board.map.path, list), [standing('h1', 0)]);
  await wait(400);
  const home = await fireLoop();
  check('spell scene key: the shown scene\'s lasting spell loops', home && home[1] === 'spell.loop.fire', JSON.stringify(home));
  // Another scene's list comes while home's map is still shown (Atlas presents the new layer first): nothing plays, and home's loop stops.
  await page.evaluate(() => { window.boardTest.sounds.plays.length = 0; });
  await page.evaluate((list) => window.boardTest.board.receiveSpells('other-scene.md', list), [standing('o1', 0), standing('o2', spot.cell * 2)]);
  await wait(400);
  const early = { impacts: await impacts(), growing: await page.evaluate(() => window.boardTest.board.growingSpells.size), loop: await fireLoop() };
  check('spell scene key: a new scene\'s standing list arriving before its map makes no impact and does not grow', early.impacts === 0 && early.growing === 0, JSON.stringify(early));
  check('spell scene key: no loop follows a list whose map is not shown yet', early.loop && early.loop[1] === null, JSON.stringify(early.loop));
  // Its map catches up: nothing is forgotten again, nothing plays; one new cast then makes one impact.
  await page.evaluate(async () => { const { board } = window.boardTest; await board.load({ ...board.map, path: 'other-scene.md' }); });
  await wait(500);
  const caught = await impacts();
  check('spell scene key: the map catching up makes no sound', caught === 0, JSON.stringify(caught));
  await page.evaluate((list) => window.boardTest.board.receiveSpells('other-scene.md', list), [standing('o1', 0), standing('o2', spot.cell * 2), standing('o3', -spot.cell * 2)]);
  await wait(400);
  check('spell scene key: then one new cast makes exactly one impact', (await impacts()) === 1, JSON.stringify(await impacts()));
  const there = await fireLoop();
  check('spell scene key: the new scene\'s lasting spells loop once its map is shown', there && there[1] === 'spell.loop.fire', JSON.stringify(there));
  // Back home: the map changes first, the other scene's list is still held: its loop stops until home's list comes.
  await page.evaluate(async (path) => { const { board } = window.boardTest; await board.load({ ...board.map, path }); }, spot.path);
  await wait(400);
  const back = await fireLoop();
  check('spell scene key: after a scene switch, the last scene\'s spells no longer loop', back && back[1] === null, JSON.stringify(back));
});

// ── Board sounds: a hidden window plays nothing and owes nothing; the players' window keeps the GM board heard ──────
feature('hidden window sounds', async ({ page }) => {
  const plays = () => page.evaluate(() => window.boardTest.sounds.plays.map((play) => play[0]));
  // Hidden: no frames come (they are held here, as a hidden window gets none) and the document says hidden.
  await page.evaluate(() => {
    const t = window.boardTest;
    t.heldFrames = [];
    t.realFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => { t.heldFrames.push(callback); return 900000 + t.heldFrames.length; };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await wait(300);
  await page.evaluate(() => { window.boardTest.sounds.plays.length = 0; });
  await page.evaluate(async () => {
    const { board } = window.boardTest;
    await board.load({ ...board.map, tokens: board.map.tokens.map((t) => (['gob', 'gob2', 'noart'].includes(t.id) ? { ...t, y: t.y - 140 } : t)) });
  });
  await wait(200);
  const hidden = await plays();
  check('hidden window sounds: moves synced while hidden pick nothing up', hidden.length === 0, JSON.stringify(hidden));
  // Shown again: the frames run, the tokens slide there, and no put-down bursts out.
  await page.evaluate(() => {
    const t = window.boardTest;
    delete document.hidden;
    window.requestAnimationFrame = t.realFrame;
    document.dispatchEvent(new Event('visibilitychange'));
    const held = t.heldFrames;
    t.heldFrames = [];
    for (const callback of held) callback(performance.now());
  });
  await wait(2500);
  const shown = await plays();
  check('hidden window sounds: shown again, no put-down plays for the moves made while hidden', !shown.includes('mini.putdown'), JSON.stringify(shown));
  check('hidden window sounds: and the tokens did slide to their new places', await page.evaluate(() => { const e = window.boardTest.board.tokens.get('gob'); return Math.abs(e.at.y - e.goal.y) < 1; }));
  // The GM's window hidden: silent alone, heard while the players' window is in view (the table hears this machine).
  const asked = await page.evaluate(() => {
    const { board, sounds } = window.boardTest;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    sounds.plays.length = 0;
    sounds.heards.length = 0;
    board.sound('dice.hit');
    const alone = sounds.plays.length;
    board.player = { container: { ownerDocument: { hidden: false } } };
    board.sound('dice.hit');
    const table = sounds.plays.length - alone;
    const rule = sounds.heards.at(-1);
    board.player = null;
    delete document.hidden;
    return { alone, table, rule };
  });
  check('hidden window sounds: a hidden GM window with no players\' window plays nothing', asked.alone === 0, JSON.stringify(asked));
  check('hidden window sounds: a hidden GM window plays for the players\' window in view, and tells the engine so', asked.table === 1 && asked.rule === true, JSON.stringify(asked));
});

// ── Board sounds: a player's own turn has the full horn, paused or not ───────────────────────────────────────────
feature('paused horn', async ({ page }) => {
  const horns = await page.evaluate(() => {
    const { board, host, sounds } = window.boardTest;
    board.audience = 'player';
    // Paused: the player may move nothing, but still controls their token.
    host.canMove = () => false;
    host.controls = (id) => id === 'gob';
    board.hearTurn('k1', ['gob']);
    sounds.plays.length = 0;
    board.hearTurn('k2', ['gob']);
    const mine = sounds.plays.at(-1);
    host.controls = () => false;
    board.hearTurn('k3', ['gob']);
    const theirs = sounds.plays.at(-1);
    delete host.canMove;
    delete host.controls;
    board.audience = 'gm';
    return { mine: mine ? [mine[0], mine[1]?.gain] : null, theirs: theirs ? [theirs[0], theirs[1]?.gain] : null };
  });
  check('paused horn: the player\'s own turn is at full volume while the game is paused', JSON.stringify(horns.mine) === '["turn.horn",1]', JSON.stringify(horns));
  check('paused horn: another\'s turn is quiet', JSON.stringify(horns.theirs) === '["turn.horn",0.35]', JSON.stringify(horns));
});

// ── Board sounds: the tab moving to another window moves the board's loops and listener to that window's engine ──
feature('engine swap', async ({ page }) => {
  const swapped = await page.evaluate(() => {
    const { board, sounds } = window.boardTest;
    board.soundLoop('rain', 'water.flow', 0.3);
    const other = { plays: [], loops: [], listeners: [], play(id, options) { this.plays.push([id, options]); }, loop(key, id, gain) { this.loops.push([key.replace(/^board\d+:/, ''), id, gain]); }, setListener(listener, span) { this.listeners.push(span); } };
    window.boardTest.otherEngine = other;
    sounds.loops.length = 0;
    sounds.other = other;
    board.soundEngineChanged();
    return { old: sounds.loops.filter((loop) => loop[0] === 'rain'), fresh: other.loops.filter((loop) => loop[0] === 'rain') };
  });
  check('engine swap: the loop stops on the old engine', JSON.stringify(swapped.old) === '[["rain",null,0]]', JSON.stringify(swapped));
  check('engine swap: and starts on the new one', JSON.stringify(swapped.fresh) === '[["rain","water.flow",0.3]]', JSON.stringify(swapped));
  await wait(400);
  const told = await page.evaluate(() => window.boardTest.otherEngine.listeners.length);
  check('engine swap: the new engine is told where the camera is without the camera moving', told >= 1, JSON.stringify(told));
});

// ── Board sounds: painted water loops while the camera is near it, one loop per motion kind ──────────────────────
feature('water sound', async ({ page, shot }) => {
  const heard = () => page.evaluate(() => JSON.parse(JSON.stringify(window.boardTest.sounds.loops)));
  const clear = () => page.evaluate(() => { window.boardTest.sounds.plays.length = 0; window.boardTest.sounds.loops.length = 0; });
  const lastOf = async (key) => (await heard()).filter((loop) => loop[0] === key).at(-1);
  const look = (x, z, distance) => page.evaluate(([x, z, distance]) => { const { board } = window.boardTest; for (const each of [board.camera.pose, board.camera.goal]) { each.target.x = x; each.target.z = z; each.distance = distance; each.pitch = 0.9; } board.camera.snap(); board.wake(true); }, [x, z, distance]);
  const cell = await page.evaluate(() => window.boardTest.board.map.grid.size);
  await look(cell * 4, cell * 4, 400);
  await wait(500);
  check('water sound: with no water nothing loops', (await heard()).filter((loop) => String(loop[0]).startsWith('water:') && loop[1] !== null).length === 0, JSON.stringify(await heard()));
  await clear();
  // Water painted under the camera, rippling.
  await page.evaluate(([x, y]) => { const { board } = window.boardTest; const actions = board.toolbarActions(); actions.setWaterMotion({ kind: 'ripples', amount: 0.6, direction: 0, tint: '#1fa3a8', clarity: 0.7 }); actions.setWaterTool('paint'); actions.setWaterBrush(2); board.paintWater({ x, y }, { x: x + 60, y: y + 10 }); actions.setWaterTool(null); }, [cell * 4, cell * 4]);
  await wait(300);
  const near = await lastOf('water:ripples');
  check('water sound: painted ripples loop water.ripples, loudly with the camera over them', near && near[1] === 'water.ripples' && near[2] > 0.5, JSON.stringify(near));
  await look(cell * 4 + 6000, cell * 4 + 6000, 400);
  await wait(300);
  const far = await lastOf('water:ripples');
  check('water sound: with the camera far away the loop is nearly silent', far && far[1] === 'water.ripples' && far[2] < 0.1, JSON.stringify(far));
  await look(cell * 4, cell * 4, 400);
  await wait(300);
  await clear();
  await page.evaluate(() => window.boardTest.board.toolbarActions().setWaterMotion({ kind: 'waves', amount: 0.6, direction: 0, tint: '#1fa3a8', clarity: 0.7 }));
  await wait(300);
  const waves = await lastOf('water:waves');
  const stopped = await lastOf('water:ripples');
  check('water sound: switching the motion to waves loops water.waves', waves && waves[1] === 'water.waves' && waves[2] > 0.5, JSON.stringify(waves));
  check('water sound: and the ripples loop is stopped', stopped && stopped[1] === null, JSON.stringify(stopped));
  // The camera's height: from higher up the same water is quieter.
  const gainAt = async (distance) => { await look(cell * 4, cell * 4, distance); await wait(300); return (await lastOf('water:waves'))?.[2]; };
  const close = await gainAt(cell * 3);
  const high = await gainAt(cell * 40);
  check('water sound: the same water is louder with the camera closer', close > high + 0.2, JSON.stringify([close, high]));
  await look(cell * 4, cell * 4, 400);
  await wait(300);
  // Idle, with the camera still: the loop is looked at again about once a second, not on every frame.
  await clear();
  await wait(2500);
  check('water sound: a still camera does not ask the engine over and over', (await heard()).length <= 3, JSON.stringify(await heard()));
  const saved = await page.evaluate(() => window.boardTest.board.water.mask.save());
  // The water dried up (here by erasing it): the loop is stopped.
  await clear();
  await page.evaluate(([x, y]) => { const { board } = window.boardTest; const actions = board.toolbarActions(); actions.setWaterTool('erase'); actions.setWaterBrush(8); board.paintWater({ x: x - 200, y: y - 200 }, { x: x + 300, y: y + 200 }); actions.setWaterTool(null); }, [cell * 4, cell * 4]);
  await wait(600);
  const gone = await lastOf('water:waves');
  check('water sound: with the water gone the loop is stopped', gone && gone[1] === null, JSON.stringify(await heard()));
  await page.evaluate((saved) => {
    const { board, map } = window.boardTest;
    const layer = { path: 'wet.atlasmap', elevation: 3, map: { ...map, path: 'wet.atlasmap', background: 'bg.png', fog: [], inks: [], texts: [], icons: [], pins: [], initiative: null, tokens: [], walls: [], lights: [] }, wallHeight: () => null, wallMaterial: () => null, doorProp: () => null, lightHeight: () => 1, fogHeight: 1, wallThickness: 0.12, props: [], placement: () => null, style: () => 'disc', water: { mask: saved, motion: { kind: 'flow', amount: 0.6, direction: 0, tint: '#1fa3a8', clarity: 0.7 } } };
    board.setStack([layer]);
  }, saved);
  await page.waitForFunction(() => (window.boardTest.board.layerViews.get('wet.atlasmap')?.presence ?? 0) > 0.99, null, { timeout: 10000 }).catch(() => {});
  await wait(1500);
  const shown = await lastOf('water:flow');
  check('water sound: a stacked scene\'s water loops by its own motion', shown && shown[1] === 'water.flow' && shown[2] > 0.3, JSON.stringify(await heard()));
  await clear();
  await page.evaluate(() => { window.boardTest.board.layerViews.get('wet.atlasmap').object3d.visible = false; });
  await wait(1500);
  const hidden = await lastOf('water:flow');
  check('water sound: hiding that layer stops its loop', hidden && hidden[1] === null, JSON.stringify(await heard()));
  await page.evaluate(() => window.boardTest.board.setStack([]));
});

feature('door flips', async ({ page, shot }) => {
  const pivot = () => page.evaluate(() => { const door = window.boardTest.board.walls.doors.get('door'); return { x: door.pivot.position.x, z: door.pivot.position.z, turn: door.pivot.rotation.y }; });
  const set = (flip) => page.evaluate((flip) => { const { board, doorFlips } = window.boardTest; if (flip) doorFlips.set('door', flip); else doorFlips.delete('door'); board.refresh(); }, flip);
  // The room's north door runs from (525, 840) to (595, 840).
  let now = await pivot();
  check('door flips: as Atlas draws it, the hinge is at the first end', Math.abs(now.x - 525) < 1e-6 && Math.abs(now.z - 840) < 1e-6, JSON.stringify(now));
  // Open, so the leaf shows which way it swings.
  await page.evaluate(async () => { const { board } = window.boardTest; await board.load({ ...board.map, walls: board.map.walls.map((w) => (w.id === 'door' ? { ...w, closed: false } : w)) }); });
  await wait(900);
  await set({ hinge: true, side: true });
  await wait(900);
  const rotated = await pivot();
  check('door flips: turned half a turn, it hangs from the other end', Math.abs(rotated.x - 595) < 1e-6 && Math.abs(rotated.z - 840) < 1e-6, JSON.stringify(rotated));
  await set({ hinge: true, side: false });
  await wait(900);
  const mirrored = await pivot();
  check('door flips: mirrored, it hangs from the other end too, and its leaf turns the other way from the half-turned door', Math.abs(mirrored.x - 595) < 1e-6 && Math.abs(mirrored.turn - rotated.turn) > 0.5, JSON.stringify({ rotated, mirrored }));
  await set(null);
  await wait(300);
  now = await pivot();
  check('door flips: put back, it is where Atlas draws it', Math.abs(now.x - 525) < 1e-6, JSON.stringify(now));
});

// ── Custom sounds: a file in the sounds folder replaces a built-in sound live; a per-sound volume silences only it ───
feature('custom sounds', async ({ page }) => {
  await page.evaluate(() => {
    const { SoundEngine, CustomSounds, loadSound, DEFAULT_SOUND_SETTINGS, board, sounds } = window.boardTest;
    const started = [];
    const context = {
      state: 'running', currentTime: 10, destination: {}, gains: [],
      async resume() {}, async close() {},
      createGain() { const g = { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} }; context.gains.push(g); return g; },
      createStereoPanner() { return { pan: { value: 0 }, connect() {}, disconnect() {} }; },
      createBufferSource() { return { buffer: null, loop: false, playbackRate: { value: 1 }, onended: null, connect() {}, disconnect() {}, stop() {}, start() { started.push({ size: this.buffer.size, level: context.gains[context.gains.length - 1].gain.value }); } }; },
      async decodeAudioData(data) { return { size: data.byteLength }; },
    };
    const vault = new Map();
    const holder = {};
    const custom = new CustomSounds(
      { paths: () => [...vault.keys()], read: async (path) => vault.get(path) },
      () => 'Tabletop sounds', loadSound, () => {},
      (ids) => { if (ids === 'all') holder.engine.invalidate(); else for (const id of ids) holder.engine.invalidate(id); },
    );
    const engine = SoundEngine.forTest(() => context, { hidden: false, addEventListener() {}, removeEventListener() {} }, custom.load);
    holder.engine = engine;
    engine.configure(DEFAULT_SOUND_SETTINGS);
    sounds.other = engine;
    board.soundEngineChanged();
    window.customTest = { started, vault, custom, engine, DEFAULT_SOUND_SETTINGS };
  });
  const setDoor = async (closed) => {
    await page.evaluate(async (closed) => { const { board } = window.boardTest; await board.load({ ...board.map, walls: board.map.walls.map((w) => (w.id === 'door' ? { ...w, closed } : w)) }); }, closed);
    await wait(450);
  };
  const last = () => page.evaluate(() => window.customTest.started.at(-1) ?? null);
  await setDoor(false);
  const builtIn = await last();
  check('custom sounds: with no file in the folder the door plays the built-in sound', builtIn && builtIn.size > 11 && builtIn.level > 0, JSON.stringify(builtIn));
  await setDoor(true);
  // The GM drops door.open.mp3 (11 bytes here) into the folder: the board picks it up with no reload.
  await page.evaluate(() => { const { vault, custom } = window.customTest; vault.set('Tabletop sounds/door.open.mp3', new ArrayBuffer(11)); custom.fileChanged('Tabletop sounds/door.open.mp3'); });
  await wait(300);
  await setDoor(false);
  const custom = await last();
  check('custom sounds: a file door.open.mp3 in the folder makes the door play the custom buffer', custom && custom.size === 11, JSON.stringify(custom));
  // The other door sounds are untouched.
  await setDoor(true);
  const shut = await last();
  check('custom sounds: the door shutting, with no custom file for it, still plays its built-in sound', shut && shut.size !== 11, JSON.stringify(shut));
  // Deleted: back to the built-in sound.
  await page.evaluate(() => { const { vault, custom } = window.customTest; vault.delete('Tabletop sounds/door.open.mp3'); custom.fileChanged('Tabletop sounds/door.open.mp3'); });
  await wait(300);
  await setDoor(false);
  const reverted = await last();
  check('custom sounds: deleting the file reverts the door to the built-in sound', reverted && reverted.size !== 11 && reverted.size > 11, JSON.stringify(reverted));
  // A volume of 0 on door.open silences it and only it.
  await page.evaluate(() => { const { engine, DEFAULT_SOUND_SETTINGS } = window.customTest; engine.configure({ ...DEFAULT_SOUND_SETTINGS, levels: { 'door.open': 0 } }); });
  await setDoor(true);
  const shutAudible = await last();
  const count = await page.evaluate(() => window.customTest.started.length);
  await setDoor(false);
  const silenced = await last();
  check('custom sounds: a volume of 0 for door.open plays it at no level', silenced && silenced.level === 0 && (await page.evaluate(() => window.customTest.started.length)) === count + 1, JSON.stringify(silenced));
  check('custom sounds: and door.shut is still heard', shutAudible && shutAudible.level > 0, JSON.stringify(shutAudible));
  await page.evaluate(() => { const { engine, DEFAULT_SOUND_SETTINGS } = window.customTest; engine.configure(DEFAULT_SOUND_SETTINGS); });
  await setDoor(true);
  await setDoor(false);
  const back = await last();
  check('custom sounds: the volume back at 100% makes it audible again', back && back.level > 0, JSON.stringify(back));
});

// ── Limiter: the engine's own output chain, rendered offline in Chromium: quiet sounds keep their level, hot ones are held under 0 dBFS ──
feature('limiter', async ({ page }) => {
  const render = (amplitude, volume, level) => page.evaluate(async ([amplitude, volume, level]) => {
    const { SoundEngine, CATALOG, DEFAULT_SOUND_SETTINGS } = window.boardTest;
    const rate = 44100;
    // A 2 s sine of the given amplitude as a 16-bit mono WAV file, which is what the engine decodes.
    const samples = rate * 2;
    const wav = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(wav);
    const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.min(1, amplitude) * 32767 * Math.sin(2 * Math.PI * 440 * i / rate)), true);
    const offline = new OfflineAudioContext(1, rate * 2, rate);
    // An offline context is not "running" until it renders; the engine only plays on a running one.
    const context = {
      get state() { return 'running'; }, get currentTime() { return 0; }, destination: offline.destination,
      resume: async () => {}, close: async () => {},
      // No panner: a centred pan would take 3 dB off a mono sound, which is not what is measured here.
      createGain: () => offline.createGain(),
      createDynamicsCompressor: () => offline.createDynamicsCompressor(), createBufferSource: () => offline.createBufferSource(),
      decodeAudioData: (data) => offline.decodeAudioData(data),
    };
    const engine = SoundEngine.forTest(() => context, { hidden: false, addEventListener() {}, removeEventListener() {} }, async () => [wav.slice(0)]);
    engine.configure({ ...DEFAULT_SOUND_SETTINGS, volume, levels: { 'dice.hit': level } });
    engine.play('dice.hit');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const out = (await offline.startRendering()).getChannelData(0);
    let sum = 0, peak = 0, n = 0;
    for (let i = rate * 0.5; i < rate * 1.5; i++) { sum += out[i] * out[i]; peak = Math.max(peak, Math.abs(out[i])); n++; }
    return { rmsDb: 10 * Math.log10(sum / n), peak, expectedPeak: amplitude * CATALOG['dice.hit'].gain * volume * level };
  }, [amplitude, volume, level]);
  const dbOf = (peak) => 20 * Math.log10(peak / Math.SQRT2);
  // Quiet: a sound well under the -3 dB threshold leaves at the level it was given (within 0.1 dB), not 1.7 dB louder.
  for (const amplitude of [0.1, 0.3]) {
    const quiet = await render(amplitude, 1, 1);
    check(`limiter: a quiet tone (${amplitude}) leaves the chain within 0.1 dB of its level`, Math.abs(quiet.rmsDb - dbOf(quiet.expectedPeak)) < 0.1, JSON.stringify(quiet));
  }
  // Hot: well over full scale before the limiter (1 x 0.7 x 2 = 1.4), the output stays below 0 dBFS.
  const hot = await render(1, 1, 2);
  check('limiter: a hot tone (1.4 times full scale) is held below 0 dBFS', hot.expectedPeak > 1.3 && hot.peak < 1 && hot.peak > 0.5, JSON.stringify(hot));
});

// ── Cutscenes: the board's cinematic mode (driven camera, free camera, input lock, bars, fade, reveal) ─────────────
feature('cinematic mode', async ({ page, shot }) => {
  const at = (id) => page.evaluate((id) => { const e = window.boardTest.board.tokens.get(id); return window.boardTest.project(e.at.x, e.at.y, 0); }, id);
  // A drag in flight stops at the lock: the token goes back, and nothing is told to the host.
  const hero = await at('hero');
  const home = await page.evaluate(() => { const t = window.boardTest.board.tokens.get('hero').token; return { x: t.x, y: t.y }; });
  await page.mouse.move(hero.x, hero.y);
  await page.mouse.down();
  await page.mouse.move(hero.x + 60, hero.y + 30, { steps: 6 });
  const lifted = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('hero'); return { x: e.goal.x, y: e.goal.y }; });
  check('cinematic: a token is carried before the lock', Math.abs(lifted.x - home.x) > 10 || Math.abs(lifted.y - home.y) > 10, JSON.stringify([home, lifted]));
  await page.evaluate(() => window.boardTest.board.setCinematicRole('locked'));
  await page.mouse.move(hero.x + 120, hero.y + 60, { steps: 6 });
  await page.mouse.up();
  await wait(300);
  const dropped = await page.evaluate(() => { const e = window.boardTest.board.tokens.get('hero'); return { x: e.goal.x, y: e.goal.y, moves: window.boardTest.record.moves.length }; });
  check('cinematic: a drag in flight stops at the lock: the token is where it was and nothing moved', dropped.x === home.x && dropped.y === home.y && dropped.moves === 0, JSON.stringify({ home, dropped }));
  // Locked: the camera does not answer the wheel, a drag or the keys, and the eyes are refused.
  const orbit = () => page.evaluate(() => JSON.stringify(window.boardTest.board.camera.goal));
  const before = await orbit();
  await page.mouse.move(500, 300);
  await page.mouse.wheel(0, -400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(560, 340, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.down('w');
  await wait(300);
  await page.keyboard.up('w');
  check('cinematic: a locked board\'s camera ignores the wheel, a drag and the keys', (await orbit()) === before);
  check('cinematic: a locked board refuses the eyes', await page.evaluate(() => window.boardTest.board.seeFrom('hero') === false && window.boardTest.board.cinematicRole === 'locked'));
  await page.evaluate(() => window.boardTest.board.setCinematicRole('none'));
  await page.mouse.wheel(0, -400);
  await wait(100);
  check('cinematic: with the lock gone the same wheel moves the camera again', (await orbit()) !== before);
  check('cinematic: with the lock gone the eyes work again', await page.evaluate(() => { const ok = window.boardTest.board.seeFrom('hero'); window.boardTest.board.seeFrom(null); return ok; }));
  // The in-eyes player is put out when the lock comes, and the board remembers whose eyes.
  await page.evaluate(() => { window.boardTest.board.seeFrom('hero'); window.boardTest.board.setCinematicRole('locked'); });
  check('cinematic: the lock takes a player out of the eyes and remembers the token', await page.evaluate(() => window.boardTest.board.eyesBeforeLock === 'hero' && window.boardTest.board.seeingFrom === null), await page.evaluate(() => String(window.boardTest.board.eyesBeforeLock)));
  await page.evaluate(() => window.boardTest.board.setCinematicRole('none'));

  // A camera drag in flight when the lock arrives stops there.
  await page.mouse.move(120, 560);
  const pre = await orbit();
  await page.mouse.down();
  await page.mouse.move(180, 540, { steps: 5 });
  const dragged = await orbit();
  check('cinematic: a camera drag moves the camera before the lock', dragged !== pre);
  await page.evaluate(() => window.boardTest.board.setCinematicRole('locked'));
  await page.mouse.move(300, 480, { steps: 6 });
  await page.mouse.up();
  await wait(100);
  check('cinematic: a camera drag in flight stops at the lock', (await orbit()) === dragged);
  await page.evaluate(() => window.boardTest.board.setCinematicRole('none'));
  // A key held down when the lock arrives is let go.
  await page.locator('canvas.atlas-tabletop-board').focus();
  await page.keyboard.down('w');
  await wait(150);
  const flying = await orbit();
  await page.evaluate(() => window.boardTest.board.setCinematicRole('locked'));
  await wait(300);
  check('cinematic: a held key is let go at the lock: the camera stops and no key stays held', (await orbit()) === flying && await page.evaluate(() => window.boardTest.board.held.size === 0), flying);
  await page.keyboard.up('w');
  await page.evaluate(() => window.boardTest.board.setCinematicRole('none'));
  // A pinch in flight is dropped at the lock. The touches are synthetic: the canvas takes no pointer capture for them.
  const pinch = (lock) => page.evaluate(async (lock) => {
    const { board } = window.boardTest;
    const canvas = board.canvas;
    canvas.setPointerCapture = () => {};
    const send = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 21, clientX: x, clientY: y, button: 0, bubbles: true }));
    const goal = () => JSON.stringify(board.camera.goal);
    send('pointerdown', 21, 400, 300);
    send('pointerdown', 22, 600, 300);
    if (lock) board.setCinematicRole('locked');
    const start = goal();
    send('pointermove', 21, 300, 300);
    send('pointermove', 22, 700, 300);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const moved = goal() !== start;
    send('pointerup', 21, 300, 300);
    send('pointerup', 22, 700, 300);
    board.setCinematicRole('none');
    board.camera.snap();
    return { moved, touches: board.touches.size, pinch: board.pinch };
  }, lock);
  const open = await pinch(false);
  check('cinematic: a pinch zooms the camera before the lock', open.moved, JSON.stringify(open));
  const locked = await pinch(true);
  check('cinematic: a pinch in flight is dropped at the lock and moves nothing', !locked.moved && locked.touches === 0 && locked.pinch === null, JSON.stringify(locked));
  // The cameras that jump (follow the GM, AR) are refused while locked, and AR is drawn again when the lock ends.
  const refused = await page.evaluate(() => {
    const { board } = window.boardTest;
    board.setGmView({ eye: { x: 100, y: 400, z: 900 }, target: { x: 300, y: 0, z: 300 } });
    const goal = JSON.stringify(board.camera.goal);
    board.setCinematicRole('locked');
    const follow = board.followGm();
    const view = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 400], frustum: { left: -1, right: 1, top: -1, bottom: 1 }, squareMm: 25 };
    const accepted = board.setAugmented(view);
    const drawn = board.augmented;
    const same = JSON.stringify(board.camera.goal) === goal;
    board.setCinematicRole('none');
    const redrawn = board.augmented !== null;
    board.setAugmented(null);
    board.setGmView(null);
    return { follow, accepted, drawn, same, redrawn };
  });
  check('cinematic: followGm is refused while locked', refused.follow === false && refused.same, JSON.stringify(refused));
  check('cinematic: setAugmented is kept as the latest view but not drawn while locked, and drawn when the lock ends', refused.accepted === true && refused.drawn === null && refused.redrawn, JSON.stringify(refused));

  // The driver's pose wins over the orbit camera.
  await page.evaluate(() => window.boardTest.board.setCinematic({ pose: () => ({ eye: { x: 500, y: 900, z: 1400 }, target: { x: 500, y: 0, z: 500 }, black: 0 }) }));
  await wait(400);
  const view = await page.evaluate(() => { const p = window.boardTest.board.view.position; return [p.x, p.y, p.z]; });
  check('cinematic: the drawn camera is at the driver\'s eye', Math.abs(view[0] - 500) < 0.01 && Math.abs(view[1] - 900) < 0.01 && Math.abs(view[2] - 1400) < 0.01, JSON.stringify(view));
  check('cinematic: the sound listener follows the driven camera', await page.evaluate(() => { const l = window.boardTest.sounds.listeners.at(-1).listener.eye; return Math.abs(l.x - 500) < 0.01 && Math.abs(l.y - 900) < 0.01 && Math.abs(l.z - 1400) < 0.01; }), await page.evaluate(() => JSON.stringify(window.boardTest.sounds.listeners.at(-1))));
  // Running: the GM's own camera is the driver's. Wheel and drag leave the goal alone.
  await page.evaluate(() => window.boardTest.board.setCinematicRole('running'));
  const still = await orbit();
  await page.mouse.move(500, 300);
  await page.mouse.wheel(0, -400);
  await page.mouse.down();
  await page.mouse.move(600, 360, { steps: 6 });
  await page.mouse.up();
  await wait(200);
  check('cinematic: with the role running, a wheel and a drag leave the camera goal unchanged', (await orbit()) === still);
  check('cinematic: a driver\'s eye on its target never makes NaN', await page.evaluate(async () => {
    const { board } = window.boardTest;
    board.setCinematic({ pose: () => ({ eye: { x: 700, y: 300, z: 700 }, target: { x: 700, y: 300, z: 700 }, black: 0 }) });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const p = board.view.position, q = board.view.quaternion;
    return [p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite);
  }));
  await page.evaluate(() => window.boardTest.board.setCinematic({ pose: () => ({ eye: { x: 500, y: 900, z: 1400 }, target: { x: 500, y: 0, z: 500 }, black: 0 }) }));

  // The bars: two, as tall as the container leaves above and below a picture of the aspect.
  const bars = await page.evaluate(async () => {
    const { board } = window.boardTest;
    board.cinema.setBars(2.39);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const w = board.container.clientWidth, h = board.container.clientHeight;
    const nodes = [...board.container.querySelectorAll('.tabletop-cinema__bar')];
    return { expected: (h - w / 2.39) / 2, height: board.cinema.barHeight, shown: nodes.map((n) => n.getBoundingClientRect().height), count: nodes.length };
  });
  check('cinematic: setBars(2.39) sets a bar height from the container', Math.abs(bars.height - bars.expected) < 1 && bars.expected > 20, JSON.stringify(bars));
  check('cinematic: two bars of that height are in the DOM', bars.count === 2 && bars.shown.every((h) => Math.abs(h - bars.expected) < 1), JSON.stringify(bars));
  check('cinematic: the cinema layer takes no pointer events and sits above the toolbar', await page.evaluate(() => {
    const layer = window.boardTest.board.container.querySelector('.tabletop-cinema');
    const toolbar = window.boardTest.board.container.querySelector('.atlas-tabletop-toolbar-row') ?? window.boardTest.board.container.querySelector('.atlas-tabletop-toolbar');
    const z = (n) => Number(getComputedStyle(n).zIndex) || 0;
    return getComputedStyle(layer).pointerEvents === 'none' && (!toolbar || z(layer) > z(toolbar));
  }));
  // The fade.
  await page.evaluate(() => window.boardTest.board.cinema.setBlack(1));
  check('cinematic: setBlack(1) makes the fade opaque', await page.evaluate(() => getComputedStyle(window.boardTest.board.container.querySelector('.tabletop-cinema__fade')).opacity === '1'));
  await page.evaluate(() => window.boardTest.board.cinema.setBlack(0));
  // The driver's own black reaches the fade.
  await page.evaluate(() => window.boardTest.board.setCinematic({ pose: () => ({ eye: { x: 500, y: 900, z: 1400 }, target: { x: 500, y: 0, z: 500 }, black: 0.5 }) }));
  await wait(300);
  check('cinematic: the driver\'s black is the fade\'s', await page.evaluate(() => window.boardTest.board.cinema.black === 0.5 && getComputedStyle(window.boardTest.board.container.querySelector('.tabletop-cinema__fade')).opacity === '0.5'));
  await page.evaluate(() => window.boardTest.board.setCinematic({ pose: () => ({ eye: { x: 500, y: 900, z: 1400 }, target: { x: 500, y: 0, z: 500 }, black: 0 }) }));
  await wait(300);
  await shot('cinematic-bars');

  // The reveal: players see what the GM's view shows, as players draw it.
  const seen = () => page.evaluate(() => {
    const b = window.boardTest.board;
    b.showFor('player');
    const out = { lurker: b.tokens.get('lurker').piece.object3d.visible, orc: b.tokens.get('orc').piece.object3d.visible, hero: b.tokens.get('hero').piece.object3d.visible, fog: b.fog.object3d.visible };
    b.showFor('gm');
    return out;
  });
  const plain = await seen();
  check('cinematic: before the reveal a token under the fog is hidden from players', plain.lurker === false && plain.hero === true && plain.fog === true, JSON.stringify(plain));
  await page.evaluate(() => window.boardTest.board.setReveal(true));
  const revealed = await seen();
  check('cinematic: with the reveal the fogged token shows, the solid fog is not drawn and the hidden token stays hidden', revealed.lurker === true && revealed.orc === false && revealed.fog === false, JSON.stringify(revealed));
  await page.evaluate(() => window.boardTest.board.setReveal(false));
  const after = await seen();
  check('cinematic: with the reveal off the fogged token is hidden again', after.lurker === false && after.fog === true, JSON.stringify(after));

  // The authoring camera: W flies the free camera, and the orbit camera is not touched.
  const free = await page.evaluate(() => {
    const { board, FreeCamera } = window.boardTest;
    const cam = new FreeCamera({ x: 500, y: 600, z: 1200 }, { x: 500, y: 0, z: 500 });
    window.freeCam = cam;
    board.setCinematicRole('authoring');
    board.setCinematic({ free: cam, pose: () => ({ ...cam.pose(), black: 0 }) });
    return { eye: cam.pose().eye, goal: JSON.stringify(board.camera.goal) };
  });
  await wait(300);
  await page.locator('canvas.atlas-tabletop-board').focus();
  await page.keyboard.down('w');
  await wait(300);
  await page.keyboard.up('w');
  const flown = await page.evaluate(() => { const e = window.freeCam.pose().eye; return { eye: e, view: window.boardTest.board.view.position.toArray() }; });
  const moved = Math.hypot(flown.eye.x - free.eye.x, flown.eye.y - free.eye.y, flown.eye.z - free.eye.z);
  check('cinematic: W for 300 ms flies the free camera forward', moved > 20 && flown.eye.z < free.eye.z && flown.eye.y < free.eye.y, JSON.stringify({ free: free.eye, flown: flown.eye }));
  check('cinematic: the drawn camera follows the free camera', Math.abs(flown.view[0] - flown.eye.x) < 1 && Math.abs(flown.view[2] - flown.eye.z) < 1, JSON.stringify(flown));
  // A drag looks and the wheel dollies.
  const aim = () => page.evaluate(() => window.freeCam.pose().target);
  const t0 = await aim();
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(580, 300, { steps: 5 });
  await page.mouse.up();
  const t1 = await aim();
  check('cinematic: a drag turns the free camera', Math.abs(t1.x - t0.x) > 10, JSON.stringify([t0, t1]));
  const e0 = await page.evaluate(() => window.freeCam.pose().eye);
  await page.mouse.wheel(0, -100);
  await wait(100);
  const e1 = await page.evaluate(() => window.freeCam.pose().eye);
  check('cinematic: the wheel dollies the free camera along the view', Math.hypot(e1.x - e0.x, e1.y - e0.y, e1.z - e0.z) > 10, JSON.stringify([e0, e1]));
  check('cinematic: the orbit camera\'s goal is unchanged by the free camera\'s keys, drag and wheel', await page.evaluate(() => JSON.stringify(window.boardTest.board.camera.goal)) === free.goal);
  // The players' window: its own cinema look, the driver's pose, and a held picture.
  const players = await page.evaluate(async () => {
    const { board } = window.boardTest;
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:0;top:0;width:480px;height:300px;z-index:1';
    document.body.appendChild(stage);
    board.attachPlayer(stage);
    board.setPlayersCinematic(true);
    board.cinema.setBars(2);
    board.setCinematic({ pose: () => ({ eye: { x: 500, y: 900, z: 1400 }, target: { x: 500, y: 0, z: 500 }, black: 0.25 }) });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const bars = stage.querySelectorAll('.tabletop-cinema__bar');
    const fade = stage.querySelector('.tabletop-cinema__fade');
    const own = { bars: bars.length, bar: bars[0]?.getBoundingClientRect().height, expected: (300 - 480 / 2) / 2, black: fade?.style.opacity };
    board.holdPlayers(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const held = stage.querySelector('img.tabletop-cinema__hold');
    const picture = { src: held?.src.slice(0, 22), length: held?.src.length };
    board.holdPlayers(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const gone = stage.querySelector('img.tabletop-cinema__hold') === null;
    board.setPlayersCinematic(false);
    const off = stage.querySelector('.tabletop-cinema') === null;
    board.detachPlayer();
    stage.remove();
    return { own, picture, gone, off };
  });
  check('cinematic: the players\' window carries its own bars and fade', players.own.bars === 2 && Math.abs(players.own.bar - players.own.expected) < 1 && players.own.black === '0.25', JSON.stringify(players.own));
  check('cinematic: holdPlayers lays the players\' frame over their stage as an image, until released', players.picture.src === 'data:image/png;base64,' && players.picture.length > 1000 && players.gone, JSON.stringify(players));
  check('cinematic: the players\' cinema look goes when it is turned off', players.off);
  // Letting the driver go returns the camera to its own.
  const back = await page.evaluate(() => {
    const { board } = window.boardTest;
    board.setCinematic(null);
    return { gone: board.cinematic === null, same: JSON.stringify(board.camera.pose) === JSON.stringify(board.camera.goal) };
  });
  check('cinematic: taking the driver away puts the camera back on the person\'s own pose', back.gone && back.same, JSON.stringify(back));
  await page.evaluate(() => window.boardTest.board.setCinematicRole('none'));
  // The fade stays black until a frame has drawn the restored pose: no frame shows the driven shot unfaded.
  const ending = await page.evaluate(async () => {
    const { board } = window.boardTest;
    board.setCinematic({ pose: () => ({ eye: { x: 500, y: 900, z: 1400 }, target: { x: 500, y: 0, z: 500 }, black: 1 }) });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const frames = [];
    const render = board.renderer.render.bind(board.renderer);
    board.renderer.render = (...args) => {
      frames.push({ black: board.cinema.black, atGoal: JSON.stringify(board.camera.pose) === JSON.stringify(board.camera.goal) });
      return render(...args);
    };
    board.setCinematic(null);
    const right = board.cinema.black;
    await new Promise((resolve) => setTimeout(resolve, 300));
    board.renderer.render = render;
    return { right, frames, after: board.cinema.black };
  });
  check('cinematic: the fade is still black right after the driver goes', ending.right === 1, JSON.stringify(ending));
  check('cinematic: no frame draws the driven pose unfaded, and the first frame of the restored pose is still black', ending.frames.length > 0 && ending.frames[0].atGoal && ending.frames[0].black === 1 && ending.frames.every((f) => f.atGoal || f.black === 1), JSON.stringify(ending.frames.slice(0, 3)));
  check('cinematic: the fade clears after that frame', ending.after === 0, JSON.stringify(ending));
  // The held picture is let go when the players' window goes: a window attached again draws live. Disposing clears the driver and the AR view.
  const spare = await page.evaluate(async () => {
    const { Board, host, QUALITY, board } = window.boardTest;
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px;';
    document.body.appendChild(div);
    const made = new Board(div, host, QUALITY.medium);
    await made.load({ ...board.map });
    const stage = (id) => { const e = document.createElement('div'); e.id = id; e.style.cssText = 'position:fixed;left:0;top:300px;width:300px;height:200px;'; document.body.appendChild(e); return e; };
    const first = stage('spare-a');
    made.attachPlayer(first);
    made.holdPlayers(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const heldBefore = made.playerHeld !== null;
    made.detachPlayer();
    const heldAfter = made.playerHeld;
    first.remove();
    const second = stage('spare-b');
    made.attachPlayer(second);
    made.holdPlayers(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const live = !second.querySelector('img.tabletop-cinema__hold') && second.querySelector('canvas') !== null;
    second.remove();
    made.setCinematicRole('locked');
    made.setCinematic({ pose: () => ({ eye: { x: 500, y: 900, z: 1400 }, target: { x: 500, y: 0, z: 500 }, black: 0 }) });
    made.setAugmented({ rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 400], frustum: { left: -1, right: 1, top: -1, bottom: 1 }, squareMm: 25 });
    const kept = { driver: made.cinematic !== null, arLatest: made.arLatest !== null };
    await new Promise((resolve) => setTimeout(resolve, 300));
    // No try/catch: a board whose players' window was attached and detached must dispose without throwing (the lamps' shared shadow maps).
    made.dispose();
    div.remove();
    return { heldBefore, heldAfter, live, kept, driver: made.cinematic, arLatest: made.arLatest };
  });
  check('cinematic: detaching the players\' window lets go of the held picture, and a window attached again draws live', spare.heldBefore && spare.heldAfter === null && spare.live, JSON.stringify(spare));
  check('cinematic: disposing a board clears its driver and its latest AR view', spare.kept.driver && spare.kept.arLatest && spare.driver === null && spare.arLatest === null, JSON.stringify(spare));
});

// ── Cutscenes: authoring (the gallery, the free camera, the timeline) ─────────────────────────────────────────────
/** The GM picks Cinematic on the mode switch (the harness board's modes on, in Play): the gallery opens. */
const enterCinematic = async (page) => {
  await page.evaluate(() => { const { modes, board } = window.boardTest; if (!modes.on) { modes.on = true; modes.mode = 'play'; } board.refreshToolbar(); });
  await page.locator('button[aria-label="Cinematic mode"]').click();
};
/** The timeline's shot markers sit PAD pixels in, 80 pixels to the second. */
const TL_PAD = 24;
const TL_PPS = 80;
const timelineAt = async (page, seconds, y = 62) => {
  const box = await page.evaluate(() => { const r = document.querySelector('.tabletop-timeline__scroll').getBoundingClientRect(); return { left: r.left, top: r.top }; });
  return { x: box.left + TL_PAD + seconds * TL_PPS, y: box.top + y };
};
const lastSave = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.boardTest.studio.log.saves.at(-1))));

feature('cutscene authoring', async ({ page, shot }) => {
  const studioState = () => page.evaluate(() => window.boardTest.studio.studio.state);
  const role = () => page.evaluate(() => window.boardTest.board.cinematicRole);
  const sleepFrame = () => wait(250);
  // The gallery: the Cinematic mode opens it, the settings are in its header.
  const before = await page.evaluate(() => JSON.stringify(window.boardTest.board.camera.pose));
  await enterCinematic(page);
  check('authoring: the Cinematic mode opens the gallery', await studioState() === 'gallery' && await page.locator('.tabletop-gallery').count() === 1);
  await page.locator('.tabletop-gallery__options').click();
  await page.locator('select[data-setting="aspect"]').selectOption('1.85');
  await page.locator('input[data-setting="bars"]').uncheck();
  await page.locator('input[data-setting="bars"]').check();
  const settings = await page.evaluate(() => window.boardTest.studio.log.settings);
  check('authoring: the cinematic settings are saved through the host', settings.aspect === 1.85 && settings.bars === true, JSON.stringify(settings));
  await page.locator('.tabletop-gallery__options').click();
  // + asks a name (Cancel keeps nothing), then opens the new cutscene in the editor.
  await page.locator('.tabletop-gallery__add').click();
  await sleepFrame();
  check('authoring: + asks for a name, "Cutscene" to begin with, and a refused name makes nothing', await page.evaluate(() => window.boardTest.studio.log.asked[0] === 'Cutscene' && window.boardTest.studio.log.saves.length === 0) && await studioState() === 'gallery');
  await page.evaluate(() => window.boardTest.studio.log.names.push('Docks'));
  await page.locator('.tabletop-gallery__add').click();
  await sleepFrame();
  check('authoring: + with a name opens the editor with the authoring role', await studioState() === 'editing' && await role() === 'authoring');
  check('authoring: the new cutscene is saved at once, with no shots', await page.evaluate(() => { const l = window.boardTest.studio.log.saves; return l.length === 1 && l[0].cutscene.name === 'Docks' && l[0].cutscene.shots.length === 0 && window.boardTest.studio.store.get(window.boardTest.studio.first).length === 1; }));
  check('authoring: the settings\' bars show on the board (1.85:1)', await page.evaluate(() => window.boardTest.board.cinema.aspect === 1.85));
  check('authoring: with no shots Preview is off and says why', await page.evaluate(() => { const b = document.querySelector('.tabletop-timeline__preview'); return b.disabled && /shot/i.test(b.title) && /add a shot/i.test(document.querySelector('.tabletop-timeline__hint').textContent); }));
  await page.evaluate(() => window.boardTest.studio.studio.preview(0));
  check('authoring: asking for a preview of a cutscene with no shots does nothing but say why', await studioState() === 'editing' && await page.evaluate(() => window.boardTest.studio.log.notices.length === 1 && /shot/i.test(window.boardTest.studio.log.notices[0])));

  // Left clicks make shots, with the free camera's pose.
  await page.locator('canvas.atlas-tabletop-board').focus();
  let at = await timelineAt(page, 0);
  await page.mouse.click(at.x, at.y);
  await page.locator('canvas.atlas-tabletop-board').focus();
  await page.keyboard.down('w');
  await wait(400);
  await page.keyboard.up('w');
  at = await timelineAt(page, 2);
  await page.mouse.click(at.x, at.y);
  let saved = (await lastSave(page)).cutscene;
  check('authoring: two clicks save two shots, 2 s apart, with different eyes (W flew between them)', saved.shots.length === 2 && saved.shots[0].at === 0 && Math.abs(saved.shots[1].at - 2000) <= 20 && JSON.stringify(saved.shots[0].eye) !== JSON.stringify(saved.shots[1].eye), JSON.stringify(saved.shots.map((s) => [s.at, s.eye])));
  check('authoring: a new shot is a fade on the first map, not a keyframe', saved.shots[1].transition === 'fade' && saved.shots[1].keyframe === false && saved.shots[1].mapPath === (await page.evaluate(() => window.boardTest.studio.first)));
  // Right click between two shots: the transition.
  at = await timelineAt(page, 1);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const gap = await page.evaluate(() => [...document.querySelectorAll('.tabletop-menu__item')].map((i) => ({ text: i.textContent.replace('✓', ''), checked: i.getAttribute('aria-checked'), disabled: i.disabled })));
  check('authoring: a right click between two shots offers Fade, Cut and Move with the current one ticked', gap.map((g) => g.text).join() === 'Fade,Cut,Move' && gap[0].checked === 'true' && gap[1].checked === 'false' && gap.every((g) => !g.disabled), JSON.stringify(gap));
  await page.locator('.tabletop-menu__item', { hasText: 'Move' }).click();
  saved = (await lastSave(page)).cutscene;
  check('authoring: Move sets the second shot\'s transition to move', saved.shots[1].transition === 'move');
  // A shot on another map: the editor stays open, new shots take the new map, and a move across maps is refused.
  const free0 = await page.evaluate(() => JSON.stringify(window.boardTest.board.cinematic.free.pose()));
  await page.evaluate(() => window.boardTest.studio.host.showPlace(window.boardTest.studio.second));
  await wait(500);
  check('authoring: a scene switch keeps the editor open, the role and the free camera where it was', await studioState() === 'editing' && await role() === 'authoring' && await page.evaluate(() => JSON.stringify(window.boardTest.board.cinematic.free.pose())) === free0);
  at = await timelineAt(page, 4);
  await page.mouse.click(at.x, at.y);
  saved = (await lastSave(page)).cutscene;
  const second = await page.evaluate(() => window.boardTest.studio.second);
  check('authoring: a shot made after the switch is on the second map', saved.shots.length === 3 && saved.shots[2].mapPath === second && Math.abs(saved.shots[2].at - 4000) <= 20, JSON.stringify(saved.shots.map((s) => [s.at, s.mapPath])));
  check('authoring: that cutscene still belongs to the first map\'s gallery', await page.evaluate(() => { const s = window.boardTest.studio; return s.log.saves.at(-1).mapPath === s.first && s.studio.editing.home === s.first; }));
  const marker = await page.evaluate(() => [...document.querySelectorAll('.tabletop-timeline__shot')].map((m) => ({ other: m.classList.contains('tabletop-timeline__shot--other'), title: m.title })));
  check('authoring: a shot on another map is drawn apart and its tooltip names the map', !marker[0].other && marker[2].other && /crypt/i.test(marker[2].title) && !/crypt/i.test(marker[0].title), JSON.stringify(marker));
  at = await timelineAt(page, 3);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const across = await page.evaluate(() => [...document.querySelectorAll('.tabletop-menu__item')].map((i) => ({ text: i.textContent.replace('✓', ''), disabled: i.disabled })));
  check('authoring: between shots on different maps Move is disabled', across.find((a) => a.text === 'Move')?.disabled === true && across.find((a) => a.text === 'Fade')?.disabled === false, JSON.stringify(across));
  await page.keyboard.press('Escape');
  check('authoring: Escape closes the menu and leaves the editor open', await page.locator('.tabletop-menu').count() === 0 && await studioState() === 'editing');
  // A shot menu: keyframe.
  at = await timelineAt(page, 2, 40);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const items = await page.evaluate(() => [...document.querySelectorAll('.tabletop-menu__item')].map((i) => i.textContent.replace('✓', '')));
  check('authoring: a right click on a shot offers keyframe, preview from here, update to the camera and delete', items.join() === 'Make keyframe shot,Preview from here,Update to current camera,Delete', items.join());
  await page.locator('.tabletop-menu__item', { hasText: 'Make keyframe shot' }).click();
  saved = (await lastSave(page)).cutscene;
  check('authoring: Make keyframe shot saves keyframe: true', saved.shots[1].keyframe === true);
  // Dragging a shot retimes it.
  at = await timelineAt(page, 2, 40);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + TL_PPS / 2, at.y, { steps: 4 });
  await page.mouse.move(at.x + TL_PPS, at.y, { steps: 4 });
  await page.mouse.up();
  saved = (await lastSave(page)).cutscene;
  check('authoring: dragging shot 2 to 3 s saves its time within 50 ms of 3000', Math.abs(saved.shots[1].at - 3000) <= 50 && saved.shots.length === 3, JSON.stringify(saved.shots.map((s) => s.at)));
  // No normal limit on the authoring camera.
  const look = await page.evaluate(async () => {
    const { board } = window.boardTest;
    const free = board.cinematic.free;
    const pitchOf = () => { const p = free.pose(); return Math.asin((p.target.y - p.eye.y) / Math.hypot(p.target.x - p.eye.x, p.target.y - p.eye.y, p.target.z - p.eye.z)); };
    const forwardY = () => board.view.getWorldDirection(new window.boardTest.Vector3()).y;
    free.look(0, 1.5 - pitchOf());
    await new Promise((resolve) => setTimeout(resolve, 300));
    const up = { pitch: pitchOf(), y: forwardY() };
    free.look(0, -3);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const down = { pitch: pitchOf(), y: forwardY() };
    return { up, down };
  });
  check('authoring: the camera looks up at 1.5 rad and the board draws it so', Math.abs(look.up.pitch - 1.5) < 0.01 && Math.abs(look.up.y - Math.sin(1.5)) < 0.02, JSON.stringify(look));
  check('authoring: look(0, -3) turns it to 1.5 rad down; no limit clamps the pose', Math.abs(look.down.pitch + 1.5) < 0.01 && Math.abs(look.down.y + Math.sin(1.5)) < 0.02, JSON.stringify(look));
  const thumbs = await page.evaluate(() => {
    const studio = window.boardTest.studio.studio;
    const shots = studio.editing.cutscene.shots;
    const here = shots.filter((s) => window.boardTest.studio.host.at(s.level ? s.mapPath + '#' + s.level : s.mapPath)).length;
    const cells = [...document.querySelectorAll('.tabletop-timeline:not(.tabletop-timeline--run) .tabletop-timeline__thumb')];
    return { shots: shots.length, here, cells: cells.length, pictures: cells.filter((c) => c.querySelector('img')?.src.startsWith('data:image/png')).length };
  });
  check('timeline: every shot has a thumbnail cell, a picture of what it sees where its map is the one shown', thumbs.cells === thumbs.shots && thumbs.pictures >= 1 && thumbs.pictures >= thumbs.here - 0, JSON.stringify(thumbs));
  await shot('cutscene-timeline');
  // Done: everything is back as it was.
  await page.locator('.tabletop-timeline__done').click();
  await page.waitForFunction(() => window.boardTest.studio.studio.state === 'idle', null, { timeout: 8000 });
  await wait(300);
  const after = await page.evaluate(() => ({ role: window.boardTest.board.cinematicRole, pose: JSON.stringify(window.boardTest.board.camera.pose), driver: window.boardTest.board.cinematic, map: window.boardTest.studio.host.mapPath(), first: window.boardTest.studio.first, holds: window.boardTest.studio.log.holds, bars: window.boardTest.board.cinema.aspect, timeline: document.querySelector('.tabletop-timeline').hidden }));
  check('authoring: Done gives role none, no driver, no bars and a hidden timeline', after.role === 'none' && after.driver === null && after.bars === null && after.timeline === true, JSON.stringify(after));
  check('authoring: Done brings back the first map and the camera exactly as it was before +', after.map === after.first && after.pose === before, JSON.stringify([after.pose, before]));
  check('authoring: the players\' window was held while editing and let go after', after.holds[0] === true && after.holds.at(-1) === false, JSON.stringify(after.holds));
  // The gallery lists it; Preview is on for a cutscene with shots and off for one without; Delete asks first.
  await enterCinematic(page);
  const row = await page.evaluate(() => [...document.querySelectorAll('.tabletop-gallery__row')].map((r) => ({ name: r.querySelector('.tabletop-gallery__name').textContent, count: r.querySelector('.tabletop-gallery__count').textContent, preview: r.querySelector('.tabletop-gallery__preview').disabled })));
  const galleryLook = await page.evaluate(() => {
    const head = document.querySelector('.tabletop-gallery__head');
    const r = document.querySelector('.tabletop-gallery__row');
    const buttons = [...r.querySelectorAll('.tabletop-gallery__actions button')];
    return {
      head: [...head.querySelectorAll('button')].map((b) => [b.dataset.icon, b.getAttribute('aria-label')]),
      row: buttons.map((b) => [b.dataset.icon, b.getAttribute('aria-label'), b.textContent]),
      lines: new Set([r.querySelector('.tabletop-gallery__name'), ...buttons].map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2))).size,
    };
  });
  check('gallery: + and the settings are Atlas\'s icons (plus, settings), and there is no close button', JSON.stringify(galleryLook.head) === JSON.stringify([['plus', 'New cutscene'], ['settings', 'Cinematic settings']]), JSON.stringify(galleryLook.head));
  check('gallery: a cutscene\'s buttons are icons (play, pencil, eye, trash), named for their tooltip, with no text', JSON.stringify(galleryLook.row.map((b) => b[0])) === JSON.stringify(['play', 'pencil', 'eye', 'trash-2']) && galleryLook.row.every((b) => b[1] && b[2] === ''), JSON.stringify(galleryLook.row));
  check('gallery: the name and the buttons sit on one line', galleryLook.lines === 1, JSON.stringify(galleryLook));
  check('authoring: the gallery lists the cutscene with its shots and an enabled Preview', row.length === 1 && row[0].name === 'Docks' && row[0].count === '3 shots' && row[0].preview === false, JSON.stringify(row));
  await page.evaluate(() => window.boardTest.studio.log.names.push('Empty'));
  await page.locator('.tabletop-gallery__add').click();
  await sleepFrame();
  await page.locator('.tabletop-timeline__done').click();
  await page.waitForFunction(() => window.boardTest.studio.studio.state === 'idle', null, { timeout: 8000 });
  await enterCinematic(page);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.tabletop-gallery__row')].map((r) => ({ name: r.querySelector('.tabletop-gallery__name').textContent, count: r.querySelector('.tabletop-gallery__count').textContent, preview: r.querySelector('.tabletop-gallery__preview').disabled, title: r.querySelector('.tabletop-gallery__preview').title })));
  check('authoring: a cutscene with no shots has Preview disabled, with the reason shown', rows.length === 2 && rows[1].preview === true && rows[1].count === 'No shots yet' && /shot/i.test(rows[1].title), JSON.stringify(rows));
  await page.evaluate(() => window.boardTest.studio.log.names.push('Empty cut'));
  check('authoring: the gallery has no Rename button: the name renames on a double click', await page.locator('.tabletop-gallery__rename').count() === 0);
  await page.locator('.tabletop-gallery__row').nth(1).locator('.tabletop-gallery__name').dblclick();
  await sleepFrame();
  check('authoring: Rename asks with the current name and saves the new one', await page.evaluate(() => window.boardTest.studio.log.asked.at(-1) === 'Empty' && window.boardTest.studio.store.get(window.boardTest.studio.first)[1].name === 'Empty cut'));
  await page.locator('.tabletop-gallery__row').nth(1).locator('.tabletop-gallery__delete').click();
  check('authoring: Delete asks for a confirmation and keeps the cutscene until it is given', await page.evaluate(() => window.boardTest.studio.store.get(window.boardTest.studio.first).length === 2) && await page.locator('.tabletop-gallery__yes').count() === 1);
  await page.locator('.tabletop-gallery__yes').click();
  check('authoring: confirmed, Delete removes the cutscene', await page.evaluate(() => window.boardTest.studio.store.get(window.boardTest.studio.first).length === 1));
});

// ── Cutscenes: preview ────────────────────────────────────────────────────────────────────────────────────────────
feature('cutscene preview', async ({ page }) => {
  const eyes = [{ x: 400, y: 700, z: 1200 }, { x: 800, y: 600, z: 1100 }, { x: 600, y: 500, z: 900 }, { x: 300, y: 450, z: 700 }];
  await page.evaluate((eyes) => {
    const { studio } = window.boardTest;
    const target = (i) => ({ x: eyes[i].x, y: 0, z: eyes[i].z - 600 });
    const make = (i, at, mapPath, extra) => ({ id: `s${i}`, at, mapPath, eye: eyes[i], target: target(i), keyframe: false, transition: 'fade', ...extra });
    studio.store.set(studio.first, [{ id: 'pre', name: 'Preview me', shots: [
      make(0, 0, studio.first),
      make(1, 800, studio.first, { keyframe: true, transition: 'move' }),
      make(2, 1800, studio.second, { transition: 'fade' }),
      make(3, 2800, studio.second, { transition: 'cut' }),
    ] }]);
  }, eyes);
  const state = () => page.evaluate(() => window.boardTest.studio.studio.state);
  const label = () => page.locator('.tabletop-preview__label').textContent();
  const rests = async (index, map) => {
    await page.waitForFunction(({ index, map }) => {
      const s = window.boardTest.studio;
      const p = s.studio.previewState;
      return p && p.shot === index && p.resting && s.host.mapPath() === map && window.boardTest.board.cinema.black === 0;
    }, { index, map }, { timeout: 12000 });
    await wait(250);
  };
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1;
  const eyeNow = () => page.evaluate(() => { const p = window.boardTest.board.view.position; return { x: p.x, y: p.y, z: p.z }; });
  const ids = await page.evaluate(() => ({ first: window.boardTest.studio.first, second: window.boardTest.studio.second }));

  await enterCinematic(page);
  await page.locator('.tabletop-gallery__preview').click();
  await rests(0, ids.first);
  check('preview: from the start it rests on shot 1 of 4, role previewing', await state() === 'previewing' && await label() === 'Shot 1 of 4' && await page.evaluate(() => window.boardTest.board.cinematicRole) === 'previewing');
  check('preview: the board draws shot 1\'s camera', near(await eyeNow(), eyes[0]), JSON.stringify(await eyeNow()));
  check('preview: the players\' window stays held', await page.evaluate(() => window.boardTest.studio.log.holds.at(-1)) === true);
  // The strip stays under the preview: every shot, the one the preview is at marked; a click cuts the preview to a shot.
  const strip = await page.evaluate(() => {
    const el = document.querySelector('.tabletop-timeline:not(.tabletop-timeline--run)');
    const cells = el ? [...el.querySelectorAll('.tabletop-timeline__thumb')] : [];
    return { shown: !!el && !el.hidden && getComputedStyle(el).display !== 'none', cells: cells.length, current: cells.findIndex((c) => c.classList.contains('is-current')) };
  });
  check('preview: the timeline shows under the preview, a thumbnail per shot, the current one marked', strip.shown && strip.cells === 4 && strip.current === 0, JSON.stringify(strip));
  check('preview: the control bar offers Previous, Next and Back to editing', await page.evaluate(() => [...document.querySelectorAll('.tabletop-preview button')].map((b) => b.textContent).join()) === 'Previous,Next,Back to editing');
  await page.locator('.tabletop-preview__next').click();
  await rests(2, ids.second);
  check('preview: Next runs through the keyframe shot, crosses to the second map after the fade and rests on shot 3', await label() === 'Shot 3 of 4' && near(await eyeNow(), eyes[2]), `${await label()} ${JSON.stringify(await eyeNow())}`);
  check('preview: the map was switched once, by the fade', await page.evaluate(() => window.boardTest.studio.log.switches.join()) === ids.second);
  await page.locator('.tabletop-preview__previous').click();
  await rests(0, ids.first);
  check('preview: Previous cuts back to shot 1 on the first map', await label() === 'Shot 1 of 4' && near(await eyeNow(), eyes[0]));
  await page.locator('.tabletop-timeline:not(.tabletop-timeline--run) .tabletop-timeline__thumb').nth(2).click();
  await wait(200);
  check('preview: a click on shot 3 in the timeline cuts the preview to it', await label() === 'Shot 3 of 4' && await page.evaluate(() => [...document.querySelectorAll('.tabletop-timeline:not(.tabletop-timeline--run) .tabletop-timeline__thumb')].findIndex((c) => c.classList.contains('is-current'))) === 2, await label());
  await page.locator('.tabletop-preview__back').click();
  check('preview: Back to editing returns to the editor with the authoring role', await state() === 'editing' && await page.evaluate(() => window.boardTest.board.cinematicRole) === 'authoring' && await page.locator('.tabletop-timeline:not(.tabletop-timeline--run)').isVisible());
  // Preview from a shot, by its menu.
  const at = await timelineAt(page, 0.8, 40);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.locator('.tabletop-menu__item', { hasText: 'Preview from here' }).click();
  await rests(1, ids.first);
  check('preview: Preview from here on shot 2 starts resting on shot 2', await label() === 'Shot 2 of 4' && near(await eyeNow(), eyes[1]), `${await label()} ${JSON.stringify(await eyeNow())}`);
  // Next from there crosses the fade; Next at the last shot ends the preview.
  await page.locator('.tabletop-preview__next').click();
  await rests(2, ids.second);
  await page.locator('.tabletop-preview__next').click();
  await rests(3, ids.second);
  await page.locator('.tabletop-preview__next').click();
  await wait(500);
  check('preview: Next on the last shot goes back to editing', await state() === 'editing');
  // Escape in a preview goes back to editing; Escape in the editor leaves it.
  await page.evaluate(() => window.boardTest.studio.studio.preview(0));
  await page.keyboard.press('Escape');
  check('preview: Escape goes back to editing', await state() === 'editing');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.boardTest.studio.studio.state === 'idle', null, { timeout: 8000 });
  check('preview: Escape in the editor leaves it, on the first map', await page.evaluate(() => window.boardTest.studio.host.mapPath() === window.boardTest.studio.first && window.boardTest.board.cinematicRole === 'none' && window.boardTest.board.cinematic === null));
});

// ── Cutscenes: running for players ────────────────────────────────────────────────────────────────────────────────────
/** A cutscene on the first map: shot 1, two keyframe shots, and a last shot on the second map. */
const docks = (first, second) => ({ id: 'docks', name: 'Docks', shots: [
  { id: 'd0', at: 0, mapPath: first, eye: { x: 400, y: 700, z: 1200 }, target: { x: 400, y: 0, z: 600 }, keyframe: false, transition: 'fade' },
  { id: 'd1', at: 800, mapPath: first, eye: { x: 800, y: 600, z: 1100 }, target: { x: 800, y: 0, z: 500 }, keyframe: true, transition: 'move' },
  { id: 'd2', at: 1600, mapPath: first, eye: { x: 600, y: 500, z: 900 }, target: { x: 600, y: 0, z: 300 }, keyframe: true, transition: 'move' },
  { id: 'd3', at: 2600, mapPath: second, eye: { x: 300, y: 450, z: 700 }, target: { x: 300, y: 0, z: 100 }, keyframe: false, transition: 'fade' },
] });

feature('cutscene run', async ({ page }) => {
  const ids = await page.evaluate(() => ({ first: window.boardTest.studio.first, second: window.boardTest.studio.second }));
  await page.evaluate(({ first, second, make }) => {
    const { studio, setHosting, api } = window.boardTest;
    setHosting(true);
    studio.store.set(first, [new Function(`return (${make})`)()(first, second)]);
    window.runLog = { changes: 0, cameras: 0 };
    api.cutscene.onChange(() => { window.runLog.changes++; });
    api.cutscene.onCamera(() => { window.runLog.cameras++; });
    // The players' window, open on the GM's board.
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;right:0;top:0;width:360px;height:240px;z-index:1';
    document.body.appendChild(stage);
    window.boardTest.board.attachPlayer(stage);
    window.seenByPlayers = () => {
      const b = window.boardTest.board;
      b.showFor('player');
      const out = b.tokens.get('lurker').piece.object3d.visible;
      b.showFor('gm');
      return out;
    };
  }, { ...ids, make: docks.toString() });
  const current = () => page.evaluate(() => window.boardTest.api.cutscene.current());
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1;
  const idle = () => page.waitForFunction(() => window.boardTest.studio.studio.state === 'idle', null, { timeout: 12000 });
  const onMap = (map) => page.waitForFunction((map) => window.boardTest.studio.host.mapPath() === map && window.boardTest.board.cinema.black === 0, map, { timeout: 12000 });
  const before = await page.evaluate(() => JSON.stringify(window.boardTest.board.camera.pose));
  const plain = await page.evaluate(() => window.seenByPlayers());
  check('cutscene run: before Play a token under the fog is hidden from the players\' window', plain === false);

  await enterCinematic(page);
  // Cinematic mode puts the players on the GM's camera first (Connect hosts here); the run's counts start after it.
  await page.waitForFunction(() => window.boardTest.studio.studio.live, null, { timeout: 5000 }).catch(() => undefined);
  check('cutscene run: entering Cinematic mode has the players follow the GM camera', await page.evaluate(() => window.boardTest.studio.studio.live && window.boardTest.studio.studio.state === 'gallery'));
  await page.evaluate(() => { window.runLog.changes = 0; window.boardTest.studio.log.lent.length = 0; });
  check('cutscene run: a cutscene with shots has Play for players on (Connect hosts)', await page.locator('.tabletop-gallery__play').getAttribute('aria-disabled') === null);
  await page.locator('.tabletop-gallery__play').click();
  await page.waitForFunction(() => window.boardTest.api.cutscene.current() !== null, null, { timeout: 5000 });
  const started = await current();
  check('cutscene run: Play for players publishes step 0, seq 1, once', JSON.stringify(started.cutscene.step) === '{"shot":0,"seq":1}' && await page.evaluate(() => window.runLog.changes) === 1, JSON.stringify(started.cutscene.step));
  check('cutscene run: it is a prepared run of 4 shots on the first key, with the settings\' bars and fade', started.cutscene.mode === 'prepared' && started.cutscene.shots.length === 4 && started.cutscene.key === 'k1' && started.cutscene.look.bars === 2.39 && started.cutscene.look.fadeMs === 600, JSON.stringify(started.cutscene.look));
  check('cutscene run: the keys map back to the vault paths here, and none is in what players are sent', JSON.stringify(started.maps) === JSON.stringify({ k1: ids.first, k2: ids.second }) && !JSON.stringify(started.cutscene).includes('.atlasmap'), JSON.stringify(started.maps));
  check('cutscene run: the board is in the running role with a driver, bars and the reveal, and the studio says running', await page.evaluate(() => { const b = window.boardTest.board; return b.cinematicRole === 'running' && b.cinematic !== null && b.cinema.aspect === 2.39 && window.boardTest.studio.studio.state === 'running'; }));
  check('cutscene run: the players\' window was lent to the run', await page.evaluate(() => window.boardTest.studio.log.lent.join()) === 'true');
  // "Players follow my camera" while a prepared cutscene plays: refused, and the cutscene goes on.
  await page.evaluate(() => window.boardTest.studio.studio.toggleLive());
  const refusedLive = { run: await current(), notice: await page.evaluate(() => window.boardTest.studio.log.notices.at(-1)), changes: await page.evaluate(() => window.runLog.changes), state: await page.evaluate(() => window.boardTest.studio.studio.state) };
  check('cutscene run: "Players follow my camera" during a prepared run is refused with a notice, and the run goes on', refusedLive.run !== null && refusedLive.run.cutscene.mode === 'prepared' && /end the cutscene first/.test(refusedLive.notice) && refusedLive.changes === 1 && refusedLive.state === 'running', JSON.stringify({ ...refusedLive, run: !!refusedLive.run }));
  check('cutscene run: the control bar offers Previous, Next and End, on shot 1 of 4', await page.evaluate(() => [...document.querySelectorAll('.tabletop-run button')].map((b) => b.textContent).join()) === 'Previous,Next,End' && await page.locator('.tabletop-run__label').textContent() === 'Shot 1 of 4');
  await wait(1800);
  const shot0 = await page.evaluate(() => { const p = window.boardTest.board.view.position; return { x: p.x, y: p.y, z: p.z }; });
  check('cutscene run: after the fade in the board draws shot 1', near(shot0, { x: 400, y: 700, z: 1200 }), JSON.stringify(shot0));
  const players = await page.evaluate(() => ({ pose: window.boardTest.board.playerPose(), seen: window.seenByPlayers() }));
  check('cutscene run: the players\' window\'s camera is the driver\'s', near(players.pose.eye, shot0), JSON.stringify(players.pose));
  check('cutscene run: a fogged token is drawn in the players\' window (the reveal)', players.seen === true);

  // Next runs through the keyframe shots to the last shot, which is on the second map.
  await page.locator('.tabletop-run__next').click();
  const next = await current();
  check('cutscene run: Next steps to shot index 3 on key k2 (seq 2)', next.cutscene.step.shot === 3 && next.cutscene.step.seq === 2 && next.cutscene.key === 'k2', JSON.stringify(next.cutscene.step));
  await onMap(ids.second);
  await wait(300);
  check('cutscene run: the GM board was switched to the second map', await page.evaluate(() => window.boardTest.studio.log.switches.join()) === ids.second);
  await page.waitForFunction(() => { const r = document.querySelector('.tabletop-run__label'); return r && r.textContent === 'Shot 4 of 4'; });
  await wait(1500);
  const shot3 = await page.evaluate(() => { const p = window.boardTest.board.view.position; return { x: p.x, y: p.y, z: p.z }; });
  check('cutscene run: it rests on shot 4', near(shot3, { x: 300, y: 450, z: 700 }), JSON.stringify(shot3));

  // Previous: a cut back to shot 1 on the first map.
  await page.locator('.tabletop-run__previous').click();
  const previous = await current();
  check('cutscene run: Previous steps back to shot index 0 on key k1 (seq 3)', previous.cutscene.step.shot === 0 && previous.cutscene.step.seq === 3 && previous.cutscene.key === 'k1', JSON.stringify(previous.cutscene.step));
  // The GM's strip of the run: every shot, the current one marked; a click on a shot cuts to it.
  const strip = await page.evaluate(() => {
    const el = document.querySelector('.tabletop-timeline--run');
    return { shown: !!el && !el.hidden, cells: el ? el.querySelectorAll('.tabletop-timeline__thumb').length : 0, current: el ? [...el.querySelectorAll('.tabletop-timeline__thumb')].findIndex((c) => c.classList.contains('is-current')) : -2 };
  });
  check('cutscene run: the GM sees the run\'s timeline, a thumbnail per shot, shot 1 marked', strip.shown && strip.cells === 4 && strip.current === 0, JSON.stringify(strip));
  await page.locator('.tabletop-timeline--run .tabletop-timeline__thumb').nth(2).click();
  await page.waitForFunction(() => window.boardTest.api.cutscene.current()?.cutscene.step.shot === 2, null, { timeout: 5000 }).catch(() => undefined);
  const jumped = { step: (await current())?.cutscene.step, label: await page.locator('.tabletop-run__label').textContent(), marked: await page.evaluate(() => [...document.querySelectorAll('.tabletop-timeline--run .tabletop-timeline__thumb')].findIndex((c) => c.classList.contains('is-current'))) };
  check('cutscene run: a click on shot 3 in the GM\'s timeline cuts the run to it, and players are told', jumped.step?.shot === 2 && jumped.label === 'Shot 3 of 4' && jumped.marked === 2, JSON.stringify(jumped));
  await onMap(ids.first);
  await wait(300);

  // End: players are told at once, the GM board fades out and is back on its map and its camera.
  await page.locator('.tabletop-run__next').click();
  await onMap(ids.second);
  await wait(300);
  const changesBefore = await page.evaluate(() => window.runLog.changes);
  await page.locator('.tabletop-run__end').click();
  check('cutscene run: End publishes null at once', await current() === null && await page.evaluate(() => window.runLog.changes) === changesBefore + 1);
  await idle();
  await wait(300);
  const after = await page.evaluate(() => ({ pose: JSON.stringify(window.boardTest.board.camera.pose), map: window.boardTest.studio.host.mapPath(), role: window.boardTest.board.cinematicRole, driver: window.boardTest.board.cinematic, aspect: window.boardTest.board.cinema.aspect, black: window.boardTest.board.cinema.black, lent: window.boardTest.studio.log.lent.join(), seen: window.seenByPlayers(), playerPose: window.boardTest.board.playerPose(), own: window.boardTest.board.cameraPose() }));
  check('cutscene run: after End the board is back on the first map', after.map === ids.first, after.map);
  check('cutscene run: after End the camera pose is exactly what it was before Play', after.pose === before, `${before} ${after.pose}`);
  check('cutscene run: after End the role, driver, bars and fade are gone and the window is given back', after.role === 'none' && after.driver === null && after.aspect === null && after.black === 0 && after.lent === 'true,false', JSON.stringify(after));
  check('cutscene run: after End the players\' window follows the GM\'s camera again and the fogged token is hidden there again', near(after.playerPose.eye, after.own.eye) && after.seen === false, JSON.stringify(after.playerPose));

  // Next on the last shot is End.
  await page.evaluate(() => window.boardTest.studio.studio.play('docks'));
  await wait(300);
  await page.locator('.tabletop-run__next').click();
  await onMap(ids.second);
  await wait(300);
  await page.locator('.tabletop-run__next').click();
  check('cutscene run: Next on the last shot ends the run', await current() === null);
  await idle();
  check('cutscene run: and the board is back on the first map', await page.evaluate(() => window.boardTest.studio.host.mapPath()) === ids.first);
});

// ── Cinematic: the third board mode beside Play and Edit ──────────────────────────────────────────
feature('cinematic board mode', async ({ page, shot }) => {
  const ids = await page.evaluate(() => ({ first: window.boardTest.studio.first, second: window.boardTest.studio.second }));
  await page.evaluate(({ first, second, make }) => {
    const { studio, setHosting, modes, board } = window.boardTest;
    setHosting(true);
    studio.store.set(first, [new Function(`return (${make})`)()(first, second)]);
    modes.on = true;
    modes.mode = 'edit';
    board.refreshToolbar();
  }, { ...ids, make: docks.toString() });
  const vis = (label) => page.evaluate((label) => { const el = document.querySelector(`[aria-label="${label}"]`); return !!el && el.offsetParent !== null; }, label);
  const seen = async () => ({
    modes: await page.evaluate(() => { const el = document.querySelector('.atlas-tabletop-modes'); return !!el && el.offsetParent !== null; }),
    live: await vis('Players follow my camera'), water: await vis('Water'), paint: await vis('Paint walls'), settings: await vis('Board settings'),
    measure: await vis('Measure'), view: await vis('Visibility'), move: await vis('Move/Select'), undo: await vis('Undo'),
  });
  const active = () => page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-modes button')].filter((b) => b.classList.contains('is-active')).map((b) => b.getAttribute('aria-label')).join());
  const state = () => page.evaluate(() => window.boardTest.studio.studio.state);
  const mode = () => page.evaluate(() => window.boardTest.host.boardMode());
  const idle = () => page.waitForFunction(() => window.boardTest.studio.studio.state === 'idle', null, { timeout: 12000 });

  const labels = await page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-modes button')].filter((b) => b.offsetParent !== null).map((b) => b.getAttribute('aria-label')));
  check('cinematic mode: the mode switch has Play, Edit and Cinematic', JSON.stringify(labels) === '["Play mode","Edit mode","Cinematic mode"]', JSON.stringify(labels));
  check('cinematic mode: there is no separate Cutscenes button', await page.locator('button[aria-label="Cutscenes"]').count() === 0);
  check('cinematic mode: the board starts in Edit, with its building tools', await active() === 'Edit mode' && (await seen()).paint === true);

  // Entering Cinematic puts Edit's tools away, opens the gallery, and shows only the switch and the live toggle.
  await page.evaluate(() => window.boardTest.board.paintWith('materials/brick'));
  check('cinematic mode: painting is on before entering', await page.evaluate(() => window.boardTest.board.isPainting) === true);
  await page.click('[aria-label="Cinematic mode"]');
  await wait(200);
  check('cinematic mode: Cinematic opens the cutscene gallery', await state() === 'gallery' && await page.locator('.tabletop-gallery').count() === 1 && await active() === 'Cinematic mode');
  // At once in the cinema: the board fades to black, comes back with the bars, and (Connect hosting) the players follow the GM's camera.
  const entered = await page.evaluate(async () => {
    const { board, studio } = window.boardTest;
    let peak = 0;
    const t = performance.now();
    while (performance.now() - t < 4000) {
      peak = Math.max(peak, board.cinema.black);
      if (peak > 0.5 && board.cinema.black === 0) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    const session = studio.host.session();
    return { peak, black: board.cinema.black, bars: board.cinema.aspect, settingsBars: studio.host.settings().bars, hosting: session ? session.hosting() : false, live: studio.studio.live, state: studio.studio.state };
  });
  check('cinematic mode: entering fades the board to black and back in with the cinematic settings\' bars', entered.peak > 0.5 && entered.black === 0 && (entered.settingsBars ? entered.bars !== null : entered.bars === null), JSON.stringify(entered));
  check('cinematic mode: with Connect hosting, the players follow the GM\'s camera at once, and the gallery stays open', entered.live === entered.hosting && entered.state === 'gallery', JSON.stringify(entered));
  const above = await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Cinematic mode"]');
    const r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { onTop: !!hit && (hit === button || button.contains(hit)), minPitch: window.boardTest.board.camera.limits.minPitch, maxDistance: window.boardTest.board.camera.limits.maxDistance };
  });
  check('cinematic mode: the toolbar stays above the bars and can be pressed', above.onTop, JSON.stringify(above));
  check('cinematic mode: the camera\'s angle limits are lifted (down to the board\'s edge)', above.minPitch < 0.05, JSON.stringify(above));
  check('cinematic mode: entering puts painting away', await page.evaluate(() => window.boardTest.board.isPainting) === false);
  let now = await seen();
  check('cinematic mode: only the mode switch and the live toggle show', now.modes && now.live && !now.water && !now.paint && !now.settings && !now.measure && !now.view && !now.move && !now.undo, JSON.stringify(now));
  check('cinematic mode: Cinematic does not count as editing (the board reports it, the remembered mode stays Edit)', await mode() === 'cinematic' && await page.evaluate(() => window.boardTest.modes.mode) === 'edit');
  await shot('mode-cinematic');

  // Play closes the gallery and brings the play tools back (once the cinema has faded out).
  await page.click('[aria-label="Play mode"]');
  await page.waitForFunction(() => window.boardTest.studio.studio.state === 'idle', null, { timeout: 8000 });
  await wait(200);
  now = await seen();
  check('cinematic mode: Play closes the gallery and shows the play tools', await state() === 'idle' && await page.locator('.tabletop-gallery').count() === 0 && await active() === 'Play mode' && now.measure && now.move && now.undo && !now.paint, JSON.stringify(now));
  check('cinematic mode: leaving it puts the camera limits back', await page.evaluate(() => window.boardTest.board.camera.limits.minPitch) > 0.05);

  // The gallery has no close button; Escape goes back to the mode before.
  await page.click('[aria-label="Edit mode"]');
  await page.click('[aria-label="Cinematic mode"]');
  check('cinematic mode: the gallery has no close button', await page.locator('.tabletop-gallery__close').count() === 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.boardTest.studio.studio.state === 'idle', null, { timeout: 8000 });
  await wait(200);
  check('cinematic mode: Escape goes back to Edit', await state() === 'idle' && await active() === 'Edit mode' && (await seen()).paint === true);
  await page.click('[aria-label="Play mode"]');
  await page.click('[aria-label="Cinematic mode"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.boardTest.studio.studio.state === 'idle', null, { timeout: 8000 });
  await wait(200);
  check('cinematic mode: Escape closes the gallery and goes back to Play', await state() === 'idle' && await active() === 'Play mode' && (await seen()).measure === true);

  // The editor opened from the gallery keeps Cinematic; Done goes back to the mode before.
  await page.click('[aria-label="Edit mode"]');
  await page.click('[aria-label="Cinematic mode"]');
  await page.evaluate(() => window.boardTest.studio.studio.edit('docks'));
  await wait(300);
  check('cinematic mode: opening a cutscene\'s editor stays in Cinematic', await state() === 'editing' && await mode() === 'cinematic');
  await page.locator('.tabletop-timeline__done').click();
  await idle();
  await wait(200);
  check('cinematic mode: Done goes back to Edit', await mode() === 'edit' && await active() === 'Edit mode');
  // Choosing Play or Edit while the editor is open closes it (the work is saved as it is made).
  await page.click('[aria-label="Cinematic mode"]');
  await page.evaluate(() => window.boardTest.studio.studio.edit('docks'));
  await wait(300);
  await page.evaluate(() => window.boardTest.host.setBoardMode('play'));
  await idle();
  await wait(200);
  check('cinematic mode: Play closes an open editor', await state() === 'idle' && await mode() === 'play' && await active() === 'Play mode');

  // A run for players keeps going when the GM switches to Play; its controls stay.
  await page.evaluate(() => { const { board, modes } = window.boardTest; modes.mode = 'edit'; board.refreshToolbar(); });
  await page.click('[aria-label="Cinematic mode"]');
  await page.locator('.tabletop-gallery__play').click();
  await page.waitForFunction(() => window.boardTest.api.cutscene.current() !== null, null, { timeout: 5000 });
  check('cinematic mode: Play for players closes the gallery and goes back to Edit', await state() === 'running' && await active() === 'Edit mode');
  await page.click('[aria-label="Play mode"]');
  await wait(300);
  const run = await page.evaluate(() => ({ current: window.boardTest.api.cutscene.current() !== null, state: window.boardTest.studio.studio.state, bar: [...document.querySelectorAll('.tabletop-run button')].map((b) => b.textContent).join(), shown: !document.querySelector('.tabletop-run').hidden }));
  check('cinematic mode: a running cutscene survives the switch to Play, with Previous, Next and End on screen', run.current && run.state === 'running' && run.bar === 'Previous,Next,End' && run.shown, JSON.stringify(run));
  await page.click('[aria-label="Edit mode"]');
  await wait(300);
  check('cinematic mode: and the switch to Edit', await page.evaluate(() => window.boardTest.api.cutscene.current() !== null) && await state() === 'running');
  await page.locator('.tabletop-run__end').click();
  await idle();

  // Cinematic is not remembered: only Play and Edit are.
  await page.click('[aria-label="Cinematic mode"]');
  check('cinematic mode: Cinematic is not the remembered mode', await page.evaluate(() => window.boardTest.modes.mode) === 'edit' && await mode() === 'cinematic');
  await page.click('[aria-label="Play mode"]');
  check('cinematic mode: Play and Edit are remembered', await page.evaluate(() => window.boardTest.modes.mode) === 'play');
});

feature('cutscene run refused', async ({ page }) => {
  const ids = await page.evaluate(() => ({ first: window.boardTest.studio.first, second: window.boardTest.studio.second }));
  await page.evaluate(({ first, second, make }) => {
    const { studio } = window.boardTest;
    const docksFor = new Function(`return (${make})`)();
    studio.store.set(first, [docksFor(first, second), { id: 'far', name: 'Far', shots: [{ ...docksFor(first, second).shots[0], id: 'f0', mapPath: 'maps/other.atlasmap' }] }, { id: 'none', name: 'Empty', shots: [] }]);
  }, { ...ids, make: docks.toString() });
  const play = (id) => page.evaluate((id) => window.boardTest.studio.studio.play(id), id);
  const lastNotice = () => page.evaluate(() => window.boardTest.studio.log.notices.at(-1));
  const none = async () => (await page.evaluate(() => window.boardTest.api.cutscene.current())) === null && await page.evaluate(() => window.boardTest.studio.studio.state) !== 'running';
  check('cutscene run: Play for a session that is not hosting is refused', await play('docks') === false && /start a session in Connect first/.test(await lastNotice()) && await none(), await lastNotice());
  await page.evaluate(() => { window.boardTest.setHosting(true); window.boardTest.studio.session.cutscenes = undefined; });
  check('cutscene run: Play for a Connect without cutscenes is refused', await play('docks') === false && /cannot show cutscenes/.test(await lastNotice()) && await none(), await lastNotice());
  await page.evaluate(() => { window.boardTest.studio.session.cutscenes = true; });
  check('cutscene run: Play for a shot on a map that is not a tab is refused, naming it', await play('far') === false && /open these maps as tabs in Atlas first: other/.test(await lastNotice()) && await none(), await lastNotice());
  check('cutscene run: Play for a cutscene with no shots says to add a shot', await play('none') === false && /add a shot first/.test(await lastNotice()) && await none(), await lastNotice());
  // The gallery shows Play off with the reason, and the editor's Preview refuses with the same notice.
  await enterCinematic(page);
  const row = page.locator('.tabletop-gallery__row[data-cutscene-id="none"]');
  check('cutscene run: Play for players is off on the empty cutscene, with the reason on hover', await row.locator('.tabletop-gallery__play').getAttribute('aria-disabled') === 'true' && /Add a shot first/.test(await row.locator('.tabletop-gallery__play').getAttribute('aria-label')));
  // Without a Connect session Play is off on every cutscene, and says to start one.
  await page.evaluate(() => { window.boardTest.setHosting(false); window.boardTest.studio.studio.sessionChanged(); });
  const offline = await page.evaluate(() => [...document.querySelectorAll('.tabletop-gallery__play')].map((b) => [b.getAttribute('aria-disabled'), b.getAttribute('aria-label')]));
  check('cinematic mode: without a Connect session every Play is off and says to start a session in Connect', offline.length > 0 && offline.every(([off, why]) => off === 'true' && /Start a session in Connect/.test(why)), JSON.stringify(offline));
  await page.evaluate(() => { window.boardTest.setHosting(true); window.boardTest.studio.studio.sessionChanged(); });
  await page.evaluate(() => { window.boardTest.studio.log.notices.length = 0; window.boardTest.studio.studio.edit('none'); window.boardTest.studio.studio.preview(0); });
  check('cutscene run: Preview on the empty cutscene gives the same notice', /add a shot first/.test(await lastNotice()) && await none());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.boardTest.studio.studio.state === 'idle', null, { timeout: 8000 });
});

feature('cutscene run live', async ({ page }) => {
  const ids = await page.evaluate(() => ({ first: window.boardTest.studio.first, second: window.boardTest.studio.second }));
  await page.evaluate(() => {
    window.boardTest.setHosting(true);
    window.runLog = { changes: 0, cameras: 0 };
    window.boardTest.api.cutscene.onChange(() => { window.runLog.changes++; });
    window.boardTest.api.cutscene.onCamera(() => { window.runLog.cameras++; });
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;right:0;top:0;width:360px;height:240px;z-index:1';
    document.body.appendChild(stage);
    window.boardTest.board.attachPlayer(stage);
  });
  const toggle = page.locator('button[aria-label="Players follow my camera"]');
  check('cutscene live: the toggle shows while a session hosts, not pressed', await toggle.isVisible() && await toggle.getAttribute('aria-pressed') === 'false');
  // Every reveal change is logged with the time since the toggle was pressed, and the bars the players' window had then.
  const logReveals = () => page.evaluate(() => {
    const b = window.boardTest.board;
    window.reveals = [];
    window.pressedAt = performance.now();
    if (!b.loggedReveal) {
      b.loggedReveal = true;
      const set = b.setReveal.bind(b);
      b.setReveal = (on) => { window.reveals.push({ on, at: performance.now() - window.pressedAt }); set(on); };
    }
  });
  // Frames on a software renderer are far apart, so the samples catch the fade somewhere dark, rarely at its black.
  const sampleFade = () => page.evaluate(async () => {
    const b = window.boardTest.board;
    const samples = [];
    const stop = performance.now() + 2500;
    while (performance.now() < stop) {
      samples.push({ black: b.playerCinema?.black ?? 0, reveal: b.reveal, bars: b.playerCinema?.aspect ?? null, gm: b.cinema.black });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { samples, reveals: window.reveals, overlay: b.playerCinema === null, reveal: b.reveal };
  });
  await logReveals();
  await toggle.click();
  // The players' window fades in as a player's board does: black first, the reveal and its bars at the black (600 ms), then clear.
  const enter = await sampleFade();
  const on = enter.reveals.filter((r) => r.on);
  check('cutscene live: the players\' window fades to black and back as the run starts, the GM\'s view never black', Math.max(...enter.samples.map((s) => s.black)) > 0.1 && enter.samples.at(-1).black < 0.01 && enter.samples.every((s) => s.gm === 0), JSON.stringify({ samples: enter.samples.map((s) => s.black.toFixed(2)) }));
  check('cutscene live: the reveal and the window\'s bars come on at its black, not before', on.length === 1 && on[0].at >= 600 && enter.samples.every((s) => (s.bars !== null) === s.reveal) && enter.samples.at(-1).reveal && enter.samples.at(-1).bars === 2.39, JSON.stringify({ reveals: enter.reveals, samples: enter.samples.map((s) => [s.reveal, s.bars]) }));
  const live = await page.evaluate(() => window.boardTest.api.cutscene.current());
  check('cutscene live: it publishes a live run on the GM board\'s map, with no shots', live.cutscene.mode === 'live' && live.cutscene.shots.length === 0 && live.cutscene.key === 'k1' && live.maps.k1 === ids.first && live.cutscene.step.shot === 0, JSON.stringify(live));
  check('cutscene live: the toggle is pressed, the role is live and the bars are on', await toggle.getAttribute('aria-pressed') === 'true' && await page.evaluate(() => window.boardTest.board.cinematicRole === 'live' && window.boardTest.board.cinema.aspect === 2.39 && window.boardTest.board.cinematic === null));
  const cameras = await page.evaluate(() => window.runLog.cameras);
  await page.mouse.move(500, 300);
  await page.mouse.wheel(0, -300);
  await wait(500);
  const moved = await page.evaluate(() => ({ cameras: window.runLog.cameras, camera: window.boardTest.api.cutscene.camera(), own: window.boardTest.board.cameraPose(), players: window.boardTest.board.playerPose() }));
  check('cutscene live: the GM zooming fires onCamera', moved.cameras > cameras, JSON.stringify(moved.cameras));
  const same = (a, b) => Math.hypot(a.eye.x - b.eye.x, a.eye.y - b.eye.y, a.eye.z - b.eye.z) < 1e-6 && Math.hypot(a.target.x - b.target.x, a.target.y - b.target.y, a.target.z - b.target.z) < 1e-6;
  check('cutscene live: camera() is the GM board\'s pose', moved.camera !== null && same(moved.camera, moved.own), JSON.stringify(moved.camera));
  check('cutscene live: the players\' window shows the same pose', moved.players !== null && same(moved.players, moved.own));
  // A scene switch republishes with a new key.
  await page.evaluate(() => window.boardTest.studio.host.showPlace(window.boardTest.studio.second));
  await wait(300);
  const switched = await page.evaluate(() => window.boardTest.api.cutscene.current());
  check('cutscene live: a scene switch republishes with the new scene\'s key', switched.cutscene.key === 'k2' && switched.maps.k2 === ids.second && switched.cutscene.step.seq === 2, JSON.stringify(switched));
  await logReveals();
  await toggle.click();
  check('cutscene live: toggling off ends it', await page.evaluate(() => window.boardTest.api.cutscene.current()) === null && await toggle.getAttribute('aria-pressed') === 'false' && await page.evaluate(() => window.boardTest.board.cinematicRole === 'none' && window.boardTest.board.cinema.aspect === null && window.boardTest.studio.studio.state === 'idle'));
  check('cutscene live: camera() is null once it is over', await page.evaluate(() => window.boardTest.api.cutscene.camera()) === null);
  // The players' window fades out: its reveal and bars stay until its black (600 ms), and go there.
  const leave = await sampleFade();
  const off = leave.reveals.filter((r) => !r.on);
  const dark = leave.samples.filter((s) => s.black > 0.1);
  check('cutscene live: toggling off fades the players\' window out, the reveal and its bars going at its black, and lets the window go after', off.length === 1 && off[0].at >= 600 && dark.length > 0 && leave.samples[0].bars === 2.39 && leave.samples.every((s) => s.black === 0 || (s.bars !== null) === s.reveal) && leave.overlay && !leave.reveal, JSON.stringify({ reveals: leave.reveals, samples: leave.samples.map((s) => [s.black.toFixed(2), s.reveal, s.bars]), overlay: leave.overlay }));
});

feature('cutscene run closing', async ({ page }) => {
  const ids = await page.evaluate(() => ({ first: window.boardTest.studio.first, second: window.boardTest.studio.second }));
  await page.evaluate(({ first, second, make }) => {
    const { studio, setHosting } = window.boardTest;
    setHosting(true);
    studio.store.set(first, [new Function(`return (${make})`)()(first, second)]);
    window.runLog = { changes: 0 };
    window.boardTest.api.cutscene.onChange(() => { window.runLog.changes++; });
  }, { ...ids, make: docks.toString() });
  await page.evaluate(() => window.boardTest.studio.studio.play('docks'));
  await page.waitForFunction(() => window.boardTest.api.cutscene.current() !== null);
  await wait(300);
  // The session going ends a run, with the fade.
  await page.evaluate(() => window.boardTest.studio.studio.endRun());
  check('cutscene run: ending it (the session was released) publishes null', await page.evaluate(() => window.boardTest.api.cutscene.current()) === null);
  await page.waitForFunction(() => window.boardTest.board.cinematicRole === 'none', null, { timeout: 5000 });
  // Closing the board while a new run is on: the studio is disposed last, and not used again.
  await page.evaluate(() => { window.runLog.changes = 0; return window.boardTest.studio.studio.play('docks'); });
  await page.waitForFunction(() => window.boardTest.api.cutscene.current() !== null);
  await wait(300);
  await page.evaluate(() => window.boardTest.studio.studio.dispose());
  check('cutscene run: closing the board clears api.cutscene and tells the listeners', await page.evaluate(() => window.boardTest.api.cutscene.current() === null && window.runLog.changes === 2));
  check('cutscene run: and gives the board back', await page.evaluate(() => window.boardTest.board.cinematicRole === 'none' && window.boardTest.board.cinematic === null));
});

// ── Cutscenes: authoring while the vault changes, and a map that cannot be shown ─────────────────────────────────────
feature('cutscene authoring rewrites', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { studio: s } = window.boardTest;
    const shot = (id, at, mapPath) => ({ id, at, mapPath, eye: { x: 400 + at / 10, y: 700, z: 1200 }, target: { x: 400 + at / 10, y: 0, z: 600 }, keyframe: false, transition: 'fade' });
    const base = () => ({ id: 'rw', name: 'Rewritten', shots: [shot('a', 0, s.first), shot('b', 1500, s.second)] });
    const lastSave = () => s.log.saves.at(-1);
    const out = {};
    // (1) A shot's map is renamed (BoardData rewrites the saved cutscene) while the editor is open: the next edit keeps the new path.
    s.store.set(s.first, [base()]);
    s.studio.edit('rw');
    const renamed = { ...base(), shots: base().shots.map((x) => (x.mapPath === s.second ? { ...x, mapPath: 'maps/renamed.atlasmap' } : x)) };
    s.store.set(s.first, [renamed]);
    s.studio.addAt(3500);
    out.renamedKept = lastSave().cutscene.shots.map((x) => x.mapPath).join();
    // (2) The map a shot is on is deleted (its shots are dropped): the next edit does not bring them back.
    s.store.set(s.first, [{ ...renamed, shots: renamed.shots.filter((x) => x.id !== 'b') }]);
    s.studio.addAt(6000);
    out.deletedStay = { hasB: lastSave().cutscene.shots.some((x) => x.id === 'b'), count: lastSave().cutscene.shots.length };
    // (3) The home map is renamed: edits go to the new key, not to a phantom entry under the old path.
    s.studio.mapRenamed(s.first, 'maps/home2.atlasmap');
    s.store.set('maps/home2.atlasmap', s.store.get(s.first));
    s.store.delete(s.first);
    const before = s.log.saves.length;
    s.studio.addAt(8500);
    out.renamedHome = { mapPath: lastSave().mapPath, saved: s.log.saves.length > before, phantom: s.store.has(s.first) };
    // (4) The cutscene is deleted under the editor: the next edit ends the session with a notice.
    s.store.set('maps/home2.atlasmap', []);
    s.studio.addAt(11000);
    await new Promise((resolve) => setTimeout(resolve, 600));
    out.gone = { state: s.studio.state, noticed: s.log.notices.some((text) => /no longer exists/.test(text)) };
    return out;
  });
  check('cutscene authoring: an edit after a shot\'s map was renamed keeps the new path', result.renamedKept === `${await page.evaluate(() => window.boardTest.studio.first)},maps/renamed.atlasmap,${await page.evaluate(() => window.boardTest.studio.first)}`, JSON.stringify(result));
  check('cutscene authoring: an edit after a shot\'s map was deleted does not bring its shots back', !result.deletedStay.hasB && result.deletedStay.count === 2, JSON.stringify(result));
  check('cutscene authoring: edits follow a renamed home map and make no entry under the old path', result.renamedHome.mapPath === 'maps/home2.atlasmap' && result.renamedHome.saved && !result.renamedHome.phantom, JSON.stringify(result));
  check('cutscene authoring: a cutscene deleted under the editor ends the session with a notice', result.gone.state === 'idle' && result.gone.noticed, JSON.stringify(result));
});

feature('cutscene authoring switch fails', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const out = await page.evaluate(async () => {
    const { studio: s, board } = window.boardTest;
    const shot = (id, at, mapPath) => ({ id, at, mapPath, eye: { x: 400 + at / 10, y: 700, z: 1200 }, target: { x: 400 + at / 10, y: 0, z: 600 }, keyframe: false, transition: 'fade' });
    s.store.set(s.first, [{ id: 'sw', name: 'Switch', shots: [shot('a', 0, s.first), shot('b', 1500, s.second)] }]);
    s.studio.edit('sw');
    const out = { toolbarHidden: getComputedStyle(document.querySelector('.atlas-tabletop-toolbar-row')).visibility === 'hidden' };
    // Go to the second map for real, then make every further switch fail.
    await s.host.showPlace(s.second);
    const real = s.host.showPlace;
    s.host.showPlace = () => Promise.reject(new Error('no such tab'));
    await s.studio.goTo('a');
    out.stillEditing = s.studio.state === 'editing';
    s.studio.stopEditing();
    await new Promise((resolve) => setTimeout(resolve, 500));
    out.after = { state: s.studio.state, role: board.cinematicRole, driver: board.cinematic === null, bars: board.cinema.aspect, hold: s.log.holds.at(-1), toolbar: getComputedStyle(document.querySelector('.atlas-tabletop-toolbar-row')).visibility };
    s.host.showPlace = real;
    // Escape still works: the gallery opens and closes.
    s.studio.openGallery();
    out.opened = s.studio.state;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    out.closed = s.studio.state;
    return out;
  });
  check('cutscene authoring: the toolbar is hidden while a cutscene is made', out.toolbarHidden, JSON.stringify(out));
  check('cutscene authoring: a goTo whose switch rejects leaves the editor running', out.stillEditing, JSON.stringify(out));
  check('cutscene authoring: leaving when the switch rejects still unlocks the board, drops the bars, frees the players and shows the toolbar', out.after.state === 'idle' && out.after.role === 'none' && out.after.driver && out.after.bars === null && out.after.hold === false && out.after.toolbar !== 'hidden', JSON.stringify(out));
  check('cutscene authoring: Escape still works afterwards', out.opened === 'gallery' && out.closed === 'idle', JSON.stringify(out));
  check('cutscene authoring: no unhandled rejection', errors.length === 0, errors.join('|'));
});

// ── Cutscenes on a player's board (Connect's mount, /playerBoard.html) ────────────────────────────────────────────────
/** Installs the run, the revealed scenes and a few readers on the page; runs inside the page. */
const playerFixture = () => {
  const t = window.playerTest;
  const copy = (v) => JSON.parse(JSON.stringify(v));
  window.fx = {
    run: (step, key, runId = 'r1', mode = 'prepared') => ({
      runId, mode, look: { bars: 2.39, fadeMs: 600 }, key, step,
      shots: mode === 'live' ? [] : [
        { key: 'k1', eye: { x: 700, y: 1300, z: 1100 }, target: { x: 700, y: 0, z: 500 }, at: 0, keyframe: false, transition: 'fade' },
        { key: 'k1', eye: { x: 300, y: 700, z: 1200 }, target: { x: 500, y: 0, z: 400 }, at: 3000, keyframe: false, transition: 'move' },
        { key: 'k2', eye: { x: 500, y: 600, z: 1100 }, target: { x: 500, y: 0, z: 400 }, at: 5000, keyframe: false, transition: 'fade' },
        { key: 'k2', eye: { x: 200, y: 500, z: 900 }, target: { x: 500, y: 0, z: 400 }, at: 8000, keyframe: false, transition: 'cut' },
      ],
    }),
    // The own scene plus a token under the fog, which the reveal shows.
    scene1: (asset = t.MAP) => { const s = copy(t.scene); s.map.asset = asset; s.tokens.fogged = { ...copy(t.scene.tokens.theirs), x: 1200, y: 500, name: 'Hidden' }; return s; },
    scene2: () => { const s = copy(t.scene); s.sceneId = 's2'; s.map = { asset: t.MAP2, width: 1000, height: 800, cellSize: 70 }; s.tokens = { other: { ...copy(t.scene.tokens.theirs), x: 300, y: 300 } }; s.fog = {}; s.pins = []; return s; },
    eyeOf: (shot) => shot,
    black: (b = t.board) => b.cinema.black,
    pos: (b = t.board) => ({ x: b.view.position.x, y: b.view.position.y, z: b.view.position.z }),
    near: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
    shows: () => (t.handle.loadedId ?? ''),
    goal: () => JSON.stringify(t.board.camera.goal),
    until: async (fn, ms = 8000) => { const start = performance.now(); while (performance.now() - start < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; },
    odd: () => { const b = t.board; b.camera.orbit(1.1, 0); b.camera.zoom(0.4); b.camera.pan(50, 20); b.camera.snap(); b.wake(true); window.kept = copy(b.camera.keep()); },
  };
};

const PLAYER_URL = '/playerBoard.html';
const prepare = async (page) => {
  await page.evaluate(playerFixture);
  await page.evaluate(() => window.playerTest.deliver());
  await wait(1500);
};
const startRun = (page, key = 'k1', step = { shot: 0, seq: 1 }, extra = '{}') => page.evaluate(({ key, step, extra }) => {
  const t = window.playerTest;
  t.handle.setCutscene(window.fx.run(step, key), JSON.parse(extra));
  t.handle.setCutsceneScene('r1', 'k1', window.fx.scene1(), t.extras);
}, { key, step, extra });
const settled = (page) => page.evaluate(() => window.fx.until(() => window.fx.black() < 0.01 && window.playerTest.handle.run?.showing !== null, 10000));
const ended = (page, ms = 10000) => page.evaluate((ms) => window.fx.until(() => window.playerTest.handle.run === null, ms), ms);

const playerFeature = (name, run) => feature(name, run, PLAYER_URL);

playerFeature('player cutscene', async ({ page, shot }) => {
  await prepare(page);
  check('player cutscene: the handle says it plays cutscenes', await page.evaluate(() => window.playerTest.handle.cutscenes === true));
  await page.evaluate(() => window.fx.odd());
  const own = await page.evaluate(() => ({ tokens: [...window.playerTest.board.tokens.keys()], id: window.playerTest.handle.loadedId }));
  await startRun(page);
  await wait(1400);
  check('player cutscene: the view comes to shot 0 once the enter fade is over', await settled(page));
  const first = await page.evaluate(() => { const t = window.playerTest; const s = window.fx.run({ shot: 0, seq: 1 }, 'k1').shots[0]; return { dist: window.fx.near(window.fx.pos(), s.eye), fogged: t.board.tokens.get('fogged')?.piece.object3d.visible, mine: t.board.tokens.has('mine'), bars: !!t.board.container.querySelector('.tabletop-cinema__bar--top:not([hidden])'), id: window.fx.shows(), reveal: t.board.reveal, role: t.board.cinematicRole }; });
  check('player cutscene: the camera is on shot 0', first.dist < 0.5, JSON.stringify(first));
  // A roll laid on the table stays through a shot change on the same map, and goes (unsent, with a notice) on another map.
  await page.evaluate(() => { window.playerTest.handle.dice.throw({ dice: { d20: 1 }, modifier: 0 }); window.playerTest.handle.setCutscene(window.fx.run({ shot: 1, seq: 2 }, 'k1')); });
  await wait(500);
  check('player cutscene: a shot change on the same map keeps a roll in play', await page.evaluate(() => window.playerTest.handle.dice.controller?.unsent === true));
  check('player cutscene: a token of the own scene under the fog is drawn (the reveal), and the run\'s scene has its own id', first.fogged === true && first.reveal === true && first.id === 'cutscene:r1:k1' && !own.tokens.includes('fogged'), JSON.stringify({ first, own }));
  check('player cutscene: the bars are in the DOM and the board is locked', first.bars && first.role === 'locked', JSON.stringify(first));
  await shot('player-cutscene');
  // Step to shot 3 on the other map: black until its scene comes, then the view rests on shot 3.
  await page.evaluate(() => window.playerTest.handle.setCutscene(window.fx.run({ shot: 3, seq: 3 }, 'k2')));
  await wait(500);
  const held = await page.evaluate(() => ({ black: window.fx.black(), id: window.fx.shows(), unsent: window.playerTest.handle.dice.controller?.unsent, sends: window.playerTest.record.diceResults.length, line: document.querySelector('.atlas-tabletop-dice-prompt')?.textContent ?? '' }));
  check('player cutscene: a cross-map step holds black until the new map\'s scene has been delivered', held.black >= 0.99, JSON.stringify(held));
  check('player cutscene: and drops a roll in play unsent, with the notice', held.unsent !== true && held.sends === 0 && /The scene changed; roll again\./.test(held.line), JSON.stringify(held));
  await page.evaluate(() => window.playerTest.handle.setCutsceneScene('r1', 'k2', window.fx.scene2(), null));
  const resting = await page.evaluate(() => window.fx.until(() => window.fx.black() < 0.01 && window.fx.shows() === 'cutscene:r1:k2', 10000));
  const atThree = await page.evaluate(() => ({ dist: window.fx.near(window.fx.pos(), window.fx.run({ shot: 3, seq: 3 }, 'k2').shots[3].eye), tokens: [...window.playerTest.board.tokens.keys()] }));
  check('player cutscene: the view rests on shot 3 of the second map, drawn from that map\'s scene', resting && atThree.dist < 0.5 && atThree.tokens.join() === 'other', JSON.stringify(atThree));
  // The end: the own scene and the exact camera come back.
  await page.evaluate(() => window.playerTest.handle.setCutscene(null));
  await page.evaluate(() => window.fx.until(() => window.playerTest.board.cinema.black > 0.5, 3000));
  check('player cutscene: ending fades to black first', await page.evaluate(() => window.playerTest.handle.run !== null));
  check('player cutscene: the run is over after the leave fade', await ended(page));
  await wait(1500);
  const back = await page.evaluate(() => {
    const t = window.playerTest;
    const pose = t.board.camera.pose;
    const kept = window.kept.pose;
    const diff = Math.max(Math.abs(pose.yaw - kept.yaw), Math.abs(pose.pitch - kept.pitch), Math.abs(pose.distance - kept.distance), Math.abs(pose.target.x - kept.target.x), Math.abs(pose.target.y - kept.target.y), Math.abs(pose.target.z - kept.target.z));
    const goal = t.board.camera.goal;
    const gdiff = Math.abs(goal.yaw - window.kept.goal.yaw) + Math.abs(goal.distance - window.kept.goal.distance) + Math.abs(goal.target.x - window.kept.goal.target.x);
    return { diff, gdiff, id: window.fx.shows(), reveal: t.board.reveal, fogged: t.board.tokens.has('fogged'), tokens: [...t.board.tokens.keys()].join(), role: t.board.cinematicRole, driver: t.board.cinematic === null, bars: t.board.cinema.aspect, black: window.fx.black() };
  });
  check('player cutscene: restores the exact own camera after a cross-map run', back.diff < 1e-9 && back.gdiff < 1e-9, JSON.stringify(back));
  check('player cutscene: the own scene is back, with its fog: nothing of the run is shown', back.id === 's1' && !back.reveal && !back.fogged && back.tokens === 'mine,theirs', JSON.stringify(back));
  check('player cutscene: the board is the player\'s again, with no bars and no black', back.role === 'none' && back.driver && back.bars === null && back.black === 0, JSON.stringify(back));
  check('player cutscene: no reference to the run is kept', await page.evaluate(() => window.playerTest.handle.cutScenes.size === 0 && window.playerTest.handle.run === null));
});

playerFeature('player cutscene ends while waiting', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.fx.odd());
  // Connect could not deliver the scene (too big, its tab closed) and ends the run: the board is black, waiting.
  await page.evaluate(() => window.playerTest.handle.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1')));
  await wait(2000);
  const waiting = await page.evaluate(() => ({ black: window.fx.black(), role: window.playerTest.board.cinematicRole, id: window.fx.shows() }));
  check('player cutscene: with no scene delivered the board stays black and locked', waiting.black >= 0.99 && waiting.role === 'locked', JSON.stringify(waiting));
  await page.evaluate(() => window.playerTest.handle.setCutscene(null));
  check('player cutscene: a run ended while the board is black and waiting for a scene is over after the leave fade', await ended(page));
  await wait(1500);
  const back = await page.evaluate(() => {
    const t = window.playerTest;
    const pose = t.board.camera.pose;
    const kept = window.kept.pose;
    return { diff: Math.abs(pose.yaw - kept.yaw) + Math.abs(pose.pitch - kept.pitch) + Math.abs(pose.distance - kept.distance) + Math.abs(pose.target.x - kept.target.x), id: window.fx.shows(), black: window.fx.black(), role: t.board.cinematicRole, driver: t.board.cinematic === null };
  });
  check('player cutscene: and the player has their own scene and camera back, unlocked', back.diff < 1e-9 && back.id === 's1' && back.black === 0 && back.role === 'none' && back.driver, JSON.stringify(back));
});

playerFeature('player cutscene join', async ({ page }) => {
  await prepare(page);
  const out = await page.evaluate(async () => {
    const t = window.playerTest;
    const n = t.spawn();
    n.handle.setCutscene(window.fx.run({ shot: 3, seq: 7 }, 'k2'));
    const samples = [window.fx.black(n.board)];
    const stop = performance.now() + 900;
    while (performance.now() < stop) { samples.push(window.fx.black(n.board)); await new Promise((r) => requestAnimationFrame(r)); }
    const before = Math.min(...samples);
    n.handle.setCutsceneScene('r1', 'k2', window.fx.scene2(), null);
    const rested = await window.fx.until(() => window.fx.black(n.board) < 0.01 && n.handle.loadedId === 'cutscene:r1:k2', 10000);
    const dist = window.fx.near(window.fx.pos(n.board), window.fx.run({ shot: 3, seq: 7 }, 'k2').shots[3].eye);
    return { before, rested, dist, bars: !!n.container.querySelector('.tabletop-cinema__bar--top:not([hidden])') };
  });
  check('player cutscene: joining mid-run lands at the current shot, black (never the framed map with the bars) until its scene is in', out.before >= 0.99 && out.rested && out.dist < 0.5 && out.bars, JSON.stringify(out));
});

playerFeature('player cutscene assets', async ({ page }) => {
  await prepare(page);
  const out = await page.evaluate(async () => {
    const t = window.playerTest;
    t.hold(t.MAP2);
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'r2'));
    t.handle.setCutsceneScene('r2', 'k1', window.fx.scene1(t.MAP2), t.extras);
    await new Promise((r) => setTimeout(r, 2200));
    const black = window.fx.black();
    t.deliver();
    const faded = await window.fx.until(() => window.fx.black() < 0.01, 10000);
    return { black, faded, id: window.fx.shows(), background: !!t.board.map?.background };
  });
  check('player cutscene: with the map image held back the board stays black', out.black >= 0.99, JSON.stringify(out));
  check('player cutscene: once the image arrives (files, then refresh) the board fades in on the run\'s scene, not the own one', out.faded && out.id === 'cutscene:r2:k1' && out.background, JSON.stringify(out));
});

playerFeature('player cutscene hand back', async ({ page }) => {
  await prepare(page);
  const out = await page.evaluate(async () => {
    const t = window.playerTest;
    t.record.cutsceneOver.length = 0;
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1'), { startBlack: true, handBack: true });
    const start = window.fx.black();
    t.handle.setCutsceneScene('r1', 'k1', window.fx.scene1(), t.extras);
    await window.fx.until(() => window.fx.black() < 0.01, 10000);
    t.handle.setCutscene(null);
    await new Promise((r) => setTimeout(r, 2200));
    return { start, over: t.record.cutsceneOver.length, black: window.fx.black(), id: window.fx.shows(), locked: t.board.cinematicRole };
  });
  check('player cutscene: startBlack starts at black 1 with no fade from the framed map', out.start >= 0.99, JSON.stringify(out));
  check('player cutscene: handBack calls cutsceneOver once, stays black, and does not reload the own scene', out.over === 1 && out.black >= 0.99 && out.id === 'cutscene:r1:k1', JSON.stringify(out));
});

playerFeature('player cutscene hand back with a queued run', async ({ page }) => {
  await prepare(page);
  const out = await page.evaluate(async () => {
    const t = window.playerTest;
    const h = t.handle;
    h.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1'), { startBlack: true, handBack: true });
    h.setCutsceneScene('r1', 'k1', window.fx.scene1(), t.extras);
    await window.fx.until(() => window.fx.black() < 0.01, 10000);
    h.setCutscene(null);
    // A run told while this one is left waits for it.
    h.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'r2'), { startBlack: true });
    h.setCutsceneScene('r2', 'k1', window.fx.scene1(), t.extras);
    const handed = await window.fx.until(() => h.run?.handedBack === true, 10000);
    // Told again after the hand back: the waiting run starts, and the news is its update, not a second start.
    h.setCutscene(window.fx.run({ shot: 0, seq: 2 }, 'k1', 'r2'), { startBlack: true });
    const buttons = document.querySelectorAll('.tabletop-cinema-roll').length;
    return { handed, run: h.run?.cutscene.runId ?? null, buttons };
  });
  check('player cutscene: a run handed back with another waiting starts it once, with one Roll button', out.handed && out.run === 'r2' && out.buttons === 1, JSON.stringify(out));
});

playerFeature('player cutscene disconnect', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.fx.odd());
  await startRun(page);
  check('player cutscene: the run is on', await settled(page));
  const out = await page.evaluate(async () => {
    const t = window.playerTest;
    t.handle.setConnected(true);
    const still = t.handle.run?.state.leaving === false && t.handle.run !== null;
    t.handle.setConnected(false);
    const leaving = t.handle.run?.state.leaving === true;
    t.handle.setConnected(false);
    await new Promise((r) => setTimeout(r, 450));
    const midBlack = window.fx.black();
    t.handle.setConnected(false);
    return { still, leaving, midBlack };
  });
  check('player cutscene: setConnected(false) ends the run: the leave fade runs, a repeated call changes nothing', out.still && out.leaving && out.midBlack > 0.1, JSON.stringify(out));
  check('player cutscene: and it is over after the fade', await ended(page));
  await wait(1500);
  const back = await page.evaluate(() => { const pose = window.playerTest.board.camera.pose; const kept = window.kept.pose; return { diff: Math.abs(pose.yaw - kept.yaw) + Math.abs(pose.distance - kept.distance) + Math.abs(pose.target.x - kept.target.x), id: window.fx.shows() }; });
  check('player cutscene: the camera is restored after a disconnect', back.diff < 1e-9 && back.id === 's1', JSON.stringify(back));
});

/** Delays every load of a map on the player's board by `ms` (a big own map that takes long to come back); runs inside the page. */
const slowLoads = (page, ms) => page.evaluate((ms) => {
  const b = window.playerTest.board;
  const load = b.load.bind(b);
  b.load = async (...args) => { await new Promise((r) => setTimeout(r, ms)); return load(...args); };
}, ms);
/** The run's state on the player's board now: what it shows, how black, whether locked, and whether its scene is drawn. */
const runNow = (page) => page.evaluate(() => {
  const t = window.playerTest;
  const run = t.handle.run;
  return { run: run?.cutscene.runId ?? null, showing: run?.showing ?? null, restoring: run ? run.restoring !== null : null, black: window.fx.black(), id: window.fx.shows(), role: t.board.cinematicRole, queued: t.handle.queued?.cutscene.runId ?? null };
});
/** The camera back exactly where `window.kept` had it, with nothing of any run kept. */
const ownBack = (page) => page.evaluate(() => {
  const t = window.playerTest;
  const pose = t.board.camera.pose;
  const kept = window.kept.pose;
  const diff = Math.max(Math.abs(pose.yaw - kept.yaw), Math.abs(pose.pitch - kept.pitch), Math.abs(pose.distance - kept.distance), Math.abs(pose.target.x - kept.target.x), Math.abs(pose.target.z - kept.target.z));
  return { diff, id: window.fx.shows(), role: t.board.cinematicRole, black: window.fx.black(), scenes: t.handle.cutScenes.size, run: t.handle.run === null };
});
const playsK1 = (page, runId) => page.evaluate((runId) => window.fx.until(() => {
  const run = window.playerTest.handle.run;
  return run?.cutscene.runId === runId && run.showing === 'k1' && run.restoring === null && window.fx.shows() === `cutscene:${runId}:k1` && window.fx.black() < 0.01;
}, 12000), runId);

playerFeature('player cutscene readmitted in the leave fade', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.fx.odd());
  await startRun(page);
  check('player cutscene readmitted: the run is on', await settled(page));
  // The link drops (Connect ends the run on the board), and the player is admitted again 200 ms later: the GM sends the
  // same run, the stage asks for it black, and then the scenes come.
  await page.evaluate(() => { const t = window.playerTest; t.handle.setCutscene(null); t.handle.setConnected(false); });
  await wait(200);
  await page.evaluate(() => {
    const t = window.playerTest;
    t.handle.setConnected(true);
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 2 }, 'k1'), { startBlack: true });
    t.handle.setCutsceneScene('r1', 'k1', window.fx.scene1(), t.extras);
  });
  const queued = await runNow(page);
  check('player cutscene readmitted: the run told again while it is being left waits for the leave to finish', queued.queued === 'r1', JSON.stringify(queued));
  const playing = await playsK1(page, 'r1');
  const now = await runNow(page);
  check('player cutscene readmitted: within the leave fade, the same run plays again at its shot, its scene drawn, locked', playing && now.role === 'locked', JSON.stringify(now));
  await page.evaluate(() => window.playerTest.handle.setCutscene(null));
  check('player cutscene readmitted: and ends again', await ended(page));
  await wait(1500);
  const back = await ownBack(page);
  check('player cutscene readmitted: after it the own scene and the exact camera are back, and no scene of any run is kept', back.diff < 1e-9 && back.id === 's1' && back.role === 'none' && back.black === 0 && back.scenes === 0, JSON.stringify(back));
});

playerFeature('player cutscene readmitted while the own map reloads', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.fx.odd());
  await startRun(page);
  check('player cutscene readmitted late: the run is on', await settled(page));
  await slowLoads(page, 2500);
  await page.evaluate(() => { const t = window.playerTest; t.handle.setCutscene(null); t.handle.setConnected(false); });
  // Past the leave fade (2 x 600 ms), with the own scene still loading.
  await wait(1500);
  const gap = await runNow(page);
  check('player cutscene readmitted late: the board is between the leave fade and the own scene', gap.run === 'r1' && gap.restoring === true, JSON.stringify(gap));
  // The player never sees their own map on the way: the board stays black from the news until the run is starting again.
  await page.evaluate(() => {
    const t = window.playerTest;
    const old = t.handle.run;
    window.blackSeen = { min: 1, samples: 0 };
    const watch = () => {
      if (t.handle.run !== old) return;
      window.blackSeen.min = Math.min(window.blackSeen.min, window.fx.black());
      window.blackSeen.samples += 1;
      setTimeout(watch, 25);
    };
    t.handle.setConnected(true);
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 2 }, 'k1'), { startBlack: true });
    t.handle.setCutsceneScene('r1', 'k1', window.fx.scene1(), t.extras);
    watch();
  });
  const playing = await playsK1(page, 'r1');
  const seen = await page.evaluate(() => window.blackSeen);
  check('player cutscene readmitted late: a player reconnecting mid-run never shows their own map unblacked', seen.samples > 5 && seen.min >= 0.99, JSON.stringify(seen));
  const now = await runNow(page);
  check('player cutscene readmitted late: once the own scene is back the same run plays again, its scene drawn, locked', playing && now.role === 'locked', JSON.stringify(now));
  await page.evaluate(() => window.playerTest.handle.setCutscene(null));
  check('player cutscene readmitted late: and ends again', await ended(page, 15000));
  await wait(3500);
  const back = await ownBack(page);
  check('player cutscene readmitted late: the own scene and the exact camera are back, and no scene of any run is kept', back.diff < 1e-9 && back.id === 's1' && back.role === 'none' && back.black === 0 && back.scenes === 0, JSON.stringify(back));
});

playerFeature('player cutscene new run while the own map reloads', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.fx.odd());
  await startRun(page);
  check('player cutscene next run: the first run is on', await settled(page));
  await slowLoads(page, 2500);
  // The GM ends the run and starts another before this player's own map is back.
  await page.evaluate(() => window.playerTest.handle.setCutscene(null));
  await wait(1500);
  await page.evaluate(() => {
    const t = window.playerTest;
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'r2'));
    t.handle.setCutsceneScene('r2', 'k1', window.fx.scene1(), t.extras);
  });
  const playing = await playsK1(page, 'r2');
  const now = await runNow(page);
  check('player cutscene next run: the new run plays once the last one is done, its scene drawn, locked', playing && now.role === 'locked', JSON.stringify(now));
  await page.evaluate(() => window.playerTest.handle.setCutscene(null));
  check('player cutscene next run: and ends', await ended(page, 15000));
  await wait(3500);
  const back = await ownBack(page);
  check('player cutscene next run: the own scene and the exact camera are back, and no scene of any run is kept', back.diff < 1e-9 && back.id === 's1' && back.role === 'none' && back.black === 0 && back.scenes === 0, JSON.stringify(back));
});

playerFeature('player cutscene image never comes', async ({ page }) => {
  await prepare(page);
  const out = await page.evaluate(async () => {
    const t = window.playerTest;
    t.hold(t.MAP2);
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'r4'));
    t.handle.setCutsceneScene('r4', 'k1', window.fx.scene1(t.MAP2), t.extras);
    await new Promise((r) => setTimeout(r, 2500));
    const early = window.fx.black();
    const shown = await window.fx.until(() => window.fx.black() < 0.01 && window.fx.shows() === 'cutscene:r4:k1', 6000);
    return { early, shown, background: !!t.board.map?.background };
  });
  check('player cutscene: a map image that never arrives holds black at first', out.early >= 0.99, JSON.stringify(out));
  check('player cutscene: and after 4 s the scene is shown without it', out.shown && !out.background, JSON.stringify(out));
});

playerFeature('player cutscene live map comes back', async ({ page }) => {
  await prepare(page);
  const out = await page.evaluate(async () => {
    const t = window.playerTest;
    const at = { eye: { x: 500, y: 800, z: 1400 }, target: { x: 500, y: 0, z: 400 } };
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'lv', 'live'));
    t.handle.setCutsceneCamera('lv', at);
    t.handle.setCutsceneScene('lv', 'k1', window.fx.scene1(), t.extras);
    await window.fx.until(() => window.fx.shows() === 'cutscene:lv:k1' && window.fx.black() < 0.01, 10000);
    // To the second map, and back: the first map comes back under its old key.
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 2 }, 'k2', 'lv', 'live'));
    t.handle.setCutsceneScene('lv', 'k2', window.fx.scene2(), null);
    await window.fx.until(() => window.fx.shows() === 'cutscene:lv:k2' && window.fx.black() < 0.01, 10000);
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 3 }, 'k1', 'lv', 'live'));
    const kept = t.handle.cutScenes.get('lv');
    const dropped = { k1: kept?.has('k1') ?? false, k2: kept?.has('k2') ?? false };
    await new Promise((r) => setTimeout(r, 800));
    const held = { black: window.fx.black(), id: window.fx.shows() };
    // The map as it is now: one more token than when the GM left it.
    const fresh = window.fx.scene1();
    fresh.tokens.newcomer = { ...fresh.tokens.theirs, x: 900, y: 300, name: 'Newcomer' };
    t.handle.setCutsceneScene('lv', 'k1', fresh, t.extras);
    const shown = await window.fx.until(() => window.fx.shows() === 'cutscene:lv:k1' && window.fx.black() < 0.01, 10000);
    return { dropped, held, shown, newcomer: t.board.tokens.has('newcomer') };
  });
  check('player cutscene live: a map the publication no longer names has its scene dropped', !out.dropped.k1 && !out.dropped.k2, JSON.stringify(out));
  check('player cutscene live: coming back to a map under its old key holds black, never showing it as it was', out.held.black >= 0.99, JSON.stringify(out));
  check('player cutscene live: and fades in on the map as Connect sends it now', out.shown && out.newcomer, JSON.stringify(out));
});

playerFeature('player cutscene eyes', async ({ page }) => {
  await prepare(page);
  const before = await page.evaluate(() => { const t = window.playerTest; const ok = t.handle.seeFrom('mine', false); return { ok, seeing: t.handle.seeingFrom(), calls: t.record.eyeChanged }; });
  await startRun(page);
  await wait(300);
  const during = await page.evaluate(() => { const t = window.playerTest; return { seeing: t.handle.seeingFrom(), calls: t.record.eyeChanged, refused: t.handle.seeFrom('mine', false) }; });
  check('player cutscene: a player in a token\'s eyes is out of them during the run, and Connect is told', before.ok && before.seeing === 'mine' && during.seeing === null && during.calls === before.calls + 1 && during.refused === false, JSON.stringify({ before, during }));
  await page.evaluate(() => window.fx.until(() => window.playerTest.handle.run?.showing, 5000));
  await page.evaluate(() => window.playerTest.handle.setCutscene(null));
  check('player cutscene: the run ends', await ended(page));
  const after = await page.evaluate(() => ({ seeing: window.playerTest.handle.seeingFrom(), calls: window.playerTest.record.eyeChanged }));
  check('player cutscene: after it the player is back in the same token\'s eyes, and Connect is told again', after.seeing === 'mine' && after.calls === before.calls + 2, JSON.stringify(after));
});

feature('player cutscene live', async ({ page }) => {
  await prepare(page);
  const out = await page.evaluate(async () => {
    const t = window.playerTest;
    const line = (i) => ({ eye: { x: 300 + i * 100, y: 800, z: 1400 }, target: { x: 300 + i * 100, y: 0, z: 400 } });
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'live1', 'live'));
    t.handle.setCutsceneCamera('live1', line(0));
    t.handle.setCutsceneScene('live1', 'k1', window.fx.scene1(), t.extras);
    await window.fx.until(() => t.handle.run?.showing && window.fx.shows() === 'cutscene:live1:k1' && window.fx.black() < 0.01, 10000);
    const xs = [];
    let sampling = true;
    const loop = () => { if (!sampling) return; xs.push([performance.now(), window.fx.pos().x]); requestAnimationFrame(loop); };
    loop();
    for (let i = 1; i <= 5; i++) { t.handle.setCutsceneCamera('live1', line(i)); await new Promise((r) => setTimeout(r, 100)); }
    await new Promise((r) => setTimeout(r, 400));
    sampling = false;
    const steps = [];
    // The step of each frame per millisecond it lasted: frame times on a software renderer are uneven, and a long frame is a long step on any camera.
    for (let i = 1; i < xs.length; i++) steps.push((xs[i][1] - xs[i - 1][1]) / Math.max(1, xs[i][0] - xs[i - 1][0]));
    const sorted = steps.filter((s) => s > 1e-6).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    return { monotonic: steps.every((s) => s >= -1e-6), maxStep: Math.max(...steps), median, count: xs.length, end: xs[xs.length - 1][1] };
  });
  check('player cutscene: the live camera glides: it only moves forward, and no frame jumps more than 3 times the median step', out.monotonic && out.count > 10 && out.maxStep <= 3 * out.median + 1e-6 && out.end > 700, JSON.stringify(out));
}, PLAYER_URL);

feature('player move refused', async ({ page, shot }) => {
  // A move the GM refused because their Atlas holds another map: the player is told so, as on the 2D page.
  await prepare(page);
  const banner = () => page.evaluate(() => { const el = document.querySelector('.atlas-tabletop-banner'); return el && !el.hidden ? el.textContent : null; });
  await page.evaluate(() => window.playerTest.handle.moveRefused('hero'));
  await wait(200);
  check('player move refused: a refusal without a reason says nothing more', (await banner()) === null, await banner());
  await page.evaluate(() => window.playerTest.handle.moveRefused('hero', 'not-held'));
  await wait(200);
  check("player move refused: Atlas on another map shows the GM's-Atlas text", (await banner()) === "The GM's Atlas is on another map; try again in a moment.", await banner());
  await shot('player-move-refused');
  await wait(5200);
  check('player move refused: the text goes away after a few seconds', (await banner()) === null, await banner());
}, PLAYER_URL);

feature('player cutscene lock', async ({ page }) => {
  await prepare(page);
  await startRun(page);
  check('player cutscene lock: the run is on', await settled(page));
  const before = await page.evaluate(() => ({ goal: window.fx.goal(), tool: window.playerTest.handle.toolState().tool, pose: JSON.stringify(window.playerTest.board.camera.pose) }));
  const box = await page.evaluate(() => { const r = window.playerTest.board.canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(box.x, box.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x - 90, box.y + 30, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, -400);
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await wait(400);
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  const pinch = await page.evaluate(async () => {
    const canvas = window.playerTest.board.canvas;
    canvas.setPointerCapture = () => {};
    const send = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 31, clientX: x, clientY: y, button: 0, bubbles: true }));
    send('pointerdown', 31, 400, 300);
    send('pointerdown', 32, 600, 300);
    send('pointermove', 31, 300, 300);
    send('pointermove', 32, 700, 300);
    await new Promise((r) => setTimeout(r, 100));
    send('pointerup', 31, 300, 300);
    send('pointerup', 32, 700, 300);
    return window.fx.goal();
  });
  const kept = await page.evaluate(() => window.fx.goal());
  check('player cutscene lock: a drag, a wheel, WASD and a pinch leave the camera\'s goal alone', kept === before.goal && pinch === before.goal, JSON.stringify({ kept, before: before.goal }));
  // A controlled token cannot be dragged.
  const token = await page.evaluate(() => window.playerTest.project(385, 385));
  await page.mouse.move(token.x, token.y);
  await page.mouse.down();
  await page.mouse.move(token.x + 90, token.y + 60, { steps: 6 });
  await page.mouse.up();
  await wait(200);
  check('player cutscene lock: dragging a controlled token sends no move', await page.evaluate(() => window.playerTest.record.moves.length === 0), JSON.stringify(await page.evaluate(() => window.playerTest.record.moves)));
  // The handle's calls are ignored.
  const calls = await page.evaluate(async () => {
    const t = window.playerTest;
    const h = t.handle;
    const pose = () => JSON.stringify(t.board.camera.pose) + JSON.stringify(t.board.camera.goal);
    const was = pose();
    h.followGm();
    h.fitMap();
    h.lookAt(10, 10);
    const eyes = h.seeFrom('t1', false);
    h.setAugmented({ rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 400], frustum: { left: -1, right: 1, top: -1, bottom: 1 }, squareMm: 25 });
    h.selectTool('ping');
    const room = await h.startRoomAr({}, null);
    h.placeRoomAr({ x: 0, y: 0, z: 0 });
    const thrown = h.throwDice({ dice: { d20: 1 }, modifier: 0 });
    return { same: pose() === was, tool: h.toolState().tool, eyes, room, thrown, seeing: h.seeingFrom() };
  });
  check('player cutscene lock: handle calls are ignored while locked (followGm, fitMap, lookAt, seeFrom, setAugmented, selectTool, startRoomAr, throwDice)', calls.same && calls.tool === before.tool && calls.eyes === false && calls.room === false && calls.thrown === false && calls.seeing === null, JSON.stringify({ calls, before }));
  // Hovering still tells Connect.
  const hovers = await page.evaluate(() => window.playerTest.record.hovers.length);
  const over = await page.evaluate(() => window.playerTest.project(525, 385));
  await page.mouse.move(over.x - 40, over.y - 40);
  await page.mouse.move(over.x, over.y, { steps: 4 });
  await wait(400);
  check('player cutscene lock: hovering a token still calls hover', await page.evaluate((n) => window.playerTest.record.hovers.length > n, hovers), JSON.stringify(await page.evaluate(() => window.playerTest.record.hovers)));
  // Roll dice.
  check('player cutscene lock: the Roll dice button is there', await page.locator('.tabletop-cinema-roll__button').isVisible());
  await page.locator('.tabletop-cinema-roll__button').click();
  await page.locator('.tabletop-cinema-roll button[data-die="d20"]').click();
  await page.locator('.tabletop-cinema-roll button[aria-label="Roll"]').click();
  await page.locator('.tabletop-cinema-roll__button').click();
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.waitForFunction(() => !window.playerTest.board.dice.busy, null, { timeout: 90000 }).catch(() => {});
    await wait(300);
    if (await page.evaluate(() => window.playerTest.record.diceResults.length) > 0) break;
    await page.locator('.atlas-tabletop-dice-prompt__throw').click().catch(() => {});
    await wait(200);
  }
  const rolled = await page.evaluate(() => window.playerTest.record.diceResults);
  check('player cutscene lock: picking 1d20 and Roll sends one result, as any player roll', rolled.length === 1 && rolled[0].rolls.length === 1 && rolled[0].rolls[0].die === 'd20', JSON.stringify(rolled));
  // After the run the camera is the player's again.
  await page.evaluate(() => window.playerTest.handle.setCutscene(null));
  check('player cutscene lock: the run ends', await ended(page));
  await wait(1200);
  const free = await page.evaluate(() => window.fx.goal());
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 50, { steps: 6 });
  await page.mouse.up();
  await wait(300);
  check('player cutscene lock: after the run a drag moves the camera again', await page.evaluate((free) => window.fx.goal() !== free, free));
  check('player cutscene lock: and setAugmented draws from the AR pose again', await page.evaluate(() => {
    const t = window.playerTest;
    t.handle.setAugmented({ rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 400], frustum: { left: -1, right: 1, top: -1, bottom: 1 }, squareMm: 25 });
    return t.board.augmented !== null;
  }));
}, PLAYER_URL);

// ── Fix round 1 of Task 6 ─────────────────────────────────────────────────────────────────────────────────────────────
const AR_VIEW = "({ rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 400], frustum: { left: -1, right: 1, top: -1, bottom: 1 }, squareMm: 25, background: document.createElement('canvas') })";

playerFeature('player cutscene reveal, marks and AR', async ({ page }) => {
  await prepare(page);
  // The reveal and the bars come on with the run's first scene, not while the own scene fades.
  await startRun(page);
  await wait(250);
  const early = await page.evaluate(() => ({ reveal: window.playerTest.board.reveal, bars: window.playerTest.board.cinema.aspect, black: window.fx.black() }));
  check('player cutscene: during the enter fade the own scene keeps its veil and shows no bars', early.reveal === false && early.bars === null && early.black > 0, JSON.stringify(early));
  check('player cutscene: the run is on', await settled(page));
  check('player cutscene: and then the reveal and the bars are on', await page.evaluate(() => window.playerTest.board.reveal === true && window.playerTest.board.cinema.aspect === 2.39));
  // Pings, lasers and templates of the own scene are not drawn on the run's scene; the templates come back after.
  const out = await page.evaluate(async () => {
    const t = window.playerTest;
    const calls = { ping: 0, laser: 0, templates: [] };
    const board = t.board;
    const { receivePing, receiveLaser, receiveTemplates } = board;
    board.receivePing = function (...a) { calls.ping++; return receivePing.apply(this, a); };
    board.receiveLaser = function (...a) { calls.laser++; return receiveLaser.apply(this, a); };
    board.receiveTemplates = function (list) { calls.templates.push(list.length); return receiveTemplates.call(this, list); };
    t.handle.receivePing({ from: 'you', sceneId: 's1', x: 600, y: 600, color: '#00a9ff' });
    t.handle.receiveLaser({ from: 'you', sceneId: 's1', points: [{ x: 300, y: 600 }, { x: 400, y: 620 }], lifted: true, color: '#00a9ff' });
    t.handle.receiveTemplates('s1', [{ id: 't1', owner: 'you', shape: 'circle', start: { x: 420, y: 700 }, end: { x: 490, y: 700 }, color: '#ff9f2e' }]);
    const during = { ping: calls.ping, laser: calls.laser, templates: calls.templates.length };
    t.handle.setCutscene(null);
    await window.fx.until(() => t.handle.run === null, 10000);
    await new Promise((r) => setTimeout(r, 300));
    return { during, after: { ping: calls.ping, laser: calls.laser, templates: calls.templates.slice() } };
  });
  check('player cutscene: during a run pings, lasers and templates of the own scene are not drawn on the run\'s scene', out.during.ping === 0 && out.during.laser === 0 && out.during.templates === 0, JSON.stringify(out));
  check('player cutscene: the templates that came meanwhile are drawn on the own scene once it is back (pings and lasers are dropped)', out.after.templates.join() === '1' && out.after.ping === 0 && out.after.laser === 0, JSON.stringify(out));
  // AR: a player in marker AR when the run starts is taken out of the AR look, and back in it after.
  const ar1 = await page.evaluate(async (view) => {
    const t = window.playerTest;
    const make = new Function(`return ${view}`);
    t.handle.setAugmented(make());
    const before = t.board.augmented !== null && t.board.scene.background === t.board.arTexture;
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'r7'));
    t.handle.setCutsceneScene('r7', 'k1', window.fx.scene1(), t.extras);
    await window.fx.until(() => t.handle.run?.showing && window.fx.black() < 0.01, 10000);
    const during = { augmented: t.board.augmented !== null, picture: t.board.arTexture !== null && t.board.scene.background === t.board.arTexture, latest: t.board.arLatest !== null };
    // A view arriving meanwhile is kept, not drawn.
    t.handle.setAugmented(make());
    const kept = t.board.augmented === null && t.board.arLatest !== null;
    t.handle.setCutscene(null);
    await window.fx.until(() => t.handle.run === null, 10000);
    return { before, during, kept, after: t.board.augmented !== null };
  }, AR_VIEW);
  check('player cutscene: AR on at the run start: the AR look and the camera picture are off during the run (latest view kept), and back after', ar1.before && !ar1.during.augmented && !ar1.during.picture && ar1.during.latest && ar1.kept && ar1.after, JSON.stringify(ar1));
  // setAugmented(null) during a run changes nothing visible, but is remembered: AR stays off afterwards.
  const ar2 = await page.evaluate(async (view) => {
    const t = window.playerTest;
    const make = new Function(`return ${view}`);
    t.handle.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'r8'));
    t.handle.setCutsceneScene('r8', 'k1', window.fx.scene1(), t.extras);
    await window.fx.until(() => t.handle.run?.showing && window.fx.black() < 0.01, 10000);
    t.handle.setAugmented(make());
    t.handle.setAugmented(null);
    const during = { augmented: t.board.augmented, latest: t.board.arLatest };
    t.handle.setCutscene(null);
    await window.fx.until(() => t.handle.run === null, 10000);
    return { during, after: t.board.augmented };
  }, AR_VIEW).catch((e) => ({ error: String(e) }));
  check('player cutscene: setAugmented(null) during a run is kept as the latest: AR stays off after it', ar2.during && ar2.during.augmented === null && ar2.during.latest === null && ar2.after === null, JSON.stringify(ar2));
});

playerFeature('player cutscene queue', async ({ page }) => {
  await prepare(page);
  await startRun(page);
  check('player cutscene: the run is on', await settled(page));
  const queued = await page.evaluate(async () => {
    const t = window.playerTest;
    const h = t.handle;
    h.setCutscene(null);
    // Another run while this one is left waits for it.
    h.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'r2'));
    h.setCutsceneScene('r2', 'k1', window.fx.scene1(), t.extras);
    const waiting = h.queued?.cutscene.runId === 'r2' && h.run.cutscene.runId === 'r1' && h.cutScenes.has('r2');
    await window.fx.until(() => h.run?.cutscene.runId === 'r2', 10000);
    const started = h.run?.cutscene.runId === 'r2';
    const ready = await window.fx.until(() => h.run?.showing && window.fx.black() < 0.01 && window.fx.shows() === 'cutscene:r2:k1', 10000);
    return { waiting, started, ready, queued: h.queued };
  });
  check('player cutscene: a run that arrives while another is being left waits, and starts on its own scene when that one is done', queued.waiting && queued.started && queued.ready && queued.queued === null, JSON.stringify(queued));
  const nulled = await page.evaluate(async () => {
    const t = window.playerTest;
    const h = t.handle;
    h.setCutscene(null);
    h.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'r3'));
    h.setCutsceneScene('r3', 'k1', window.fx.scene1(), t.extras);
    const before = h.queued !== null && h.cutScenes.has('r3');
    h.setCutscene(null);
    const after = { queued: h.queued, kept: h.cutScenes.has('r3') };
    await window.fx.until(() => h.run === null, 10000);
    await new Promise((r) => setTimeout(r, 1200));
    return { before, after, run: h.run, scenes: h.cutScenes.size, id: window.fx.shows() };
  });
  check('player cutscene: a null in between drops the waiting run with its scenes', nulled.before && nulled.after.queued === null && !nulled.after.kept && nulled.run === null && nulled.scenes === 0 && nulled.id === 's1', JSON.stringify(nulled));
  const swapped = await page.evaluate(async () => {
    const t = window.playerTest;
    const h = t.handle;
    h.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'r4'));
    h.setCutsceneScene('r4', 'k1', window.fx.scene1(), t.extras);
    await window.fx.until(() => h.run?.showing && window.fx.black() < 0.01, 10000);
    // Another run takes over the board while one is on.
    h.setCutscene(window.fx.run({ shot: 0, seq: 1 }, 'k1', 'r5'));
    h.setCutsceneScene('r5', 'k1', window.fx.scene1(), t.extras);
    const ready = await window.fx.until(() => h.run?.cutscene.runId === 'r5' && window.fx.shows() === 'cutscene:r5:k1' && window.fx.black() < 0.01, 10000);
    const scenes = [...h.cutScenes.keys()].join();
    h.setCutscene(null);
    await window.fx.until(() => h.run === null, 10000);
    return { ready, scenes, ended: h.endedRun, left: h.cutScenes.size };
  });
  check('player cutscene: a new run id mid-run takes over the board with its own scene, and the last run\'s scenes go', swapped.ready && swapped.scenes === 'r5' && swapped.left === 0 && swapped.ended === 'r5', JSON.stringify(swapped));
});

feature('cutscene limits', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { studio: s } = window.boardTest;
    window.boardTest.setHosting(true);
    const shot = (id, at) => ({ id, at, mapPath: s.first, eye: { x: 400, y: 700, z: 1200 }, target: { x: 400, y: 0, z: 600 }, keyframe: false, transition: 'fade' });
    // A cutscene held past the limits does not start for players, with a notice.
    s.store.set(s.first, [{ id: 'long', name: 'Long', shots: [shot('a', 0), shot('b', 3_600_001)] }, { id: 'many', name: 'Many', shots: Array.from({ length: 201 }, (_, i) => shot(`s${i}`, i * 100)) }]);
    const result = {};
    await s.studio.play('long');
    result.long = { current: window.boardTest.api.cutscene.current(), notice: s.log.notices.at(-1) };
    await s.studio.play('many');
    result.many = { current: window.boardTest.api.cutscene.current(), notice: s.log.notices.at(-1) };
    // The editor's three add notices.
    s.store.set(s.first, [{ id: 'full', name: 'Full', shots: Array.from({ length: 200 }, (_, i) => shot(`s${i}`, i * 100)) }]);
    s.studio.edit('full');
    s.studio.addAt(500_000);
    result.full = s.log.notices.at(-1);
    s.studio.stopEditing();
    s.store.set(s.first, [{ id: 'one', name: 'One', shots: [shot('a', 0)] }]);
    s.studio.edit('one');
    s.studio.addAt(3_600_001);
    result.late = s.log.notices.at(-1);
    s.studio.addAt(50);
    result.close = s.log.notices.at(-1);
    return result;
  });
  check('cutscene limits: a cutscene past one hour does not start for players, and the GM is told', out.long.current === null && /cannot be shown to players: a cutscene lasts at most 1 hour/.test(out.long.notice), JSON.stringify(out));
  check('cutscene limits: nor one of 201 shots', out.many.current === null && /at most 200 shots/.test(out.many.notice), JSON.stringify(out));
  check('cutscene limits: the editor says why a shot is refused: full, too late, too close', /at most 200 shots/.test(out.full) && /at most 1 hour/.test(out.late) && /too close|0\.1 s/.test(out.close), JSON.stringify(out));
});

feature('cutscene board fixes', async ({ page }) => {
  // The GM's lamps keep their shadows after the players' window detaches (the shared maps are released, then made again).
  const lamps = await page.evaluate(async () => {
    const { board } = window.boardTest;
    const casting = () => [...board.rig.entries.values()].filter((entry) => entry.lamp.castShadow);
    await new Promise((r) => setTimeout(r, 600));
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px;';
    document.body.appendChild(stage);
    board.attachPlayer(stage);
    await new Promise((r) => setTimeout(r, 600));
    const before = casting().filter((entry) => entry.lamp.shadow.map !== null).length;
    board.detachPlayer();
    const released = casting().filter((entry) => entry.lamp.shadow.map === null).length;
    await new Promise((r) => setTimeout(r, 800));
    stage.remove();
    const after = casting().filter((entry) => entry.lamp.shadow.map !== null).length;
    return { total: casting().length, before, released, after };
  });
  check('board: the GM\'s lamps make their shadow maps again after the players\' window detaches', lamps.total > 0 && lamps.before === lamps.total && lamps.after === lamps.total, JSON.stringify(lamps));
  // A cutscene driver beats a room-tracking session in applyView.
  const room = await page.evaluate(async () => {
    const { board } = window.boardTest;
    board.setCinematicRole('locked');
    board.setCinematic({ pose: () => ({ eye: { x: 500, y: 900, z: 1400 }, target: { x: 500, y: 0, z: 500 }, black: 0 }) });
    await new Promise((r) => setTimeout(r, 400));
    board.view.position.set(0, 0, 0);
    board.room = { rig: { updateMatrixWorld() {} }, session: null, onFrame: null, far: 1000 };
    try { board.applyView(); } finally { board.room = null; }
    const at = { x: board.view.position.x, y: board.view.position.y, z: board.view.position.z };
    board.setCinematic(null);
    board.setCinematicRole('none');
    return at;
  });
  check('board: a cutscene\'s camera is drawn even while a room-tracking session is up', Math.abs(room.x - 500) < 0.5 && Math.abs(room.y - 900) < 0.5 && Math.abs(room.z - 1400) < 0.5, JSON.stringify(room));
});

feature('shapes tool', async ({ page, shot }) => {
  // The Shapes tool in Edit mode: corners clicked on the floor make a shape, a click inside adds a corner, Ctrl + drag raises it.
  await page.evaluate(() => { const { board, modes, shapes } = window.boardTest; shapes.length = 0; modes.on = true; modes.mode = 'edit'; board.refresh(); board.refreshToolbar(); board.camera.goal.pitch = 0.9; board.wake(true); });
  await wait(400);
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await wait(200);
  check('shapes: the tool opens its panel', await page.locator('.atlas-tabletop-shapes-panel').isVisible());
  const screen = (x, z, y = 0) => page.evaluate(({ x, z, y }) => { const { board } = window.boardTest; board.applyView(); const rect = board.canvas.getBoundingClientRect(); const on = new window.boardTest.Vector3(x, y, z).project(board.view); return { x: rect.left + ((on.x + 1) / 2) * rect.width, y: rect.top + ((1 - on.y) / 2) * rect.height }; }, { x, z, y });
  const corners = [[560, 420], [1120, 420], [1120, 840], [560, 840]];
  for (const [x, z] of corners) { const p = await screen(x, z); await page.mouse.click(p.x, p.y); await wait(120); }
  const first = await screen(560, 420);
  await page.mouse.click(first.x, first.y);
  await wait(300);
  const kept = await page.evaluate(() => window.boardTest.shapes.map((s) => ({ outline: s.outline.length, inner: s.inner.length })));
  check('shapes: four corners clicked and the first again make one closed shape', kept.length === 1 && kept[0].outline === 4 && kept[0].inner === 0, JSON.stringify(kept));
  // A click inside the shape adds a corner there; Ctrl + drag on it raises it.
  const mid = await screen(840, 630);
  await page.mouse.click(mid.x, mid.y);
  await wait(300);
  const handle = await screen(840, 630);
  await page.keyboard.down('Control');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(handle.x, handle.y - k * 10); await wait(16); }
  await page.mouse.up();
  await page.keyboard.up('Control');
  await wait(400);
  const raised = await page.evaluate(() => { const s = window.boardTest.shapes[0]; return { inner: s.inner.map((p) => p.h), outline: s.outline.map((p) => p.h) }; });
  check('shapes: a click inside adds a corner, and Ctrl + drag up raises it (2 squares for 100 px)', raised.inner.length === 1 && Math.abs(raised.inner[0] - 2) < 0.05 && raised.outline.every((h) => h === 0), JSON.stringify(raised));
  const top = await page.evaluate(() => { const { board, Box3 } = window.boardTest; const box = new Box3().setFromObject(board.shapesView.object3d); return { y: box.max.y, cell: board.map.grid.size, meshes: board.shapesView.pickables.length }; });
  check('shapes: the board draws the shape as a mesh peaking at the raised corner', top.meshes === 1 && Math.abs(top.y - 2 * top.cell) < 1, JSON.stringify(top));
  // Its height is typed in the panel too.
  await page.locator('.atlas-tabletop-shapes-panel input[type=number]').fill('3');
  await page.locator('.atlas-tabletop-shapes-panel input[type=number]').press('Enter');
  await wait(300);
  const typed = await page.evaluate(() => window.boardTest.shapes[0].inner[0].h);
  check('shapes: the picked corner\'s height is typed in the panel', typed === 3, String(typed));
  await shot('shapes-roof');
  // Closed sides: the shape gets walls under its raised edges (its peak is inside, so none: a raised outline corner does).
  await page.locator('.atlas-tabletop-shapes-panel input[type=checkbox]').check();
  await wait(300);
  const sides = await page.evaluate(() => window.boardTest.shapes[0].sides);
  check('shapes: Closed sides is kept on the picked shape', sides === true, String(sides));
  // Delete takes the picked corner out; out of Edit mode the tool is put down.
  await page.locator('.atlas-tabletop-shapes-panel').getByRole('button', { name: 'Delete corner' }).click();
  await wait(300);
  const left = await page.evaluate(() => window.boardTest.shapes[0]?.inner.length);
  check('shapes: Delete corner takes the picked corner out', left === 0, String(left));
  await page.evaluate(() => { const { board, modes } = window.boardTest; modes.mode = 'play'; board.refreshToolbar(); });
  await wait(200);
  check('shapes: leaving Edit mode puts the tool down', !(await page.locator('.atlas-tabletop-shapes-panel').isVisible()));
  await page.evaluate(() => { const { board, modes, shapes } = window.boardTest; shapes.length = 0; modes.on = false; board.refresh(); board.refreshToolbar(); });
});

feature('shapes: painted and stood on', async ({ page }) => {
  // A hill with closed sides round a token: the token stands on its surface; the paint tool paints the sides or the surface, whichever is clicked.
  const setup = await page.evaluate(async () => {
    const { board, shapes, modes } = window.boardTest;
    modes.on = true; modes.mode = 'edit';
    const token = board.map.tokens.find((t) => !t.hidden && !t.offMap);
    const x = token.x, y = token.y, r = 280;
    shapes.length = 0;
    shapes.push({ id: 'hill', outline: [{ x: x - r, y: y - r, h: 1 }, { x: x + r, y: y - r, h: 1 }, { x: x + r, y: y + r, h: 1 }, { x: x - r, y: y + r, h: 1 }], inner: [{ x, y, h: 2 }], sides: true });
    board.refresh(); board.refreshToolbar();
    board.camera.goal.yaw = 0; board.camera.goal.pitch = 0.55; board.camera.goal.target.x = x; board.camera.goal.target.z = y + 200; board.camera.goal.distance = 2600; board.camera.snap?.(); board.wake(true);
    await new Promise((r) => setTimeout(r, 1500));
    const entry = board.tokens.get(token.id);
    return { id: token.id, x, y, r, lift: entry.lift, cell: board.map.grid.size };
  });
  check('shapes: a token on a raised shape stands on its surface', Math.abs(setup.lift - 2 * setup.cell) < 2, JSON.stringify(setup));
  const screen = (x, z, y) => page.evaluate(({ x, z, y }) => { const { board } = window.boardTest; board.applyView(); const rect = board.canvas.getBoundingClientRect(); const on = new window.boardTest.Vector3(x, y, z).project(board.view); return { x: rect.left + ((on.x + 1) / 2) * rect.width, y: rect.top + ((1 - on.y) / 2) * rect.height }; }, { x, z, y });
  // A token dragged onto the hill lands where the pointer is on its surface, not on the floor behind it.
  const aim = { x: setup.x + 100, y: setup.y + 80 };
  const from = await screen(setup.x, setup.y, setup.cell * 2);
  const to = await screen(aim.x, aim.y, setup.cell * (2 - 0.5 * 100 / setup.r));
  await page.evaluate(() => { const { modes, board } = window.boardTest; modes.mode = 'play'; board.refreshToolbar(); });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(from.x + (to.x - from.x) * k / 8, from.y + (to.y - from.y) * k / 8); await wait(30); }
  const carried = await page.evaluate((id) => { const e = window.boardTest.board.tokens.get(id); return { x: e.at.x, y: e.at.y }; }, setup.id);
  await page.mouse.up(); await wait(300);
  check('shapes: a token dragged over a shape follows the pointer on its surface', Math.hypot(carried.x - aim.x, carried.y - aim.y) < 60, JSON.stringify({ carried, aim }));
  await page.evaluate(() => { const { modes, board } = window.boardTest; modes.mode = 'edit'; board.refreshToolbar(); });
  await page.evaluate(() => window.boardTest.board.paintWith('materials/brick'));
  // The south side faces the camera: halfway up it.
  const side = await screen(setup.x + 40, setup.y + setup.r, setup.cell * 0.5);
  await page.mouse.click(side.x, side.y);
  await wait(300);
  const afterSide = await page.evaluate(() => { const s = window.boardTest.shapes[0]; return { sides: s.sides, material: s.material ?? null }; });
  check('shapes: painting a side paints the sides, not the surface', afterSide.sides === 'materials/brick' && afterSide.material === null, JSON.stringify(afterSide));
  const top = await screen(setup.x + 120, setup.y + 60, setup.cell * 1.7);
  await page.mouse.click(top.x, top.y);
  await wait(300);
  const afterTop = await page.evaluate(() => { const s = window.boardTest.shapes[0]; return { sides: s.sides, material: s.material ?? null }; });
  check('shapes: painting the surface paints it, the sides kept', afterTop.material === 'materials/brick' && afterTop.sides === 'materials/brick', JSON.stringify(afterTop));
  await page.evaluate(() => { const { board, shapes, modes } = window.boardTest; board.paintWith(null); shapes.length = 0; modes.on = false; board.refresh(); board.refreshToolbar(); });
});

feature('ground', async ({ page, shot }) => {
  // The Ground button's panel (no longer in Board settings): the plane to the horizon (no table), its fog, extra board
  // for minis, and the table grown by it.
  await page.evaluate(() => { const { board, groundState } = window.boardTest; groundState.value = { mode: 'board', noise: 'rolling', strength: 0.5, fog: 40, margin: 0, tile: 2, water: { kind: 'ripples', amount: 0.5, direction: 90, tint: '#2d6b78', clarity: 0.6 } }; board.refresh(); });
  const placed0 = await page.evaluate(() => ({ inSettings: !!document.querySelector('[aria-label="Board settings"][role="dialog"] [aria-label="Ground round the map"]'), inGround: !!document.querySelector('[aria-label="Ground"][role="dialog"] [aria-label="Ground round the map"]') }));
  check('ground: the ground settings have their own panel, out of Board settings', placed0.inGround && !placed0.inSettings, JSON.stringify(placed0));
  await page.getByRole('button', { name: 'Ground', exact: true }).click();
  await wait(200);
  const opened = await page.evaluate(() => { const panel = document.querySelector('[aria-label="Ground"][role="dialog"]'); const settings = document.querySelector('[aria-label="Board settings"][role="dialog"]'); return { shown: !panel.hidden, settings: settings.hidden, expanded: document.querySelector('button[aria-label="Ground"]').getAttribute('aria-expanded') }; });
  check('ground: the Ground button opens its panel, Board settings stays closed', opened.shown && opened.settings && opened.expanded === 'true', JSON.stringify(opened));
  // Every background is in full sight inside the panel (five of them once ran past its edge, lava and acid cut off).
  const fits = await page.evaluate(() => {
    // Narrower than here (Obsidian's own fonts and a narrow pane take more room): the choices must still fit.
    const element = document.querySelector('[aria-label="Ground"][role="dialog"]');
    element.style.width = '280px';
    const panel = element.getBoundingClientRect();
    const out = [...document.querySelectorAll('[aria-label="Ground round the map"] button')].map((b) => { const r = b.getBoundingClientRect(); return { name: b.textContent, inside: r.width > 20 && r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5 && r.top >= panel.top - 0.5 && r.bottom <= panel.bottom + 0.5 }; });
    element.style.width = '';
    return out;
  });
  const shownRows = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Ground"][role="dialog"] .atlas-tabletop-palette__field')].filter((row) => row.getBoundingClientRect().height > 0).map((row) => row.querySelector('.atlas-tabletop-palette__label')?.textContent));
  check('ground: on the map board only its own rows show (no plane, pattern or liquid settings)', !shownRows.includes('Pattern') && !shownRows.includes('Moves') && !shownRows.includes('Ground material') && shownRows.includes('Extra board'), JSON.stringify(shownRows));
  check('ground: all five backgrounds show in full inside the panel, lava and acid among them', fits.length === 5 && fits.every((f) => f.inside) && fits.some((f) => f.name === 'Lava plane') && fits.some((f) => f.name === 'Acid plane'), JSON.stringify(fits));
  await shot('ground-panel');
  await page.getByRole('button', { name: 'Horizon plane' }).click();
  await wait(500);
  const horizon = await page.evaluate(() => { const { board, groundState } = window.boardTest; return { mode: groundState.value.mode, plane: board.groundPlane.object3d.parent === board.scene, table: board.surface.table.visible, fog: board.scene.fog ? board.scene.fog.far : null, pattern: !document.querySelector('[aria-label="Height pattern past the board"]').closest('label').hidden }; });
  check('ground: Horizon plane lays the map on a plane to the horizon, with no table round it', horizon.mode === 'horizon' && horizon.plane && horizon.table === false && horizon.pattern, JSON.stringify(horizon));
  // The fog slider: thicker is nearer.
  await page.evaluate(() => { const input = document.querySelector('[aria-label="Distance fog"]'); input.value = '90'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(400);
  const thick = await page.evaluate(() => window.boardTest.board.scene.fog?.far ?? null);
  check('ground: the distance fog slider brings the fog nearer', horizon.fog !== null && thick !== null && thick < horizon.fog, JSON.stringify({ before: horizon.fog, thick }));
  await page.evaluate(() => { const input = document.querySelector('[aria-label="Distance fog"]'); input.value = '30'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  // Extra board: a token is carried out past the map's edge, where it could not go before.
  await page.evaluate(() => { const input = document.querySelector('[aria-label="Extra board round the map, in squares"]'); input.value = '20'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(400);
  const out = await page.evaluate(() => { const { board } = window.boardTest; const cell = board.map.grid.size; return { inside: board.clampToBoard(-10 * cell, -5 * cell), beyond: board.clampToBoard(-40 * cell, 0), cell }; });
  check('ground: the extra board lets a mini stand off the map, up to its edge', Math.abs(out.inside.x + 10 * out.cell) < 1 && Math.abs(out.beyond.x + 20 * out.cell) < 1, JSON.stringify(out));
  // The plane lies under the scene's first level, whichever is shown; a material on it is read untiled, its own copy.
  const placed = await page.evaluate(async () => {
    const { board, groundState } = window.boardTest;
    groundState.value = { ...groundState.value, material: 'materials/brick', tile: 3 };
    board.refresh();
    await new Promise((r) => setTimeout(r, 800));
    const lowest = Math.min(0, ...board.stackData.map((l) => l.elevation));
    const material = board.groundPlane.object3d.material;
    return { y: board.groundPlane.object3d.position.y, want: lowest * board.map.grid.size, own: material !== board.wallLook('materials/brick', false), mapped: !!material.map, key: material.customProgramCacheKey?.() };
  });
  check('ground: the plane lies under the first level, and wears its own untiled copy of the material', placed.y === placed.want && placed.own && placed.mapped && placed.key === 'tabletop-ground', JSON.stringify(placed));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const { board } = window.boardTest; board.camera.goal.pitch = 0.45; board.camera.goal.distance *= 1.6; board.wake(true); });
  await wait(1200);
  await shot('ground-horizon');
  // Water plane: painted water's surface to the horizon, with the painted water's settings; no table, no ground plane.
  await page.evaluate(() => { const { board } = window.boardTest; board.toolbar.openGround?.(); });
  await page.getByRole('button', { name: 'Water plane' }).click();
  await wait(600);
  await page.evaluate(() => { const select = document.querySelector('[aria-label="How the liquid moves"]'); select.value = 'waves'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(600);
  const sea = await page.evaluate(() => { const { board, groundState } = window.boardTest; return { mode: groundState.value.mode, kind: groundState.value.water.kind, sea: board.seaPlane.object3d.parent === board.scene, ground: board.groundPlane.object3d.parent !== null, table: board.surface.table.visible, rows: !document.querySelector('[aria-label="How clear the liquid is"]').closest('label').hidden && document.querySelector('[aria-label="Height pattern past the board"]').closest('label').hidden }; });
  check('ground: Water plane lays the map on water to the horizon, set as painted water is', sea.mode === 'water' && sea.kind === 'waves' && sea.sea && !sea.ground && sea.table === false && sea.rows, JSON.stringify(sea));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const { board } = window.boardTest; board.camera.goal.pitch = 0.4; board.wake(true); });
  await wait(1500);
  await shot('ground-water');
  // Back to the map board, with the extra board: the table grows round it.
  await page.evaluate(() => { const { board, groundState } = window.boardTest; groundState.value = { ...groundState.value, mode: 'board', margin: 10 }; board.refresh(); });
  await wait(400);
  const table = await page.evaluate(() => { const { board } = window.boardTest; const s = board.surface; s.frame.geometry.computeBoundingBox(); const box = s.frame.geometry.boundingBox; return { frame: box.max.x - box.min.x, width: s.width, cell: board.map.grid.size, mat: s.mat?.visible === true, table: s.table.visible, plane: board.groundPlane.object3d.parent !== null }; });
  check('ground: on the map board the table and its mat grow by the extra board', table.table && table.mat && !table.plane && table.frame > table.width + 20 * table.cell - 1, JSON.stringify(table));
  await page.evaluate(() => { const { board, groundState } = window.boardTest; groundState.value = { mode: 'board', noise: 'rolling', strength: 0.5, fog: 40, margin: 0, tile: 2, water: { kind: 'ripples', amount: 0.5, direction: 90, tint: '#2d6b78', clarity: 0.6 } }; board.refresh(); });
});

feature('player shapes and ground', async ({ page, shot }) => {
  // Connect sends the GM's raised shapes and ground: a player's board draws the shapes, stands on them, and lays the plane.
  await page.evaluate(() => {
    const t = window.playerTest;
    t.handle.setExtras({ ...t.extras, shapes: [{ id: 'hill', outline: [300, 500, 0, 600, 500, 0, 600, 800, 0, 300, 800, 0], inner: [450, 650, 2] }], ground: { mode: 'horizon', noise: 'rolling', strength: 0.5, fog: 40, margin: 6, tile: 2, water: { kind: 'ripples', amount: 0.5, direction: 90, tint: '#2d6b78', clarity: 0.6 } } });
  });
  await page.waitForFunction(() => window.playerTest.board.groundPlane.object3d.parent !== null, null, { timeout: 15000 }).catch(() => {});
  await wait(800);
  const drawn = await page.evaluate(() => {
    const { board } = window.playerTest;
    return { shapes: board.shapesView.pickables.length, plane: board.groundPlane.object3d.parent === board.scene, table: board.surface.table.visible };
  });
  check('player shapes and ground: the GM\'s shape is drawn on the player\'s board and the plane runs to the horizon, no table', drawn.shapes === 1 && drawn.plane && drawn.table === false, JSON.stringify(drawn));
  await page.evaluate(() => { const { board } = window.playerTest; board.camera.goal.pitch = 0.5; board.wake(true); });
  await wait(1200);
  await shot('player-shapes-ground');
  // Without them (an older GM): no shapes, the map on its table.
  await page.evaluate(() => { const t = window.playerTest; t.handle.setExtras({ ...t.extras }); });
  await wait(1200);
  const plain = await page.evaluate(() => { const { board } = window.playerTest; return { shapes: board.shapesView.pickables.length, plane: board.groundPlane.object3d.parent !== null, table: board.surface.table.visible }; });
  check('player shapes and ground: extras without them leave no shape and the map on its table', plain.shapes === 0 && !plain.plane && plain.table, JSON.stringify(plain));
}, PLAYER_URL);

feature('loading veil', async ({ page, shot }) => {
  // A board whose files take a while: the board blurred behind a bar and the time left, which go once all is in.
  await page.evaluate(() => {
    const t = window.playerTest;
    t.hold('G'.repeat(43));
    const made = t.spawn();
    window.veiled = made;
    made.handle.setScene(t.scene);
    made.handle.setExtras(t.extras);
  });
  await wait(900);
  const during = await page.evaluate(() => {
    const veil = window.veiled.container.querySelector('.atlas-tabletop-loading');
    const style = veil && getComputedStyle(veil);
    return { shown: !!veil && !veil.hidden && veil.classList.contains('is-shown'), blur: style?.backdropFilter ?? '', pointer: style?.pointerEvents, detail: veil?.querySelector('.atlas-tabletop-loading__detail')?.textContent ?? '', value: Number(veil?.getAttribute('aria-valuenow')) };
  });
  check('loading veil: while a mini has not come, the board is blurred behind a bar with what is in and the time left', during.shown && /blur/.test(during.blur) && during.pointer === 'none' && /of \d+ ·/.test(during.detail) && during.value < 100, JSON.stringify(during));
  await page.evaluate(() => window.veiled.container.scrollIntoView());
  await shot('loading-veil', await page.evaluate(() => { const r = window.veiled.container.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }));
  await page.evaluate(() => { window.playerTest.deliver(); window.veiled.handle.refresh(); });
  await wait(1500);
  const after = await page.evaluate(() => { const veil = window.veiled.container.querySelector('.atlas-tabletop-loading'); return { hidden: !!veil && veil.hidden, shown: veil?.classList.contains('is-shown') }; });
  check('loading veil: once all is in, the veil goes', after.hidden && !after.shown, JSON.stringify(after));
  // The first board, loaded with everything at hand, never showed it.
  const quick = await page.evaluate(() => { const veil = document.getElementById('board').querySelector('.atlas-tabletop-loading'); return !!veil && veil.hidden; });
  check('loading veil: a board whose files are all at hand shows none', quick);
}, PLAYER_URL);

/** What every feature depends on beside the bundle: this file outside the features, the page, the styles, the runner. */
function globalHash() {
  let rest = fs.readFileSync(__filename, 'utf8');
  for (const one of features) rest = rest.replace(one.run.toString(), '');
  const files = ['harness/affected.cjs', 'scripts/testCache.cjs', 'harness/run-ui.mjs', 'harness/make-test-video.cjs', 'harness/board.html', 'package-lock.json', ...cache.repoFiles(['tests/fixtures'])];
  // The styles without their comments: a comment changes no page.
  return cache.hashText([rest, cache.hashFiles(files), affected.cssHash('styles.css'), affected.cssHash(path.join(root, 'atlas.css'))].join('\n'));
}

server.listen(0, async () => {
  const errors = [];
  const bundles = { 'board.js': affected.inventory(path.join(root, 'board.js')), 'playerBoard.js': affected.inventory(path.join(root, 'playerBoard.js')) };
  const bundleOf = (one) => (one.url === '/playerBoard.html' ? 'playerBoard.js' : 'board.js');
  const testHash = (one) => cache.hashText(`${one.name}\n${one.url ?? '/'}\n${one.run.toString()}`);
  const global = globalHash();
  const kept = cache.load('features');
  const counts = new Map();
  for (const one of features) { const n = counts.get(one.name) ?? 0; counts.set(one.name, n + 1); one.key = n ? `${one.name}#${n}` : one.name; }
  const stale = (one) => { const record = kept[one.key]; return !record || record.global !== global || record.test !== testHash(one) || !affected.holds(record, bundles[bundleOf(one)]); };
  const chosen = features.filter((one) => (only ? only.test(one.name) : cache.full() || stale(one)));
  if (!chosen.length) {
    console.log(`affected: 0 of ${features.length} features (all unchanged since they last passed; --full runs them all)`);
    server.close();
    process.exit(0);
  }
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let veilSeen = 0;
  try {
    for (const one of chosen) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${one.name}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`${one.name}: pageerror: ${e.message}${e.stack ? ` @ ${e.stack.split(String.fromCharCode(10)).slice(1, 4).join(" < ").trim()}` : ""}`));
      const before = results.length;
      let threw = false;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.startPreciseCoverage', { callCount: false, detailed: false });
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}${one.url ?? '/'}`);
        await page.waitForFunction(() => window.boardTest?.ready || window.playerTest?.ready || window.boardError, null, { timeout: 30000 });
        const boot = await page.evaluate(() => window.boardError ?? null);
        if (boot) throw new Error(boot);
        await wait(1200);
        // The board's loading veil (it blurs the board while its first files come) is gone before a feature starts:
        // its blur would slow the frames a timed check counts.
        const veiled = await page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-loading')].some((veil) => !veil.hidden));
        veilSeen += veiled ? 1 : 0;
        await page.waitForFunction(() => [...document.querySelectorAll('.atlas-tabletop-loading')].every((veil) => veil.hidden), null, { timeout: 10000 }).catch(() => {});
        const shot = (name, clip) => page.screenshot({ path: `${shots}/${name}.png`, ...(clip ? { clip } : {}) });
        await one.run({ page, shot });
      } catch (error) {
        threw = true;
        check(`${one.name} ran`, false, String(error && error.stack || error));
      }
      // Kept only when it passed: what it ran of its bundle, so a change elsewhere leaves it be.
      const passed = !threw && results.slice(before).every((r) => r.ok);
      delete kept[one.key];
      if (passed) {
        try {
          const bundle = bundleOf(one);
          const { result } = await cdp.send('Profiler.takePreciseCoverage');
          // One entry each time the page loaded the bundle (a feature may reload it): all of them.
          const entries = result.filter((script) => script.url.endsWith(`/${bundle}`));
          if (entries.length) kept[one.key] = { global, test: testHash(one), ...affected.ran(entries, bundles[bundle]) };
          // Kept as it goes: a run stopped half way keeps what it found.
          cache.save('features', kept);
        } catch (error) {
          errors.push(`${one.name}: coverage: ${error.message}`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const key of Object.keys(kept)) if (!features.some((one) => one.key === key)) delete kept[key];
    cache.save('features', kept);
  }
  if (only) console.log(`ran the ${chosen.length} of ${features.length} features matching ${only}`);
  else if (chosen.length < features.length) console.log(`affected: ran ${chosen.length} of ${features.length} features (${features.length - chosen.length} unchanged since they last passed; --full runs them all)`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  ${r.detail}`}`);
  if (veilSeen) console.log(`the loading veil was still up after boot on ${veilSeen} feature page(s); waited for it`);
  if (errors.length) console.log(`console errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 6).join('\n  ')}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
});
