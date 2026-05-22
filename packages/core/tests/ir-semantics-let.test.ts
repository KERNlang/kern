/**
 * Executable semantic contract for body-statement `let`.
 *
 * The positive fixtures run through the reference runner and the production
 * TS emitter leg. Python parity is asserted in the Python package's
 * ir-semantics leg suite.
 */

import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  runDifferential,
  type Verdict,
} from '../src/index.js';
import { _resetLetContractForTest, letContract, registerLetContract } from '../src/ir/semantics/let.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetLetContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerLetContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetLetContractForTest();
  _resetPrimitivesForTest();
});

describe('let contract — positive fixtures', () => {
  it('exposes required fixture coverage', () => {
    expect(letContract.fixtures.length).toBeGreaterThanOrEqual(5);
    expect(letContract.fixtures.map((f) => f.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('string initializer'),
        expect.stringContaining('numeric expression'),
        expect.stringContaining('boolean initializer'),
        expect.stringContaining('null initializer'),
        expect.stringContaining('same block'),
      ]),
    );
  });

  it.each(
    letContract.fixtures.map((f) => [f.description, f] as const),
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
    letContract.fixtures.map((f) => [f.description, f] as const),
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

describe('let contract — preconditions reject out-of-domain IR', () => {
  function mustReject(ir: IRNode, label: string, bindings: Map<string, unknown> = new Map()): void {
    expect(() => referenceRun(ir, makeEnv({ bindings }))).toThrow(ReferenceRunnerError);
    expect(label.length).toBeGreaterThan(0);
  }

  it('rejects bare declarations with no initializer', () => {
    mustReject({ type: 'let', props: { name: 'x' } }, 'bare declaration');
  });

  it('rejects redeclaring the same name in the same block', () => {
    mustReject(
      {
        type: '__block',
        children: [
          { type: 'let', props: { name: 'x', value: '1' } },
          { type: 'let', props: { name: 'x', value: '2' } },
        ],
      },
      'redeclaration',
    );
  });

  it('rejects use-before-declare / TDZ-shaped initializers', () => {
    mustReject({ type: 'let', props: { name: 'x', value: 'x' } }, 'tdz');
  });

  it('rejects destructuring-like names', () => {
    mustReject({ type: 'let', props: { name: '{x}', value: '1' } }, 'destructuring');
  });

  it('rejects builtin shadowing', () => {
    mustReject({ type: 'let', props: { name: 'print', value: '"x"' } }, 'builtin');
  });

  it('rejects non-portable object initializers', () => {
    mustReject({ type: 'let', props: { name: 'obj', value: '{a: 1}' } }, 'object');
  });

  it('rejects names already bound in the current semantic environment', () => {
    mustReject({ type: 'let', props: { name: 'x', value: '1' } }, 'already bound', new Map([['x', 0]]));
  });
});

describe('let contract — forbidden rewrites surface', () => {
  it('pins block-scoping and declaration-kind rewrites', () => {
    expect(letContract.forbiddenRewrites.some((s) => s.includes('hoist'))).toBe(true);
    expect(letContract.forbiddenRewrites.some((s) => s.includes('var/global'))).toBe(true);
    expect(letContract.forbiddenRewrites.some((s) => s.includes('function scope'))).toBe(true);
    expect(letContract.forbiddenRewrites.some((s) => s.includes('const'))).toBe(true);
  });
});
