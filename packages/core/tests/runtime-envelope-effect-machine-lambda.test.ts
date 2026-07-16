import {
  InternalEffectMachineError,
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { referenceRunSequence } from '../src/ir/semantics/reference-runner.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { childEnv, makeEnv } from '../src/ir/semantics/semantic-env.js';
import { tracesEqual } from '../src/ir/semantics/trace.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';

describe('M3.23 internal effect-machine lambda ownership', () => {
  beforeAll(() => registerAllContracts());

  // 1. Frozen fixtures
  const fixtures = [
    {
      description: 'lambda: List.map transforms each item with a single-expression callback',
      ir: { type: 'lambda', props: { expr: 'List.map(xs, x => x * 2)' } },
      env: () => makeEnv({ bindings: new Map([['xs', [1, 2, 3]]]) }),
      expectedText: '2,4,6',
      iterationBudget: 3,
    },
    {
      description: 'lambda: List.filter keeps items whose callback returns truthy',
      ir: { type: 'lambda', props: { expr: 'List.filter(xs, x => x > 1)' } },
      env: () => makeEnv({ bindings: new Map([['xs', [1, 2, 3]]]) }),
      expectedText: '2,3',
      iterationBudget: 3,
    },
    {
      description: 'lambda: closure reads the current outer binding by reference',
      ir: {
        type: 'lambda',
        props: { expr: '[fn()]' },
        children: [
          { type: 'let', props: { name: 'outer', kind: 'let', value: '1' } },
          { type: 'let', props: { name: 'fn', value: '() => outer' } },
          { type: 'assign', props: { target: 'outer', value: '2' } },
        ],
      },
      env: () => makeEnv(),
      expectedText: '2',
      iterationBudget: undefined,
    },
    {
      description: 'lambda: two closures capture and read different outer bindings',
      ir: {
        type: 'lambda',
        props: { expr: '[readA(), readB()]' },
        children: [
          { type: 'let', props: { name: 'a', kind: 'let', value: '1' } },
          { type: 'let', props: { name: 'b', kind: 'let', value: '2' } },
          { type: 'let', props: { name: 'readA', value: '() => a' } },
          { type: 'let', props: { name: 'readB', value: '() => b' } },
          { type: 'assign', props: { target: 'a', value: '10' } },
          { type: 'assign', props: { target: 'b', value: '20' } },
        ],
      },
      env: () => makeEnv(),
      expectedText: '10,20',
      iterationBudget: undefined,
    },
    {
      description: 'lambda: closures produced in a callback loop capture fresh per-iteration bindings',
      ir: {
        type: 'lambda',
        props: { expr: 'List.map(List.map(xs, x => () => x), f => f())' },
      },
      env: () => makeEnv({ bindings: new Map([['xs', [1, 2, 3]]]) }),
      expectedText: '1,2,3',
      iterationBudget: 6,
    },
  ];

  for (const fixture of fixtures) {
    test(`sync-machine executes ${fixture.description}`, () => {
      const trace = runInternalEffectMachineSync([fixture.ir], fixture.env(), {
        iterationBudget: fixture.iterationBudget,
      });
      expect(tracesEqual(trace, referenceRunSequence([fixture.ir], fixture.env()))).toBe(true);
      expect(trace.completion).toEqual({ kind: 'normal' });
      expect(trace.events).toEqual([{ op: 'stdout', text: fixture.expectedText }]);
    });

    test(`immediate-async-machine executes ${fixture.description}`, async () => {
      const trace = await runInternalEffectMachineAsync([fixture.ir], fixture.env(), {
        iterationBudget: fixture.iterationBudget,
      });
      expect(tracesEqual(trace, referenceRunSequence([fixture.ir], fixture.env()))).toBe(true);
      expect(trace.completion).toEqual({ kind: 'normal' });
      expect(trace.events).toEqual([{ op: 'stdout', text: fixture.expectedText }]);
    });
  }

  // 2. Parity check
  test('sync and immediate-async paths share the same machine trace', async () => {
    const ir = { type: 'lambda', props: { expr: 'List.map(xs, x => x * 3)' } };
    const envSync = makeEnv({ bindings: new Map([['xs', [1, 2]]]) });
    const envAsync = makeEnv({ bindings: new Map([['xs', [1, 2]]]) });
    const sync = runInternalEffectMachineSync([ir], envSync, { iterationBudget: 2 });
    const asyncTrace = await runInternalEffectMachineAsync([ir], envAsync, { iterationBudget: 2 });
    expect(tracesEqual(sync, asyncTrace)).toBe(true);
  });

  test('setup assign creates an unbound local with reference parity', () => {
    const ir = {
      type: 'lambda',
      props: { expr: '[created]' },
      children: [{ type: 'assign', props: { target: 'created', value: '2' } }],
    };
    const machine = runInternalEffectMachineSync([ir], makeEnv());
    const reference = referenceRunSequence([ir], makeEnv());
    expect(tracesEqual(machine, reference)).toBe(true);
    expect(machine.events).toEqual([{ op: 'stdout', text: '2' }]);
  });

  test('closures capture setup bindings declared later by reference', () => {
    const ir = {
      type: 'lambda',
      props: { expr: 'readLater()' },
      children: [
        { type: 'let', props: { name: 'readLater', value: '() => later' } },
        { type: 'let', props: { name: 'later', value: '2' } },
      ],
    };
    const machine = runInternalEffectMachineSync([ir], makeEnv());
    expect(tracesEqual(machine, referenceRunSequence([ir], makeEnv()))).toBe(true);
    expect(machine.events).toEqual([{ op: 'stdout', text: '2' }]);
  });

  test('private closure aliases remain callable with reference parity', () => {
    const ir = {
      type: 'lambda',
      props: { expr: 'alias()' },
      children: [
        { type: 'let', props: { name: 'original', value: '() => 3' } },
        { type: 'let', props: { name: 'alias', value: 'original' } },
      ],
    };
    const machine = runInternalEffectMachineSync([ir], makeEnv());
    expect(tracesEqual(machine, referenceRunSequence([ir], makeEnv()))).toBe(true);
    expect(machine.events).toEqual([{ op: 'stdout', text: '3' }]);
  });

  test('nested machine execution resolves lexical parent bindings', () => {
    const machine = runInternalEffectMachineSync(
      [
        {
          type: 'for',
          props: { from: '0', name: 'i', to: '1' },
          children: [{ type: 'lambda', props: { expr: 'List.map(xs, x => x * 2 + i)' } }],
        },
      ],
      makeEnv({ bindings: new Map([['xs', [2, 3]]]) }),
      { iterationBudget: 3 },
    );
    expect(machine.events.some((event) => event.op === 'stdout' && event.text === '4,6')).toBe(true);
  });

  test('selects and executes root lambdas through both source APIs', async () => {
    const nodes = [{ type: 'lambda', props: { expr: 'List.map(xs, x => x * 2)' } }];
    const env = () => makeEnv({ bindings: new Map([['xs', [2, 3]]]) });
    expect(selectSourceRunnerEngine(nodes, env(), {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(selectSourceRunnerEngine(nodes, env(), { iterationBudget: 2 })).toBe(SOURCE_RUNNER_ENGINE.machine);
    const sync = executeSourceRunnerSync(nodes, env(), { iterationBudget: 2, policy: 'machine-only' });
    const asyncTrace = await executeSourceRunnerAsync(nodes, env(), { iterationBudget: 2, policy: 'machine-only' });
    expect(sync.events).toEqual([{ op: 'stdout', text: '4,6' }]);
    expect(tracesEqual(sync, asyncTrace)).toBe(true);
  });

  test('charges caller-owned iteration budget for lambda collection steps', () => {
    const nodes = [{ type: 'lambda', props: { expr: 'List.map(xs, x => x)' } }];
    const env = () => makeEnv({ bindings: new Map([['xs', [1, 2]]]) });
    expect(() => runInternalEffectMachineSync(nodes, env())).toThrow(InternalEffectMachineError);
    expect(() => runInternalEffectMachineSync(nodes, env(), { iterationBudget: 1 })).toThrow(
      InternalEffectMachineError,
    );
    expect(runInternalEffectMachineSync(nodes, env(), { iterationBudget: 2 }).events).toEqual([
      { op: 'stdout', text: '1,2' },
    ]);
  });

  // 3. Malformed / unsupported rejections
  test('fails closed for malformed lambda properties', () => {
    expect(() => runInternalEffectMachineSync([{ type: 'lambda' }], makeEnv())).toThrow();
    expect(() => runInternalEffectMachineSync([{ type: 'lambda', props: { expr: '' } }], makeEnv())).toThrow();
  });

  test('fails closed for block-bodied arrow closures', () => {
    const ir = {
      type: 'lambda',
      props: { expr: 'List.map(xs, x => { return x; })' },
    };
    expect(() => runInternalEffectMachineSync([ir], makeEnv({ bindings: new Map([['xs', [1]]]) }))).toThrow();
  });

  test('fails closed for unsupported setup nodes', () => {
    const ir = {
      type: 'lambda',
      props: { expr: '1' },
      children: [{ type: 'print', props: { value: '2' } }],
    };
    expect(() => runInternalEffectMachineSync([ir], makeEnv())).toThrow();
  });

  test('fails closed for missing bindings during preflight', () => {
    const ir = { type: 'lambda', props: { expr: 'unboundVar' } };
    expect(() => runInternalEffectMachineSync([ir], makeEnv())).toThrow();
  });

  test('fails closed for wrong collection types at runtime/preflight', () => {
    const ir = { type: 'lambda', props: { expr: 'List.map(1, x => x)' } };
    expect(() => runInternalEffectMachineSync([ir], makeEnv())).toThrow();
  });

  test.each([
    {
      children: [{ type: 'let', props: { name: 'callback', value: '1' } }],
      expr: 'List.map(xs, callback)',
    },
    {
      children: [{ type: 'let', props: { name: 'callback', value: '1' } }],
      expr: 'callback()',
    },
  ])('rejects a stable non-private call before an earlier capability', ({ children, expr }) => {
    let calls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'lambda', props: { expr }, children },
    ];
    const env = makeEnv({
      bindings: new Map([['xs', [1]]]),
      capabilities: { storage: { get: () => (calls += 1) } },
    });
    expect(() => runInternalEffectMachineSync(nodes, env)).toThrow();
    expect(calls).toBe(0);
  });

  test('rejects an unproven callable callback parameter before an earlier capability', () => {
    let calls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'lambda', props: { expr: 'List.map(fns, f => f())' } },
    ];
    const env = makeEnv({
      bindings: new Map([['fns', [1]]]),
      capabilities: { storage: { get: () => (calls += 1) } },
    });
    let thrown: unknown;
    try {
      runInternalEffectMachineSync(nodes, env, { iterationBudget: 1 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InternalEffectMachineError);
    expect(String((thrown as Error & { cause?: Error }).cause?.message)).toContain(
      'call target must be a private closure',
    );
    expect(calls).toBe(0);
  });

  test('shape-checks an unreachable lambda without requiring runtime bindings', () => {
    const trace = runInternalEffectMachineSync(
      [
        { type: 'return', props: { value: '1' } },
        { type: 'lambda', props: { expr: 'List.map(unreachable, x => x)' } },
      ],
      makeEnv(),
    );
    expect(trace.completion).toEqual({ kind: 'return', value: 1 });
  });

  // 4. Malformed rejection before any capability effect is run
  test('rejects a later unsupported lambda before an earlier provider effect', () => {
    let calls = 0;
    const env = makeEnv({ capabilities: { storage: { get: () => ++calls } } });
    expect(() =>
      runInternalEffectMachineSync(
        [
          { type: 'capability', props: { input: '"key"', namespace: 'storage', operation: 'get' } },
          { type: 'lambda', props: { expr: 'unboundVar' } },
        ],
        env,
      ),
    ).toThrow();
    expect(calls).toBe(0);
  });

  // 5. Deferred-value execution
  test('executes lambda containing deferred value from preceding capability', async () => {
    const nodes = [
      {
        type: 'capability',
        props: { input: '"hello"', name: 'reply', namespace: 'llm', operation: 'complete' },
      },
      { type: 'lambda', props: { expr: 'List.map(xs, x => reply + x)' } },
    ];
    const env = makeEnv({ bindings: new Map([['xs', ['a', 'b']]]) });
    const trace = await runInternalEffectMachineAsync(nodes, env, {
      asyncCapabilities: { llm: { complete: async () => 'echo:' } },
      iterationBudget: 2,
    });
    expect(trace.completion).toEqual({ kind: 'normal' });
    expect(trace.events.some((e) => e.op === 'stdout' && e.text === 'echo:a,echo:b')).toBe(true);
  });

  test('short-circuits a deferred right-hand expression', async () => {
    const nodes = [
      { type: 'capability', props: { name: 'rhs', namespace: 'llm', operation: 'complete' } },
      { type: 'lambda', props: { expr: 'false && List.map(rhs, x => x)' } },
    ];
    const trace = await runInternalEffectMachineAsync(nodes, makeEnv(), {
      asyncCapabilities: { llm: { complete: async () => 1 } },
    });
    expect(trace.events.some((event) => event.op === 'stdout' && event.text === 'false')).toBe(true);
  });

  test('shape-checks but does not resolve an unreachable short-circuit operand', () => {
    const trace = runInternalEffectMachineSync([{ type: 'lambda', props: { expr: 'false && missing' } }], makeEnv());
    expect(trace.events).toEqual([{ op: 'stdout', text: 'false' }]);
  });

  test('uses stable setup locals to skip unreachable conditional bindings', () => {
    const trace = runInternalEffectMachineSync(
      [
        {
          type: 'lambda',
          props: { expr: 'cond ? 1 : missing' },
          children: [{ type: 'let', props: { name: 'cond', value: 'true' } }],
        },
      ],
      makeEnv(),
    );
    expect(trace.events).toEqual([{ op: 'stdout', text: '1' }]);
  });

  test('short-circuits optional index access on a nullish receiver', () => {
    const trace = runInternalEffectMachineSync(
      [{ type: 'lambda', props: { expr: 'obj?.[missing]' } }],
      makeEnv({ bindings: new Map([['obj', null]]) }),
    );
    expect(trace.events).toEqual([{ op: 'stdout', text: 'undefined' }]);
  });

  test('uses a stable nullish setup local to skip an optional index binding', () => {
    const trace = runInternalEffectMachineSync(
      [
        {
          type: 'lambda',
          props: { expr: 'obj?.[missing]' },
          children: [{ type: 'let', props: { name: 'obj', value: 'null' } }],
        },
      ],
      makeEnv(),
    );
    expect(trace.events).toEqual([{ op: 'stdout', text: 'undefined' }]);
  });

  test('normalizes deferred lambda failures as machine errors', async () => {
    const nodes = [
      { type: 'capability', props: { name: 'rhs', namespace: 'llm', operation: 'complete' } },
      { type: 'lambda', props: { expr: 'List.map(rhs, x => x)' } },
    ];
    let thrown: unknown;
    try {
      await runInternalEffectMachineAsync(nodes, makeEnv(), {
        asyncCapabilities: { llm: { complete: async () => 1 } },
        iterationBudget: 1,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InternalEffectMachineError);
  });

  // 6. Private-call enforcement
  test('rejects invoking host functions as closures', () => {
    const ir = { type: 'lambda', props: { expr: 'fn()' } };
    const env = makeEnv({ bindings: new Map([['fn', () => 42]]) });
    expect(() => runInternalEffectMachineSync([ir], env)).toThrow();
  });

  // 7. Host global poisoning resilience
  test('remains resilient to prototype poisoning', () => {
    const originalMap = Array.prototype.map;
    const originalFilter = Array.prototype.filter;

    try {
      const nodes = [
        { type: 'capability', props: { namespace: 'poisoner', operation: 'infect' } },
        {
          type: 'lambda',
          props: { expr: 'List.filter(List.map(xs, x => x * 2), x => x > 2)' },
        },
      ];

      const env = makeEnv({
        bindings: new Map([['xs', [1, 2]]]),
        capabilities: {
          poisoner: {
            infect: () => {
              Array.prototype.map = () => {
                throw new Error('POISONED');
              };
              Array.prototype.filter = () => {
                throw new Error('POISONED');
              };
              return undefined;
            },
          },
        },
      });

      const trace = runInternalEffectMachineSync(nodes, env, { iterationBudget: 4 });
      expect(trace.events.some((e) => e.op === 'stdout' && e.text === '4')).toBe(true);
    } finally {
      Array.prototype.map = originalMap;
      Array.prototype.filter = originalFilter;
    }
  });

  // 8. Non-root/helper/class environment selector guardrails
  test('admits authentic incoming parent environments with an explicit budget', () => {
    const ir = { type: 'lambda', props: { expr: 'List.map(xs, x => x)' } };
    const root = makeEnv({ bindings: new Map([['xs', [1]]]) });
    const child = childEnv(root);
    expect(selectSourceRunnerEngine([ir], child, { iterationBudget: 1 })).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync([ir], child, { iterationBudget: 1, policy: 'machine-only' }).events).toEqual([
      { op: 'stdout', text: '1' },
    ]);
  });

  test('keeps environments with helper functions on compatibility', () => {
    const ir = { type: 'lambda', props: { expr: 'List.map(xs, x => x)' } };
    const env = makeEnv({
      bindings: new Map([['xs', [1]]]),
      runnerFunctions: new Map([['someHelper', {} as any]]),
    });
    expect(selectSourceRunnerEngine([ir], env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('keeps environments with runner classes on compatibility', () => {
    const ir = { type: 'lambda', props: { expr: 'List.map(xs, x => x)' } };
    const env = makeEnv({
      bindings: new Map([['xs', [1]]]),
      runnerClasses: new Map([['SomeClass', {} as any]]),
    });
    expect(selectSourceRunnerEngine([ir], env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });
});
