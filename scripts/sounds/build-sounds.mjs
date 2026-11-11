// Builds the board sounds: reads Kenney's CC0 packs (.sound-src/kenney) and the WAVs from synth.mjs (.sound-src/own),
// trims, pitches, normalises to -1 dBFS, encodes mono MP3 into src/assets/sounds/, checks the encoded files, and
// writes SOURCES.md and src/sound/catalog.ts. `--sheet` also writes .sound-src/listen.html, one play button per file.
//   node scripts/sounds/fetch-kenney.mjs && node scripts/sounds/synth.mjs && node scripts/sounds/build-sounds.mjs
/* global process, console -- this script runs under Node */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SR = 44100;
const PEAK = Math.pow(10, -1 / 20);
const OUT = 'src/assets/sounds';
const WITH_SHEET = process.argv.includes('--sheet');

// ---- The catalogue: every sound id, its settings group, base gain and where its files come from ----------------------
// A variant is a list of layers mixed together: { k: 'kenney pack/file', pitch: semitones, gain } or { own: recipe }.
// `max` caps a one-shot's length in seconds.

const kenney = (file, pitch = 0, gain = 1) => ({ k: file, pitch, gain });
const IMPACT = (name, pitch, gain) => kenney(`impact-sounds/Audio/${name}.ogg`, pitch, gain);
const RPG = (name, pitch, gain) => kenney(`rpg-audio/Audio/${name}.ogg`, pitch, gain);
const UI = (name, pitch, gain) => kenney(`interface-sounds/Audio/${name}.ogg`, pitch, gain);
const own = (recipe) => [{ own: recipe }];

const DAMAGE = ['acid', 'bludgeoning', 'cold', 'explosion', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder', 'plain'];
const CONDITIONS = ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious', 'applied'];
const IMPACT_GAIN = { explosion: 0.85, thunder: 0.85, piercing: 0.6, plain: 0.55, cold: 0.65, radiant: 0.65, psychic: 0.65 };
const LOOP_GAIN = { thunder: 0.45, explosion: 0.45, piercing: 0.25, cold: 0.35, psychic: 0.3, radiant: 0.3, force: 0.4, necrotic: 0.4 };

const SOUNDS = [
  { id: 'dice.hit', group: 'dice', gain: 0.7, placed: true, max: 0.15, variants: [
    ...[0, 1, 2, 3, 4].map((i) => [IMPACT(`impactWood_light_00${i}`, 4 + i)]),
    ...[0, 1, 2].map((i) => [IMPACT(`impactWood_light_00${i}`, 7), IMPACT(`impactPlate_light_00${i}`, 9, 0.35)]),
  ] },
  { id: 'dice.roll', group: 'dice', gain: 0.45, placed: true, loop: true, variants: [own('dice-roll')] },
  { id: 'dice.caught', group: 'dice', gain: 0.6, placed: true, max: 0.3, variants: [[UI('error_001', 0)], [UI('error_004', -2)]] },
  { id: 'mini.pickup', group: 'minis', gain: 0.55, placed: true, max: 0.4, variants: [
    [RPG('cloth1')], [RPG('cloth2')], [RPG('cloth3')], [RPG('cloth4')], [RPG('handleSmallLeather')],
  ] },
  { id: 'mini.putdown', group: 'minis', gain: 0.6, placed: true, max: 0.3, variants: [
    [RPG('bookPlace1')], [RPG('bookPlace2')], [RPG('bookPlace3')],
    [IMPACT('impactSoft_medium_000', 0), IMPACT('impactWood_light_001', 0, 0.5)],
    [IMPACT('impactSoft_medium_001', -2), IMPACT('impactWood_light_002', -2, 0.5)],
  ] },
  { id: 'door.open', group: 'doors', gain: 0.7, placed: true, variants: [[RPG('doorOpen_1')], [RPG('doorOpen_2')]] },
  { id: 'door.shut', group: 'doors', gain: 0.75, placed: true, variants: [[RPG('doorClose_1')], [RPG('doorClose_2')], [RPG('doorClose_3')]] },
  { id: 'door.locked', group: 'doors', gain: 0.6, placed: true, variants: [[RPG('metalClick')], [RPG('metalLatch')]] },
  { id: 'wall.crumble', group: 'doors', gain: 0.85, placed: true, variants: [own('crumble')] },
  { id: 'fog.chime', group: 'fog', gain: 0.5, placed: false, variants: [[UI('confirmation_001')], [UI('glass_001', 3)]] },
  { id: 'turn.horn', group: 'turns', gain: 0.75, placed: false, variants: [own('horn')] },
  ...CONDITIONS.map((name) => ({ id: `condition.${name}`, group: 'conditions', gain: name === 'applied' ? 0.55 : 0.6, placed: true, variants: [own(`condition-${name}`)] })),
  ...DAMAGE.map((name) => ({ id: `spell.impact.${name}`, group: 'spells', gain: IMPACT_GAIN[name] ?? 0.75, placed: true, variants: [own(`spell-impact-${name}`)] })),
  ...DAMAGE.map((name) => ({ id: `spell.loop.${name}`, group: 'spells', gain: LOOP_GAIN[name] ?? 0.4, placed: true, loop: true, variants: [own(`spell-loop-${name}`)] })),
  { id: 'water.ripples', group: 'water', gain: 0.35, placed: true, loop: true, variants: [own('water-ripples')] },
  { id: 'water.flow', group: 'water', gain: 0.35, placed: true, loop: true, variants: [own('water-flow')] },
  { id: 'water.waves', group: 'water', gain: 0.4, placed: true, loop: true, variants: [own('water-waves')] },
  { id: 'water.still', group: 'water', gain: 0.12, placed: true, loop: true, variants: [own('water-still')] },
];

// ---- Reading and shaping samples --------------------------------------------------------------------------------------

function decodeWithFfmpeg(path) {
  const run = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (run.status !== 0) throw new Error(`ffmpeg could not decode ${path}: ${run.stderr}`);
  const bytes = run.stdout;
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}
function readWav16(path) {
  const bytes = readFileSync(path);
  const n = (bytes.length - 44) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = bytes.readInt16LE(44 + i * 2) / 32768;
  return out;
}
const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rmsOf = (x, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)); };

/** Raises (or lowers) the pitch by `semitones` by resampling, which also shortens (or lengthens) the sound. */
function pitchShift(x, semitones) {
  if (semitones === 0) return x;
  const r = Math.pow(2, semitones / 12);
  const n = Math.floor((x.length - 2) / r);
  const out = new Float32Array(n);
  const at = (i) => x[Math.min(x.length - 1, Math.max(0, i))];
  for (let i = 0; i < n; i++) {
    const p = i * r;
    const i0 = Math.floor(p);
    const f = p - i0;
    const [a, b, c, d] = [at(i0 - 1), at(i0), at(i0 + 1), at(i0 + 2)];
    out[i] = b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
  }
  return out;
}

function loadLayer(layer) {
  if (layer.own) return readWav16(`.sound-src/own/${layer.own}.wav`);
  return pitchShift(decodeWithFfmpeg(`.sound-src/kenney/${layer.k}`), layer.pitch).map((v) => v * layer.gain);
}
function mixLayers(layers) {
  const parts = layers.map(loadLayer);
  const out = new Float32Array(Math.max(...parts.map((p) => p.length)));
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}

/** Trims leading and trailing silence, caps the length, blocks DC, and fades the ends so nothing clicks. */
function shapeOneShot(x, max) {
  const peak = peakOf(x);
  let s = 0;
  while (s < x.length && Math.abs(x[s]) < 0.02 * peak) s++;
  let e = x.length;
  while (e > 0 && Math.abs(x[e - 1]) < 0.004 * peak) e--;
  s = Math.max(0, s - 44);
  let out = x.slice(s, Math.max(s + 1, e));
  if (max && out.length > max * SR) out = out.slice(0, Math.round(max * SR));
  // A DC blocker (about 24 Hz).
  let px = 0;
  let py = 0;
  for (let i = 0; i < out.length; i++) { const y = out[i] - px + 0.9966 * py; px = out[i]; py = y; out[i] = y; }
  const fadeIn = Math.min(Math.round(0.0015 * SR), out.length >> 2);
  const fadeOut = Math.min(Math.round(0.03 * SR), out.length >> 1);
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * (i / fadeOut));
  return out;
}
/** A loop keeps every sample (trimming or fading would open a seam); only its mean is removed. */
function shapeLoop(x) {
  const mean = x.reduce((s, v) => s + v, 0) / x.length;
  return x.map((v) => v - mean);
}
function normalise(x, peak = PEAK) {
  const scale = peak / peakOf(x);
  return x.map((v) => v * scale);
}

// The MP3 goes through a file, not a pipe: ffmpeg only writes the Xing/LAME header (frame count, encoder delay and
// padding, which players use to play a loop gaplessly) when it can seek back in the output.
const TMP = '.sound-src/tmp.mp3';
function encodeMp3(x, loop) {
  mkdirSync('.sound-src', { recursive: true });
  const run = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-ac', '1', '-ar', String(SR), '-codec:a', 'libmp3lame', '-b:a', loop ? '48k' : '64k', TMP],
    { input: Buffer.from(x.buffer, x.byteOffset, x.byteLength), maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error();
  return readFileSync(TMP);
}
function decodeMp3() {
  return decodeWithFfmpeg(TMP);
}

// ---- Checks on the shipped (encoded, then decoded) audio ---------------------------------------------------------------

const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
function measure(x, loop, reference) {
  const n = x.length;
  const window = Math.round(0.01 * SR);
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const jumps = new Float32Array(n - 1);
  for (let i = 1; i < n; i++) jumps[i - 1] = Math.abs(x[i] - x[i - 1]);
  const sorted = jumps.slice().sort();
  const bodyJump = sorted[sorted.length - 1];
  const p99Jump = sorted[Math.floor(sorted.length * 0.99)];
  const m = { peakDb: db(peakOf(x)), dc: mean, bodyJump, p99Jump, lengthDelta: n - reference.length };
  if (loop) {
    m.seamRms = Math.abs(rmsOf(x, 0, window) - rmsOf(x, n - window, n)) / rmsOf(x);
    m.wrapJump = Math.abs(x[0] - x[n - 1]);
  } else {
    m.edge = Math.max(Math.abs(x[0]), Math.abs(x[n - 1]));
  }
  return m;
}
function judge(m, loop) {
  const problems = [];
  if (m.peakDb > -1) problems.push(`peak ${m.peakDb.toFixed(2)} dBFS`);
  if (Math.abs(m.dc) > 0.01) problems.push(`DC ${m.dc.toFixed(4)}`);
  if (loop) {
    if (m.seamRms > 0.5) problems.push(`seam RMS differs by ${(m.seamRms * 100).toFixed(0)}% of the loop RMS`);
    // The step from the last sample to the first must look like any other step in the loop.
    // The lossy encode leaves a few hundredths of codec error at the ends, so the decoded step may exceed a natural one by 0.05.
    if (m.wrapJump > m.p99Jump * 1.5 + 0.05) problems.push(`wrap jump ${m.wrapJump.toFixed(3)} vs 99th-percentile step ${m.p99Jump.toFixed(3)}`);
    if (Math.abs(m.lengthDelta) > 8) problems.push(`decoded length differs by ${m.lengthDelta} samples (encoder delay not trimmed?)`);
  } else {
    // The source ends are faded to exactly zero; the decoded ends carry a little codec smear around a sharp onset.
    if (m.edge > 0.15) problems.push(`edge sample ${m.edge.toFixed(3)}`);
    if (m.bodyJump > 1.5) problems.push(`sample-to-sample jump ${m.bodyJump.toFixed(2)}`);
  }
  return problems;
}

/** A coarse spectrogram signature (12 log-spaced bands x 10 time slices, in dB) used to compare how alike two sounds are. */
function signature(x) {
  const slices = 10;
  const bands = Array.from({ length: 12 }, (_, k) => 100 * Math.pow(100, k / 11));
  const sig = [];
  const len = Math.floor(x.length / slices);
  for (let s = 0; s < slices; s++) {
    for (const f of bands) {
      const w = (2 * Math.PI * f) / SR;
      const coeff = 2 * Math.cos(w);
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < len; i++) { const s0 = x[s * len + i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
      sig.push(10 * Math.log10((s1 * s1 + s2 * s2 - coeff * s1 * s2) / len + 1e-10));
    }
  }
  const top = Math.max(...sig);
  return sig.map((v) => Math.max(v - top, -70));
}
function correlation(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let ab = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
  return ab / Math.sqrt(aa * bb);
}

// ---- Build ----------------------------------------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const rows = [];
const failures = [];
const entries = [];
const conditionSignatures = [];
let total = 0;
const report = [];

for (const sound of SOUNDS) {
  const files = [];
  sound.variants.forEach((layers, index) => {
    const name = `${sound.id}-${index + 1}.mp3`;
    let x = mixLayers(layers);
    x = sound.loop ? shapeLoop(x) : shapeOneShot(x, sound.max);
    x = normalise(x);
    let mp3 = encodeMp3(x, sound.loop);
    let decoded = decodeMp3();
    // A lossy encode can overshoot the source peak a little; bring the decoded peak back under -1 dBFS.
    for (let attempt = 0; attempt < 4 && peakOf(decoded) > PEAK * 0.999; attempt++) {
      x = normalise(x, peakOf(x) * (PEAK * 0.99) / peakOf(decoded));
      mp3 = encodeMp3(x, sound.loop);
      decoded = decodeMp3();
    }
    writeFileSync(`${OUT}/${name}`, mp3);
    total += mp3.length;
    files.push(name);
    const m = measure(decoded, !!sound.loop, x);
    const problems = judge(m, !!sound.loop);
    if (problems.length) failures.push(`${name}: ${problems.join('; ')}`);
    report.push({ name, bytes: mp3.length, seconds: x.length / SR, ...m });
    if (sound.id.startsWith('condition.')) conditionSignatures.push({ id: sound.id, sig: signature(x) });
    const origin = layers.map((l) => (l.own ? `own: synth.mjs ${l.own}` : `Kenney ${{ 'impact-sounds': 'Impact Sounds', 'rpg-audio': 'RPG Audio', 'interface-sounds': 'Interface Sounds' }[l.k.split('/')[0]]}: ${l.k.split('/').pop()}`)).join(' + ');
    const licence = layers.every((l) => l.own) ? 'own' : 'CC0';
    const changes = [];
    const pitches = layers.filter((l) => l.k && l.pitch).map((l) => `${l.pitch > 0 ? '+' : ''}${l.pitch} st`);
    if (pitches.length) changes.push(`pitch ${pitches.join(', ')}`);
    if (layers.length > 1) changes.push('layered');
    changes.push(sound.loop ? 'DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k' : 'trimmed, faded, normalised -1 dBFS, mp3 64k');
    rows.push(`| ${sound.id} | ${name} | ${origin} | ${licence} | ${changes.join('; ')} |`);
  });
  entries.push({ ...sound, files });
}

// The nearest pair of condition sounds, by how alike their spectrogram signatures are.
let nearest = { r: -2, a: '', b: '' };
for (let i = 0; i < conditionSignatures.length; i++) {
  for (let j = i + 1; j < conditionSignatures.length; j++) {
    const r = correlation(conditionSignatures[i].sig, conditionSignatures[j].sig);
    if (r > nearest.r) nearest = { r, a: conditionSignatures[i].id, b: conditionSignatures[j].id };
  }
}
if (nearest.r > 0.9) failures.push(`conditions too alike: ${nearest.a} / ${nearest.b} (correlation ${nearest.r.toFixed(2)})`);

// SOURCES.md
writeFileSync(`${OUT}/SOURCES.md`, `# Board sound sources

Every file here is either from Kenney's CC0 packs (https://kenney.nl, public domain dedication, no attribution needed)
or synthesised for this project (licence "own"). Nothing else is used. Rebuild with:

    node scripts/sounds/fetch-kenney.mjs && node scripts/sounds/synth.mjs && node scripts/sounds/build-sounds.mjs

| Sound id | File | Origin | Licence | What changed |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`);

// catalog.ts
const ident = (name) => name.replace(/\.mp3$/, '').replace(/[^A-Za-z0-9]/g, '_').replace(/^(\d)/, '_$1');
const imports = entries.flatMap((e) => e.files.map((f) => `import ${ident(f)} from '../assets/sounds/${f}';`));
const idUnion = entries.map((e) => `  | '${e.id}'`).join('\n');
const body = entries.map((e) => {
  const fields = [`group: '${e.group}'`, `files: [${e.files.map(ident).join(', ')}]`, `gain: ${e.gain}`, `placed: ${e.placed}`];
  if (e.loop) fields.push('loop: true');
  return `  '${e.id}': { ${fields.join(', ')} },`;
}).join('\n');
// The source files of this repository use CRLF line ends.
writeFileSync('src/sound/catalog.ts', `// Generated by scripts/sounds/build-sounds.mjs: edit the SOUNDS table there, not this file.
// Every board sound, with its settings group, its bundled MP3 variants and its base gain.
import type { SoundGroup } from './soundSettings';
${imports.join('\n')}

/** The id of a board sound, such as \`dice.hit\` or \`water.ripples\`. */
export type SoundId =
${idUnion};

export interface SoundEntry {
  group: SoundGroup;
  /** The MP3 variants; a play picks one at random. */
  files: Uint8Array[];
  /** The sound's own level before the caller's gain, to even out how loud the files are. */
  gain: number;
  /** Whether the sound takes a place on the board (pan and distance), or is heard the same everywhere. */
  placed: boolean;
  loop?: boolean;
}

export const CATALOG: Record<SoundId, SoundEntry> = {
${body}
};

/** The bytes of every variant of \`id\`, each copied into a fresh buffer because decoding takes ownership of it. */
export function loadSound(id: SoundId): Promise<ArrayBuffer[]> {
  return Promise.resolve(CATALOG[id].files.map((bytes) => {
    const copy = new ArrayBuffer(bytes.length);
    new Uint8Array(copy).set(bytes);
    return copy;
  }));
}
`.replace(/\n/g, '\r\n'));

// Listening sheet
if (WITH_SHEET) {
  const cards = report.map((r) => `<tr><td>${r.name}</td><td><audio controls preload="none" ${r.name.match(/^(dice\.roll|spell\.loop|water)/) ? 'loop' : ''} src="../${OUT}/${r.name}"></audio></td><td>${r.peakDb.toFixed(1)} dBFS</td><td>${r.seconds.toFixed(2)} s</td></tr>`).join('\n');
  writeFileSync('.sound-src/listen.html', `<!doctype html><meta charset="utf-8"><title>Board sounds</title><body style="font:14px sans-serif"><h1>Board sounds</h1>
<p>Check: no click at a loop seam (loops repeat), no clipping, every condition sound distinct from the others.</p><table cellpadding="4">${cards}</table>`);
}

const kb = (b) => `${(b / 1024).toFixed(1)} kB`;
const loops = report.filter((r) => r.seamRms !== undefined);
console.log(`${report.length} files, ${kb(total)} (${(total / 1e6).toFixed(2)} MB) in ${OUT}`);
console.log(`worst peak ${Math.max(...report.map((r) => r.peakDb)).toFixed(2)} dBFS; largest |DC| ${Math.max(...report.map((r) => Math.abs(r.dc))).toExponential(1)}`);
console.log(`loops: ${loops.length}; worst seam RMS difference ${(Math.max(...loops.map((r) => r.seamRms)) * 100).toFixed(0)}%; worst wrap jump / 99th-percentile step ${Math.max(...loops.map((r) => r.wrapJump / r.p99Jump)).toFixed(2)} (${loops.reduce((w, r) => (r.wrapJump / r.p99Jump > w.v ? { v: r.wrapJump / r.p99Jump, n: r.name } : w), { v: 0, n: '' }).n}); worst decoded length delta ${Math.max(...loops.map((r) => Math.abs(r.lengthDelta)))} samples`);
console.log(`conditions: closest pair ${nearest.a} / ${nearest.b}, correlation ${nearest.r.toFixed(2)}`);
if (failures.length) {
  console.error(`FAILED checks:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('all checks passed');
