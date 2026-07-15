/**
 * Executable semantic contract tests for single-expression `lambda`.
 *
 * The fixtures prove the reference semantics and the TS emitter leg. The
 * Python leg is covered from `packages/python/tests/ir-semantics-python-leg.test.ts`
 * to avoid a core -> python package cycle.
 */

import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  runDifferential,
  type Verdict,
} from '../src/index.js';
import { _resetLambdaContractForTest, lambdaContract, registerLambdaContract } from '../src/ir/semantics/lambda.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetLambdaContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerLambdaContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetLambdaContractForTest();
  _resetPrimitivesForTest();
});

describe('lambda contract — fixtures', () => {
  it('covers the required single-expression closure scenarios', () => {
    expect(lambdaContract.fixtures.length).toBeGreaterThanOrEqual(5);
    expect(lambdaContract.fixtures.map((f) => f.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('List.map transforms'),
        expect.stringContaining('List.filter keeps'),
        expect.stringContaining('current outer binding by reference'),
        expect.stringContaining('different outer bindings'),
        expect.stringContaining('fresh per-iteration bindings'),
      ]),
    );
  });

  it.each(
    lambdaContract.fixtures.map((f) => [f.description, f] as const),
  )('reference fixture: %s', async (_desc, fixture) => {
    const result = await runDifferential(fixture, { skipTs: true, skipPython: true });
    if (result.verdict !== 'pass') {
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

  it.each(
    lambdaContract.fixtures.map((f) => [f.description, f] as const),
  )('TS differential fixture: %s', async (_desc, fixture) => {
    const result = await runDifferential(fixture, { skipPython: true });
    if (result.verdict !== 'pass') {
      throw new Error(
        `verdict=${result.verdict}\n` +
          `fixture=${fixture.description}\n` +
          `reference=${JSON.stringify(result.reference, null, 2)}\n` +
          `ts=${JSON.stringify(result.ts, null, 2)}\n` +
          `legError=${JSON.stringify(result.legError, null, 2)}`,
      );
    }
    expect(result.verdict).toBe<Verdict>('pass');
  });
});

describe('lambda contract — malformed fixtures', () => {
  async function mustReject(ir: IRNode, label: string): Promise<void> {
    expect(() => referenceRun(ir, makeEnv())).toThrow(ReferenceRunnerError);
    const result = await runDifferential(
      { description: label, ir, expected: { events: [], completion: { kind: 'normal' } } },
      { skipTs: true, skipPython: true },
    );
    expect(result.verdict).toBe<Verdict>('leg-error');
  }

  it('rejects missing expression text', async () => {
    await mustReject({ type: 'lambda', props: {}, children: [] }, 'missing expr');
  });

  it('rejects unsupported setup children', async () => {
    await mustReject(
      { type: 'lambda', props: { expr: '[1]' }, children: [{ type: 'each', props: { name: 'x', in: 'xs' } }] },
      'unsupported child',
    );
  });

  it.each([
    [{ type: 'let', props: { name: '', value: '1' } }, 'empty setup let name'],
    [{ type: 'assign', props: { target: 'not.valid', value: '1' } }, 'invalid setup assign target'],
    [{ type: 'assign', props: { target: 'value' } }, 'missing setup assign value'],
  ] as const)('rejects malformed setup at runtime: %s', async (child, label) => {
    await mustReject({ type: 'lambda', props: { expr: '1' }, children: [child] }, label);
  });
});

describe('lambda contract — forbidden rewrites surface', () => {
  it('flags Python late-binding loop capture explicitly', () => {
    expect(lambdaContract.forbiddenRewrites.some((s) => s.includes('Python late-binding'))).toBe(true);
  });
});
