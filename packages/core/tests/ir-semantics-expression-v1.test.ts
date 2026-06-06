/**
 * Executable semantic contract for body-statement `expression-v1`.
 *
 * This contract pins the initial portable scalar expression subset used by
 * TS/Python parity: null/bool/string/number scalars, scalar equality,
 * truthiness, and KERN-canonical string coercion.
 */

import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  runDifferential,
  type Verdict,
} from '../src/index.js';
import {
  _resetExpressionV1ContractForTest,
  expressionV1Contract,
  registerExpressionV1Contract,
} from '../src/ir/semantics/expression-v1.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetExpressionV1ContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerExpressionV1Contract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetExpressionV1ContractForTest();
  _resetPrimitivesForTest();
});

describe('expression-v1 contract — positive fixtures', () => {
  it('exposes scalar, equality, truthiness, and string coercion coverage', () => {
    expect(expressionV1Contract.fixtures.length).toBeGreaterThanOrEqual(10);
    expect(expressionV1Contract.fixtures.map((f) => f.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('number scalar'),
        expect.stringContaining('string scalar'),
        expect.stringContaining('boolean scalar'),
        expect.stringContaining('null scalar'),
        expect.stringContaining('equality'),
        expect.stringContaining('truthiness'),
        expect.stringContaining('template literal string coercion'),
        expect.stringContaining('canonicalizes null'),
        expect.stringContaining('canonicalizes boolean'),
        expect.stringContaining('ExprObject expression prop'),
      ]),
    );
  });

  it.each(
    expressionV1Contract.fixtures.map((f) => [f.description, f] as const),
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
    expressionV1Contract.fixtures.map((f) => [f.description, f] as const),
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

describe('expression-v1 contract — preconditions reject out-of-domain IR', () => {
  function mustReject(ir: IRNode, label: string, bindings: Map<string, unknown> = new Map()): void {
    expect(() => referenceRun(ir, makeEnv({ bindings }))).toThrow(ReferenceRunnerError);
    expect(label.length).toBeGreaterThan(0);
  }

  it('rejects missing expr', () => {
    mustReject({ type: 'expression-v1', props: { name: 'x' } }, 'missing expr');
  });

  it('rejects empty ExprObject expr', () => {
    mustReject({ type: 'expression-v1', props: { name: 'x', expr: { __expr: true, code: '' } } }, 'empty expr object');
  });

  it('rejects non-portable object literals', () => {
    mustReject({ type: 'expression-v1', props: { name: 'x', expr: '{ a: 1 }' } }, 'object literal');
  });

  it('rejects builtin-shadowing names', () => {
    mustReject({ type: 'expression-v1', props: { name: 'print', expr: '"x"' } }, 'builtin');
  });

  it('rejects redeclaring a current binding', () => {
    mustReject({ type: 'expression-v1', props: { name: 'x', expr: '1' } }, 'redeclaration', new Map([['x', 0]]));
  });
});
