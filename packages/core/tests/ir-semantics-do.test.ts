/**
 * Executable semantic contract for body-statement `do` — milestone 5.1b array
 * append (`<arrayIdent>.push(<elementExpr>)`).
 *
 * Positive fixtures run through the reference runner and the production TS
 * emitter leg. Python parity is asserted in the Python package's ir-semantics
 * leg suite. Every non-trivial `do` fixture is a block that first declares the
 * array via `let`, then pushes, then reads the result back (a return), so the
 * let contract is registered alongside `do`.
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
import { _resetDoContractForTest, doContract, registerDoContract } from '../src/ir/semantics/do.js';
import { _resetLetContractForTest, registerLetContract } from '../src/ir/semantics/let.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetDoContractForTest();
  _resetLetContractForTest();
  _resetAssignContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerLetContract();
  registerAssignContract();
  registerDoContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetDoContractForTest();
  _resetLetContractForTest();
  _resetAssignContractForTest();
  _resetPrimitivesForTest();
});

describe('do contract — positive fixtures', () => {
  it('exposes required fixture coverage', () => {
    expect(doContract.fixtures.length).toBeGreaterThanOrEqual(5);
    expect(doContract.fixtures.map((f) => f.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('empty value is a no-op'),
        expect.stringContaining('appends one element'),
        expect.stringContaining('does not disturb existing elements'),
        expect.stringContaining('grows .length'),
        expect.stringContaining('nested array-literal element'),
      ]),
    );
  });

  it.each(
    doContract.fixtures.map((f) => [f.description, f] as const),
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
    doContract.fixtures.map((f) => [f.description, f] as const),
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

describe('do contract — preconditions reject out-of-domain IR', () => {
  function mustReject(ir: IRNode, bindings: Map<string, unknown> = new Map()): void {
    expect(() => referenceRun(ir, makeEnv({ bindings }))).toThrow(ReferenceRunnerError);
  }

  function block(children: IRNode[]): IRNode {
    return { type: '__block', children };
  }

  function letArr(name: string, value: string): IRNode {
    return { type: 'let', props: { name, value } };
  }

  it('rejects a bare call other than push/Map.set', () => {
    mustReject({ type: 'do', props: { value: 'reg.load(engDir)' } });
  });

  it('rejects push on an undeclared binding', () => {
    mustReject({ type: 'do', props: { value: 'xs.push(1)' } });
  });

  it('rejects push on a non-array (scalar) binding', () => {
    mustReject(
      block([
        { type: 'let', props: { name: 'n', value: '1' } },
        { type: 'do', props: { value: 'n.push(1)' } },
      ]),
    );
  });

  it('rejects an OPTIONAL push receiver (`xs?.push(1)`)', () => {
    mustReject(block([letArr('xs', '[1]'), { type: 'do', props: { value: 'xs?.push(1)' } }]));
  });

  it('rejects push with zero arguments', () => {
    mustReject(block([letArr('xs', '[1]'), { type: 'do', props: { value: 'xs.push()' } }]));
  });

  it('rejects push with more than one argument', () => {
    mustReject(block([letArr('xs', '[1]'), { type: 'do', props: { value: 'xs.push(1, 2)' } }]));
  });

  it('rejects pushing an expression outside the portable scalar/array-literal domain', () => {
    mustReject(block([letArr('xs', '[]'), { type: 'do', props: { value: 'xs.push(new Error("x"))' } }]));
  });

  it('rejects push on an OBJECT-position expression (`ys[0].push(1)` — receiver is not a bare ident)', () => {
    mustReject({ type: 'do', props: { value: 'ys[0].push(1)' } });
  });
});

describe('do contract — forbidden rewrites surface', () => {
  it('pins the no-synthetic-event and no-in-place-mutation rewrites', () => {
    expect(doContract.forbiddenRewrites.some((s) => s.includes('assign'))).toBe(true);
    expect(doContract.forbiddenRewrites.some((s) => s.includes('in place'))).toBe(true);
  });
});
