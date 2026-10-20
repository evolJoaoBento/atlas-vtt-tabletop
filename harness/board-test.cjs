// Usage: node harness/board-test.cjs <bundle dir> <screenshot dir>, after bundling harness/board.ts (see README).
// Drives harness/board.ts in Chromium (swiftshader) with real mouse input and checks what the board did.
const { chromium } = require('C:/Users/joaoo/2075/atlas-vtt-connect/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const shots = process.argv[3];
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }); res.end(data); });
});
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

server.listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.boardTest?.ready || window.boardError, null, { timeout: 30000 });
    const boot = await page.evaluate(() => window.boardError ?? null);
    if (boot) throw new Error(boot);
    await wait(1500);
    await page.screenshot({ path: `${shots}/board-1-start.png` });
    const project = (x, y, h = 0) => page.evaluate(([x, y, h]) => window.boardTest.project(x, y, h), [x, y, h]);
    const record = () => page.evaluate(() => JSON.parse(JSON.stringify(window.boardTest.record)));
    const goal = () => page.evaluate(() => JSON.parse(JSON.stringify(window.boardTest.board.camera.goal)));
    const drag = async (from, to, button = 'left', modifiers = []) => {
      for (const key of modifiers) await page.keyboard.down(key);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down({ button });
      for (let i = 1; i <= 12; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12); await wait(16); }
      await page.mouse.up({ button });
      for (const key of modifiers) await page.keyboard.up(key);
      await wait(300);
    };

    // 1. A token dragged on the tilted board lands snapped to the cell it was dropped in.
    const gobFrom = await project(525, 385, 6);
    const gobTo = await project(612, 452, 6);
    await drag(gobFrom, gobTo);
    let r = await record();
    const move = r.moves[0];
    check('token drag saves one move', r.moves.length === 1, r.moves);
    check('drop snaps to a cell centre', move && (move[1] - 35) % 70 === 0 && (move[2] - 35) % 70 === 0, move);
    check('drop lands near where it was let go', move && Math.abs(move[1] - 612) <= 70 && Math.abs(move[2] - 452) <= 70, move);
    await wait(800);
    await page.screenshot({ path: `${shots}/board-2-dragged.png` });

    // 1b. A carried token is lifted off the board, and set down again on release.
    const liftFrom = await project(875, 385, 6);
    await page.mouse.move(liftFrom.x, liftFrom.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(liftFrom.x + i * 4, liftFrom.y + i * 2); await wait(30); }
    await wait(400);
    const carriedY = await page.evaluate(() => window.boardTest.board.tokens.get('gob2').piece.object3d.position.y);
    await page.mouse.move(liftFrom.x, liftFrom.y);
    await page.mouse.up();
    await wait(1200);
    const restY = await page.evaluate(() => window.boardTest.board.tokens.get('gob2').piece.object3d.position.y);
    check('a carried token is lifted', carriedY > 5, carriedY);
    check('a dropped token is set down', restY === 0, restY);
    await page.evaluate(() => { window.boardTest.record.moves.length = 1; });

    // 1c. Ctrl + hover on a token with a stat block shows it, once per token.
    const heroHover = await project(245, 245, 20);
    await page.keyboard.down('Control');
    await page.mouse.move(heroHover.x, heroHover.y);
    await page.mouse.move(heroHover.x + 2, heroHover.y + 1);
    await page.keyboard.up('Control');
    await page.mouse.move(heroHover.x + 3, heroHover.y + 1);
    r = await record();
    check('ctrl + hover shows the stat block once', JSON.stringify(r.previews) === '["hero"]', r.previews);

    // 1d. A downed character (0 HP) is greyed out and lies down; a mini and a disc alike.
    await wait(1200);
    const downed = await page.evaluate(() => ['fallen', 'fallenDisc', 'gob2'].map((id) => { const p = window.boardTest.board.tokens.get(id).piece; return { id, downed: p.downed, lying: Math.abs(p.fall.rotation.z) }; }));
    check('a 0 HP mini lies down', downed[0].downed && downed[0].lying > 1.4, downed[0]);
    check('a 0 HP disc is downed (grey, flat)', downed[1].downed, downed[1]);
    check('a token with HP stands', !downed[2].downed && downed[2].lying < 0.01, downed[2]);

    // 1e. Icon stamps lie on the map.
    const icons = await page.evaluate(() => window.boardTest.board.icons.map((icon) => ({ id: icon.id, ready: icon.ready })));
    check('icon stamps are on the board', icons.length === 2 && icons.every((icon) => icon.ready), icons);

    // 1f. Hovering the board names the cell under the pointer (letter-number on this map), and only then.
    const cellD8 = await project(3 * 70 + 35, 7 * 70 + 35, 0);
    await page.mouse.move(cellD8.x, cellD8.y);
    await wait(100);
    const hovered = await page.evaluate(() => window.boardTest.board.hoveredCell);
    check('hovering a cell shows its number', hovered === 'D8', hovered);
    await page.mouse.move(2, 2);
    await wait(100);
    const left = await page.evaluate(() => window.boardTest.board.hoveredCell);
    check('the number goes when the pointer leaves the board', left === null, left);

    // 2. A click on a pin opens its note.
    const pin = await project(1050, 300, 42);
    await page.mouse.click(pin.x, pin.y);
    await wait(200);
    r = await record();
    check('pin click opens its note', r.notes[0] === 'Notes/Tavern.md', r.notes);

    // 3. A right-click (no drag) on a token opens its menu.
    const heroAt = await project(245, 245, 20);
    await page.mouse.click(heroAt.x, heroAt.y, { button: 'right' });
    await wait(200);
    r = await record();
    check('right-click on a token opens its menu', r.menus[0] === 'hero', r.menus);

    // 4. A right-drag on empty board pans and moves nothing.
    let before = await goal();
    const empty = await project(560, 760, 0);
    await drag(empty, { x: empty.x + 120, y: empty.y - 60 }, 'right');
    let after = await goal();
    r = await record();
    check('right-drag pans the camera', Math.hypot(after.target.x - before.target.x, after.target.z - before.target.z) > 1, { before: before.target, after: after.target });
    check('right-drag moves no token', r.moves.length === 1, r.moves);

    // 4a. Panning grabs the board: the spot under the pointer when the drag began stays under it.
    const grabFrom = await project(560, 760, 0);
    await page.mouse.move(grabFrom.x, grabFrom.y);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 10; i++) { await page.mouse.move(grabFrom.x + i * 14, grabFrom.y - i * 6); await wait(16); }
    const under = await page.evaluate(([x, y]) => window.boardTest.board.boardPoint(x, y), [grabFrom.x + 140, grabFrom.y - 60]);
    await page.mouse.up({ button: 'right' });
    check('panning keeps the grabbed spot under the pointer', under && Math.hypot(under.x - 560, under.y - 760) < 4, under);

    // 4b. A drag moves the view at once: the drawn camera is where the drag put it, with no easing left.
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 6; i++) await page.mouse.move(empty.x + i * 15, empty.y);
    const lagging = await page.evaluate(() => { const c = window.boardTest.board.camera; return Math.hypot(c.goal.target.x - c.pose.target.x, c.goal.target.z - c.pose.target.z); });
    await page.mouse.up({ button: 'right' });
    check('camera drag follows the pointer with no lag', lagging < 1e-6, lagging);

    // 4c. A token with a mini stands on the board; one without floats.
    const heights = await page.evaluate(() => { const t = window.boardTest.board.tokens; return { hero: t.get('hero').piece.top, gob2: t.get('gob2').piece.top, d: t.get('hero').piece.diameter }; });
    check('a mini stands on the board', heights.hero === 0, heights);
    const heroParts = await page.evaluate(() => {
      const kinds = [];
      window.boardTest.board.tokens.get('hero').piece.object3d.traverse((node) => { if (node.isMesh && !node.userData.blobShadow && node.visible !== false && node.material?.visible !== false) kinds.push(node.geometry.type); });
      return kinds;
    });
    check('a mini has only its ring under it, no disc', heroParts.includes('TorusGeometry') && !heroParts.includes('CylinderGeometry') && !heroParts.includes('CircleGeometry'), heroParts);
    check('a token without a mini floats', heights.gob2 > heights.d * 0.2, heights);

    // 4d. Shadows of minis: a soft blob at medium quality (the default), the model's own shadow at high.
    const shadows = () => page.evaluate(() => {
      const piece = window.boardTest.board.tokens.get('hero').piece;
      let blob = false, casting = false;
      piece.object3d.traverse((node) => {
        if (node.userData.blobShadow) blob = node.visible;
        if (node.isSkinnedMesh || (node.isMesh && node.parent && node.userData.fromMini)) casting = casting || node.castShadow;
      });
      return { blob, casting };
    });
    const medium = await shadows();
    check('at medium a mini has a blob shadow and casts none', medium.blob && !medium.casting, medium);
    const swapped = await page.evaluate(() => window.boardTest.board.setQuality(window.boardTest.QUALITY.high));
    await wait(200);
    const high = await shadows();
    check('at high a mini casts its own shadow, no blob', !high.blob && high.casting, high);
    check('switching medium to high keeps the board (same antialiasing)', swapped === true, swapped);
    await page.evaluate(() => window.boardTest.board.setQuality(window.boardTest.QUALITY.medium));
    const ratio = await page.evaluate(() => window.boardTest.board.pixelRatio);
    check('medium draws at no more than 1.5× the screen', ratio <= 1.5, ratio);

    // 5. A left-drag on empty board orbits.
    before = await goal();
    await drag(empty, { x: empty.x - 150, y: empty.y + 40 });
    after = await goal();
    check('left-drag on empty board orbits', Math.abs(after.yaw - before.yaw) > 0.1, { before: before.yaw, after: after.yaw });

    // 6. The wheel zooms.
    before = await goal();
    await page.mouse.move(500, 320);
    await page.mouse.wheel(0, 300);
    await wait(200);
    after = await goal();
    check('wheel zooms out', after.distance > before.distance, { before: before.distance, after: after.distance });

    // 7. Ctrl + drag moves a prop.
    await wait(700);
    const barrel = await project(910, 805, 20);
    const barrelTo = await project(980, 860, 20);
    await drag(barrel, barrelTo, 'left', ['Control']);
    r = await record();
    check('ctrl-drag moves the prop', r.propMoves.length === 1 && r.propMoves[0][0] === 'barrel', r.propMoves);
    check('ctrl-drag on a prop moves no token', r.moves.length === 1, r.moves);

    // 7b. A right-click on a prop opens its menu.
    await wait(400);
    const barrelNow = await project(r.propMoves[0][1], r.propMoves[0][2], 20);
    await page.mouse.click(barrelNow.x, barrelNow.y, { button: 'right' });
    await wait(200);
    r = await record();
    check('right-click on a prop opens its menu', r.propMenus[0] === 'barrel', r.propMenus);

    // 8. Placing a prop from the gallery: the next click drops it there.
    await page.evaluate(() => window.boardTest.board.placeProp('props/crate.glb'));
    const spot = await project(300, 850, 0);
    await page.mouse.click(spot.x, spot.y);
    await wait(200);
    r = await record();
    check('placing a prop drops it where clicked', r.added.length === 1 && Math.abs(r.added[0][1] - 300) < 15 && Math.abs(r.added[0][2] - 850) < 15, r.added);

    // 9. Reloading the map (the file changed) keeps the camera.
    before = await goal();
    await page.evaluate(() => window.boardTest.board.load({ ...window.boardTest.map }));
    // the first load framed the map; check it fits before anything moved is not possible here, so Home is checked below
    await wait(200);
    after = await goal();
    check('reload keeps the camera', JSON.stringify(before) === JSON.stringify(after), { before, after });

    // 10. A token whose art is missing still shows, with one warning.
    const tokens = await page.evaluate(() => [...window.boardTest.board.tokens.keys()]);
    r = await record();
    check('token with missing art is still on the board', tokens.includes('noart'), tokens);
    check('missing art warns once', r.warnings.filter((w) => w.includes('missing.png')).length === 1, r.warnings);

    // 11. Home frames the map; keys pan.
    await page.focus('canvas');
    before = await goal();
    await page.keyboard.down('d');
    await wait(300);
    await page.keyboard.up('d');
    after = await goal();
    check('D pans the camera', Math.hypot(after.target.x - before.target.x, after.target.z - before.target.z) > 1, { before: before.target, after: after.target });
    await page.keyboard.press('Home');
    await wait(1500);
    await page.screenshot({ path: `${shots}/board-3-home.png` });
    const corners = await Promise.all([[0, 0], [1400, 0], [0, 1000], [1400, 1000]].map(([x, y]) => project(x, y, 0)));
    check('Home frames the whole map', corners.every((c) => c.x >= 0 && c.x <= 1000 && c.y >= 0 && c.y <= 640), corners);

    // 11b. A drag whose pointer is lost (Alt-Tab, a dialog) ends: the token goes back, nothing keeps dragging.
    const gob2 = await project(875, 385, 6);
    await page.mouse.move(gob2.x, gob2.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(gob2.x + i * 12, gob2.y);
    await page.evaluate(() => window.boardTest.board.canvas.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 })));
    const lost = await page.evaluate(() => ({ press: window.boardTest.board.press, at: window.boardTest.board.tokens.get('gob2').goal }));
    await page.mouse.up();
    check('a lost pointer ends the drag', lost.press === null, lost.press);
    check('a lost drag puts the token back', lost.at.x === 875 && lost.at.y === 385, lost.at);
    const movesAfterLost = (await record()).moves.length;
    check('a lost drag saves nothing', movesAfterLost === 1, movesAfterLost);

    // 12. A close look at the hero's labels.
    await page.evaluate(() => { const b = window.boardTest.board; b.camera.lookAt({ x: 245, y: 0, z: 245 }); b.camera.zoom(0.15); b.camera.orbit(0, -0.3); b.wake(); });
    await wait(1500);
    await page.screenshot({ path: `${shots}/board-4-hero.png` });
    await page.evaluate(() => { const b = window.boardTest.board; b.camera.lookAt({ x: 1190, y: 0, z: 525 }); b.camera.snap(); b.wake(true); });
    await wait(1200);
    await page.screenshot({ path: `${shots}/board-5-downed.png` });
    const heroTop = await project(245, 245, 40);
    await page.mouse.move(heroTop.x - 60, heroTop.y);
    await wait(100);
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
