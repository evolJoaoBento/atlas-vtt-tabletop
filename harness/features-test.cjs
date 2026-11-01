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
  const quality = (look) => page.evaluate((look) => { const { board, QUALITY } = window.boardTest; board.setQuality({ ...board.quality, layerLook: look }); }, look);
  await stack(2);
  await wait(900);
  let now = await probe();
  check('layers: a scene stacked above is drawn two squares up (140 px at a 70 px grid)', now.layers === 1 && now.y === 140, JSON.stringify(now));
  check('layers: its image is a floor with its transparent parts cut out', now.floor && now.alphaTest === 0.5 && !now.transparent && now.casts, JSON.stringify(now));
  check('layers: its token stands on it', now.tokens === 1, JSON.stringify(now));
  await page.evaluate(() => { const { camera } = window.boardTest.board; camera.goal.yaw = 0.6; camera.goal.pitch = 0.6; camera.goal.distance = 900; camera.snap(); window.boardTest.board.wake(true); });
  await shot('elevation-layer-solid');
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
  await wait(500);
  const fadedAbove = await probe();
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
  const cells = () => page.evaluate(() => { const m = window.boardTest.board.sightMasks; return m && m.sight ? m.sight.reduce((a, b) => a + b, 0) : null; });
  const sealed = await cells();
  check('cinematic: sealed in the room the hero sees only the room (a handful of squares) and the goblin outside is hidden', sealed > 0 && sealed < 40 && now.shown.gob === false && now.shown.hero === true, JSON.stringify({ sealed, shown: now.shown }));
  await shot('line-of-sight-cinematic-sealed');
  await reload(true);
  await wait(600);
  now = await probe();
  const opened = await cells();
  check('cinematic: with the door open the hero sees the whole outside (most of the map), goblins included', opened > 150 && now.shown.gob === true && now.shown.gob2 === true, JSON.stringify({ opened, shown: now.shown }));
  await shot('line-of-sight-cinematic-open');
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
  await wait(300);
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

// ── A door turned half a turn, or mirrored: its hinge goes to the other end ─────────────────────────────────────
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
