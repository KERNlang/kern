/**
 * Executable semantic contract for body-statement `while` (boolean loop).
 *
 * Positive fixtures run through the reference runner and the production TS
 * emitter leg; Python parity is asserted in the Python package's ir-semantics
 * leg suite. Every fixture is a block that declares a `let kind=let` counter
 * and advances it with `assign += 1`, so the let + assign contracts are
 * registered alongside while (and the primitives for break/continue/return/
 * throw/__trace/__breakIfEqual the bodies use).
 */

import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  runDifferential,
  type Verdict,
} from '../src/index.js';
import { _resetAssignContractForTest, registerAssignContract } from '../src/ir/semantics/assign.js';
import { _resetLetContractForTest, registerLetContract } from '../src/ir/semantics/let.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import { _resetWhileContractForTest, registerWhileContract, whileContract } from '../src/ir/semantics/while.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetWhileContractForTest();
  _resetLetContractForTest();
  _resetAssignContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerLetContract();
  registerAssignContract();
  registerWhileContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetWhileContractForTest();
  _resetLetContractForTest();
  _resetAssignContractForTest();
  _resetPrimitivesForTest();
});

describe('while contract — positive fixtures', () => {
  it('exposes required fixture coverage', () => {
    expect(whileContract.fixtures.length).toBeGreaterThanOrEqual(6);
    expect(whileContract.fixtures.map((f) => f.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('counts up'),
        expect.stringContaining('zero times'),
        expect.stringContaining('break is consumed'),
        expect.stringContaining('continue'),
        expect.stringContaining('return propagates'),
        expect.stringContaining('throw propagates'),
      ]),
    );
  });

  it.each(
    whileContract.fixtures.map((f) => [f.description, f] as const),
  )('reference fixture: %s', async (_desc, fixture) => {
    const result = await runDifferential(fixture, { skipTs: true, skipPython: true });
    if (result.verdict !== 'pass') {
      throw new Error(
        `verdict=${result.verdict}\nfixture=${fixture.description}\nreference=${JSON.stringify(
          result.reference,
          null,
          2,
        )}`,
      );
    }
    expect(result.verdict).toBe<Verdict>('pass');
  });

  it.each(
    whileContract.fixtures.map((f) => [f.description, f] as const),
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

describe('while contract — preconditions reject non-strict-boolean conditions', () => {
  function mustReject(ir: IRNode, label: string, bindings: Map<string, unknown> = new Map()): void {
    expect(() => referenceRun(ir, makeEnv({ bindings }))).toThrow(ReferenceRunnerError);
    expect(label.length).toBeGreaterThan(0);
  }

  const body: IRNode[] = [{ type: '__trace', props: { event: { op: 'stdout', text: 'x' } } }];

  it('rejects a numeric (truthy) condition — while is strict-boolean, not if-style truthy', () => {
    mustReject({ type: 'while', props: { cond: 'n' }, children: body }, 'numeric', new Map([['n', 3]]));
  });

  it('rejects a string condition', () => {
    mustReject({ type: 'while', props: { cond: 's' }, children: body }, 'string', new Map([['s', 'x']]));
  });

  it('rejects a non-portable condition', () => {
    mustReject({ type: 'while', props: { cond: 'o' }, children: body }, 'object', new Map([['o', {}]]));
  });

  it('rejects a missing condition', () => {
    mustReject({ type: 'while', children: body }, 'missing cond');
  });
});

describe('while contract — forbidden rewrites surface', () => {
  it('pins loop-shape and condition-hoisting rewrites', () => {
    expect(whileContract.forbiddenRewrites.some((s) => s.includes('for / recursion'))).toBe(true);
    expect(whileContract.forbiddenRewrites.some((s) => s.includes('hoist or cache the condition'))).toBe(true);
    expect(whileContract.forbiddenRewrites.some((s) => s.includes('while...else'))).toBe(true);
    expect(whileContract.forbiddenRewrites.some((s) => s.includes('break/continue escape'))).toBe(true);
  });
});
