// Usage: node harness/phoneMemory-test.cjs <bundle dir>, after bundling harness/phoneMemory.ts as phoneMemory.js and copying
// harness/board.html as phoneMemory.html with board.js swapped for phoneMemory.js (see README).
// Draws a heavy scene on the player board as a computer does and as a phone does (lean, leanest), in a phone-sized page,
// and holds the phone's textures to a budget: a phone tab that holds more is killed by iOS and by small Androids.
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/phoneMemory.html'));
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }); res.end(data); });
});
const MB = 1024 * 1024;
/** What a phone's board may hold in textures for this scene. */
const BUDGET = { lean: 160 * MB, leanest: 60 * MB };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

server.listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    for (const memory of ['normal', 'lean', 'leanest']) {
      const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 664 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/phoneMemory.html?memory=${memory}`);
      await page.waitForFunction(() => window.playerTest?.ready || window.boardError, null, { timeout: 60000 });
      const boot = await page.evaluate(() => window.boardError ?? null);
      if (boot) throw new Error(boot);
      await wait(8000);
      const probe = await page.evaluate(() => window.memoryProbe());
      results.push({ memory, mb: Math.round(probe.bytes / MB), largest: probe.largest, textures: probe.count, gpu: probe.gpuTextures, ratio: probe.ratio, errors });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  let failed = 0;
  for (const row of results) {
    const budget = BUDGET[row.memory];
    const ok = budget === undefined || row.mb * MB <= budget;
    if (!ok || row.errors.length) failed++;
    console.log(`${ok && !row.errors.length ? 'PASS' : 'FAIL'} ${row.memory}: ${row.mb} MB in ${row.textures} textures (largest ${row.largest}px, ${row.gpu} on the GPU, pixel ratio ${row.ratio})${budget ? `, budget ${budget / MB} MB` : ''}${row.errors.length ? ` errors: ${row.errors.join('; ')}` : ''}`);
  }
  const normal = results.find((row) => row.memory === 'normal');
  const lean = results.find((row) => row.memory === 'lean');
  if (normal && lean && !(lean.mb < normal.mb)) { failed++; console.log('FAIL a phone does not hold less than a computer'); }
  process.exit(failed ? 1 : 0);
});
