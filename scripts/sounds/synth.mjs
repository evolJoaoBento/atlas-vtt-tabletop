// Renders the board sounds that are not taken from Kenney's packs, as 44.1 kHz mono 16-bit WAVs in .sound-src/own/.
// Every sound is a recipe function in RECIPES, built from the small DSP helpers at the top, so one can be retuned
// alone. Noise comes from a seeded generator per recipe, so a rebuild gives the same samples. Loops are periodic
// by construction: oscillators and slow modulators run a whole number of cycles per loop, events wrap around the
// loop end, and noise is rendered with an overlap whose tail is crossfaded (equal power) into the head.
/* global process, console -- this script runs under Node */
import { mkdirSync, writeFileSync } from 'node:fs';

export const SR = 44100;
const TAU = Math.PI * 2;

// ---- DSP helpers ----------------------------------------------------------------------------------------------

/** A seeded uniform random generator in [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const samples = (sec) => Math.round(sec * SR);
/** Fills a buffer of `sec` seconds with `fn(t, i)`. */
function gen(sec, fn) {
  const n = samples(sec);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, i);
  return out;
}
const white = (R) => R() * 2 - 1;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/** Exponential glide from `a` to `b` over `dur` seconds, held at `b` afterwards. */
const glide = (a, b, dur, t) => a * Math.pow(b / a, clamp(t / dur, 0, 1));
/** A rise over `attack` seconds then an exponential decay with time constant `tau`. */
const swell = (t, attack, tau) => (t < attack ? t / attack : Math.exp(-(t - attack) / tau));

/** A biquad filter (low-pass, high-pass or band-pass) whose centre can move from sample to sample. */
class Biq {
  constructor(type, q = 0.707) {
    this.type = type; this.q = q; this.z1 = 0; this.z2 = 0; this.f = -1;
    this.b0 = 0; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
  }
  run(x, f) {
    f = clamp(f, 20, SR * 0.45);
    if (Math.abs(f - this.f) > this.f * 0.004) {
      this.f = f;
      const w = TAU * f / SR;
      const cos = Math.cos(w);
      const alpha = Math.sin(w) / (2 * this.q);
      let b0, b1, b2;
      if (this.type === 'lp') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
      else if (this.type === 'hp') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
      else { b0 = alpha; b1 = 0; b2 = -alpha; }
      const a0 = 1 + alpha;
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * cos / a0; this.a2 = (1 - alpha) / a0;
    }
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}
const lp = (q) => new Biq('lp', q);
const hp = (q) => new Biq('hp', q);
const bp = (q) => new Biq('bp', q);

/** A phase-accumulating oscillator, so its frequency can change over time without clicks. */
class Osc {
  constructor(phase = 0) { this.p = phase; }
  sin(f) { this.p += f / SR; return Math.sin(TAU * this.p); }
  /** A saw built from up to `harmonics` partials, band-limited by construction. */
  saw(f, harmonics = 12) {
    this.p += f / SR;
    let s = 0;
    for (let k = 1; k <= harmonics && k * f < SR * 0.45; k++) s += Math.sin(TAU * k * this.p) / k;
    return s * 0.6;
  }
}

/** Adds `ev` into `dst` at `at` seconds, optionally wrapping around the end (for loops). */
function add(dst, ev, at, gain = 1, wrap = false) {
  const start = samples(at);
  for (let i = 0; i < ev.length; i++) {
    let j = start + i;
    if (wrap) j %= dst.length;
    else if (j >= dst.length) break;
    if (j >= 0) dst[j] += ev[i] * gain;
  }
}
function mixDown(...layers) {
  const out = new Float32Array(Math.max(...layers.map((l) => l.length)));
  for (const layer of layers) for (let i = 0; i < layer.length; i++) out[i] += layer[i];
  return out;
}
/** Adds a whole buffer into `dst` from its start. */
function addInto(dst, layer, gain = 1) {
  for (let i = 0; i < layer.length && i < dst.length; i++) dst[i] += layer[i] * gain;
}

/** A short burst of band-passed noise with an exponential decay: a click, a tick, a bit of debris. */
function clickEv(R, fLo, fHi, q, tau) {
  const f = fLo + R() * (fHi - fLo);
  const filter = bp(q);
  return gen(tau * 6, (t) => filter.run(white(R), f) * Math.exp(-t / tau));
}
/** A sine that glides from `f0` to `f1` over `dur` seconds under a decay, such as a bubble or a drip. */
function blipEv(f0, f1, dur, tau, length = tau * 6) {
  const osc = new Osc();
  return gen(length, (t) => osc.sin(glide(f0, f1, dur, t)) * Math.exp(-t / tau) * Math.min(1, t / 0.002));
}
/** Scatters `count` events over [t0, t1) into `dst`; `amp` shapes their level over time. */
function scatter(R, dst, count, t0, t1, make, amp = () => 1, wrap = false) {
  for (let k = 0; k < count; k++) {
    const at = t0 + R() * (t1 - t0);
    add(dst, make(), at, amp(at) * (0.4 + 0.6 * R()), wrap);
  }
}
/** A thump: a sine that falls from `f0` to `f1`, decaying with `tau`. */
function thumpEv(f0, f1, tau, pitchTau = 0.05) {
  const osc = new Osc();
  return gen(tau * 6, (t) => osc.sin(f1 + (f0 - f1) * Math.exp(-t / pitchTau)) * Math.exp(-t / tau) * Math.min(1, t / 0.002));
}
/** A bell-like ping: FM with a decay. */
function pingEv(f, ratio, index, tau) {
  const c = new Osc();
  const m = new Osc();
  return gen(tau * 6, (t) => {
    const mod = m.sin(f * ratio) * index * Math.exp(-t / (tau * 0.6));
    return Math.sin(TAU * (c.p += f / SR) + mod) * Math.exp(-t / tau) * Math.min(1, t / 0.001);
  });
}
/** A pluck: a sine with a quieter second partial, a decay and an optional vibrato. */
function pluckEv(f, tau, vibrato = 0, partial = 0.3) {
  const a = new Osc();
  const b = new Osc();
  return gen(tau * 6, (t) => {
    const fv = f * (1 + vibrato * Math.sin(TAU * 6 * t));
    return (a.sin(fv) + partial * b.sin(fv * 2.01)) * Math.exp(-t / tau) * Math.min(1, t / 0.004);
  });
}

/** Renders a loop of `sec` seconds from noise: `make(n)` yields n samples of a signal whose modulators repeat every `sec`. */
function loopNoise(sec, make, overlap = 0.35) {
  const N = samples(sec);
  const X = samples(overlap);
  const s = make(N + X);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (i < X) {
      const w = (Math.PI / 2) * (i / X);
      out[i] = s[i] * Math.sin(w) + s[N + i] * Math.cos(w);
    } else out[i] = s[i];
  }
  return out;
}
/** A filtered-noise signal for `loopNoise`: `fn(t, noise)` is called per sample, t running on past the loop end. */
const noiseSig = (R, fn) => (n) => {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, white(R));
  return out;
};

/** A small room: parallel damped combs into two all-passes, mixed in at `wet`, with `tail` seconds to ring out. */
function reverb(x, wet = 0.2, tail = 0.6) {
  const n = x.length + samples(tail);
  const input = new Float32Array(n);
  input.set(x);
  const combs = [1116, 1188, 1277, 1356, 1422, 1491].map((delay) => ({ buf: new Float32Array(delay), i: 0, damp: 0 }));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.damp = y * 0.7 + c.damp * 0.3;
      c.buf[c.i] = input[i] + c.damp * 0.82;
      c.i = (c.i + 1) % c.buf.length;
      sum += y;
    }
    out[i] = sum / combs.length;
  }
  for (const [delay, g] of [[556, 0.5], [441, 0.5]]) {
    const buf = new Float32Array(delay);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const d = buf[j];
      const y = -g * out[i] + d;
      buf[j] = out[i] + g * y;
      j = (j + 1) % delay;
      out[i] = y;
    }
  }
  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) result[i] = input[i] + wet * 3 * out[i];
  return result;
}

/** A tone that runs a whole number of cycles per loop: `f` is rounded to a multiple of 1/sec Hz. */
const periodic = (sec, f, partials = [1], modulate = () => 1) => {
  const base = Math.round(f * sec) / sec;
  return gen(sec, (t) => partials.reduce((s, amp, k) => s + amp * Math.sin(TAU * base * (k + 1) * t), 0) * modulate(t));
};
/** A tremolo of about `hz`, rounded to a whole number of cycles per loop. */
const lfo = (sec, hz, depth) => {
  const rate = Math.round(hz * sec) / sec;
  return (t) => 1 - depth + depth * (0.5 + 0.5 * Math.sin(TAU * rate * t));
};

// ---- Recipes ----------------------------------------------------------------------------------------------------
// Each entry: { sec, loop, make(R) -> Float32Array }. Names are what build-sounds.mjs refers to.

export const RECIPES = {};
const recipe = (name, sec, make, loop = false) => { RECIPES[name] = { sec, loop, make }; };
const LOOP = 3;

// -- The turn horn: a short heraldic call (C - G - high C) from a brass-like stack of harmonics.
recipe('horn', 1.9, () => {
  const notes = [{ f: 261.63, at: 0, len: 0.3 }, { f: 392, at: 0.34, len: 0.3 }, { f: 523.25, at: 0.68, len: 0.95 }];
  const out = new Float32Array(samples(1.9));
  for (const note of notes) {
    const phases = Array.from({ length: 14 }, () => 0);
    const ev = gen(note.len + 0.15, (t) => {
      const attack = Math.min(1, t / 0.04);
      const release = t > note.len ? Math.max(0, 1 - (t - note.len) / 0.15) : 1;
      const bright = Math.min(1, t / 0.07) * (0.8 + 0.2 * Math.exp(-t / 0.4));
      const scoop = 1 - 0.035 * Math.exp(-t / 0.03);
      const vib = 1 + 0.004 * Math.min(1, t / 0.3) * Math.sin(TAU * 5.5 * t);
      const f = note.f * scoop * vib;
      let s = 0;
      for (let k = 1; k <= 14; k++) {
        phases[k - 1] += f * k / SR;
        s += Math.sin(TAU * phases[k - 1]) * Math.exp(-(k - 1) * (1.05 - bright) * 0.55) / Math.pow(k, 0.9);
      }
      return s * attack * release;
    });
    add(out, ev, note.at);
  }
  const voiced = lp(0.7);
  for (let i = 0; i < out.length; i++) out[i] = voiced.run(out[i], 4200);
  return reverb(out, 0.16, 0.45);
});

// -- Dice rolling on a table: dense short clacks over a low tumble.
recipe('dice-roll', LOOP, (R) => {
  const N = samples(LOOP);
  const clacks = new Float32Array(N);
  const density = (t) => 0.55 + 0.45 * Math.sin(TAU * (t / LOOP) + 1.1) * Math.sin(TAU * 2 * (t / LOOP));
  for (let k = 0; k < 120; k++) {
    const at = R() * LOOP;
    const amp = density(at) * (0.25 + 0.75 * R() * R());
    add(clacks, clickEv(R, 1800, 6500, 5, 0.004 + R() * 0.006), at, amp * 1.4, true);
    if (R() < 0.45) add(clacks, thumpEv(700 + R() * 500, 420, 0.012 + R() * 0.01, 0.01), at, amp * 0.5, true);
  }
  const rumble = lp(0.7);
  const tumble = loopNoise(LOOP, noiseSig(R, (t, x) => rumble.run(x, 380) * 0.5 * (0.5 + 0.5 * density(t))), 0.4);
  return mixDown(clacks, tumble);
}, true);

// -- A wall coming down: a heavy thump, a second settling thump, and a long clatter of debris.
recipe('crumble', 1.9, (R) => {
  const out = new Float32Array(samples(1.9));
  add(out, thumpEv(110, 38, 0.3, 0.09), 0, 1.0);
  add(out, thumpEv(85, 34, 0.25, 0.08), 0.38, 0.55);
  const dust = lp(0.7);
  addInto(out, gen(1.9, (t) => dust.run(white(R), 1400 - 800 * Math.min(1, t / 1.5)) * swell(t, 0.03, 0.55) * 0.45));
  for (let k = 0; k < 90; k++) {
    const at = -Math.log(1 - R() * 0.97) * 0.5;
    if (at > 1.7) continue;
    add(out, clickEv(R, 700, 3200, 3, 0.008 + R() * 0.02), at, 0.7 * Math.exp(-at / 0.9));
  }
  return out;
});

// -- Conditions: sixteen short cues, each with its own shape so they can be told apart by ear.
recipe('condition-blinded', 1.2, (R) => {
  // Light going out: a bright hiss closing down to nothing over a falling tone, ending in a soft thud.
  const filter = lp(1.2);
  const osc = new Osc();
  const out = gen(1.2, (t) => (filter.run(white(R), glide(9000, 180, 0.9, t)) * 0.8 + osc.sin(glide(520, 110, 0.9, t)) * 0.4) * swell(t, 0.01, 0.35));
  add(out, thumpEv(90, 50, 0.08), 0.85, 0.8);
  return out;
});
recipe('condition-charmed', 1.5, () => {
  // A sweet rising arpeggio of plucked notes with a little vibrato.
  const out = new Float32Array(samples(1.5));
  [659.25, 830.61, 987.77, 1318.51].forEach((f, k) => add(out, pluckEv(f, 0.38, 0.006, 0.35), k * 0.11, 0.8));
  add(out, pluckEv(1975.5, 0.5, 0.004, 0.2), 0.5, 0.35);
  return reverb(out, 0.14, 0.4);
});
recipe('condition-deafened', 1.5, (R) => {
  // A muffled thump, then a thin ringing in the ears that slowly fades.
  const a = new Osc();
  const b = new Osc();
  const out = gen(1.5, (t) => (a.sin(4300) + b.sin(4390)) * 0.22 * Math.min(1, t / 0.03) * Math.exp(-t / 0.65));
  const muffle = lp(0.7);
  add(out, gen(0.12, (t) => muffle.run(white(R), 500) * Math.exp(-t / 0.03)), 0, 1.3);
  add(out, thumpEv(120, 70, 0.1), 0, 0.9);
  return out;
});
recipe('condition-exhaustion', 1.7, (R) => {
  // A tired sigh: breath through a falling band over a slumping tone.
  const filter = bp(1.1);
  const osc = new Osc();
  return gen(1.7, (t) => (filter.run(white(R), glide(1400, 450, 1.4, t)) * 1.6 + osc.sin(glide(230, 100, 1.5, t)) * 0.35) * swell(t, 0.4, 0.5));
});
recipe('condition-frightened', 1.3, (R) => {
  // A tense stinger: two clashing tremolo tones that creep upward.
  const a = new Osc();
  const b = new Osc();
  const c = new Osc();
  const out = gen(1.3, (t) => {
    const creep = 1 + 0.03 * t;
    const trem = 0.55 + 0.45 * Math.sin(TAU * 11 * t);
    return (a.saw(700 * creep, 6) + b.saw(742 * creep, 6) + 0.6 * c.sin(1050 * creep)) * trem * swell(t, 0.004, 0.5) * 0.5;
  });
  add(out, clickEv(R, 3000, 6000, 2, 0.01), 0, 0.8);
  return out;
});
recipe('condition-grappled', 1.3, (R) => {
  // A rope or limb under strain: a rasping creak that swells, then a dull thud.
  const osc = new Osc();
  const filter = bp(2.2);
  let drift = 0;
  const out = gen(1.3, (t) => {
    drift += (white(R) * 0.2 - drift) * 0.002;
    const grate = 0.6 + 0.4 * Math.sign(Math.sin(TAU * 31 * t));
    return filter.run(osc.saw(85 * (1 + drift * 5), 20), 450 + 450 * Math.min(1, t / 0.8)) * 3 * grate * Math.min(1, t / 0.5) * (t < 1.0 ? 1 : Math.exp(-(t - 1) / 0.04));
  });
  add(out, thumpEv(95, 52, 0.1), 1.0, 1.0);
  return out;
});
recipe('condition-incapacitated', 1.4, (R) => {
  // Staggering: a wobbling tone falling in pitch, then a heavy drop.
  const a = new Osc();
  const b = new Osc();
  const out = gen(1.4, (t) => {
    const wob = 1 + (0.02 + 0.05 * t) * Math.sin(TAU * (5 + 3 * t) * t);
    return (a.sin(glide(330, 140, 1.0, t) * wob) + 0.4 * b.sin(glide(660, 280, 1.0, t) * wob)) * swell(t, 0.02, 0.45) * (t < 0.9 ? 1 : Math.exp(-(t - 0.9) / 0.05));
  });
  const dull = lp(0.7);
  add(out, gen(0.15, (t) => dull.run(white(R), 600) * Math.exp(-t / 0.04)), 0.9, 0.9);
  add(out, thumpEv(80, 45, 0.18), 0.9, 1.1);
  return out;
});
recipe('condition-invisible', 1.4, (R) => {
  // Fading out of sight: airy noise sweeping up in a swell that vanishes, over a faint rising shimmer.
  const filter = bp(2.5);
  const osc = new Osc();
  return gen(1.4, (t) => {
    const env = Math.pow(clamp(t / 0.6, 0, 1), 2) * (t < 0.6 ? 1 : Math.exp(-(t - 0.6) / 0.08));
    return (filter.run(white(R), glide(500, 5500, 0.7, t)) * 1.5 + osc.sin(glide(1100, 2600, 0.7, t)) * 0.18 * (0.6 + 0.4 * Math.sin(TAU * 9 * t))) * env;
  });
});
recipe('condition-paralyzed', 1.3, (R) => {
  // Seizing up: buzzing jolts that come further and further apart, then a dead clunk.
  const out = new Float32Array(samples(1.3));
  let at = 0;
  for (let k = 0; at < 0.95; k++) {
    const osc = new Osc();
    const len = 0.025;
    add(out, gen(len, (t) => (osc.saw(120, 14) * 0.7 + white(R) * 0.35) * Math.min(1, t / 0.002) * Math.min(1, (len - t) / 0.004)), at, 1);
    at += 0.03 * Math.pow(1.38, k);
  }
  add(out, thumpEv(160, 90, 0.07), 1.05, 0.9);
  return out;
});
recipe('condition-petrified', 1.7, (R) => {
  // Turning to stone: a grinding low rasp that slows and cracks, ending in a very heavy thud.
  const dust = lp(1.5);
  const out = new Float32Array(samples(1.7));
  addInto(out, gen(1.2, (t) => dust.run(white(R), 520) * (0.5 + 0.5 * Math.sign(Math.sin(TAU * glide(34, 9, 1.1, t) * t))) * swell(t, 0.1, 0.6) * 1.8));
  for (const at of [0.25, 0.62, 0.9]) add(out, clickEv(R, 1800, 3200, 4, 0.006), at, 0.9);
  add(out, thumpEv(75, 32, 0.3, 0.06), 1.1, 1.2);
  const body = lp(0.7);
  add(out, gen(0.2, (t) => body.run(white(R), 300) * Math.exp(-t / 0.05)), 1.1, 0.8);
  return out;
});
recipe('condition-poisoned', 1.5, (R) => {
  // A sickly gurgle: slow bubbles popping over a queasy wavering tone.
  const osc = new Osc();
  const out = gen(1.5, (t) => osc.sin(glide(260, 140, 1.4, t) + 70 * Math.sin(TAU * 3.2 * t)) * 0.35 * swell(t, 0.1, 0.7));
  for (let k = 0; k < 8; k++) add(out, blipEv(180 + R() * 100, 480 + R() * 300, 0.05, 0.03), 0.05 + k * 0.14 + R() * 0.06, 0.6 + 0.4 * R());
  return out;
});
recipe('condition-prone', 1.0, (R) => {
  // Hitting the floor: a thud, a scuff of cloth and dust, and a small second settle.
  const out = new Float32Array(samples(1.0));
  const dull = lp(0.7);
  add(out, thumpEv(100, 45, 0.15), 0, 1);
  add(out, gen(0.12, (t) => dull.run(white(R), 1000) * Math.exp(-t / 0.03)), 0, 0.9);
  const scuff = bp(0.9);
  add(out, gen(0.35, (t) => scuff.run(white(R), 1600) * Math.sin(Math.PI * t / 0.35)), 0.12, 0.7);
  add(out, thumpEv(90, 50, 0.08), 0.46, 0.4);
  return out;
});
recipe('condition-restrained', 1.4, (R) => {
  // Chains: a clatter of metallic link rings, closing on a heavy clank.
  const out = new Float32Array(samples(1.4));
  for (let k = 0; k < 14; k++) add(out, pingEv(1900 + R() * 900, 3.1, 3, 0.03), k * 0.055 + R() * 0.02, 0.35 + 0.4 * R());
  add(out, pingEv(780, 2.76, 4, 0.12), 0.85, 1);
  add(out, clickEv(R, 2500, 4500, 2, 0.01), 0.85, 0.7);
  return out;
});
recipe('condition-stunned', 1.5, (R) => {
  // A bonk, then a ring of dizzy little pings that circle downwards.
  const out = new Float32Array(samples(1.5));
  add(out, blipEv(380, 150, 0.06, 0.09), 0, 1);
  add(out, clickEv(R, 1500, 3000, 2, 0.006), 0, 0.5);
  for (let k = 0; k < 7; k++) {
    const f = 2400 * Math.pow(0.9, k);
    const osc = new Osc();
    add(out, gen(0.22, (t) => osc.sin(f * (1 + 0.03 * Math.sin(TAU * 8 * t))) * Math.exp(-t / 0.07)), 0.22 + k * 0.1, 0.5 * Math.pow(0.88, k));
  }
  return out;
});
recipe('condition-unconscious', 2.2, () => {
  // Slipping under: a slow heartbeat that fades with a deep tone sinking away.
  const osc = new Osc();
  const out = gen(2.2, (t) => osc.sin(glide(150, 50, 2.0, t)) * 0.25 * Math.min(1, t / 0.3) * Math.exp(-t / 0.9));
  add(out, thumpEv(70, 45, 0.09), 0, 1);
  add(out, thumpEv(65, 42, 0.08), 0.22, 0.6);
  add(out, thumpEv(68, 44, 0.09), 1.05, 0.55);
  add(out, thumpEv(62, 40, 0.08), 1.29, 0.3);
  return out;
});
recipe('condition-applied', 0.8, (R) => {
  // The generic cue for a condition taking hold: two falling pings over a low knock.
  const out = new Float32Array(samples(0.8));
  add(out, pingEv(880, 2, 1.2, 0.14), 0, 0.8);
  add(out, pingEv(587.33, 2, 1.2, 0.16), 0.12, 0.9);
  add(out, thumpEv(110, 70, 0.1), 0.12, 0.8);
  const tick = lp(0.7);
  add(out, gen(0.04, (t) => tick.run(white(R), 2500) * Math.exp(-t / 0.01)), 0, 0.3);
  return out;
});

// -- Spell impacts, one per damage type.
recipe('spell-impact-acid', 1.1, (R) => {
  // A splash and sizzle: a hiss with crackle and a few popping bubbles.
  const out = new Float32Array(samples(1.1));
  const hiss = hp(0.7);
  addInto(out, gen(1.1, (t) => hiss.run(white(R), 3200) * swell(t, 0.01, 0.3) * 0.5));
  add(out, clickEv(R, 1500, 2600, 1.2, 0.07), 0, 0.9);
  scatter(R, out, 45, 0.03, 0.9, () => clickEv(R, 4000, 9000, 4, 0.002), (t) => 0.8 * Math.exp(-t / 0.5));
  scatter(R, out, 7, 0.05, 0.7, () => blipEv(500, 1500, 0.03, 0.025), () => 0.5);
  return out;
});
recipe('spell-impact-bludgeoning', 0.9, (R) => {
  // A heavy blunt blow with a small rebound.
  const out = new Float32Array(samples(0.9));
  const body = lp(0.7);
  add(out, thumpEv(150, 42, 0.22, 0.04), 0, 1.0);
  add(out, gen(0.1, (t) => body.run(white(R), 700) * Math.exp(-t / 0.025)), 0, 1.1);
  add(out, thumpEv(110, 45, 0.12, 0.04), 0.3, 0.3);
  return out;
});
recipe('spell-impact-cold', 1.4, (R) => {
  // Ice: a sharp crack then inharmonic crystal partials with sparkling glints.
  const out = new Float32Array(samples(1.4));
  add(out, clickEv(R, 5000, 8000, 1.5, 0.012), 0, 1.2);
  [2093, 3160, 4186, 5600].forEach((f, k) => add(out, pluckEv(f, 0.55 - 0.08 * k, 0, 0), 0.01 * k, 0.45 / (k + 1)));
  scatter(R, out, 14, 0.05, 1.1, () => blipEv(6000 + R() * 3000, 6000 + R() * 3000, 0.01, 0.02), (t) => 0.35 * Math.exp(-t / 0.7));
  return out;
});
recipe('spell-impact-explosion', 1.6, (R) => {
  // A blast: a sub boom, a roaring burst of noise closing down in tone, and falling debris crackle.
  const out = new Float32Array(samples(1.6));
  const roar = lp(0.8);
  addInto(out, gen(1.6, (t) => roar.run(white(R), glide(7000, 160, 1.1, t)) * swell(t, 0.004, 0.42) * 1.4));
  add(out, thumpEv(95, 30, 0.45, 0.12), 0, 1.4);
  scatter(R, out, 35, 0.25, 1.3, () => clickEv(R, 900, 3000, 2.5, 0.01), (t) => 0.5 * Math.exp(-(t - 0.25) / 0.5));
  return out;
});
recipe('spell-impact-fire', 1.3, (R) => {
  // A whoosh of flame: a band of noise rising and falling over a crackle.
  const out = new Float32Array(samples(1.3));
  const band = bp(1.1);
  addInto(out, gen(1.3, (t) => band.run(white(R), 300 + 2300 * Math.sin(Math.PI * clamp(t / 0.9, 0, 1))) * swell(t, 0.18, 0.4) * 3));
  const roar = lp(0.7);
  addInto(out, gen(1.3, (t) => roar.run(white(R), 260) * swell(t, 0.1, 0.5) * 0.9));
  scatter(R, out, 28, 0.1, 1.2, () => clickEv(R, 1500, 4500, 3, 0.005), (t) => 0.7 * Math.exp(-t / 0.7));
  return out;
});
recipe('spell-impact-force', 1.1, () => {
  // A pressure pulse: a falling sweep with a throbbing FM body and a ringing shock.
  const sweep = new Osc();
  const carrier = new Osc();
  const mod = new Osc();
  const out = gen(1.1, (t) => {
    const s = sweep.sin(70 + 330 * Math.exp(-t / 0.07)) * Math.exp(-t / 0.28);
    const fm = Math.sin(TAU * (carrier.p += 110 / SR) + mod.sin(165) * 4 * Math.exp(-t / 0.3)) * Math.exp(-t / 0.35) * 0.5;
    return s + fm;
  });
  add(out, pingEv(440, 1.5, 2, 0.4), 0.02, 0.25);
  return out;
});
recipe('spell-impact-lightning', 1.0, (R) => {
  // A crack: gated hard noise in three jolts, a descending saw zap, and an electrical buzz tail.
  const buzz = new Osc();
  const out = gen(1.0, (t) => buzz.saw(110, 14) * 0.3 * (0.5 + 0.5 * Math.sign(Math.sin(TAU * 47 * t))) * swell(t, 0.1, 0.18));
  [0, 0.075, 0.17].forEach((at, k) => {
    const osc = new Osc();
    const filter = hp(0.7);
    let gate = 1;
    add(out, gen(0.09, (t, i) => {
      if (i % 40 === 0) gate = R() < 0.65 ? 1 : 0.15;
      return (filter.run(white(R), 1800) * 1.4 + osc.saw(glide(1500, 220, 0.06, t), 8) * 0.6) * gate * Math.exp(-t / 0.035);
    }), at, 1 - 0.25 * k);
  });
  return out;
});
recipe('spell-impact-necrotic', 1.6, (R) => {
  // Rot and dread: a sagging, beating low drone under hushed whispering.
  const a = new Osc();
  const b = new Osc();
  const dark = lp(0.8);
  const whisperBand = bp(4);
  return gen(1.6, (t) => {
    const sag = glide(1, 0.8, 1.5, t);
    const drone = dark.run(a.saw(55 * sag, 10) + b.saw(77.8 * sag, 10), 420) * 0.7;
    const whisper = whisperBand.run(white(R), 1800) * (0.5 + 0.5 * Math.sin(TAU * 7 * t)) * 1.6;
    return (drone + whisper * 0.7) * swell(t, 0.12, 0.7);
  });
});
recipe('spell-impact-piercing', 0.7, (R) => {
  // A thin, quick thwip with a fine ring.
  const out = new Float32Array(samples(0.7));
  const filter = bp(2);
  add(out, gen(0.1, (t) => filter.run(white(R), 5200) * Math.exp(-t / 0.018) * 1.8), 0, 1);
  add(out, blipEv(4500, 2000, 0.08, 0.05), 0, 0.8);
  add(out, pluckEv(3300, 0.16, 0, 0.1), 0.02, 0.3);
  return out;
});
recipe('spell-impact-poison', 1.5, (R) => {
  // A wet, slow gurgle: low bubbles over a queasy wobble and a damp hiss.
  const osc = new Osc();
  const out = gen(1.5, (t) => osc.sin(150 + 45 * Math.sin(TAU * 7 * t)) * 0.4 * swell(t, 0.05, 0.5));
  scatter(R, out, 9, 0.02, 1.2, () => blipEv(180 + R() * 60, 380 + R() * 120, 0.06, 0.05), () => 0.7);
  const wet = bp(1);
  addInto(out, gen(1.5, (t) => wet.run(white(R), 900) * swell(t, 0.03, 0.3) * 0.7));
  return out;
});
recipe('spell-impact-psychic', 1.6, (R) => {
  // A warbling swell of beating tones that glides upward, over a breath of high whisper.
  const a = new Osc();
  const b = new Osc();
  const c = new Osc();
  const air = bp(5);
  return gen(1.6, (t) => {
    const rise = glide(1, 1.25, 1.2, t);
    const vib = 1 + 0.03 * Math.sin(TAU * 5.5 * t);
    const tones = a.sin(880 * rise * vib) + b.sin(891 * rise * vib) + 0.5 * c.sin(1320 * rise * (2 - vib));
    return (tones * 0.4 + air.run(white(R), 2600 + 600 * Math.sin(TAU * 3 * t)) * 1.1) * swell(t, 0.45, 0.45);
  });
});
recipe('spell-impact-radiant', 1.8, () => {
  // A bright, warm chord blooming with a bell ping on top.
  const out = new Float32Array(samples(1.8));
  [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => {
    const a = new Osc();
    const b = new Osc();
    add(out, gen(1.6, (t) => (a.sin(f) + 0.25 * b.sin(f * 2)) * swell(t, 0.08, 0.7) * (0.85 + 0.15 * Math.sin(TAU * 6 * t)) * 0.3), k * 0.012);
  });
  add(out, pingEv(2093, 1, 0.6, 0.5), 0.05, 0.35);
  return reverb(out, 0.14, 0.4);
});
recipe('spell-impact-slashing', 0.8, (R) => {
  // A blade swish with a steel ring.
  const out = new Float32Array(samples(0.8));
  const band = bp(2);
  add(out, gen(0.3, (t) => band.run(white(R), glide(800, 6500, 0.13, t)) * swell(t, 0.03, 0.07) * 2.2), 0, 1);
  const a = new Osc();
  const b = new Osc();
  add(out, gen(0.5, (t) => (a.sin(3400) + 0.4 * b.sin(5100)) * Math.exp(-t / 0.22) * Math.min(1, t / 0.003)), 0.08, 0.3);
  add(out, clickEv(R, 3000, 6000, 2, 0.005), 0.07, 0.5);
  return out;
});
recipe('spell-impact-thunder', 2.2, (R) => {
  // A sharp crack that rolls away into low rumbling.
  const out = new Float32Array(samples(2.2));
  const crack = hp(0.7);
  add(out, gen(0.25, (t) => crack.run(white(R), 900) * Math.exp(-t / 0.05)), 0, 1.1);
  const rumble = lp(0.9);
  let slow = 0;
  addInto(out, gen(2.2, (t) => {
    slow += (white(R) - slow) * 0.0009;
    return rumble.run(white(R), 190) * swell(t, 0.08, 0.9) * (0.6 + 6 * slow) * 2;
  }));
  add(out, thumpEv(55, 35, 0.6, 0.2), 0.02, 0.9);
  return out;
});
recipe('spell-impact-plain', 1.0, (R) => {
  // Neutral magic: a soft rising pluck with a few glints.
  const out = new Float32Array(samples(1.0));
  add(out, pluckEv(784, 0.35, 0, 0.35), 0, 0.8);
  add(out, blipEv(600, 784, 0.03, 0.05), 0, 0.2);
  scatter(R, out, 6, 0.05, 0.6, () => blipEv(2200 + R() * 2000, 2200 + R() * 2000, 0.01, 0.025), () => 0.3);
  return out;
});

// -- Spell loops, one per damage type: three seconds that repeat without a seam.
recipe('spell-loop-acid', LOOP, (R) => {
  const out = new Float32Array(samples(LOOP));
  scatter(R, out, 100, 0, LOOP, () => clickEv(R, 3500, 9000, 4, 0.002), () => 0.6, true);
  scatter(R, out, 8, 0, LOOP, () => blipEv(450 + R() * 200, 1300 + R() * 500, 0.03, 0.03), () => 0.5, true);
  const f = hp(0.7);
  return mixDown(out, loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 3200) * 0.22)));
}, true);
recipe('spell-loop-bludgeoning', LOOP, (R) => {
  const out = new Float32Array(samples(LOOP));
  const body = lp(0.7);
  [0.35, 1.1, 1.85, 2.6].forEach((at, k) => {
    add(out, thumpEv(140, 45, 0.2, 0.04), at, k % 2 ? 0.8 : 1, true);
    add(out, gen(0.08, (t) => body.run(white(R), 600) * Math.exp(-t / 0.02)), at, 0.5, true);
  });
  return out;
}, true);
recipe('spell-loop-cold', LOOP, (R) => {
  const tones = mixDown(
    periodic(LOOP, 2093, [1, 0.2], lfo(LOOP, 4, 0.5)),
    periodic(LOOP, 3160, [1], lfo(LOOP, 5, 0.6)),
    periodic(LOOP, 4186, [1], lfo(LOOP, 3, 0.7)),
  ).map((x) => x * 0.14);
  const sparkle = new Float32Array(samples(LOOP));
  scatter(R, sparkle, 10, 0, LOOP, () => blipEv(5500 + R() * 3500, 5500 + R() * 3500, 0.01, 0.025), () => 0.35, true);
  const f = bp(1);
  const wind = loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 3000 + 800 * Math.sin(TAU * t / LOOP)) * 0.35 * (0.6 + 0.4 * Math.sin(TAU * 2 * t / LOOP))));
  return mixDown(tones, sparkle, wind);
}, true);
recipe('spell-loop-explosion', LOOP, (R) => {
  const f = lp(0.8);
  const rumble = loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 130 + 40 * Math.sin(TAU * 2 * t / LOOP)) * 2.2 * (0.7 + 0.3 * Math.sin(TAU * 3 * t / LOOP))));
  const pops = new Float32Array(samples(LOOP));
  scatter(R, pops, 38, 0, LOOP, () => clickEv(R, 700, 2800, 2.5, 0.012), () => 0.6, true);
  scatter(R, pops, 5, 0, LOOP, () => thumpEv(90, 40, 0.15, 0.05), () => 0.5, true);
  return mixDown(rumble, pops);
}, true);
recipe('spell-loop-fire', LOOP, (R) => {
  const f = lp(0.7);
  const g = bp(0.9);
  const roar = loopNoise(LOOP, noiseSig(R, (t, x) => (f.run(x, 700) * 0.9 + g.run(x, 1800) * 0.5) * (0.65 + 0.35 * Math.sin(TAU * 5 * t / LOOP) * Math.sin(TAU * 11 * t / LOOP))));
  const crackle = new Float32Array(samples(LOOP));
  scatter(R, crackle, 100, 0, LOOP, () => clickEv(R, 1400, 4500, 3, 0.005), () => 0.8, true);
  return mixDown(roar, crackle);
}, true);
recipe('spell-loop-force', LOOP, () => {
  // A humming field: a low FM tone throbbing in a slow pulse.
  const base = Math.round(110 * LOOP) / LOOP;
  const pulse = lfo(LOOP, 2, 0.45);
  const hum = gen(LOOP, (t) => {
    const mod = Math.sin(TAU * (base / 2) * t) * 2;
    return (Math.sin(TAU * base * t + mod) + 0.4 * Math.sin(TAU * base * 2 * t + mod * 0.5)) * 0.5 * pulse(t);
  });
  return mixDown(hum, periodic(LOOP, 55, [0.5]));
}, true);
recipe('spell-loop-lightning', LOOP, (R) => {
  const rate = Math.round(120 * LOOP) / LOOP;
  const buzz = gen(LOOP, (t) => {
    let s = 0;
    for (let k = 1; k <= 14; k++) s += Math.sin(TAU * rate * k * t) / k;
    return s * 0.3 * (0.6 + 0.4 * Math.sin(TAU * 13 * t / LOOP));
  });
  const zaps = new Float32Array(samples(LOOP));
  for (let k = 0; k < 9; k++) {
    const f = hp(0.7);
    let gate = 1;
    const len = 0.03 + R() * 0.06;
    add(zaps, gen(len, (t, i) => {
      if (i % 30 === 0) gate = R() < 0.6 ? 1 : 0.2;
      return f.run(white(R), 2200) * gate * Math.exp(-t / (len / 2.5));
    }), R() * LOOP, 0.8, true);
  }
  return mixDown(buzz, zaps);
}, true);
recipe('spell-loop-necrotic', LOOP, (R) => {
  const drone = mixDown(periodic(LOOP, 55, [1, 0.35]), periodic(LOOP, 77.67, [0.8]), periodic(LOOP, 82.33, [0.6])).map((x) => x * 0.4);
  const f = bp(4);
  const whisper = loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 1800 + 300 * Math.sin(TAU * t / LOOP)) * 1.2 * (0.5 + 0.5 * Math.sin(TAU * 7 * t / LOOP)) * (0.6 + 0.4 * Math.sin(TAU * t / LOOP))));
  return mixDown(drone, whisper);
}, true);
recipe('spell-loop-piercing', LOOP, (R) => {
  const c1 = Math.round(3000 * LOOP) / LOOP;
  const c2 = Math.round(3013 * LOOP) / LOOP;
  const tremolo = lfo(LOOP, 2, 0.4);
  const whine = gen(LOOP, (t) => (Math.sin(TAU * c1 * t + 0.4 * Math.sin(TAU * 4 * t)) + Math.sin(TAU * c2 * t)) * 0.2 * tremolo(t));
  const ticks = new Float32Array(samples(LOOP));
  [0.2, 0.9, 1.55, 2.2, 2.65].forEach((at) => add(ticks, clickEv(R, 4500, 6500, 3, 0.004), at + R() * 0.05, 0.7, true));
  return mixDown(whine, ticks);
}, true);
recipe('spell-loop-poison', LOOP, (R) => {
  const base = Math.round(140 * LOOP) / LOOP;
  const wobble = lfo(LOOP, 2, 0.5);
  const gurgle = gen(LOOP, (t) => Math.sin(TAU * base * t + 2.5 * Math.sin(TAU * 3 * t / LOOP)) * 0.3 * wobble(t));
  const bubbles = new Float32Array(samples(LOOP));
  scatter(R, bubbles, 8, 0, LOOP, () => blipEv(180 + R() * 70, 400 + R() * 150, 0.06, 0.05), () => 0.8, true);
  const f = bp(1);
  const wet = loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 750 + 250 * Math.sin(TAU * 2 * t / LOOP)) * 0.5));
  return mixDown(gurgle, bubbles, wet);
}, true);
recipe('spell-loop-psychic', LOOP, (R) => {
  const warble = (f, depth) => {
    const cycles = Math.round(f * LOOP) / LOOP;
    return gen(LOOP, (t) => Math.sin(TAU * cycles * t + depth * Math.sin(TAU * 16 * t / LOOP) + 1.5 * Math.sin(TAU * t / LOOP)) * 0.25);
  };
  const f = bp(5);
  const air = loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 2600 + 500 * Math.sin(TAU * 2 * t / LOOP)) * 0.7));
  return mixDown(warble(440, 1.2), warble(445.33, 1.2), warble(660, 0.9), air);
}, true);
recipe('spell-loop-radiant', LOOP, () => {
  const trem = lfo(LOOP, 6, 0.18);
  const mod = (t) => (0.8 + 0.2 * Math.sin(TAU * t / LOOP)) * trem(t);
  return mixDown(
    periodic(LOOP, 523.33, [1, 0.25], mod),
    periodic(LOOP, 659.33, [1, 0.2], mod),
    periodic(LOOP, 784, [1, 0.2], mod),
    periodic(LOOP, 1046.67, [0.6], mod),
  ).map((x) => x * 0.22);
}, true);
recipe('spell-loop-slashing', LOOP, (R) => {
  const out = new Float32Array(samples(LOOP));
  [0.15, 0.95, 1.55, 2.3].forEach((at, k) => {
    const band = bp(2);
    add(out, gen(0.3, (t) => band.run(white(R), glide(900, 6500, 0.13, t)) * swell(t, 0.03, 0.07) * 2.2), at, 0.9 - 0.1 * k, true);
    const a = new Osc();
    add(out, gen(0.4, (t) => a.sin(3200 + 150 * k) * Math.exp(-t / 0.18) * Math.min(1, t / 0.003)), at + 0.08, 0.2, true);
  });
  const f = hp(0.7);
  return mixDown(out, loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 6000) * 0.04)));
}, true);
recipe('spell-loop-thunder', LOOP, (R) => {
  const f = lp(0.9);
  const rumble = loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 170 + 60 * Math.sin(TAU * t / LOOP)) * 2.4 * (0.55 + 0.3 * Math.sin(TAU * t / LOOP) + 0.15 * Math.sin(TAU * 4 * t / LOOP + 1))));
  const sub = periodic(LOOP, 45, [1]).map((x) => x * 0.15);
  const crackle = new Float32Array(samples(LOOP));
  scatter(R, crackle, 6, 0, LOOP, () => { const g = lp(0.7); return gen(0.05, (t) => g.run(white(R), 900) * Math.exp(-t / 0.012)); }, () => 0.4, true);
  return mixDown(rumble, sub, crackle);
}, true);
recipe('spell-loop-plain', LOOP, (R) => {
  const trem = lfo(LOOP, 2, 0.3);
  const hum = mixDown(periodic(LOOP, 220, [1, 0.2], trem), periodic(LOOP, 330, [0.6], trem), periodic(LOOP, 440, [0.3], trem)).map((x) => x * 0.35);
  const glints = new Float32Array(samples(LOOP));
  scatter(R, glints, 7, 0, LOOP, () => blipEv(2200 + R() * 2000, 2200 + R() * 2000, 0.01, 0.04), () => 0.35, true);
  const f = bp(2);
  return mixDown(hum, glints, loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 2000) * 0.2)));
}, true);

// -- Water loops.
recipe('water-ripples', LOOP, (R) => {
  // Gentle lapping with now and then a drip.
  const f = bp(1.6);
  const lap = loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 1700 + 500 * Math.sin(TAU * 3 * t / LOOP)) * (0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(TAU * 9 * t / LOOP), 2)) * 0.9));
  const drips = new Float32Array(samples(LOOP));
  scatter(R, drips, 9, 0, LOOP, () => blipEv(500 + R() * 200, 1300 + R() * 500, 0.04, 0.03), () => 0.5, true);
  return mixDown(lap, drips);
}, true);
recipe('water-flow', 4, (R) => {
  // A stream: several bands of noise drifting about, without a clear rhythm.
  const bands = [[bp(1.4), 700, 5, 1], [bp(1.6), 1500, 9, 0.9], [bp(2), 3200, 14, 0.5]];
  return loopNoise(4, noiseSig(R, (t, x) => bands.reduce((s, [f, centre, rate, amp], k) => s + f.run(x, centre * (1 + 0.28 * Math.sin(TAU * rate * t / 4 + k * 2))) * amp * (0.75 + 0.25 * Math.sin(TAU * (rate + 4) * t / 4 + k)), 0)), 0.5);
}, true);
recipe('water-waves', 4, (R) => {
  // Swells: noise that builds into a wave, breaks into foam and draws back.
  const N = samples(4);
  const f = lp(0.8);
  const g = hp(0.7);
  const body = loopNoise(4, noiseSig(R, (t, x) => f.run(x, 700 + 400 * Math.sin(TAU * t / 4)) * 2.5), 0.5);
  const foam = loopNoise(4, noiseSig(R, (t, x) => g.run(x, 2800) * 0.5), 0.5);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const wave = Math.pow(0.5 - 0.5 * Math.cos(TAU * (t / 4 - 0.1)), 1.7);
    const late = Math.pow(0.5 - 0.5 * Math.cos(TAU * (t / 4 - 0.25)), 2.5);
    out[i] = body[i] * (0.15 + 0.85 * wave) + foam[i] * late;
  }
  return out;
}, true);
recipe('water-still', LOOP, (R) => {
  // Almost nothing: a soft low murmur with the faintest sparkle and one slow drop.
  const f = lp(0.7);
  const g = bp(5);
  const murmur = loopNoise(LOOP, noiseSig(R, (t, x) => f.run(x, 380) * 1.4 * (0.75 + 0.25 * Math.sin(TAU * t / LOOP))));
  const sheen = loopNoise(LOOP, noiseSig(R, (t, x) => g.run(x, 1900) * 0.5 * (0.6 + 0.4 * Math.sin(TAU * 2 * t / LOOP))));
  const drop = new Float32Array(samples(LOOP));
  add(drop, blipEv(600, 1100, 0.05, 0.06), 1.6, 0.25, true);
  return mixDown(murmur, sheen, drop);
}, true);

// ---- WAV output ---------------------------------------------------------------------------------------------------

/** Encodes mono float samples as a 16-bit PCM WAV, scaled so the peak sits at 0.95 of full scale. */
export function wavBytes(input) {
  let peak = 0;
  for (const s of input) peak = Math.max(peak, Math.abs(s));
  const scale = peak > 0 ? 0.95 / peak : 1;
  const n = input.length;
  const bytes = Buffer.alloc(44 + n * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + n * 2, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SR, 24); bytes.writeUInt32LE(SR * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) bytes.writeInt16LE(Math.round(clamp(input[i] * scale, -1, 1) * 32767), 44 + i * 2);
  return bytes;
}

/** Renders one recipe to its samples. */
export function render(name) {
  const entry = RECIPES[name];
  const out = entry.make(rng(hash(name)));
  if (entry.loop && out.length !== samples(entry.sec)) throw new Error(`${name}: loop is ${out.length} samples, expected ${samples(entry.sec)}`);
  return out;
}

if (process.argv[1]?.endsWith('synth.mjs')) {
  const dir = '.sound-src/own';
  mkdirSync(dir, { recursive: true });
  const only = process.argv[2];
  for (const name of Object.keys(RECIPES)) {
    if (only && name !== only) continue;
    writeFileSync(`${dir}/${name}.wav`, wavBytes(render(name)));
    console.log(`${name}: ${RECIPES[name].sec.toFixed(1)} s`);
  }
}
