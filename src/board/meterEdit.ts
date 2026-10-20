/**
 * Editing a token's HP (or stress) from its bar, with Atlas's rules: `+5` adds, `-3` subtracts, a bare number sets;
 * the maximum is read first and the current value is then kept within 0 and the new maximum. Arrow keys step by 1,
 * or 10 with Shift. Pure.
 */
import type { Meter } from './mapModel';

const INPUT = /^([+-]?)(\d+)$/;

/** The value `text` asks for, starting from `value`; null when it is not a number Atlas would take. */
export function parseMeterInput(text: string, value: number): number | null {
  const match = INPUT.exec(text.trim());
  if (!match) return null;
  const amount = Number(match[2]);
  const next = match[1] === '+' ? value + amount : match[1] === '-' ? value - amount : amount;
  return Number.isSafeInteger(next) ? next : null;
}

/** The meter after an edit of its two fields, or which field is wrong. */
export function applyMeterEdit(currentText: string, maxText: string, meter: Meter): Meter | { error: 'current' | 'max' } {
  const max = parseMeterInput(maxText, meter.max);
  if (max === null || max <= 0) return { error: 'max' };
  // A relative current applies to the value as the new max already holds it (Atlas).
  const current = parseMeterInput(currentText, Math.min(meter.current, max));
  if (current === null) return { error: 'current' };
  return { current: Math.min(max, Math.max(0, current)), max };
}

/** A field's text stepped by `delta` (an arrow key), never below 0; a relative edit (`+5`, `-3`) is left alone. */
export function stepMeterText(text: string, delta: number): string {
  if (!/^\d*$/.test(text.trim())) return text;
  return String(Math.max(0, (Number(text.trim()) || 0) + delta));
}
