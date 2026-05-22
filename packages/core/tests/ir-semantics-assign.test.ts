/**
 * Executable semantic contract for body-statement `assign` (reassignment).
 *
 * Positive fixtures run through the reference runner and the production TS
 * emitter leg. Python parity is asserted in the Python package's ir-semantics
 * leg suite. Every assign fixture is a block that first declares a
 * `let kind=let` binding, so the let contract is registered alongside assign.
 */

import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  runDifferential,
  type Verdict,
} from '../src/index.js';
import { _resetAssignContractForTest, assignContract, registerAssignContract } from '../src/ir/semantics/assign.js';
import { _resetLetContractForTest, registerLetContract } from '../src/ir/semantics/let.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetAssignContractForTest();
  _resetLetContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerLetContract();
  registerAssignContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetAssignContractForTest();
  _resetLetContractForTest();
  _resetPrimitivesForTest();
});

describe('assign contract — positive fixtures', () => {
  it('exposes required fixture coverage', () => {
    expect(assignContract.fixtures.length).toBeGreaterThanOrEqual(6);
    expect(assignContract.fixtures.map((f) => f.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('plain `=` reassigns a number'),
        expect.stringContaining('plain `=` reassigns a string'),
        expect.stringContaining('plain `=` reassigns a boolean'),
        expect.stringContaining('`+=` numeric add'),
        expect.stringContaining('`+=` concatenates'),
        expect.stringContaining('read-modify-write'),
      ]),
    );
  });

  it.each(
    assignContract.fixtures.map((f) => [f.description, f] as const),
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
    assignContract.fixtures.map((f) => [f.description, f] as const),
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

describe('assign contract — preconditions reject out-of-domain IR', () => {
  function mustReject(ir: IRNode, label: string, bindings: Map<string, unknown> = new Map()): void {
    expect(() => referenceRun(ir, makeEnv({ bindings }))).toThrow(ReferenceRunnerError);
    expect(label.length).toBeGreaterThan(0);
  }

  function block(children: IRNode[]): IRNode {
    return { type: '__block', children };
  }

  function letN(value: string, name = 'n'): IRNode {
    return { type: 'let', props: { name, kind: 'let', value } };
  }

  it('rejects assigning to an undeclared name', () => {
    mustReject({ type: 'assign', props: { target: 'ghost', value: '1' } }, 'undeclared');
  });

  it('rejects cross-type plain reassignment (number = string)', () => {
    mustReject(block([letN('0'), { type: 'assign', props: { target: 'n', value: '"x"' } }]), 'cross-type =');
  });

  it('rejects cross-type compound assignment (number += string)', () => {
    mustReject(block([letN('0'), { type: 'assign', props: { target: 'n', op: '+=', value: '"x"' } }]), 'cross-type +=');
  });

  it('rejects compound operators other than +=', () => {
    mustReject(block([letN('4'), { type: 'assign', props: { target: 'n', op: '*=', value: '2' } }]), 'unsupported op');
  });

  it('rejects reassigning a null-typed binding', () => {
    mustReject(block([letN('null', 'x'), { type: 'assign', props: { target: 'x', value: '1' } }]), 'null-typed');
  });

  it('rejects builtin-shadowing targets', () => {
    mustReject({ type: 'assign', props: { target: 'print', value: '1' } }, 'builtin');
  });

  it('rejects assignment with no value', () => {
    mustReject(block([letN('0'), { type: 'assign', props: { target: 'n' } }]), 'missing value');
  });
});

describe('assign contract — forbidden rewrites surface', () => {
  it('pins read-modify-write and declaration-collapse rewrites', () => {
    expect(assignContract.forbiddenRewrites.some((s) => s.includes('global/nonlocal'))).toBe(true);
    expect(assignContract.forbiddenRewrites.some((s) => s.includes('declaration'))).toBe(true);
    expect(assignContract.forbiddenRewrites.some((s) => s.includes('x += y'))).toBe(true);
    expect(assignContract.forbiddenRewrites.some((s) => s.includes('read-modify-write'))).toBe(true);
  });
});
