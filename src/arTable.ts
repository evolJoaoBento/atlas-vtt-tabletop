/**
 * The AR table (Connect's `arTable.ts` carries the same shapes): where the printed marker sheets lie on the players'
 * real table, so every phone in augmented reality puts the map in the same place.
 *
 * A phone surveys the table and sends it (its sheets in its own frame, millimetres, x right and y down); the GM places
 * it on the map here (`place`: where the survey's origin lies, in squares from the map's top left, and its turn). The
 * phones get it placed: each sheet in millimetres from the map's top left, at the table's square size.
 */

export interface ArTableGroup {
  group: string;
  x: number;
  y: number;
  heading: number;
  w: number;
  h: number;
}

export interface ArSurvey {
  squareMm: number;
  groups: ArTableGroup[];
}

/** What a map keeps: the survey, and where the GM placed it. */
export interface SavedArTable {
  survey: ArSurvey;
  /** The survey's origin on the map (squares from its top left) and its turn (radians, the survey's x toward the map's y). */
  place: { x: number; y: number; turn: number };
}

/** The table placed, for the phones: the groups in millimetres from the map's top left. */
export interface ArTable {
  squareMm: number;
  groups: ArTableGroup[];
}

/** The square sizes a table may have (millimetres): Connect's page offers the same. */
export const TABLE_SQUARES_MM = [20, 25, 28, 30, 32, 35, 40, 50] as const;

const GROUP_PATTERN = /^(sheet|mat-\d{1,2}|card-\d{1,3})$/;
const finite = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

function readGroup(raw: unknown): ArTableGroup | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.group !== 'string' || !GROUP_PATTERN.test(g.group)) return null;
  if (!finite(g.x, 10_000) || !finite(g.y, 10_000) || !finite(g.heading, 10) || !finite(g.w, 1000) || !finite(g.h, 1000) || g.w <= 0 || g.h <= 0) return null;
  return { group: g.group, x: g.x, y: g.y, heading: g.heading, w: g.w, h: g.h };
}

/** A survey as a phone must send it; null for anything else. */
export function readSurvey(raw: unknown): ArSurvey | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (!finite(s.squareMm, 1000) || s.squareMm < 5 || !Array.isArray(s.groups) || s.groups.length === 0 || s.groups.length > 64) return null;
  const groups = s.groups.map(readGroup);
  if (groups.some((group) => group === null)) return null;
  const list = groups as ArTableGroup[];
  if (new Set(list.map((group) => group.group)).size !== list.length) return null;
  return { squareMm: s.squareMm, groups: list };
}

/** A map's saved table; null for anything malformed. */
export function readSavedTable(raw: unknown): SavedArTable | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  const survey = readSurvey(t.survey);
  const place = t.place as Record<string, unknown> | null | undefined;
  if (!survey || typeof place !== 'object' || place === null || !finite(place.x, 1e5) || !finite(place.y, 1e5) || !finite(place.turn, 100)) return null;
  return { survey, place: { x: place.x, y: place.y, turn: place.turn } };
}

/** A point of the survey (millimetres) on the map (millimetres from its top left). */
export function surveyToMap(saved: SavedArTable, x: number, y: number): { x: number; y: number } {
  const { place, survey } = saved;
  const c = Math.cos(place.turn);
  const s = Math.sin(place.turn);
  return { x: place.x * survey.squareMm + c * x - s * y, y: place.y * survey.squareMm + s * x + c * y };
}

/** The table placed, for the phones. */
export function placedTable(saved: SavedArTable): ArTable {
  return {
    squareMm: saved.survey.squareMm,
    groups: saved.survey.groups.map((group) => ({ ...group, ...surveyToMap(saved, group.x, group.y), heading: wrap(group.heading + saved.place.turn) })),
  };
}

/** A new survey placed: where the old placing had the sheets they share (two points each), else its middle on `middle` (squares). */
export function placeSurvey(survey: ArSurvey, before: SavedArTable | null, middle: { x: number; y: number }): SavedArTable {
  const squareMm = before?.survey.squareMm ?? survey.squareMm;
  const next: ArSurvey = { squareMm, groups: survey.groups };
  if (before) {
    const from: Array<{ x: number; y: number }> = [];
    const to: Array<{ x: number; y: number }> = [];
    for (const group of survey.groups) {
      const old = before.survey.groups.find((each) => each.group === group.group);
      if (!old) continue;
      // Its middle, and a point 50 mm along it: two points give its turn too.
      for (const along of [0, 50]) {
        from.push({ x: group.x + Math.cos(group.heading) * along, y: group.y + Math.sin(group.heading) * along });
        to.push(surveyToMap(before, old.x + Math.cos(old.heading) * along, old.y + Math.sin(old.heading) * along));
      }
    }
    const fit = rigid2d(from, to);
    if (fit && fit.error < 30) return { survey: next, place: { x: fit.x / squareMm, y: fit.y / squareMm, turn: fit.heading } };
  }
  // The sheets' middle on the map's middle, unturned.
  const xs = survey.groups.map((group) => group.x);
  const ys = survey.groups.map((group) => group.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { survey: next, place: { x: middle.x - cx / squareMm, y: middle.y - cy / squareMm, turn: 0 } };
}

/** Turns the placing about a map point (squares) by `angle` (radians). */
export function turnPlaceAbout(place: SavedArTable['place'], about: { x: number; y: number }, angle: number): SavedArTable['place'] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = place.x - about.x;
  const dy = place.y - about.y;
  return { x: about.x + c * dx - s * dy, y: about.y + s * dx + c * dy, turn: wrap(place.turn + angle) };
}

/** A sheet's name for the GM: "Mat 2", "Card 14", "Sheet". */
export function groupLabel(group: string): string {
  if (group === 'sheet') return 'Sheet';
  const [kind, number] = group.split('-');
  return kind === 'mat' ? `Mat ${Number(number) + 1}` : `Card ${Number(number) - 9}`;
}

const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/** The turn and shift best taking `from` onto `to`, and how far off they land on average; null for too few points. */
function rigid2d(from: ReadonlyArray<{ x: number; y: number }>, to: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number; heading: number; error: number } | null {
  const n = from.length;
  if (n < 2 || n !== to.length) return null;
  const mean = (points: ReadonlyArray<{ x: number; y: number }>) => ({ x: points.reduce((sum, p) => sum + p.x, 0) / n, y: points.reduce((sum, p) => sum + p.y, 0) / n });
  const a = mean(from);
  const b = mean(to);
  let dot = 0;
  let cross = 0;
  for (let i = 0; i < n; i++) {
    const px = from[i].x - a.x;
    const py = from[i].y - a.y;
    const qx = to[i].x - b.x;
    const qy = to[i].y - b.y;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
  }
  const heading = Math.atan2(cross, dot);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const x = b.x - (c * a.x - s * a.y);
  const y = b.y - (s * a.x + c * a.y);
  let error = 0;
  for (let i = 0; i < n; i++) error += Math.hypot(x + c * from[i].x - s * from[i].y - to[i].x, y + s * from[i].x + c * from[i].y - to[i].y);
  return { x, y, heading, error: error / n };
}
