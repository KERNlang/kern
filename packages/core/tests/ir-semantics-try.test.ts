/**
 * Executable semantic contract for try / catch / finally (catch-all, canonical
 * errors — decision D2). Design pressure-tested by a 6-engine agon council
 * (winner codex): the sentinel-interception mitigation is sufficient, and the
 * Python `del e` / `__context__` traps are unobservable in the trace model.
 *
 * Bodies use the `__trace` / `throw` / `return` primitives for observability,
 * so the contract needs no emitter change and no trace hook — it is a pure
 * parity-proof. Positive fixtures run through the reference runner and the TS
 * emitter leg; Python parity is asserted in the Python ir-semantics leg suite.
 */

import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  runDifferential,
  type Verdict,
} from '../src/index.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import { _resetTryContractForTest, registerTryContract, tryContract } from '../src/ir/semantics/try.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetTryContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerTryContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetTryContractForTest();
  _resetPrimitivesForTest();
});

describe('try contract — positive fixtures', () => {
  it('exposes required fixture coverage', () => {
    expect(tryContract.fixtures.length).toBeGreaterThanOrEqual(6);
    expect(tryContract.fixtures.map((f) => f.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('is caught'),
        expect.stringContaining('skips the catch'),
        expect.stringContaining('finally runs after a normal body'),
        expect.stringContaining('propagates as the completion'),
        expect.stringContaining('runs catch then finally'),
        expect.stringContaining('propagates the return'),
      ]),
    );
  });

  it.each(
    tryContract.fixtures.map((f) => [f.description, f] as const),
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
    tryContract.fixtures.map((f) => [f.description, f] as const),
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

describe('try contract — preconditions reject malformed shapes', () => {
  const trc = (t: string): IRNode => ({ type: '__trace', props: { event: { op: 'stdout', text: t } } });
  const cat = (children: IRNode[], name = 'e'): IRNode => ({ type: 'catch', props: { name }, children });
  const fin = (children: IRNode[]): IRNode => ({ type: 'finally', children });

  function mustReject(ir: IRNode): void {
    expect(() => referenceRun(ir, makeEnv())).toThrow(ReferenceRunnerError);
  }

  it('rejects an orphan try (no catch and no finally)', () => {
    mustReject({ type: 'try', children: [trc('x')] });
  });

  it('rejects more than one catch', () => {
    mustReject({ type: 'try', children: [cat([trc('a')]), cat([trc('b')])] });
  });

  it('rejects more than one finally', () => {
    mustReject({ type: 'try', children: [fin([trc('a')]), fin([trc('b')])] });
  });

  it('rejects a catch without a binding name', () => {
    mustReject({ type: 'try', children: [{ type: 'catch', props: {}, children: [trc('x')] }] });
  });

  it('raises when finally completes abruptly (cleanup-only this slice)', () => {
    // finally that returns is out of domain — the reference raises (not a
    // {kind:throw} completion), surfacing as a leg-error in the differential.
    expect(() =>
      referenceRun({ type: 'try', children: [trc('x'), fin([{ type: 'return', props: { value: 1 } }])] }, makeEnv()),
    ).toThrow(/finally must complete normally/);
  });
});

describe('try contract — forbidden rewrites surface', () => {
  it('pins finally-ordering and error-canonicalization rewrites', () => {
    expect(tryContract.forbiddenRewrites.some((s) => s.includes('reorder or skip finally'))).toBe(true);
    expect(tryContract.forbiddenRewrites.some((s) => s.includes('run finally before catch'))).toBe(true);
    expect(tryContract.forbiddenRewrites.some((s) => s.includes('canonicalization'))).toBe(true);
    expect(tryContract.forbiddenRewrites.some((s) => s.includes('swallow errors'))).toBe(true);
  });
});
