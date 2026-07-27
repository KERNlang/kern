import { runInternalEffectMachineSync } from '../src/ir/semantics/internal-effect-machine.js';
import type { InternalEffectMachineDiagnosticEvent } from '../src/ir/semantics/internal-effect-machine-diagnostics.js';
import { markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import { makeEnv, type RunnerModuleScope } from '../src/ir/semantics/semantic-env.js';
import type { IRNode } from '../src/types.js';
import { classHelperEnv, helper, member } from './runtime-envelope-effect-machine-class-helper-fixtures.js';

function helperEnvironment() {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  functions.set('inner', {
    body: [{ type: 'return', props: { value: 'value * 2' } }],
    module: scope,
    name: 'inner',
    params: ['value'],
    returns: 'number',
  });
  functions.set('outer', {
    body: [{ type: 'return', props: { value: 'inner(value) + 1' } }],
    module: scope,
    name: 'outer',
    params: ['value'],
    returns: 'number',
  });
  markRunnerMachineRootScope(scope);
  return makeEnv({
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: classes,
    runnerFunctions: functions,
  });
}

function loopHelperEnvironment() {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  functions.set('identity', {
    body: [{ type: 'return', props: { value: 'value' } }],
    module: scope,
    name: 'identity',
    params: ['value'],
    returns: 'number',
  });
  functions.set('sumTwo', {
    body: [
      { type: 'let', props: { name: 'total', value: '0' } },
      {
        type: 'for',
        props: { from: '0', name: 'i', to: '2' },
        children: [
          {
            type: 'assign',
            props: { op: '+=', target: 'total', value: 'identity(i)' },
          },
        ],
      },
      { type: 'return', props: { value: 'total' } },
    ],
    module: scope,
    name: 'sumTwo',
    params: [],
    returns: 'number',
  });
  markRunnerMachineRootScope(scope);
  return makeEnv({
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: classes,
    runnerFunctions: functions,
  });
}

function expressionHelperEnvironment() {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  functions.set('double', {
    body: [{ type: 'return', props: { value: 'value * 2' } }],
    module: scope,
    name: 'double',
    params: ['value'],
    returns: 'number',
  });
  functions.set('identityText', {
    body: [{ type: 'return', props: { value: 'value' } }],
    module: scope,
    name: 'identityText',
    params: ['value'],
    returns: 'string',
  });
  functions.set('expressionOuter', {
    body: [
      {
        type: 'expression-v1',
        props: { expr: 'double(value)', name: 'doubled' },
      },
      { type: 'return', props: { value: 'doubled + 1' } },
    ],
    module: scope,
    name: 'expressionOuter',
    params: ['value'],
    returns: 'number',
  });
  functions.set('regexOuter', {
    body: [
      {
        type: 'expression-v1',
        props: { expr: '/a/.test(identityText(value))', name: 'matches' },
      },
      { type: 'return', props: { value: 'matches' } },
    ],
    module: scope,
    name: 'regexOuter',
    params: ['value'],
    returns: 'boolean',
  });
  markRunnerMachineRootScope(scope);
  return makeEnv({
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: classes,
    runnerFunctions: functions,
  });
}

test('M4.97 observer reports helper-frame suspension without changing the trace', () => {
  const nodes: readonly IRNode[] = [{ type: 'print', props: { value: 'outer(2)' } }];
  const baseline = runInternalEffectMachineSync(nodes, helperEnvironment());
  const events: InternalEffectMachineDiagnosticEvent[] = [];
  const observed = runInternalEffectMachineSync(nodes, helperEnvironment(), {
    observer: (event) => events.push(event),
  });

  expect(observed).toEqual(baseline);
  expect(events.filter(({ kind }) => kind === 'helper-prepare').length).toBeGreaterThan(2);
  expect(events.filter(({ kind }) => kind === 'helper-parent-restart')).toEqual([]);
  expect(events.filter(({ kind }) => kind === 'helper-frame-suspend')).toEqual([
    {
      dependency: 'inner',
      kind: 'helper-frame-suspend',
      parent: 'outer',
    },
  ]);
  expect(events.filter((event) => event.kind === 'helper-execute' && event.name === 'outer')).toHaveLength(1);
  expect(events.some((event) => event.kind === 'helper-cache' && event.hit)).toBe(true);
});

test('M4.97 preserves one parent frame across nested helper misses', () => {
  const nodes: readonly IRNode[] = [{ type: 'print', props: { value: 'sumTwo()' } }];
  const events: InternalEffectMachineDiagnosticEvent[] = [];

  const trace = runInternalEffectMachineSync(nodes, loopHelperEnvironment(), {
    iterationBudget: 2,
    observer: (event) => events.push(event),
  });

  expect(trace.events).toEqual([{ op: 'stdout', text: '1' }]);
  expect(events.filter((event) => event.kind === 'helper-execute' && event.name === 'sumTwo')).toHaveLength(1);
  expect(events.filter((event) => event.kind === 'helper-parent-restart')).toEqual([]);
  expect(events.filter((event) => event.kind === 'helper-frame-suspend')).toHaveLength(2);
  expect(events.filter((event) => event.kind === 'loop-iteration')).toHaveLength(2);
});

test('M4.97 suspends nested helpers through expression-v1 and native trials', () => {
  const nodes: readonly IRNode[] = [
    { type: 'print', props: { value: 'expressionOuter(2)' } },
    { type: 'print', props: { value: 'regexOuter("cat")' } },
  ];

  expect(runInternalEffectMachineSync(nodes, expressionHelperEnvironment()).events).toEqual([
    { op: 'stdout', text: '5' },
    { op: 'stdout', text: 'true' },
  ]);
});

test('M4.96 observer events are frozen and observer failures cannot affect execution', () => {
  const nodes: readonly IRNode[] = [{ type: 'print', props: { value: 'outer(3)' } }];
  const baseline = runInternalEffectMachineSync(nodes, helperEnvironment());
  let allFrozen = true;
  let observations = 0;
  const observed = runInternalEffectMachineSync(nodes, helperEnvironment(), {
    observer: (event) => {
      observations += 1;
      allFrozen &&= Object.isFrozen(event);
      throw new Error('observer failure must be ignored');
    },
  });

  expect(observed).toEqual(baseline);
  expect(observations).toBeGreaterThan(0);
  expect(allFrozen).toBe(true);
});

test('M4.96 observer reports helper execution reached through a resumable class frame', () => {
  const env = classHelperEnv({
    classes: [
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          ['read', member('Box', 'read', [{ type: 'return', props: { value: 'decorate(value)' } }], ['value'])],
        ]),
        name: 'Box',
      },
    ],
    helpers: [helper('decorate', ['value'], [{ type: 'return', props: { value: 'value + 1' } }])],
  });
  const nodes: readonly IRNode[] = [
    { type: 'let', props: { name: 'box', value: 'new Box()' } },
    { type: 'return', props: { value: 'box.read(4)' } },
  ];
  const events: InternalEffectMachineDiagnosticEvent[] = [];

  const trace = runInternalEffectMachineSync(nodes, env, {
    observer: (event) => events.push(event),
  });

  expect(trace.completion).toEqual({ kind: 'return', value: 5 });
  expect(events.filter(({ kind }) => kind === 'helper-execute')).toEqual([
    { kind: 'helper-execute', name: 'decorate' },
  ]);
});
