/**
 * PR-2 contract tests for `each` runtime semantics.
 *
 * Two layers:
 *   1. Positive fixtures — every fixture in `eachContract.fixtures` runs
 *      through the differential harness with TS/Python legs skipped
 *      (those land in PR-3). Verdict must be `pass`.
 *   2. Negative cases — direct calls to `referenceRun` asserting that
 *      malformed `each` IR fails preconditions and surfaces as `leg-error`.
 */

import { CONTRACT_REGISTRY, makeEnv, referenceRun, runDifferential, type Verdict } from '../src/index.js';
import {
  _resetEachContractForTest,
  detectEachShape,
  eachContract,
  registerEachContract,
} from '../src/ir/semantics/each.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import { ReferenceRunnerError } from '../src/ir/semantics/reference-runner.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetEachContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerEachContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetEachContractForTest();
  _resetPrimitivesForTest();
});

describe('each contract — positive fixtures (differential reference-only)', () => {
  it('exposes a non-empty fixture set covering every iteration shape', () => {
    expect(eachContract.fixtures.length).toBeGreaterThanOrEqual(15);
    const shapesSeen = new Set<string>();
    for (const f of eachContract.fixtures) {
      const props = (f.ir.props ?? {}) as Record<string, unknown>;
      const shape = detectEachShape(props);
      if (shape) shapesSeen.add(shape);
    }
    expect(shapesSeen).toEqual(
      new Set(['array', 'array-indexed', 'pair-sync', 'pair-async', 'entry-key', 'entry-value']),
    );
  });

  it.each(eachContract.fixtures.map((f) => [f.description, f] as const))('fixture: %s', (_desc, fixture) => {
    const result = runDifferential(fixture, { skipTs: true, skipPython: true });
    if (result.verdict !== 'pass') {
      // Surface useful debugging info on failure.
      throw new Error(
        `verdict=${result.verdict}\nfixture=${fixture.description}\nexpected=${JSON.stringify(
          fixture.expected,
          null,
          2,
        )}\nreference=${JSON.stringify(result.reference, null, 2)}`,
      );
    }
    expect(result.verdict).toBe<Verdict>('pass');
  });
});

describe('each contract — shape detection', () => {
  it('returns null when no shape-defining prop is set', () => {
    expect(detectEachShape({ in: 'xs' })).toBeNull();
  });

  it('returns null when array mode mixes with pair mode', () => {
    expect(detectEachShape({ name: 'x', pairKey: 'k', pairValue: 'v', in: 'xs' })).toBeNull();
  });

  it('returns null when entry mode lacks entries=true', () => {
    expect(detectEachShape({ entryKey: 'k', in: 'o' })).toBeNull();
  });

  it('returns null when index= combines with await=true', () => {
    expect(detectEachShape({ name: 'x', index: 'i', await: true, in: 'xs' })).toBeNull();
  });

  it('returns array-indexed for name + index', () => {
    expect(detectEachShape({ name: 'x', index: 'i', in: 'xs' })).toBe('array-indexed');
  });

  it('returns pair-async for pairKey + pairValue + await=true', () => {
    expect(detectEachShape({ pairKey: 'k', pairValue: 'v', await: true, in: 'm' })).toBe('pair-async');
  });
});

describe('each contract — preconditions reject malformed IR', () => {
  function mustReject(ir: IRNode, label: string): void {
    expect(() => referenceRun(ir, makeEnv())).toThrow(ReferenceRunnerError);
    // Also reject via the harness path with leg-error.
    const result = runDifferential(
      { description: label, ir, expected: { events: [], completion: { kind: 'normal' } } },
      { skipTs: true, skipPython: true },
    );
    expect(result.verdict).toBe<Verdict>('leg-error');
  }

  it('rejects `each` with no iteration shape', () => {
    mustReject({ type: 'each', props: { in: 'xs' }, children: [{ type: 'break' }] }, 'no shape');
  });

  it('rejects `each` with no `in=` binding', () => {
    mustReject({ type: 'each', props: { name: 'x' }, children: [{ type: 'break' }] }, 'no in');
  });

  it('rejects `each` with empty body', () => {
    mustReject({ type: 'each', props: { name: 'x', in: 'xs' }, children: [] }, 'empty body');
  });

  it('rejects `each` mixing array mode and pair mode', () => {
    mustReject(
      {
        type: 'each',
        props: { name: 'x', pairKey: 'k', pairValue: 'v', in: 'xs' },
        children: [{ type: 'break' }],
      },
      'mixed shape',
    );
  });

  it('rejects `each` with index= and await=true', () => {
    mustReject(
      {
        type: 'each',
        props: { name: 'x', index: 'i', await: true, in: 'xs' },
        children: [{ type: 'break' }],
      },
      'index + await',
    );
  });
});

describe('each contract — runtime errors at effects time', () => {
  it('throws when `in=` binding is missing from env', () => {
    const ir: IRNode = {
      type: 'each',
      props: { name: 'x', in: 'missing' },
      children: [{ type: 'break' }],
    };
    expect(() => referenceRun(ir, makeEnv())).toThrow(/binding "missing" not found/);
  });

  it('throws when pair-mode collection is neither Map nor array of pairs', () => {
    const env = makeEnv({ bindings: new Map([['m', { a: 1 }]] as [string, unknown][]) });
    const ir: IRNode = {
      type: 'each',
      props: { pairKey: 'k', pairValue: 'v', in: 'm' },
      children: [{ type: 'break' }],
    };
    expect(() => referenceRun(ir, env)).toThrow(/pair-mode/);
  });
});

describe('each contract — forbidden rewrites surface', () => {
  it('lists at least 4 forbidden rewrites for human review', () => {
    expect(eachContract.forbiddenRewrites.length).toBeGreaterThanOrEqual(4);
  });

  it('flags the Python late-binding closure bug explicitly', () => {
    expect(eachContract.forbiddenRewrites.some((s) => s.includes('Python late-binding'))).toBe(true);
  });
});
