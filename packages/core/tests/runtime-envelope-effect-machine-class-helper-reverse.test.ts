import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';
import { classHelperEnv, helper, member } from './runtime-envelope-effect-machine-class-helper-fixtures.js';

function pureReverseEnv(
  helpers = [
    helper(
      'summarize',
      ['seed'],
      [
        { type: 'let', props: { name: 'item', value: 'new Widget(seed)' } },
        { type: 'let', props: { name: 'field', value: 'item.value' } },
        { type: 'let', props: { name: 'doubled', value: 'item.doubled' } },
        { type: 'let', props: { name: 'added', value: 'item.add(3)' } },
        { type: 'let', props: { name: 'total', value: 'field + doubled + added' } },
        { type: 'return', props: { value: 'total' } },
      ],
    ),
  ],
) {
  return classHelperEnv({
    classes: [
      {
        constructor: member(
          'Widget',
          'constructor',
          [{ type: 'assign', props: { target: 'this.value', value: 'seed' } }],
          ['seed'],
        ),
        fields: [{ name: 'value' }],
        getters: new Map([
          ['doubled', member('Widget', 'doubled', [{ type: 'return', props: { value: 'this.value * 2' } }])],
        ]),
        methods: new Map([
          ['add', member('Widget', 'add', [{ type: 'return', props: { value: 'this.value + amount' } }], ['amount'])],
        ]),
        name: 'Widget',
      },
    ],
    helpers,
  });
}

describe('M3.31b2b3 pure helper-to-class composition', () => {
  test('owns helper-local construction, field/getter reads, and method calls', () => {
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'summarize(4)' } }];

    expect(selectSourceRunnerEngine(nodes, pureReverseEnv(), {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, pureReverseEnv(), { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 19,
    });
  });

  test('accepts a scalar class method as the direct helper return', () => {
    const env = pureReverseEnv([
      helper(
        'inlineRead',
        ['seed'],
        [
          { type: 'let', props: { name: 'item', value: 'new Widget(seed)' } },
          { type: 'return', props: { value: 'item.add(2)' } },
        ],
      ),
    ]);
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'inlineRead(4)' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 6,
    });
  });

  test('keeps helper-created instances inside the helper invocation', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map(),
          name: 'Widget',
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
    const nodes: readonly IRNode[] = [{ type: 'let', props: { name: 'item', value: 'makeWidget()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
  });

  test('owns a helper-reached effectful class after an earlier provider', () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
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
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: 'readRemote()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 2,
    });
    expect(providerCalls).toBe(2);
  });

  test('does not reject an unused effectful member on the constructed class', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [{ name: 'value', value: '4' }],
          getters: new Map(),
          methods: new Map([
            ['local', member('MixedWidget', 'local', [{ type: 'return', props: { value: 'this.value + 1' } }])],
            [
              'remote',
              member('MixedWidget', 'remote', [
                { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
                { type: 'return', props: { value: 'answer' } },
              ]),
            ],
          ]),
          name: 'MixedWidget',
        },
      ],
      helpers: [
        helper(
          'readLocal',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new MixedWidget()' } },
            { type: 'return', props: { value: 'item.local()' } },
          ],
        ),
      ],
    });
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'readLocal()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 5,
    });
  });

  test('owns an indirectly reached effectful member', () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            ['read', member('RemoteWidget', 'read', [{ type: 'return', props: { value: 'this.remote()' } }])],
            [
              'remote',
              member('RemoteWidget', 'remote', [
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
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: 'readRemote()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 2,
    });
    expect(providerCalls).toBe(2);
  });

  test('preserves inherited virtual and super dispatch inside a helper', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: member(
            'BaseWidget',
            'constructor',
            [{ type: 'assign', props: { target: 'this.value', value: 'seed' } }],
            ['seed'],
          ),
          fields: [{ name: 'value' }],
          getters: new Map(),
          methods: new Map([
            ['score', member('BaseWidget', 'score', [{ type: 'return', props: { value: 'this.value + 1' } }])],
          ]),
          name: 'BaseWidget',
        },
        {
          constructor: member(
            'DerivedWidget',
            'constructor',
            [{ type: 'do', props: { value: 'super(seed)' } }],
            ['seed'],
          ),
          extendsName: 'BaseWidget',
          fields: [],
          getters: new Map(),
          methods: new Map([
            ['score', member('DerivedWidget', 'score', [{ type: 'return', props: { value: 'super.score() + 10' } }])],
          ]),
          name: 'DerivedWidget',
        },
      ],
      helpers: [
        helper(
          'score',
          ['seed'],
          [
            { type: 'let', props: { name: 'item', value: 'new DerivedWidget(seed)' } },
            { type: 'return', props: { value: 'item.score()' } },
          ],
        ),
      ],
    });
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'score(4)' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 15,
    });
  });

  test('rejects helper-local instance transport into a nested helper', () => {
    const env = pureReverseEnv([
      helper('identity', ['value'], [{ type: 'return', props: { value: 'value' } }]),
      helper(
        'transport',
        [],
        [
          { type: 'let', props: { name: 'item', value: 'new Widget(1)' } },
          { type: 'return', props: { value: 'identity(item)' } },
        ],
      ),
    ]);
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'transport()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
  });

  test('uses frozen class members after an earlier async suspension', async () => {
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
            ['read', member('Widget', 'read', [{ type: 'return', props: { value: 'suffix + "-old"' } }], ['suffix'])],
          ]),
          name: 'Widget',
        },
      ],
      helpers: [
        helper(
          'readWidget',
          ['suffix'],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget()' } },
            { type: 'return', props: { value: 'item.read(suffix)' } },
          ],
          'string',
        ),
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { name: 'answer', namespace: 'llm', operation: 'complete' } },
      { type: 'return', props: { value: 'readWidget(answer)' } },
    ];
    const pending = executeSourceRunnerAsync(nodes, env, {
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
    });

    await providerEntered;
    const body = env.runnerClasses?.get('Widget')?.methods.get('read')?.body[0].props as Record<string, unknown>;
    body.value = 'suffix + "-new"';
    release();

    await expect(pending).resolves.toEqual(expect.objectContaining({ completion: { kind: 'return', value: 'x-old' } }));
  });
});
