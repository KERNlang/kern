import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';

export { afterEach, beforeEach, describe, test };
export const afterAll = after;
export const beforeAll = before;
export const it = test;

const ARRAY_CONTAINING = Symbol('arrayContaining');
const OBJECT_CONTAINING = Symbol('objectContaining');

interface ArrayContaining {
  readonly kind: typeof ARRAY_CONTAINING;
  readonly items: unknown[];
}

interface ObjectContaining {
  readonly kind: typeof OBJECT_CONTAINING;
  readonly shape: Record<string, unknown>;
}

interface Matchers {
  readonly not: {
    toBe(expected: unknown): void;
    toBeNull(): void;
    toContain(expected: unknown): void;
    toMatch(expected: RegExp): void;
  };
  toBe(expected: unknown): void;
  toBeDefined(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeNull(): void;
  toContain(expected: unknown): void;
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toHaveProperty(path: string, expected?: unknown): void;
  toMatch(expected: RegExp): void;
  toThrow(expected?: RegExp | string): void;
}

type Expect = ((actual: unknown) => Matchers) & {
  arrayContaining(items: unknown[]): ArrayContaining;
  objectContaining(shape: Record<string, unknown>): ObjectContaining;
};

function isArrayContaining(expected: unknown): expected is ArrayContaining {
  return (
    typeof expected === 'object' &&
    expected !== null &&
    'kind' in expected &&
    (expected as { kind: unknown }).kind === ARRAY_CONTAINING
  );
}

function isObjectContaining(expected: unknown): expected is ObjectContaining {
  return (
    typeof expected === 'object' &&
    expected !== null &&
    'kind' in expected &&
    (expected as { kind: unknown }).kind === OBJECT_CONTAINING
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertMatches(actual: unknown, expected: unknown): void {
  if (isArrayContaining(expected)) {
    assert.ok(Array.isArray(actual), `Expected an array, received ${typeof actual}`);
    for (const item of expected.items) assertContains(actual, item);
    return;
  }

  if (isObjectContaining(expected)) {
    assert.ok(typeof actual === 'object' && actual !== null, `Expected an object, received ${typeof actual}`);
    for (const [key, value] of Object.entries(expected.shape)) {
      assertMatches((actual as Record<string, unknown>)[key], value);
    }
    return;
  }

  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `Expected an array, received ${typeof actual}`);
    assert.equal(actual.length, expected.length);
    expected.forEach((item, index) => assertMatches(actual[index], item));
    return;
  }

  if (isPlainObject(expected)) {
    assert.ok(typeof actual === 'object' && actual !== null, `Expected an object, received ${typeof actual}`);
    assert.ok(isPlainObject(actual), `Expected a plain object, received ${Object.prototype.toString.call(actual)}`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) {
      assertMatches(actual[key], value);
    }
    return;
  }

  assert.deepEqual(actual, expected);
}

function assertContains(actual: unknown, expected: unknown): void {
  if (typeof actual === 'string') {
    assert.equal(typeof expected, 'string');
    assert.ok(actual.includes(expected), `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
    return;
  }

  assert.ok(Array.isArray(actual), `Expected an array or string, received ${typeof actual}`);
  assert.ok(
    actual.some((item) => {
      try {
        assertMatches(item, expected);
        return true;
      } catch {
        return false;
      }
    }),
  );
}

function assertNotContains(actual: unknown, expected: unknown): void {
  if (typeof actual === 'string') {
    assert.equal(typeof expected, 'string');
    assert.ok(
      !actual.includes(expected),
      `Expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(expected)}`,
    );
    return;
  }

  assert.ok(Array.isArray(actual), `Expected an array or string, received ${typeof actual}`);
  assert.ok(
    !actual.some((item) => {
      try {
        assertMatches(item, expected);
        return true;
      } catch {
        return false;
      }
    }),
  );
}

function getProperty(actual: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => {
    assert.ok(value !== null && value !== undefined, `Missing property ${path}`);
    assert.ok(typeof value === 'object' || typeof value === 'function', `Missing property ${path}`);
    assert.ok(part in value, `Missing property ${path}`);
    return (value as Record<string, unknown>)[part];
  }, actual);
}

function assertThrows(actual: unknown, expected?: RegExp | string): void {
  assert.equal(typeof actual, 'function');
  const error = assert.throws(actual as () => unknown);
  if (expected instanceof RegExp) assert.match(String((error as Error).message ?? error), expected);
  else if (typeof expected === 'string') assert.ok(String((error as Error).message ?? error).includes(expected));
}

function createMatchers(actual: unknown): Matchers {
  return {
    not: {
      toBe(expected: unknown) {
        assert.notStrictEqual(actual, expected);
      },
      toBeNull() {
        assert.notStrictEqual(actual, null);
      },
      toContain(expected: unknown) {
        assertNotContains(actual, expected);
      },
      toMatch(expected: RegExp) {
        assert.equal(typeof actual, 'string');
        assert.ok(!expected.test(actual), `Expected ${JSON.stringify(actual)} not to match ${expected}`);
      },
    },
    toBe(expected: unknown) {
      assert.strictEqual(actual, expected);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined);
    },
    toBeGreaterThan(expected: number) {
      assert.equal(typeof actual, 'number');
      assert.ok(actual > expected, `Expected ${actual} to be greater than ${expected}`);
    },
    toBeGreaterThanOrEqual(expected: number) {
      assert.equal(typeof actual, 'number');
      assert.ok(actual >= expected, `Expected ${actual} to be greater than or equal to ${expected}`);
    },
    toBeLessThan(expected: number) {
      assert.equal(typeof actual, 'number');
      assert.ok(actual < expected, `Expected ${actual} to be less than ${expected}`);
    },
    toBeLessThanOrEqual(expected: number) {
      assert.equal(typeof actual, 'number');
      assert.ok(actual <= expected, `Expected ${actual} to be less than or equal to ${expected}`);
    },
    toBeNull() {
      assert.strictEqual(actual, null);
    },
    toContain(expected: unknown) {
      assertContains(actual, expected);
    },
    toEqual(expected: unknown) {
      assertMatches(actual, expected);
    },
    toHaveLength(expected: number) {
      assert.equal((actual as { length?: unknown }).length, expected);
    },
    toHaveProperty(path: string, expected?: unknown) {
      const value = getProperty(actual, path);
      if (arguments.length > 1) assertMatches(value, expected);
    },
    toMatch(expected: RegExp) {
      assert.equal(typeof actual, 'string');
      assert.match(actual, expected);
    },
    toThrow(expected?: RegExp | string) {
      assertThrows(actual, expected);
    },
  };
}

export const expect = ((actual: unknown) => createMatchers(actual)) as Expect;

expect.arrayContaining = (items: unknown[]): ArrayContaining => ({
  kind: ARRAY_CONTAINING,
  items,
});

expect.objectContaining = (shape: Record<string, unknown>): ObjectContaining => ({
  kind: OBJECT_CONTAINING,
  shape,
});
