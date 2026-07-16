import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import {
  makeInternalMachineClassConstructorEnv,
  makeInternalMachineClassMemberEnv,
  prepareInternalMachineClassInstance,
} from './internal-effect-machine-class-activation.js';
import { internalMachineClassConstructorPlan } from './internal-effect-machine-class-construction.js';
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
import { internalMachineClassLineageBaseFirst } from './internal-effect-machine-class-lineage.js';
import { classifyInternalMachineClassScalarValue } from './internal-effect-machine-class-value.js';
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
  type RunnerClassBinding,
  type RunnerClassInstanceValue,
  type RunnerClassMemberBinding,
  type SemanticEnv,
} from './semantic-env.js';
import type { Trace } from './trace.js';

type DeferredScalarPreflight = (node: ValueIR, env: SemanticEnv, deferredBindings: ReadonlySet<string>) => void;

function reconcileConstructorLineageInitialization(
  lineage: readonly RunnerClassBinding[],
  registry: ReadonlyMap<string, RunnerClassBinding>,
  instance: RunnerClassInstanceValue,
): void {
  const initialized = new Set<string>();
  for (const cls of lineage) {
    for (const field of cls.fields) {
      if (typeof field.value === 'string' && field.value !== '') initialized.add(field.name);
      else initialized.delete(field.name);
    }
    for (const statement of internalMachineClassConstructorPlan(cls, registry).body) {
      const field =
        statement.type === 'assign' &&
        (statement.children === undefined || statement.children.length === 0) &&
        typeof statement.props?.target === 'string'
          ? /^this\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(statement.props.target)?.[1]
          : undefined;
      if (field && Object.hasOwn(instance.fields, field)) initialized.add(field);
    }
  }
  for (const field of Object.keys(instance.fields)) {
    if (initialized.has(field)) {
      if (instance.fields[field] === undefined) instance.fields[field] = null;
    } else instance.fields[field] = undefined;
  }
}

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
  const fieldExpressions = lineage.flatMap((candidate) =>
    candidate.fields.flatMap((field) =>
      typeof field.value === 'string' && field.value !== '' ? [parseExpression(field.value)] : [],
    ),
  );
  const argumentExpressions =
    resolved.value.kind === 'new' && resolved.value.argument.kind === 'call' ? resolved.value.argument.args : [];
  for (const expression of argumentExpressions) {
    if (internalMachineHelperCallInValue(expression, env)) {
      throw new Error('machine class: helper calls in class-owned expressions are outside this slice');
    }
  }
  for (const expression of fieldExpressions) {
    if (internalMachineHelperCallInValue(expression, env)) {
      throw new Error('machine class: helper calls in class-owned expressions are outside this slice');
    }
    assertPortableMachineScalarShape(expression, env);
  }
  const argumentDispositions = argumentExpressions.map((argument) =>
    classifyInternalMachineClassScalarValue(argument, env),
  );
  if (argumentDispositions.includes('unsupported')) {
    throw new Error('machine class: constructor argument is outside the resumable scalar domain');
  }
  const prepared =
    evaluateValues && argumentDispositions.every((disposition) => disposition === 'pure')
      ? prepareInternalMachineClassInstance(
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
          for (const [index, argument] of argumentExpressions.entries()) {
            if (argumentDispositions[index] === 'pure') assertPortableMachineScalarShape(argument, env);
            if (deferredBindings && deferredScalarPreflight) deferredScalarPreflight(argument, env, deferredBindings);
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
            constructorEnv: makeInternalMachineClassConstructorEnv(
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
  const constructorBody = internalMachineClassConstructorPlan(resolved.cls, resolved.registry).body;
  const directAssignments = constructorBody.every(
    (statement) =>
      statement.type === 'assign' &&
      (statement.children === undefined || statement.children.length === 0) &&
      typeof statement.props?.target === 'string' &&
      /^this\.[A-Za-z_][A-Za-z0-9_]*$/.test(statement.props.target),
  );
  if (evaluateValues && directAssignments && argumentDispositions.every((disposition) => disposition === 'pure')) {
    for (const statement of constructorBody) assignInternalMachineClassField(statement, constructorEnv, evaluate);
  } else {
    for (const statement of constructorBody) {
      const field =
        statement.type === 'assign' && typeof statement.props?.target === 'string'
          ? /^this\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(statement.props.target)?.[1]
          : undefined;
      if (field && Object.hasOwn(instance.fields, field) && instance.fields[field] === undefined) {
        instance.fields[field] = null;
      }
    }
  }
  reconcileConstructorLineageInitialization(lineage, resolved.registry, instance);
  defineBinding(env, String(node.props?.name), instance);
  return true;
}

function parsePureClassMemberReturn(member: RunnerClassMemberBinding, label: string): ValueIR {
  const statement = member.body[0];
  const raw = statement?.props?.value;
  if (member.body.length !== 1 || statement?.type !== 'return' || typeof raw !== 'string' || raw === '') {
    throw new Error(`machine class: ${label} requires the resumable frame`);
  }
  return parseExpression(raw);
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
  const getterEnv = makeInternalMachineClassMemberEnv(resolved.cls, resolved.getter, receiver, [], env, registry);
  const expression = parsePureClassMemberReturn(
    resolved.getter,
    `getter "${resolved.cls.name}.${resolved.getter.name}"`,
  );
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
  const methodEnv = makeInternalMachineClassMemberEnv(resolved.cls, resolved.method, receiver, values, env, registry);
  const expression = parsePureClassMemberReturn(
    resolved.method,
    `method "${resolved.cls.name}.${resolved.method.name}"`,
  );
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
