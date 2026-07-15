import { markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import { makeEnv, type RunnerModuleScope, type SemanticEnv } from '../src/ir/semantics/semantic-env.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';

function sameRootHelperEnv(
  helpers: ReadonlyArray<{
    readonly body: readonly IRNode[];
    readonly name: string;
    readonly params?: readonly string[];
    readonly returns?: unknown;
  }>,
  overrides: Partial<SemanticEnv> = {},
  options: { readonly omitRunnerClasses?: boolean } = {},
): SemanticEnv {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  for (const helper of helpers) {
    functions.set(helper.name, {
      body: helper.body,
      module: scope,
      name: helper.name,
      params: helper.params ?? [],
      returns: helper.returns ?? 'number',
    });
  }
  markRunnerMachineRootScope(scope);
  return makeEnv({
    ...overrides,
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: options.omitRunnerClasses ? undefined : classes,
    runnerFunctions: functions,
  });
}

describe('M3.24 same-root helper machine ownership', () => {
  test('selects and executes a same-root pure scalar helper on the machine', () => {
    const nodes: readonly IRNode[] = [{ type: 'print', props: { value: 'addOne(2)' } }];
    const env = () =>
      sameRootHelperEnv([
        {
          body: [{ type: 'return', props: { value: 'x + 1' } }],
          name: 'addOne',
          params: ['x'],
        },
      ]);

    expect(selectSourceRunnerEngine(nodes, env(), {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env(), { policy: 'machine-only' })).toEqual({
      completion: { kind: 'normal' },
      events: [{ op: 'stdout', text: '3' }],
    });
  });

  test('accepts the linker-owned empty class scope when its environment view is omitted', () => {
    const nodes: readonly IRNode[] = [{ type: 'print', props: { value: 'identity(2)' } }];
    const env = sameRootHelperEnv(
      [{ body: [{ type: 'return', props: { value: 'value' } }], name: 'identity', params: ['value'] }],
      {},
      { omitRunnerClasses: true },
    );

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).events).toEqual([
      { op: 'stdout', text: '2' },
    ]);
  });

  test('preflights a reachable helper body before an earlier provider effect', () => {
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'print', props: { value: 'broken()' } },
    ];
    const env = sameRootHelperEnv([{ body: [{ type: 'return', props: { value: 'missing' } }], name: 'broken' }], {
      capabilities: { storage: { get: () => ++providerCalls } },
    });

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('does not let a valid helper weaken root fail-closed structure errors', () => {
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'do', props: { value: 'arbitraryEffect()' } },
      { type: 'print', props: { value: 'identity(1)' } },
    ];
    const env = sameRootHelperEnv(
      [{ body: [{ type: 'return', props: { value: 'value' } }], name: 'identity', params: ['value'] }],
      { capabilities: { storage: { get: () => ++providerCalls } } },
    );

    expect(() => selectSourceRunnerEngine(nodes, env, {})).toThrow();
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'compatible' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('discovers helper loops and consumes the caller-owned iteration budget', () => {
    const nodes: readonly IRNode[] = [{ type: 'print', props: { value: 'sumThree()' } }];
    const env = () =>
      sameRootHelperEnv([
        {
          body: [
            { type: 'let', props: { name: 'total', value: '0' } },
            {
              type: 'for',
              props: { from: '0', name: 'i', to: '3' },
              children: [{ type: 'assign', props: { op: '+=', target: 'total', value: 'i' } }],
            },
            { type: 'return', props: { value: 'total' } },
          ],
          name: 'sumThree',
        },
      ]);

    expect(selectSourceRunnerEngine(nodes, env(), {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(selectSourceRunnerEngine(nodes, env(), { iterationBudget: 3 })).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env(), { iterationBudget: 3, policy: 'machine-only' })).toEqual({
      completion: { kind: 'normal' },
      events: [{ op: 'stdout', text: '3' }],
    });
  });

  test('preserves direct and mutual recursion through the 512-call contract', () => {
    const directNodes: readonly IRNode[] = [{ type: 'print', props: { value: 'countdown(511)' } }];
    const directEnv = sameRootHelperEnv([
      {
        body: [
          { type: 'if', props: { cond: 'n <= 0' }, children: [{ type: 'return', props: { value: '0' } }] },
          { type: 'return', props: { value: '1 + countdown(n - 1)' } },
        ],
        name: 'countdown',
        params: ['n'],
      },
    ]);
    expect(selectSourceRunnerEngine(directNodes, directEnv, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(directNodes, directEnv, { policy: 'machine-only' }).events).toEqual([
      { op: 'stdout', text: '511' },
    ]);

    const mutualNodes: readonly IRNode[] = [{ type: 'print', props: { value: 'isEven(10)' } }];
    const mutualEnv = sameRootHelperEnv([
      {
        body: [
          { type: 'if', props: { cond: 'n == 0' }, children: [{ type: 'return', props: { value: 'true' } }] },
          { type: 'return', props: { value: 'isOdd(n - 1)' } },
        ],
        name: 'isEven',
        params: ['n'],
        returns: 'boolean',
      },
      {
        body: [
          { type: 'if', props: { cond: 'n == 0' }, children: [{ type: 'return', props: { value: 'false' } }] },
          { type: 'return', props: { value: 'isEven(n - 1)' } },
        ],
        name: 'isOdd',
        params: ['n'],
        returns: 'boolean',
      },
    ]);
    expect(executeSourceRunnerSync(mutualNodes, mutualEnv, { policy: 'machine-only' }).events).toEqual([
      { op: 'stdout', text: 'true' },
    ]);
  });

  test('keeps composite helper arguments and returns inside the machine domain', () => {
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'profile', value: 'makeProfile()' } },
      { type: 'let', props: { name: 'labels', value: 'makeLabels()' } },
      { type: 'print', props: { value: 'profile.name' } },
      { type: 'print', props: { value: 'first(labels)' } },
    ];
    const env = sameRootHelperEnv([
      { body: [{ type: 'return', props: { value: '{ name: "Ada" }' } }], name: 'makeProfile', returns: 'any' },
      { body: [{ type: 'return', props: { value: '["alpha"]' } }], name: 'makeLabels', returns: 'any' },
      {
        body: [{ type: 'return', props: { value: 'values[0]' } }],
        name: 'first',
        params: ['values'],
        returns: 'string',
      },
    ]);

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).events).toEqual([
      { op: 'assign', target: 'profile', value: { name: 'Ada' } },
      { op: 'assign', target: 'labels', value: ['alpha'] },
      { op: 'stdout', text: 'Ada' },
      { op: 'stdout', text: 'alpha' },
    ]);
  });

  test('isolates identical helper names across concurrent async runs', async () => {
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: { input: 'decorate("x")', name: 'answer', namespace: 'llm', operation: 'complete' },
      },
      { type: 'return', props: { value: 'answer' } },
    ];
    const run = (suffix: string) =>
      executeSourceRunnerAsync(
        nodes,
        sameRootHelperEnv([
          {
            body: [{ type: 'return', props: { value: `value + "${suffix}"` } }],
            name: 'decorate',
            params: ['value'],
            returns: 'string',
          },
        ]),
        {
          asyncCapabilities: { llm: { complete: async ({ input }) => input } },
          policy: 'machine-only',
        },
      );

    const [left, right] = await Promise.all([run('-left'), run('-right')]);
    expect(left.completion).toEqual({ kind: 'return', value: 'x-left' });
    expect(right.completion).toEqual({ kind: 'return', value: 'x-right' });
  });

  test('passes composite helper returns to capability providers without scalar narrowing', () => {
    const inputs: unknown[] = [];
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: { input: 'makePayload()', namespace: 'storage', operation: 'put' },
      },
      {
        type: 'capability',
        props: { input: 'makeItems()', namespace: 'storage', operation: 'put' },
      },
    ];
    const env = sameRootHelperEnv(
      [
        {
          body: [{ type: 'return', props: { value: '{ answer: 42 }' } }],
          name: 'makePayload',
          returns: 'any',
        },
        {
          body: [{ type: 'return', props: { value: '["alpha", "beta"]' } }],
          name: 'makeItems',
          returns: 'any',
        },
      ],
      {
        capabilities: {
          storage: {
            put: ({ input }) => {
              inputs.push(input);
              return undefined;
            },
          },
        },
      },
    );

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    executeSourceRunnerSync(nodes, env, { policy: 'machine-only' });
    expect(inputs).toEqual([{ answer: 42 }, ['alpha', 'beta']]);
  });

  test('charges nested helper loop iterations exactly once across trampoline replay', () => {
    const nodes: readonly IRNode[] = [{ type: 'print', props: { value: 'sumTwo()' } }];
    const env = sameRootHelperEnv([
      {
        body: [
          { type: 'let', props: { name: 'total', value: '0' } },
          {
            type: 'for',
            props: { from: '0', name: 'i', to: '2' },
            children: [{ type: 'assign', props: { op: '+=', target: 'total', value: 'identity(i)' } }],
          },
          { type: 'return', props: { value: 'total' } },
        ],
        name: 'sumTwo',
      },
      {
        body: [{ type: 'return', props: { value: 'value' } }],
        name: 'identity',
        params: ['value'],
      },
    ]);

    expect(selectSourceRunnerEngine(nodes, env, { iterationBudget: 2 })).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { iterationBudget: 2, policy: 'machine-only' }).events).toEqual([
      { op: 'stdout', text: '1' },
    ]);
  });

  test('ignores unreachable unsupported helpers and routes reachable ones to compatibility', () => {
    const unsupported = {
      body: [
        { type: 'print', props: { value: '"legacy"' } },
        { type: 'return', props: { value: '1' } },
      ],
      name: 'effectful',
    } as const;
    const env = () => sameRootHelperEnv([unsupported]);

    expect(selectSourceRunnerEngine([{ type: 'print', props: { value: '1' } }], env(), {})).toBe(
      SOURCE_RUNNER_ENGINE.machine,
    );
    expect(selectSourceRunnerEngine([{ type: 'print', props: { value: 'effectful()' } }], env(), {})).toBe(
      SOURCE_RUNNER_ENGINE.legacy,
    );
  });

  test('admits pure branch helpers without treating quoted path labels as call edges', () => {
    const nodes: readonly IRNode[] = [{ type: 'print', props: { value: 'pick("effectful()")' } }];
    const env = sameRootHelperEnv([
      {
        body: [
          {
            type: 'branch',
            props: { on: 'kind' },
            children: [
              {
                type: 'path',
                props: { value: 'effectful()' },
                __quotedProps: ['value'],
                children: [{ type: 'return', props: { value: '1' } }],
              },
              {
                type: 'path',
                props: { default: true },
                children: [{ type: 'return', props: { value: '0' } }],
              },
            ],
          },
        ],
        name: 'pick',
        params: ['kind'],
      },
      {
        body: [
          { type: 'print', props: { value: '"legacy"' } },
          { type: 'return', props: { value: '9' } },
        ],
        name: 'effectful',
      },
    ]);

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).events).toEqual([
      { op: 'stdout', text: '1' },
    ]);
  });
});
