import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { evalRunnerFunctionValueAsync } from '../src/ir/semantics/async-portable-scalar.js';
import { asyncReferenceRunSequence } from '../src/ir/semantics/async-reference-runner.js';
import {
  bindInternalReferenceTraceRetention,
  internalReferenceTraceRetentionForEnv,
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassInstanceValue,
  type RunnerModuleScope,
} from '../src/ir/semantics/index.js';
import {
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { referenceRunSequence } from '../src/ir/semantics/reference-runner.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import { appendOrderedTraceEvents, type TraceEvent } from '../src/ir/semantics/trace.js';
import {
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeSync,
} from '../src/runtime-envelope/execute.js';
import {
  executeInternalRuntimeEnvelopeCompatAsync,
  executeInternalRuntimeEnvelopeCompatSync,
} from '../src/runtime-envelope/execute-compat.js';
import {
  runInternalRuntimeEngineAsync,
  runInternalRuntimeEngineSync,
} from '../src/runtime-envelope/internal-engine.js';
import {
  runInternalLegacyEngineAsync,
  runInternalLegacyEngineSync,
} from '../src/runtime-envelope/internal-legacy-engine.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

const ITERATIONS = 16_384;
const LEGACY_ITERATIONS = 65_536;
const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 100_000,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 8,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, limits } as const;
const assignmentLoop: IRNode[] = [
  { type: 'let', props: { name: 'total', value: '0' } },
  {
    type: 'for',
    props: { from: '0', name: 'index', to: String(ITERATIONS) },
    children: [{ type: 'assign', props: { target: 'total', value: 'total + 1' } }],
  },
  { type: 'return', props: { value: 'total' } },
];
const legacyAssignmentLoop: IRNode[] = [
  {
    type: '__block',
    children: [
      { type: 'let', props: { name: 'total', value: '0' } },
      {
        type: 'for',
        props: { from: '0', name: 'index', to: String(LEGACY_ITERATIONS) },
        children: [{ type: 'assign', props: { target: 'total', value: 'total + 1' } }],
      },
      { type: 'return', props: { value: 'total' } },
    ],
  },
];
const legacyLimits = { ...limits, maxCollectionLength: 100_000 } as const;
const legacyEnabled = { enabled: true, limits: legacyLimits } as const;

const effectMachineTraceJoinSources = [
  'internal-effect-machine-try.ts',
  'internal-effect-machine-class-frame.ts',
  'internal-effect-machine-class-value-runtime.ts',
] as const;
const executionFrameSources = [
  'async-portable-scalar.ts',
  'internal-effect-machine-class-activation.ts',
  'internal-effect-machine-helper-preflight.ts',
  'internal-effect-machine-helper-runtime.ts',
  'portable-reference-body.ts',
  'portable-reference-evaluator.ts',
] as const;

function variadicTraceJoins(sourceName: string): string[] {
  const path = fileURLToPath(new URL(`../src/ir/semantics/${sourceName}`, import.meta.url));
  const source = readFileSync(path, 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const failures: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'push' &&
      node.arguments.some(
        (argument) =>
          ts.isSpreadElement(argument) &&
          ts.isPropertyAccessExpression(argument.expression) &&
          argument.expression.name.text === 'events',
      )
    ) {
      const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
      failures.push(`${sourceName}:${line + 1}:${character + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return failures;
}

function constructorCalls(sourceName: string): string[] {
  const path = fileURLToPath(new URL(`../src/ir/semantics/${sourceName}`, import.meta.url));
  const source = readFileSync(path, 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.push(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

describe('runtime-envelope trace compaction', () => {
  beforeAll(() => registerAllContracts());

  test('effect-machine trace joins never pass event arrays through host variadic arguments', () => {
    expect(effectMachineTraceJoinSources.flatMap(variadicTraceJoins)).toEqual([]);
  });

  test('execution-reachable rebuilt frames use the private frame constructor exclusively', () => {
    for (const sourceName of executionFrameSources) {
      const calls = constructorCalls(sourceName);
      expect(calls).not.toContain('makeEnv');
      expect(calls).toContain('makeExecutionFrame');
    }
  });

  test('ordered trace append is self-join safe and preserves exact source order', () => {
    const target: TraceEvent[] = [{ op: 'stdout', text: 'first' }];
    const source: TraceEvent[] = [
      { op: 'stdout', text: 'second' },
      { op: 'stdout', text: 'third' },
    ];
    appendOrderedTraceEvents(target, source);
    appendOrderedTraceEvents(target, target);
    expect(target).toEqual([
      { op: 'stdout', text: 'first' },
      { op: 'stdout', text: 'second' },
      { op: 'stdout', text: 'third' },
    ]);
  });

  test('direct effect-machine defaults retain the exact full sync and async trace', async () => {
    const sync = runInternalEffectMachineSync(assignmentLoop, makeEnv(), {
      iterationBudget: limits.maxCollectionLength,
    });
    const asyncTrace = await runInternalEffectMachineAsync(assignmentLoop, makeEnv(), {
      iterationBudget: limits.maxCollectionLength,
    });
    expect(sync).toEqual(asyncTrace);
    expect(sync.completion).toEqual({ kind: 'return', value: ITERATIONS });
    expect(sync.events).toHaveLength(1 + 2 * ITERATIONS);
    expect(sync.events.slice(0, 3)).toEqual([
      { op: 'assign', target: 'total', value: 0 },
      { binding: 'index', op: 'iter-next', value: 0 },
      { op: 'assign', target: 'total', value: 1 },
    ]);
    expect(sync.events.at(-1)).toEqual({ op: 'assign', target: 'total', value: ITERATIONS });
  });

  test('private observable engine mode retains zero pre-normalization internal events', async () => {
    const sync = runInternalRuntimeEngineSync(
      assignmentLoop,
      makeEnv(),
      limits.maxCollectionLength,
      undefined,
      limits.maxStringBytes,
      'observable-only',
    );
    const asyncTrace = await runInternalRuntimeEngineAsync(assignmentLoop, makeEnv(), {
      iterationBudget: limits.maxCollectionLength,
      textCodePointCacheMaxStringBytes: limits.maxStringBytes,
      traceRetention: 'observable-only',
    });
    expect(sync).toEqual(asyncTrace);
    expect(sync).toEqual({ completion: { kind: 'return', value: ITERATIONS }, events: [] });
  });

  test('direct reference runner retains the exact full legacy boundary trace without spread exhaustion', () => {
    const trace = referenceRunSequence(legacyAssignmentLoop, makeEnv());
    expect(trace.completion).toEqual({ kind: 'return', value: LEGACY_ITERATIONS });
    expect(trace.events).toHaveLength(1 + 2 * LEGACY_ITERATIONS);
    expect(trace.events.at(-1)).toEqual({ op: 'assign', target: 'total', value: LEGACY_ITERATIONS });
  });

  test('private legacy observable mode retains zero internal events at the full boundary', async () => {
    const sync = runInternalLegacyEngineSync(legacyAssignmentLoop, makeEnv(), 'observable-only');
    const asyncTrace = await runInternalLegacyEngineAsync(legacyAssignmentLoop, makeEnv(), {}, 'observable-only');
    expect(sync).toEqual(asyncTrace);
    expect(sync).toEqual({ completion: { kind: 'return', value: LEGACY_ITERATIONS }, events: [] });
  });

  test('private legacy binding rejects a proxied caller without writes or later direct-run leakage', async () => {
    const writes: string[] = [];
    const caller = new Proxy(Object.freeze(makeEnv()), {
      defineProperty: (_target, property) => {
        writes.push(`define:${String(property)}`);
        return false;
      },
      deleteProperty: (_target, property) => {
        writes.push(`delete:${String(property)}`);
        return false;
      },
      set: (_target, property) => {
        writes.push(`set:${String(property)}`);
        return false;
      },
    });

    expect(() => runInternalLegacyEngineSync(legacyAssignmentLoop, caller, 'observable-only')).toThrow(
      /requires an exact root environment/,
    );
    await expect(runInternalLegacyEngineAsync(legacyAssignmentLoop, caller, {}, 'observable-only')).rejects.toThrow(
      /requires an exact root environment/,
    );
    expect(writes).toEqual([]);

    const direct = referenceRunSequence(legacyAssignmentLoop, caller);
    expect(direct.events).toHaveLength(1 + 2 * LEGACY_ITERATIONS);
    expect(writes).toEqual([]);
  });

  test('private legacy execution isolates caller bindings and memoization in sync and async modes', async () => {
    const functions: RunnerModuleScope['functions'] = new Map();
    const classes: RunnerModuleScope['classes'] = new Map();
    const module: RunnerModuleScope = { classes, functions };
    functions.set('answer', {
      body: [{ type: 'return', props: { value: '7' } }],
      module,
      name: 'answer',
      params: [],
      returns: 'number',
    });
    markRunnerMachineRootScope(module);
    const nodes: IRNode[] = [
      { type: 'assign', props: { target: 'total', value: 'total + answer()' } },
      { type: 'return', props: { value: 'total' } },
    ];
    const makeCaller = () =>
      makeEnv({
        bindings: new Map([['total', 0]]),
        runnerCallCache: new Map(),
        runnerClasses: classes,
        runnerFunctions: functions,
      });

    const syncCaller = makeCaller();
    expect(runInternalLegacyEngineSync(nodes, syncCaller, 'observable-only').completion).toEqual({
      kind: 'return',
      value: 7,
    });
    expect(syncCaller.bindings.get('total')).toBe(0);
    expect(syncCaller.runnerCallCache).toEqual(new Map());

    const asyncCaller = makeCaller();
    expect((await runInternalLegacyEngineAsync(nodes, asyncCaller, {}, 'observable-only')).completion).toEqual({
      kind: 'return',
      value: 7,
    });
    expect(asyncCaller.bindings.get('total')).toBe(0);
    expect(asyncCaller.runnerCallCache).toEqual(new Map());
  });

  test('isolated legacy cloning preserves aliases and cycles without sharing mutable caller values', () => {
    const shared: Record<string, unknown> = { value: 1 };
    shared.self = shared;
    const instance: RunnerClassInstanceValue = {
      __kernRunnerClassInstance: true,
      className: 'Box',
      fields: { shared },
    };
    const caller = makeEnv({ runnerThis: instance });
    const callerInstance = caller.runnerThis as RunnerClassInstanceValue;
    caller.bindings.set('first', callerInstance.fields.shared);
    caller.bindings.set('second', callerInstance.fields.shared);
    caller.bindings.set('box', callerInstance);
    caller.bindings.set('boxAlias', callerInstance);
    const execution = bindInternalReferenceTraceRetention(caller, 'observable-only');
    const first = execution.bindings.get('first') as Record<string, unknown>;
    const box = execution.bindings.get('box') as RunnerClassInstanceValue;

    expect(first).toBe(execution.bindings.get('second'));
    expect(first).not.toBe(caller.bindings.get('first'));
    expect(first.self).toBe(first);
    expect(box).toBe(execution.bindings.get('boxAlias'));
    expect(box).toBe(execution.runnerThis);
    expect(box).not.toBe(caller.bindings.get('box'));
    expect(box.fields.shared).toBe(first);
  });

  test('isolated legacy cloning rejects unsupported binding graphs before execution', () => {
    const sparse = new Array(2);
    sparse[1] = 1;
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
    const decoratedMap = new Map<string, number>([['value', 1]]) as Map<string, number> & { extra?: number };
    decoratedMap.extra = 1;
    const rejected = [undefined, () => 1, sparse, accessor, decoratedMap];

    for (const value of rejected) {
      const caller = makeEnv({ bindings: new Map([['value', value]]) });
      expect(() => bindInternalReferenceTraceRetention(caller, 'observable-only')).toThrow(/isolated/);
      expect(caller.bindings.has('value')).toBe(true);
    }
  });

  test('observable-only legacy execution rejects same-value runner method mutation', async () => {
    const method = {
      body: [
        { type: 'assign', props: { target: 'this.value', value: 'this.value' } },
        { type: 'return', props: { value: 'this.value' } },
      ],
      name: 'touch',
      ownerClass: 'Box',
      params: [],
    } as const;
    const functions: RunnerModuleScope['functions'] = new Map();
    const classes: RunnerModuleScope['classes'] = new Map();
    const module: RunnerModuleScope = { classes, functions };
    const boxClass: RunnerClassBinding = {
      fields: [{ name: 'value', value: '1' }],
      getters: new Map(),
      methods: new Map([['touch', method]]),
      module,
      name: 'Box',
    };
    markRunnerMachineClassBinding(boxClass);
    classes.set('Box', boxClass);
    markRunnerMachineRootScope(module);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const instance: RunnerClassInstanceValue = {
      __kernRunnerClassInstance: true,
      className: 'Box',
      fields: { left: cyclic, right: cyclic, value: 1 },
      module,
    };
    const nodes: IRNode[] = [{ type: 'return', props: { value: 'box.touch()' } }];
    const makeCaller = () =>
      makeEnv({
        bindings: new Map([['box', instance]]),
        runnerClasses: classes,
        runnerFunctions: functions,
      });

    expect(() => runInternalLegacyEngineSync(nodes, makeCaller(), 'observable-only')).toThrow(
      /Preconditions failed|mutated instance state/,
    );
    await expect(runInternalLegacyEngineAsync(nodes, makeCaller(), {}, 'observable-only')).rejects.toThrow(
      /Preconditions failed|mutated instance state/,
    );
    expect(instance.fields.value).toBe(1);
    expect(instance.fields.left).toBe(instance.fields.right);
    expect((instance.fields.left as Record<string, unknown>).self).toBe(instance.fields.left);
  });

  test('observable-only retention is inherited by an async function call frame without binding the caller', async () => {
    const functions: RunnerModuleScope['functions'] = new Map();
    const classes: RunnerModuleScope['classes'] = new Map();
    const module: RunnerModuleScope = { classes, functions };
    functions.set('answer', {
      body: [{ type: 'return', props: { value: '7' } }],
      module,
      name: 'answer',
      params: [],
      returns: 'number',
    });
    const caller = makeEnv({ runnerClasses: classes, runnerFunctions: functions });
    const executionEnv = bindInternalReferenceTraceRetention(caller, 'observable-only');
    let frameRetention: string | undefined;

    const value = await evalRunnerFunctionValueAsync('answer', [], executionEnv, {
      runFunctionBody: async (body, callEnv) => {
        frameRetention = internalReferenceTraceRetentionForEnv(callEnv);
        return asyncReferenceRunSequence(body, callEnv, {});
      },
    });

    expect(value).toBe(7);
    expect(frameRetention).toBe('observable-only');
    expect(internalReferenceTraceRetentionForEnv(caller)).toBe('full');
  });

  test('legacy compatibility sync and async preserve the full-boundary result with no hidden trace', async () => {
    const sync = executeInternalRuntimeEnvelopeCompatSync(legacyAssignmentLoop, makeEnv(), legacyEnabled);
    const asyncEnvelope = await executeInternalRuntimeEnvelopeCompatAsync(
      legacyAssignmentLoop,
      makeEnv(),
      legacyEnabled,
    );
    expect(sync).toEqual(asyncEnvelope);
    expect(sync).toMatchObject({
      completion: { kind: 'return' },
      events: [],
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: String(LEGACY_ITERATIONS) } },
    });
  });

  test('sync, async, and compatibility envelopes preserve result with no hidden trace', async () => {
    const sync = executeInternalRuntimeEnvelopeSync(assignmentLoop, makeEnv(), enabled);
    const asyncEnvelope = await executeInternalRuntimeEnvelopeAsync(assignmentLoop, makeEnv(), enabled);
    const compat = executeInternalRuntimeEnvelopeCompatSync(assignmentLoop, makeEnv(), enabled);
    expect(sync).toEqual(asyncEnvelope);
    expect(sync).toEqual(compat);
    expect(sync).toMatchObject({
      completion: { kind: 'return' },
      events: [],
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: String(ITERATIONS) } },
    });
  });

  test('observable event order and maxEvents enforcement remain unchanged', async () => {
    const printed: IRNode[] = [
      { type: 'print', props: { value: '"first"' } },
      { type: 'let', props: { name: 'internal', value: '1' } },
      { type: 'print', props: { value: '"second"' } },
      { type: 'return', props: { value: 'internal' } },
    ];
    const sync = executeInternalRuntimeEnvelopeSync(printed, makeEnv(), enabled);
    const asyncEnvelope = await executeInternalRuntimeEnvelopeAsync(printed, makeEnv(), enabled);
    expect(sync).toEqual(asyncEnvelope);
    expect(sync.events).toEqual([
      { op: 'stdout', text: 'first' },
      { op: 'stdout', text: 'second' },
    ]);
    const bounded = executeInternalRuntimeEnvelopeSync(printed, makeEnv(), {
      enabled: true,
      limits: { ...limits, maxEvents: 1 },
    });
    expect(bounded).toMatchObject({
      diagnostics: [{ code: 'non-portable-value' }],
      events: [],
      outcome: 'failure',
    });
  });
});
