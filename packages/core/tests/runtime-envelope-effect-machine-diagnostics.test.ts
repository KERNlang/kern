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

test('M4.96 observer reports helper replay without changing the trace', () => {
  const nodes: readonly IRNode[] = [{ type: 'print', props: { value: 'outer(2)' } }];
  const baseline = runInternalEffectMachineSync(nodes, helperEnvironment());
  const events: InternalEffectMachineDiagnosticEvent[] = [];
  const observed = runInternalEffectMachineSync(nodes, helperEnvironment(), {
    observer: (event) => events.push(event),
  });

  expect(observed).toEqual(baseline);
  expect(events.filter(({ kind }) => kind === 'helper-prepare').length).toBeGreaterThan(2);
  expect(events.filter(({ kind }) => kind === 'helper-parent-restart')).toEqual([
    {
      dependency: 'inner',
      kind: 'helper-parent-restart',
      parent: 'outer',
      rolledBackIterations: 0,
    },
  ]);
  expect(events.some((event) => event.kind === 'helper-cache' && event.hit)).toBe(true);
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
