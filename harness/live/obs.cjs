// Helpers to drive the live-check Obsidian over the DevTools protocol.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/joaoo/dnd store/node_modules/playwright');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Connects once the app's window is up; `logs` collects console errors and warnings from then on. */
async function connect(port = 9311, { tries = 60 } = {}) {
  let b = null;
  for (let i = 0; i < tries && !b; i++) { try { b = await chromium.connectOverCDP(`http://localhost:${port}`); } catch { await sleep(1000); } }
  if (!b) throw new Error(`no Obsidian on port ${port}`);
  let pg = null;
  for (let i = 0; i < 60 && !pg; i++) { pg = b.contexts()[0].pages().find((p) => p.url().includes('index.html')) || null; if (!pg) await sleep(1000); }
  if (!pg) throw new Error('no app window');
  const logs = [];
  pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push({ type: m.type(), text: m.text(), at: m.location().url || '' }); });
  pg.on('pageerror', (e) => logs.push({ type: 'pageerror', text: e.message, at: e.stack || '' }));
  const cdp = await pg.context().newCDPSession(pg);
  // An async function body, with `ARG` its argument: `ev('return app.vault.getName()')`.
  const ev = (body, arg) => pg.evaluate(`(async(ARG)=>{${body}\n})(${JSON.stringify(arg === undefined ? null : arg)})`);
  const shot = async (file) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); };
  return { b, pg, cdp, ev, shot, logs };
}
module.exports = { connect, sleep };
