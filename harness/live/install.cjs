// node harness/live/install.cjs [vault]
// Copies the builds under test into the throwaway vault, file by file: Tabletop's main.js, manifest.json and styles.css,
// and Connect's dist/main.js, dist/styles.css and manifest.json. Run with that Obsidian stopped. It never runs deploy.mjs.
const fs = require('fs'), path = require('path');
const vault = process.argv[2] || 'C:/Users/joaoo/fusion-gate-vault';
const tabletop = path.resolve(__dirname, '..', '..');
const connect = process.env.CONNECT_REPO || 'C:/Users/joaoo/2075-code/atlas-vtt-connect';
if (!/fusion-gate-vault/.test(vault)) throw new Error(`${vault} is not the throwaway vault`);
const plugins = path.join(vault, '.obsidian', 'plugins');
const copies = [
  [path.join(tabletop, 'main.js'), 'tabletop-for-atlas/main.js'], [path.join(tabletop, 'manifest.json'), 'tabletop-for-atlas/manifest.json'], [path.join(tabletop, 'styles.css'), 'tabletop-for-atlas/styles.css'],
  [path.join(connect, 'dist/main.js'), 'connect-for-atlas/main.js'], [path.join(connect, 'dist/styles.css'), 'connect-for-atlas/styles.css'], [path.join(connect, 'manifest.json'), 'connect-for-atlas/manifest.json'],
];
for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(path.join(plugins, to)), { recursive: true });
  fs.copyFileSync(from, path.join(plugins, to));
  console.log('copied', to, fs.statSync(from).size);
}
// Atlas itself: node harness/live/install.cjs <vault> --atlas <folder with main.js, styles.css, manifest.json>
const at = process.argv.indexOf('--atlas');
if (at > 0) for (const name of ['main.js', 'styles.css', 'manifest.json']) { fs.copyFileSync(path.join(process.argv[at + 1], name), path.join(plugins, 'atlas-vtt', name)); console.log('copied atlas-vtt/' + name); }
