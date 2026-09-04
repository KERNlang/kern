import { assertDeferredMachineScalarPreflight } from '../src/ir/semantics/deferred-expression-preflight.js';
import { makeEnv } from '../src/ir/semantics/index.js';
import { parseExpression } from '../src/parser-expression.js';
import { executeInternalRuntimeEnvelopeSync } from '../src/runtime-envelope/execute.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxIterations: 64,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, limits } as const;

describe('effect-machine whole-tree expression preflight', () => {
  test('deferred scalar preflight enforces String and Map call arity directly', () => {
    const env = makeEnv();
    const deferred = new Set(['late']);
    expect(() => assertDeferredMachineScalarPreflight(parseExpression('String(late, 1)'), env, deferred)).toThrow(
      'portable machine: expression function call is outside the structural domain',
    );
    expect(() => assertDeferredMachineScalarPreflight(parseExpression('Map.get(late)'), env, deferred)).toThrow(
      'portable machine: expression Map call is outside the structural domain',
    );
  });

  test('rejects structurally unsupported leaf expressions before an earlier capability', () => {
    const cases: readonly { readonly bindings?: Map<string, unknown>; readonly leaf: IRNode }[] = [
      { bindings: new Map([['answer', 0]]), leaf: { type: 'assign', props: { target: 'answer', value: 'new C()' } } },
      { leaf: { type: 'let', props: { name: 'answer', value: 'new C()' } } },
      { leaf: { type: 'let', props: { name: 'answer', value: '[new C()]' } } },
      { leaf: { type: 'fmt', props: { name: 'answer', template: '${new C()}' } } },
      { leaf: { type: 'print', props: { value: 'new C()' } } },
      { leaf: { type: 'return', props: { value: 'new C()' } } },
      { leaf: { type: 'throw', props: { value: 'new Error(new C())' } } },
    ];

    for (const testCase of cases) {
      let calls = 0;
      const nodes: IRNode[] = [
        { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
        testCase.leaf,
      ];
      const env = makeEnv({
        bindings: testCase.bindings,
        capabilities: { storage: { get: () => (calls += 1) } },
      });
      expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
      expect(calls).toBe(0);
    }
  });

  test('rejects a shared raw return graph before an earlier capability', () => {
    let calls = 0;
    const shared = [1];
    const value = { first: shared, second: shared };
    const nodes: IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('rejects an env-resolved composite print before an earlier capability', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'print', props: { value: 'items' } },
    ];
    const env = makeEnv({
      bindings: new Map([['items', [1, 2]]]),
      capabilities: { storage: { get: () => (calls += 1) } },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('rejects a missing read before an earlier capability even when a later leaf declares the name', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'print', props: { value: 'missing' } },
      { type: 'let', props: { name: 'missing', value: '1' } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('dry-runs pure declarations so a later composite print rejects before capability dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'let', props: { name: 'items', value: '[1, 2]' } },
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'print', props: { value: 'items' } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
    expect(env.bindings.size).toBe(0);
  });

  test('forks dry-run state across mutually exclusive and loop-local scopes', () => {
    const conditional: IRNode[] = [
      { type: 'if', props: { cond: 'true' }, children: [{ type: 'let', props: { name: 'value', value: '1' } }] },
      { type: 'else', children: [{ type: 'let', props: { name: 'value', value: '2' } }] },
      { type: 'return', props: { value: 'value' } },
    ];
    expect(executeInternalRuntimeEnvelopeSync(conditional, makeEnv(), enabled)).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '1' } },
    });

    const loopLocal: IRNode[] = [
      {
        type: 'for',
        props: { from: '0', name: 'i', to: '1' },
        children: [{ type: 'let', props: { name: 'value', value: 'i' } }],
      },
      { type: 'let', props: { name: 'value', value: '2' } },
      { type: 'return', props: { value: 'value' } },
    ];
    expect(executeInternalRuntimeEnvelopeSync(loopLocal, makeEnv(), enabled)).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '2' } },
    });
  });

  test('rejects normalization-forbidden record literal keys before an earlier capability', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: '{__defineGetter__: 1}' } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('rejects a malformed later capability before an earlier provider runs', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'capability', props: { namespace: 'storage' } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('resolves known control inputs before an earlier provider runs', () => {
    const controls: readonly IRNode[] = [
      { type: 'if', props: { cond: 'missing' }, children: [] },
      {
        type: 'branch',
        props: { on: 'missing' },
        children: [{ type: 'path', props: { default: true }, children: [] }],
      },
      { type: 'for', props: { from: 'missing', name: 'index', to: '1' }, children: [] },
      {
        type: 'each',
        props: { in: 'missing', name: 'item' },
        children: [{ type: 'print', props: { value: 'item' } }],
      },
      { type: 'while', props: { cond: 'missing' }, children: [] },
    ];

    for (const control of controls) {
      let calls = 0;
      const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });
      expect(
        executeInternalRuntimeEnvelopeSync(
          [{ type: 'capability', props: { namespace: 'storage', operation: 'get' } }, control],
          env,
          enabled,
        ),
      ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], events: [], outcome: 'failure' });
      expect(calls).toBe(0);
    }
  });

  test('reserves capability result bindings before provider dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
      { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
    expect(env.bindings.size).toBe(0);
  });

  test('rejects let and fmt redeclarations of reserved capability results before dispatch', () => {
    const redeclarations: readonly IRNode[] = [
      { type: 'let', props: { name: 'answer', value: '1' } },
      { type: 'fmt', props: { name: 'answer', template: 'value=${1}' } },
    ];
    for (const redeclaration of redeclarations) {
      let calls = 0;
      const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });
      const nodes: IRNode[] = [
        { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
        redeclaration,
      ];
      expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
      expect(calls).toBe(0);
      expect(env.bindings.size).toBe(0);
    }
  });

  test('defers value evaluation for structured inputs from earlier capability results', () => {
    const inputs: unknown[] = [];
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'context', namespace: 'storage', operation: 'context' } },
      {
        type: 'capability',
        props: { input: '{prompt: context.text}', name: 'answer', namespace: 'storage', operation: 'render' },
      },
      { type: 'return', props: { value: 'answer' } },
    ];
    const env = makeEnv({
      capabilities: {
        storage: {
          context: () => ({ text: 'ready' }),
          render: ({ input }) => {
            inputs.push(input);
            return (input as { prompt: string }).prompt;
          },
        },
      },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'text', value: 'ready' } },
    });
    expect(inputs).toEqual([{ prompt: 'ready' }]);
  });

  test('accepts a deferred capability result as the complete next capability input', () => {
    const inputs: unknown[] = [];
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'value', namespace: 'storage', operation: 'get' } },
      {
        type: 'capability',
        props: { input: 'value', name: 'answer', namespace: 'storage', operation: 'echo' },
      },
      { type: 'return', props: { value: 'answer' } },
    ];
    const env = makeEnv({
      capabilities: {
        storage: {
          echo: ({ input }) => {
            inputs.push(input);
            return input;
          },
          get: () => 'ready',
        },
      },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'text', value: 'ready' } },
    });
    expect(inputs).toEqual(['ready']);
  });

  test('rejects non-deferred missing reads masked by a deferred capability result before dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'value', namespace: 'storage', operation: 'get' } },
      { type: 'capability', props: { namespace: 'storage', operation: 'touch' } },
      { type: 'print', props: { value: 'value + missing' } },
    ];
    const env = makeEnv({
      capabilities: {
        storage: {
          get: () => {
            calls += 1;
            return 1;
          },
          touch: () => (calls += 1),
        },
      },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('rejects a non-scalar leaf operand masked by a deferred capability result before dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
      { type: 'print', props: { value: 'm == late' } },
    ];
    const env = makeEnv({
      bindings: new Map([['m', new Map<string, unknown>()]]),
      capabilities: {
        storage: {
          get: () => {
            calls += 1;
            return 1;
          },
        },
      },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('rejects a non-portable capability field masked by a deferred sibling before dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
      {
        type: 'capability',
        props: { input: '{x: m, y: late}', namespace: 'storage', operation: 'echo' },
      },
    ];
    const env = makeEnv({
      bindings: new Map([['m', new Map<string, unknown>()]]),
      capabilities: {
        storage: {
          echo: () => (calls += 1),
          get: () => {
            calls += 1;
            return 1;
          },
        },
      },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('preserves deferred short-circuiting while validating a known reachable operand', () => {
    let calls = 0;
    const capabilities = {
      storage: {
        get: () => {
          calls += 1;
          return true;
        },
      },
    };
    const bindings = new Map([['m', new Map<string, unknown>()]]);

    expect(
      executeInternalRuntimeEnvelopeSync(
        [
          { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
          { type: 'print', props: { value: 'late || m' } },
        ],
        makeEnv({ bindings, capabilities }),
        enabled,
      ),
    ).toMatchObject({ outcome: 'success' });
    expect(calls).toBe(1);

    calls = 0;
    expect(
      executeInternalRuntimeEnvelopeSync(
        [
          { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
          { type: 'print', props: { value: 'm || late' } },
        ],
        makeEnv({ bindings, capabilities }),
        enabled,
      ),
    ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], events: [], outcome: 'failure' });
    expect(calls).toBe(0);
  });

  test('shape-checks but does not value-evaluate statically unselected control arms', () => {
    const controls: readonly { readonly bindings?: Map<string, unknown>; readonly nodes: IRNode[] }[] = [
      {
        nodes: [
          { type: 'if', props: { cond: 'true' }, children: [] },
          { type: 'else', children: [{ type: 'print', props: { value: 'missing' } }] },
        ],
      },
      {
        nodes: [
          {
            type: 'branch',
            props: { on: '"selected"' },
            children: [
              { type: 'path', props: { value: 'selected' }, __quotedProps: ['value'], children: [] },
              {
                type: 'path',
                props: { value: 'other' },
                __quotedProps: ['value'],
                children: [{ type: 'print', props: { value: 'missing' } }],
              },
            ],
          },
        ],
      },
    ];

    for (const testCase of controls) {
      const nodes: IRNode[] = [
        { type: 'print', props: { value: '"before"' } },
        ...testCase.nodes,
        { type: 'return', props: { value: '1' } },
      ];
      expect(
        executeInternalRuntimeEnvelopeSync(nodes, makeEnv({ bindings: testCase.bindings }), enabled),
      ).toMatchObject({
        outcome: 'success',
        result: { presence: 'value', value: { tag: 'integer', value: '1' } },
      });
    }
  });

  test('shape-checks but does not value-evaluate known zero-iteration loop bodies', () => {
    const controls: readonly { readonly bindings?: Map<string, unknown>; readonly node: IRNode }[] = [
      {
        node: {
          type: 'for',
          props: { from: '0', name: 'index', to: '0' },
          children: [{ type: 'print', props: { value: 'missing' } }],
        },
      },
      {
        node: {
          type: 'while',
          props: { cond: 'false' },
          children: [{ type: 'print', props: { value: 'missing' } }],
        },
      },
      {
        bindings: new Map([['items', []]]),
        node: {
          type: 'each',
          props: { in: 'items', name: 'item' },
          children: [{ type: 'print', props: { value: 'missing' } }],
        },
      },
    ];

    for (const testCase of controls) {
      const nodes: IRNode[] = [
        { type: 'print', props: { value: '"before"' } },
        testCase.node,
        { type: 'return', props: { value: '1' } },
      ];
      expect(
        executeInternalRuntimeEnvelopeSync(nodes, makeEnv({ bindings: testCase.bindings }), enabled),
      ).toMatchObject({
        outcome: 'success',
        result: { presence: 'value', value: { tag: 'integer', value: '1' } },
      });
    }
  });

  test('still rejects malformed shapes and duplicate declarations in unreachable code', () => {
    const cases: readonly IRNode[][] = [
      [{ type: 'if', props: { cond: 'false' }, children: [{ type: 'print', props: { value: 'new C()' } }] }],
      [
        {
          type: 'while',
          props: { cond: 'false' },
          children: [
            { type: 'let', props: { name: 'value', value: '1' } },
            { type: 'let', props: { name: 'value', value: 'missing' } },
          ],
        },
      ],
    ];

    for (const nodes of cases) {
      expect(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
    }
  });

  test('unreachable loop effects do not reserve names or destabilize outer bindings', () => {
    const nodes: IRNode[] = [
      { type: 'let', props: { name: 'answer', value: '1' } },
      {
        type: 'while',
        props: { cond: 'false' },
        children: [
          { type: 'assign', props: { target: 'answer', value: 'missing' } },
          { type: 'capability', props: { name: 'never', namespace: 'storage', operation: 'get' } },
        ],
      },
      { type: 'let', props: { name: 'never', value: '2' } },
      { type: 'return', props: { value: 'answer + never' } },
    ];
    expect(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), enabled)).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '3' } },
    });
  });

  test('preserves valid Map reads with a deferred key', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: 'Map.get(m, late)' } },
    ];
    const env = makeEnv({
      bindings: new Map([['m', new Map([['answer', 42]])]]),
      capabilities: {
        storage: {
          get: () => {
            calls += 1;
            return 'answer';
          },
        },
      },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '42' } },
    });
    expect(calls).toBe(1);
  });

  test('rejects a known non-scalar record field masked by a deferred sibling before dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: '{x: m, y: late}' } },
    ];
    const env = makeEnv({
      bindings: new Map([['m', new Map<string, unknown>()]]),
      capabilities: { storage: { get: () => (calls += 1) } },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('normalizes malformed control expressions as unsupported before provider dispatch', () => {
    const controls: readonly IRNode[] = [
      { type: 'if', props: { cond: '(' }, children: [] },
      {
        type: 'branch',
        props: { on: '(' },
        children: [{ type: 'path', props: { default: true }, children: [] }],
      },
      { type: 'for', props: { from: '(', name: 'index', to: '1' }, children: [] },
      {
        type: 'each',
        props: { in: '(', name: 'item' },
        children: [{ type: 'print', props: { value: 'item' } }],
      },
      { type: 'while', props: { cond: '(' }, children: [] },
    ];

    for (const control of controls) {
      let calls = 0;
      const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });
      expect(
        executeInternalRuntimeEnvelopeSync(
          [{ type: 'capability', props: { namespace: 'storage', operation: 'get' } }, control],
          env,
          enabled,
        ),
      ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], events: [], outcome: 'failure' });
      expect(calls).toBe(0);
    }
  });

  test('propagates only the statically reachable if-arm state before provider dispatch', () => {
    const cases: readonly IRNode[][] = [
      [
        { type: 'if', props: { cond: 'false' }, children: [{ type: 'let', props: { name: 'answer', value: '1' } }] },
        { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value: 'answer' } },
      ],
      [
        {
          type: 'if',
          props: { cond: 'true' },
          children: [{ type: 'let', props: { name: 'items', value: '[1, 2]' } }],
        },
        { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
        { type: 'print', props: { value: 'items' } },
      ],
    ];

    for (const nodes of cases) {
      let calls = 0;
      const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });
      expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
      expect(calls).toBe(0);
    }
  });

  test('does not propagate loop-local assignment targets into outer preflight state', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'for',
        props: { from: '0', name: 'index', to: '1' },
        children: [{ type: 'assign', props: { target: 'index', value: '0' } }],
      },
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'print', props: { value: 'index[0]' } },
    ];
    const env = makeEnv({
      bindings: new Map([['index', 1]]),
      capabilities: { storage: { get: () => (calls += 1) } },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('rejects bindings that are not definite across dynamic if and try paths before dispatch', () => {
    const cases: readonly IRNode[][] = [
      [
        { type: 'capability', props: { name: 'flag', namespace: 'storage', operation: 'flag' } },
        { type: 'if', props: { cond: 'flag' }, children: [{ type: 'let', props: { name: 'value', value: '1' } }] },
        { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value: 'value' } },
      ],
      [
        {
          type: 'try',
          children: [
            { type: 'let', props: { name: 'stable', value: '1' } },
            {
              type: 'catch',
              props: { name: 'error' },
              children: [{ type: 'let', props: { name: 'value', value: '1' } }],
            },
          ],
        },
        { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value: 'value' } },
      ],
    ];

    for (const nodes of cases) {
      let calls = 0;
      const env = makeEnv({
        capabilities: {
          storage: {
            flag: () => {
              calls += 1;
              return false;
            },
            get: () => (calls += 1),
          },
        },
      });
      expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
      expect(calls).toBe(0);
    }
  });

  test('rejects a catch-only declaration from finally when the catch is not guaranteed', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'flag', namespace: 'storage', operation: 'flag' } },
      {
        type: 'try',
        children: [
          {
            type: 'if',
            props: { cond: 'flag' },
            children: [{ type: 'throw', props: { value: 'new Error("boom")' } }],
          },
          {
            type: 'catch',
            props: { name: 'error' },
            children: [{ type: 'let', props: { name: 'caughtOnly', value: '1' } }],
          },
          { type: 'finally', children: [{ type: 'print', props: { value: 'caughtOnly' } }] },
        ],
      },
    ];
    const env = makeEnv({
      capabilities: {
        storage: {
          flag: () => {
            calls += 1;
            return false;
          },
        },
      },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('rejects an outer caught-name read before a later provider when no finally exists', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [
          { type: 'throw', props: { value: 'new Error("boom")' } },
          { type: 'catch', props: { name: 'error' }, children: [] },
        ],
      },
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'print', props: { value: 'error.message' } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('rejects raw caught-error uses before an earlier body provider runs', () => {
    const invalidCatchUses: readonly IRNode[] = [
      { type: 'print', props: { value: 'error' } },
      { type: 'capability', props: { input: 'error', namespace: 'storage', operation: 'echo' } },
    ];
    for (const invalidUse of invalidCatchUses) {
      let calls = 0;
      const nodes: IRNode[] = [
        {
          type: 'try',
          children: [
            { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
            { type: 'throw', props: { value: 'new Error("boom")' } },
            { type: 'catch', props: { name: 'error' }, children: [invalidUse] },
          ],
        },
      ];
      const env = makeEnv({
        capabilities: {
          storage: {
            echo: () => (calls += 1),
            get: () => (calls += 1),
          },
        },
      });

      expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
      expect(calls).toBe(0);
    }
  });

  test('rejects a missing assign target with a deferred loop RHS before an earlier provider runs', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      {
        type: 'each',
        props: { in: 'items', name: 'item' },
        children: [{ type: 'assign', props: { target: 'missing', value: 'item' } }],
      },
    ];
    const env = makeEnv({
      bindings: new Map([['items', [1]]]),
      capabilities: { storage: { get: () => (calls += 1) } },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('rejects invalid known assign target types with a deferred loop RHS before dispatch', () => {
    const cases: readonly { readonly op?: string; readonly target: unknown }[] = [
      { target: [0] },
      { op: '+=', target: true },
    ];
    for (const testCase of cases) {
      let calls = 0;
      const nodes: IRNode[] = [
        { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
        {
          type: 'each',
          props: { in: 'items', name: 'item' },
          children: [{ type: 'assign', props: { op: testCase.op, target: 'target', value: 'item' } }],
        },
      ];
      const env = makeEnv({
        bindings: new Map<string, unknown>([
          ['items', [1]],
          ['target', testCase.target],
        ]),
        capabilities: { storage: { get: () => (calls += 1) } },
      });

      expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
      expect(calls).toBe(0);
    }
  });

  test('does not defer an out-of-scope branch-local read past capability dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'branch',
        props: { on: '"selected"' },
        children: [
          {
            type: 'path',
            props: { value: 'selected' },
            __quotedProps: ['value'],
            children: [
              { type: 'let', props: { name: 'local', value: '1' } },
              { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
            ],
          },
        ],
      },
      { type: 'print', props: { value: 'local' } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('capability input records share the complete portable forbidden-key policy', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      {
        type: 'capability',
        props: { input: '{__defineGetter__: 1}', namespace: 'storage', operation: 'get' },
      },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });
});
