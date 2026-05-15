/**
 * PR-1 smoke test for the IR-semantics skeleton.
 *
 * Verifies the contract registry, reference-runner dispatcher, and 3-way
 * harness compile and behave correctly with zero contracts registered.
 * PR-2 lands the first real contract (`each`); this test stays as the
 * permanent baseline that the skeleton remains wired even after contracts
 * land.
 */

import {
  CONTRACT_REGISTRY,
  deepEqual,
  emptyTrace,
  makeEnv,
  type NodeContract,
  type NodeFixture,
  ReferenceRunnerError,
  referenceRun,
  registerContract,
  runAllContracts,
  runDifferential,
  tracesEqual,
} from '../src/index.js';
import type { IRNode } from '../src/types.js';

afterEach(() => {
  CONTRACT_REGISTRY.clear();
});

describe('IR semantics skeleton (PR-1)', () => {
  it('makeEnv returns deterministic defaults', () => {
    const env = makeEnv();
    expect(env.seed).toBe(0);
    expect(env.now).toBe(0);
    expect(env.bindings.size).toBe(0);
  });

  it('tracesEqual treats two empty traces as equal', () => {
    expect(tracesEqual(emptyTrace(), emptyTrace())).toBe(true);
  });

  it('tracesEqual rejects mismatched completion kinds', () => {
    const a = emptyTrace();
    const b = { ...emptyTrace(), completion: { kind: 'throw' as const } };
    expect(tracesEqual(a, b)).toBe(false);
  });

  it('referenceRun throws on unregistered node type', () => {
    const node: IRNode = { type: 'each', props: {} };
    expect(() => referenceRun(node, makeEnv())).toThrow(ReferenceRunnerError);
  });

  it('registerContract is idempotent — second register throws', () => {
    const contract: NodeContract = {
      nodeType: 'noop',
      preconditions: () => true,
      effects: () => emptyTrace(),
      completion: () => ({ kind: 'normal' }),
      forbiddenRewrites: [],
      fixtures: [],
    };
    registerContract(contract);
    expect(() => registerContract(contract)).toThrow(/already registered/);
  });

  it('runDifferential passes when reference matches expected and emitter legs are skipped', async () => {
    const noopContract: NodeContract = {
      nodeType: 'noop',
      preconditions: () => true,
      effects: () => emptyTrace(),
      completion: () => ({ kind: 'normal' }),
      forbiddenRewrites: [],
      fixtures: [],
    };
    registerContract(noopContract);

    const fixture: NodeFixture = {
      description: 'baseline noop',
      ir: { type: 'noop', props: {} },
      expected: emptyTrace(),
    };
    const result = await runDifferential(fixture, { skipTs: true, skipPython: true });
    expect(result.verdict).toBe('pass');
  });

  it('runDifferential surfaces reference-mismatch when expected diverges', async () => {
    const noopContract: NodeContract = {
      nodeType: 'noop',
      preconditions: () => true,
      effects: () => emptyTrace(),
      completion: () => ({ kind: 'normal' }),
      forbiddenRewrites: [],
      fixtures: [],
    };
    registerContract(noopContract);

    const fixture: NodeFixture = {
      description: 'expected stdout but reference is silent',
      ir: { type: 'noop', props: {} },
      expected: {
        events: [{ op: 'stdout', text: 'hello' }],
        completion: { kind: 'normal' },
      },
    };
    const result = await runDifferential(fixture, { skipTs: true, skipPython: true });
    expect(result.verdict).toBe('reference-mismatch');
  });

  it('makeEnv clones overrides.bindings (no shared reference)', () => {
    const original = new Map<string, unknown>([['x', 1]]);
    const env = makeEnv({ bindings: original });
    env.bindings.set('y', 2);
    expect(original.has('y')).toBe(false);
  });

  it('runAllContracts returns empty list when registry is empty', async () => {
    expect(await runAllContracts({ skipTs: true, skipPython: true })).toEqual([]);
  });

  it('runDifferential exercises the TS leg with skipPython:true', async () => {
    const noopContract: NodeContract = {
      nodeType: 'noop',
      preconditions: () => true,
      effects: () => emptyTrace(),
      completion: () => ({ kind: 'normal' }),
      forbiddenRewrites: [],
      fixtures: [],
    };
    registerContract(noopContract);

    const fixture: NodeFixture = {
      description: 'ts leg not wired',
      ir: { type: 'noop', props: {} },
      expected: emptyTrace(),
    };
    const result = await runDifferential(fixture, { skipPython: true });
    // PR-3a wired the TS leg. With only the noop contract registered, the
    // TS leg has nothing to emit — handler wrapper with no `each` body, so
    // emitNativeKernBodyTS returns an empty body. Result is a normal trace
    // matching reference → `pass`.
    expect(result.verdict).toBe('pass');
  });
});

describe('deepEqual (structural comparison for trace payloads)', () => {
  it('treats NaN as equal to NaN (Object.is semantics)', () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
  });

  it('distinguishes +0 from -0', () => {
    expect(deepEqual(0, -0)).toBe(false);
  });

  it('treats undefined and null as different', () => {
    expect(deepEqual(undefined, null)).toBe(false);
  });

  it('preserves undefined fields (unlike JSON.stringify)', () => {
    expect(deepEqual({ a: undefined }, {})).toBe(false);
  });

  it('compares RegExp by source + flags', () => {
    expect(deepEqual(/foo/g, /foo/g)).toBe(true);
    expect(deepEqual(/foo/g, /foo/i)).toBe(false);
    expect(deepEqual(/foo/, /bar/)).toBe(false);
  });

  it('compares Maps structurally', () => {
    const a = new Map([['x', 1]]);
    const b = new Map([['x', 1]]);
    expect(deepEqual(a, b)).toBe(true);
  });

  it('rejects Maps with different sizes', () => {
    const a = new Map([['x', 1]]);
    const b = new Map([
      ['x', 1],
      ['y', 2],
    ]);
    expect(deepEqual(a, b)).toBe(false);
  });

  it('compares Sets structurally', () => {
    expect(deepEqual(new Set([1, 2]), new Set([1, 2]))).toBe(true);
    expect(deepEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false);
  });

  it('compares nested arrays + objects', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
  });

  it('throws on circular references when comparing distinct cyclic structures', () => {
    const a: Record<string, unknown> = { tag: 'a' };
    const b: Record<string, unknown> = { tag: 'a' };
    a.self = a;
    b.self = b;
    expect(() => deepEqual(a, b)).toThrow(/circular/);
  });

  it('short-circuits to equal when same reference is passed twice', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(deepEqual(a, a)).toBe(true);
  });

  it('handles BigInt without throwing (vs JSON.stringify)', () => {
    expect(deepEqual(1n, 1n)).toBe(true);
    expect(deepEqual(1n, 2n)).toBe(false);
  });
});
