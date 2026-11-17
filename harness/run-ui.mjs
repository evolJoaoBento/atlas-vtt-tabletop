// Usage: PLAYWRIGHT_MODULE=<playwright or playwright-core module> node harness/run-ui.mjs [feature regex] [--full] [--all]
// Builds the board harness into .ui-build/, makes the test video, then runs the features checks (browser checks of what
// was added since, with screenshots in .ui-build/shots/) and, with `--all`, the full board checks too. The features
// run are the affected ones (harness/affected.cjs: new, failed last time, or a function they ran changed); a regex
// runs the ones it matches, `--full` all of them.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const out = '.ui-build';
const all = process.argv.includes('--all');
const only = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/shots`, { recursive: true });
await build({ entryPoints: ['harness/board.ts'], bundle: true, outfile: `${out}/board.js`, alias: { obsidian: './harness/obsidian-stub.ts' }, loader: { '.png': 'binary', '.mp3': 'binary' }, logLevel: 'warning', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
// The player board harness, as Connect mounts it: a feature can use the url `/playerBoard.html`.
await build({ entryPoints: ['harness/playerBoard.ts'], bundle: true, outfile: `${out}/playerBoard.js`, alias: { obsidian: './harness/obsidian-stub.ts' }, loader: { '.png': 'binary', '.mp3': 'binary' }, logLevel: 'warning', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
copyFileSync('harness/board.html', `${out}/index.html`);
writeFileSync(`${out}/playerBoard.html`, readFileSync('harness/board.html', 'utf8').replace('board.js', 'playerBoard.js'));
copyFileSync('styles.css', `${out}/styles.css`);
// Atlas's own styles, when the vault has them (the screenshots then look as Atlas's toolbar does).
const atlas = process.env.ATLAS_CSS ?? '../../atlas-vtt/styles.css';
if (existsSync(atlas)) copyFileSync(atlas, `${out}/atlas.css`);
const run = (args) => spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env }).status ?? 1;
let status = run(['harness/make-test-video.cjs', `${out}/sweep.webm`]);
if (status === 0) status = run(['harness/features-test.cjs', out, `${out}/shots`, ...(only ? [only] : []), ...(process.argv.includes('--full') ? ['--full'] : [])]);
if (all && status === 0) status = run(['harness/board-test.cjs', out, `${out}/shots`]);
process.exit(status);
