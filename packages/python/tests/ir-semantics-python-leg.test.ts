/**
 * PR-3b — Python emitter leg integration tests.
 *
 * Runs every `each` fixture through the full Python leg: fixture-IR lowering →
 * production `emitNativeKernBodyPython` codegen with `traceHooks.eachIterNext` →
 * `python3 -u` subprocess with FD3 trace channel → observed Trace.
 *
 * Verdict `pass` means reference == Python-leg.
 *
 * Skip-marker: if `python3` is not on PATH, the entire suite is skipped
 * with a clear message — local dev environments without Python should not
 * fail CI for missing tooling.
 */

import { spawnSync } from 'node:child_process';
import { CONTRACT_REGISTRY, makeEnv, runDifferential, type Verdict } from '../../core/src/index.js';
import {
  _resetBranchContractForTest,
  branchContract,
  registerBranchContract,
} from '../../core/src/ir/semantics/branch.js';
import { _resetEachContractForTest, eachContract, registerEachContract } from '../../core/src/ir/semantics/each.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../../core/src/ir/semantics/primitives.js';
import { runPythonEmitterLeg } from '../src/ir-semantics/python-leg.js';

const pythonAvailable = (() => {
  try {
    const r = spawnSync('python3', ['--version'], { encoding: 'utf-8' });
    return r.status === 0;
  } catch {
    return false;
  }
})();

const describeIfPython = pythonAvailable ? describe : describe.skip;

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetBranchContractForTest();
  _resetEachContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerEachContract();
  registerBranchContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetBranchContractForTest();
  _resetEachContractForTest();
  _resetPrimitivesForTest();
});

/**
 * PR-4 — Python emitter normalises pair-mode iteration via runtime helpers
 * `_kern_pairs` (sync) and `_kern_async_pairs` (async). This closes the
 * three divergences PR-3b documented:
 *
 *   1. `pair-sync: array of [k, v] tuples` — `_kern_pairs` falls back to
 *      `iter(v)` when `v` lacks `.items()`, so array-of-pairs destructures
 *      cleanly. No more AttributeError.
 *   2-3. `pair-async: await=true …` — `_kern_async_pairs` is an async
 *      generator that wraps either an async iterable (forward) or a sync
 *      source (via `_kern_pairs`). No more "async for requires __aiter__".
 *
 * All 19 fixtures run against Python; the PR-3b skip set is removed.
 */

describeIfPython('Python emitter leg — each fixtures (differential vs reference)', () => {
  it.each(eachContract.fixtures.map((f) => [f.description, f] as const))(
    'fixture: %s',
    async (_desc, fixture) => {
      const result = await runDifferential(fixture, { skipTs: true, pythonLeg: runPythonEmitterLeg });
      if (result.verdict !== 'pass') {
        throw new Error(
          `verdict=${result.verdict}\n` +
            `fixture=${fixture.description}\n` +
            `reference=${JSON.stringify(result.reference, null, 2)}\n` +
            `python=${JSON.stringify(result.python, null, 2)}\n` +
            `legError=${JSON.stringify(result.legError, null, 2)}`,
        );
      }
      expect(result.verdict).toBe<Verdict>('pass');
    },
    15_000,
  );
});

describeIfPython('Python emitter leg — branch fixtures (differential vs reference)', () => {
  it.each(branchContract.fixtures.map((f) => [f.description, f] as const))(
    'fixture: %s',
    async (_desc, fixture) => {
      const result = await runDifferential(fixture, { skipTs: true, pythonLeg: runPythonEmitterLeg });
      if (result.verdict !== 'pass') {
        throw new Error(
          `verdict=${result.verdict}\n` +
            `fixture=${fixture.description}\n` +
            `reference=${JSON.stringify(result.reference, null, 2)}\n` +
            `python=${JSON.stringify(result.python, null, 2)}\n` +
            `legError=${JSON.stringify(result.legError, null, 2)}`,
        );
      }
      expect(result.verdict).toBe<Verdict>('pass');
    },
    15_000,
  );
});

describeIfPython('runPythonEmitterLeg — direct unit test', () => {
  it('produces a single iter-next event for a one-element array', async () => {
    const fixture = {
      description: 'unit',
      ir: {
        type: 'each',
        props: { name: 'x', in: 'xs' },
        children: [{ type: '__trace', props: { event: { op: 'stdout', text: 'hit' } } }],
      },
      expected: {
        events: [
          { op: 'iter-next' as const, binding: 'x', value: 99 },
          { op: 'stdout' as const, text: 'hit' },
        ],
        completion: { kind: 'normal' as const },
      },
    };
    const env = makeEnv({ bindings: new Map([['xs', [99]]] as [string, unknown][]) });
    const trace = await runPythonEmitterLeg(fixture, env);
    expect(trace.events).toEqual([
      { op: 'iter-next', binding: 'x', value: 99 },
      { op: 'stdout', text: 'hit' },
    ]);
    expect(trace.completion).toEqual({ kind: 'normal' });
  }, 15_000);
});

if (!pythonAvailable) {
  describe('Python emitter leg', () => {
    it.skip('skipped: python3 not on PATH', () => {
      // Marker only — see describeIfPython above.
    });
  });
}
