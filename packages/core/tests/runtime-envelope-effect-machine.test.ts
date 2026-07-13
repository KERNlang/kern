import { makeEnv } from '../src/ir/semantics/index.js';
import {
  INTERNAL_EFFECT_MACHINE_DISPOSITION,
  INTERNAL_EFFECT_MACHINE_FORMAT,
  isInternalEffectMachineEligible,
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { tracesEqual } from '../src/ir/semantics/trace.js';
import {
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeSync,
} from '../src/runtime-envelope/execute.js';
import { selectInternalRuntimeEngine } from '../src/runtime-envelope/internal-engine.js';
import { normalizeInternalRuntimeTrace } from '../src/runtime-envelope/normalize.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, limits } as const;

const unifiedNodes: IRNode[] = [
  { type: 'let', props: { name: 'x', value: '1' } },
  { type: 'assign', props: { op: '+=', target: 'x', value: '1' } },
  { type: 'capability', props: { input: 'x', name: 'answer', namespace: 'llm', operation: 'complete' } },
  { type: 'print', props: { value: 'answer' } },
  { type: 'return', props: { value: 'answer' } },
];

describe('private internal effect machine', () => {
  beforeAll(() => registerAllContracts());

  test('has one closed disposition for all required runner contracts', () => {
    expect(INTERNAL_EFFECT_MACHINE_DISPOSITION).toEqual({
      assign: 'unified',
      branch: 'legacy',
      capability: 'unified',
      do: 'legacy',
      each: 'legacy',
      'expression-v1': 'legacy',
      fmt: 'unified',
      for: 'legacy',
      if: 'legacy',
      lambda: 'legacy',
      let: 'unified',
      print: 'unified',
      return: 'unified',
      throw: 'unified',
      try: 'legacy',
      while: 'legacy',
    });
  });

  test('preflights the whole flat corpus and bounded root environment', () => {
    const root = makeEnv();
    expect(isInternalEffectMachineEligible(unifiedNodes, root)).toBe(true);
    expect(selectInternalRuntimeEngine(unifiedNodes, root)).toBe(INTERNAL_EFFECT_MACHINE_FORMAT);
    expect(isInternalEffectMachineEligible([...unifiedNodes, { type: 'if' }], makeEnv())).toBe(false);
    expect(selectInternalRuntimeEngine([...unifiedNodes, { type: 'if' }], makeEnv())).toBe('legacy');
    expect(isInternalEffectMachineEligible([{ type: 'print', children: [{ type: 'return' }] }], makeEnv())).toBe(false);
    expect(
      isInternalEffectMachineEligible(unifiedNodes, makeEnv({ runnerFunctions: new Map([['f', {} as never]]) })),
    ).toBe(false);
  });

  test('sync and immediate async drivers produce the same raw trace before normalization', async () => {
    const syncTrace = runInternalEffectMachineSync(
      unifiedNodes,
      makeEnv({ capabilities: { llm: { complete: () => 'world' } } }),
    );
    const asyncTrace = await runInternalEffectMachineAsync(unifiedNodes, makeEnv(), {
      asyncCapabilities: { llm: { complete: async () => 'world' } },
    });

    expect(tracesEqual(syncTrace, asyncTrace)).toBe(true);
    expect(syncTrace).toEqual({
      completion: { kind: 'return', value: 'world' },
      events: [
        { op: 'assign', target: 'x', value: 1 },
        { op: 'assign', target: 'x', value: 2 },
        { input: 2, namespace: 'llm', op: 'capability', operation: 'complete', result: 'world' },
        { op: 'assign', target: 'answer', value: 'world' },
        { op: 'stdout', text: 'world' },
      ],
    });
    expect(normalizeInternalRuntimeTrace(syncTrace, limits).events).toEqual([
      {
        input: { presence: 'value', value: { tag: 'integer', value: '2' } },
        namespace: 'llm',
        op: 'capability',
        operation: 'complete',
        result: { presence: 'value', value: { tag: 'text', value: 'world' } },
      },
      { op: 'stdout', text: 'world' },
    ]);
  });

  test('both envelope lanes route the unified corpus and preserve transactional bytes', async () => {
    const sync = executeInternalRuntimeEnvelopeSync(
      unifiedNodes,
      makeEnv({ capabilities: { llm: { complete: () => 'world' } } }),
      enabled,
    );
    const asyncEnvelope = await executeInternalRuntimeEnvelopeAsync(unifiedNodes, makeEnv(), enabled, {
      asyncCapabilities: { llm: { complete: async () => 'world' } },
    });
    expect(asyncEnvelope).toEqual(sync);
    expect(sync).toMatchObject({ completion: { kind: 'return' }, outcome: 'success' });
  });

  test('a Promise-returning sync provider fails closed inside the machine lane', () => {
    const envelope = executeInternalRuntimeEnvelopeSync(
      unifiedNodes,
      makeEnv({ capabilities: { llm: { complete: () => Promise.resolve('wrong-lane') as never } } }),
      enabled,
    );
    expect(envelope).toEqual({
      completion: { kind: 'error' },
      diagnostics: [{ category: 'runtime', code: 'capability-error', phase: 'execution' }],
      events: [],
      format: 'kern.runtime.internal.r0',
      outcome: 'failure',
      result: { presence: 'absent' },
    });
  });
});
