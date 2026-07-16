import { internalEffectMachineStateForEnv } from './internal-effect-machine-helper-state.js';
import { isRunnerClassInstanceValue } from './portable-scalar-domain.js';
import { getBinding, hasBinding, type RunnerClassInstanceValue, type SemanticEnv } from './semantic-env.js';

const classInstanceOwner = Symbol('internalMachineClassInstanceOwner');
export const INTERNAL_MACHINE_PREFLIGHT_CLASS_OWNER = Object.freeze({ kind: 'preflight-class-owner' });

type OwnedClassInstance = RunnerClassInstanceValue & {
  [classInstanceOwner]?: object;
};

export function ownInternalMachineClassInstance(
  instance: RunnerClassInstanceValue,
  owner: object,
): RunnerClassInstanceValue {
  Object.defineProperty(instance, classInstanceOwner, {
    configurable: false,
    enumerable: false,
    value: owner,
    writable: false,
  });
  return instance;
}

export function internalMachineClassReceiver(name: string, env: SemanticEnv): RunnerClassInstanceValue | undefined {
  const value = name === 'this' ? env.runnerThis : hasBinding(env, name) ? getBinding(env, name) : undefined;
  if (!isRunnerClassInstanceValue(value)) return undefined;
  const owner = (value as OwnedClassInstance)[classInstanceOwner];
  const state = internalEffectMachineStateForEnv(env);
  return owner === INTERNAL_MACHINE_PREFLIGHT_CLASS_OWNER || (state !== undefined && owner === state)
    ? value
    : undefined;
}
