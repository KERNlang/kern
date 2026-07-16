import { makeEnv } from './ir/semantics/semantic-env.js';
import { sourceRunnerMachineAdmission } from './ir/semantics/source-runner-admission.js';
import { buildSingleModuleRunnerRootScope } from './runner-runtime-scope.js';
import type { IRNode } from './types.js';

function entryHandler(root: IRNode, name: string): IRNode | undefined {
  const entry = (root.type === 'document' ? (root.children ?? []) : []).find(
    (node) => node.type === 'fn' && node.props?.name === name,
  );
  const handlers = (entry?.children ?? []).filter((node) => node.type === 'handler' && node.props?.lang === 'kern');
  return handlers.length === 1 ? handlers[0] : undefined;
}

export function ownsSingleModuleClassFrames(
  root: IRNode,
  entryName: string,
  iterationBudget: number | undefined,
): boolean {
  const handler = entryHandler(root, entryName);
  if (!handler) return false;
  try {
    const scope = buildSingleModuleRunnerRootScope(root);
    if (scope.classes.size === 0) return false;
    const env = makeEnv({
      runnerFunctions: scope.functions,
      runnerClasses: scope.classes,
      runnerCallStack: [],
      runnerCallCache: new Map(),
    });
    return sourceRunnerMachineAdmission(handler.children ?? [], env, iterationBudget);
  } catch {
    return false;
  }
}
