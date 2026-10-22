// Usage: node harness/playerBoard-test.cjs <bundle dir> <screenshot dir>, after bundling harness/playerBoard.ts as playerBoard.js
// and copying harness/board.html as playerBoard.html with board.js swapped for playerBoard.js (see README).
// Drives Tabletop's player board as Connect mounts it, with real mouse input, and checks what it asked of Connect.
const { chromium } = require('C:/Users/joaoo/2075/atlas-vtt-connect/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const shots = process.argv[3];
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/playerBoard.html'));
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }); res.end(data); });
});
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

server.listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.playerTest?.ready || window.boardError, null, { timeout: 30000 });
    const boot = await page.evaluate(() => window.boardError ?? null);
    if (boot) throw new Error(boot);
    await wait(2500);
    const record = () => page.evaluate(() => JSON.parse(JSON.stringify(window.playerTest.record)));
    const project = (x, y, h = 0) => page.evaluate(([x, y, h]) => window.playerTest.project(x, y, h), [x, y, h]);
    const state = () => page.evaluate(() => {
      const b = window.playerTest.board;
      const scene = b.scene;
      const named = (name) => scene.getObjectByName(name);
      const visibleTokens = [...b.tokens.values()].filter((entry) => entry.piece.object3d.visible).map((entry) => entry.token.id);
      return {
        toolbarHidden: !!b.container.querySelector('.atlas-tabletop-toolbar, .atlas-tabletop-row')?.closest('[hidden]') || [...b.container.querySelectorAll('button')].every((button) => button.offsetParent === null),
        buttons: [...b.container.querySelectorAll('button')].filter((button) => button.offsetParent !== null).map((button) => button.getAttribute('aria-label')),
        visibleTokens,
        walls: b.walls.object3d.children.length,
        doors: b.walls.doors.size,
        background: !!b.map?.background,
        audience: b.audience,
        darkness: named('darkness')?.children.length ?? -1,
      };
    });

    // 1. Mounted as Connect mounts it: the scene, its walls, door and light; no GM button anywhere.
    const first = await state();
    check('a player\'s board: player audience, no toolbar buttons (Connect\'s toolbar drives it)', first.audience === 'player' && first.buttons.length === 0, first);
    check('the scene\'s tokens, and Tabletop\'s walls and door from the extras', first.visibleTokens.length === 2 && first.walls > 0 && first.doors === 1, first);
    check('the map image held back is left out until it arrives', first.background === false, first);
    await page.evaluate(() => window.playerTest.deliver());
    await wait(1500);
    check('once it arrives the board loads it', (await state()).background === true, await state());
    await page.screenshot({ path: `${shots}/player-1-board.png` });

    // 2. Moves: the player's own token can be dragged, the other cannot.
    const mine = await project(385, 385);
    await page.mouse.move(mine.x, mine.y);
    await page.mouse.down();
    // Two squares west, away from the other token (and out of the way of the camera's sight of it).
    for (let i = 1; i <= 10; i++) { const to = await project(385 - i * 14, 385); await page.mouse.move(to.x, to.y); await wait(16); }
    await page.mouse.up();
    await wait(300);
    const theirs = await project(525, 385);
    await page.mouse.move(theirs.x, theirs.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { const to = await project(525, 385 + i * 14); await page.mouse.move(to.x, to.y); await wait(16); }
    await page.mouse.up();
    await wait(300);
    const moved = (await record()).moves;
    check('dragging the player\'s own token sends one move; another\'s is not theirs to move', moved.length === 1 && moved[0][0] === 'mine', moved);

    // 3. Hover tells Connect which token is under the pointer.
    await page.mouse.move(theirs.x, theirs.y);
    await wait(200);
    check('hovering a token tells Connect (for its hover card)', (await record()).hovers.some((h) => h[0] === 'theirs'), (await record()).hovers.slice(-3));

    // 4. Ping: a click with the Ping tool.
    await page.evaluate(() => window.playerTest.handle.selectTool('ping'));
    const spot = await project(700, 560);
    await page.mouse.click(spot.x, spot.y);
    await wait(200);
    const pings = (await record()).pings;
    check('a click with the Ping tool pings the ground point', pings.length === 1 && Math.abs(pings[0][0] - 700) < 20 && Math.abs(pings[0][1] - 560) < 20, pings);

    // 5. Template: a drag places one; Connect's list draws it; a tap on it takes it off.
    await page.evaluate(() => window.playerTest.handle.selectTemplateShape('circle'));
    const a = await project(420, 700);
    const b = await project(490, 700);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
    await page.mouse.up();
    await wait(200);
    const added = (await record()).templates;
    check('a drag with the Template tool asks for a template', added.length === 1 && added[0].add?.shape === 'circle', added);
    await page.evaluate(() => window.playerTest.handle.receiveTemplates('s1', [{ id: 't1', owner: 'me', shape: 'circle', start: { x: 420, y: 700 }, end: { x: 490, y: 700 }, color: '#ff9f2e' }]));
    check('Connect\'s templates are drawn, and the toolbar is told one is the player\'s', await page.evaluate(() => window.playerTest.board.marks.object3d.children[0].children.length === 1 && window.playerTest.handle.toolState().ownTemplates === true));
    await page.mouse.click(a.x, a.y);
    await wait(200);
    check('a tap on the player\'s own template takes it off', JSON.stringify((await record()).templates.at(-1)) === JSON.stringify({ remove: 't1' }), (await record()).templates);

    // 6. Laser: a stroke sends points, the last batch lifted.
    await page.evaluate(() => window.playerTest.handle.selectTool('laser'));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(a.x + i * 12, a.y - i * 4); await wait(20); }
    await page.mouse.up();
    await wait(200);
    const lasers = (await record()).lasers;
    check('a laser stroke sends its points, the last batch lifted, in the player\'s colour', lasers.length >= 1 && lasers.at(-1)[1] === true && lasers.every((l) => l[3] === '#ff9f2e'), lasers);

    // 7. Others' pings and lasers are drawn and fade.
    await page.evaluate(() => {
      window.playerTest.handle.receivePing({ from: 'you', sceneId: 's1', x: 600, y: 600, color: '#00a9ff' });
      window.playerTest.handle.receiveLaser({ from: 'you', sceneId: 's1', points: [{ x: 300, y: 600 }, { x: 400, y: 620 }], lifted: true, color: '#00a9ff' });
    });
    check('others\' pings and lasers are drawn', await page.evaluate(() => window.playerTest.board.marks.animating));
    await wait(2500);
    check('and fade away', await page.evaluate(() => !window.playerTest.board.marks.animating));

    // 8. A readable pin opens its note through Connect.
    await page.evaluate(() => window.playerTest.handle.selectTool('move'));
    await wait(100);
    const pin = await project(700, 700, 20);
    await page.mouse.click(pin.x, pin.y);
    await wait(200);
    check('clicking a readable pin asks Connect for its note', (await record()).pins.includes('pin-1'), (await record()).pins);

    // 9. The GM's 3D view: the button glides there.
    await page.evaluate(() => window.playerTest.handle.setGmCamera({ sceneId: 's1', eye: { x: 700, y: 900, z: 1400 }, target: { x: 700, y: 0, z: 500 } }));
    await page.evaluate(() => window.playerTest.handle.followGm());
    await wait(1500);
    const eye = await page.evaluate(() => { const p = window.playerTest.board.view.position; return [p.x, p.y, p.z]; });
    check('GM view glides the camera to the GM\'s 3D view', Math.abs(eye[0] - 700) < 5 && Math.abs(eye[1] - 900) < 5 && Math.abs(eye[2] - 1400) < 5, eye);
    check('the toolbar knows the GM view is there', await page.evaluate(() => window.playerTest.handle.toolState().gmView === true));

    // 9b. A GM camera of a scene not shown yet is kept, and used once that scene comes.
    await page.evaluate(() => {
      const t = window.playerTest;
      t.handle.setGmCamera({ sceneId: 's2', eye: { x: 100, y: 800, z: 900 }, target: { x: 100, y: 0, z: 100 } });
      t.handle.setScene({ ...t.scene, sceneId: 's2' });
    });
    await wait(300);
    check('a GM view sent before its scene is used once the scene comes', await page.evaluate(() => window.playerTest.handle.toolState().gmView === true));
    await page.evaluate(() => { const t = window.playerTest; t.handle.setScene(t.scene); });
    await wait(300);

    // 10. Darkness: Connect's darkness op is laid flat as black ground, not fog.
    await page.evaluate(() => {
      const t = window.playerTest;
      t.handle.setScene({ ...t.scene, fog: { ...t.scene.fog, 'atlas-lighting-darkness': { type: 'rectangle', erase: false, order: Number.MAX_SAFE_INTEGER, x: 0, y: 700, width: 600, height: 300 } } });
    });
    await wait(800);
    check('the darkness is drawn as black ground', (await state()).darkness === 1, await state());
    await page.screenshot({ path: `${shots}/player-2-dark.png` });

    // 11. Extras gone: no walls.
    await page.evaluate(() => window.playerTest.handle.setExtras(null));
    await wait(500);
    check('extras taken away take the walls with them', (await state()).doors === 0, await state());

    // 11b. The GM clears the scene: the board shows nothing, then the next scene again.
    await page.evaluate(() => window.playerTest.handle.setScene(null));
    await wait(300);
    check('no scene: the board shows nothing', await page.evaluate(() => window.playerTest.board.canvas.style.visibility === 'hidden'));
    await page.evaluate(() => { const t = window.playerTest; t.handle.setScene(t.scene); });
    await wait(500);
    check('a scene again: the board shows it', await page.evaluate(() => window.playerTest.board.canvas.style.visibility !== 'hidden'));

    // 11c. Dice: Connect asks for a throw; the dice tumble on this board, and the landed values go back once, the sheet unchanged.
    const sheet = { tokenId: 'mine', roll: { ability: 'Longsword', formula: '2d6+3' } };
    const thrown = await page.evaluate((sheet) => {
      const t = window.playerTest;
      return { available: t.handle.diceAvailable === true, ok: t.handle.throwDice({ dice: { d6: 2 }, modifier: 3, label: 'Longsword', sheet }), busy: !!t.board.dice?.busy };
    }, sheet);
    check('the board has dice, and a throw from Connect starts them rolling', thrown.available && thrown.ok && thrown.busy, thrown);
    await wait(250);
    await page.screenshot({ path: `${shots}/player-3-dice-rolling.png` });
    let rethrown = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.waitForFunction(() => !window.playerTest.board.dice.busy, null, { timeout: 90000 });
      await wait(300);
      if ((await record()).diceResults.length > 0) break;
      // A die caught on an edge: clicked where it lies, it is thrown again.
      const caught = await page.evaluate(() => {
        const t = window.playerTest;
        const b = t.board;
        b.view.updateMatrixWorld();
        const rect = b.canvas.getBoundingClientRect();
        for (const mesh of b.dice.object3d.children) {
          if (!t.handle.dice.waitsOn(mesh.userData.dieId)) continue;
          const ndc = mesh.getWorldPosition(mesh.position.clone()).project(b.view);
          return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height, prompt: document.querySelector('.atlas-tabletop-dice-prompt').textContent };
        }
        return null;
      });
      if (!caught) break;
      if (rethrown === 0) await page.screenshot({ path: `${shots}/player-3b-dice-caught.png` });
      await page.mouse.click(caught.x, caught.y);
      rethrown++;
      await wait(200);
    }
    await page.screenshot({ path: `${shots}/player-4-dice-landed.png` });
    const landed = await record();
    const sent = landed.diceResults;
    check('the landed roll goes to Connect once: two d6 read clean, the modifier, label and sheet as asked', sent.length === 1 && sent[0].rolls.length === 2
      && sent[0].rolls.every((roll) => roll.die === 'd6' && roll.max === 6 && Number.isInteger(roll.value) && roll.value >= 1 && roll.value <= 6)
      && sent[0].modifier === 3 && sent[0].label === 'Longsword' && JSON.stringify(sent[0].sheet) === JSON.stringify(sheet) && !('total' in sent[0]), { sent, rethrown });
    await wait(1500);
    const after = await page.evaluate(() => ({ busy: window.playerTest.board.dice.busy, prompt: document.querySelector('.atlas-tabletop-dice-prompt').hidden, sends: window.playerTest.record.diceResults.length }));
    check('then the dice lie still (no physics), the line is gone, and nothing more is sent', !after.busy && after.prompt && after.sends === 1, after);
    const changed = await page.evaluate(() => {
      const t = window.playerTest;
      t.handle.throwDice({ dice: { d20: 1 }, modifier: 0 });
      t.handle.setScene({ ...t.scene, sceneId: 's3' });
      return { dice: t.board.dice.object3d.children.length };
    });
    await wait(2500);
    check('a scene change clears the dice and the roll in play is never sent', changed.dice === 0 && (await record()).diceResults.length === 1, { changed, sends: (await record()).diceResults.length });
    await page.evaluate(() => { const t = window.playerTest; t.handle.setScene(t.scene); });
    await wait(300);

    // 12. Disposed: the WebGL context is let go.
    await page.evaluate(() => window.playerTest.handle.dispose());
    check('dispose leaves no canvas behind', await page.evaluate(() => document.querySelectorAll('#board canvas').length === 0));
  } catch (error) {
    check('harness ran', false, String(error && error.stack || error));
  }
  check('no console errors', errors.length === 0, errors);
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.ok ? '' : `  ${JSON.stringify(result.detail)}`}`);
  console.log(`${results.filter((x) => x.ok).length}/${results.length} passed`);
  await browser.close();
  server.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
});
