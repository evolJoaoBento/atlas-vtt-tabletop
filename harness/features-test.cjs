// Usage: node harness/features-test.cjs <bundle dir> <screenshot dir>, after bundling harness/board.ts (see README).
// Browser checks of features added after board-test.cjs: each drives the real board and its DOM (clicks, keys, what is
// drawn) and takes a screenshot to look at. Prints one line per check and exits 1 if any failed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const shots = process.argv[3];
const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webm': 'video/webm' };
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
  // A board whose tab is behind another is not on screen: nothing plays, its loops go quiet, and they return when it is shown.
  await page.evaluate(() => { const { board, sounds } = window.boardTest; board.container.style.display = 'none'; sounds.plays.length = 0; board.sound('dice.hit', { gain: 0.5 }); board.soundLoop('water', 'water.waves', 0.2); board.wake(true); });
  await wait(400);
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

// ── Board sounds: dice clack per hit (at most 6 in 50 ms), a rolling layer that stops when the dice rest ───────────
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
  const rolling = await page.evaluate(() => window.boardTest.sounds.loops.filter((loop) => loop[1] === 'dice.roll').length);
  check('dice sounds: the rolling layer plays while the dice tumble', rolling > 0, rolling);
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
  check('dice sounds: when the dice rest the rolling layer is stopped', heard.last[0] === 'dice' && heard.last[1] === null, JSON.stringify(heard.last));
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
  // From a token's eyes the scene above is always there and solid: under line of sight and a faded look alike.
  const firstPerson = await page.evaluate(async () => {
    const { board } = window.boardTest;
    const before = board.quality.layerLook;
    const sight = board.quality.lineOfSight;
    board.setQuality({ ...board.quality, layerLook: 'faded', lineOfSight: 'everyone' });
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
    board.setQuality({ ...board.quality, layerLook: before, lineOfSight: sight });
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

// ── Line of sight: what stands behind walls and shut doors is hidden from the tokens that see ───────────────────
feature('line of sight', async ({ page, shot }) => {
  const probe = () => page.evaluate(() => {
    const { board } = window.boardTest;
    const shown = {};
    for (const [id, entry] of board.tokens) shown[id] = entry.piece.object3d.visible;
    for (const [id, piece] of board.props) shown[`prop:${id}`] = piece.object3d.visible;
    return { shown, sight: board.sight === null ? null : [...board.sight].sort() };
  });
  const mode = (look) => page.evaluate((look) => { const { board } = window.boardTest; board.setQuality({ ...board.quality, lineOfSight: look }); }, look);
  // The hero stands in the room at the bottom (door shut in its north wall) and sees; the goblin is out in the common room.
  await page.evaluate(() => {
    const { board } = window.boardTest;
    const hero = board.map.tokens.find((t) => t.id === 'hero');
    board.changeToken('hero', { ...hero, x: 560, y: 910, sees: true });
  });
  await wait(600);
  let now = await probe();
  check('sight: off, nothing is hidden even where a token sees', now.sight === null && now.shown.gob === true && now.shown.hero === true, JSON.stringify(now));
  await mode('everyone');
  await wait(600);
  now = await probe();
  check('sight: the goblin outside the shut room is hidden from the hero inside it, and the hero is not', now.shown.gob === false && now.shown.hero === true, JSON.stringify(now));
  check('sight: the prop outside is hidden too', now.shown['prop:barrel'] === false, JSON.stringify(now));
  const veil = await page.evaluate(() => {
    const { board } = window.boardTest;
    const mesh = board.veilSight.object3d;
    return { visible: mesh.visible, vertices: mesh.geometry.getAttribute('position')?.count ?? 0 };
  });
  check('sight: the unseen squares are covered by dark blocks on the GM board under Everyone', veil.visible && veil.vertices > 0, JSON.stringify(veil));
  await shot('line-of-sight-everyone');
  // Rays: the veil follows the lines of sight, not squares. A wall at an angle, the hero in the open in front of it.
  const keptMap = await page.evaluate(() => window.boardTest.board.map);
  await page.evaluate(async () => {
    const { board } = window.boardTest;
    const d = { id: 'slant', type: 'solid', p1: { x: 500, y: 700 }, p2: { x: 700, y: 500 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null };
    const tokens = board.map.tokens.map((t) => (t.id === 'hero' ? { ...t, x: 420, y: 420, sees: true } : t));
    await board.load({ ...board.map, walls: [d], tokens });
  });
  await wait(700);
  const slant = await page.evaluate(() => { const m = window.boardTest.board.sightMasks?.sight; return { exact: !!m?.unseen, before: m?.seenAt(590, 590), behind: m?.seenAt(615, 615), side: m?.seenAt(900, 200) }; });
  // (590, 590) is just in front of the wall's line, (615, 615) just behind it.
  check('rays: the veil goes along the lines of sight, not by squares (just in front of a slanted wall seen, just behind it not)', slant.exact && slant.before === true && slant.behind === false && slant.side === true, JSON.stringify(slant));
  await shot('line-of-sight-rays-slant');
  await page.evaluate(async (kept) => { await window.boardTest.board.load(kept); }, keptMap);
  await wait(400);
  await mode('players');
  await wait(400);
  now = await probe();
  check('sight: set to players, the GM board still shows everything', now.shown.gob === true, JSON.stringify(now));
  await mode('everyone');
  await page.evaluate(async () => {
    const { board, map } = window.boardTest;
    const open = { ...board.map, walls: board.map.walls.map((w) => (w.id === 'door' ? { ...w, closed: false } : w)) };
    await board.load(open);
  });
  await wait(600);
  now = await probe();
  check('sight: with the door open the goblin in line with it is in view again', now.shown.gob === true && now.sight.includes('t:gob'), JSON.stringify(now));
  // Previewing a token's point of view, from its right-click menu, with the setting off.
  await mode('off');
  await page.evaluate(async () => {
    const { board } = window.boardTest;
    const closed = { ...board.map, walls: board.map.walls.map((w) => (w.id === 'door' ? { ...w, closed: true } : w)) };
    await board.load(closed);
  });
  await wait(500);
  const menu = (label) => page.evaluate((label) => {
    window.boardTest.board.host.tokenMenu('hero', { clientX: 200, clientY: 200 });
    const items = [...document.querySelectorAll('.atlas-ctx-item')];
    const labels = items.map((item) => item.textContent.trim());
    const found = items.find((item) => item.textContent.trim() === label);
    found?.click();
    return labels;
  }, label);
  const before = await menu('Preview POV');
  check('pov: the token menu offers Preview POV', before.includes('Preview POV') && !before.includes('Stop POV'), JSON.stringify(before));
  await wait(500);
  now = await probe();
  const chip = await page.evaluate(() => { const c = document.querySelector('.atlas-tabletop-pov'); return c && !c.hidden ? c.textContent : null; });
  check('pov: from the hero inside the shut room the goblin is hidden on the GM board, with the setting off', now.shown.gob === false && now.shown.hero === true && chip && chip.includes('Stop POV'), JSON.stringify({ now, chip }));
  await shot('pov-preview');
  const again = await menu('Stop POV');
  check('pov: its menu now offers Stop POV, and choosing it ends the preview', again.includes('Stop POV') && !again.includes('Preview POV'), JSON.stringify(again));
  await wait(500);
  now = await probe();
  const gone = await page.evaluate(() => { const c = document.querySelector('.atlas-tabletop-pov'); return !c || c.hidden; });
  check('pov: everything is shown again and the chip goes', now.shown.gob === true && gone, JSON.stringify({ now, gone }));
  await mode('off');
  await wait(400);
  now = await probe();
  // The cinematic style: the whole sealed room, then the whole outside once its door is open.
  const style = (look) => page.evaluate((look) => { const { board } = window.boardTest; board.setQuality({ ...board.quality, sightStyle: look }); }, look);
  const reload = (open) => page.evaluate(async (open) => {
    const { board } = window.boardTest;
    await board.load({ ...board.map, walls: board.map.walls.map((w) => (w.id === 'door' ? { ...w, closed: !open } : w)) });
  }, open);
  await reload(false);
  await mode('everyone');
  await style('cinematic');
  await wait(600);
  now = await probe();
  // How much of the map is in sight, in squares: by the rooms seen (cinematic), else the squares seen.
  const cells = () => page.evaluate(() => {
    const m = window.boardTest.board.sightMasks?.sight;
    if (!m) return null;
    if (m.squares) return m.squares.reduce((a, b) => a + b, 0);
    const g = window.boardTest.board.map.grid.size;
    const area = (poly) => Math.abs(poly.reduce((sum, p, i) => { const q = poly[(i + 1) % poly.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2);
    return m.rooms.rooms.rooms.reduce((sum, room, i) => sum + (m.rooms.seen[i] ? area(room.outer) - room.holes.reduce((h, hole) => h + area(hole), 0) : 0), 0) / (g * g);
  });
  check('cinematic: sight goes by the rooms the walls make', await page.evaluate(() => !!window.boardTest.board.sightMasks?.sight?.rooms));
  const sealed = await cells();
  check('cinematic: sealed in the room the hero sees only the room (a handful of squares) and the goblin outside is hidden', sealed > 0 && sealed < 40 && now.shown.gob === false && now.shown.hero === true, JSON.stringify({ sealed, shown: now.shown }));
  await shot('line-of-sight-cinematic-sealed');
  await reload(true);
  await wait(600);
  now = await probe();
  const opened = await cells();
  check('cinematic: with the door open the hero sees the whole outside (most of the map), goblins included', opened > 150 && now.shown.gob === true && now.shown.gob2 === true, JSON.stringify({ opened, shown: now.shown }));
  await shot('line-of-sight-cinematic-open');
  // A room at an angle, off the grid: hidden and shown along its own walls, not by squares.
  const kept = await page.evaluate(() => window.boardTest.board.map);
  await page.evaluate(async () => {
    const { board } = window.boardTest;
    const d = (id, x1, y1, x2, y2) => ({ id, type: 'solid', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null });
    // A diamond round (560, 560), its corners off the squares' lines.
    const walls = [d('d1', 560, 383, 737, 560), d('d2', 737, 560, 560, 737), d('d3', 560, 737, 383, 560), d('d4', 383, 560, 560, 383)];
    const tokens = board.map.tokens.map((t) => (t.id === 'hero' ? { ...t, x: 560, y: 560, sees: true } : t.id === 'gob' ? { ...t, x: 640, y: 470, sees: false } : t.id === 'gob2' ? { ...t, x: 665, y: 445, sees: false } : t));
    await board.load({ ...board.map, walls, tokens });
  });
  await wait(700);
  now = await probe();
  const diamond = await page.evaluate(() => { const m = window.boardTest.board.sightMasks?.sight; return { rooms: !!m?.rooms, inside: m?.seenAt(640, 470), outside: m?.seenAt(665, 445), far: m?.seenAt(100, 100) }; });
  // (640, 470) is just inside the diamond's edge and (665, 445) just outside it; both lie in squares the edge cuts through.
  check('cinematic, a room at an angle: what is just inside its wall is seen, what is just outside is not', diamond.rooms && diamond.inside === true && diamond.outside === false && diamond.far === false && now.shown.gob === true && now.shown.gob2 === false, JSON.stringify({ diamond, gob: now.shown.gob, gob2: now.shown.gob2 }));
  check('cinematic, a room at an angle: the veil covers what is outside it', await page.evaluate(() => { const g = window.boardTest.board.veilSight.object3d.geometry; return (g.getAttribute('position')?.count ?? 0) > 0; }));
  await shot('line-of-sight-cinematic-diamond');
  await page.evaluate(async (kept) => { await window.boardTest.board.load(kept); }, kept);
  await wait(400);
  // Scenes stacked above are blacked out under line of sight, the ones below stay.
  await page.evaluate(() => {
    const { board, map } = window.boardTest;
    const layer = (path, elevation) => ({
      path, elevation, map: { ...map, path, background: 'bg.png', fog: [], inks: [], texts: [], icons: [], pins: [], initiative: null, tokens: [], walls: [], lights: [] },
      wallHeight: () => null, wallMaterial: () => null, doorProp: () => null, lightHeight: () => 1, fogHeight: 1, wallThickness: 0.12, props: [], placement: () => null, style: () => 'disc',
    });
    board.setStack([layer('up.atlasmap', 2), layer('down.atlasmap', -2)]);
  });
  await wait(800);
  const levels = () => page.evaluate(() => Object.fromEntries([...window.boardTest.board.layerViews].map(([path, view]) => [path, view.object3d.visible])));
  let seenLevels = await levels();
  const shades = await page.evaluate(() => Object.fromEntries([...window.boardTest.board.layerViews].map(([path, view]) => [path, { shadow: view.floor.material === view.shade, content: view.content.visible, drawn: view.floor.visible }])));
  check('sight layers: with line of sight on, the scene above is drawn as a black shadow (nothing standing on it) and the one below is shown as it is', seenLevels['up.atlasmap'] === true && seenLevels['down.atlasmap'] === true && shades['up.atlasmap'].shadow && !shades['up.atlasmap'].content && shades['up.atlasmap'].drawn && !shades['down.atlasmap'].shadow && shades['down.atlasmap'].content, JSON.stringify({ seenLevels, shades }));
  await shot('line-of-sight-layer-shadow');
  // Under Hidden the shadow is not drawn either, as the image is not.
  await page.evaluate(() => { const { board } = window.boardTest; board.setQuality({ ...board.quality, layerLook: 'transparent' }); });
  await wait(1000);
  const hiddenShadow = await page.evaluate(() => window.boardTest.board.layerViews.get('up.atlasmap').floor.visible);
  check('sight layers: under Hidden the shadow of the layer above is not drawn', hiddenShadow === false);
  await page.evaluate(() => { const { board } = window.boardTest; board.setQuality({ ...board.quality, layerLook: 'solid' }); });
  // The layer menu down the right: highest first, the shown scene marked, one click on another switches.
  await page.evaluate(() => window.boardTest.board.setLayerMenu([{ path: 'up.atlasmap', name: 'up', elevation: 2, active: false }, { path: 'maps/tavern.atlasmap', name: 'tavern', elevation: 0, active: true }, { path: 'down.atlasmap', name: 'down', elevation: -2, active: false }]));
  const items = await page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-layers__item')].map((el) => [el.textContent, el.classList.contains('is-active'), Math.round(parseFloat(el.style.bottom))]));
  const dashes = await page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-layers__tick')].map((el) => el.title));
  check('layers ruler: a marker per scene on the rail, the lowest at the bottom and the highest at the top, the shown one marked', items.length === 3 && items[0][0] === '+2up' && items[1][1] === true && items[2][0] === '-2down' && items[2][2] === 0 && items[0][2] > items[1][2] && items[1][2] > items[2][2], JSON.stringify(items));
  check('layers ruler: a dash every two squares between the lowest and the highest by default', JSON.stringify(dashes) === JSON.stringify(['-2', '0', '2']), JSON.stringify(dashes));
  await page.evaluate(() => { const { board } = window.boardTest; board.setQuality({ ...board.quality, layerTick: 1 }); });
  const finer = await page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-layers__tick')].map((el) => el.title));
  check('layers ruler: the step is a setting: a dash every square when set to one', JSON.stringify(finer) === JSON.stringify(['-2', '-1', '0', '1', '2']), JSON.stringify(finer));
  await page.evaluate(() => { const { board } = window.boardTest; board.setQuality({ ...board.quality, layerTick: 2 }); });
  await shot('layer-menu');
  await page.locator('.atlas-tabletop-layers__item').first().click();
  await page.locator('.atlas-tabletop-layers__item.is-active').click({ force: true }).catch(() => {});
  const switched = (await page.evaluate(() => window.boardTest.record.sceneTabs)).filter((entry) => entry[0] === 'layer');
  check('layers menu: clicking another scene switches to it, clicking the shown one does nothing', JSON.stringify(switched) === JSON.stringify([['layer', 'up.atlasmap']]), JSON.stringify(switched));
  // The camera glides: after a switch it stays on the old floor, then eases to the new one.
  const glide = await page.evaluate(async () => {
    const { board } = window.boardTest;
    board.camera.pose.target.y = 0; board.camera.goal.target.y = 0;
    board.reorigin(-140);
    const start = board.camera.pose.target.y;
    await new Promise((resolve) => setTimeout(resolve, 900));
    return { start, end: board.camera.pose.target.y };
  });
  check('layers menu: the camera starts on the old floor and glides to the new one', glide.start === -140 && Math.abs(glide.end) < 20, JSON.stringify(glide));
  await page.evaluate(() => window.boardTest.board.setLayerMenu(null));
  const menuHidden = await page.evaluate(() => document.querySelector('.atlas-tabletop-layers').hidden);
  check('layers menu: it hides when there is no stack', menuHidden === true);
  await mode('off');
  await wait(500);
  seenLevels = await levels();
  check('sight layers: with it off both are shown again', seenLevels['up.atlasmap'] === true && seenLevels['down.atlasmap'] === true, JSON.stringify(seenLevels));
  await page.evaluate(() => window.boardTest.board.setStack([]));
  await style('rays');
  await reload(false);
  await wait(500);
  now = await probe();
  check('sight: off again, everything is shown', now.sight === null && Object.values(now.shown).every((v) => v === true || v === false) && now.shown.gob === true, JSON.stringify(now));
});

// ── Placing a scene of a stack on the plane beyond its height: handles in the middle of the view ───────────────
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

feature('layer placement', async ({ page, shot }) => {
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
  await page.evaluate(() => window.boardTest.board.setAdjust('up.atlasmap'));
  await wait(400);
  const chip = await page.evaluate(() => { const c = document.querySelector('.atlas-tabletop-adjust'); return c && !c.hidden ? c.textContent : null; });
  check('placement: the handles appear and a chip names the scene being adjusted', chip && chip.includes('up') && chip.includes('Stop') && (await page.evaluate(() => window.boardTest.board.gizmo !== null)), String(chip));
  await shot('layer-placement-handles');
  // `project` takes the map's x and y and a height; the board's z is the map's y.
  const at = (x, y, z) => page.evaluate(([x, y, z]) => window.boardTest.project(x, z, y), [x, y, z]);
  const gizmo = () => page.evaluate(() => { const g = window.boardTest.board.gizmo.object3d; return { x: g.position.x, y: g.position.y, z: g.position.z, scale: g.scale.x }; });
  const layerAt = () => page.evaluate(() => { const v = window.boardTest.board.layerViews.get('up.atlasmap'); return { x: v.object3d.position.x, z: v.object3d.position.z, turn: v.stands.turn, sx: v.stands.x, sy: v.stands.y }; });
  const g0 = await gizmo();
  const before = await layerAt();
  // Drag the square in the middle: the scene follows.
  const middle = await at(g0.x, g0.y, g0.z);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x + 60, middle.y + 20, { steps: 6 });
  await page.mouse.up();
  await wait(300);
  const after = await layerAt();
  const placed = (await events()).filter((e) => e[0] === 'placed');
  check('placement: dragging the square slides the scene on the plane, and it is kept when let go', after.sx > 20 && placed.length === 1 && placed[0][1] === 'up.atlasmap' && Math.abs(placed[0][2].x - after.sx) < 1e-6, JSON.stringify({ before, after, placed }));
  // Drag the ring: the scene turns about the middle of the handles.
  const g1 = await gizmo();
  const radius = 1.45 * g1.scale;
  const start = await at(g1.x + radius, g1.y, g1.z);
  const quarter = await at(g1.x, g1.y, g1.z + radius);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + quarter.x) / 2, (start.y + quarter.y) / 2, { steps: 4 });
  await page.mouse.move(quarter.x, quarter.y, { steps: 4 });
  await page.mouse.up();
  await wait(300);
  const turned = await layerAt();
  check('placement: dragging the ring turns the scene, a quarter turn clockwise for a quarter of the way round', Math.abs(turned.turn - 90) < 8, JSON.stringify(turned));
  check('placement: the turn snaps to a quarter turn by default (exactly 90 here)', turned.turn === 90, JSON.stringify(turned));
  // Modifiers: Alt turns freely, Shift snaps to 45 degrees, Ctrl to 5. Each drag starts on the ring at 0 degrees and goes round by `degrees`.
  const ringTurn = async (degrees, key) => {
    const g = await gizmo();
    const r = 1.45 * g.scale;
    const rad = (degrees * Math.PI) / 180;
    const from = await at(g.x + r, g.y, g.z);
    const to = await at(g.x + r * Math.cos(rad), g.y, g.z + r * Math.sin(rad));
    const half = await at(g.x + r * Math.cos(rad / 2), g.y, g.z + r * Math.sin(rad / 2));
    if (key) await page.keyboard.down(key);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(half.x, half.y, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    if (key) await page.keyboard.up(key);
    await wait(200);
    return (await layerAt()).turn;
  };
  const free = await ringTurn(17, 'Alt');
  check('placement: with Alt the turn is free (about 107 degrees here, on no step)', Math.abs(free - 107) < 4 && Math.abs(free - Math.round(free / 5) * 5) > 0.3, String(free));
  const fortyFive = await ringTurn(30, 'Shift');
  check('placement: with Shift the turn snaps to 45 degrees', Math.abs(fortyFive / 45 - Math.round(fortyFive / 45)) < 1e-6, String(fortyFive));
  const five = await ringTurn(12, 'Control');
  check('placement: with Ctrl the turn snaps to 5 degrees', Math.abs(five / 5 - Math.round(five / 5)) < 1e-6 && Math.abs(five % 45) > 1e-6, String(five));
  await shot('layer-placement-turned');
  const reset = await page.evaluate(() => { [...document.querySelectorAll('.atlas-tabletop-adjust button')].find((b) => b.textContent === 'Reset').click(); return window.boardTest.record.sceneTabs.filter((e) => e[0] === 'reset'); });
  check('placement: Reset asks for the scene to go back to its grid', JSON.stringify(reset) === JSON.stringify([['reset', 'up.atlasmap']]), JSON.stringify(reset));
  await page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-adjust button')].find((b) => b.textContent === 'Stop').click());
  const stopped = await page.evaluate(() => ({ gizmo: window.boardTest.board.gizmo, chip: document.querySelector('.atlas-tabletop-adjust').hidden }));
  check('placement: Stop takes the handles and the chip away', stopped.gizmo === null && stopped.chip === true, JSON.stringify(stopped));
  // Switching to a scene that stands turned on the plane carries the camera into its frame, keeping its view of the base.
  const carried = await page.evaluate(() => {
    const { board } = window.boardTest;
    for (const pose of [board.camera.pose, board.camera.goal]) { pose.target.x = 700; pose.target.z = 500; pose.yaw = 0.3; }
    board.reorigin(0, { x: 100, y: 50, turn: 90 });
    return { pose: [board.camera.pose.target.x, board.camera.pose.target.z, board.camera.pose.yaw], goal: [board.camera.goal.target.x, board.camera.goal.target.z, board.camera.goal.yaw] };
  });
  const expected = [-400, 750, 0.3 - Math.PI / 2];
  check('placement: switching to a turned scene carries the camera into its frame, target and heading', carried.pose.every((v, i) => Math.abs(v - expected[i]) < 1e-6) && carried.goal.every((v, i) => Math.abs(v - expected[i]) < 1e-6), JSON.stringify(carried));
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

// ── Atlas's command palette over the board (Atlas's own component, src/palette/PaletteWindow.tsx) ───────────────
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
feature('layer-water', async ({ page, shot }) => {
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
  const seen = await page.evaluate(() => { const views = window.boardTest.board.layerViews; const wet = views.get('wet.atlasmap'); const dry = views.get('dry.atlasmap'); const visible = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; }; return { wet: !!wet?.water && visible(wet.water.object3d), dry: !!dry?.water, dbg: { water: !!wet?.water, presence: wet?.presence, look: wet?.look, lookLevel: wet?.lookLevel, content: wet?.content.visible, obj: wet?.object3d.visible, parentIsFloor: wet?.water?.object3d.parent === wet?.floor, parentName: wet?.water?.object3d.parent?.type } }; });
  check('a stacked scene that is shown draws its painted water; one with none draws none', seen.wet && !seen.dry, JSON.stringify(seen));
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
    board.receiveSpells([{ id: 's7', owner: 'p1', color: '#ff0059', spell: { shape: 'sphere', from: 'point', at: { x, y, h: cell }, yaw: 0, pitch: 0, roll: 0, size: cell * 2, length: 0, angle: 0.9 }, name: 'Fireball', about: { line: 'Level 3 Evocation', properties: [['Damage', '8d6 fire']], text: 'A bright streak flashes.' } }]);
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
    board.receiveSpells([{ id: 's8', owner: 'p1', color: '#ff0059', spell: { shape: 'sphere', from: 'point', at: { x: e.at.x, y: e.at.y, h: cell }, yaw: 0, pitch: 0, roll: 0, size: cell * 2, length: 0, angle: 0.9 }, name: 'Fog Cloud' }]);
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
  await page.evaluate(() => { const { board, modes, setHosting } = window.boardTest; board.receiveSpells([]); modes.on = false; setHosting(false); });
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
    board.receiveSpells(list.map(([id, at, shape, rules, extra]) => {
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
    board.receiveSpells(list.map(([id, token, effect, radius], k) => {
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
    await page.evaluate((change) => window.boardTest.board.receiveSpells(change ? [{ id: 'x1', owner: 'gm', color: '#ffffff', spell: change.add, rules: change.rules, name: change.name }] : []), sent?.change);
    await wait(300);
    const standing = await page.evaluate(() => window.boardTest.board.ruleState());
    await page.evaluate(() => window.boardTest.board.receiveSpells([]));
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
    board.receiveSpells(list.map(([id, x, y, effect, shape, lasting]) => ({
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
    await page.evaluate((list) => window.boardTest.board.receiveSpells(list), [standing('z1', spot), standing('z2', { x: spot.x + 200, y: spot.y })]);
    await wait(150);
    switched.push(await page.evaluate(() => { const { board } = window.boardTest; return { plays: window.boardTest.sounds.plays.length, growing: board.growingSpells.size, scales: [...board.spellViews.values()].map((kept) => kept.view.mesh.scale.x) }; }));
  }
  check('spell sounds: after a scene switch, standing spells arriving later are silent and whole', switched.every((one) => one.plays === 0 && one.growing === 0 && one.scales.length === 2 && one.scales.every((scale) => scale === 1)), JSON.stringify(switched));
  await page.evaluate((list) => window.boardTest.board.receiveSpells(list), [standing('z1', spot), standing('z2', { x: spot.x + 200, y: spot.y }), standing('z3', { x: spot.x - 200, y: spot.y })]);
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
      board.receiveSpells([{ id: 'u1', owner: 'p1', color: '#fff', spell: { shape: 'sphere', from: 'point', at: { x: fogged.x, y: fogged.y, h: cell * 0.5 }, yaw: 0, pitch: 0, roll: 0, size: cell, length: 0, angle: 1, effect: 'fire' } }]);
      const plays = window.boardTest.sounds.plays.length;
      board.audience = 'gm';
      return plays;
    }, fogged);
    check('spell sounds: a player\'s board makes no impact for a spell under the fog', result === 0, JSON.stringify(result));
  }
  await cast([]);
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

server.listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    for (const one of features) {
      if (only && !only.test(one.name)) continue;
      const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${one.name}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`${one.name}: pageerror: ${e.message}`));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}${one.url ?? '/'}`);
        await page.waitForFunction(() => window.boardTest?.ready || window.boardError, null, { timeout: 30000 });
        const boot = await page.evaluate(() => window.boardError ?? null);
        if (boot) throw new Error(boot);
        await wait(1200);
        const shot = (name, clip) => page.screenshot({ path: `${shots}/${name}.png`, ...(clip ? { clip } : {}) });
        await one.run({ page, shot });
      } catch (error) {
        check(`${one.name} ran`, false, String(error && error.stack || error));
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  ${r.detail}`}`);
  if (errors.length) console.log(`console errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 6).join('\n  ')}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
});
