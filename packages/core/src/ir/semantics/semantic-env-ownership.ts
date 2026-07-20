import type { SemanticEnv } from './semantic-env.js';

const ENVIRONMENT_FIELDS = [
  'bindings',
  'intProvenance',
  'freshArrayBindings',
  'pushBuiltFreshArrayBindings',
  'capturedArrayBindings',
  'recordArrayFields',
  'runnerFunctions',
  'runnerClasses',
  'runnerCallStack',
  'runnerCallCache',
  'runnerThis',
  'runnerSuperClass',
  'runnerProtectedClassInstances',
  'capabilities',
  'capabilityContext',
  'intIndexCtx',
  'parent',
  'repeatableLoopBody',
  'seed',
  'now',
] as const satisfies readonly (keyof SemanticEnv)[];

interface DataPropertyFact {
  readonly configurable: boolean;
  readonly enumerable: boolean;
  readonly value: unknown;
  readonly writable: boolean;
}

interface SemanticEnvironmentFact {
  readonly fields: readonly (readonly [keyof SemanticEnv, DataPropertyFact])[];
  readonly parent: SemanticEnv | undefined;
}

const environmentFacts = new WeakMap<SemanticEnv, SemanticEnvironmentFact>();

function dataPropertyFact(env: SemanticEnv, key: keyof SemanticEnv): DataPropertyFact | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(env, key);
  if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined || !('value' in descriptor)) {
    return undefined;
  }
  return {
    configurable: descriptor.configurable ?? false,
    enumerable: descriptor.enumerable ?? false,
    value: descriptor.value,
    writable: descriptor.writable ?? false,
  };
}

function captureEnvironmentFact(env: SemanticEnv, parent: SemanticEnv | undefined): void {
  const fields: Array<readonly [keyof SemanticEnv, DataPropertyFact]> = [];
  for (const key of ENVIRONMENT_FIELDS) {
    const field = dataPropertyFact(env, key);
    if (!field) return;
    fields.push([key, field]);
  }
  environmentFacts.set(env, { fields, parent });
}

export function markRootSemanticEnvironment(env: SemanticEnv): void {
  captureEnvironmentFact(env, undefined);
}

export function markChildSemanticEnvironment(env: SemanticEnv, parent: SemanticEnv): void {
  if (!isExactSemanticEnvironment(parent)) return;
  captureEnvironmentFact(env, parent);
}

/** Exact private construction fact; reads descriptors without invoking accessors. */
export function isExactSemanticEnvironment(env: SemanticEnv): boolean {
  const fact = environmentFacts.get(env);
  if (!fact || Object.getPrototypeOf(env) !== Object.prototype) return false;
  for (let index = 0; index < fact.fields.length; index += 1) {
    const [key, expected] = fact.fields[index];
    const current = dataPropertyFact(env, key);
    if (
      !current ||
      current.configurable !== expected.configurable ||
      current.enumerable !== expected.enumerable ||
      current.writable !== expected.writable ||
      !Object.is(current.value, expected.value)
    ) {
      return false;
    }
  }
  return true;
}

/** Undefined means either an authentic root or no fact; check exactness first. */
export function exactSemanticEnvironmentParent(env: SemanticEnv): SemanticEnv | undefined {
  return environmentFacts.get(env)?.parent;
}
