import { type AsyncReferenceRunnerOptions, asyncReferenceRunSequence } from '../ir/semantics/async-reference-runner.js';
import { CONTRACT_REGISTRY } from '../ir/semantics/index.js';
import { referenceRunSequence } from '../ir/semantics/reference-runner.js';
import { registerAllContracts, resetAllContractRegistration } from '../ir/semantics/register-all.js';
import type { SemanticEnv } from '../ir/semantics/semantic-env.js';
import type { Trace } from '../ir/semantics/trace.js';
import type { IRNode } from '../types.js';

const REQUIRED_RUNNER_CONTRACTS = [
  'assign',
  'branch',
  'capability',
  'do',
  'each',
  'expression-v1',
  'fmt',
  'for',
  'if',
  'lambda',
  'let',
  'print',
  'return',
  'throw',
  'try',
  'while',
] as const;
const REQUIRED_RUNNER_CONTRACT_SET = new Set<string>(REQUIRED_RUNNER_CONTRACTS);

export class SourceRunnerLegacyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceRunnerLegacyError';
  }
}

function runnerContractsRegistered(): boolean {
  return REQUIRED_RUNNER_CONTRACTS.every((type) => CONTRACT_REGISTRY.has(type));
}

function rebuildRunnerContracts(): void {
  const extraContracts = Array.from(CONTRACT_REGISTRY.entries()).filter(
    ([type]) => !REQUIRED_RUNNER_CONTRACT_SET.has(type),
  );
  CONTRACT_REGISTRY.clear();
  resetAllContractRegistration();
  registerAllContracts();
  for (const [type, contract] of extraContracts) {
    if (!CONTRACT_REGISTRY.has(type)) CONTRACT_REGISTRY.set(type, contract);
  }
}

export function ensureSourceRunnerContractsRegistered(): void {
  if (runnerContractsRegistered()) return;
  let registrationError: unknown;
  try {
    registerAllContracts();
  } catch (error) {
    registrationError = error;
  }
  if (runnerContractsRegistered()) return;
  try {
    rebuildRunnerContracts();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SourceRunnerLegacyError(`runner contract registry is partially initialized: ${reason}`);
  }
  if (runnerContractsRegistered()) return;
  const reason = registrationError instanceof Error ? `: ${registrationError.message}` : '';
  throw new SourceRunnerLegacyError(`runner contract registry is partially initialized${reason}`);
}

export function runSourceRunnerLegacySync(nodes: readonly IRNode[], env: SemanticEnv): Trace {
  ensureSourceRunnerContractsRegistered();
  return referenceRunSequence(nodes, env);
}

export async function runSourceRunnerLegacyAsync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<Trace> {
  ensureSourceRunnerContractsRegistered();
  return asyncReferenceRunSequence(nodes, env, options);
}
