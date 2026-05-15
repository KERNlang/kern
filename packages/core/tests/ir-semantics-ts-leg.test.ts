/**
 * PR-3a — TS emitter leg integration tests.
 *
 * Runs every `each` fixture through the full TS leg: fixture-IR lowering →
 * production `emitNativeKernBodyTS` codegen with `traceHooks.eachIterNext` →
 * vm.runInContext execution → observed Trace.
 *
 * Verdict `pass` means reference == TS-leg (the Python leg is skipped here;
 * PR-3b wires that).
 */

import { CONTRACT_REGISTRY, makeEnv, runDifferential, type Verdict } from '../src/index.js';
import { _resetEachContractForTest, eachContract, registerEachContract } from '../src/ir/semantics/each.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import { lowerFixtureToKernIR, runTsEmitterLeg } from '../src/ir/semantics/ts-leg.js';
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

describe('TS emitter leg — each fixtures (differential vs reference)', () => {
  it.each(eachContract.fixtures.map((f) => [f.description, f] as const))('fixture: %s', async (_desc, fixture) => {
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

describe('lowerFixtureToKernIR', () => {
  it('translates __trace to do value="__kernTrace(...)"', () => {
    const node: IRNode = { type: '__trace', props: { event: { op: 'stdout', text: 'x' } } };
    const lowered = lowerFixtureToKernIR(node);
    expect(lowered.type).toBe('do');
    expect((lowered.props?.value as string).startsWith('__kernTrace(')).toBe(true);
  });

  it('translates return to throw new __KernReturn(...)', () => {
    const node: IRNode = { type: 'return', props: { value: 42 } };
    const lowered = lowerFixtureToKernIR(node);
    expect(lowered.type).toBe('throw');
    expect(lowered.props?.value).toBe('new __KernReturn(42)');
  });

  it('translates throw to throw new __KernThrow(...)', () => {
    const node: IRNode = { type: 'throw', props: { errorKind: 'TypeError' } };
    const lowered = lowerFixtureToKernIR(node);
    expect(lowered.type).toBe('throw');
    expect(lowered.props?.value).toBe('new __KernThrow("TypeError")');
  });

  it('passes break through unchanged', () => {
    const node: IRNode = { type: 'break' };
    expect(lowerFixtureToKernIR(node)).toEqual(node);
  });

  it('passes continue through unchanged', () => {
    const node: IRNode = { type: 'continue' };
    expect(lowerFixtureToKernIR(node)).toEqual(node);
  });

  it('recurses into children', () => {
    const node: IRNode = {
      type: 'each',
      props: { name: 'x', in: 'xs' },
      children: [{ type: 'break' }, { type: '__trace', props: { event: { op: 'stdout', text: 'hi' } } }],
    };
    const lowered = lowerFixtureToKernIR(node);
    expect(lowered.children?.[0]).toEqual({ type: 'break' });
    expect(lowered.children?.[1].type).toBe('do');
  });
});

describe('runTsEmitterLeg — direct unit tests', () => {
  it('produces a single iter-next event for a one-element array', async () => {
    const fixture = {
      ir: {
        type: 'each',
        props: { name: 'x', in: 'xs' },
        children: [{ type: '__trace', props: { event: { op: 'stdout', text: 'hit' } } }],
      },
    };
    const env = makeEnv({ bindings: new Map([['xs', [99]]] as [string, unknown][]) });
    const trace = await runTsEmitterLeg(fixture, env);
    expect(trace.events).toEqual([
      { op: 'iter-next', binding: 'x', value: 99 },
      { op: 'stdout', text: 'hit' },
    ]);
    expect(trace.completion).toEqual({ kind: 'normal' });
  });
});
