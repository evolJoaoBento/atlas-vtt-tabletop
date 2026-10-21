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
    const iconIds = await page.evaluate(async () => {
      const before = window.boardTest.board.icons.map((icon) => icon.object3d.uuid);
      await window.boardTest.board.load({ ...window.boardTest.map });
      const after = window.boardTest.board.icons.map((icon) => icon.object3d.uuid);
      return { before, after };
    });
    check('a reload keeps the icons (no flicker)', JSON.stringify(iconIds.before) === JSON.stringify(iconIds.after), iconIds);

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

    // 1g. Dragging shows Atlas's ruler: Space drops a waypoint, the distance runs along the path.
    {
      const from = await project(875, 385, 6);
      const right = await project(945, 385, 6);
      const down = await project(945, 455, 6);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) { await page.mouse.move(from.x + ((right.x - from.x) * i) / 6, from.y + ((right.y - from.y) * i) / 6); await wait(20); }
      const rulerA = await page.evaluate(() => window.boardTest.board.ruler?.uuid);
      await page.mouse.move(right.x + 3, right.y + 2);
      const rulerB = await page.evaluate(() => window.boardTest.board.ruler?.uuid);
      check('the ruler is not rebuilt while the landing cell is the same', rulerA && rulerA === rulerB, { rulerA, rulerB });
      await page.keyboard.press(' ');
      for (let i = 1; i <= 6; i++) { await page.mouse.move(right.x + ((down.x - right.x) * i) / 6, right.y + ((down.y - right.y) * i) / 6); await wait(20); }
      const ruler = await page.evaluate(() => window.boardTest.board.rulerState);
      await wait(200);
      await page.screenshot({ path: `${shots}/board-6-ruler.png` });
      await page.mouse.up();
      await wait(300);
      check('the ruler measures along the path', ruler && ruler.label === '10ft', ruler);
      check('Space drops a waypoint', ruler && ruler.points.length === 3, ruler);
      const gone = await page.evaluate(() => window.boardTest.board.rulerState);
      check('the ruler goes on release', gone === null, gone);
      r = await record();
      const last = r.moves.at(-1);
      check('the dragged token lands at the path end', last && last[0] === 'gob2' && last[1] === 945 && last[2] === 455, last);
    }

    // 1h. Alt + drag copies the token: the original stays, the copy lands where it is let go.
    {
      const from = await project(385, 665, 6);
      const to = await project(455, 665, 6);
      await page.keyboard.down('Alt');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8); await wait(20); }
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await wait(400);
      r = await record();
      const copy = r.copies[0];
      check('alt-drag copies the token where it is let go', copy && copy[0] === 'noart' && copy[2] === 455 && copy[3] === 665, r.copies);
      const state = await page.evaluate((id) => {
        const tokens = window.boardTest.board.tokens;
        return { original: tokens.get('noart').goal, copy: id ? tokens.get(id)?.goal ?? null : null };
      }, copy ? copy[1] : null);
      check('the original stays where it was', state.original.x === 385 && state.original.y === 665, state);
      check('the copy is on the board at once', state.copy && state.copy.x === 455 && state.copy.y === 665, state);
      check('a copy is not a move', !r.moves.some((m) => m[0] === 'noart'), r.moves);
    }

    // 1i. Atlas's resource controls: a click selects a token; its bars and wheels get − / + and click-to-edit.
    {
      const controls = () => page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-resource-hit, .atlas-tabletop-resource-button')]
        .filter((el) => !el.hidden).map((el) => { const b = el.getBoundingClientRect(); return { cls: el.className, label: el.getAttribute('aria-label'), x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; }));
      const find = (list, label) => list.find((c) => c.label === label);
      check('no controls before a token is selected', (await controls()).length === 0, await controls());
      const heroBody = await project(245, 245, 20);
      await page.mouse.click(heroBody.x, heroBody.y);
      await wait(200);
      const selected = await page.evaluate(() => window.boardTest.board.selected);
      check('a click selects the token', selected === 'hero', selected);
      let list = await controls();
      // HP on a bar, spell slots and ki on wheels; AC is static: no controls, as in Atlas.
      check('each counting resource gets an overlay and − / +', list.length === 9 && !list.some((c) => c.label.endsWith(' ac')), list.map((c) => c.label));
      await page.screenshot({ path: `${shots}/board-7-controls.png` });
      const hpHit = find(list, 'Edit hp');
      const hpMinus = find(list, 'Lower hp');
      const hpPlus = find(list, 'Raise hp');
      check('a bar\'s − is on its left and + on its right', hpMinus.x < hpHit.x - hpHit.w / 2 && hpPlus.x > hpHit.x + hpHit.w / 2 && Math.abs(hpMinus.y - hpHit.y) < 2, { hpHit, hpMinus, hpPlus });
      const kiHit = find(list, 'Edit ki');
      const kiPlus = find(list, 'Raise ki');
      const kiMinus = find(list, 'Lower ki');
      check('a wheel\'s + stands above its −, on its outer side', kiPlus.y < kiMinus.y && Math.abs(kiPlus.x - kiMinus.x) < 1 && Math.abs(kiPlus.x - kiHit.x) > kiHit.w / 2, { kiHit, kiPlus, kiMinus });

      await page.mouse.click(hpMinus.x, hpMinus.y);
      await wait(100);
      r = await record();
      check('− lowers the resource by one', JSON.stringify(r.edits[0]) === JSON.stringify(['hero', 'hp', { current: 20, max: 27 }, { current: 19, max: 27 }, false]), r.edits);
      let shown = await page.evaluate(() => window.boardTest.board.tokens.get('hero').token.resources.hp);
      check('the bar shows it at once', shown.current === 19, shown);
      check('the token stays selected', (await page.evaluate(() => window.boardTest.board.selected)) === 'hero');

      const slotsPlus = find(await controls(), 'Raise slots');
      await page.mouse.click(slotsPlus.x, slotsPlus.y);
      await page.mouse.click(slotsPlus.x, slotsPlus.y);
      await page.mouse.click(slotsPlus.x, slotsPlus.y);
      await wait(100);
      r = await record();
      const slots = r.edits.filter((e) => e[1] === 'slots').map((e) => e[3].current);
      check('steps add up and stop at the maximum', JSON.stringify(slots) === JSON.stringify([3, 4]), r.edits);

      list = await controls();
      await page.mouse.click(find(list, 'Edit hp').x, find(list, 'Edit hp').y);
      await wait(150);
      const editor = await page.evaluate(() => {
        const el = document.querySelector('.atlas-token-value-editor');
        if (!el) return null;
        const inputs = [...el.querySelectorAll('input')].map((i) => i.value);
        const b = el.getBoundingClientRect();
        return { inputs, focused: document.activeElement === el.querySelector('input'), top: b.top };
      });
      check('a click on the bar opens Atlas\'s editor with current / max', editor && JSON.stringify(editor.inputs) === JSON.stringify(['19', '27']) && editor.focused, editor);
      const active = await page.evaluate(() => !!document.querySelector('.atlas-tabletop-resource-hit.is-active'));
      check('the bar is outlined while its editor is open', active, active);
      check('the editor hangs under the bar', editor && editor.top > find(list, 'Edit hp').y, { editor, bar: find(list, 'Edit hp') });
      await page.keyboard.type('-5');
      await page.keyboard.press('Enter');
      await wait(150);
      r = await record();
      check('"-5" then Enter applies it', JSON.stringify(r.edits.at(-1)) === JSON.stringify(['hero', 'hp', { current: 19, max: 27 }, { current: 14, max: 27 }, false]), r.edits.at(-1));
      check('Enter closes the editor', await page.evaluate(() => !document.querySelector('.atlas-token-value-editor')));

      list = await controls();
      await page.mouse.click(find(list, 'Edit hp').x, find(list, 'Edit hp').y);
      await wait(150);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Control+A');
      await page.keyboard.type('30');
      await page.keyboard.press('Escape');
      await wait(100);
      const edits = (await record()).edits.length;
      check('Escape discards', edits === r.edits.length && await page.evaluate(() => !document.querySelector('.atlas-token-value-editor')), edits);

      await page.mouse.click(find(list, 'Edit hp').x, find(list, 'Edit hp').y);
      await wait(150);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Control+A');
      await page.keyboard.type('30');
      // A click on the empty board applies the changed editor and lets the token go.
      const emptyAt = await project(560, 760, 0);
      await page.mouse.click(emptyAt.x, emptyAt.y);
      await wait(200);
      r = await record();
      check('clicking away applies a changed maximum, marked as edited', JSON.stringify(r.edits.at(-1)) === JSON.stringify(['hero', 'hp', { current: 14, max: 27 }, { current: 14, max: 30 }, true]), r.edits.at(-1));
      check('a click on the empty board lets the token go', (await page.evaluate(() => window.boardTest.board.selected)) === null && (await controls()).length === 0, await controls());

      await page.mouse.click(heroBody.x, heroBody.y);
      await wait(150);
      await page.keyboard.press('Escape');
      await wait(100);
      check('Escape lets the token go', (await page.evaluate(() => window.boardTest.board.selected)) === null);

      // Kill and Delete, as the token menu shows them on the board before the file catches up.
      const fate = await page.evaluate(() => {
        const b = window.boardTest.board;
        const gob = b.tokens.get('gob').token;
        b.changeToken('gob', { ...gob, resources: { hp: { current: 0, max: 7 } } });
        const gobDowned = b.tokens.get('gob').piece.downed;
        b.changeToken('gob', gob);
        const copy = [...b.tokens.keys()].find((id) => id.startsWith('tok_'));
        b.select(copy);
        b.changeToken(copy, null);
        return { gobDowned, copy, still: b.tokens.has(copy), selected: b.selected };
      });
      check('a killed token is shown downed at once', fate.gobDowned, fate);
      check('a deleted token leaves the board, and its selection', fate.copy && !fate.still && fate.selected === null, fate);
    }

    // 1i2. Text labels lie flat on the map, read-only, centred, turned and scaled as Atlas draws them.
    {
      const texts = await page.evaluate(() => window.boardTest.board.texts.map((piece) => {
        const o = piece.object3d;
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        return { id: piece.label.id, x: o.position.x, z: o.position.z, y: o.position.y, turn: Math.round(o.rotation.y * 180 / Math.PI), width: Math.round(b.max.x - b.min.x), depth: Math.round(b.max.z - b.min.z), flat: Math.round(b.max.y - b.min.y) };
      }));
      const room = texts.find((t) => t.id === 't1');
      const docks = texts.find((t) => t.id === 't2');
      check('text labels lie flat on the map at their place', texts.length === 2 && room.x === 560 && room.z === 560 && room.flat === 0 && room.y < 1, texts);
      check('a text is turned clockwise and scaled as in Atlas', docks.turn === 30 && docks.depth > room.depth, texts);
      const hit = await page.evaluate(() => { const at = window.boardTest.project(560, 560, 0); return { x: at.x, y: at.y }; });
      await page.mouse.click(hit.x, hit.y, { button: 'right' });
      await wait(150);
      check('a text takes no clicks (read-only)', !(await record()).menus.includes('t1'), (await record()).menus);
      await page.screenshot({ path: `${shots}/board-13-texts.png` });
      const inks = await page.evaluate(() => window.boardTest.board.inks.map((piece) => {
        const o = piece.object3d;
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        return { id: piece.ink.id, color: o.material.color.getHexString(), opacity: o.material.opacity, minX: Math.round(b.min.x), maxX: Math.round(b.max.x), flat: Math.round(b.max.y - b.min.y), order: o.renderOrder };
      }));
      check('pen strokes lie flat on the map in their colour, as wide as the pen', inks.length === 2 && inks[0].color === 'd13b3b' && inks[0].minX === 156 && inks[0].maxX === 424 && inks[0].flat === 0 && inks[1].opacity === 0.6, inks);
      check('a later stroke lies over an earlier one', inks[1].order > inks[0].order, inks);
    }

    // 1j. Atlas's fog of war stands on the map; the toolbar's settings set its height.
    {
      const fog = () => page.evaluate(() => {
        const group = window.boardTest.board.fog.object3d;
        let minY = Infinity, maxY = -Infinity, meshes = 0, holes = 0;
        group.traverse((node) => {
          if (!node.isMesh) return;
          meshes++;
          node.geometry.computeBoundingBox();
          minY = Math.min(minY, node.geometry.boundingBox.min.y);
          maxY = Math.max(maxY, node.geometry.boundingBox.max.y);
        });
        return { meshes, minY, maxY };
      });
      let f = await fog();
      check('the fog is one cloud over all of it', f.meshes === 1, f);
      // The cloud's box: one square tall, and half a square more for its soft top.
      check('the fog is one square tall by default', Math.abs(f.maxY - f.minY - 105) < 0.01, f);
      const covered = await page.evaluate(() => {
        // The corridor erased through the room is open: no fog over its middle, fog over the room around it.
        const probe = (x, y) => window.boardTest.insideFog(window.boardTest.board.fog.areas, { x, y });
        return { room: probe(1000, 790), corridor: probe(1155, 875), outside: probe(600, 300) };
      });
      check('fog covers the room, not the corridor erased through it', covered.room && !covered.corridor && !covered.outside, covered);
      await page.screenshot({ path: `${shots}/board-8-fog.png` });

      const button = await page.evaluate(() => { const b = document.querySelector('.atlas-tabletop-tool-button[aria-label="Board settings"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      const selBefore = await page.evaluate(() => window.boardTest.board.selected);
      await page.mouse.click(button.x, button.y);
      await wait(150);
      const panel = await page.evaluate(() => {
        const p = document.querySelector('.atlas-tabletop-palette:not(.atlas-tabletop-laser-options)');
        const input = p.querySelector('input');
        return { open: !p.hidden, value: input.value, focused: document.activeElement === input, text: p.textContent };
      });
      check('the toolbar\'s button opens the board settings with the fog height', panel.open && panel.value === '1' && panel.focused && panel.text.includes('Walls and fog'), panel);
      await page.screenshot({ path: `${shots}/board-9-settings.png` });
      const camera = await goal();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('w2');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('2');
      await page.keyboard.press('Enter');
      await wait(300);
      r = await record();
      check('typing a height and Enter sets it', JSON.stringify(r.fogHeights) === '[2]', r.fogHeights);
      f = await fog();
      check('the fog stands two squares tall', Math.abs(f.maxY - f.minY - 175) < 0.01, f);
      const after = await goal();
      check('typing in the settings does not move the camera', JSON.stringify(after.target) === JSON.stringify(camera.target), { camera: camera.target, after: after.target });
      await page.keyboard.type('x');
      await page.keyboard.press('Enter');
      const invalid = await page.evaluate(() => document.querySelector('.atlas-tabletop-palette:not(.atlas-tabletop-laser-options) input').hasAttribute('aria-invalid'));
      check('a height that is not a number is refused', invalid && (await record()).fogHeights.length === 1, invalid);
      await page.keyboard.press('Escape');
      await wait(100);
      check('Escape closes the settings', await page.evaluate(() => document.querySelector('.atlas-tabletop-palette:not(.atlas-tabletop-laser-options)').hidden));
      check('the toolbar takes no press from the board', (await page.evaluate(() => window.boardTest.board.selected)) === selBefore);
      await page.mouse.click(button.x, button.y);
      await wait(100);
      // The top-left of the board's canvas: clear of the panel whatever the camera.
      await page.mouse.click(20, 20);
      await wait(100);
      check('a click on the board closes the settings', await page.evaluate(() => document.querySelector('.atlas-tabletop-palette:not(.atlas-tabletop-laser-options)').hidden));
    }

    // 1k. The local player view: a second window drawing the scene as players see it.
    {
      const tools = () => page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-tool-button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { label: b.getAttribute('aria-label'), hidden: b.closest('.atlas-tool-button')?.hidden ?? b.hidden, active: b.classList.contains('is-active'), x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }));
      let list = await tools();
      check('the toolbar has the player view button; freezing waits for a player view', list.some((t) => t.label === 'Open the player view') && list.find((t) => t.label?.startsWith('Freeze'))?.hidden, list);
      const opened = page.waitForEvent('popup');
      const open = list.find((t) => t.label === 'Open the player view');
      await page.mouse.click(open.x, open.y);
      const popup = await opened;
      await wait(800);
      list = await tools();
      check('the button shows the player view is open, and freezing is offered', list.some((t) => t.label === 'Close the player view' && t.active) && list.some((t) => t.label === "Freeze the players' camera here" && !t.hidden), list);
      const drawn = await popup.screenshot({ path: `${shots}/board-10-players.png` });
      check('the player window draws the board', drawn.length > 20000, drawn.length);
      await page.screenshot({ path: `${shots}/board-11-gm-with-players.png` });

      const gm = await page.evaluate(() => {
        const b = window.boardTest.board;
        return { orc: b.tokens.get('orc').piece.object3d.visible, lurker: b.tokens.get('lurker').piece.object3d.visible, pins: b.pins.every((p) => p.object3d.visible), outline: b.fog.material.uniforms.uStrength.value === 0.5 };
      });
      check('after each frame the GM sees everything again: hidden tokens, tokens under fog, pins, see-through fog', gm.orc && gm.lurker && gm.pins && gm.outline, gm);
      const players = await page.evaluate(() => {
        const b = window.boardTest.board;
        b.showFor('player');
        const seen = { orc: b.tokens.get('orc').piece.object3d.visible, lurker: b.tokens.get('lurker').piece.object3d.visible, hero: b.tokens.get('hero').piece.object3d.visible, pins: b.pins.some((p) => p.object3d.visible), heroResources: b.tokens.get('hero').playerLabels.resourceTargets.map((t) => t.definition.key), heroGm: b.tokens.get('hero').labels.resourceTargets.map((t) => t.definition.key) };
        b.showFor('gm');
        return seen;
      });
      check('players do not see the hidden orc, the token under the fog, or the pins', !players.orc && !players.lurker && players.hero && !players.pins, players);
      check('players see only the resources shown to them', JSON.stringify(players.heroResources) === '["ac","slots","ki"]' && players.heroGm.includes('hp'), players);
      const copies = await page.evaluate(() => ({ gm: window.boardTest.board.tokens.get('gob2').labels.hoverTargets.map((t) => t.label), players: window.boardTest.board.tokens.get('gob2').playerLabels.hoverTargets.map((t) => t.label) }));
      check('copy numbers are counted among what players see', copies.gm.includes('Copy 2'), copies);

      const playerEye = () => page.evaluate(() => { const v = window.boardTest.board.player.view.position; return [v.x, v.y, v.z].map((n) => Math.round(n)); });
      const gmEye = () => page.evaluate(() => { const v = window.boardTest.board.view.position; return [v.x, v.y, v.z].map((n) => Math.round(n)); });
      check('the players\' camera follows the GM\'s', JSON.stringify(await playerEye()) === JSON.stringify(await gmEye()), { p: await playerEye(), g: await gmEye() });
      const freeze = (await tools()).find((t) => t.label === "Freeze the players' camera here");
      await page.mouse.click(freeze.x, freeze.y);
      await wait(100);
      const frozenAt = await playerEye();
      const emptyAt = await project(560, 760, 0);
      await drag(emptyAt, { x: emptyAt.x + 150, y: emptyAt.y }, 'left');
      await wait(300);
      check('frozen, the players\' camera stays while the GM\'s turns', JSON.stringify(await playerEye()) === JSON.stringify(frozenAt) && JSON.stringify(await gmEye()) !== JSON.stringify(frozenAt), { frozenAt, p: await playerEye(), g: await gmEye() });
      const unfreeze = (await tools()).find((t) => t.label === "Let the players' camera follow yours");
      check('the freeze button shows it is on', unfreeze && unfreeze.active, await tools());
      await page.mouse.click(unfreeze.x, unfreeze.y);
      await page.evaluate(() => window.boardTest.board.wake());
      await wait(300);
      check('unfrozen, it follows the GM\'s again', JSON.stringify(await playerEye()) === JSON.stringify(await gmEye()), { p: await playerEye(), g: await gmEye() });

      // The players' camera inside the fog sees black; inside the fog's box but in a hole of it, the fog around it shows.
      const inFog = async (x, z) => {
        await page.evaluate(([x, z]) => {
          const b = window.boardTest.board;
          b.player.frozen = { eye: { x, y: 30, z }, target: { x: x + 200, y: 0, z }, yaw: 0, distance: 200 };
          b.wake(true);
        }, [x, z]);
        await wait(400);
        return page.evaluate(() => ({ blind: window.boardTest.board.player.blind, side: window.boardTest.board.fog.material.side }));
      };
      const deep = await inFog(1015, 805);
      const black = await popup.screenshot({ path: `${shots}/board-10b-players-in-fog.png` });
      const hole = await inFog(1150, 870);
      check('a players\' camera inside the fog sees only black', deep.blind === true, deep);
      check('in a hole of the fog, inside its box, the fog around still shows (drawn from inside)', hole.blind === false && hole.side === 1, hole);
      await page.evaluate(() => { const b = window.boardTest.board; b.player.frozen = null; b.wake(true); });
      await wait(300);
      const close = (await tools()).find((t) => t.label === 'Close the player view');
      await page.mouse.click(close.x, close.y);
      await wait(300);
      const after = await page.evaluate(() => ({ player: window.boardTest.board.player, labels: [...document.querySelectorAll('.atlas-tabletop-tool-button')].map((b) => [b.getAttribute('aria-label'), b.closest('.atlas-tool-button')?.hidden ?? b.hidden]) }));
      check('closing it stops the second drawing and hides the freeze button', after.player === null && after.labels.some(([l]) => l === 'Open the player view'), after);
    }

    // 1l. Atlas's laser pointer: a glowing dot while on, a beam while pressed that fades; its colour and size options.
    {
      const tools = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.atlas-tabletop-tool-button, .atlas-dropdown-trigger')].map((b) => {
        const r = b.getBoundingClientRect();
        return [b.getAttribute('aria-label'), { x: r.left + r.width / 2, y: r.top + r.height / 2, active: b.classList.contains('is-active') }];
      })));
      const beam = () => page.evaluate(() => { const b = window.boardTest.board.beam.object3d; return { visible: b.visible, indices: b.geometry.drawRange.count }; });
      // The page styles every button as Obsidian's theme does (white, bordered, shadowed): the toolbar's must not show it.
      const looks = await page.evaluate(() => {
        const style = (el) => getComputedStyle(el);
        const face = document.querySelector('.atlas-tool-group .atlas-tabletop-tool-button');
        const command = document.querySelector('.atlas-tabletop-tool-button[aria-label="Board settings"]');
        return {
          command: { bg: style(command).backgroundColor, border: style(command).borderTopWidth, shadow: style(command).boxShadow, size: command.getBoundingClientRect().width },
          face: { bg: style(face).backgroundColor, color: style(face).color, left: style(face).borderTopLeftRadius, right: style(face).borderTopRightRadius },
          end: style(command).borderTopRightRadius,
        };
      });
      check('toolbar buttons are flat, whatever the theme does to buttons, and 40 px', looks.command.bg === 'rgba(0, 0, 0, 0)' && looks.command.border === '0px' && looks.command.shadow === 'none' && looks.command.size === 40, looks);
      check('the tool in use is filled with the accent colour', looks.face.bg === 'rgb(124, 92, 255)' && looks.face.color === 'rgb(255, 255, 255)', looks);
      check("the group and the bar's ends are rounded with the bar", parseFloat(looks.face.left) > 0 && looks.face.right === '0px' && parseFloat(looks.end) > 0, looks);
      let list = await tools();
      check('the Move/Select group shows the hand while moving', !!list['Move/Select'] && !list['Laser Pointer'], Object.keys(list));
      await page.mouse.click(list['Move options'].x, list['Move options'].y);
      await wait(150);
      const items = await page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-laser-options .atlas-dropdown-menu-item')].map((b) => ({ text: b.textContent, checked: !!b.querySelector('.atlas-dropdown-menu-item__check svg') })));
      check('its menu has Atlas\'s two tools, Move/Select checked, each with its key', items.length === 2 && items[0].text === 'Move/SelectV' && items[0].checked && items[1].text === 'Laser PointerV' && !items[1].checked, items);
      const laserItem = await page.evaluate(() => { const r = document.querySelectorAll('.atlas-tabletop-laser-options .atlas-dropdown-menu-item')[1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.click(laserItem.x, laserItem.y);
      await wait(100);
      check('choosing Laser Pointer turns it on and closes the menu, the cursor becomes its dot', await page.evaluate(() => window.boardTest.board.laser && window.boardTest.board.canvas.style.cursor === 'none' && document.querySelector('.atlas-tabletop-laser-options').hidden));
      list = await tools();
      check('the group\'s face is now the flashlight', !!list['Laser Pointer'] && !list['Move/Select'], Object.keys(list));
      await page.evaluate(() => window.boardTest.board.canvas.focus());
      await page.keyboard.press('v');
      await wait(50);
      check('V switches back to Move/Select', !(await page.evaluate(() => window.boardTest.board.laser)));
      await page.keyboard.press('v');
      await wait(50);
      check('and V again to the laser', await page.evaluate(() => window.boardTest.board.laser));
      const from = await project(400, 500, 0);
      const to = await project(700, 650, 0);
      await page.mouse.move(from.x, from.y);
      await wait(150);
      let b = await beam();
      check('hovering, the laser is a dot', b.visible && b.indices === 6, b);
      const camera = await goal();
      const before = await page.evaluate(() => window.boardTest.board.selected);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12 + Math.sin(i) * 20); await wait(16); }
      b = await beam();
      check('pressed, the laser draws a beam behind the pointer', b.visible && b.indices > 60, b);
      await page.screenshot({ path: `${shots}/board-14-laser.png` });
      await page.mouse.up();
      await wait(50);
      check('drawing with the laser moves no camera and selects nothing', JSON.stringify((await goal()).target) === JSON.stringify(camera.target) && (await page.evaluate(() => window.boardTest.board.selected)) === before);
      await wait(1000);
      b = await beam();
      check('let go, the beam fades away and the dot stays', b.visible && b.indices === 6, b);

      list = await tools();
      await page.mouse.click(list['Move options'].x, list['Move options'].y);
      await wait(150);
      const options = await page.evaluate(() => {
        const panel = document.querySelector('.atlas-tabletop-laser-options');
        const group = panel.closest('.atlas-tool-group').getBoundingClientRect();
        const box = panel.getBoundingClientRect();
        return {
          open: !panel.hidden, above: box.bottom < group.top, alignedLeft: Math.abs(box.left - group.left) < 30,
          swatches: [...panel.querySelectorAll('.atlas-swatch')].map((s) => [s.title, s.classList.contains('atlas-swatch--active'), !!s.querySelector('.atlas-swatch-check')]),
          text: panel.textContent, size: panel.querySelector('.atlas-dropdown-slider-row__value').textContent,
        };
      });
      check('the laser options are Atlas\'s: eight colours (the chosen one checked) with their hint, and the size in px', options.open && options.swatches.length === 8 && options.swatches[0][1] && options.swatches[0][2] && !options.swatches[1][2] && options.text.includes('colour-blind') && options.text.includes('Laser size') && options.size === '16px', options);
      check('they open above the laser\'s tool group, at its left', options.above && options.alignedLeft, options);
      await page.screenshot({ path: `${shots}/board-15-laser-options.png` });
      const sky = await page.evaluate(() => { const r = document.querySelector('.atlas-swatch[title="Sky blue"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.click(sky.x, sky.y);
      // Atlas's slider: a press on the track puts the thumb there (its centre runs half a thumb in from each end).
      const at40 = await page.evaluate(() => { const r = document.querySelector('.atlas-tabletop-laser-options .slider-root').getBoundingClientRect(); return { x: r.left + 8 + ((40 - 8) / 92) * (r.width - 16), y: r.top + r.height / 2 }; });
      await page.mouse.click(at40.x, at40.y);
      await wait(100);
      r = await record();
      check('choosing a colour and a size saves them', JSON.stringify(r.lasers) === JSON.stringify([{ color: '#00a9ff' }, { size: 40 }]), r.lasers);
      const ticked = await page.evaluate(() => document.querySelector('.atlas-swatch.atlas-swatch--active')?.title);
      check('the chosen colour is ticked', ticked === 'Sky blue', ticked);
      await page.keyboard.press('Escape');
      await page.mouse.move(from.x, from.y);
      await page.evaluate(() => window.boardTest.board.canvas.focus());
      await page.keyboard.press('Escape');
      await wait(150);
      b = await beam();
      check('Escape turns the laser off', !(await page.evaluate(() => window.boardTest.board.laser)) && !b.visible && (await page.evaluate(() => window.boardTest.board.canvas.style.cursor)) === '', b);
    }

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

    // 3b. Atlas's token menu: conditions (badges, ticks, a stepper, staying open), Hide, Initiative, Reset, Kill, Delete.
    {
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.boardTest.board.select(null));
      const rows = (selector) => page.evaluate((selector) => [...document.querySelectorAll(selector + ' > .atlas-ctx-item, ' + selector + ' .atlas-ctx-destructive-btn')].map((row) => {
        const r = row.getBoundingClientRect();
        return { text: row.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2, checked: row.querySelector('.atlas-ctx-item__check')?.getAttribute('data-state') ?? null, badge: !!row.querySelector('.atlas-condition-badge svg, .atlas-condition-badge'), stepper: row.querySelector('.atlas-ctx-stepper__value')?.textContent ?? null };
      }), selector);
      const heroAt2 = await project(245, 245, 20);
      await page.mouse.click(heroAt2.x, heroAt2.y, { button: 'right' });
      await wait(150);
      let top = await rows('.atlas-ctx-menu:nth-of-type(1)');
      top = await page.evaluate(() => [...document.querySelectorAll('.atlas-ctx-menu')][0] ? null : null) ?? (await page.evaluate(() => {
        const menu = document.querySelectorAll('.atlas-ctx-menu')[0];
        return [...menu.querySelectorAll(':scope > .atlas-ctx-item, .atlas-ctx-destructive-btn')].map((row) => { const r = row.getBoundingClientRect(); return { text: row.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      }));
      const labels = top.map((row) => row.text);
      check('the token menu is Atlas\'s, in its order', JSON.stringify(labels) === JSON.stringify(['Conditions', 'Hide', 'Add to Initiative', 'Change mini…', 'Remove mini', 'Show as standee', 'Reset (Restore Resources, Clear Status)', 'Kill', 'Delete']), labels);
      await page.screenshot({ path: `${shots}/board-16-menu.png` });
      const conditionsRow = top[0];
      await page.mouse.move(conditionsRow.x, conditionsRow.y);
      await wait(150);
      const sub = () => page.evaluate(() => {
        const menu = document.querySelectorAll('.atlas-ctx-menu')[1];
        if (!menu) return null;
        return [...menu.querySelectorAll(':scope > .atlas-ctx-item')].map((row) => { const r = row.getBoundingClientRect(); return { text: row.querySelector('.atlas-ctx-item__label')?.textContent, x: r.left + 20, y: r.top + r.height / 2, checked: row.querySelector('.atlas-ctx-item__check')?.getAttribute('data-state'), badge: !!row.querySelector('.atlas-condition-badge'), stepper: row.querySelector('.atlas-ctx-stepper__value')?.textContent ?? null, plus: (() => { const b = row.querySelectorAll('.atlas-ctx-stepper__button')[1]; if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })() }; });
      });
      let conditions = await sub();
      check('hovering Conditions opens its submenu: each condition with its badge, the hero\'s two ticked', conditions && conditions.length === 3 && conditions.every((c) => c.badge) && conditions[0].checked === 'checked' && conditions[1].checked === 'checked' && conditions[2].checked === 'unchecked' && conditions[2].stepper === '0', conditions);
      await page.screenshot({ path: `${shots}/board-17-conditions.png` });
      await page.mouse.move(conditions[0].x + 30, conditions[0].y);
      await page.mouse.click(conditions[0].x, conditions[0].y);
      await wait(100);
      conditions = await sub();
      check('choosing a condition takes it off and the submenu stays open', conditions && conditions[0].checked === 'unchecked' && (await page.evaluate(() => window.boardTest.board.tokens.get('hero').token.conditions)).join() === 'c-frightened', { conditions, actions: (await record()).menuActions, hero: await page.evaluate(() => window.boardTest.board.tokens.get('hero').token.conditions), menus: await page.evaluate(() => [...document.querySelectorAll('.atlas-ctx-menu')].map((m) => m.getBoundingClientRect().left)) });
      await page.mouse.move(conditions[2].x + 30, conditions[2].y);
      await page.mouse.click(conditions[2].plus.x, conditions[2].plus.y);
      await page.mouse.click(conditions[2].plus.x, conditions[2].plus.y);
      await wait(100);
      conditions = await sub();
      const hero = await page.evaluate(() => window.boardTest.board.tokens.get('hero').token);
      check('+ on a valued condition gains it and raises it', conditions[2].stepper === '2' && conditions[2].checked === 'checked' && hero.conditionValues['c-exhaustion'] === 2, { conditions, values: hero.conditionValues });
      await page.keyboard.press('Escape');
      await wait(100);
      check('Escape closes the menu', await page.evaluate(() => document.querySelectorAll('.atlas-ctx-menu').length === 0));

      const choose = async (label) => {
        await page.mouse.click(heroAt2.x, heroAt2.y, { button: 'right' });
        await wait(150);
        const row = await page.evaluate((label) => {
          const found = [...document.querySelectorAll('.atlas-ctx-menu .atlas-ctx-item, .atlas-ctx-menu .atlas-ctx-destructive-btn')].find((r) => r.textContent === label);
          if (!found) return null;
          const r = found.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, label);
        if (row) await page.mouse.click(row.x, row.y);
        await wait(100);
        return row !== null;
      };
      await choose('Add to Initiative');
      check('Add to Initiative, and the menu then offers Remove', (await choose('Remove from Initiative')) && JSON.stringify((await record()).menuActions.filter((a) => a[0] === 'initiative')) === '[["initiative",true],["initiative",false]]', (await record()).menuActions);
      await choose('Reset (Restore Resources, Clear Status)');
      const reset = await page.evaluate(() => { const t = window.boardTest.board.tokens.get('hero').token; return { hp: t.resources.hp, conditions: t.conditions }; });
      check('Reset fills HP and clears the conditions', reset.hp.current === reset.hp.max && reset.conditions.length === 0, reset);
      await choose('Kill');
      check('Kill spends the hero\'s HP', (await page.evaluate(() => window.boardTest.board.tokens.get('hero').token.resources.hp.current)) === 0);
      await choose('Reset (Restore Resources, Clear Status)');
      await choose('Hide');
      check('Hide hides the token, and the menu then offers Show', (await page.evaluate(() => window.boardTest.board.tokens.get('hero').token.hidden)) && (await choose('Show')) && !(await page.evaluate(() => window.boardTest.board.tokens.get('hero').token.hidden)));
      check('a chosen row closes the menu', await page.evaluate(() => document.querySelectorAll('.atlas-ctx-menu').length === 0));
    }

    // 4. A right-drag on empty board pans and moves nothing.
    const movesBefore = (await record()).moves.length;
    let before = await goal();
    const empty = await project(560, 760, 0);
    await drag(empty, { x: empty.x + 120, y: empty.y - 60 }, 'right');
    let after = await goal();
    r = await record();
    check('right-drag pans the camera', Math.hypot(after.target.x - before.target.x, after.target.z - before.target.z) > 1, { before: before.target, after: after.target });
    check('right-drag moves no token', r.moves.length === movesBefore, r.moves);

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
    check('ctrl-drag on a prop moves no token', r.moves.length === movesBefore, r.moves);

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
    check('a lost drag saves nothing', movesAfterLost === movesBefore, movesAfterLost);

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

    // 12b. A combatant kept beside the map (Atlas 0.9's `offMap`) is no part of the board.
    {
      const beside = await page.evaluate(() => {
        const b = window.boardTest.board;
        b.map.tokens = [...b.map.tokens, { ...b.map.tokens[0], id: 'beside', x: -105, y: 35, offMap: true }];
        b.refresh();
        const drawn = b.tokens.has('beside');
        b.map.tokens = b.map.tokens.filter((t) => t.id !== 'beside');
        b.refresh();
        return drawn;
      });
      check('a combatant kept beside the map is not drawn on the board', beside === false);
    }

    // 13. Atlas's initiative tracker at the board's right edge: I shows it; cards, a fight, turns by the arrows, the
    //     card's menu, the edit popup, rolling, dragging, a fight by sides, Clear.
    {
      const cards = () => page.evaluate(() => [...document.querySelectorAll('.tabletop-initiative-card')].map((card) => {
        const r = card.getBoundingClientRect();
        return {
          id: card.dataset.entry, x: r.left + r.width / 2, y: r.top + r.height / 2, cls: card.className,
          number: card.querySelector('.tabletop-initiative-card__initiative')?.textContent ?? null,
          badge: card.querySelector('.tabletop-initiative-card__instance-badge')?.textContent ?? null,
          hidden: !!card.querySelector('.tabletop-initiative-card__hidden-badge'),
          bars: [...card.querySelectorAll('.tabletop-initiative-card__hp-fill')].map((fill) => fill.style.width),
          ring: card.querySelector('.atlas-token-ring')?.style.getPropertyValue('--atlas-token-ring-color') ?? null,
          side: card.closest('.tabletop-initiative-side')?.querySelector('.tabletop-initiative-side__label')?.textContent ?? null,
        };
      }));
      const tracker = () => page.evaluate(() => {
        const panel = document.querySelector('.tabletop-initiative-tracker');
        if (!panel || panel.closest('[hidden]')) return null;
        const buttons = [...panel.querySelectorAll('.tabletop-initiative-tracker__btn')].map((button) => ({ icon: button.dataset.icon ?? (button.querySelector('svg') ? 'truce' : ''), label: button.getAttribute('aria-label'), disabled: button.disabled, pressed: button.classList.contains('tabletop-initiative-tracker__btn--pressed') }));
        return { buttons, round: panel.querySelector('.tabletop-initiative-tracker__round')?.textContent, empty: panel.querySelector('.tabletop-initiative-tracker__empty')?.textContent ?? null, rect: panel.getBoundingClientRect().toJSON() };
      });
      const click = async (selector) => {
        const at = await page.evaluate((selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, selector);
        await page.mouse.click(at.x, at.y);
        await wait(100);
      };
      const ids = async () => (await cards()).map((card) => card.id.slice(2)).join(',');
      const active = async () => (await cards()).find((card) => card.cls.includes('--active'))?.id ?? null;

      await page.keyboard.press('Escape');
      await page.evaluate(() => { window.boardTest.board.select(null); window.boardTest.board.canvas.focus(); });
      check('the tracker is hidden until shown', (await tracker()) === null);
      await page.keyboard.press('i');
      await wait(100);
      let shown = await tracker();
      check('I shows the tracker at the board\'s right edge, centred', shown !== null && Math.abs(shown.rect.right - 988) < 2 && Math.abs((shown.rect.top + shown.rect.bottom) / 2 - 320) < 2, shown && shown.rect);
      check('its controls are Atlas\'s: Roll, Start combat, Clear; the turn arrows idle, no round', shown && JSON.stringify(shown.buttons.map((b) => [b.icon, b.label, b.disabled])) === JSON.stringify([['dices', 'Roll initiative', false], ['swords', 'Start combat', false], ['trash-2', 'Clear initiative', false], ['chevron-up', null, true], ['chevron-down', null, true]]) && shown.round === '—', shown);
      let list = await cards();
      check('a card per combatant in order, with its number', list.map((c) => `${c.id}:${c.number}`).join() === 'e-hero:18,e-gob:12,e-gob2:9,e-orc:5', list);
      check('copies show their number; the hidden orc its eye; bars of the resources that defeat; the ring in the token\'s colour', list[1].badge === '1' && list[2].badge === '2' && list[0].badge === null && list[3].hidden && list[3].cls.includes('--hidden') && list[0].bars.length === 1 && Math.abs(parseFloat(list[0].bars[0]) - 74.07) < 0.1 && list[0].ring === '#ffffff', list);

      await click('[aria-label="Start combat"]');
      shown = await tracker();
      check('Start combat: round 1, the first combatant\'s turn, End combat in red', (await active()) === 'e-hero' && shown.round === 'R1' && shown.buttons[1].label === 'End combat' && shown.buttons[1].icon === 'truce', shown);
      await page.evaluate(() => window.boardTest.board.canvas.focus());
      const camBefore = await page.evaluate(() => ({ ...window.boardTest.board.camera.goal.target }));
      await page.keyboard.press('ArrowDown');
      await wait(30);
      const pressed = (await tracker()).buttons[4].pressed;
      await wait(300);
      const camAfter = await page.evaluate(() => ({ ...window.boardTest.board.camera.goal.target }));
      check('↓ passes the turn (the arrow shows the press) and does not move the camera in a fight', (await active()) === 'e-gob' && pressed && camBefore.x === camAfter.x && camBefore.z === camAfter.z, { pressed, camBefore, camAfter });
      await page.keyboard.press('ArrowUp');
      await wait(50);
      check('↑ gives the turn back', (await active()) === 'e-hero');

      list = await cards();
      await page.mouse.click(list[2].x, list[2].y);
      await wait(100);
      check('a card\'s click shows its token: the camera goes to it, it is selected', (await record()).shown.at(-1) === 'gob2' && (await page.evaluate(() => window.boardTest.board.selectedId)) === 'gob2', (await record()).shown);
      await page.evaluate(() => window.boardTest.board.select(null));

      const menuRows = () => page.evaluate(() => [...document.querySelectorAll('.atlas-ctx-menu .atlas-ctx-item')].map((row) => { const r = row.getBoundingClientRect(); return { text: row.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2, destructive: row.classList.contains('atlas-ctx-item--destructive') }; }));
      const choose = async (cardId, label) => {
        const card = (await cards()).find((c) => c.id === cardId);
        await page.mouse.click(card.x, card.y, { button: 'right' });
        await wait(150);
        const rows = await menuRows();
        const row = rows.find((r) => r.text === label);
        if (row) await page.mouse.click(row.x, row.y);
        await wait(150);
        return rows;
      };
      const rows = await choose('e-hero', 'Move to Back');
      check('the card\'s menu is Atlas\'s, Remove in red', JSON.stringify(rows.map((r) => r.text)) === JSON.stringify(['Roll Initiative', 'Move to Front', 'Move to Back', 'Edit Initiative', 'Hide from Players', 'Remove from Initiative']) && rows[5].destructive, rows);
      check('Move to Back puts it last', (await ids()) === 'gob,gob2,orc,hero', await ids());

      await choose('e-orc', 'Edit Initiative');
      const popup = await page.evaluate(() => ({ inputs: [...document.querySelectorAll('.tabletop-initiative-edit-popup input')].map((i) => [i.value, i.placeholder]), hint: document.querySelector('.tabletop-initiative-edit-popup__hint')?.textContent, focused: document.activeElement?.className }));
      check('the popup is on the page\'s body, as Atlas portals it', await page.evaluate(() => document.querySelector('.tabletop-initiative-edit-popup').parentElement.parentElement === document.body));
      check('Edit Initiative opens Atlas\'s popup: the total (focused) and the modifier ("auto" when none)', JSON.stringify(popup.inputs) === JSON.stringify([['5', '0'], ['', 'auto']]) && popup.hint === 'Enter to save · Esc to cancel' && popup.focused === 'tabletop-initiative-edit-popup__input', popup);
      await page.keyboard.press('Control+A');
      await page.keyboard.type('20');
      await page.keyboard.press('Enter');
      await wait(100);
      check('Enter saves the total and the list re-sorts', (await ids()).startsWith('orc') && (await cards())[0].number === '20' && (await page.evaluate(() => !document.querySelector('.tabletop-initiative-edit-popup'))), await ids());
      await page.screenshot({ path: `${shots}/board-18-initiative.png` });
      // A redraw keeps a scrolled list where it was (not glided back from the top).
      const scrolled = await page.evaluate(() => {
        const content = document.querySelector('.tabletop-initiative-tracker__content');
        content.style.scrollBehavior = 'auto';
        content.scrollTop = content.scrollHeight;
        content.style.scrollBehavior = '';
        const before = content.scrollTop;
        window.boardTest.panel.render();
        return { before, after: document.querySelector('.tabletop-initiative-tracker__content').scrollTop };
      });
      check('the list overflows here, and a redraw keeps its scroll at once', scrolled.before > 0 && scrolled.after === scrolled.before, scrolled);
      // A combatant whose token is gone (deleted while Atlas's tracker was closed) gets no card.
      await page.evaluate(() => {
        const map = window.boardTest.board.map;
        map.initiative = { ...map.initiative, entries: [...map.initiative.entries, { id: 'e-ghost', tokenId: 'ghost', name: 'Ghost', initiative: 1, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: true, order: 4 }] };
        window.boardTest.panel.render();
      });
      check('an entry without its token gets no card', (await cards()).every((c) => c.id !== 'e-ghost') && (await cards()).length === 4, await ids());
      await page.evaluate(() => {
        const map = window.boardTest.board.map;
        map.initiative = { ...map.initiative, entries: map.initiative.entries.filter((e) => e.id !== 'e-ghost') };
        window.boardTest.panel.render();
      });

      await click('[aria-label="Roll initiative"]');
      list = await cards();
      const numbers = list.map((c) => Number(c.number));
      const rolled = (await record()).initiative.filter((a) => a.type === 'roll');
      check('Roll rolls everyone (the hero, last, rolls 3 and adds its +2) and sorts highest first', rolled.length === 1 && numbers.every((n, i) => i === 0 || numbers[i - 1] >= n) && list.find((c) => c.id === 'e-hero').number === '5', list.map((c) => `${c.id}:${c.number}`));

      const before = await ids();
      // The browser's own drag events, as a mouse drag sends them (Playwright's drag scrolls the list as it goes).
      await page.evaluate(([from, to]) => {
        const source = document.querySelector(`[data-entry="${from}"]`);
        const target = document.querySelector(`[data-entry="${to}"]`);
        const transfer = new DataTransfer();
        const r = target.getBoundingClientRect();
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: r.top + 2 }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
      }, [list[3].id, list[0].id]);
      await wait(100);
      const reorder = (await record()).initiative.filter((a) => a.type === 'reorder').at(-1);
      check('dragging a card onto another moves it to that place', reorder && reorder.from === 3 && reorder.to === 0 && (await ids()).split(',')[0] === before.split(',')[3], { reorder, before, after: await ids() });

      // A fight by sides (Cairn): the cards under their side, no numbers, no Roll; the turn belongs to a side.
      await click('[aria-label="End combat"]');
      await page.evaluate(() => { window.boardTest.rules.initiative = { mode: 'sides', roll: '1d20', firstSide: 'players' }; window.boardTest.panel.render(); });
      await choose('e-hero', 'Move to Players');
      list = await cards();
      shown = await tracker();
      check('by sides: Players then Opponents, no numbers, no Roll', list.find((c) => c.id === 'e-hero').side === 'Players' && list.filter((c) => c.side === 'Opponents').length === 3 && list.every((c) => c.number === null) && shown.buttons[0].label === 'Start combat', { list, shown });
      await click('[aria-label="Start combat"]');
      const sideState = () => page.evaluate(() => ({ active: document.querySelector('.tabletop-initiative-side--active .tabletop-initiative-side__label')?.textContent, round: document.querySelector('.tabletop-initiative-tracker__round')?.textContent, cards: document.querySelectorAll('.tabletop-initiative-card--active').length }));
      check('the players\' side acts first; no card has the turn by itself', JSON.stringify(await sideState()) === JSON.stringify({ active: 'Players', round: 'R1', cards: 0 }), await sideState());
      const sitRows = await choose('e-gob', 'Sit Out This Round');
      check('in a running fight by sides a card can sit the round out', sitRows.some((r) => r.text === 'Sit Out This Round') && (await cards()).find((c) => c.id === 'e-gob').cls.includes('--sitting-out'), sitRows.map((r) => r.text));
      await page.evaluate(() => window.boardTest.board.canvas.focus());
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await wait(50);
      check('the turns pass side to side into round 2, which clears sitting out', JSON.stringify(await sideState()) === JSON.stringify({ active: 'Players', round: 'R2', cards: 0 }) && !(await cards()).find((c) => c.id === 'e-gob').cls.includes('--sitting-out'), await sideState());
      await page.screenshot({ path: `${shots}/board-19-initiative-sides.png` });

      await click('[aria-label="Clear initiative"]');
      shown = await tracker();
      check('Clear empties the tracker and ends the fight', shown.empty === 'Right-click a token to add it' && shown.round === '—' && (await cards()).length === 0, shown);
      await page.evaluate(() => window.boardTest.board.canvas.focus());
      await page.keyboard.press('i');
      await wait(50);
      check('I hides it again', (await tracker()) === null);
      await page.evaluate(() => { window.boardTest.rules.initiative = { mode: 'turn-order', roll: '1d20', firstSide: 'players' }; });
    }

    // 14. Atlas's walls, doors and lights: walls as tall as the fog, a door that swings open on a click, menus on a
    //     right-click, a material dragged on (a segment, or with Shift the whole wall), the dark and the lights.
    {
      await page.keyboard.press('Escape');
      await page.evaluate(() => { const b = window.boardTest.board; b.select(null); b.camera.frame({ x: 560, y: 0, z: 910 }, 260); b.camera.orbit(0, 5); b.camera.snap(); b.camera.snap(); b.wake(true); });
      await wait(600);
      const walls = await page.evaluate(() => {
        const set = window.boardTest.board.walls;
        const open = set.meshes.filter((m) => !m.mesh.userData.fogged);
        const arrow = set.gmOnly.children[0].geometry.attributes.position.array;
        return { fog: window.boardTest.board.host.fogHeight(), meshes: open.length, boxes: open.reduce((n, m) => n + m.ids.length, 0), doors: set.doors.size, height: Math.max(...open[0].mesh.geometry.attributes.position.array.filter((_, i) => i % 3 === 1)), gmOnly: set.gmOnly.children.length, arrowTipX: arrow[0] };
      });
      check('the walls stand as one mesh of six segments, as tall as the fog; three doors; the one-way arrow', walls.meshes === 1 && walls.boxes === 6 && walls.doors === 3 && Math.abs(walls.height - 70 * walls.fog) < 0.01 && walls.gmOnly === 1, walls);
      // The west wall runs north; Atlas's `left` stops light from the east side of… its normal (−dy, dx) points east: light passes eastward.
      check('the one-way arrow points the way Atlas lets light through', walls.arrowTipX > 455, walls.arrowTipX);
      const fogged = await page.evaluate(() => {
        const b = window.boardTest.board;
        const seen = () => ({ wall: b.walls.meshes.filter((m) => m.mesh.userData.fogged).map((m) => m.mesh.visible), door: b.walls.doors.get('fogdoor').pivot.visible, room: b.walls.doors.get('door').pivot.visible });
        b.showFor('player');
        const player = seen();
        b.showFor('gm');
        return { player, gm: seen() };
      });
      check('walls and doors under the fog are hidden from players, not from the GM', JSON.stringify(fogged) === JSON.stringify({ player: { wall: [false], door: false, room: true }, gm: { wall: [true], door: true, room: true } }), fogged);
      const doorTurn = () => page.evaluate(() => window.boardTest.board.walls.doors.get('door').pivot.rotation.y);
      const shutTurn = await doorTurn();
      const doorAt = await project(560, 840, 35);
      await page.mouse.click(doorAt.x, doorAt.y);
      await page.waitForFunction(() => { const d = window.boardTest.board.walls.doors.get('door'); return d.openness === d.goal; }, null, { timeout: 10000 });
      const openTurn = await doorTurn();
      check('a click on a door opens it (saved through the host) and it swings a quarter turn', (await record()).doors.at(-1) === 'door' && Math.abs(Math.abs(openTurn - shutTurn) - Math.PI / 2) < 0.01, { shutTurn, openTurn, doors: (await record()).doors });
      await page.screenshot({ path: `${shots}/board-20-walls.png` });
      await page.evaluate(() => { const w = window.boardTest.board.map.walls.find((x) => x.id === 'door'); w.locked = true; });
      await page.mouse.click(doorAt.x, doorAt.y);
      await wait(100);
      check('a locked door does not move on the board', Math.abs((await doorTurn()) - openTurn) < 1e-6);
      await page.evaluate(() => { const w = window.boardTest.board.map.walls.find((x) => x.id === 'door'); w.locked = false; });
      const east = await project(665, 910, 35);
      await page.mouse.click(east.x, east.y, { button: 'right' });
      await wait(100);
      check('a right-click on a wall opens its menu', (await record()).wallMenus.at(-1) === 'e', (await record()).wallMenus);

      const drop = (at, shift) => page.evaluate(([x, y, shift]) => {
        const canvas = window.boardTest.board.canvas;
        const transfer = new DataTransfer();
        transfer.setData('application/x-atlas-tabletop-material', 'atlas-vtt/assets/materials/Bricks');
        canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y, shiftKey: shift }));
        const tip = document.querySelector('.atlas-tabletop-tooltip').textContent;
        canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y, shiftKey: shift }));
        return tip;
      }, [at.x, at.y, shift]);
      const tip = await drop(east, false);
      let meshes = await page.evaluate(() => window.boardTest.board.walls.meshes.filter((m) => !m.mesh.userData.fogged).map((m) => m.ids.length));
      check('a material dropped on a wall paints that segment alone (the tip says so)', JSON.stringify((await record()).paints.at(-1)) === JSON.stringify(['e', 'atlas-vtt/assets/materials/Bricks', false]) && tip.startsWith('Paint this segment') && JSON.stringify(meshes.sort()) === JSON.stringify([1, 5]), { tip, meshes });
      await drop(east, true);
      await wait(300);
      meshes = await page.evaluate(() => window.boardTest.board.walls.meshes.filter((m) => !m.mesh.userData.fogged).map((m) => [m.ids.length, !!m.mesh.material.map]));
      check('with Shift it paints the whole wall drawn with it, its texture on', (await record()).paints.at(-1)[2] === true && meshes.length === 1 && meshes[0][0] === 6 && meshes[0][1], meshes);

      // Only plain text got through (another window, another app's drag handling): the drop still paints.
      await page.evaluate(([x, y]) => {
        const canvas = window.boardTest.board.canvas;
        const transfer = new DataTransfer();
        transfer.setData('text/plain', 'atlas-tabletop-material:atlas-vtt/assets/materials/Wood');
        canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
        canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
      }, [east.x, east.y]);
      check('a drop carrying only plain text paints too', JSON.stringify((await record()).paints.at(-1)) === JSON.stringify(['e', 'atlas-vtt/assets/materials/Wood', false]), (await record()).paints.at(-1));
      // Without dragging: a material chosen in the gallery paints each wall clicked, until Esc.
      await page.evaluate(() => window.boardTest.board.paintWith('atlas-vtt/assets/materials/Stone'));
      await page.mouse.click(east.x, east.y);
      await page.keyboard.down('Shift');
      await page.mouse.click(east.x, east.y);
      await page.keyboard.up('Shift');
      await wait(100);
      const painted = (await record()).paints.slice(-2);
      await page.keyboard.press('Escape');
      check('click-to-paint: a click paints a segment, Shift-click the whole wall; Esc stops', JSON.stringify(painted) === JSON.stringify([['e', 'atlas-vtt/assets/materials/Stone', false], ['e', 'atlas-vtt/assets/materials/Stone', true]]) && !(await page.evaluate(() => window.boardTest.board.isPainting)), painted);
      await page.evaluate(() => window.boardTest.board.paintWith(null));
      // A wall's own height: the east segment two squares, the rest still as tall as the fog.
      const tops = await page.evaluate(() => {
        const b = window.boardTest.board;
        window.boardTest.wallHeights.set('e', 2);
        b.refresh();
        const top = (ids) => Math.max(...b.walls.meshes.filter((m) => !m.mesh.userData.fogged && ids(m.ids)).flatMap((m) => [...m.mesh.geometry.attributes.position.array].filter((_, i) => i % 3 === 1)));
        // The east wall's box is the one of its mesh's segments whose top is highest.
        const all = top(() => true);
        window.boardTest.wallHeights.delete('e');
        b.refresh();
        return { raised: all, back: top(() => true), fog: b.host.fogHeight() };
      });
      check('a wall stands at its own height when set, and as tall as the fog again when not', tops.raised === 140 && tops.back === 70 * tops.fog, tops);
      const lights = await page.evaluate(() => {
        const rig = window.boardTest.board.rig;
        return [...rig.entries.values()].map((e) => ({ id: e.light.id, kind: e.lamp.type, reach: e.lamp.distance, y: e.lamp.position.y, x: e.lamp.position.x, bulb: !!e.bulb, bright: e.lamp.decay }));
      });
      check('Atlas\'s bright radius is carried to the falloff: the torch is bright to half its reach, the magic light only dim', lights[0].bright === 0.5 && lights[1].bright === 0, lights.map((l) => [l.id, l.bright]));
      check('in daylight no flame flickers, so the board rests', !(await page.evaluate(() => window.boardTest.board.rig.animated)));
      check('each light hangs a square up and reaches its dim radius (40 ft = 8 squares); a token\'s has no bulb', lights.length === 3 && lights[0].reach === 560 && lights[0].y === 70 && lights[0].bulb && !lights[2].bulb && lights[2].x === 875, lights);
      await page.evaluate(() => { window.boardTest.board.toolbar.actions.setAmbient(0.12, true); });
      await wait(400);
      const dark = await page.evaluate(() => ({ sky: window.boardTest.board.hemisphere.intensity, sun: window.boardTest.board.sun.castShadow, casting: [...window.boardTest.board.rig.entries.values()].filter((e) => e.lamp.castShadow).length, animated: window.boardTest.board.rig.animated }));
      check('the ambient slider darkens the board (the sun casts no shadow then); the nearest lights cast shadows; flames flicker', (await record()).ambients.at(-1) === 0.12 && Math.abs(dark.sky - 0.18) < 1e-6 && !dark.sun && dark.casting === 2 && dark.animated, dark);
      const intensities = [];
      for (let i = 0; i < 3; i++) { intensities.push(await page.evaluate(() => window.boardTest.board.rig.entries.get('torch').lamp.intensity)); await wait(120); }
      check('the torch flickers', new Set(intensities.map((v) => v.toFixed(3))).size > 1, intensities);
      await wait(300);
      // The hero's mini plays its idle clip, which keeps frames coming by itself: stopped, the board rests between flickers.
      const resting = await page.evaluate(async () => {
        const b = window.boardTest.board;
        const pieces = [...b.tokens.values()].map((entry) => entry.piece);
        const kept = pieces.map((piece) => Object.getOwnPropertyDescriptor(piece, 'animating'));
        pieces.forEach((piece) => Object.defineProperty(piece, 'animating', { value: false, configurable: true }));
        await new Promise((resolve) => setTimeout(resolve, 400));
        // Sampled over a while: between a timer firing and its frame there is a moment with neither.
        const seen = { continuing: false, timer: false };
        for (let i = 0; i < 20; i++) {
          seen.continuing ||= b.continuing;
          seen.timer ||= b.flickerTimer !== 0;
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        pieces.forEach((piece, i) => { if (kept[i]) Object.defineProperty(piece, 'animating', kept[i]); else delete piece.animating; });
        b.wake();
        return seen;
      });
      check('flames flicker on a timer while nothing moves, not on a frame loop', !resting.continuing && resting.timer, resting);
      await page.screenshot({ path: `${shots}/board-21-dark.png` });
      const bulb = await project(490, 875, 70);
      await page.mouse.click(bulb.x, bulb.y, { button: 'right' });
      await wait(100);
      check('a right-click on a light\'s bulb opens its menu', (await record()).lightMenus.at(-1) === 'torch', (await record()).lightMenus);
      await page.keyboard.press('Escape');
      const gmOnly = await page.evaluate(() => {
        const b = window.boardTest.board;
        b.showFor('player');
        const seen = { arrows: b.walls.gmOnly.visible, bulbs: [...b.rig.entries.values()].some((e) => e.bulb && e.bulb.visible), accent: b.walls.doors.get('secret').pivot.children.some((c) => c.userData.gmOnly && c.visible) };
        b.showFor('gm');
        return seen;
      });
      check('players see no bulb, no one-way arrow and no secret door\'s accent', !gmOnly.arrows && !gmOnly.bulbs && !gmOnly.accent, gmOnly);

      // A token carrying a light has its height in its menu.
      await page.keyboard.press('Escape');
      await page.evaluate(() => { const b = window.boardTest.board; b.camera.frame({ x: 875, y: 0, z: 385 }, 300); b.camera.snap(); b.wake(true); });
      await wait(500);
      const carrier = await project(875, 385, 20);
      await page.mouse.click(carrier.x, carrier.y, { button: 'right' });
      await wait(150);
      const carrierRows = await page.evaluate(() => [...document.querySelectorAll('.atlas-ctx-menu .atlas-ctx-item')].map((row) => row.textContent));
      check('a token carrying a light has a Light height row', carrierRows.some((text) => text.startsWith('Light height') && text.includes('1 sq')), carrierRows);
      await page.keyboard.press('Escape');

      // Ctrl + drag up on a wall raises it, on a light's bulb raises the light; the drag shows its height as it goes.
      const ctrlDrag = async (from, dy) => {
        await page.keyboard.down('Control');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(from.x, from.y - (dy * i) / 8);
        const tip = await page.evaluate(() => document.querySelector('.atlas-tabletop-tooltip').textContent);
        await page.mouse.up();
        await page.keyboard.up('Control');
        await wait(150);
        return tip;
      };
      await page.evaluate(() => { const b = window.boardTest.board; b.camera.frame({ x: 560, y: 0, z: 910 }, 260); b.camera.orbit(0, 5); b.camera.snap(); b.wake(true); });
      await wait(500);
      const eastNow = await project(665, 910, 35);
      const wallTip = await ctrlDrag(eastNow, 80);
      const raised = (await record()).heights.at(-1);
      check('Ctrl + drag up on a wall raises it and keeps its height', raised && raised[0] === 'wall' && raised[1] === 'e' && raised[2] > walls.fog && wallTip.startsWith('Height '), { raised, wallTip, fog: walls.fog });
      await page.evaluate(() => { window.boardTest.wallHeights.delete('e'); window.boardTest.board.refresh(); });
      const lamp = await project(490, 875, 70);
      await ctrlDrag(lamp, 60);
      await wait(200);
      const lifted = (await record()).heights.at(-1);
      const lampY = await page.evaluate(() => window.boardTest.board.rig.entries.get('torch').lamp.position.y);
      check('Ctrl + drag up on a light\'s bulb raises the light', lifted && lifted[0] === 'light' && lifted[1] === 'torch' && lifted[2] > 1 && Math.abs(lampY - lifted[2] * 70) < 0.01, { lifted, lampY });
      // A door replaced by a prop from the gallery: fitted to the opening, it swings like the plain door.
      await page.evaluate(() => { window.boardTest.doorProps.set('door', 'props/barrel.glb'); window.boardTest.board.refresh(); });
      await page.waitForFunction(() => window.boardTest.board.walls.doors.get('door').leaf.userData.depth !== undefined, null, { timeout: 10000 });
      const fitted = await page.evaluate(() => {
        const door = window.boardTest.board.walls.doors.get('door');
        door.pivot.updateMatrixWorld(true);
        const THREE = window.boardTest;
        const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        door.leaf.traverse((node) => {
          if (!node.isMesh) return;
          node.geometry.computeBoundingBox();
          const b = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
          box.min = box.min.map((v, i) => Math.min(v, b.min.toArray()[i]));
          box.max = box.max.map((v, i) => Math.max(v, b.max.toArray()[i]));
        });
        return { open: door.openness, x: [box.min[0], box.max[0]], y: [box.min[1], box.max[1]], z: [box.min[2], box.max[2]] };
      });
      // Open, its leaf turned a quarter toward the north: it runs from the hinge (525, 840) up the map, as tall as the wall.
      check('a door prop fills the opening on the hinge and stays open', fitted.open === 1 && Math.abs(fitted.z[0] - 770) < 2 && Math.abs(fitted.z[1] - 840) < 12 && Math.abs(fitted.y[1] - 70 * (await page.evaluate(() => window.boardTest.board.host.fogHeight()))) < 1, fitted);
      await page.screenshot({ path: `${shots}/board-22-door-prop.png` });
      await page.evaluate(() => { window.boardTest.board.toolbar.actions.setAmbient(1, true); });
    }

    // 22b. Board settings: the default wall height (which the fog takes too) and the walls' thickness.
    {
      const panel = await page.evaluate(() => {
        window.boardTest.board.toolbar.open();
        const labels = [...document.querySelectorAll('.atlas-tabletop-palette__label')].map((label) => label.textContent);
        const thickness = document.querySelector('input[aria-label="Wall thickness in squares"]');
        return { labels, thickness: thickness ? thickness.value : null };
      });
      check('settings name the default wall height and offer the wall thickness', panel.labels.includes('Default wall height') && !panel.labels.includes('Fog height') && panel.labels.includes('Wall thickness') && panel.thickness === '0.12', panel);
      // The walls are built from their shape: its thickness (map pixels) is the third entry of what they were built from.
      const depth = () => page.evaluate(() => JSON.parse(window.boardTest.board.walls.signature)[2]);
      const before = await depth();
      await page.evaluate(() => {
        const input = document.querySelector('input[aria-label="Wall thickness in squares"]');
        input.value = '0.5';
        input.dispatchEvent(new Event('change'));
      });
      await wait(300);
      const after = await depth();
      check('a thicker setting makes the walls thicker (0.12 → 0.5 of a square)', Math.abs(before - 70 * 0.12) < 0.5 && Math.abs(after - 70 * 0.5) < 0.5, { before, after, record: (await record()).thicknesses });
      await page.evaluate(() => {
        const input = document.querySelector('input[aria-label="Wall thickness in squares"]');
        input.value = '0.12';
        input.dispatchEvent(new Event('change'));
        window.boardTest.board.toolbar.close();
      });
      await wait(300);
    }

    // 23. The board never shows a blank frame: resizing a WebGL canvas wipes it, so a resize is drawn again before the
    // page paints, and a resize to the same size does not wipe it at all.
    {
      const blanks = await page.evaluate(async () => {
        const board = window.boardTest.board;
        const renderer = board.renderer;
        const events = [];
        const setSize = renderer.setSize;
        const render = renderer.render;
        // A wipe must be drawn over in the same task: the page may paint before any later frame.
        renderer.setSize = function (...args) { events.push('size'); queueMicrotask(() => events.push('frame')); return setSize.apply(this, args); };
        renderer.render = function (...args) { events.push('render'); return render.apply(this, args); };
        let ticking = true;
        const tick = () => { events.push('frame'); if (ticking) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const container = document.getElementById('board');
        const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await frames();
        container.style.width = '999px';
        await frames();
        await frames();
        container.style.width = '1000px';
        await frames();
        await frames();
        const sized = events.filter((event) => event === 'size').length;
        board.fit();
        const sameSize = events.filter((event) => event === 'size').length - sized;
        ticking = false;
        renderer.setSize = setSize;
        renderer.render = render;
        // Every wipe must be followed by a drawing before the next animation frame starts.
        const wiped = [];
        events.forEach((event, index) => {
          if (event !== 'size') return;
          const after = events.slice(index + 1);
          const drawn = after.indexOf('render');
          const frame = after.indexOf('frame');
          if (drawn === -1 || (frame !== -1 && frame < drawn)) wiped.push(index);
        });
        return { sizes: sized, sameSize, wiped, events: events.join(' ') };
      });
      check('a resize is drawn again before the page paints (no blank frame)', blanks.sizes >= 2 && blanks.wiped.length === 0, blanks);
      check('fitting to the same size does not wipe the canvas', blanks.sameSize === 0, blanks);
    }
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
