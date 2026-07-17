import { internalEffectMachineStateForEnv } from './internal-effect-machine-helper-state.js';
import type { RunnerFunctionBinding, SemanticEnv } from './semantic-env.js';

const PORTABLE_SCALAR_RETURN_TYPES = new Set(['boolean', 'null', 'number', 'string']);

function helperRegistryForEnv(env: SemanticEnv): ReadonlyMap<string, RunnerFunctionBinding> | undefined {
  return internalEffectMachineStateForEnv(env)?.helperRegistry ?? env.runnerFunctions;
}

export function isPortableScalarHelperReturnContract(returns: unknown): boolean {
  if (typeof returns !== 'string') return false;
  const members = returns
    .split('|')
    .map((member) => member.trim())
    .filter(Boolean);
  return members.length > 0 && members.every((member) => PORTABLE_SCALAR_RETURN_TYPES.has(member));
}

export function isInternalMachineHelperCall(name: string, arity: number, env: SemanticEnv): boolean {
  const fn = helperRegistryForEnv(env)?.get(name);
  return fn !== undefined && fn.params.length === arity;
}

export function isInternalMachineScalarHelperCall(name: string, arity: number, env: SemanticEnv): boolean {
  const fn = helperRegistryForEnv(env)?.get(name);
  return fn !== undefined && fn.params.length === arity && isPortableScalarHelperReturnContract(fn.returns);
}
