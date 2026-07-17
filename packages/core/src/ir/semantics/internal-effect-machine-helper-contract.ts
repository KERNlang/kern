import { internalEffectMachineStateForEnv } from './internal-effect-machine-helper-state.js';
import { internalMachineFunctionForEnv } from './internal-effect-machine-module-graph.js';
import type { RunnerFunctionBinding, SemanticEnv } from './semantic-env.js';

const PORTABLE_SCALAR_RETURN_TYPES = new Set(['boolean', 'null', 'number', 'string']);

function helperRegistryForEnv(env: SemanticEnv): ReadonlyMap<string, RunnerFunctionBinding> | undefined {
  const state = internalEffectMachineStateForEnv(env);
  if (state?.moduleGraph) {
    const scope = state.moduleGraph.scopeByFunctions.get(env.runnerFunctions ?? state.moduleGraph.root.functions);
    if (scope) return scope.functions;
  }
  return state?.helperRegistry ?? env.runnerFunctions;
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

export function isInternalMachineResumableHelperCall(name: string, arity: number, env: SemanticEnv): boolean {
  const state = internalEffectMachineStateForEnv(env);
  const fn = state?.moduleGraph
    ? internalMachineFunctionForEnv(state.moduleGraph, env, name)
    : (state?.helperRegistry?.get(name) ?? env.runnerFunctions?.get(name));
  return (
    fn?.params.length === arity &&
    (state?.resumableHelpers ? state.resumableHelpers.has(fn) : state?.resumableHelperNames?.has(name) === true)
  );
}
