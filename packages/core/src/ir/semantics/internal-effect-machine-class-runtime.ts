import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import {
  internalMachineClassForNew,
  internalMachineClassGetterForRead,
  internalMachineClassMethodForCall,
  internalMachineClassRegistryForEnv,
} from './internal-effect-machine-class-graph.js';
import {
  INTERNAL_MACHINE_PREFLIGHT_CLASS_OWNER,
  internalMachineClassReceiver,
  ownInternalMachineClassInstance,
} from './internal-effect-machine-class-instance.js';
import {
  internalMachineClassLineageBaseFirst,
  internalMachineClassVisibleFields,
} from './internal-effect-machine-class-lineage.js';
import { internalMachineHelperCallInValue } from './internal-effect-machine-helper-graph.js';
import {
  bindInternalEffectMachineState,
  internalEffectMachineStateForEnv,
} from './internal-effect-machine-helper-state.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import { assertPortableMachineScalarShape } from './portable-machine-shape.js';
import { assertPortableScalar, type PortableScalar } from './portable-scalar-domain.js';
import {
  defineBinding,
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassInstanceValue,
  type RunnerClassMemberBinding,
  type SemanticEnv,
} from './semantic-env.js';
import type { Trace } from './trace.js';

type DeferredScalarPreflight = (node: ValueIR, env: SemanticEnv, deferredBindings: ReadonlySet<string>) => void;

function classNew(
  node: IRNode,
  env: SemanticEnv,
):
  | {
      readonly cls: RunnerClassBinding;
      readonly registry: ReadonlyMap<string, RunnerClassBinding>;
      readonly value: ValueIR;
    }
  | undefined {
  if (node.type !== 'let' || typeof node.props?.value !== 'string') return undefined;
  const value = parseExpression(node.props.value);
  const cls = internalMachineClassForNew(value, env);
  if (!cls) return undefined;
  const registry = internalMachineClassRegistryForEnv(env);
  const admitted = registry.get(cls.name);
  return admitted ? { cls: admitted, registry, value } : undefined;
}

function constructorArguments(
  value: ValueIR,
  cls: RunnerClassBinding,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): readonly PortableScalar[] {
  if (value.kind !== 'new' || value.argument.kind !== 'call') throw new Error('machine class: expected construction');
  const params = cls.constructor?.params ?? [];
  if (value.argument.args.length !== params.length) {
    throw new Error(
      `machine class: constructor "${cls.name}" expects ${params.length} arguments, got ${value.argument.args.length}`,
    );
  }
  return value.argument.args.map((argument) => {
    assertPortableMachineScalarShape(argument, env);
    return evaluate(argument, env);
  });
}

function initializeFields(
  cls: RunnerClassBinding,
  registry: ReadonlyMap<string, RunnerClassBinding>,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): Record<string, unknown> {
  const fields = Object.create(null) as Record<string, unknown>;
  for (const candidate of internalMachineClassLineageBaseFirst(cls, registry)) {
    for (const field of candidate.fields) {
      if (typeof field.value === 'string' && field.value !== '') {
        const expression = parseExpression(field.value);
        assertPortableMachineScalarShape(expression, env);
        fields[field.name] = evaluate(expression, env);
      } else fields[field.name] = undefined;
    }
  }
  return fields;
}

function makeConstructorEnv(
  cls: RunnerClassBinding,
  instance: RunnerClassInstanceValue,
  values: readonly PortableScalar[],
  env: SemanticEnv,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): SemanticEnv {
  const params = cls.constructor?.params ?? [];
  return makeEnv({
    bindings: new Map(params.map((param, index) => [param, values[index]])),
    runnerCallCache: env.runnerCallCache,
    runnerCallStack: [...(env.runnerCallStack ?? []), `${cls.name}.constructor`],
    runnerClasses: new Map(registry),
    runnerFunctions: env.runnerFunctions,
    runnerThis: instance,
    seed: env.seed,
    now: env.now,
  });
}

function makeMethodEnv(
  cls: RunnerClassBinding,
  method: RunnerClassMemberBinding,
  instance: RunnerClassInstanceValue,
  values: readonly PortableScalar[],
  env: SemanticEnv,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): SemanticEnv {
  return makeEnv({
    bindings: new Map(method.params.map((param, index) => [param, values[index]])),
    runnerCallCache: env.runnerCallCache,
    runnerCallStack: [...(env.runnerCallStack ?? []), `${cls.name}.${method.name}`],
    runnerClasses: new Map(registry),
    runnerFunctions: env.runnerFunctions,
    runnerThis: instance,
    seed: env.seed,
    now: env.now,
  });
}

function assertPureMethodExpression(
  node: ValueIR,
  cls: RunnerClassBinding,
  fields: ReadonlySet<string>,
  params: ReadonlySet<string>,
): void {
  if (node.kind === 'numLit' || node.kind === 'strLit' || node.kind === 'boolLit' || node.kind === 'nullLit') return;
  if (node.kind === 'ident') {
    if (!params.has(node.name)) throw new Error(`machine class: method expression uses non-parameter "${node.name}"`);
    return;
  }
  if (node.kind === 'member') {
    if (node.optional || node.object.kind !== 'ident' || node.object.name !== 'this' || !fields.has(node.property)) {
      throw new Error(`machine class: method member must be visible in the lineage of "${cls.name}"`);
    }
    return;
  }
  if (node.kind === 'unary') {
    assertPureMethodExpression(node.argument, cls, fields, params);
    return;
  }
  if (node.kind === 'binary') {
    assertPureMethodExpression(node.left, cls, fields, params);
    assertPureMethodExpression(node.right, cls, fields, params);
    return;
  }
  if (node.kind === 'conditional') {
    assertPureMethodExpression(node.test, cls, fields, params);
    assertPureMethodExpression(node.consequent, cls, fields, params);
    assertPureMethodExpression(node.alternate, cls, fields, params);
    return;
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    assertPureMethodExpression(node.expression, cls, fields, params);
    return;
  }
  if (node.kind === 'tmplLit') {
    for (const expression of node.expressions) assertPureMethodExpression(expression, cls, fields, params);
    return;
  }
  throw new Error(`machine class: method expression kind "${node.kind}" is outside the pure return domain`);
}

function assertClassMemberBodies(
  cls: RunnerClassBinding,
  instance: RunnerClassInstanceValue,
  env: SemanticEnv,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): void {
  for (const owner of internalMachineClassLineageBaseFirst(cls, registry)) {
    const fields = internalMachineClassVisibleFields(owner, registry);
    for (const member of [...owner.methods.values(), ...owner.getters.values()]) {
      const expression = parseExpression(String(member.body[0]?.props?.value));
      const methodEnv = makeMethodEnv(
        owner,
        member,
        instance,
        member.params.map(() => null),
        env,
        registry,
      );
      assertPortableMachineScalarShape(expression, methodEnv);
      assertPureMethodExpression(expression, owner, fields, new Set(member.params));
    }
  }
}

function prepareInstance(
  value: ValueIR,
  cls: RunnerClassBinding,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  owner: object,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): {
  readonly constructorEnv: SemanticEnv;
  readonly instance: RunnerClassInstanceValue;
} {
  const values = constructorArguments(value, cls, env, evaluate);
  const instance = ownInternalMachineClassInstance(
    {
      __kernRunnerClassInstance: true,
      className: cls.name,
      fields: initializeFields(cls, registry, env, evaluate),
      ...(cls.module ? { module: cls.module } : {}),
    },
    owner,
  );
  return {
    constructorEnv: makeConstructorEnv(cls, instance, values, env, registry),
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
  const lineage = internalMachineClassLineageBaseFirst(resolved.cls, resolved.registry);
  const constructorExpressions = (resolved.cls.constructor?.body ?? []).map((statement) =>
    parseExpression(String(statement.props?.value)),
  );
  const fieldExpressions = lineage.flatMap((candidate) =>
    candidate.fields.flatMap((field) =>
      typeof field.value === 'string' && field.value !== '' ? [parseExpression(field.value)] : [],
    ),
  );
  const argumentExpressions =
    resolved.value.kind === 'new' && resolved.value.argument.kind === 'call' ? resolved.value.argument.args : [];
  for (const expression of [...argumentExpressions, ...fieldExpressions, ...constructorExpressions]) {
    if (internalMachineHelperCallInValue(expression, env)) {
      throw new Error('machine class: helper calls in class-owned expressions are outside this slice');
    }
  }
  const prepared = evaluateValues
    ? prepareInstance(
        resolved.value,
        resolved.cls,
        env,
        evaluate,
        INTERNAL_MACHINE_PREFLIGHT_CLASS_OWNER,
        resolved.registry,
      )
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
        for (const candidate of lineage) {
          for (const field of candidate.fields) {
            fields[field.name] = typeof field.value === 'string' && field.value !== '' ? null : undefined;
          }
        }
        const instance = ownInternalMachineClassInstance(
          {
            __kernRunnerClassInstance: true,
            className: resolved.cls.name,
            fields,
            ...(resolved.cls.module ? { module: resolved.cls.module } : {}),
          },
          INTERNAL_MACHINE_PREFLIGHT_CLASS_OWNER,
        );
        return {
          constructorEnv: makeConstructorEnv(
            resolved.cls,
            instance,
            params.map(() => null),
            env,
            resolved.registry,
          ),
          instance,
        };
      })();
  const { constructorEnv, instance } = prepared;
  assertClassMemberBodies(resolved.cls, instance, env, resolved.registry);
  const constructorDeferredBindings = deferredBindings
    ? new Set([...deferredBindings, ...(resolved.cls.constructor?.params ?? [])])
    : undefined;
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

export function evalInternalMachineClassNew(
  node: IRNode,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): RunnerClassInstanceValue | undefined {
  const resolved = classNew(node, env);
  if (!resolved) return undefined;
  const state = internalEffectMachineStateForEnv(env);
  const registry = state?.classRegistry;
  const cls = registry?.get(resolved.cls.name);
  const bodyRunner = state?.helperBodyRunner;
  if (!state || !registry || !cls || !bodyRunner) {
    throw new Error(`machine class: "${resolved.cls.name}" is unavailable`);
  }
  const { constructorEnv, instance } = prepareInstance(resolved.value, cls, env, evaluate, state, registry);
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

export function evalInternalMachineClassMember(
  node: Extract<ValueIR, { kind: 'member' }>,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): PortableScalar | undefined {
  if (node.optional || node.object.kind !== 'ident') return undefined;
  const receiver = internalMachineClassReceiver(node.object.name, env);
  if (!receiver) return undefined;
  if (Object.hasOwn(receiver.fields, node.property)) {
    return assertPortableScalar(receiver.fields[node.property], `field "${node.property}"`);
  }
  const resolved = internalMachineClassGetterForRead(node, env);
  if (!resolved) {
    throw new Error(`machine class: class "${receiver.className}" has no field or getter "${node.property}"`);
  }
  const registry = internalMachineClassRegistryForEnv(env);
  const getterEnv = makeMethodEnv(resolved.cls, resolved.getter, receiver, [], env, registry);
  const expression = parseExpression(String(resolved.getter.body[0]?.props?.value));
  const state = internalEffectMachineStateForEnv(env);
  const restore = state ? bindInternalEffectMachineState(getterEnv, state) : undefined;
  try {
    return assertPortableScalar(
      evaluate(expression, getterEnv),
      `getter "${resolved.cls.name}.${resolved.getter.name}" return`,
    );
  } finally {
    restore?.();
  }
}

export function evalInternalMachineClassMethod(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): PortableScalar | undefined {
  const resolved = internalMachineClassMethodForCall(node, env);
  if (!resolved) return undefined;
  const receiver = internalMachineClassReceiver(resolved.receiverName, env);
  if (!receiver) return undefined;
  if (node.args.length !== resolved.method.params.length) {
    throw new Error(`machine class: method "${resolved.cls.name}.${resolved.method.name}" has invalid arity`);
  }
  const values = node.args.map((argument) => {
    assertPortableMachineScalarShape(argument, env);
    return evaluate(argument, env);
  });
  const registry = internalMachineClassRegistryForEnv(env);
  const methodEnv = makeMethodEnv(resolved.cls, resolved.method, receiver, values, env, registry);
  const expression = parseExpression(String(resolved.method.body[0]?.props?.value));
  const state = internalEffectMachineStateForEnv(env);
  const restore = state ? bindInternalEffectMachineState(methodEnv, state) : undefined;
  try {
    return assertPortableScalar(
      evaluate(expression, methodEnv),
      `method "${resolved.cls.name}.${resolved.method.name}" return`,
    );
  } finally {
    restore?.();
  }
}

export function assignInternalMachineClassField(
  node: IRNode,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  mutate = true,
): Trace | undefined {
  const target = node.props?.target;
  const match = typeof target === 'string' ? /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(target) : null;
  if (!match) return undefined;
  const targetName = target as string;
  if (node.props?.op !== undefined && node.props.op !== '' && node.props.op !== '=') {
    throw new Error('machine class: field assignment supports only "="');
  }
  const receiver = internalMachineClassReceiver(match[1], env);
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
