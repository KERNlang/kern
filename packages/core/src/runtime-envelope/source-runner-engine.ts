import { INTERNAL_EFFECT_MACHINE_FORMAT } from '../ir/semantics/internal-effect-machine-types.js';
import type { SemanticEnv } from '../ir/semantics/semantic-env.js';
import { sourceRunnerMachineAdmission } from '../ir/semantics/source-runner-admission.js';
import type { Trace } from '../ir/semantics/trace.js';
import type { IRNode } from '../types.js';
import {
  type InternalRuntimeAsyncOptions,
  runInternalRuntimeEngineAsync,
  runInternalRuntimeEngineSync,
} from './internal-engine.js';
import {
  ensureSourceRunnerContractsRegistered,
  runSourceRunnerLegacyAsync,
  runSourceRunnerLegacySync,
} from './source-runner-legacy.js';

export { SourceRunnerLegacyError } from './source-runner-legacy.js';

export const SOURCE_RUNNER_ENGINE = Object.freeze({
  legacy: 'legacy',
  machine: INTERNAL_EFFECT_MACHINE_FORMAT,
} as const);

export type SourceRunnerEngine = (typeof SOURCE_RUNNER_ENGINE)[keyof typeof SOURCE_RUNNER_ENGINE];
export type SourceRunnerPolicy = 'compatible' | 'machine-only';

export interface SourceRunnerEngineOptions extends InternalRuntimeAsyncOptions {
  readonly policy: SourceRunnerPolicy;
  readonly iterationBudget?: number;
}

export class SourceRunnerEngineError extends Error {
  constructor(readonly code: 'invalid-iteration-budget' | 'machine-only-rejected') {
    super(`source runner engine: ${code}`);
    this.name = 'SourceRunnerEngineError';
  }
}

function validateIterationBudget(value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SourceRunnerEngineError('invalid-iteration-budget');
  }
}

export function selectSourceRunnerEngine(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: Pick<SourceRunnerEngineOptions, 'iterationBudget'>,
): SourceRunnerEngine {
  validateIterationBudget(options.iterationBudget);
  return sourceRunnerMachineAdmission(nodes, env, options.iterationBudget)
    ? SOURCE_RUNNER_ENGINE.machine
    : SOURCE_RUNNER_ENGINE.legacy;
}

function selectedEngine(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: SourceRunnerEngineOptions,
): SourceRunnerEngine {
  const selected = selectSourceRunnerEngine(nodes, env, options);
  if (options.policy === 'machine-only' && selected !== SOURCE_RUNNER_ENGINE.machine) {
    throw new SourceRunnerEngineError('machine-only-rejected');
  }
  return selected;
}

export function executeSourceRunnerSync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: SourceRunnerEngineOptions,
): Trace {
  ensureSourceRunnerContractsRegistered();
  if (selectedEngine(nodes, env, options) === SOURCE_RUNNER_ENGINE.machine) {
    return runInternalRuntimeEngineSync(nodes, env, options.iterationBudget);
  }
  return runSourceRunnerLegacySync(nodes, env);
}

export async function executeSourceRunnerAsync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: SourceRunnerEngineOptions,
): Promise<Trace> {
  ensureSourceRunnerContractsRegistered();
  if (selectedEngine(nodes, env, options) === SOURCE_RUNNER_ENGINE.machine) {
    return runInternalRuntimeEngineAsync(nodes, env, options);
  }
  return runSourceRunnerLegacyAsync(nodes, env, options);
}
