import type { IRNode } from '../../types.js';
import { assertDeferredMachineScalarPreflight } from './deferred-expression-preflight.js';
import { preflightInternalMachineClassLet } from './internal-effect-machine-class-runtime.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import type { SemanticEnv } from './semantic-env.js';

export function preflightDeferredInternalMachineClassLet(node: IRNode, env: SemanticEnv, evaluate: EvalPortableValue, deferredBindings: ReadonlySet<string>): boolean {
  return preflightInternalMachineClassLet(node, env, evaluate, false, deferredBindings, assertDeferredMachineScalarPreflight);
}
