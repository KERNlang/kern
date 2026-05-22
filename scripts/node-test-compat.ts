import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { after, afterEach, before, beforeEach, describe as nodeDescribe, test as nodeTest } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';

export { afterEach, beforeEach };
export const afterAll = after;
export const beforeAll = before;

const ARRAY_CONTAINING = Symbol('arrayContaining');
const OBJECT_CONTAINING = Symbol('objectContaining');
const STRING_CONTAINING = Symbol('stringContaining');

interface ArrayContaining {
  readonly kind: typeof ARRAY_CONTAINING;
  readonly items: unknown[];
}

interface ObjectContaining {
  readonly kind: typeof OBJECT_CONTAINING;
  readonly shape: Record<string, unknown>;
}

interface StringContaining {
  readonly kind: typeof STRING_CONTAINING;
  readonly text: string;
}

interface AsyncMatchers {
  toBe(expected: unknown): Promise<void>;
  toBeNull(): Promise<void>;
  toEqual(expected: unknown): Promise<void>;
  toThrow(expected?: RegExp | string): Promise<void>;
}

interface Matchers {
  readonly not: {
    toBe(expected: unknown): void;
    toBeNull(): void;
    toContain(expected: unknown): void;
    toEqual(expected: unknown): void;
    toHaveProperty(path: string): void;
    toMatch(expected: RegExp): void;
    toThrow(expected?: RegExp | string): void;
  };
  readonly rejects: AsyncMatchers;
  readonly resolves: AsyncMatchers;
  toBe(expected: unknown): void;
  toBeCloseTo(expected: number, precision?: number): void;
  toBeDefined(): void;
  toBeFalsy(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeInstanceOf(expected: new (...args: never[]) => unknown): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeUndefined(): void;
  toContain(expected: unknown): void;
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toHaveProperty(path: string, expected?: unknown): void;
  toMatch(expected: RegExp): void;
  toMatchInlineSnapshot(expected: string): void;
  toMatchObject(expected: unknown): void;
  toMatchSnapshot(hint?: string): void;
  toThrow(expected?: RegExp | string): void;
}

type Expect = ((actual: unknown) => Matchers) & {
  arrayContaining(items: unknown[]): ArrayContaining;
  assertions(count: number): void;
  hasAssertions(): void;
  objectContaining(shape: Record<string, unknown>): ObjectContaining;
  stringContaining(text: string): StringContaining;
};

type TestCallback = Parameters<typeof nodeTest>[1];
type TestLike = typeof nodeTest & {
  each(cases: readonly unknown[]): (name: string, callback: (...args: never[]) => unknown) => unknown;
  only: typeof nodeTest.only;
  skip: typeof nodeTest.skip;
  todo: typeof nodeTest.todo;
};
type DescribeLike = typeof nodeDescribe & {
  each(cases: readonly unknown[]): (name: string, callback: (...args: never[]) => unknown) => unknown;
  only: typeof nodeDescribe.only;
  skip: typeof nodeDescribe.skip;
  todo: typeof nodeDescribe.todo;
};

interface TestState {
  assertionCount: number;
  expectedAssertions?: number;
  fullName: string;
  requireAssertions: boolean;
  snapshots: Map<string, number>;
}

const testState = new AsyncLocalStorage<TestState>();
const describeStack: string[] = [];

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

function isStringContaining(expected: unknown): expected is StringContaining {
  return (
    typeof expected === 'object' &&
    expected !== null &&
    'kind' in expected &&
    (expected as { kind: unknown }).kind === STRING_CONTAINING
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null || Object.prototype.toString.call(value) === '[object Object]';
}

function assertMatches(actual: unknown, expected: unknown): void {
  if (isStringContaining(expected)) {
    assert.equal(typeof actual, 'string');
    assert.ok(actual.includes(expected.text), `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected.text)}`);
    return;
  }

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
    const actualEntries = Object.entries(actual).filter(([, value]) => value !== undefined);
    const expectedEntries = Object.entries(expected).filter(([, value]) => value !== undefined);
    assert.deepEqual(
      actualEntries.map(([key]) => key).sort(),
      expectedEntries.map(([key]) => key).sort(),
    );
    for (const [key, value] of expectedEntries) {
      assertMatches(actual[key], value);
    }
    return;
  }

  assert.deepEqual(actual, expected);
}

function assertMatchesSubset(actual: unknown, expected: unknown): void {
  if (isArrayContaining(expected) || isObjectContaining(expected) || isStringContaining(expected)) {
    assertMatches(actual, expected);
    return;
  }

  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `Expected an array, received ${typeof actual}`);
    assert.equal(actual.length, expected.length);
    expected.forEach((item, index) => assertMatchesSubset(actual[index], item));
    return;
  }

  if (isPlainObject(expected)) {
    assert.ok(typeof actual === 'object' && actual !== null, `Expected an object, received ${typeof actual}`);
    assert.ok(isPlainObject(actual), `Expected a plain object, received ${Object.prototype.toString.call(actual)}`);
    for (const [key, value] of Object.entries(expected)) {
      assert.ok(key in actual, `Missing property ${key}`);
      assertMatchesSubset(actual[key], value);
    }
    return;
  }

  assertMatches(actual, expected);
}

function assertContains(actual: unknown, expected: unknown): void {
  if (typeof actual === 'string') {
    assert.equal(typeof expected, 'string');
    assert.ok(actual.includes(expected), `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
    return;
  }

  const items = Array.isArray(actual)
    ? actual
    : actual instanceof Set
      ? [...actual]
      : undefined;
  assert.ok(items, `Expected an array, Set, or string, received ${typeof actual}`);
  assert.ok(
    items.some((item) => {
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

  const items = Array.isArray(actual)
    ? actual
    : actual instanceof Set
      ? [...actual]
      : undefined;
  assert.ok(items, `Expected an array, Set, or string, received ${typeof actual}`);
  assert.ok(
    !items.some((item) => {
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
  let thrown: unknown;
  try {
    (actual as () => unknown)();
  } catch (error) {
    thrown = error;
  }
  assert.notStrictEqual(thrown, undefined, 'Expected function to throw');
  if (expected instanceof RegExp) assert.match(String((thrown as Error).message ?? thrown), expected);
  else if (typeof expected === 'string') assert.ok(String((thrown as Error).message ?? thrown).includes(expected));
}

function assertDoesNotThrow(actual: unknown, expected?: RegExp | string): void {
  assert.equal(typeof actual, 'function');
  try {
    (actual as () => unknown)();
  } catch (error) {
    const message = String((error as Error).message ?? error);
    if (expected instanceof RegExp && !expected.test(message)) return;
    if (typeof expected === 'string' && !message.includes(expected)) return;
    throw error;
  }
}

async function assertRejects(actual: unknown, expected?: RegExp | string): Promise<void> {
  let rejected: unknown;
  try {
    const promise = typeof actual === 'function' ? (actual as () => unknown)() : actual;
    await Promise.resolve(promise);
  } catch (error) {
    rejected = error;
  }
  assert.notStrictEqual(rejected, undefined, 'Expected promise to reject');
  if (expected instanceof RegExp) assert.match(String((rejected as Error).message ?? rejected), expected);
  else if (typeof expected === 'string') assert.ok(String((rejected as Error).message ?? rejected).includes(expected));
}

function createAsyncMatchers(actual: unknown, mode: 'rejects' | 'resolves'): AsyncMatchers {
  async function value(): Promise<unknown> {
    const promise = typeof actual === 'function' ? (actual as () => unknown)() : actual;
    if (mode === 'resolves') return await Promise.resolve(promise);
    let rejected = false;
    try {
      await Promise.resolve(promise);
    } catch (error) {
      rejected = true;
      return error;
    }
    assert.ok(rejected, 'Expected promise to reject');
  }

  return {
    async toBe(expected: unknown) {
      createMatchers(await value()).toBe(expected);
    },
    async toBeNull() {
      createMatchers(await value()).toBeNull();
    },
    async toEqual(expected: unknown) {
      createMatchers(await value()).toEqual(expected);
    },
    async toThrow(expected?: RegExp | string) {
      if (mode === 'rejects') {
        await assertRejects(actual, expected);
        return;
      }
      createMatchers(await value()).toThrow(expected);
    },
  };
}

function serializeSnapshot(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  return JSON.stringify(value, null, 2) ?? String(value);
}

function callerFile(): string {
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n')) {
    const match = line.match(/\((file:\/\/[^)]+):\d+:\d+\)|at (file:\/\/[^ ]+):\d+:\d+/);
    const url = match?.[1] ?? match?.[2];
    if (!url) continue;
    const file = fileURLToPath(url);
    if (!file.endsWith('scripts/node-test-compat.ts')) return file;
  }
  throw new Error('Could not determine snapshot caller file');
}

function loadSnapshots(testFile: string): Record<string, string> {
  const snapshotPath = resolve(dirname(testFile), '__snapshots__', `${testFile.split('/').pop()}.snap`);
  assert.ok(existsSync(snapshotPath), `Missing snapshot file: ${snapshotPath}`);
  const source = readFileSync(snapshotPath, 'utf-8');
  const snapshots: Record<string, string> = {};
  new Function('exports', source)(snapshots);
  return snapshots;
}

function assertSnapshot(actual: unknown, hint?: string): void {
  const state = testState.getStore();
  assert.ok(state, 'toMatchSnapshot() must run inside a test() or it() callback');
  const label = hint ? `${state.fullName}: ${hint}` : state.fullName;
  const nextIndex = (state.snapshots.get(label) ?? 0) + 1;
  state.snapshots.set(label, nextIndex);
  const key = `${label} ${nextIndex}`;
  const snapshots = loadSnapshots(callerFile());
  assert.ok(
    Object.hasOwn(snapshots, key),
    `Missing snapshot entry: ${key}. This node-test snapshot helper verifies checked-in snapshots and does not write new ones.`,
  );
  const expected = snapshots[key];
  const serialized = serializeSnapshot(actual);
  const actualSnapshot = expected.startsWith('\n') && expected.endsWith('\n') ? `\n${serialized}\n` : serialized;
  assert.strictEqual(actualSnapshot, expected);
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
      toEqual(expected: unknown) {
        assert.throws(() => assertMatches(actual, expected));
      },
      toHaveProperty(path: string) {
        assert.throws(() => getProperty(actual, path));
      },
      toMatch(expected: RegExp) {
        assert.equal(typeof actual, 'string');
        assert.ok(!expected.test(actual), `Expected ${JSON.stringify(actual)} not to match ${expected}`);
      },
      toThrow(expected?: RegExp | string) {
        assertDoesNotThrow(actual, expected);
      },
    },
    rejects: createAsyncMatchers(actual, 'rejects'),
    resolves: createAsyncMatchers(actual, 'resolves'),
    toBe(expected: unknown) {
      assert.strictEqual(actual, expected);
    },
    toBeCloseTo(expected: number, precision = 2) {
      assert.equal(typeof actual, 'number');
      const tolerance = 10 ** -precision / 2;
      assert.ok(Math.abs(actual - expected) < tolerance, `Expected ${actual} to be close to ${expected}`);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined);
    },
    toBeFalsy() {
      assert.ok(!actual);
    },
    toBeGreaterThan(expected: number) {
      assert.equal(typeof actual, 'number');
      assert.ok(actual > expected, `Expected ${actual} to be greater than ${expected}`);
    },
    toBeGreaterThanOrEqual(expected: number) {
      assert.equal(typeof actual, 'number');
      assert.ok(actual >= expected, `Expected ${actual} to be greater than or equal to ${expected}`);
    },
    toBeInstanceOf(expected: new (...args: never[]) => unknown) {
      assert.ok(actual instanceof expected, `Expected value to be instance of ${expected.name}`);
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
    toBeTruthy() {
      assert.ok(actual);
    },
    toBeUndefined() {
      assert.strictEqual(actual, undefined);
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
    toMatchInlineSnapshot(expected: string) {
      assert.strictEqual(serializeSnapshot(actual), expected.trim());
    },
    toMatchObject(expected: unknown) {
      assertMatchesSubset(actual, expected);
    },
    toMatchSnapshot(hint?: string) {
      assertSnapshot(actual, hint);
    },
    toThrow(expected?: RegExp | string) {
      assertThrows(actual, expected);
    },
  };
}

export const expect = ((actual: unknown) => {
  const state = testState.getStore();
  if (state) state.assertionCount += 1;
  return createMatchers(actual);
}) as Expect;

expect.arrayContaining = (items: unknown[]): ArrayContaining => ({
  kind: ARRAY_CONTAINING,
  items,
});

expect.objectContaining = (shape: Record<string, unknown>): ObjectContaining => ({
  kind: OBJECT_CONTAINING,
  shape,
});

expect.stringContaining = (text: string): StringContaining => ({
  kind: STRING_CONTAINING,
  text,
});

expect.assertions = (count: number): void => {
  const state = testState.getStore();
  assert.ok(state, 'expect.assertions() must run inside a test() or it() callback');
  state.expectedAssertions = count;
};
expect.hasAssertions = (): void => {
  const state = testState.getStore();
  assert.ok(state, 'expect.hasAssertions() must run inside a test() or it() callback');
  state.requireAssertions = true;
};

function wrapCallback(fullName: string, callback: TestCallback): TestCallback {
  if (typeof callback !== 'function') return callback;
  return (async (...args: unknown[]) => {
    const state: TestState = { assertionCount: 0, fullName, requireAssertions: false, snapshots: new Map() };
    await testState.run(state, async () => {
      await (callback as (...callbackArgs: unknown[]) => unknown)(...args);
    });
    if (state.expectedAssertions !== undefined) {
      assert.equal(state.assertionCount, state.expectedAssertions);
    }
    if (state.requireAssertions) assert.ok(state.assertionCount > 0, 'Expected at least one assertion');
  }) as TestCallback;
}

function caseArgs(row: unknown): unknown[] {
  return Array.isArray(row) ? row : [row];
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

function formatEachName(template: string, row: unknown, index: number): string {
  const values = caseArgs(row);
  let valueIndex = 0;
  let formatted = template.replace(/%[sip]/g, () => formatValue(values[valueIndex++]));
  formatted = formatted.replace(/%#/g, String(index));
  if (isPlainObject(row)) {
    formatted = formatted.replace(/\$([A-Za-z0-9_]+)/g, (_match, key: string) => formatValue(row[key]));
  }
  return formatted;
}

function wrapTest(base: typeof nodeTest): TestLike {
  const wrapped = ((name: string, optionsOrFn?: unknown, maybeFn?: unknown) => {
    const fullName = [...describeStack, name].join(' ');
    if (typeof optionsOrFn === 'function' || optionsOrFn === undefined) {
      return base(name, wrapCallback(fullName, optionsOrFn as TestCallback));
    }
    return base(name, optionsOrFn as never, wrapCallback(fullName, maybeFn as TestCallback));
  }) as TestLike;
  wrapped.each = (cases: readonly unknown[]) => (name: string, callback: (...args: never[]) => unknown) => {
    cases.forEach((row, index) => {
      wrapped(formatEachName(name, row, index), (...args: unknown[]) => callback(...(caseArgs(row) as never[]), ...(args as never[])));
    });
  };
  wrapped.only = (base.only ? wrapTest(base.only) : wrapped) as typeof nodeTest.only;
  wrapped.skip = (base.skip ? wrapTest(base.skip) : wrapped) as typeof nodeTest.skip;
  wrapped.todo = (base.todo ? base.todo.bind(base) : wrapped) as typeof nodeTest.todo;
  return wrapped;
}

function wrapDescribe(base: typeof nodeDescribe): DescribeLike {
  const wrapped = ((name: string, optionsOrFn?: unknown, maybeFn?: unknown) => {
    const callback = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
    const wrappedCallback =
      typeof callback === 'function'
        ? (...args: unknown[]) => {
            describeStack.push(name);
            try {
              return callback(...args);
            } finally {
              describeStack.pop();
            }
          }
        : callback;
    if (typeof optionsOrFn === 'function' || optionsOrFn === undefined) return base(name, wrappedCallback as never);
    return base(name, optionsOrFn as never, wrappedCallback as never);
  }) as DescribeLike;
  wrapped.each = (cases: readonly unknown[]) => (name: string, callback: (...args: never[]) => unknown) => {
    cases.forEach((row, index) => {
      wrapped(formatEachName(name, row, index), (...args: unknown[]) => callback(...(caseArgs(row) as never[]), ...(args as never[])));
    });
  };
  wrapped.only = (base.only ? wrapDescribe(base.only) : wrapped) as typeof nodeDescribe.only;
  wrapped.skip = (base.skip ? wrapDescribe(base.skip) : wrapped) as typeof nodeDescribe.skip;
  wrapped.todo = (base.todo ? base.todo.bind(base) : wrapped) as typeof nodeDescribe.todo;
  return wrapped;
}

export const test = wrapTest(nodeTest);
export const it = test;
export const describe = wrapDescribe(nodeDescribe);
