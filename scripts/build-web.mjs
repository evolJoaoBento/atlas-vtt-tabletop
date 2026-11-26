// Builds Tabletop's player board for a plain browser (Connect's join page): dist-web/tabletop-player-board.js, an ES
// module that leaves three.js to the page, and dist-web/tabletop-player-board.css, Tabletop's styles.
// Usage: node scripts/build-web.mjs
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const out = 'dist-web';
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ['src/web/playerBoardWeb.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020', 'safari15', 'chrome100'],
  external: ['three', 'three/*'],
  alias: { obsidian: './src/web/obsidianStub.ts' },
  loader: { '.png': 'binary', '.mp3': 'binary' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  legalComments: 'none',
  banner: { js: '/* Tabletop for Atlas VTT, player board for the browser. AGPL-3.0; source: https://github.com/evolJoaoBento/atlas-vtt-tabletop */' },
  outfile: `${out}/tabletop-player-board.js`,
  logLevel: 'warning',
});
copyFileSync('styles.css', `${out}/tabletop-player-board.css`);
const head = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
const dirty = (() => { try { return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== ''; } catch { return true; } })();
const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
writeFileSync(`${out}/SOURCE.json`, `${JSON.stringify({ name: 'atlas-vtt-tabletop', version, commit: head, dirty, built: new Date().toISOString() }, null, 2)}\n`);
console.log(`${out}/tabletop-player-board.js ${Math.round(statSync(`${out}/tabletop-player-board.js`).size / 1024)} KB`);
