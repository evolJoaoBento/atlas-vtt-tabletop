/**
 * Spell notes: a D&D 5e spell written as Markdown, as the SRD's Obsidian sets write them (the 2014 SRD 5.1 notes and
 * the 2024 SRD 5.2.1 ones), read into what a cast needs. A heading with its name, a level line (`*3rd-level evocation*`,
 * `_Level 3 Evocation (Sorcerer, Wizard)_`, `*Evocation cantrip*`), the bold Casting Time, Range, Components and
 * Duration lines, then the description. From the Range and the description: the area (a sphere, a cube, a cone, a
 * line drawn as a beam, a cylinder or a wall, in feet), the damage and the save. Pure: no Obsidian, no board.
 */
import { isDamageType, type DamageType, type SpellAbout, type SpellAsk, type SpellFrom, type SpellShape } from './spells';
import { frontmatterOf, rulesFromNote, type SpellRules } from './spellRules';

/** A spell's area, in feet: as `SpellAsk` has it (a sphere's or cylinder's radius, a cube's side, a cone's length, a wall's thickness). */
export interface SpellArea {
  shape: SpellShape;
  from: SpellFrom;
  size: number;
  /** A cylinder's length (a beam's run, a column's height), a wall's height; 0 for the rest. */
  length: number;
  /** A wall's longest run. */
  longest?: number;
}

export interface SpellNote {
  name: string;
  /** 0 for a cantrip. */
  level: number;
  school: string;
  /** The level line as written, e.g. "3rd-level evocation" or "Level 3 Evocation (Sorcerer, Wizard)". */
  levelLine: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  area: SpellArea | null;
  damage: { dice: string; type: DamageType } | null;
  /** The ability saved with, e.g. "Dexterity"; null for none. */
  save: string | null;
  /** Whether it is a spell attack. */
  attack: boolean;
  /** The description, Markdown, as the note has it. */
  text: string;
  /** What it does beyond its shape: its `spell-…` properties, else what its text says plainly. */
  rules: SpellRules | null;
}

const FIELD = /^\s*\*\*(Casting Time|Range|Components|Duration):\*\*\s*(.*?)\s*$/i;
const LEVEL_2014 = /^\s*[*_]+\s*(\d+)(?:st|nd|rd|th)-level\s+([a-z]+)(.*?)[*_]+\s*$/i;
const LEVEL_2024 = /^\s*[*_]+\s*Level\s+(\d+)\s+([a-z]+)(.*?)[*_]+\s*$/i;
const CANTRIP = /^\s*[*_]+\s*([a-z]+)\s+cantrip(.*?)[*_]+\s*$/i;
const NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ABILITIES ='Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma';

/** Feet in a measure as the SRD writes one: "20", "1 inch", "a quarter inch". */
const feet = (value: string, unit = 'foot'): number => {
  const number = Number(value);
  return /inch/i.test(unit) ? number / 12 : number;
};

/** The area a spell's Range and description give; null when it has none (a single target, a touch, a self buff). */
export function spellAreaOf(range: string, text: string): SpellArea | null {
  const selfRange = /^\s*self\b/i.test(range);
  const all = `${range}\n${text}`;
  const found: Array<{ at: number; area: SpellArea }> = [];
  const take = (pattern: RegExp, make: (match: RegExpExecArray) => SpellArea | null): void => {
    const regex = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    for (let match = regex.exec(all); match; match = regex.exec(all)) {
      const area = make(match);
      if (area && area.size > 0) { found.push({ at: match.index, area }); return; }
    }
  };
  // A wall: up to X feet long, Y feet high, and Z foot thick.
  take(/wall[^.]*?up to (\d+) feet long,? (\d+) feet (?:high|tall),? and (\d+) (foot|feet|inch|inches) thick/i, (m) => ({
    shape: 'wall', from: 'point', size: feet(m[3], m[4]), length: Number(m[2]), longest: Number(m[1]),
  }));
  // A wall of panels: ten 10-foot-square panels, each so thick.
  take(/\b(two|three|four|five|six|seven|eight|nine|ten|\d+) (\d+)-foot(?:[- ]square|-by-\d+-foot) panels/i, (m) => {
    const count = Number(m[1]) || NUMBERS[m[1].toLowerCase()] || 1;
    const thick = /(\d+) (inch|inches|foot|feet) thick/i.exec(all);
    return { shape: 'wall', from: 'point', size: thick ? feet(thick[1], thick[2]) : 1, length: Number(m[2]), longest: count * Number(m[2]) };
  });
  // A column: N-foot-radius, M-foot-high cylinder (or the height first, or in words).
  const column = selfRange ? 'self' : 'point';
  take(/(\d+)-foot[- ]radius,? (\d+)-foot[- ](?:high|tall) cylinder/i, (m) => ({ shape: 'cylinder', from: column, size: Number(m[1]), length: Number(m[2]) }));
  take(/(\d+)-foot[- ](?:high|tall),? (\d+)-foot[- ]radius cylinder/i, (m) => ({ shape: 'cylinder', from: column, size: Number(m[2]), length: Number(m[1]) }));
  take(/cylinder that is (\d+) feet (?:tall|high) with a (\d+)-foot radius/i, (m) => ({ shape: 'cylinder', from: column, size: Number(m[2]), length: Number(m[1]) }));
  // A line: N feet long and M feet wide (a beam from the caster).
  take(/\bline\b[^.]{0,40}?(\d+) feet long and (\d+) feet wide/i, (m) => ({ shape: 'cylinder', from: 'self', size: Number(m[2]) / 2, length: Number(m[1]) }));
  take(/(\d+)-foot[- ]long,? (\d+)-foot[- ]wide line/i, (m) => ({ shape: 'cylinder', from: 'self', size: Number(m[2]) / 2, length: Number(m[1]) }));
  take(/(\d+)-foot[- ]wide,? (\d+)-foot[- ]long line/i, (m) => ({ shape: 'cylinder', from: 'self', size: Number(m[1]) / 2, length: Number(m[2]) }));
  take(/(\d+)-foot cone/i, (m) => ({ shape: 'cone', from: 'self', size: Number(m[1]), length: 0 }));
  take(/(\d+)-foot[- ]cube/i, (m) => ({ shape: 'cube', from: selfRange || /cube (?:that )?originat\w* from you/i.test(all) ? 'self' : 'point', size: Number(m[1]), length: 0 }));
  // A square of ground (Grease, Entangle): a cube on it.
  take(/(\d+)-foot square\b(?! panel)/i, (m) => ({ shape: 'cube', from: 'point', size: Number(m[1]), length: 0 }));
  take(/(\d+)-foot[- ]radius sphere/i, (m) => ({ shape: 'sphere', from: selfRange && /centered on you|from you/i.test(all) ? 'self' : 'point', size: Number(m[1]), length: 0 }));
  take(/(\d+)-foot[- ]diameter sphere/i, (m) => ({ shape: 'sphere', from: 'point', size: Number(m[1]) / 2, length: 0 }));
  take(/(\d+)-foot emanation/i, (m) => ({ shape: 'sphere', from: 'self', size: Number(m[1]), length: 0 }));
  // 2014 shorthands in the Range: Self (15-foot radius), Self (100-foot line).
  take(/self \((\d+)-foot[- ]radius(?: sphere)?\)/i, (m) => ({ shape: 'sphere', from: 'self', size: Number(m[1]), length: 0 }));
  take(/self \((\d+)-foot line\)/i, (m) => ({ shape: 'cylinder', from: 'self', size: 2.5, length: Number(m[1]) }));
  // A plain radius round a point: "each creature in a 10-foot radius".
  // Not the light a spell sheds ("Bright Light in a 20-foot radius").
  take(/(\d+)-foot[- ]radius\b(?! cylinder)/i, (m) => (/\blight (?:in|out to|for) an? $/i.test(all.slice(Math.max(0, m.index - 24), m.index))
    ? null : { shape: 'sphere', from: selfRange ? 'self' : 'point', size: Number(m[1]), length: 0 }));
  if (found.length === 0) return null;
  // What the note says first is the spell's own area; the Range's shorthand stands first in a 2014 note.
  found.sort((a, b) => a.at - b.at);
  return found[0].area;
}

/** A spell's first damage roll and its type, e.g. 8d6 fire. */
export function spellDamageOf(text: string): SpellNote['damage'] {
  const regex = /(\d+d\d+(?:\s*\+\s*\d+)?)\s+([a-z]+)\s+damage/gi;
  for (let match = regex.exec(text); match; match = regex.exec(text)) {
    const type = match[2].toLowerCase();
    if (isDamageType(type)) return { dice: match[1].replace(/\s+/g, ' '), type };
  }
  return null;
}

/** A note read as a spell; null when it is not one (no level line, or no Casting Time and Range). */
export function readSpellNote(markdown: string, fallbackName: string): SpellNote | null {
  const properties = frontmatterOf(markdown);
  const lines = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split(/\r?\n/);
  let name = '';
  let level = -1;
  let school = '';
  let levelLine = '';
  const fields: Record<string, string> = {};
  let body = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!name && level < 0) {
      const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
      if (heading) { name = heading[1].replace(/[*_]/g, '').trim(); continue; }
    }
    if (level < 0) {
      const old = LEVEL_2014.exec(line) ?? LEVEL_2024.exec(line);
      const cantrip = old ? null : CANTRIP.exec(line);
      if (old) { level = Number(old[1]); school = old[2]; levelLine = line.trim().replace(/^[*_]+|[*_]+$/g, '').trim(); continue; }
      if (cantrip) { level = 0; school = cantrip[1]; levelLine = line.trim().replace(/^[*_]+|[*_]+$/g, '').trim(); continue; }
    }
    const field = FIELD.exec(line);
    if (field && level >= 0) {
      fields[field[1].toLowerCase()] = field[2];
      if (field[1].toLowerCase() === 'duration') { body = i + 1; break; }
    }
  }
  if (level < 0 || fields['casting time'] === undefined || fields.range === undefined) return null;
  const text = body >= 0 ? lines.slice(body).join('\n').trim() : '';
  const range = fields.range;
  const save = new RegExp(`(${ABILITIES}) saving throw`, 'i').exec(text)?.[1] ?? null;
  return {
    name: name || fallbackName, level, school: school.charAt(0).toUpperCase() + school.slice(1).toLowerCase(), levelLine,
    castingTime: fields['casting time'], range, components: fields.components ?? '', duration: fields.duration ?? '',
    area: spellAreaOf(range, text), damage: spellDamageOf(text), save: save ? save.charAt(0).toUpperCase() + save.slice(1).toLowerCase() : null,
    attack: /spell attack/i.test(text), text, rules: rulesFromNote(properties, name || fallbackName, text, range),
  };
}

/** A level in words: "Cantrip", "Level 3". */
export const levelWords = (level: number): string => (level === 0 ? 'Cantrip' : `Level ${level}`);

/** The properties a preview shows, label and value, those the spell has. */
export function spellProperties(note: SpellNote): Array<[string, string]> {
  // The level stands in the level line above them.
  const out: Array<[string, string]> = [['Casting time', note.castingTime], ['Range', note.range]];
  if (note.area) out.push(['Area', areaWords(note.area)]);
  if (note.damage) out.push(['Damage', `${note.damage.dice} ${note.damage.type}`]);
  if (note.save) out.push(['Save', note.save]);
  else if (note.attack) out.push(['Attack', 'Spell attack']);
  out.push(['Components', note.components], ['Duration', note.duration]);
  return out.filter(([, value]) => value.trim() !== '');
}

/** An area in words, feet: "20 ft radius sphere", "100 × 5 ft line". */
export function areaWords(area: SpellArea): string {
  const ft = (value: number): string => `${Math.round(value * 100) / 100} ft`;
  switch (area.shape) {
    case 'sphere': return `${ft(area.size)} radius${area.from === 'self' ? ' round the caster' : ' sphere'}`;
    case 'cube': return `${ft(area.size)} cube${area.from === 'self' ? ' from the caster' : ''}`;
    case 'cone': return `${ft(area.size)} cone`;
    case 'cylinder': return area.from === 'self' ? `${ft(area.length)} × ${ft(area.size * 2)} line` : `${ft(area.size)} radius, ${ft(area.length)} high cylinder`;
    case 'wall': return `wall up to ${ft(area.longest ?? 0)} long, ${ft(area.length)} high, ${ft(area.size)} thick`;
  }
}

export const ABOUT_TEXT_LIMIT = 4000;

export function aboutOf(note: SpellNote): SpellAbout {
  const text = note.text.length > ABOUT_TEXT_LIMIT ? `${note.text.slice(0, ABOUT_TEXT_LIMIT - 1)}…` : note.text;
  return { line: note.levelLine.slice(0, 120), properties: spellProperties(note).slice(0, 10).map(([label, value]) => [label.slice(0, 30), value.slice(0, 200)]), text };
}

/**
 * The ask a spell makes, its area turned into map pixels: `unitDistance` feet a square, `cell` pixels a square. Null
 * when it has no area (it is then set by hand).
 */
export function askFromNote(note: SpellNote, unitDistance: number, cell: number): SpellAsk | null {
  if (!note.area) return null;
  const units = unitDistance > 0 ? unitDistance : 5;
  const px = (ft: number): number => (ft / units) * cell;
  const { area } = note;
  return {
    name: note.name.slice(0, 60), shape: area.shape, from: area.shape === 'wall' ? 'point' : area.from,
    size: px(area.size), length: area.shape === 'wall' || area.shape === 'cylinder' ? px(area.length) : 0,
    ...(area.shape === 'wall' && area.longest ? { longest: px(area.longest) } : {}),
    ...(note.damage ? { effect: note.damage.type } : {}),
    about: aboutOf(note),
    ...(note.rules ? { rules: note.rules } : {}),
  };
}
