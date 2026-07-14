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
      branch: 'unified',
      break: 'unified',
      capability: 'unified',
      continue: 'unified',
      do: 'unified',
      each: 'partial',
      'expression-v1': 'legacy',
      fmt: 'unified',
      for: 'unified',
      if: 'unified',
      lambda: 'legacy',
      let: 'unified',
      print: 'unified',
      return: 'unified',
      throw: 'unified',
      try: 'unified',
      while: 'unified',
    });
  });

  test('preflights the whole flat corpus and bounded root environment', () => {
    const root = makeEnv();
    expect(isInternalEffectMachineEligible(unifiedNodes, root)).toBe(true);
    expect(selectInternalRuntimeEngine(unifiedNodes, root)).toBe(INTERNAL_EFFECT_MACHINE_FORMAT);
    expect(isInternalEffectMachineEligible([...unifiedNodes, { type: 'if' }], makeEnv())).toBe(true);
    expect(selectInternalRuntimeEngine([...unifiedNodes, { type: 'if' }], makeEnv())).toBe(
      INTERNAL_EFFECT_MACHINE_FORMAT,
    );
    expect(isInternalEffectMachineEligible([{ type: 'else', children: [] }], makeEnv())).toBe(false);
    expect(isInternalEffectMachineEligible([{ type: 'print', children: [{ type: 'return' }] }], makeEnv())).toBe(false);
    expect(
      isInternalEffectMachineEligible(unifiedNodes, makeEnv({ runnerFunctions: new Map([['f', {} as never]]) })),
    ).toBe(false);
    expect(
      isInternalEffectMachineEligible(unifiedNodes, makeEnv({ runnerClasses: new Map([['C', {} as never]]) })),
    ).toBe(false);
    expect(isInternalEffectMachineEligible(unifiedNodes, makeEnv({ runnerFunctions: { size: 0 } as never }))).toBe(
      false,
    );
    expect(isInternalEffectMachineEligible(unifiedNodes, makeEnv({ runnerClasses: { size: 0 } as never }))).toBe(false);
  });

  test('routes root try through the unified effect machine', () => {
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [
          { type: 'print', props: { value: '"work"' } },
          { type: 'finally', children: [{ type: 'print', props: { value: '"cleanup"' } }] },
        ],
      },
    ];
    expect(selectInternalRuntimeEngine(nodes, makeEnv())).toBe(INTERNAL_EFFECT_MACHINE_FORMAT);
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

  test('evaluates structured capability input through the machine-safe scalar core', () => {
    const seen: unknown[] = [];
    const trace = runInternalEffectMachineSync(
      [
        {
          type: 'capability',
          props: {
            input: '{ prompt: Text.slice("hello", 0, 2), values: [1, true, null], meta: { ok: true } }',
            name: 'answer',
            namespace: 'llm',
            operation: 'complete',
          },
        },
        { type: 'return', props: { value: 'answer' } },
      ],
      makeEnv({
        capabilities: {
          llm: {
            complete: ({ input }) => {
              seen.push(input);
              return 'ok';
            },
          },
        },
      }),
    );
    expect(seen[0]).toMatchObject({ prompt: 'he', values: [1, true, null], meta: { ok: true } });
    expect(trace.completion).toEqual({ kind: 'return', value: 'ok' });
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

  test('selected if branch uses one nested machine frame with raw sync/async parity', async () => {
    const nodes: IRNode[] = [
      { type: 'let', props: { name: 'flag', value: 'true' } },
      {
        type: 'if',
        props: { cond: 'flag' },
        children: [
          {
            type: 'capability',
            props: { input: '"selected"', name: 'answer', namespace: 'llm', operation: 'complete' },
          },
          { type: 'print', props: { value: 'answer' } },
          { type: 'return', props: { value: 'answer' } },
        ],
      },
      {
        type: 'else',
        children: [
          {
            type: 'capability',
            props: { input: '"unselected"', name: 'answer', namespace: 'llm', operation: 'complete' },
          },
          { type: 'return', props: { value: 'answer' } },
        ],
      },
    ];
    const syncTrace = runInternalEffectMachineSync(
      nodes,
      makeEnv({ capabilities: { llm: { complete: ({ input }) => `sync:${input}` } } }),
    );
    const asyncTrace = await runInternalEffectMachineAsync(nodes, makeEnv(), {
      asyncCapabilities: { llm: { complete: async ({ input }) => `sync:${input}` } },
    });
    expect(tracesEqual(syncTrace, asyncTrace)).toBe(true);
    expect(syncTrace).toEqual({
      completion: { kind: 'return', value: 'sync:selected' },
      events: [
        { op: 'assign', target: 'flag', value: true },
        {
          input: 'selected',
          namespace: 'llm',
          op: 'capability',
          operation: 'complete',
          result: 'sync:selected',
        },
        { op: 'assign', target: 'answer', value: 'sync:selected' },
        { op: 'stdout', text: 'sync:selected' },
      ],
    });
  });

  test('false condition runs only the paired else and nested else-if keeps nearest pairing', () => {
    const calls: unknown[] = [];
    const nodes: IRNode[] = [
      {
        type: 'if',
        props: { cond: 'false' },
        children: [{ type: 'capability', props: { namespace: 'storage', operation: 'get' } }],
      },
      {
        type: 'else',
        children: [
          { type: 'if', props: { cond: 'true' }, children: [{ type: 'return', props: { value: '"middle"' } }] },
          { type: 'else', children: [{ type: 'return', props: { value: '"fallback"' } }] },
        ],
      },
    ];
    const trace = runInternalEffectMachineSync(
      nodes,
      makeEnv({ capabilities: { storage: { get: (call) => calls.push(call) } } }),
    );
    expect(calls).toEqual([]);
    expect(trace).toEqual({ completion: { kind: 'return', value: 'middle' }, events: [] });
  });

  test('a selected true arm never evaluates an unavailable else-if condition', async () => {
    const nodes: IRNode[] = [
      { type: 'if', props: { cond: 'true' }, children: [{ type: 'return', props: { value: '"selected"' } }] },
      {
        type: 'else',
        children: [
          {
            type: 'if',
            props: { cond: 'unavailable' },
            children: [{ type: 'return', props: { value: '"wrong"' } }],
          },
        ],
      },
    ];
    const sync = executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), enabled);
    const asyncEnvelope = await executeInternalRuntimeEnvelopeAsync(nodes, makeEnv(), enabled);
    expect(asyncEnvelope).toEqual(sync);
    expect(sync).toMatchObject({ outcome: 'success', result: { value: { tag: 'text', value: 'selected' } } });
  });

  test('branch claims the machine and preserves first-match and default selection without fallthrough', () => {
    const matchingEnv = makeEnv({ bindings: new Map([['kind', 'paid']]) });
    const matching: IRNode[] = [
      {
        type: 'branch',
        props: { on: 'kind' },
        children: [
          {
            type: 'path',
            props: { value: 'paid' },
            __quotedProps: ['value'],
            children: [{ type: 'print', props: { value: '"first"' } }],
          },
          {
            type: 'path',
            props: { value: 'paid' },
            __quotedProps: ['value'],
            children: [{ type: 'print', props: { value: '"second"' } }],
          },
          {
            type: 'path',
            props: { default: true },
            children: [{ type: 'print', props: { value: '"default"' } }],
          },
        ],
      },
    ];
    expect(isInternalEffectMachineEligible(matching, matchingEnv)).toBe(true);
    expect(selectInternalRuntimeEngine(matching, matchingEnv)).toBe(INTERNAL_EFFECT_MACHINE_FORMAT);
    expect(runInternalEffectMachineSync(matching, matchingEnv)).toEqual({
      completion: { kind: 'normal' },
      events: [{ op: 'stdout', text: 'first' }],
    });
    const defaultEnv = makeEnv({ bindings: new Map([['kind', 'missing']]) });
    expect(runInternalEffectMachineSync(matching, defaultEnv)).toEqual({
      completion: { kind: 'normal' },
      events: [{ op: 'stdout', text: 'default' }],
    });
  });

  test('branch path uses child lexical scope while outer assignments write through', () => {
    const env = makeEnv({
      bindings: new Map<string, unknown>([
        ['kind', 'paid'],
        ['total', 1],
      ]),
    });
    const nodes: IRNode[] = [
      {
        type: 'branch',
        props: { on: 'kind' },
        children: [
          {
            type: 'path',
            props: { value: 'paid' },
            __quotedProps: ['value'],
            children: [
              { type: 'let', props: { name: 'local', value: '2' } },
              { type: 'assign', props: { op: '+=', target: 'total', value: 'local' } },
            ],
          },
        ],
      },
    ];
    expect(runInternalEffectMachineSync(nodes, env)).toEqual({
      completion: { kind: 'normal' },
      events: [
        { op: 'assign', target: 'local', value: 2 },
        { op: 'assign', target: 'total', value: 3 },
      ],
    });
    expect(env.bindings.get('total')).toBe(3);
    expect(env.bindings.has('local')).toBe(false);
  });

  test('branch, if, and nested branch frames share raw sync and async capability traces', async () => {
    const nodes: IRNode[] = [
      {
        type: 'branch',
        props: { on: '"outer"' },
        children: [
          {
            type: 'path',
            props: { value: 'outer' },
            __quotedProps: ['value'],
            children: [
              {
                type: 'if',
                props: { cond: 'true' },
                children: [
                  {
                    type: 'branch',
                    props: { on: '"inner"' },
                    children: [
                      {
                        type: 'path',
                        props: { value: 'inner' },
                        __quotedProps: ['value'],
                        children: [
                          {
                            type: 'capability',
                            props: {
                              input: '"selected"',
                              name: 'answer',
                              namespace: 'llm',
                              operation: 'complete',
                            },
                          },
                          { type: 'return', props: { value: 'answer' } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const syncTrace = runInternalEffectMachineSync(
      nodes,
      makeEnv({ capabilities: { llm: { complete: ({ input }) => `same:${input}` } } }),
    );
    const asyncTrace = await runInternalEffectMachineAsync(nodes, makeEnv(), {
      asyncCapabilities: { llm: { complete: async ({ input }) => `same:${input}` } },
    });
    expect(tracesEqual(syncTrace, asyncTrace)).toBe(true);
    expect(syncTrace.completion).toEqual({ kind: 'return', value: 'same:selected' });
    const ifToBranch: IRNode[] = [
      {
        type: 'if',
        props: { cond: 'true' },
        children: [
          {
            type: 'branch',
            props: { on: '"yes"' },
            children: [
              {
                type: 'path',
                props: { value: 'yes' },
                __quotedProps: ['value'],
                children: [{ type: 'return', props: { value: '"nested"' } }],
              },
            ],
          },
        ],
      },
    ];
    expect(runInternalEffectMachineSync(ifToBranch, makeEnv()).completion).toEqual({
      kind: 'return',
      value: 'nested',
    });
  });

  test('branch structurally closes every path and fails before provider dispatch', () => {
    let calls = 0;
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });
    const nodes: IRNode[] = [
      {
        type: 'branch',
        props: { on: '"selected"' },
        children: [
          {
            type: 'path',
            props: { value: 'ignored' },
            __quotedProps: ['value'],
            children: [
              { type: 'while', children: [] },
              { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
            ],
          },
          {
            type: 'path',
            props: { value: 'selected' },
            __quotedProps: ['value'],
            children: [{ type: 'return', props: { value: '"ok"' } }],
          },
        ],
      },
    ];
    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
    const unsupported: IRNode[] = [
      {
        type: 'branch',
        props: { on: '"selected"' },
        children: [
          {
            type: 'path',
            props: { value: 'selected' },
            __quotedProps: ['value'],
            children: [
              { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
              { type: 'while', children: [] },
            ],
          },
        ],
      },
    ];
    expect(executeInternalRuntimeEnvelopeSync(unsupported, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
    const malformed: IRNode[] = [{ type: 'branch', props: { on: '"x"' }, children: [{ type: 'path' }] }];
    expect(selectInternalRuntimeEngine(malformed, makeEnv())).toBe(INTERNAL_EFFECT_MACHINE_FORMAT);
    expect(executeInternalRuntimeEnvelopeSync(malformed, makeEnv(), enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      outcome: 'failure',
    });
  });
  test('pairing ignores smuggled metadata and trusts only the immediate else sibling', () => {
    let calls = 0;
    const smuggledElse: IRNode = {
      type: 'else',
      children: [{ type: 'capability', props: { namespace: 'storage', operation: 'get' } }],
    };
    const withoutSibling: IRNode[] = [
      { type: 'if', props: { __pairedElse: smuggledElse, cond: 'false' }, children: [] },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });
    expect(runInternalEffectMachineSync(withoutSibling, env)).toEqual({ completion: { kind: 'normal' }, events: [] });
    expect(calls).toBe(0);

    const withSibling: IRNode[] = [
      {
        type: 'if',
        props: {
          __pairedElse: { type: 'else', children: [{ type: 'return', props: { value: '"wrong"' } }] },
          cond: 'false',
        },
        children: [],
      },
      { type: 'else', children: [{ type: 'return', props: { value: '"real"' } }] },
    ];
    expect(runInternalEffectMachineSync(withSibling, makeEnv())).toEqual({
      completion: { kind: 'return', value: 'real' },
      events: [],
    });
  });

  test('unsupported selected nested nodes fail inside the claimed machine without provider dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'if',
        props: { cond: 'true' },
        children: [{ type: 'branch' }, { type: 'capability', props: { namespace: 'storage', operation: 'get' } }],
      },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });
    expect(selectInternalRuntimeEngine(nodes, env)).toBe(INTERNAL_EFFECT_MACHINE_FORMAT);
    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toEqual({
      completion: { kind: 'error' },
      diagnostics: [{ category: 'runtime', code: 'unsupported-runtime-input', phase: 'execution' }],
      events: [],
      format: 'kern.runtime.internal.r0',
      outcome: 'failure',
      result: { presence: 'absent' },
    });
    expect(calls).toBe(0);
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
