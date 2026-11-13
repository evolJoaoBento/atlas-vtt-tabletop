// Builds the board sounds: reads Kenney's CC0 packs (.sound-src/kenney), the WAVs from synth.mjs (.sound-src/own) and
// the downloaded packs listed in PACKS below (.sound-src/calvo, kmontes, round1), trims, pitches, normalises to -1 dBFS,
// encodes mono MP3 into src/assets/sounds/, checks the encoded files, and writes SOURCES.md and src/sound/catalog.ts.
// `--sheet` also writes .sound-src/listen.html, one play button per file.
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

// The downloaded packs. `dir` is the folder under .sound-src that holds the originals (one flat folder per pack, or per
// download); the rest goes to SOURCES.md and the README credits.
const PACKS = {
  calvo: { dir: 'calvo', name: 'Magic Spell SFX', author: 'Leonardo Calvo (The Sound Rack)', licence: 'CC BY 4.0', url: 'https://thesoundrack.itch.io/freemagicspellsfx' },
  kmontes: { dir: 'kmontes', name: 'Fantasy Ambient Sound Effects Pack', author: 'kmontesdev', licence: 'CC0', url: 'https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0' },
  dice29: { dir: 'round1', name: '2 dice roll (29 throws)', author: 'RPG (OpenGameArt user)', licence: 'CC0', url: 'https://opengameart.org/content/2-dice-roll-29-throws' },
  cc080: { dir: 'round1', name: '80 CC0 RPG SFX', author: 'rubberduck', licence: 'CC0', url: 'https://opengameart.org/content/80-cc0-rpg-sfx' },
};
// One file of a downloaded pack. A loop takes `seg`: it is cut from `from` seconds, `len` long, and its last `xfade`
// seconds are folded into its first, so the loop's end runs into its start.
const pick = (pack, file, seg) => [{ pack, file, seg }];
const LOOP_SEG = (from) => ({ from, len: 6.2, xfade: 0.2 });
const calvo = (file, seg) => pick('calvo', file, seg);
const kmontes = (file, seg) => pick('kmontes', file, seg);

const CONDITIONS = ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious', 'applied'];
// Conditions and damage types that have no file of their own and play another sound's file (one file, several ids).
const CONDITION_REUSE = { charmed: 'applied', exhaustion: 'applied', grappled: 'restrained', unconscious: 'prone' };
const CONDITION_FILE = {
  blinded: calvo('wind_spell_cast_air_sharp_shoot_02.ogg'),
  deafened: calvo('wind_spell_cast_air_short_noisy_whoosh_02.ogg'),
  frightened: calvo('dark_spell_cast_invoke_raven_fast_01.ogg'),
  incapacitated: kmontes('Hit_03.wav'),
  invisible: calvo('wind_spell_cast_air_short_spacious_whoosh_03.ogg'),
  paralyzed: calvo('lighting_spell_electric_zap_blast_sparkle_dark_02.ogg'),
  petrified: calvo('earth_spell_cast_morph_rocks_02.ogg'),
  poisoned: calvo('acid_spell_cast_bubble_poison_03.ogg'),
  prone: kmontes('Hit_02.wav'),
  restrained: kmontes('0009_combat_block_shield_d.wav'),
  stunned: calvo('lighting_spell_electric_zap_blast_sparkle_bright_03.ogg'),
  applied: calvo('dark_spell_cast_energy_ball_05.ogg'),
};
const IMPACT_FILE = {
  acid: calvo('acid_spell_cast_squish_whoosh_impact_01.ogg'),
  bludgeoning: kmontes('0009_combat_staff_hit_c.wav'),
  cold: calvo('Ice_Spell_fast_impact_02.ogg'),
  fire: calvo('fire_spell_burst_impact_short_02.ogg'),
  force: calvo('wind_spell_cast_air_impact_splash_01.ogg'),
  lightning: calvo('lighting_spell_electric_zap_blast_sparkle_bright_04.ogg'),
  necrotic: calvo('dark_spell_cast_smash_head_blood_01.ogg'),
  piercing: kmontes('0009_combat_dagger_hit_wood_c.wav'),
  plain: kmontes('Hit_04.wav'),
  poison: calvo('acid_spell_cast_gas_poison_squish_ball__01.ogg'),
  psychic: calvo('dark_spell_cast_energy_wave_02.ogg'),
  radiant: calvo('Holy_spell_wave_cast_01.ogg'),
  slashing: kmontes('0009_combat_sword_hit_flesh_c.wav'),
  thunder: calvo('lighting_spell_electric_impact_thunder_loud_dark_01.ogg'),
};
const IMPACT_REUSE = { explosion: 'fire' };
// The bludgeoning, piercing and slashing spells have no loop: a lasting one is silent while it stands. The cold loop is
// the desert night wind, as an icy wind bed, and the plain loop is the force loop.
const LOOP_FILE = {
  acid: kmontes('Drips_Cave_Cavern_2B.wav', LOOP_SEG(21)),
  cold: kmontes('Desert_KalNight_.wav', LOOP_SEG(31)),
  explosion: calvo('earth_spell_cast_meteor_explosion_04.ogg', LOOP_SEG(3)),
  fire: calvo('fire_spell_long_soft_01.ogg', LOOP_SEG(2.5)),
  force: calvo('dark_spell_cast_force_energy_field_01.ogg', LOOP_SEG(3)),
  lightning: calvo('lighting_spell_electric_loop_static_warm_02.ogg', LOOP_SEG(2)),
  necrotic: kmontes('Cave_Ambience_Creepy.wav', LOOP_SEG(21)),
  poison: kmontes('Cave_Ambience_Drips.wav', LOOP_SEG(31)),
  psychic: calvo('dark_spell_cast_force_energy_field_03.ogg', LOOP_SEG(1.3)),
  radiant: calvo('Holy_spell_heal_cast_long_07.ogg', LOOP_SEG(2.5)),
  thunder: calvo('earth_spell_cast_earthquake_power_03.ogg', LOOP_SEG(3)),
};
const LOOP_REUSE = { plain: 'force' };
// Each sound's own level before the caller's gain. Files are all normalised to -1 dBFS, so these even out how loud they
// are; the overrides were set from the files' measured loudness. Others get the default of their kind.
const GAIN = {
  'dice.hit': 1,
  'wall.crumble': 1,
  'condition.applied': 0.95, 'condition.blinded': 0.9, 'condition.deafened': 0.5, 'condition.frightened': 0.75, 'condition.incapacitated': 0.5,
  'condition.invisible': 0.5, 'condition.paralyzed': 0.65, 'condition.petrified': 0.5, 'condition.poisoned': 0.6, 'condition.prone': 0.5,
  'condition.restrained': 0.5, 'condition.stunned': 0.5,
  'condition.charmed': 0.95, 'condition.exhaustion': 0.95, 'condition.grappled': 0.5, 'condition.unconscious': 0.5,
  'spell.impact.acid': 0.7, 'spell.impact.bludgeoning': 0.55, 'spell.impact.cold': 0.85, 'spell.impact.explosion': 0.85, 'spell.impact.fire': 0.7,
  'spell.impact.force': 0.65, 'spell.impact.lightning': 0.6, 'spell.impact.necrotic': 0.8, 'spell.impact.piercing': 0.6, 'spell.impact.plain': 0.55,
  'spell.impact.poison': 0.8, 'spell.impact.psychic': 0.55, 'spell.impact.radiant': 0.7, 'spell.impact.slashing': 0.75, 'spell.impact.thunder': 0.65,
  'spell.loop.acid': 1, 'spell.loop.cold': 0.75, 'spell.loop.explosion': 0.2, 'spell.loop.fire': 0.35, 'spell.loop.force': 0.25,
  'spell.loop.lightning': 0.2, 'spell.loop.necrotic': 0.35, 'spell.loop.plain': 0.25, 'spell.loop.poison': 1, 'spell.loop.psychic': 0.2,
  'spell.loop.radiant': 0.45, 'spell.loop.thunder': 0.25,
};
const gainOf = (id, fallback) => GAIN[id] ?? fallback;

const SOUNDS = [
  // Real dice clacks. Each is the first strong hit of a recorded throw, 0.15 s of it (there is no rolling loop: the clacks
  // carry the roll).
  { id: 'dice.hit', group: 'dice', gain: gainOf('dice.hit', 0.7), placed: true, shape: 'hit', variants: ['dice-1.wav', 'dice-5.wav', 'dice-12.wav', 'dice-20.wav'].map((file) => pick('dice29', file)) },
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
  { id: 'wall.crumble', group: 'doors', gain: gainOf('wall.crumble', 0.85), placed: true, max: 1.35, trimTail: true, variants: [pick('cc080', 'stones_01.ogg')] },
  { id: 'fog.chime', group: 'fog', gain: 0.5, placed: false, variants: [[UI('confirmation_001')]] },
  { id: 'turn.horn', group: 'turns', gain: 0.75, placed: false, variants: [own('horn')] },
  ...CONDITIONS.map((name) => {
    const id = `condition.${name}`;
    const base = { id, group: 'conditions', gain: gainOf(id, 0.6), placed: true };
    return CONDITION_REUSE[name] ? { ...base, reuse: `condition.${CONDITION_REUSE[name]}` } : { ...base, max: 1.1, variants: [CONDITION_FILE[name]] };
  }),
  ...[...Object.keys(IMPACT_FILE), ...Object.keys(IMPACT_REUSE)].sort().map((name) => {
    const id = `spell.impact.${name}`;
    const base = { id, group: 'spells', gain: gainOf(id, 0.75), placed: true };
    return IMPACT_REUSE[name] ? { ...base, reuse: `spell.impact.${IMPACT_REUSE[name]}` } : { ...base, max: 1.9, variants: [IMPACT_FILE[name]] };
  }),
  ...[...Object.keys(LOOP_FILE), ...Object.keys(LOOP_REUSE)].sort().map((name) => {
    const id = `spell.loop.${name}`;
    const base = { id, group: 'spells', gain: gainOf(id, 0.4), placed: true, loop: true };
    return LOOP_REUSE[name] ? { ...base, reuse: `spell.loop.${LOOP_REUSE[name]}` } : { ...base, variants: [LOOP_FILE[name]] };
  }),
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

/** Cuts `len` seconds from `from`, removes the mean, and folds the last `xfade` seconds into the first (equal-power), so the loop's end runs into its start. */
function loopSegment(x, { from, len, xfade }) {
  let seg = x.slice(Math.round(from * SR), Math.round((from + len) * SR));
  const mean = seg.reduce((s, v) => s + v, 0) / seg.length;
  seg = seg.map((v) => v - mean);
  const X = Math.min(Math.round(xfade * SR), seg.length >> 2);
  const N = seg.length - X;
  const out = seg.slice(0, N);
  for (let i = 0; i < X; i++) {
    const t = (i + 0.5) / X;
    out[i] = seg[i] * Math.sin((t * Math.PI) / 2) + seg[N + i] * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

function loadLayer(layer) {
  if (layer.own) return readWav16(`.sound-src/own/${layer.own}.wav`);
  if (layer.pack) {
    const x = decodeWithFfmpeg(`.sound-src/${PACKS[layer.pack].dir}/${layer.file}`);
    return layer.seg ? loopSegment(x, layer.seg) : x;
  }
  return pitchShift(decodeWithFfmpeg(`.sound-src/kenney/${layer.k}`), layer.pitch).map((v) => v * layer.gain);
}
function mixLayers(layers) {
  const parts = layers.map(loadLayer);
  const out = new Float32Array(Math.max(...parts.map((p) => p.length)));
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}

/** Trims leading and trailing silence, caps the length, blocks DC, and fades the ends so nothing clicks. */
function shapeOneShot(x, max, fadeInSec = 0.0015, external = false, trimTail = false) {
  // A recording from a downloaded pack can be long, with a loud tail far from its start: find the peak near the start.
  const peak = peakOf(external && max ? x.slice(0, Math.round((max + 0.5) * SR)) : x);
  let s = 0;
  while (s < x.length && Math.abs(x[s]) < (external ? 0.01 : 0.02) * peak) s++;
  let e = x.length;
  // A pack recording keeps its natural tail (the fade-out below ends it); the other sources lose their silent tail.
  while ((!external || trimTail) && e > 0 && Math.abs(x[e - 1]) < 0.004 * peak) e--;
  s = Math.max(0, s - 44);
  let out = x.slice(s, Math.max(s + 1, e));
  const capped = !!max && out.length > max * SR;
  if (capped) out = out.slice(0, Math.round(max * SR));
  dcBlock(out);
  // Their tails are long and soft: a recording that is cut short fades over a quarter of the cap (at most 0.25 s), and
  // one that ends on its own over 40% of its length (at most 0.25 s).
  const fadeOutSec = external ? Math.min(0.25, capped ? max * 0.25 : (out.length / SR) * 0.4) : 0.03;
  const fadeIn = Math.min(Math.round(fadeInSec * SR), out.length >> 2);
  const fadeOut = Math.min(Math.round(fadeOutSec * SR), out.length >> 1);
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * (i / fadeOut));
  return out;
}
/** A DC blocker (about 24 Hz), in place. */
function dcBlock(out) {
  let px = 0;
  let py = 0;
  for (let i = 0; i < out.length; i++) { const y = out[i] - px + 0.9966 * py; px = out[i]; py = y; out[i] = y; }
}
/** A die's clack: 0.15 s from just before the first strong hit of a recorded throw (a later, louder bounce does not win). */
function shapeHit(x) {
  const peak = peakOf(x);
  let p = 0;
  while (p < x.length && Math.abs(x[p]) < 0.45 * peak) p++;
  const s = Math.max(0, p - 220);
  const out = Float32Array.from(x.slice(s, s + Math.round(0.15 * SR)));
  dcBlock(out);
  const fadeIn = Math.min(Math.round(0.0015 * SR), out.length >> 2);
  const fadeOut = Math.min(Math.round(0.04 * SR), out.length >> 1);
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
function encodeMp3(x, kbps) {
  mkdirSync('.sound-src', { recursive: true });
  const run = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-ac', '1', '-ar', String(SR), '-codec:a', 'libmp3lame', '-b:a', `${kbps}k`, TMP],
    { input: Buffer.from(x.buffer, x.byteOffset, x.byteLength), maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error(`ffmpeg could not encode: ${run.stderr}`);
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
    if (m.wrapJump > m.p99Jump * 1.5) problems.push(`wrap jump ${m.wrapJump.toFixed(3)} vs 99th-percentile step ${m.p99Jump.toFixed(3)}`);
    if (Math.abs(m.lengthDelta) > 8) problems.push(`decoded length differs by ${m.lengthDelta} samples (encoder delay not trimmed?)`);
  } else {
    // The source ends are faded to exactly zero; the decoded ends carry a little codec smear around a sharp onset.
    if (m.edge > 0.1) problems.push(`edge sample ${m.edge.toFixed(3)}`);
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

const made = new Map();
for (const sound of SOUNDS) {
  // A sound that reuses another's file gets that file's name and no MP3 of its own; it is filled in after the loop.
  if (sound.reuse) { entries.push({ ...sound, files: [] }); continue; }
  const files = [];
  sound.variants.forEach((layers, index) => {
    const name = `${sound.id}-${index + 1}.mp3`;
    let x = mixLayers(layers);
    if (sound.shape === 'hit') x = shapeHit(x);
    else if (sound.loop) x = shapeLoop(x);
    else x = shapeOneShot(x, sound.max, layers.every((l) => l.own) ? 0.004 : layers.every((l) => l.pack) ? 0.003 : undefined, layers.every((l) => l.pack), !!sound.trimTail);
    x = normalise(x);
    let kbps = sound.loop ? 48 : 64;
    let mp3;
    let decoded;
    // Encodes `signal`; a lossy encode can overshoot the source peak a little, so bring the decoded peak back under -1 dBFS.
    const encodeChecked = (signal) => {
      let m = encodeMp3(signal, kbps);
      let d = decodeMp3();
      for (let attempt = 0; attempt < 4 && peakOf(d) > PEAK * 0.999; attempt++) {
        signal = normalise(signal, peakOf(signal) * (PEAK * 0.99) / peakOf(d));
        m = encodeMp3(signal, kbps);
        d = decodeMp3();
      }
      return { signal, mp3: m, decoded: d };
    };
    if (sound.loop) {
      // The encoder knows nothing of the loop, so its error at the two file ends can open a small step at the seam.
      // The loop is the same sound wherever it starts, so try other start points (then a higher bitrate) until the
      // decoded seam is as smooth as the loop's own steps.
      let best = null;
      search: for (const rate of [kbps, 64, 96]) {
        kbps = rate;
        for (let r = 0; r < 24; r++) {
          const shift = Math.round((r * x.length) / 24);
          const trial = encodeChecked(Float32Array.from({ length: x.length }, (_, i) => x[(i + shift) % x.length]));
          // The score is 1 where the seam just passes both checks (the wrap step and the level on either side of the seam).
          const seam = measure(trial.decoded, true, trial.signal);
          const ratio = Math.max(seam.wrapJump / seam.p99Jump / 1.5, seam.seamRms / 0.5);
          if (!best || ratio < best.ratio) best = { ...trial, ratio, kbps: rate };
          if (ratio <= 1) break search;
        }
      }
      ({ signal: x, mp3, decoded, kbps } = { ...best, decoded: best.decoded });
    } else ({ signal: x, mp3, decoded } = encodeChecked(x));
    writeFileSync(`${OUT}/${name}`, mp3);
    total += mp3.length;
    files.push(name);
    const m = measure(decoded, !!sound.loop, x);
    const problems = judge(m, !!sound.loop);
    if (problems.length) failures.push(`${name}: ${problems.join('; ')}`);
    report.push({ name, bytes: mp3.length, seconds: x.length / SR, ...m });
    if (sound.id.startsWith('condition.')) conditionSignatures.push({ id: sound.id, sig: signature(x) });
    const origin = layers.map((l) => {
      if (l.own) return `own: synth.mjs ${l.own}`;
      if (l.pack) return `${PACKS[l.pack].name} by ${PACKS[l.pack].author} (${PACKS[l.pack].url}): ${l.file}`;
      return `Kenney ${{ 'impact-sounds': 'Impact Sounds', 'rpg-audio': 'RPG Audio', 'interface-sounds': 'Interface Sounds' }[l.k.split('/')[0]]}: ${l.k.split('/').pop()}`;
    }).join(' + ');
    const licence = [...new Set(layers.map((l) => (l.own ? 'own' : l.pack ? PACKS[l.pack].licence : 'CC0')))].join(' + ');
    const changes = [];
    const pitches = layers.filter((l) => l.k && l.pitch).map((l) => `${l.pitch > 0 ? '+' : ''}${l.pitch} st`);
    if (pitches.length) changes.push(`pitch ${pitches.join(', ')}`);
    if (layers.length > 1) changes.push('layered');
    const seg = layers.find((l) => l.seg)?.seg;
    if (seg) changes.push(`cut ${seg.len} s from ${seg.from} s, last ${seg.xfade} s folded into the first`);
    if (sound.shape === 'hit') changes.push('first clack, 0.15 s, DC removed, faded, normalised -1 dBFS, mp3 64k');
    else changes.push(sound.loop ? `DC removed, seamless loop, normalised -1 dBFS, mp3 ${kbps}k` : `trimmed${sound.max ? `, at most ${sound.max} s` : ''}, faded, normalised -1 dBFS, mp3 64k`);
    rows.push(`| ${sound.id} | ${name} | ${origin} | ${licence} | ${changes.join('; ')} |`);
    made.set(sound.id, { licence, origin });
  });
  entries.push({ ...sound, files });
}
// A reusing sound points at the other sound's files: one MP3 in the bundle, several ids.
for (const entry of entries) {
  if (!entry.reuse) continue;
  const target = entries.find((e) => e.id === entry.reuse);
  if (!target || target.reuse || target.files.length === 0) throw new Error(`${entry.id} reuses ${entry.reuse}, which has no files of its own`);
  entry.files = target.files;
  rows.push(`| ${entry.id} | ${target.files.join(', ')} | same file as ${target.id} (not stored twice) | ${made.get(target.id).licence} | none |`);
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

Every file here is one of:

- from Kenney's CC0 packs (https://kenney.nl, public domain dedication, no attribution needed);
- from the Fantasy Ambient Sound Effects Pack by kmontesdev, CC0 (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0);
- from the 2 dice roll (29 throws) pack by RPG and 80 CC0 RPG SFX by rubberduck, both CC0 on OpenGameArt;
- from the Magic Spell SFX pack by Leonardo Calvo (The Sound Rack), **CC BY 4.0**, which needs credit:
  https://thesoundrack.itch.io/freemagicspellsfx, licence https://creativecommons.org/licenses/by/4.0/ (the credit is in the
  README's Credits; the files are cut, faded, normalised and re-encoded, which the licence allows with that notice);
- or synthesised for this project (licence "own").

Nothing else is used. A sound with no row of its own plays another sound's file (the last rows); the file is stored once.
Rebuild with:

    node scripts/sounds/fetch-kenney.mjs && node scripts/sounds/synth.mjs && node scripts/sounds/build-sounds.mjs

The pack originals are not in the repository. The build reads them from \`.sound-src/calvo/\`, \`.sound-src/kmontes/\` and
\`.sound-src/round1/\` (flat folders holding the files named in the table below, downloaded from the pack pages above).

## Changing a built-in sound

A sound is one entry of the \`SOUNDS\` table in \`scripts/sounds/build-sounds.mjs\`, and each of its variants is one line.
To swap a file, change that line and run \`node scripts/sounds/build-sounds.mjs\` from the repository root (it needs
ffmpeg); it rewrites the MP3s in this folder, \`src/sound/catalog.ts\` and this file.

- Another file from a Kenney pack: change the name in the line, for example \`[RPG('cloth1')]\` to \`[RPG('cloth7')]\`
  (the optional arguments are the pitch shift in semitones and the gain). The pack must be fetched first.
- A file from a downloaded pack: put the original in that pack's folder under \`.sound-src\` and write
  \`calvo('<file>')\` or \`kmontes('<file>')\` as the variant (a loop also takes \`LOOP_SEG(<start seconds>)\`). Credit and
  licence come from the \`PACKS\` table.
- A file of your own: save it as a WAV at \`.sound-src/own/<name>.wav\` and write \`own('<name>')\` as the variant. It must be
  CC0 or made by you; this file's table then says so.
- The base level of a sound is the \`gain\` of its entry; the build normalises every file to -1 dBFS.

(Players can also replace a sound on their own computer, with no rebuild: see "Custom sounds" in the README.)

| Sound id | File | Origin | Licence | What changed |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`);

// catalog.ts
const ident = (name) => name.replace(/\.mp3$/, '').replace(/[^A-Za-z0-9]/g, '_').replace(/^(\d)/, '_$1');
const imports = [...new Set(entries.flatMap((e) => e.files.map((f) => `import ${ident(f)} from '../assets/sounds/${f}';`)))];
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
