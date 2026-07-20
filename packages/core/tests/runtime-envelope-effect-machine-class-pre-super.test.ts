import { internalEffectMachineStateForEnv } from '../src/ir/semantics/internal-effect-machine-helper-state.js';
import { executeKernSource } from '../src/runner.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';
import { classMember, preSuperEnv } from './runtime-envelope-effect-machine-class-pre-super-fixtures.js';

describe('M3.31b2c1 pre-super constructor execution', () => {
  test('evaluates a pre-super local chain before the super arguments', () => {
    const env = preSuperEnv([
      {
        constructor: classMember(
          'Base',
          'constructor',
          ['value'],
          [{ type: 'assign', props: { target: 'this.value', value: 'value' } }],
        ),
        fields: [{ name: 'value', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: classMember(
          'Derived',
          'constructor',
          ['value'],
          [
            { type: 'let', props: { name: 'adjusted', value: 'value + 2' } },
            { type: 'let', props: { name: 'scaled', value: 'adjusted * 3' } },
            { type: 'do', props: { value: 'super(scaled)' } },
          ],
        ),
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived(2)' } },
      { type: 'return', props: { value: 'item.value' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 12,
    });
  });

  test('owns linked public source with a pre-super local', () => {
    const source = [
      'class name=Base',
      '  field name=value type=number',
      '  constructor',
      '    param name=value type=number',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      'class name=Derived extends=Base',
      '  constructor',
      '    param name=value type=number',
      '    handler lang="kern"',
      '      let name=adjusted value="value + 2"',
      '      do value="super(adjusted * 3)"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=item value="new Derived(2)"',
      '    print value="item.value"',
    ].join('\n');

    expect(executeKernSource(source)).toBe('12\n');
  });

  test('resumes pre-super, base, and post-super effects in authored order without replay', async () => {
    const providerOrder: string[] = [];
    const env = preSuperEnv([
      {
        constructor: classMember(
          'Base',
          'constructor',
          ['value'],
          [
            { type: 'capability', props: { name: 'baseValue', namespace: 'llm', operation: 'complete' } },
            { type: 'assign', props: { target: 'this.value', value: 'value + baseValue' } },
          ],
        ),
        fields: [{ name: 'value', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: classMember(
          'Derived',
          'constructor',
          [],
          [
            { type: 'capability', props: { name: 'preValue', namespace: 'llm', operation: 'complete' } },
            { type: 'let', props: { name: 'adjusted', value: 'preValue + 1' } },
            { type: 'do', props: { value: 'super(adjusted)' } },
            { type: 'capability', props: { name: 'postValue', namespace: 'llm', operation: 'complete' } },
            { type: 'assign', props: { target: 'this.post', value: 'postValue' } },
          ],
        ),
        extendsName: 'Base',
        fields: [{ name: 'post', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.value + item.post' } },
    ];

    const trace = await executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: {
        llm: {
          complete: async () => {
            const phase = ['pre', 'base', 'post'][providerOrder.length];
            if (!phase) throw new Error('unexpected provider replay');
            providerOrder.push(phase);
            await Promise.resolve();
            return phase === 'pre' ? 2 : phase === 'base' ? 3 : 4;
          },
        },
      },
      policy: 'machine-only',
    });

    expect(trace.completion).toEqual({ kind: 'return', value: 10 });
    expect(providerOrder).toEqual(['pre', 'base', 'post']);
  });

  test('runs three-layer pre-super work on descent and post-super work on ascent', () => {
    const env = preSuperEnv([
      {
        constructor: classMember(
          'Base',
          'constructor',
          ['value'],
          [{ type: 'assign', props: { target: 'this.order', value: 'value' } }],
        ),
        fields: [{ name: 'order', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: classMember(
          'Middle',
          'constructor',
          ['value'],
          [
            { type: 'let', props: { name: 'middleValue', value: 'value + 1' } },
            { type: 'do', props: { value: 'super(middleValue)' } },
            { type: 'assign', props: { target: 'this.order', value: 'this.order * 10 + 2' } },
          ],
        ),
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Middle',
      },
      {
        constructor: classMember(
          'Derived',
          'constructor',
          ['value'],
          [
            { type: 'let', props: { name: 'derivedValue', value: 'value + 1' } },
            { type: 'do', props: { value: 'super(derivedValue)' } },
            { type: 'assign', props: { target: 'this.order', value: 'this.order * 10 + 3' } },
          ],
        ),
        extendsName: 'Middle',
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived(1)' } },
      { type: 'return', props: { value: 'item.order' } },
    ];

    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 323,
    });
  });

  test('cleans private state after a rejected pre-super provider without compatibility retry', async () => {
    const failure = new Error('pre-super rejected');
    let providerCalls = 0;
    const env = preSuperEnv([
      {
        constructor: classMember('Base', 'constructor', [], []),
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: classMember(
          'Derived',
          'constructor',
          [],
          [
            { type: 'capability', props: { name: 'answer', namespace: 'llm', operation: 'complete' } },
            { type: 'do', props: { value: 'super()' } },
          ],
        ),
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [{ type: 'let', props: { name: 'item', value: 'new Derived()' } }];

    await expect(
      executeSourceRunnerAsync(nodes, env, {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              providerCalls += 1;
              throw failure;
            },
          },
        },
        policy: 'machine-only',
      }),
    ).rejects.toThrow(failure.message);
    expect(providerCalls).toBe(1);
    expect(internalEffectMachineStateForEnv(env)).toBeUndefined();
    expect(env.bindings.has('item')).toBe(false);
  });
});
