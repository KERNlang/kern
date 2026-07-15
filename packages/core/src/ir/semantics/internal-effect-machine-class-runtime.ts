import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { internalMachineClassForNew } from './internal-effect-machine-class-graph.js';
import { internalMachineHelperCallInValue } from './internal-effect-machine-helper-graph.js';
import { bindInternalEffectMachineState, internalEffectMachineStateForEnv } from './internal-effect-machine-helper-state.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import { assertPortableMachineScalarShape } from './portable-machine-shape.js';
import { assertPortableScalar, isRunnerClassInstanceValue, type PortableScalar } from './portable-scalar-domain.js';
import { defineBinding, getBinding, hasBinding, makeEnv, type RunnerClassBinding, type RunnerClassInstanceValue, type SemanticEnv } from './semantic-env.js';
import type { Trace } from './trace.js';

const classInstanceOwner = Symbol('internalMachineClassInstanceOwner');
const preflightClassOwner = Object.freeze({ kind: 'preflight-class-owner' });
type OwnedClassInstance = RunnerClassInstanceValue & {
  [classInstanceOwner]?: object;
};
type DeferredScalarPreflight = (node: ValueIR, env: SemanticEnv, deferredBindings: ReadonlySet<string>) => void;

function ownClassInstance(instance: RunnerClassInstanceValue, owner: object): RunnerClassInstanceValue {
  Object.defineProperty(instance, classInstanceOwner, {
    configurable: false,
    enumerable: false,
    value: owner,
    writable: false,
  });
  return instance;
}

function classNew(node: IRNode, env: SemanticEnv): { readonly cls: RunnerClassBinding; readonly value: ValueIR } | undefined {
  if (node.type !== 'let' || typeof node.props?.value !== 'string') return undefined;
  const value = parseExpression(node.props.value);
  const cls = internalMachineClassForNew(value, env);
  return cls ? { cls, value } : undefined;
}

function constructorArguments(value: ValueIR, cls: RunnerClassBinding, env: SemanticEnv, evaluate: EvalPortableValue): readonly PortableScalar[] {
  if (value.kind !== 'new' || value.argument.kind !== 'call') throw new Error('machine class: expected construction');
  const params = cls.constructor?.params ?? [];
  if (value.argument.args.length !== params.length) {
    throw new Error(`machine class: constructor "${cls.name}" expects ${params.length} arguments, got ${value.argument.args.length}`);
  }
  return value.argument.args.map((argument) => {
    assertPortableMachineScalarShape(argument, env);
    return evaluate(argument, env);
  });
}

function initializeFields(cls: RunnerClassBinding, env: SemanticEnv, evaluate: EvalPortableValue): Record<string, unknown> {
  const fields = Object.create(null) as Record<string, unknown>;
  for (const field of cls.fields) {
    if (typeof field.value === 'string' && field.value !== '') {
      const expression = parseExpression(field.value);
      assertPortableMachineScalarShape(expression, env);
      fields[field.name] = evaluate(expression, env);
    } else fields[field.name] = undefined;
  }
  return fields;
}

function makeConstructorEnv(cls: RunnerClassBinding, instance: RunnerClassInstanceValue, values: readonly PortableScalar[], env: SemanticEnv): SemanticEnv {
  const params = cls.constructor?.params ?? [];
  return makeEnv({
    bindings: new Map(params.map((param, index) => [param, values[index]])),
    runnerCallCache: env.runnerCallCache,
    runnerCallStack: [...(env.runnerCallStack ?? []), `${cls.name}.constructor`],
    runnerClasses: env.runnerClasses,
    runnerFunctions: env.runnerFunctions,
    runnerThis: instance,
    seed: env.seed,
    now: env.now,
  });
}

function prepareInstance(
  value: ValueIR,
  cls: RunnerClassBinding,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  owner: object,
): {
  readonly constructorEnv: SemanticEnv;
  readonly instance: RunnerClassInstanceValue;
} {
  const values = constructorArguments(value, cls, env, evaluate);
  const instance = ownClassInstance(
    {
      __kernRunnerClassInstance: true,
      className: cls.name,
      fields: initializeFields(cls, env, evaluate),
      ...(cls.module ? { module: cls.module } : {}),
    },
    owner,
  );
  return {
    constructorEnv: makeConstructorEnv(cls, instance, values, env),
    instance,
  };
}

export function preflightInternalMachineClassLet(
  node: IRNode,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  evaluateValues = true,
  deferredBindings?: ReadonlySet<string>,
  deferredScalarPreflight?: DeferredScalarPreflight,
): boolean {
  const resolved = classNew(node, env);
  if (!resolved) return false;
  const constructorExpressions = (resolved.cls.constructor?.body ?? []).map((statement) => parseExpression(String(statement.props?.value)));
  const fieldExpressions = resolved.cls.fields.flatMap((field) => (typeof field.value === 'string' && field.value !== '' ? [parseExpression(field.value)] : []));
  const argumentExpressions = resolved.value.kind === 'new' && resolved.value.argument.kind === 'call' ? resolved.value.argument.args : [];
  for (const expression of [...argumentExpressions, ...fieldExpressions, ...constructorExpressions]) {
    if (internalMachineHelperCallInValue(expression, env)) {
      throw new Error('machine class: helper calls in class-owned expressions are outside this slice');
    }
  }
  const prepared = evaluateValues
    ? prepareInstance(resolved.value, resolved.cls, env, evaluate, preflightClassOwner)
    : (() => {
        if (resolved.value.kind !== 'new' || resolved.value.argument.kind !== 'call') {
          throw new Error('machine class: expected construction');
        }
        const params = resolved.cls.constructor?.params ?? [];
        if (resolved.value.argument.args.length !== params.length) {
          throw new Error(`machine class: constructor "${resolved.cls.name}" has invalid arity`);
        }
        for (const argument of argumentExpressions) {
          assertPortableMachineScalarShape(argument, env);
          if (deferredBindings && deferredScalarPreflight) {
            deferredScalarPreflight(argument, env, deferredBindings);
          }
        }
        for (const expression of fieldExpressions) {
          assertPortableMachineScalarShape(expression, env);
          if (deferredBindings && deferredScalarPreflight) {
            deferredScalarPreflight(expression, env, deferredBindings);
          }
        }
        const fields = Object.create(null) as Record<string, unknown>;
        for (const field of resolved.cls.fields) {
          fields[field.name] = typeof field.value === 'string' && field.value !== '' ? null : undefined;
        }
        const instance = ownClassInstance(
          {
            __kernRunnerClassInstance: true,
            className: resolved.cls.name,
            fields,
            ...(resolved.cls.module ? { module: resolved.cls.module } : {}),
          },
          preflightClassOwner,
        );
        return {
          constructorEnv: makeConstructorEnv(
            resolved.cls,
            instance,
            params.map(() => null),
            env,
          ),
          instance,
        };
      })();
  const { constructorEnv, instance } = prepared;
  const constructorDeferredBindings = deferredBindings ? new Set([...deferredBindings, ...(resolved.cls.constructor?.params ?? [])]) : undefined;
  for (const [index, statement] of (resolved.cls.constructor?.body ?? []).entries()) {
    const expression = constructorExpressions[index];
    assertPortableMachineScalarShape(expression, constructorEnv);
    if (!evaluateValues && constructorDeferredBindings && deferredScalarPreflight) {
      deferredScalarPreflight(expression, constructorEnv, constructorDeferredBindings);
    }
    if (evaluateValues) assignInternalMachineClassField(statement, constructorEnv, evaluate);
    else {
      const field = /^this\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(String(statement.props?.target))?.[1];
      if (field) instance.fields[field] = null;
    }
  }
  defineBinding(env, String(node.props?.name), instance);
  return true;
}

export function evalInternalMachineClassNew(node: IRNode, env: SemanticEnv, evaluate: EvalPortableValue): RunnerClassInstanceValue | undefined {
  const resolved = classNew(node, env);
  if (!resolved) return undefined;
  const state = internalEffectMachineStateForEnv(env);
  const cls = state?.classRegistry?.get(resolved.cls.name);
  const bodyRunner = state?.helperBodyRunner;
  if (!state || !cls || !bodyRunner) throw new Error(`machine class: "${resolved.cls.name}" is unavailable`);
  const { constructorEnv, instance } = prepareInstance(resolved.value, cls, env, evaluate, state);
  const body = cls.constructor?.body ?? [];
  if (body.length === 0) return instance;
  const restore = bindInternalEffectMachineState(constructorEnv, state);
  try {
    const step = bodyRunner(body, constructorEnv, state).next();
    if (!step.done) throw new Error(`machine class: constructor "${cls.name}" produced effects`);
    if (step.value.completion.kind !== 'normal') {
      throw new Error(`machine class: constructor "${cls.name}" completed abnormally`);
    }
    return instance;
  } finally {
    restore();
  }
}

function classReceiver(name: string, env: SemanticEnv): RunnerClassInstanceValue | undefined {
  const value = name === 'this' ? env.runnerThis : hasBinding(env, name) ? getBinding(env, name) : undefined;
  if (!isRunnerClassInstanceValue(value)) return undefined;
  const owner = (value as OwnedClassInstance)[classInstanceOwner];
  const state = internalEffectMachineStateForEnv(env);
  return owner === preflightClassOwner || (state !== undefined && owner === state) ? value : undefined;
}

export function evalInternalMachineClassMember(node: Extract<ValueIR, { kind: 'member' }>, env: SemanticEnv): PortableScalar | undefined {
  if (node.optional || node.object.kind !== 'ident') return undefined;
  const receiver = classReceiver(node.object.name, env);
  if (!receiver) return undefined;
  if (!Object.hasOwn(receiver.fields, node.property)) {
    throw new Error(`machine class: class "${receiver.className}" has no field "${node.property}"`);
  }
  return assertPortableScalar(receiver.fields[node.property], `field "${node.property}"`);
}

export function assignInternalMachineClassField(node: IRNode, env: SemanticEnv, evaluate: EvalPortableValue, mutate = true): Trace | undefined {
  const target = node.props?.target;
  const match = typeof target === 'string' ? /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(target) : null;
  if (!match) return undefined;
  const targetName = target as string;
  if (node.props?.op !== undefined && node.props.op !== '' && node.props.op !== '=') {
    throw new Error('machine class: field assignment supports only "="');
  }
  const receiver = classReceiver(match[1], env);
  if (!receiver) throw new Error(`machine class: receiver "${match[1]}" is not an instance`);
  if (!Object.hasOwn(receiver.fields, match[2])) {
    throw new Error(`machine class: class "${receiver.className}" has no field "${match[2]}"`);
  }
  const raw = node.props?.value;
  if (typeof raw !== 'string' || raw === '') throw new Error('machine class: field assignment value is required');
  const expression = parseExpression(raw);
  assertPortableMachineScalarShape(expression, env);
  const value = mutate ? evaluate(expression, env) : null;
  if (mutate) receiver.fields[match[2]] = value;
  return {
    completion: { kind: 'normal' },
    events: [{ op: 'assign', target: targetName, value }],
  };
}
