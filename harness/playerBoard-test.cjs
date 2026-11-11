// Usage: node harness/playerBoard-test.cjs <bundle dir> <screenshot dir>, after bundling harness/playerBoard.ts as playerBoard.js
// and copying harness/board.html as playerBoard.html with board.js swapped for playerBoard.js (see README).
// Drives Tabletop's player board as Connect mounts it, with real mouse input, and checks what it asked of Connect.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()} ${m.location().url ?? ''}`); });
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

    // 11c. Dice: Connect asks for a roll; its dice are laid on this board at rest, the player drags one to throw it and
    // throws the other with Throw all, and the landed values go back once, the sheet unchanged.
    const sheet = { tokenId: 'mine', roll: { ability: 'Longsword', formula: '2d6+3' } };
    const thrown = await page.evaluate((sheet) => {
      const t = window.playerTest;
      const ok = t.handle.throwDice({ dice: { d6: 2 }, modifier: 3, label: 'Longsword', sheet });
      const line = document.querySelector('.atlas-tabletop-dice-prompt');
      return { available: t.handle.diceAvailable === true, ok, busy: !!t.board.dice?.busy, dice: t.board.dice?.object3d.children.length, prompt: line.hidden ? null : line.textContent };
    }, sheet);
    check('the board has dice, and a roll from Connect lays them on the table to be thrown', thrown.available && thrown.ok && !thrown.busy && thrown.dice === 2 && /Drag a die/.test(thrown.prompt ?? ''), thrown);
    await wait(300);
    await page.screenshot({ path: `${shots}/player-3-dice-laid.png` });
    const dieOnScreen = (index) => page.evaluate((index) => {
      const b = window.playerTest.board;
      b.view.updateMatrixWorld();
      const rect = b.canvas.getBoundingClientRect();
      const mesh = b.dice.object3d.children[index];
      const ndc = mesh.getWorldPosition(mesh.position.clone()).project(b.view);
      return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
    }, index);
    const grab = await dieOnScreen(0);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(grab.x + i * 4, grab.y - i * 20); await wait(16); }
    await page.mouse.up();
    check('a die dragged and let go is thrown', await page.evaluate(() => window.playerTest.board.dice.busy));
    await wait(250);
    await page.screenshot({ path: `${shots}/player-3b-dice-rolling.png` });
    let rethrown = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.waitForFunction(() => !window.playerTest.board.dice.busy, null, { timeout: 90000 });
      await wait(300);
      if ((await record()).diceResults.length > 0) break;
      // The die still laid, or one caught on an edge: Throw all on the line throws it.
      await page.locator('.atlas-tabletop-dice-prompt__throw').click();
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
    const after = await page.evaluate(() => ({ busy: window.playerTest.board.dice.busy, prompt: document.querySelector('.atlas-tabletop-dice-prompt').textContent, sends: window.playerTest.record.diceResults.length }));
    check('then the dice lie still (no physics), the line says what was sent, and nothing more is sent', !after.busy && after.prompt.includes('Sent to the GM') && after.sends === 1, after);

    // 11d. A die caught on an edge (its first reading forced caught): the line asks for it, a click on it throws it
    // again, and only its clean reading goes.
    await page.evaluate(() => {
      const t = window.playerTest;
      t.handle.throwDice({ dice: { d20: 1 }, modifier: 0 });
      const table = t.board.dice;
      const settled = table.onSettled;
      let forced = false;
      table.onSettled = (id, reading) => {
        if (forced) return settled(id, reading);
        forced = true;
        return settled(id, { caught: true, face: null, confidence: 0 });
      };
    });
    const caughtDie = () => page.evaluate(() => {
      const t = window.playerTest;
      const b = t.board;
      b.view.updateMatrixWorld();
      const rect = b.canvas.getBoundingClientRect();
      for (const mesh of b.dice.object3d.children) {
        if (!t.handle.dice.waitsOn(mesh.userData.dieId)) continue;
        const ndc = mesh.getWorldPosition(mesh.position.clone()).project(b.view);
        const line = document.querySelector('.atlas-tabletop-dice-prompt');
        return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height, prompt: line.hidden ? null : line.textContent };
      }
      return null;
    });
    // The laid d20, clicked, is tossed; its first landing is caught.
    const laidD20 = await caughtDie();
    await page.mouse.click(laidD20.x, laidD20.y);
    await wait(200);
    await page.waitForFunction(() => !window.playerTest.board.dice.busy, null, { timeout: 90000 });
    await wait(300);
    const caught = await caughtDie();
    check('a caught die: the line over the board says so, and nothing is sent', caught !== null && /d20/.test(caught.prompt ?? '') && (await record()).diceResults.length === 1, caught);
    await page.screenshot({ path: `${shots}/player-5-dice-caught.png` });
    let clicks = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const die = attempt === 0 ? caught : await caughtDie();
      if (!die) break;
      await page.mouse.click(die.x, die.y);
      clicks++;
      await wait(200);
      await page.waitForFunction(() => !window.playerTest.board.dice.busy, null, { timeout: 90000 });
      await wait(300);
      if ((await record()).diceResults.length > 1) break;
    }
    const rethrownRoll = (await record()).diceResults;
    check('a click on the caught die throws it again; its clean reading alone is sent, once', clicks >= 1 && rethrownRoll.length === 2 && rethrownRoll[1].rolls.length === 1
      && rethrownRoll[1].rolls[0].die === 'd20' && Number.isInteger(rethrownRoll[1].rolls[0].value) && rethrownRoll[1].rolls[0].value >= 1 && rethrownRoll[1].rolls[0].value <= 20, { clicks, sent: rethrownRoll.slice(1) });
    const changed = await page.evaluate(() => {
      const t = window.playerTest;
      t.handle.throwDice({ dice: { d20: 1 }, modifier: 0 });
      t.handle.dice.throwPending({ dx: 0, dy: -200, ms: 120 });
      t.handle.setScene({ ...t.scene, sceneId: 's3' });
      return { dice: t.board.dice.object3d.children.length };
    });
    await wait(2500);
    check('a scene change clears the dice and the roll in play is never sent', changed.dice === 0 && (await record()).diceResults.length === 2, { changed, sends: (await record()).diceResults.length });
    await page.evaluate(() => { const t = window.playerTest; t.handle.setScene(t.scene); });
    await wait(300);

    // 11b. The GM's tint, a turned door, and a scene stacked above, all from the extras.
    await page.evaluate(() => window.playerTest.handle.setExtras(window.playerTest.extras));
    await wait(2500);
    const plain = await page.evaluate(() => { const b = window.playerTest.board; return { sky: b.hemisphere.color.getHexString(), sun: b.sun.color.getHexString(), flip: b.walls.doors.get('d1')?.flip ?? null }; });
    const stacked = await page.evaluate(async () => {
      const t = window.playerTest;
      const LAYER = 'L'.repeat(43);
      const canvas = document.createElement('canvas');
      canvas.width = 1400; canvas.height = 1000;
      const context = canvas.getContext('2d');
      context.fillStyle = '#4466aa'; context.fillRect(0, 0, 1400, 1000);
      t.files.set(LAYER, canvas.toDataURL('image/png'));
      t.handle.setExtras({
        ...t.extras, tint: '#ff8844',
        walls: t.extras.walls.map((wall) => (wall.id === 'd1' ? { ...wall, door: { ...wall.door, hinge: true, side: true } } : wall)),
        layers: [{ id: 'layer-1', elevation: 3, stands: { x: 0, y: 0, turn: 0 }, image: LAYER, grid: { size: 70, offsetX: 0, offsetY: 0 },
          walls: [{ id: 'lw', type: 'solid', p1: { x: 280, y: 280 }, p2: { x: 630, y: 280 }, height: null, material: null }, { id: 'ld', type: 'door', p1: { x: 630, y: 280 }, p2: { x: 700, y: 280 }, height: null, material: null, door: { open: false, swing: 'left', prop: null, hinge: true } }],
          lights: [], props: [], fogHeight: null, wallThickness: null }],
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const b = t.board;
      const view = [...b.layerViews.values()][0];
      return { sky: b.hemisphere.color.getHexString(), sun: b.sun.color.getHexString(), flip: b.walls.doors.get('d1')?.flip ?? null, layers: b.layerViews.size, wallsAbove: view ? view.object3d.children.length : 0, y: view ? view.object3d.position.y : null };
    });
    check('the GM\'s tint colours the daylight of a player\'s board', stacked.sky !== plain.sky && stacked.sun !== plain.sun && parseInt(stacked.sky.slice(0, 2), 16) > parseInt(stacked.sky.slice(4, 6), 16), { plain, stacked });
    check('a door the GM turned is hung the way they turned it on the player\'s board', plain.flip && plain.flip.hinge === false && stacked.flip && stacked.flip.hinge === true && stacked.flip.side === true, { plain: plain.flip, stacked: stacked.flip });
    check('a scene stacked above is drawn on the player\'s board, with its walls', stacked.layers === 1 && stacked.wallsAbove > 0, stacked);
    await page.screenshot({ path: `${shots}/player-11b-layers.png` });
    const cleared = await page.evaluate(async () => {
      const t = window.playerTest;
      t.handle.setExtras(t.extras);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const b = t.board;
      return { sky: b.hemisphere.color.getHexString(), flip: b.walls.doors.get('d1')?.flip ?? null, layers: b.layerViews.size };
    });
    check('without them again the tint, the turn and the stacked scene are gone', cleared.sky === plain.sky && cleared.flip && cleared.flip.hinge === false && cleared.layers === 0, cleared);

    {
      // 11b2. Names: none shown on the board; a click on a token shows its name, large; anything done next hides it.
      const nameState = () => page.evaluate(() => {
        const b = window.playerTest.board;
        const shownNames = [...b.tokens.values()].filter((entry) => entry.playerLabels.isNamed || entry.labels.isNamed).map((entry) => entry.token.id);
        return { named: b.namedToken, shownNames };
      });
      await page.evaluate(() => window.playerTest.handle.setGmCamera({ sceneId: 's1', eye: { x: 455, y: 700, z: 900 }, target: { x: 455, y: 0, z: 385 } }));
      await page.evaluate(() => window.playerTest.handle.followGm());
      await wait(1500);
      const none = await nameState();
      check('no name tags on the 3D board', none.named === null && none.shownNames.length === 0, none);
      const goblin = await project(525, 385, 10);
      await page.mouse.click(goblin.x, goblin.y);
      await wait(300);
      const clicked = await nameState();
      check('a click on a token shows its name', clicked.named === 'theirs' && clicked.shownNames.join() === 'theirs', clicked);
      await page.screenshot({ path: `${shots}/player-11b2-name.png` });
      await page.mouse.wheel(0, 40);
      await wait(300);
      const after = await nameState();
      check('anything done next (a scroll) hides it again', after.named === null && after.shownNames.length === 0, after);
    }
    {
    // 11c. Spells through the token's eyes: the toolbar, a cone from the caster aimed at the Goblin, its confirmation, the
    // cast sent; the scene's spells drawn and what they hit outlined; a cube at a point moved and turned by its handles; a
    // wall no longer than set.
    const spellState = () => page.evaluate(() => {
      const b = window.playerTest.board;
      const bar = b.container.querySelector('.atlas-tabletop-spellbar');
      const cross = b.container.querySelector('.atlas-tabletop-crosshair');
      return {
        seeing: b.seeingFrom, cross: !!cross && !cross.hidden, bar: !!bar && !bar.hidden, stage: bar?.dataset.stage ?? null,
        text: bar?.querySelector('.atlas-tabletop-spellbar__text')?.textContent ?? '', hits: b.spellHitIds(),
        views: b.spellViews.size, preview: !!b.spellPreview, gizmo: !!b.spellGizmo,
      };
    });
    const press = (label) => page.evaluate((label) => {
      const buttons = window.playerTest.board.container.querySelectorAll('.atlas-tabletop-spellbar button');
      const button = [...buttons].find((each) => each.offsetParent !== null && (each.getAttribute('aria-label') ?? '').replace(/ \((F|Esc)\)$/, '') === label);
      if (!button) return false;
      button.click();
      return true;
    }, label);
    const middle = await page.evaluate(() => { const r = window.playerTest.board.canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const place = async () => {
      if (await press('Place')) return;
      await page.mouse.click(middle.x, middle.y);
    };
    const field = (name, value) => page.evaluate(([name, value]) => {
      const input = window.playerTest.board.container.querySelector(`[data-spell-field="${name}"]`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }, [name, value]);
    const look = () => page.evaluate(() => { const eye = window.playerTest.board.eye; eye.yaw = -Math.PI / 2; eye.pitch = -0.15; eye.fresh = true; });
    await page.evaluate(() => { const t = window.playerTest; t.handle.selectTool('move'); t.handle.seeFrom('mine', false); });
    await look();
    await wait(600);
    const eyes = await spellState();
    check('through the eyes: the crosshair and the spell toolbar show', eyes.seeing === 'mine' && eyes.cross && eyes.bar && eyes.stage === 'idle', eyes);
    // A click holds the mouse to look; F then opens the spell's choice (no cursor to click with), still through the eyes.
    await page.mouse.click(middle.x, middle.y);
    await wait(300);
    const locked = await page.evaluate(() => window.playerTest.board.pointerLocked);
    await page.keyboard.press('f');
    await wait(300);
    const formed = await spellState();
    const freed = await page.evaluate(() => window.playerTest.board.pointerLocked);
    check('with the mouse held, F opens the spell toolbar\'s choice and lets go of the mouse, still through the eyes', locked && formed.stage === 'form' && formed.seeing === 'mine' && !freed, { locked, formed, freed });
    await page.screenshot({ path: `${shots}/player-11c-form.png` });
    await press('Cone');
    await press('From me');
    await field('size', '4');
    await look();
    await press('Aim');
    await wait(800);
    const aiming = await spellState();
    check('aiming a cone from the caster: it is drawn, and the Goblin it reaches is outlined red', aiming.stage === 'aim' && aiming.preview && aiming.hits.includes('theirs') && !aiming.hits.includes('mine') && /hits 1: Goblin/.test(aiming.text), aiming);
    await page.screenshot({ path: `${shots}/player-11c-aim.png` });
    await place();
    await wait(300);
    const confirming = await spellState();
    check('the confirmation names the cone and what it hits', confirming.stage === 'confirm' && /Cone, length 4/.test(confirming.text) && /Goblin/.test(confirming.text), confirming);
    await press('Cast');
    await wait(200);
    const castSent = await record();
    const cast = castSent.spells.at(-1)?.add;
    check('Cast sends the cone from the caster, its tip at their eyes and its length in pixels', cast && cast.shape === 'cone' && cast.from === 'self' && Math.abs(cast.size - 280) < 1e-6 && cast.caster === 'mine' && Math.abs(cast.at.x - 385) < 1 && Math.abs(cast.at.y - 385) < 1 && cast.at.h > 0, cast);
    const after = await spellState();
    check('after casting, the toolbar is back at rest and the preview gone', after.bar && after.stage === 'idle' && !after.preview, after);
    await page.evaluate((spell) => window.playerTest.handle.receiveSpells('s1', [{ id: 'sp1', owner: 'me', color: '#3366ff', spell }]), cast);
    await wait(500);
    const shownSpell = await spellState();
    check('the scene\'s spells are drawn and what they hit stays outlined', shownSpell.views === 1 && shownSpell.hits.includes('theirs'), shownSpell);
    check('Clear my spells shows for the caster\'s own', await press('Clear my spells') && (await record()).spells.some((change) => change.clear === true));

    // A cube at a point: its handles move it (the green arrow, up) and turn it (the green ring, round the vertical).
    await press('Cast a spell');
    await press('Cube');
    await press('At a point');
    await look();
    await press('Aim');
    await wait(500);
    await place();
    await wait(400);
    const adjusting = await spellState();
    check('a cube at a point: then its handles show round it', adjusting.stage === 'adjust' && adjusting.gizmo, adjusting);
    await page.screenshot({ path: `${shots}/player-11c-gizmo.png` });
    const handleAt = (local) => page.evaluate((local) => {
      const b = window.playerTest.board;
      const g = b.spellGizmo.object3d;
      g.updateMatrixWorld(true);
      const point = g.localToWorld(g.position.clone().set(local[0], local[1], local[2])).project(b.view);
      const r = b.canvas.getBoundingClientRect();
      return { x: r.left + ((point.x + 1) / 2) * r.width, y: r.top + ((1 - point.y) / 2) * r.height };
    }, local);
    const before = await page.evaluate(() => { const s = window.playerTest.board.spellPreview.spell; return { h: s.at.h, yaw: s.yaw }; });
    const arrow = await handleAt([0, 0.7, 0]);
    await page.mouse.move(arrow.x, arrow.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(arrow.x, arrow.y - i * 12);
    await page.mouse.up();
    await wait(200);
    const lifted = await page.evaluate(() => window.playerTest.board.spellPreview.spell.at.h);
    check('dragging the up arrow lifts it, by quarter squares', lifted > before.h + 1 && Math.abs(((lifted - before.h) / 17.5) - Math.round((lifted - before.h) / 17.5)) < 1e-6, { before: before.h, lifted });
    const ring = await handleAt([0.884, 0, -0.884]);
    const ringFar = await handleAt([0.884, 0, 0.884]);
    await page.mouse.move(ring.x, ring.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(ring.x + ((ringFar.x - ring.x) * i) / 8, ring.y + ((ringFar.y - ring.y) * i) / 8);
    await page.mouse.up();
    await wait(200);
    const turned = await page.evaluate(() => window.playerTest.board.spellPreview.spell.yaw);
    const turnBy = Math.atan2(Math.sin(turned - before.yaw), Math.cos(turned - before.yaw));
    check('dragging the ring round the vertical turns it, by 15 degrees', Math.abs(turnBy) > 0.2 && Math.abs(turnBy / (Math.PI / 12) - Math.round(turnBy / (Math.PI / 12))) < 1e-3, { before: before.yaw, turned, turnBy });
    await press('Next');
    await wait(200);
    check('Next takes the handles away', !(await spellState()).gizmo, await spellState());
    await press('Cast');
    const cube = (await record()).spells.at(-1)?.add;
    check('the cube cast is the one moved and turned', cube && cube.shape === 'cube' && cube.from === 'point' && Math.abs(cube.at.h - lifted) < 1e-6 && Math.abs(cube.yaw - turned) < 1e-6, cube);

    // A wall: two points, the second no farther than the longest set.
    await press('Cast a spell');
    await press('Wall');
    await field('longest', '1');
    await look();
    await press('Aim');
    await wait(400);
    await place();
    await page.evaluate(() => { const eye = window.playerTest.board.eye; eye.yaw = -Math.PI / 2 + 0.9; });
    await wait(600);
    await place();
    await wait(300);
    await press('Cast');
    fs.writeFileSync(path.join(shots, 'spells.json'), JSON.stringify((await record()).spells));
    const built = (await record()).spells.at(-1)?.add;
    const run = built && built.to ? Math.hypot(built.to.x - built.at.x, built.to.y - built.at.y) : -1;
    check('a wall cast by two points is no longer than its longest', built && built.shape === 'wall' && run > 0 && run <= 70 + 1e-6 && built.length === 280 && built.size === 70, { built, run });

    // Escape with the focus off the board (on a toolbar button, as after the eye button) leaves the eyes, and Connect is told.
    const toldBefore = (await record()).eyeChanged;
    await page.evaluate(() => window.playerTest.board.container.querySelector('.atlas-tabletop-spellbar button').focus());
    await page.keyboard.press('Escape');
    await wait(300);
    const left = await spellState();
    check('Escape leaves the eyes: the toolbar goes, Connect hears of it', left.seeing === null && !left.bar && !left.cross && (await record()).eyeChanged === toldBefore + 1, left);
    const sentNow = (await record()).spells.filter((change) => change.add).map((change, index) => ({ id: 'v' + index, owner: 'me', color: '#3366ff', spell: change.add }));
    await page.evaluate((list) => window.playerTest.handle.receiveSpells('s1', list), sentNow);
    await page.evaluate(() => window.playerTest.handle.setGmCamera({ sceneId: 's1', eye: { x: 385, y: 700, z: 900 }, target: { x: 450, y: 0, z: 385 } }));
    await page.evaluate(() => window.playerTest.handle.followGm());
    await wait(1500);
    await page.screenshot({ path: shots + '/player-11c-overview.png' });
    await page.evaluate(() => window.playerTest.handle.receiveSpells('s1', []));
    await wait(400);
    const gone = await spellState();
    check('with the spells gone, so are their lines', gone.hits.length === 0 && gone.views === 0, gone);

    // 11d. The GM asks the player's token for a spell: offered out of the eyes; Aim goes into them, straight to aiming
    // it as asked (no choice); Cast answers the ask. Decline turns another down.
    const about = { line: 'Level 3 Evocation (Sorcerer, Wizard)', properties: [['Range', '150 feet'], ['Area', '20 ft radius sphere'], ['Damage', '8d6 fire'], ['Save', 'Dexterity']], text: 'A bright streak flashes from you to a point you choose within range and then blossoms with a low roar into a **fiery** explosion.' };
    const fireball = { id: 'a1', tokenId: 'mine', ask: { name: 'Fireball', shape: 'sphere', from: 'point', size: 140, length: 0, effect: 'fire', about } };
    await page.evaluate((ask) => window.playerTest.handle.receiveSpells('s1', [], [ask]), fireball);
    await wait(300);
    const offered = await page.evaluate(() => {
      const bar = window.playerTest.board.container.querySelector('.atlas-tabletop-spellbar');
      return { seeing: window.playerTest.board.seeingFrom, shown: !!bar && !bar.hidden, ask: bar?.classList.contains('is-ask'), stage: bar?.dataset.stage, text: bar?.textContent ?? '' };
    });
    check('a spell the GM asks is offered out of the eyes, named, at the top', offered.seeing === null && offered.shown && offered.ask && offered.stage === 'ask' && /GM asks .*Fireball \(Sphere, radius 2 sq, at a point\)/.test(offered.text), offered);
    const card = () => page.evaluate(() => {
      const element = window.playerTest.board.container.querySelector('.atlas-tabletop-spellcard');
      return { shown: !!element && !element.hidden, folded: element?.classList.contains('is-folded') ?? false, text: element?.textContent ?? '', bold: element?.querySelector('strong')?.textContent ?? null };
    });
    const offeredCard = await card();
    check('the spell asked shows its words first, open: level line, properties, description (bold kept as bold, no markup)', offeredCard.shown && !offeredCard.folded && /Level 3 Evocation/.test(offeredCard.text) && /8d6 fire/.test(offeredCard.text) && /A bright streak/.test(offeredCard.text) && offeredCard.bold === 'fiery' && !/\*\*/.test(offeredCard.text), offeredCard);
    const noSearch = await page.evaluate(() => [...window.playerTest.board.container.querySelectorAll('button')].some((each) => each.getAttribute('aria-label') === 'Find a spell'));
    check('the web player board has no spell search (no spell notes there)', !noSearch, noSearch);
    await page.screenshot({ path: `${shots}/player-11d-ask.png` });
    await page.evaluate(() => window.playerTest.board.container.querySelector('.atlas-tabletop-spellcard__toggle').click());
    const foldedCard = await card();
    await page.screenshot({ path: `${shots}/player-11d-ask-folded.png` });
    await page.evaluate(() => window.playerTest.board.container.querySelector('.atlas-tabletop-spellcard__toggle').click());
    const reopened = await card();
    check('the player folds the words to a small button and opens them again', foldedCard.shown && foldedCard.folded && /^Fireball$/.test(foldedCard.text.trim()) && reopened.shown && !reopened.folded, { foldedCard, reopened });
    // The mouse already at the middle: under the held mouse, a jump there would turn the view.
    await page.mouse.move(middle.x, middle.y);
    await press('Aim the spell asked');
    await look();
    await wait(600);
    const askAim = await spellState();
    const shapeButtons = await page.evaluate(() => [...window.playerTest.board.container.querySelectorAll('.atlas-tabletop-spellbar button')].filter((each) => each.getAttribute('aria-label') === 'Sphere').length);
    check('Aim goes into the token\'s eyes and straight to aiming it, the shape not the player\'s to pick', askAim.seeing === 'mine' && askAim.stage === 'aim' && askAim.preview && shapeButtons === 0 && /^Fireball/.test(askAim.text), { askAim, shapeButtons });
    const aimCard = await card();
    check('the words stay over the view while it is aimed', aimCard.shown && /8d6 fire/.test(aimCard.text), aimCard);
    await page.screenshot({ path: `${shots}/player-11d-ask-aim.png` });
    await place();
    await wait(300);
    await press('Next');
    await wait(200);
    await press('Cast');
    await wait(200);
    const answered = (await record()).spells.at(-1);
    check('Cast answers the ask: the spell as asked, tagged with it, its damage the ask\'s', answered && answered.request === 'a1' && answered.add.shape === 'sphere' && Math.abs(answered.add.size - 140) < 1e-6 && answered.add.caster === 'mine' && answered.add.effect === 'fire', answered);
    await page.evaluate((ask) => window.playerTest.handle.receiveSpells('s1', [], [{ ...ask, id: 'a2', ask: { ...ask.ask, name: 'Wall of fire', shape: 'wall', size: 35, length: 140, longest: 210 } }]), fireball);
    await wait(300);
    const inEyes = await spellState();
    check('an ask reaching the eyes is offered on the toolbar there', inEyes.seeing === 'mine' && inEyes.stage === 'ask' && await page.evaluate(() => /Wall of fire/.test(window.playerTest.board.container.querySelector('.atlas-tabletop-spellbar').textContent)), inEyes);
    await press('Decline');
    await wait(200);
    const declined = (await record()).spells.at(-1);
    const afterDecline = await page.evaluate(() => /Wall of fire/.test(window.playerTest.board.container.querySelector('.atlas-tabletop-spellbar').textContent));
    check('Decline turns the ask down, and it goes from the toolbar', declined && declined.decline === 'a2' && !afterDecline, { declined, afterDecline });
    await press('Leave');
    await page.evaluate(() => window.playerTest.handle.receiveSpells('s1', [], []));
    await wait(300);

    // 11d'. A player on Obsidian, with spell notes of their own: Find in the eyes, a spell picked, aimed and cast.
    {
      const dir = require('path').join(__dirname, '..', 'tests', 'fixtures', 'spells');
      const fsx = require('fs');
      const notes = [];
      for (const set of fsx.readdirSync(dir)) for (const file of fsx.readdirSync(require('path').join(dir, set))) notes.push({ path: `${set}/${file}`, text: fsx.readFileSync(require('path').join(dir, set, file), 'utf8') });
      await page.evaluate((notes) => window.playerTest.setSpellNotes(notes), notes);
      await page.evaluate(() => window.playerTest.handle.seeFrom('mine', false));
      await look();
      await wait(400);
      const found = await press('Find a spell');
      await wait(300);
      await page.evaluate(() => { const input = window.playerTest.board.container.querySelector('[data-spell-search]'); input.value = 'burning'; input.dispatchEvent(new Event('input')); });
      await wait(200);
      const listed = await page.evaluate(() => [...window.playerTest.board.container.querySelectorAll('.atlas-tabletop-spellpicker__row')].map((row) => row.textContent));
      // None of the fixtures is Burning Hands: the 2014 Cone of Cold then.
      await page.evaluate(() => { const input = window.playerTest.board.container.querySelector('[data-spell-search]'); input.value = 'cone'; input.dispatchEvent(new Event('input')); });
      await wait(200);
      await page.evaluate(() => [...window.playerTest.board.container.querySelectorAll('.atlas-tabletop-spellpicker__row')].find((row) => /SRD 2014/.test(row.textContent))?.click());
      await wait(200);
      await page.evaluate(() => [...window.playerTest.board.container.querySelectorAll('.atlas-tabletop-spellpicker__actions button')].find((each) => each.textContent === 'Aim')?.click());
      await look();
      await wait(600);
      const aimingCone = await spellState();
      check('a player on Obsidian finds a spell of their own in the eyes and aims it, its words open', found && listed.length === 0 && aimingCone.stage === 'aim' && /^Cone of Cold/.test(aimingCone.text)
        && await page.evaluate(() => /8d8 cold/.test(window.playerTest.board.container.querySelector('.atlas-tabletop-spellcard')?.textContent ?? '')), { found, listed, aimingCone });
      await page.screenshot({ path: `${shots}/player-11d-find.png` });
      const before = await page.evaluate(() => window.playerTest.record.spells.length);
      await place();
      await wait(300);
      await press('Cast');
      await wait(200);
      const castCone = await page.evaluate((before) => window.playerTest.record.spells.slice(before).find((change) => change.add)?.add, before);
      check('Cast sends the spell found: a 60 ft cone from the caster (12 squares), its cold look', castCone && castCone.shape === 'cone' && castCone.from === 'self' && Math.abs(castCone.size - 12 * 70) < 1e-6 && castCone.effect === 'cold', castCone);
      await page.evaluate(() => window.playerTest.handle.sendSpell?.({ clear: true }));
      await press('Leave');
      await page.evaluate(() => window.playerTest.setSpellNotes(null));
      await wait(300);
    }

    // 11e. Each damage type's look, on a sphere by the Goblin and a cone from the caster, seen from above.
    await page.evaluate(() => window.playerTest.handle.setGmCamera({ sceneId: 's1', eye: { x: 385, y: 520, z: 760 }, target: { x: 450, y: 0, z: 385 } }));
    await page.evaluate(() => window.playerTest.handle.followGm());
    await wait(1200);
    const types = ['acid', 'bludgeoning', 'cold', 'explosion', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
    let animated = 0;
    for (const type of types) {
      const list = [
        { id: 'e1', owner: 'me', color: '#3366ff', spell: { shape: 'sphere', from: 'point', at: { x: 560, y: 385, h: 40 }, yaw: 0, pitch: 0, roll: 0, size: 105, length: 0, angle: 0.93, effect: type } },
        { id: 'e2', owner: 'me', color: '#3366ff', spell: { shape: 'cone', from: 'self', at: { x: 385, y: 385, h: 40 }, yaw: Math.PI, pitch: 0, roll: 0, size: 245, length: 0, angle: 0.93, caster: 'mine', effect: type } },
      ];
      await page.evaluate((list) => window.playerTest.handle.receiveSpells('s1', list, []), list);
      await wait(700);
      const moving = await page.evaluate(() => [...window.playerTest.board.spellViews.values()].filter((kept) => kept.view.animated).length);
      if (moving === 2) animated++;
      await page.screenshot({ path: `${shots}/player-11e-${type}.png` });
      // The same damage on a cube, a wall and a beam from the caster.
      const more = [
        { id: 'e3', owner: 'me', color: '#3366ff', spell: { shape: 'cube', from: 'point', at: { x: 600, y: 300, h: 70 }, yaw: 0.3, pitch: 0, roll: 0, size: 140, length: 0, angle: 0.93, effect: type } },
        { id: 'e4', owner: 'me', color: '#3366ff', spell: { shape: 'wall', from: 'point', at: { x: 250, y: 560, h: 0 }, to: { x: 560, y: 560 }, yaw: 0, pitch: 0, roll: 0, size: 35, length: 140, angle: 0.93, effect: type } },
        { id: 'e5', owner: 'me', color: '#3366ff', spell: { shape: 'cylinder', from: 'self', at: { x: 385, y: 385, h: 40 }, yaw: Math.PI, pitch: 0, roll: 0, size: 35, length: 350, angle: 0.93, caster: 'mine', effect: type } },
      ];
      await page.evaluate((list) => window.playerTest.handle.receiveSpells('s1', list, []), more);
      await wait(700);
      await page.screenshot({ path: `${shots}/player-11e-${type}-more.png` });
    }
    check('every damage type draws its look on the spells', animated === types.length, { animated });
    await page.evaluate(() => window.playerTest.handle.receiveSpells('s1', [], []));
    await wait(300);

    }
    // 12. Disposed: the WebGL context is let go.
    await page.evaluate(() => window.playerTest.handle.dispose());
    check('dispose leaves no canvas behind', await page.evaluate(() => document.querySelectorAll('#board canvas').length === 0));
    check('nor the dice line', await page.evaluate(() => document.querySelectorAll('.atlas-tabletop-dice-prompt').length === 0));
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
