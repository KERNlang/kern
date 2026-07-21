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
import { _resetBranchContractForTest, branchContract, registerBranchContract } from '../src/ir/semantics/branch.js';
import { _resetEachContractForTest, eachContract, registerEachContract } from '../src/ir/semantics/each.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import { lowerFixtureToKernIR, runTsEmitterLeg } from '../src/ir/semantics/ts-leg.js';
import type { IRNode } from '../src/types.js';

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

describe('TS emitter leg — branch fixtures (differential vs reference)', () => {
  it.each(branchContract.fixtures.map((f) => [f.description, f] as const))('fixture: %s', async (_desc, fixture) => {
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
    const loweredValue = lowered.props?.value as string;
    expect(loweredValue.startsWith('__kernTrace(')).toBe(true);
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

  it('preserves empty children array', () => {
    const node: IRNode = { type: 'each', props: { name: 'x', in: 'xs' }, children: [] };
    const lowered = lowerFixtureToKernIR(node);
    expect(lowered.children).toEqual([]);
  });

  it('clones props so caller mutations cannot leak into the lowered tree', () => {
    const props = { name: 'x', in: 'xs' };
    const node: IRNode = { type: 'each', props, children: [{ type: 'break' }] };
    const lowered = lowerFixtureToKernIR(node);
    (props as Record<string, unknown>).name = 'mutated';
    expect((lowered.props as Record<string, unknown>).name).toBe('x');
  });

  it('throws on __trace with missing event prop', () => {
    expect(() => lowerFixtureToKernIR({ type: '__trace', props: {} })).toThrow(/event/);
  });

  it('throws on throw with missing errorKind prop', () => {
    expect(() => lowerFixtureToKernIR({ type: 'throw', props: {} })).toThrow(/errorKind/);
  });

  it('throws on throw with non-string errorKind', () => {
    expect(() => lowerFixtureToKernIR({ type: 'throw', props: { errorKind: 42 } })).toThrow(/errorKind/);
  });
});

describe('runTsEmitterLeg — error model', () => {
  it('re-throws when env.bindings shadows a reserved harness name', async () => {
    const fixture = {
      ir: {
        type: 'each',
        props: { name: 'x', in: 'xs' },
        children: [{ type: 'break' }],
      },
    };
    const env = makeEnv({
      bindings: new Map<string, unknown>([
        ['xs', [1]],
        ['__kernTrace', 'oops'],
      ]),
    });
    await expect(runTsEmitterLeg(fixture, env)).rejects.toThrow(/reserved/);
  });

  it('surfaces leg-error verdict for shadow attempts via the differential harness', async () => {
    const fixture = {
      description: 'shadow attempt',
      ir: {
        type: 'each',
        props: { name: 'x', in: 'xs' },
        children: [{ type: '__trace', props: { event: { op: 'stdout', text: 'x' } } }],
      },
      env: {
        bindings: new Map<string, unknown>([
          ['xs', [1]],
          ['__kernReturn', 'oops'], // not actually reserved (lowercase), so this passes
          ['__KernReturn', 'shadow'], // THIS is reserved
        ]),
      },
      expected: {
        events: [
          { op: 'iter-next' as const, binding: 'x', value: 1 },
          { op: 'stdout' as const, text: 'x' },
        ],
        completion: { kind: 'normal' as const },
      },
    };
    const result = await runDifferential(fixture, { skipPython: true });
    expect(result.verdict).toBe<Verdict>('leg-error');
    expect(result.legError?.leg).toBe('ts');
    expect(result.legError?.message).toMatch(/reserved/);
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
