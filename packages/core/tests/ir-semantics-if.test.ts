/**
 * Executable semantic contract for body-statement `if` / sibling `else`.
 *
 * The fixtures use the semantics-only `__block` wrapper so a single
 * NodeFixture can contain real sibling `[if, else]` body statements. The
 * TS/Python legs unwrap `__block` before production codegen, so the emitters
 * still exercise the real body-statement shape.
 */

import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  runDifferential,
  type Verdict,
} from '../src/index.js';
import { _resetIfContractForTest, ifContract, portableTruthy, registerIfContract } from '../src/ir/semantics/if.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetIfContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerIfContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetIfContractForTest();
  _resetPrimitivesForTest();
});

describe('if contract — positive fixtures', () => {
  it('exposes the required fixture coverage', () => {
    expect(ifContract.fixtures.length).toBeGreaterThanOrEqual(6);
    expect(ifContract.fixtures.map((f) => f.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('if-true'),
        expect.stringContaining('if-false-no-else'),
        expect.stringContaining('if-else'),
        expect.stringContaining('if-else-if-else'),
        expect.stringContaining('nested-if'),
        expect.stringContaining('truthiness-edge'),
      ]),
    );
  });

  it.each(ifContract.fixtures.map((f) => [f.description, f] as const))(
    'reference fixture: %s',
    async (_desc, fixture) => {
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
    },
  );

  it.each(ifContract.fixtures.map((f) => [f.description, f] as const))(
    'TS differential fixture: %s',
    async (_desc, fixture) => {
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
    },
  );
});

describe('if contract — preconditions and truthiness', () => {
  function mustReject(ir: IRNode, label: string): void {
    expect(() => referenceRun(ir, makeEnv())).toThrow(ReferenceRunnerError);
    expect(label.length).toBeGreaterThan(0);
  }

  it('rejects missing cond', () => {
    mustReject({ type: 'if', children: [] }, 'missing cond');
  });

  it('rejects empty cond', () => {
    mustReject({ type: 'if', props: { cond: '' }, children: [] }, 'empty cond');
  });

  it('rejects orphan else in body sequence', () => {
    mustReject({ type: '__block', children: [{ type: 'else', children: [] }] }, 'orphan else');
  });

  it('rejects object and array condition values because JS/Python truthiness diverges', () => {
    const objectEnv = makeEnv({ bindings: new Map([['x', {}]] as [string, unknown][]) });
    expect(() => referenceRun({ type: 'if', props: { cond: 'x' }, children: [] }, objectEnv)).toThrow(
      ReferenceRunnerError,
    );

    const arrayEnv = makeEnv({ bindings: new Map([['x', []]] as [string, unknown][]) });
    expect(() => referenceRun({ type: 'if', props: { cond: 'x' }, children: [] }, arrayEnv)).toThrow(
      ReferenceRunnerError,
    );
  });

  it('defines the portable primitive truthiness domain', () => {
    expect(portableTruthy(false)).toBe(false);
    expect(portableTruthy(0)).toBe(false);
    expect(portableTruthy('')).toBe(false);
    expect(portableTruthy(null)).toBe(false);
    expect(portableTruthy(undefined)).toBe(false);
    expect(portableTruthy(true)).toBe(true);
    expect(portableTruthy(1)).toBe(true);
    expect(portableTruthy('x')).toBe(true);
    expect(() => portableTruthy([])).toThrow(/portable truthiness/);
  });
});

describe('if contract — forbidden rewrites surface', () => {
  it('pins single-evaluation, branch exclusivity, and else-if collapse', () => {
    expect(ifContract.forbiddenRewrites.some((s) => s.includes('more than once'))).toBe(true);
    expect(ifContract.forbiddenRewrites.some((s) => s.includes('more than one'))).toBe(true);
    expect(ifContract.forbiddenRewrites.some((s) => s.includes('chain collapse'))).toBe(true);
  });
});
