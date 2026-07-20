import { executeKernSource } from '../src/runner.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';
import { classHelperEnv, helper, member } from './runtime-envelope-effect-machine-class-helper-fixtures.js';

describe('M3.31b2b2 pure class-to-helper composition', () => {
  test('owns helper calls from a constructor, method, and getter', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: member(
            'Box',
            'constructor',
            [
              { type: 'let', props: { name: 'normalized', value: 'decorate(seed)' } },
              { type: 'assign', props: { target: 'this.value', value: 'normalized' } },
            ],
            ['seed'],
          ),
          fields: [{ name: 'value' }],
          getters: new Map([
            ['current', member('Box', 'current', [{ type: 'return', props: { value: 'decorate(this.value)' } }])],
          ]),
          methods: new Map([
            [
              'read',
              member(
                'Box',
                'read',
                [{ type: 'return', props: { value: 'decorate(this.value + suffix)' } }],
                ['suffix'],
              ),
            ],
          ]),
          name: 'Box',
        },
      ],
      helpers: [helper('decorate', ['value'], [{ type: 'return', props: { value: 'value + 1' } }])],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Box(2)' } },
      { type: 'print', props: { value: 'item.current' } },
      { type: 'return', props: { value: 'item.read(3)' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    const trace = executeSourceRunnerSync(nodes, env, { policy: 'machine-only' });
    expect(trace.events.filter((event) => event.op === 'stdout')).toEqual([{ op: 'stdout', text: '4' }]);
    expect(trace.completion).toEqual({ kind: 'return', value: 7 });
  });

  test('does not replay class state or providers around an async helper call', async () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [{ name: 'visits', value: '0' }],
          getters: new Map(),
          methods: new Map([
            [
              'run',
              member('Worker', 'run', [
                { type: 'assign', props: { target: 'this.visits', value: 'this.visits + 1' } },
                {
                  type: 'capability',
                  props: { input: '{ prompt: "first" }', name: 'first', namespace: 'llm', operation: 'complete' },
                },
                { type: 'let', props: { name: 'doubled', value: 'double(first + this.visits)' } },
                {
                  type: 'capability',
                  props: { input: '{ prompt: "second" }', name: 'second', namespace: 'llm', operation: 'complete' },
                },
                { type: 'return', props: { value: 'doubled + second + this.visits' } },
              ]),
            ],
          ]),
          name: 'Worker',
        },
      ],
      helpers: [helper('double', ['value'], [{ type: 'return', props: { value: 'value * 2' } }])],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'worker', value: 'new Worker()' } },
      { type: 'return', props: { value: 'worker.run()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    const trace = await executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: {
        llm: {
          complete: async () => {
            providerCalls += 1;
            await Promise.resolve();
            return providerCalls === 1 ? 10 : 20;
          },
        },
      },
      policy: 'machine-only',
    });

    expect(trace.completion).toEqual({ kind: 'return', value: 43 });
    expect(providerCalls).toBe(2);
  });

  test('discovers helper loops reached only from a class frame', () => {
    const make = () =>
      classHelperEnv({
        classes: [
          {
            constructor: undefined,
            fields: [],
            getters: new Map(),
            methods: new Map([['sum', member('Counter', 'sum', [{ type: 'return', props: { value: 'sumThree()' } }])]]),
            name: 'Counter',
          },
        ],
        helpers: [
          helper(
            'sumThree',
            [],
            [
              { type: 'let', props: { name: 'total', value: '0' } },
              {
                type: 'for',
                props: { from: '0', name: 'index', to: '3' },
                children: [{ type: 'assign', props: { op: '+=', target: 'total', value: 'index' } }],
              },
              { type: 'return', props: { value: 'total' } },
            ],
          ),
        ],
      });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'counter', value: 'new Counter()' } },
      { type: 'return', props: { value: 'counter.sum()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, make(), {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(selectSourceRunnerEngine(nodes, make(), { iterationBudget: 3 })).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, make(), { iterationBudget: 3, policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 3,
    });
  });

  test('preflights a class-only helper edge before an earlier provider', () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([['read', member('Broken', 'read', [{ type: 'return', props: { value: 'broken()' } }])]]),
          name: 'Broken',
        },
      ],
      helpers: [helper('broken', [], [{ type: 'return', props: { value: 'missing' } }])],
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'item', value: 'new Broken()' } },
      { type: 'return', props: { value: 'item.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('keeps helper-to-class instance composition outside this slice', () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map(),
          name: 'Widget',
        },
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            ['build', member('Factory', 'build', [{ type: 'return', props: { value: 'makeWidget()' } }])],
          ]),
          name: 'Factory',
        },
      ],
      helpers: [
        helper(
          'makeWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget()' } },
            { type: 'return', props: { value: 'item' } },
          ],
          'Widget',
        ),
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'factory', value: 'new Factory()' } },
      { type: 'return', props: { value: 'factory.build()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('does not make unrelated unsupported helpers reachable', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([['read', member('Label', 'read', [{ type: 'return', props: { value: 'decorate(2)' } }])]]),
          name: 'Label',
        },
      ],
      helpers: [
        helper('decorate', ['value'], [{ type: 'return', props: { value: 'value + 1' } }]),
        helper(
          'unusedEffect',
          [],
          [
            { type: 'print', props: { value: '"unused"' } },
            { type: 'return', props: { value: '0' } },
          ],
        ),
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'label', value: 'new Label()' } },
      { type: 'return', props: { value: 'label.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 3,
    });
  });

  test('preflights inactive class branches that reach a broken helper', () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            ['read', member('Label', 'read', [{ type: 'return', props: { value: 'true ? 1 : broken()' } }])],
          ]),
          name: 'Label',
        },
      ],
      helpers: [helper('broken', [], [{ type: 'return', props: { value: 'missing' } }])],
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'label', value: 'new Label()' } },
      { type: 'return', props: { value: 'label.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test.each([
    [
      'private receiver transport',
      'identity(this)',
      [helper('identity', ['value'], [{ type: 'return', props: { value: 'value' } }])],
    ],
    [
      'wrapped private receiver transport',
      'identity(this!)',
      [helper('identity', ['value'], [{ type: 'return', props: { value: 'value' } }])],
    ],
    [
      'helper-owned class allocation',
      'makeWidget()',
      [
        helper(
          'makeWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget()' } },
            { type: 'return', props: { value: 'item' } },
          ],
          'Widget',
        ),
      ],
    ],
  ] as const)('rejects %s before provider dispatch', (_label, value, helpers) => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([['read', member('Widget', 'read', [{ type: 'return', props: { value } }])]]),
          name: 'Widget',
        },
      ],
      helpers,
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'item', value: 'new Widget()' } },
      { type: 'return', props: { value: 'item.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('isolates helper and class snapshots across overlapping async runs', async () => {
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'worker', value: 'new Worker()' } },
      { type: 'return', props: { value: 'worker.run()' } },
    ];
    const run = (suffix: string, gate: Promise<void>) =>
      executeSourceRunnerAsync(
        nodes,
        classHelperEnv({
          classes: [
            {
              constructor: undefined,
              fields: [],
              getters: new Map(),
              methods: new Map([
                [
                  'run',
                  member('Worker', 'run', [
                    {
                      type: 'capability',
                      props: { input: '{ prompt: "run" }', name: 'answer', namespace: 'llm', operation: 'complete' },
                    },
                    { type: 'return', props: { value: 'decorate(answer)' } },
                  ]),
                ],
              ]),
              name: 'Worker',
            },
          ],
          helpers: [
            helper('decorate', ['value'], [{ type: 'return', props: { value: `value + "${suffix}"` } }], 'string'),
          ],
        }),
        {
          asyncCapabilities: {
            llm: {
              complete: async () => {
                await gate;
                return 'x';
              },
            },
          },
          policy: 'machine-only',
        },
      );
    let releaseLeft!: () => void;
    let releaseRight!: () => void;
    const leftGate = new Promise<void>((resolve) => {
      releaseLeft = resolve;
    });
    const rightGate = new Promise<void>((resolve) => {
      releaseRight = resolve;
    });

    const left = run('-left', leftGate);
    const right = run('-right', rightGate);
    releaseLeft();
    releaseRight();
    const [leftTrace, rightTrace] = await Promise.all([left, right]);
    expect(leftTrace.completion).toEqual({ kind: 'return', value: 'x-left' });
    expect(rightTrace.completion).toEqual({ kind: 'return', value: 'x-right' });
  });

  test('snapshots a class-reachable helper body across async suspension', async () => {
    let entered!: () => void;
    let release!: () => void;
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
              member('Worker', 'read', [
                { type: 'capability', props: { name: 'answer', namespace: 'llm', operation: 'complete' } },
                { type: 'return', props: { value: 'decorate(answer)' } },
              ]),
            ],
          ]),
          name: 'Worker',
        },
      ],
      helpers: [helper('decorate', ['value'], [{ type: 'return', props: { value: 'value + "-old"' } }], 'string')],
    });
    const pending = executeSourceRunnerAsync(
      [
        { type: 'let', props: { name: 'worker', value: 'new Worker()' } },
        { type: 'return', props: { value: 'worker.read()' } },
      ],
      env,
      {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              entered();
              await providerRelease;
              return 'x';
            },
          },
        },
        policy: 'machine-only',
      },
    );
    await providerEntered;
    const helperBody = env.runnerFunctions?.get('decorate')?.body[0].props as Record<string, unknown>;
    helperBody.value = 'value + "-new"';
    release();

    await expect(pending).resolves.toEqual(expect.objectContaining({ completion: { kind: 'return', value: 'x-old' } }));
  });

  test('owns the linked public source path for pure class-to-helper calls', () => {
    const source = [
      'fn name=decorate returns=number',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    return value="value + 1"',
      'class name=Box',
      '  field name=value type=number',
      '  constructor',
      '    param name=seed type=number',
      '    handler lang="kern"',
      '      let name=normalized value="decorate(seed)"',
      '      assign target="this.value" value="normalized"',
      '  method name=read returns=number',
      '    handler lang="kern"',
      '      return value="decorate(this.value)"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=item value="new Box(2)"',
      '    print value="item.read()"',
    ].join('\n');

    expect(executeKernSource(source)).toBe('4\n');
  });
});
