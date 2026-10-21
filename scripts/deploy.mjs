// Copies the built plugin into the 2075 vault's plugin folder (its own folder: no other plugin's files are touched).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const vault = resolve(process.env.ATLAS_VAULT ?? '..');
const target = join(vault, '.obsidian', 'plugins', 'tabletop-for-atlas');
if (!existsSync(join(vault, '.obsidian'))) throw new Error(`No .obsidian folder in ${vault}; set ATLAS_VAULT.`);
mkdirSync(target, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(file, join(target, file));
console.log(`Deployed to ${target}`);
