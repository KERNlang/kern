/**
 * Counted `for` executable semantics.
 *
 * These fixtures pin Python `range(from, to, step)` parity for the reference
 * runner and the TS emitter leg. The Python package runs the same fixtures
 * through the Python emitter leg for the full three-way gate.
 */

import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  runDifferential,
  type Verdict,
} from '../src/index.js';
import { _resetForContractForTest, forContract, registerForContract } from '../src/ir/semantics/for.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetForContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerForContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetForContractForTest();
  _resetPrimitivesForTest();
});

describe('for contract — positive fixtures (differential reference + TS)', () => {
  it('exposes fixtures for Python range parity hazards', () => {
    expect(forContract.fixtures.length).toBeGreaterThanOrEqual(8);
    expect(forContract.fixtures.some((f) => f.description.includes('reverse range'))).toBe(true);
    expect(forContract.fixtures.some((f) => f.description.includes('evaluated once'))).toBe(true);
    expect(forContract.fixtures.some((f) => f.description.includes('break at i == 1'))).toBe(true);
  });

  it.each(forContract.fixtures.map((f) => [f.description, f] as const))('fixture: %s', async (_desc, fixture) => {
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

describe('for contract — preconditions and errors', () => {
  it('rejects malformed loop names', () => {
    const ir: IRNode = { type: 'for', props: { name: 'bad-name', from: '0', to: '1' }, children: [] };
    expect(() => referenceRun(ir, makeEnv())).toThrow(ReferenceRunnerError);
  });

  it('throws for zero step like Python range', () => {
    const ir: IRNode = { type: 'for', props: { name: 'i', from: '0', to: '1', step: '0' }, children: [] };
    expect(() => referenceRun(ir, makeEnv())).toThrow(/step must not be zero/);
  });
});

describe('for contract — forbidden rewrites surface', () => {
  it('flags evaluated-once bounds explicitly', () => {
    expect(forContract.forbiddenRewrites.some((s) => s.includes('re-evaluate'))).toBe(true);
  });
});
