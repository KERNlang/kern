import type { ValueIR } from '../../value-ir.js';
import { classifyInternalMachineClassHelperArgument } from './internal-effect-machine-class-value.js';
import type { SemanticEnv } from './semantic-env.js';

type ScalarPreflight = (node: ValueIR, env: SemanticEnv, deferredBindings: ReadonlySet<string>) => void;

export function assertDeferredInternalMachineHelperArgument(
  node: ValueIR,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
  assertScalar: ScalarPreflight,
): void {
  if (classifyInternalMachineClassHelperArgument(node, env) === 'unsupported') {
    throw new Error('portable machine: nested helper argument is outside the resumable domain');
  }
  if (node.kind === 'arrayLit') {
    for (const item of node.items) {
      assertDeferredInternalMachineHelperArgument(item, env, deferredBindings, assertScalar);
    }
    return;
  }
  if (node.kind === 'objectLit') {
    for (const entry of node.entries) {
      if ('kind' in entry) throw new Error('portable machine: nested helper record spreads are unsupported');
      assertDeferredInternalMachineHelperArgument(entry.value, env, deferredBindings, assertScalar);
    }
    return;
  }
  assertScalar(node, env, deferredBindings);
}
