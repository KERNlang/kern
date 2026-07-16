import { parseExpression } from '../../parser-expression.js';
import type { ValueIR } from '../../value-ir.js';
import { ownInternalMachineClassInstance } from './internal-effect-machine-class-instance.js';
import { internalMachineClassLineageBaseFirst } from './internal-effect-machine-class-lineage.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import { assertPortableMachineScalarShape } from './portable-machine-shape.js';
import type { PortableScalar } from './portable-scalar-domain.js';
import {
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassInstanceValue,
  type RunnerClassMemberBinding,
  type SemanticEnv,
} from './semantic-env.js';

export function internalMachineClassConstructorArgumentNodes(
  value: ValueIR,
  cls: RunnerClassBinding,
): readonly ValueIR[] {
  if (value.kind !== 'new' || value.argument.kind !== 'call') {
    throw new Error('machine class: expected construction');
  }
  const args = value.argument.args;
  const params = cls.constructor?.params ?? [];
  if (args.length !== params.length) {
    throw new Error(`machine class: constructor "${cls.name}" expects ${params.length} arguments, got ${args.length}`);
  }
  return args;
}

export function evaluateInternalMachineClassConstructorArguments(
  value: ValueIR,
  cls: RunnerClassBinding,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): readonly PortableScalar[] {
  return internalMachineClassConstructorArgumentNodes(value, cls).map((argument) => {
    assertPortableMachineScalarShape(argument, env);
    return evaluate(argument, env);
  });
}

export function initializeInternalMachineClassFields(
  cls: RunnerClassBinding,
  registry: ReadonlyMap<string, RunnerClassBinding>,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): Record<string, unknown> {
  const fields = Object.create(null) as Record<string, unknown>;
  for (const candidate of internalMachineClassLineageBaseFirst(cls, registry)) {
    initializeInternalMachineClassLayerFields(candidate, fields, env, evaluate);
  }
  return fields;
}

export function initializeInternalMachineClassLayerFields(
  cls: RunnerClassBinding,
  fields: Record<string, unknown>,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): void {
  for (const field of cls.fields) {
    if (typeof field.value === 'string' && field.value !== '') {
      const expression = parseExpression(field.value);
      assertPortableMachineScalarShape(expression, env);
      fields[field.name] = evaluate(expression, env);
    } else fields[field.name] = undefined;
  }
}

export function createInternalMachineClassReceiver(cls: RunnerClassBinding, owner: object): RunnerClassInstanceValue {
  return ownInternalMachineClassInstance(
    {
      __kernRunnerClassInstance: true,
      className: cls.name,
      fields: Object.create(null) as Record<string, unknown>,
      ...(cls.module ? { module: cls.module } : {}),
    },
    owner,
  );
}

export function makeInternalMachineClassConstructorEnv(
  cls: RunnerClassBinding,
  instance: RunnerClassInstanceValue,
  values: readonly PortableScalar[],
  env: SemanticEnv,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): SemanticEnv {
  const params = cls.constructor?.params ?? [];
  return makeEnv({
    bindings: new Map(params.map((param, index) => [param, values[index]])),
    capabilities: env.capabilities,
    capabilityContext: env.capabilityContext,
    runnerCallCache: env.runnerCallCache,
    runnerCallStack: [...(env.runnerCallStack ?? []), `${cls.name}.constructor`],
    runnerClasses: new Map(registry),
    runnerFunctions: env.runnerFunctions,
    runnerSuperClass: cls.extendsName,
    runnerThis: instance,
    seed: env.seed,
    now: env.now,
  });
}

export function makeInternalMachineClassMemberEnv(
  cls: RunnerClassBinding,
  member: RunnerClassMemberBinding,
  instance: RunnerClassInstanceValue,
  values: readonly PortableScalar[],
  env: SemanticEnv,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): SemanticEnv {
  return makeEnv({
    bindings: new Map(member.params.map((param, index) => [param, values[index]])),
    capabilities: env.capabilities,
    capabilityContext: env.capabilityContext,
    runnerCallCache: env.runnerCallCache,
    runnerCallStack: [...(env.runnerCallStack ?? []), `${cls.name}.${member.name}`],
    runnerClasses: new Map(registry),
    runnerFunctions: env.runnerFunctions,
    runnerSuperClass: cls.extendsName,
    runnerThis: instance,
    seed: env.seed,
    now: env.now,
  });
}

export function createInternalMachineClassInstance(
  cls: RunnerClassBinding,
  env: SemanticEnv,
  values: readonly PortableScalar[],
  evaluate: EvalPortableValue,
  owner: object,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): {
  readonly constructorEnv: SemanticEnv;
  readonly instance: RunnerClassInstanceValue;
} {
  const instance = ownInternalMachineClassInstance(
    {
      __kernRunnerClassInstance: true,
      className: cls.name,
      fields: initializeInternalMachineClassFields(cls, registry, env, evaluate),
      ...(cls.module ? { module: cls.module } : {}),
    },
    owner,
  );
  return {
    constructorEnv: makeInternalMachineClassConstructorEnv(cls, instance, values, env, registry),
    instance,
  };
}

export function prepareInternalMachineClassInstance(
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
  return createInternalMachineClassInstance(
    cls,
    env,
    evaluateInternalMachineClassConstructorArguments(value, cls, env, evaluate),
    evaluate,
    owner,
    registry,
  );
}
