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
      check('the fog stands on the map, one block per area', f.meshes === 2, f);
      check('the fog is one square tall by default', Math.abs(f.maxY - f.minY - 70) < 0.01, f);
      const covered = await page.evaluate(() => {
        // The corridor erased through the room is open: no fog over its middle, fog over the room around it.
        const meshes = []; window.boardTest.board.fog.object3d.traverse((n) => { if (n.isMesh) meshes.push(n); });
        const probe = (x, z) => {
          const caster = new (window.boardTest.Raycaster)(new (window.boardTest.Vector3)(x, 500, z), new (window.boardTest.Vector3)(0, -1, 0));
          return caster.intersectObjects(meshes, false).length > 0;
        };
        return { room: probe(1000, 790), corridor: probe(1155, 875), outside: probe(600, 300) };
      });
      check('fog covers the room, not the corridor erased through it', covered.room && !covered.corridor && !covered.outside, covered);
      await page.screenshot({ path: `${shots}/board-8-fog.png` });

      const button = await page.evaluate(() => { const b = document.querySelector('.atlas-tabletop-tool-button[aria-label="Board settings"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      const selBefore = await page.evaluate(() => window.boardTest.board.selected);
      await page.mouse.click(button.x, button.y);
      await wait(150);
      const panel = await page.evaluate(() => {
        const p = document.querySelector('.atlas-tabletop-palette');
        const input = p.querySelector('input');
        return { open: !p.hidden, value: input.value, focused: document.activeElement === input, text: p.textContent };
      });
      check('the toolbar\'s button opens the board settings with the fog height', panel.open && panel.value === '1' && panel.focused && panel.text.includes('Fog of war'), panel);
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
      check('the fog stands two squares tall', Math.abs(f.maxY - f.minY - 140) < 0.01, f);
      const after = await goal();
      check('typing in the settings does not move the camera', JSON.stringify(after.target) === JSON.stringify(camera.target), { camera: camera.target, after: after.target });
      await page.keyboard.type('x');
      await page.keyboard.press('Enter');
      const invalid = await page.evaluate(() => document.querySelector('.atlas-tabletop-palette input').hasAttribute('aria-invalid'));
      check('a height that is not a number is refused', invalid && (await record()).fogHeights.length === 1, invalid);
      await page.keyboard.press('Escape');
      await wait(100);
      check('Escape closes the settings', await page.evaluate(() => document.querySelector('.atlas-tabletop-palette').hidden));
      check('the toolbar takes no press from the board', (await page.evaluate(() => window.boardTest.board.selected)) === selBefore);
      await page.mouse.click(button.x, button.y);
      await wait(100);
      // A corner of the board, clear of the panel.
      const empty = await project(140, 140, 0);
      await page.mouse.click(empty.x, empty.y);
      await wait(100);
      check('a click on the board closes the settings', await page.evaluate(() => document.querySelector('.atlas-tabletop-palette').hidden));
    }

    // 1j2. Moving fog: off by default here; subtle and full redraw it about 20 times a second, and off lets the board rest.
    {
      const frames = async (ms) => page.evaluate((ms) => new Promise((resolve) => {
        const b = window.boardTest.board;
        const render = b.renderer.render.bind(b.renderer);
        let count = 0;
        b.renderer.render = (...args) => { count++; return render(...args); };
        setTimeout(() => { b.renderer.render = render; resolve(count); }, ms);
      }), ms);
      // The test minis play an idle clip, which keeps a board drawing: still them, to see what the fog alone does.
      await page.evaluate(() => { for (const e of window.boardTest.board.tokens.values()) Object.defineProperty(e.piece, 'animating', { get: () => false, configurable: true }); });
      await page.evaluate(() => window.boardTest.board.wake());
      await wait(600);
      const restingOff = await frames(1000);
      check('with fog still, an idle board draws nothing', restingOff <= 1, restingOff);
      const settings = await page.evaluate(() => { const b = document.querySelector('.atlas-tabletop-tool-button[aria-label="Board settings"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      await page.mouse.click(settings.x, settings.y);
      await wait(150);
      await page.selectOption('.atlas-tabletop-palette select', 'full');
      await page.keyboard.press('Escape');
      await wait(500);
      const moving = await frames(1000);
      check('moving fog redraws about 20 times a second, not every display frame', moving >= 12 && moving <= 26, moving);
      const state = await page.evaluate(() => {
        const fog = window.boardTest.board.fog;
        const wisps = fog.object3d.children.find((c) => c.isPoints);
        return { animated: fog.animated, wisps: wisps ? wisps.geometry.attributes.position.count : 0, time: fog.uniforms.uFogTime.value };
      });
      check('at full, wisps drift over the fog', state.animated && state.wisps > 0, state);
      await page.screenshot({ path: `${shots}/board-12-fog-full.png` });
      await page.mouse.click(settings.x, settings.y);
      await wait(150);
      await page.selectOption('.atlas-tabletop-palette select', 'subtle');
      await wait(300);
      const subtle = await page.evaluate(() => window.boardTest.board.fog.object3d.children.some((c) => c.isPoints));
      check('subtle has no wisps', !subtle, subtle);
      await page.selectOption('.atlas-tabletop-palette select', 'off');
      await page.keyboard.press('Escape');
      await wait(600);
      const restingAgain = await frames(1000);
      check('switched off, the board rests again', restingAgain <= 1, restingAgain);
      await page.evaluate(() => { for (const e of window.boardTest.board.tokens.values()) delete e.piece.animating; window.boardTest.board.wake(); });
    }

    // 1k. The local player view: a second window drawing the scene as players see it.
    {
      const tools = () => page.evaluate(() => [...document.querySelectorAll('.atlas-tabletop-tool-button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { label: b.getAttribute('aria-label'), hidden: b.hidden, active: b.classList.contains('is-active'), x: r.left + r.width / 2, y: r.top + r.height / 2 };
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
        return { orc: b.tokens.get('orc').piece.object3d.visible, lurker: b.tokens.get('lurker').piece.object3d.visible, pins: b.pins.every((p) => p.object3d.visible), outline: b.fog.object3d.children.some((c) => c.isLineSegments && c.visible) };
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

      const close = (await tools()).find((t) => t.label === 'Close the player view');
      await page.mouse.click(close.x, close.y);
      await wait(300);
      const after = await page.evaluate(() => ({ player: window.boardTest.board.player, labels: [...document.querySelectorAll('.atlas-tabletop-tool-button')].map((b) => [b.getAttribute('aria-label'), b.hidden]) }));
      check('closing it stops the second drawing and hides the freeze button', after.player === null && after.labels.some(([l]) => l === 'Open the player view'), after);
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
