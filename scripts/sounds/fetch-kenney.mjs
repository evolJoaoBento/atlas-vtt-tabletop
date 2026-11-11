// Downloads Kenney's CC0 sound packs (https://kenney.nl) and unzips them into .sound-src/kenney/<slug>/.
/* global process, fetch -- this script runs under Node */
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PACKS = ['impact-sounds', 'rpg-audio', 'interface-sounds'];
const UA = 'Mozilla/5.0';
const root = '.sound-src';

for (const slug of PACKS) {
  const target = `${root}/kenney/${slug}`;
  if (existsSync(`${target}/License.txt`) && process.argv[2] !== '--force') { console.log(`${slug}: already there`); continue; }
  const page = `https://kenney.nl/assets/${slug}`;
  // The download link is signed per request: the page names the pack as hex, the link endpoint wants the page as referer.
  const id = Buffer.from(`assets/${slug}`).toString('hex');
  const link = await (await fetch(`https://kenney.nl/download-link/${id}`, { headers: { 'User-Agent': UA, Referer: page } })).json();
  if (!link.url) throw new Error(`${slug}: no download link (${JSON.stringify(link)})`);
  const zip = await fetch(link.url, { headers: { 'User-Agent': UA, Referer: page } });
  if (!zip.ok) throw new Error(`${slug}: download failed (${zip.status})`);
  mkdirSync(`${root}/dl`, { recursive: true });
  const zipPath = `${root}/dl/${slug}.zip`;
  writeFileSync(zipPath, Buffer.from(await zip.arrayBuffer()));
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  // Windows ships bsdtar, which reads zips; elsewhere unzip does.
  const result = process.platform === 'win32'
    ? spawnSync(`${process.env.SystemRoot}\\System32\\tar.exe`, ['-xf', zipPath, '-C', target], { stdio: 'inherit' })
    : spawnSync('unzip', ['-q', zipPath, '-d', target], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${slug}: unzip failed`);
  console.log(`${slug}: done`);
}
