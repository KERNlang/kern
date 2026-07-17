import {
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';
import { classHelperEnv, helper, member } from './runtime-envelope-effect-machine-class-helper-fixtures.js';

const providerThen = (value: string): readonly IRNode[] => [
  { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
  { type: 'return', props: { value } },
];

describe('M3.31b2b3 reverse helper/class containment', () => {
  test('accepts a pure helper-local class scalar as a method argument', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [{ name: 'value', value: '2' }],
          getters: new Map(),
          methods: new Map([
            ['add', member('Widget', 'add', [{ type: 'return', props: { value: 'this.value + amount' } }], ['amount'])],
          ]),
          name: 'Widget',
        },
      ],
      helpers: [
        helper(
          'readWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget()' } },
            { type: 'return', props: { value: 'item.add(item.value)' } },
          ],
        ),
      ],
    });
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'readWidget()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 4,
    });
  });

  test.each([
    ['reassignment', { type: 'assign', props: { target: 'item', value: '1' } }],
    ['let shadowing', { type: 'let', props: { name: 'item', value: '1' } }],
  ] as const)('rejects helper-local class binding %s before provider dispatch', (_label, replacement) => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: undefined,
          fields: [{ name: 'value', value: '2' }],
          getters: new Map(),
          methods: new Map(),
          name: 'Widget',
        },
      ],
      helpers: [
        helper(
          'readWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget()' } },
            replacement,
            { type: 'return', props: { value: 'item.value' } },
          ],
        ),
      ],
    });
    const nodes = providerThen('readWidget()');

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('rejects helper-local class binding loop shadowing before provider dispatch', () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: undefined,
          fields: [{ name: 'value', value: '2' }],
          getters: new Map(),
          methods: new Map(),
          name: 'Widget',
        },
      ],
      helpers: [
        helper(
          'readWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget()' } },
            {
              type: 'each',
              props: { in: '[1]', name: 'item' },
              children: [{ type: 'return', props: { value: 'item.value' } }],
            },
            { type: 'return', props: { value: '0' } },
          ],
        ),
      ],
    });
    const nodes = providerThen('readWidget()');
    const options = { iterationBudget: 4 };

    expect(selectSourceRunnerEngine(nodes, env, options)).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { ...options, policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('owns an effectful getter reached through this', () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map([
            [
              'remote',
              member('Widget', 'remote', [
                {
                  type: 'capability',
                  props: {
                    name: 'answer',
                    namespace: 'storage',
                    operation: 'get',
                  },
                },
                { type: 'return', props: { value: 'answer' } },
              ]),
            ],
          ]),
          methods: new Map([['read', member('Widget', 'read', [{ type: 'return', props: { value: 'this.remote' } }])]]),
          name: 'Widget',
        },
      ],
      helpers: [
        helper(
          'readWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget()' } },
            { type: 'return', props: { value: 'item.read()' } },
          ],
        ),
      ],
    });
    const nodes = providerThen('readWidget()');

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 2,
    });
    expect(providerCalls).toBe(2);
  });

  test('rejects this passed from a class method into a helper', () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            ['read', member('Widget', 'read', [{ type: 'return', props: { value: 'identity(this)' } }])],
          ]),
          name: 'Widget',
        },
      ],
      helpers: [
        helper('identity', ['value'], [{ type: 'return', props: { value: 'value' } }]),
        helper(
          'readWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget()' } },
            { type: 'return', props: { value: 'item.read()' } },
          ],
        ),
      ],
    });
    const nodes = providerThen('readWidget()');

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('rejects this passed between class methods', () => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            ['consume', member('Widget', 'consume', [{ type: 'return', props: { value: '1' } }], ['value'])],
            ['read', member('Widget', 'read', [{ type: 'return', props: { value: 'this.consume(this)' } }])],
          ]),
          name: 'Widget',
        },
      ],
      helpers: [
        helper(
          'readWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget()' } },
            { type: 'return', props: { value: 'item.read()' } },
          ],
        ),
      ],
    });
    const nodes = providerThen('readWidget()');

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test.each([
    ['constructor', 'new Widget(() => 1)', 'item.value'],
    ['method', 'new Widget(1)', 'item.consume(() => 1)'],
  ])('rejects a non-scalar %s argument before provider dispatch', (_label, construction, result) => {
    let providerCalls = 0;
    const env = classHelperEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      classes: [
        {
          constructor: member(
            'Widget',
            'constructor',
            [
              {
                type: 'assign',
                props: { target: 'this.value', value: 'value' },
              },
            ],
            ['value'],
          ),
          fields: [{ name: 'value' }],
          getters: new Map(),
          methods: new Map([
            ['consume', member('Widget', 'consume', [{ type: 'return', props: { value: '1' } }], ['value'])],
          ]),
          name: 'Widget',
        },
      ],
      helpers: [
        helper(
          'readWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: construction } },
            { type: 'return', props: { value: result } },
          ],
        ),
      ],
    });
    const nodes = providerThen('readWidget()');

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('rejects parenthesisless class construction before provider dispatch', () => {
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
      ],
      helpers: [
        helper(
          'readWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget' } },
            { type: 'return', props: { value: '1' } },
          ],
        ),
      ],
    });
    const nodes = providerThen('readWidget()');

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(0);
  });

  test('validates the complete scalar return around a class member', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [{ name: 'value', value: '1' }],
          getters: new Map(),
          methods: new Map(),
          name: 'Widget',
        },
      ],
      helpers: [
        helper(
          'readWidget',
          [],
          [
            { type: 'let', props: { name: 'item', value: 'new Widget()' } },
            { type: 'return', props: { value: 'item.value + (() => 1)' } },
          ],
        ),
      ],
    });
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'readWidget()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
  });
});
