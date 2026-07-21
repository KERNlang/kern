import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';
import { classHelperEnv, helper, member } from './runtime-envelope-effect-machine-class-helper-fixtures.js';

function remoteMethodEnv(provider: () => number, additionalHelpers: readonly ReturnType<typeof helper>[] = []) {
  return classHelperEnv({
    capabilities: { storage: { get: provider } },
    classes: [
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          [
            'read',
            member('RemoteWidget', 'read', [
              { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
              { type: 'return', props: { value: 'answer' } },
            ]),
          ],
        ]),
        name: 'RemoteWidget',
      },
    ],
    helpers: [
      helper(
        'readRemote',
        [],
        [
          { type: 'let', props: { name: 'item', value: 'new RemoteWidget()' } },
          { type: 'return', props: { value: 'item.read()' } },
        ],
      ),
      ...additionalHelpers,
    ],
  });
}

describe('M3.31b2c2 resumable helper-to-class effects', () => {
  test('owns a capability reached through a helper-local class method', () => {
    let providerCalls = 0;
    const env = remoteMethodEnv(() => {
      providerCalls += 1;
      return 7;
    });
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'readRemote() + 1' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    const trace = executeSourceRunnerSync(nodes, env, { policy: 'machine-only' });

    expect(trace.completion).toEqual({ kind: 'return', value: 8 });
    expect(trace.events.map((event) => event.op)).toEqual(['capability']);
    expect(providerCalls).toBe(1);
  });

  test('resumes an effectful constructor and getter in authored order', () => {
    const providerValues = [2, 3];
    const providerCalls: number[] = [];
    const env = classHelperEnv({
      capabilities: {
        storage: {
          get: () => {
            const value = providerValues[providerCalls.length];
            providerCalls.push(value);
            return value;
          },
        },
      },
      classes: [
        {
          constructor: member('RemoteWidget', 'constructor', [
            { type: 'capability', props: { name: 'seed', namespace: 'storage', operation: 'get' } },
            { type: 'assign', props: { target: 'this.value', value: 'seed' } },
          ]),
          fields: [{ name: 'value' }],
          getters: new Map([
            [
              'total',
              member('RemoteWidget', 'total', [
                { type: 'capability', props: { name: 'bonus', namespace: 'storage', operation: 'get' } },
                { type: 'return', props: { value: 'this.value + bonus' } },
              ]),
            ],
          ]),
          methods: new Map(),
          name: 'RemoteWidget',
        },
      ],
      helpers: [
        helper(
          'readRemote',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new RemoteWidget()' } },
            { type: 'return', props: { value: 'item.total' } },
          ],
        ),
      ],
    });
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'readRemote()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    const trace = executeSourceRunnerSync(nodes, env, { policy: 'machine-only' });

    expect(trace.completion).toEqual({ kind: 'return', value: 5 });
    expect(trace.events.map((event) => event.op)).toEqual(['capability', 'capability']);
    expect(providerCalls).toEqual([2, 3]);
  });

  test('propagates resumability through a wrapper and nested helper argument', () => {
    let providerCalls = 0;
    const env = remoteMethodEnv(() => {
      providerCalls += 1;
      return 5;
    }, [
      helper('decorate', ['value'], [{ type: 'return', props: { value: 'value + 10' } }]),
      helper('wrappedRemote', [], [{ type: 'return', props: { value: 'decorate(readRemote())' } }]),
    ]);
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'wrappedRemote()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 15,
    });
    expect(providerCalls).toBe(1);
  });

  test.each([
    {
      bodyValue: 'values[0]',
      expression: 'first([readRemote(), 3])',
      helperName: 'first',
      paramName: 'values',
    },
    {
      bodyValue: 'record.values[0]',
      expression: 'field({ values: [readRemote(), 4] })',
      helperName: 'field',
      paramName: 'record',
    },
  ])(
    'resumes helper descendants inside composite argument: $helperName',
    ({ bodyValue, expression, helperName, paramName }) => {
      let providerCalls = 0;
      const env = remoteMethodEnv(() => {
        providerCalls += 1;
        return 5;
      }, [helper(helperName, [paramName], [{ type: 'return', props: { value: bodyValue } }])]);
      const nodes: readonly IRNode[] = [{ type: 'return', props: { value: expression } }];

      expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
      expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
        kind: 'return',
        value: 5,
      });
      expect(providerCalls).toBe(1);
    },
  );

  test('never memoizes observable helper/class effects', () => {
    let providerCalls = 0;
    const env = remoteMethodEnv(() => {
      providerCalls += 1;
      return providerCalls;
    });
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'readRemote() + readRemote()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 3,
    });
    expect(providerCalls).toBe(2);
  });

  test('never memoizes helper-local class prints or leaks private trace events', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            [
              'show',
              member('Printer', 'show', [
                { type: 'let', props: { name: 'privateValue', value: '2' } },
                { type: 'print', props: { value: 'privateValue' } },
                { type: 'return', props: { value: 'privateValue' } },
              ]),
            ],
          ]),
          name: 'Printer',
        },
      ],
      helpers: [
        helper(
          'show',
          [],
          [
            { type: 'let', props: { name: 'printer', value: 'new Printer()' } },
            { type: 'return', props: { value: 'printer.show()' } },
          ],
        ),
      ],
    });
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'show() + show()' } }];

    const trace = executeSourceRunnerSync(nodes, env, { policy: 'machine-only' });

    expect(trace.completion).toEqual({ kind: 'return', value: 4 });
    expect(trace.events).toEqual([
      { op: 'stdout', text: '2' },
      { op: 'stdout', text: '2' },
    ]);
  });

  test('retains safe memoization for event-free class composition', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            [
              'count',
              member('Counter', 'count', [
                { type: 'let', props: { name: 'total', value: '0' } },
                {
                  type: 'for',
                  props: { from: '0', name: 'index', to: '1' },
                  children: [{ type: 'assign', props: { op: '+=', target: 'total', value: '1' } }],
                },
                { type: 'return', props: { value: 'total' } },
              ]),
            ],
          ]),
          name: 'Counter',
        },
      ],
      helpers: [
        helper(
          'countOnce',
          [],
          [
            { type: 'let', props: { name: 'counter', value: 'new Counter()' } },
            { type: 'return', props: { value: 'counter.count()' } },
          ],
        ),
      ],
    });
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'countOnce() + countOnce()' } }];
    const options = { iterationBudget: 1 };

    expect(selectSourceRunnerEngine(nodes, env, options)).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { ...options, policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 2,
    });
  });

  test('keeps direct helper effects outside the language before provider dispatch', () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [],
      helpers: [
        helper(
          'directEffect',
          [],
          [
            { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
            { type: 'return', props: { value: 'answer' } },
          ],
        ),
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: 'directEffect()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('freezes helper and class bodies across an owned async suspension', async () => {
    let entered!: () => void;
    let release!: () => void;
    let providerCalls = 0;
    const providerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            [
              'read',
              member('RemoteWidget', 'read', [
                { type: 'capability', props: { name: 'answer', namespace: 'llm', operation: 'complete' } },
                { type: 'return', props: { value: 'answer + "-old"' } },
              ]),
            ],
          ]),
          name: 'RemoteWidget',
        },
      ],
      helpers: [
        helper(
          'readRemote',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new RemoteWidget()' } },
            { type: 'return', props: { value: 'item.read()' } },
          ],
          'string',
        ),
      ],
    });
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'readRemote()' } }];
    const pending = executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: {
        llm: {
          complete: async () => {
            providerCalls += 1;
            entered();
            await providerRelease;
            return 'answer';
          },
        },
      },
      policy: 'machine-only',
    });

    await providerEntered;
    const methodBody = env.runnerClasses?.get('RemoteWidget')?.methods.get('read')?.body;
    if (methodBody?.[1]?.props) methodBody[1].props.value = 'answer + "-new"';
    const helperBody = env.runnerFunctions?.get('readRemote')?.body;
    if (helperBody?.[1]?.props) helperBody[1].props.value = '"mutated"';
    release();

    await expect(pending).resolves.toEqual(
      expect.objectContaining({ completion: { kind: 'return', value: 'answer-old' } }),
    );
    expect(providerCalls).toBe(1);
  });

  test('isolates overlapping helper/class continuations on one environment', async () => {
    const releases = new Map<string, () => void>();
    const gates = new Map<string, Promise<void>>();
    for (const name of ['a', 'b']) {
      gates.set(
        name,
        new Promise<void>((resolve) => {
          releases.set(name, resolve);
        }),
      );
    }
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            [
              'read',
              member(
                'RemoteWidget',
                'read',
                [
                  {
                    type: 'capability',
                    props: {
                      input: '{ prompt: value }',
                      name: 'answer',
                      namespace: 'llm',
                      operation: 'complete',
                    },
                  },
                  { type: 'return', props: { value: 'answer' } },
                ],
                ['value'],
              ),
            ],
          ]),
          name: 'RemoteWidget',
        },
      ],
      helpers: [
        helper(
          'readRemote',
          ['value'],
          [
            { type: 'let', props: { name: 'item', value: 'new RemoteWidget()' } },
            { type: 'return', props: { value: 'item.read(value)' } },
          ],
          'string',
        ),
      ],
    });
    const options = {
      asyncCapabilities: {
        llm: {
          complete: async ({ input }: { input: unknown }) => {
            const prompt = (input as { prompt: string }).prompt;
            await gates.get(prompt);
            return prompt;
          },
        },
      },
      policy: 'machine-only' as const,
    };
    const first = executeSourceRunnerAsync([{ type: 'return', props: { value: 'readRemote("a")' } }], env, options);
    const second = executeSourceRunnerAsync([{ type: 'return', props: { value: 'readRemote("b")' } }], env, options);

    releases.get('b')?.();
    releases.get('a')?.();

    await expect(first).resolves.toEqual(expect.objectContaining({ completion: { kind: 'return', value: 'a' } }));
    await expect(second).resolves.toEqual(expect.objectContaining({ completion: { kind: 'return', value: 'b' } }));
  });
});
