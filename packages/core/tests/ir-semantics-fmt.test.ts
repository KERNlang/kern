/**
 * Executable semantic contract for body-statement `fmt` (string interpolation).
 *
 * Positive fixtures run through the reference runner and the production TS
 * emitter leg. Python parity (incl. the bool/null canonicalization that
 * `_kern_fmt` provides) is asserted in the Python package's ir-semantics leg
 * suite. Interpolated values come from the fixture env, so each fmt fixture
 * produces a single observable {op:assign} event.
 */

import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  runDifferential,
  type Verdict,
} from '../src/index.js';
import { _resetFmtContractForTest, fmtContract, registerFmtContract } from '../src/ir/semantics/fmt.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetFmtContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerFmtContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetFmtContractForTest();
  _resetPrimitivesForTest();
});

describe('fmt contract — positive fixtures', () => {
  it('exposes required fixture coverage', () => {
    expect(fmtContract.fixtures.length).toBeGreaterThanOrEqual(6);
    expect(fmtContract.fixtures.map((f) => f.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('integer interpolation'),
        expect.stringContaining('string interpolation'),
        expect.stringContaining('boolean true canonicalizes'),
        expect.stringContaining('boolean false canonicalizes'),
        expect.stringContaining('null canonicalizes'),
        expect.stringContaining('no interpolation'),
      ]),
    );
  });

  it.each(
    fmtContract.fixtures.map((f) => [f.description, f] as const),
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
    fmtContract.fixtures.map((f) => [f.description, f] as const),
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

describe('fmt contract — preconditions reject out-of-domain IR', () => {
  function mustReject(ir: IRNode, label: string, bindings: Map<string, unknown> = new Map()): void {
    expect(() => referenceRun(ir, makeEnv({ bindings }))).toThrow(ReferenceRunnerError);
    expect(label.length).toBeGreaterThan(0);
  }

  it('rejects float interpolation (1.0 -> "1" TS vs "1.0" Python)', () => {
    mustReject({ type: 'fmt', props: { name: 'msg', template: 'x=${f}' } }, 'float', new Map([['f', 1.5]]));
  });

  it('rejects non-portable object interpolation', () => {
    mustReject({ type: 'fmt', props: { name: 'msg', template: 'x=${o}' } }, 'object', new Map([['o', {}]]));
  });

  it('rejects a missing template', () => {
    mustReject({ type: 'fmt', props: { name: 'msg' } }, 'missing template');
  });

  it('rejects the return-position form (no observable binding)', () => {
    mustReject({ type: 'fmt', props: { return: true, template: 'x' } }, 'return form');
  });

  it('rejects builtin-shadowing names', () => {
    mustReject({ type: 'fmt', props: { name: 'print', template: 'x' } }, 'builtin');
  });

  it('rejects a name already bound in the environment', () => {
    mustReject({ type: 'fmt', props: { name: 'msg', template: 'x' } }, 'already bound', new Map([['msg', 'old']]));
  });
});

describe('fmt contract — forbidden rewrites surface', () => {
  it('pins canonicalization and single-evaluation rewrites', () => {
    expect(fmtContract.forbiddenRewrites.some((s) => s.includes('canonicalization'))).toBe(true);
    expect(fmtContract.forbiddenRewrites.some((s) => s.includes('float'))).toBe(true);
    expect(fmtContract.forbiddenRewrites.some((s) => s.includes('double-evaluate'))).toBe(true);
  });
});
