import {
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';
import { classHelperEnv, helper, member } from './runtime-envelope-effect-machine-class-helper-fixtures.js';

describe('M3.31b2b2 portable class-helper arguments', () => {
  test('owns array and record arguments passed from a class frame', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            [
              'read',
              member('Reader', 'read', [{ type: 'return', props: { value: 'first([2, 3]) + field({ value: 4 })' } }]),
            ],
          ]),
          name: 'Reader',
        },
      ],
      helpers: [
        helper('first', ['values'], [{ type: 'return', props: { value: 'values[0]' } }]),
        helper('field', ['record'], [{ type: 'return', props: { value: 'record.value' } }]),
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'reader', value: 'new Reader()' } },
      { type: 'return', props: { value: 'reader.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 6,
    });
  });

  test('owns a record returned by a nested helper argument from a class frame', () => {
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            [
              'read',
              member('Reader', 'read', [{ type: 'return', props: { value: 'questionText(makeQuery("refund"))' } }]),
            ],
          ]),
          name: 'Reader',
        },
      ],
      helpers: [
        helper('makeQuery', ['question'], [{ type: 'return', props: { value: '{ question: question }' } }], 'Query'),
        helper('questionText', ['query'], [{ type: 'return', props: { value: 'query.question' } }], 'string'),
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'reader', value: 'new Reader()' } },
      { type: 'return', props: { value: 'reader.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 'refund',
    });
  });

  test.each(['any', 'number'])(
    'rejects a composite helper return from a scalar class frame (%s contract)',
    (returns) => {
      let providerCalls = 0;
      const env = classHelperEnv({
        capabilities: { storage: { get: () => ++providerCalls } },
        classes: [
          {
            constructor: undefined,
            fields: [],
            getters: new Map(),
            methods: new Map([
              ['read', member('Reader', 'read', [{ type: 'return', props: { value: 'makeItems()' } }])],
            ]),
            name: 'Reader',
          },
        ],
        helpers: [helper('makeItems', [], [{ type: 'return', props: { value: '[1]' } }], returns)],
      });
      const nodes: readonly IRNode[] = [
        { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
        { type: 'let', props: { name: 'reader', value: 'new Reader()' } },
        { type: 'return', props: { value: 'reader.read()' } },
      ];

      expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
      expect(() => executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })).toThrow();
      expect(providerCalls).toBe(0);
    },
  );
});
