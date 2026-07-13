import type { RuntimeCapabilityValue } from '../../runner-capabilities.js';
import type { IRNode } from '../../types.js';
import {
  type NodeContract,
  type NodeFixture,
  registerContract,
  type SemanticEnv,
} from './index.js';
import { invokeInternalRuntimeCapabilitySync } from './internal-capability-interceptor.js';
import {
  capabilityInputWithEvaluator,
  isCapabilityToken,
  prepareInternalCapabilityEffectWithEvaluator,
  resumeInternalCapabilityEffect,
  type PreparedInternalCapabilityEffect,
} from './capability-runtime.js';
import { evalPortableValue } from './portable-scalar.js';
import type { Trace } from './trace.js';

export { isCapabilityToken, resumeInternalCapabilityEffect } from './capability-runtime.js';
export type { PreparedInternalCapabilityEffect } from './capability-runtime.js';

export function capabilityInput(ir: IRNode, env: SemanticEnv): RuntimeCapabilityValue | undefined {
  return capabilityInputWithEvaluator(ir, env, evalPortableValue);
}

function capabilityPreconditions(ir: IRNode, env: SemanticEnv): boolean {
  try {
    prepareInternalCapabilityEffect(ir, env);
    return true;
  } catch {
    return false;
  }
}

export function prepareInternalCapabilityEffect(ir: IRNode, env: SemanticEnv): PreparedInternalCapabilityEffect {
  return prepareInternalCapabilityEffectWithEvaluator(ir, env, evalPortableValue);
}

function capabilityEffects(ir: IRNode, env: SemanticEnv): Trace {
  const prepared = prepareInternalCapabilityEffect(ir, env);
  const result = invokeInternalRuntimeCapabilitySync(env, prepared.call);
  return resumeInternalCapabilityEffect(prepared, result, env);
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([]);

export const capabilityContract: NodeContract = {
  nodeType: 'capability',
  preconditions: capabilityPreconditions,
  effects: capabilityEffects,
  completion: () => ({ kind: 'normal' }),
  forbiddenRewrites: [
    'read capability implementations from globalThis, process, or other implicit host globals',
    'fall back to a host implementation when a capability is not explicitly registered',
    'invoke Node-only RAG, filesystem, network, crypto, or storage modules from the browser runner entry',
  ],
  fixtures: FIXTURES,
};

let registered = false;

export function registerCapabilityContract(): void {
  if (registered) return;
  registerContract(capabilityContract);
  registered = true;
}

export function _resetCapabilityContractForTest(): void {
  registered = false;
}
