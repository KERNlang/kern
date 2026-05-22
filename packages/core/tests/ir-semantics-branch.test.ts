/**
 * Contract tests for `branch` runtime semantics.
 *
 * Mirrors the `each` contract test shape: branch fixtures are validated
 * against the reference runner here; emitter parity is covered by the
 * TS/Python leg suites that consume the same fixture list.
 */

import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  runDifferential,
  type Verdict,
} from '../src/index.js';
import { _resetBranchContractForTest, branchContract, registerBranchContract } from '../src/ir/semantics/branch.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import type { IRNode } from '../src/types.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetBranchContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerBranchContract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetBranchContractForTest();
  _resetPrimitivesForTest();
});

describe('branch contract — positive fixtures (differential reference-only)', () => {
  it('exposes the required semantic fixture coverage', () => {
    expect(branchContract.fixtures.length).toBeGreaterThanOrEqual(8);
    const descriptions = branchContract.fixtures.map((f) => f.description).join('\n');
    expect(descriptions).toContain('single matching string path');
    expect(descriptions).toContain('no matching path falls through to default');
    expect(descriptions).toContain('matching path skips default');
    expect(descriptions).toContain('mid-default');
    expect(descriptions).toContain('trailing default');
    expect(descriptions).toContain('numeric case values');
    expect(descriptions).toContain('unquoted identifier path');
    expect(descriptions).toContain('empty matching path body');
  });

  it.each(branchContract.fixtures.map((f) => [f.description, f] as const))('fixture: %s', async (_desc, fixture) => {
    const result = await runDifferential(fixture, { skipTs: true, skipPython: true });
    if (result.verdict !== 'pass') {
      throw new Error(
        `verdict=${result.verdict}\nfixture=${fixture.description}\nexpected=${JSON.stringify(
          fixture.expected,
          null,
          2,
        )}\nreference=${JSON.stringify(result.reference, null, 2)}`,
      );
    }
    expect(result.verdict).toBe<Verdict>('pass');
  });
});

describe('branch contract — preconditions reject malformed IR', () => {
  async function mustReject(ir: IRNode, label: string, env = makeEnv()): Promise<void> {
    expect(() => referenceRun(ir, env)).toThrow(ReferenceRunnerError);
    const result = await runDifferential(
      { description: label, ir, env, expected: { events: [], completion: { kind: 'normal' } } },
      { skipTs: true, skipPython: true },
    );
    expect(result.verdict).toBe<Verdict>('leg-error');
  }

  it('rejects branch with no on= expression', async () => {
    await mustReject({ type: 'branch', props: {}, children: [{ type: 'path', props: { default: true } }] }, 'no on');
  });

  it('rejects branch with no paths', async () => {
    await mustReject({ type: 'branch', props: { on: 'kind' }, children: [] }, 'no paths');
  });

  it('rejects path with both value= and default=true', async () => {
    await mustReject(
      {
        type: 'branch',
        props: { on: 'kind' },
        children: [{ type: 'path', props: { value: 'paid', default: true }, __quotedProps: ['value'] }],
      },
      'ambiguous path',
    );
  });

  it('rejects path with neither value= nor default=true', async () => {
    await mustReject(
      { type: 'branch', props: { on: 'kind' }, children: [{ type: 'path', props: {} }] },
      'empty path shape',
    );
  });

  it('rejects multiple defaults', async () => {
    await mustReject(
      {
        type: 'branch',
        props: { on: 'kind' },
        children: [
          { type: 'path', props: { default: true } },
          { type: 'path', props: { default: true } },
        ],
      },
      'duplicate defaults',
    );
  });
});

describe('branch contract — equality domain', () => {
  it('rejects boolean subjects to avoid Python bool/int coercion divergence', async () => {
    await mustRejectWithEnv(
      {
        type: 'branch',
        props: { on: 'flag' },
        children: [{ type: 'path', props: { value: '1' }, children: [] }],
      },
      new Map<string, unknown>([['flag', true]]),
      'boolean subject',
    );
  });

  it('rejects boolean identifier path values for the same strict-equality contract', async () => {
    await mustRejectWithEnv(
      {
        type: 'branch',
        props: { on: 'code' },
        children: [{ type: 'path', props: { value: 'FLAG' }, children: [] }],
      },
      new Map<string, unknown>([
        ['code', 1],
        ['FLAG', true],
      ]),
      'boolean case',
    );
  });
});

async function mustRejectWithEnv(ir: IRNode, bindings: Map<string, unknown>, label: string): Promise<void> {
  const env = makeEnv({ bindings });
  expect(() => referenceRun(ir, env)).toThrow(ReferenceRunnerError);
  const result = await runDifferential(
    { description: label, ir, env: { bindings }, expected: { events: [], completion: { kind: 'normal' } } },
    { skipTs: true, skipPython: true },
  );
  expect(result.verdict).toBe<Verdict>('leg-error');
}

describe('branch contract — forbidden rewrites surface', () => {
  it('lists branch-specific forbidden rewrites for human review', () => {
    expect(branchContract.forbiddenRewrites.length).toBeGreaterThanOrEqual(4);
  });

  it('flags cross-type coercion explicitly', () => {
    expect(branchContract.forbiddenRewrites.some((s) => s.includes('cross-type coercion'))).toBe(true);
  });
});
