/**
 * PR-1 smoke test for the IR-semantics skeleton.
 *
 * Verifies the contract registry, reference-runner dispatcher, and 3-way
 * harness compile and behave correctly with zero contracts registered.
 * PR-2 lands the first real contract (`each`); this test stays as the
 * permanent baseline that the skeleton remains wired even after contracts
 * land.
 */

import {
  CONTRACT_REGISTRY,
  emptyTrace,
  makeEnv,
  type NodeContract,
  type NodeFixture,
  referenceRun,
  registerContract,
  runDifferential,
  tracesEqual,
} from '../src/index.js';
import { ReferenceRunnerError } from '../src/ir/semantics/reference-runner.js';
import type { IRNode } from '../src/types.js';

afterEach(() => {
  CONTRACT_REGISTRY.clear();
});

describe('IR semantics skeleton (PR-1)', () => {
  it('makeEnv returns deterministic defaults', () => {
    const env = makeEnv();
    expect(env.seed).toBe(0);
    expect(env.now).toBe(0);
    expect(env.bindings.size).toBe(0);
  });

  it('tracesEqual treats two empty traces as equal', () => {
    expect(tracesEqual(emptyTrace(), emptyTrace())).toBe(true);
  });

  it('tracesEqual rejects mismatched completion kinds', () => {
    const a = emptyTrace();
    const b = { ...emptyTrace(), completion: { kind: 'throw' as const } };
    expect(tracesEqual(a, b)).toBe(false);
  });

  it('referenceRun throws on unregistered node type', () => {
    const node: IRNode = { type: 'each', props: {} };
    expect(() => referenceRun(node, makeEnv())).toThrow(ReferenceRunnerError);
  });

  it('registerContract is idempotent — second register throws', () => {
    const contract: NodeContract = {
      nodeType: 'noop',
      preconditions: () => true,
      effects: () => emptyTrace(),
      completion: () => ({ kind: 'normal' }),
      forbiddenRewrites: [],
      fixtures: [],
    };
    registerContract(contract);
    expect(() => registerContract(contract)).toThrow(/already registered/);
  });

  it('runDifferential passes when reference matches expected and emitter legs are skipped', () => {
    const noopContract: NodeContract = {
      nodeType: 'noop',
      preconditions: () => true,
      effects: () => emptyTrace(),
      completion: () => ({ kind: 'normal' }),
      forbiddenRewrites: [],
      fixtures: [],
    };
    registerContract(noopContract);

    const fixture: NodeFixture = {
      description: 'baseline noop',
      ir: { type: 'noop', props: {} },
      expected: emptyTrace(),
    };
    const result = runDifferential(fixture, { skipTs: true, skipPython: true });
    expect(result.verdict).toBe('pass');
  });

  it('runDifferential surfaces reference-mismatch when expected diverges', () => {
    const noopContract: NodeContract = {
      nodeType: 'noop',
      preconditions: () => true,
      effects: () => emptyTrace(),
      completion: () => ({ kind: 'normal' }),
      forbiddenRewrites: [],
      fixtures: [],
    };
    registerContract(noopContract);

    const fixture: NodeFixture = {
      description: 'expected stdout but reference is silent',
      ir: { type: 'noop', props: {} },
      expected: {
        events: [{ op: 'stdout', text: 'hello' }],
        completion: { kind: 'normal' },
      },
    };
    const result = runDifferential(fixture, { skipTs: true, skipPython: true });
    expect(result.verdict).toBe('reference-mismatch');
  });

  it('runDifferential reports leg-error when the TS leg is exercised', () => {
    const noopContract: NodeContract = {
      nodeType: 'noop',
      preconditions: () => true,
      effects: () => emptyTrace(),
      completion: () => ({ kind: 'normal' }),
      forbiddenRewrites: [],
      fixtures: [],
    };
    registerContract(noopContract);

    const fixture: NodeFixture = {
      description: 'ts leg not wired',
      ir: { type: 'noop', props: {} },
      expected: emptyTrace(),
    };
    const result = runDifferential(fixture, { skipPython: true });
    expect(result.verdict).toBe('leg-error');
    expect(result.legError?.leg).toBe('ts');
    expect(result.legError?.message).toMatch(/not wired yet/);
  });
});
