/**
 * The part of vitest's `describe`/`it`/`expect` that Atlas's fog tests use, on node:test and node:assert, so those tests
 * run here as they are (their imports pointed at `src/atlasPort/app`).
 */
import assert from 'node:assert/strict';
import { describe as nodeDescribe, it as nodeIt } from 'node:test';

export const describe = nodeDescribe;
export const it = nodeIt;

class ArrayContaining {
  constructor(readonly items: readonly unknown[]) {}
}

/** `actual` as a plain structure `expect.arrayContaining` can be tested against. */
function matches(actual: unknown, expected: unknown): boolean {
  if (expected instanceof ArrayContaining) return Array.isArray(actual) && expected.items.every((item) => actual.some((entry) => matches(entry, item)));
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => matches(actual[index], item));
  return Object.entries(expected).every(([key, value]) => matches((actual as Record<string, unknown>)[key], value));
}

/** Whether `expected` holds an asymmetric matcher anywhere. */
function asymmetric(expected: unknown): boolean {
  if (expected instanceof ArrayContaining) return true;
  if (expected === null || typeof expected !== 'object') return false;
  return Object.values(expected).some(asymmetric);
}

/** `actual` has everything `expected` has (toMatchObject): objects by their keys, arrays element by element. */
function contains(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object' || expected instanceof ArrayContaining) return matches(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => contains(actual[index], item));
  return Object.entries(expected).every(([key, value]) => contains((actual as Record<string, unknown>)[key], value));
}

interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeCloseTo(expected: number, digits?: number): void;
  toHaveLength(length: number): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toContain(item: unknown): void;
  toMatchObject(expected: unknown): void;
  toBeInstanceOf(type: new (...args: never[]) => unknown): void;
  toThrow(): void;
}

function matchers(actual: unknown, negate: boolean): Matchers {
  const check = (pass: boolean, message: string): void => { assert.ok(negate ? !pass : pass, `${negate ? 'not ' : ''}${message}`); };
  return {
    toBe: (expected) => check(Object.is(actual, expected), `expected ${String(actual)} to be ${String(expected)}`),
    toEqual(expected) {
      if (asymmetric(expected)) { check(matches(actual, expected), 'expected a match'); return; }
      if (negate) assert.notDeepEqual(actual, expected); else assert.deepEqual(actual, expected);
    },
    toStrictEqual(expected) { this.toEqual(expected); },
    toBeNull: () => check(actual === null, `expected ${String(actual)} to be null`),
    toBeUndefined: () => check(actual === undefined, 'expected undefined'),
    toBeDefined: () => check(actual !== undefined, 'expected a value'),
    toBeTruthy: () => check(Boolean(actual), 'expected truthy'),
    toBeFalsy: () => check(!actual, 'expected falsy'),
    toBeCloseTo: (expected, digits = 2) => check(Math.abs((actual as number) - expected) < 10 ** -digits / 2, `expected ${String(actual)} close to ${expected}`),
    toHaveLength: (length) => check((actual as { length: number }).length === length, `expected length ${length}, got ${(actual as { length: number }).length}`),
    toBeGreaterThan: (expected) => check((actual as number) > expected, `expected ${String(actual)} > ${expected}`),
    toBeGreaterThanOrEqual: (expected) => check((actual as number) >= expected, `expected ${String(actual)} >= ${expected}`),
    toBeLessThan: (expected) => check((actual as number) < expected, `expected ${String(actual)} < ${expected}`),
    toBeLessThanOrEqual: (expected) => check((actual as number) <= expected, `expected ${String(actual)} <= ${expected}`),
    toContain: (item) => check(Array.isArray(actual) ? actual.includes(item) : String(actual).includes(String(item)), `expected to contain ${String(item)}`),
    toMatchObject: (expected) => check(contains(actual, expected), `expected ${JSON.stringify(actual)} to match ${JSON.stringify(expected)}`),
    toBeInstanceOf: (type) => check(actual instanceof type, 'expected an instance'),
    toThrow: () => { let threw = false; try { (actual as () => void)(); } catch { threw = true; } check(threw, 'expected a throw'); },
  };
}

export function expect(actual: unknown): Matchers & { not: Matchers } {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}
expect.arrayContaining = (items: readonly unknown[]): unknown => new ArrayContaining(items);
