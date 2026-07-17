import { markRunnerMachineRootScope } from './ir/semantics/runner-machine-scope.js';
import type { RunnerModuleScope } from './ir/semantics/semantic-env.js';
import { makeEnv } from './ir/semantics/semantic-env.js';
import { sourceRunnerMachineAdmission } from './ir/semantics/source-runner-admission.js';
import {
  buildRunnerModuleScopes,
  buildSingleModuleRunnerRootScope,
  type RunnerLinkedScopeRecord,
} from './runner-runtime-scope.js';
import type { IRNode } from './types.js';

function entryHandler(root: IRNode, name: string): IRNode | undefined {
  const entry = (root.type === 'document' ? (root.children ?? []) : []).find(
    (node) => node.type === 'fn' && node.props?.name === name,
  );
  const handlers = (entry?.children ?? []).filter((node) => node.type === 'handler' && node.props?.lang === 'kern');
  return handlers.length === 1 ? handlers[0] : undefined;
}

export interface LinkedClassFrameAdmission {
  readonly entryHandler?: IRNode;
  readonly ownsClassFrames: boolean;
  readonly rootScope?: RunnerModuleScope;
}

export function linkedClassFrameAdmission(
  records: readonly RunnerLinkedScopeRecord[],
  rootPath: string,
  root: IRNode,
  entryName: string,
  iterationBudget: number | undefined,
): LinkedClassFrameAdmission {
  const handler = entryHandler(root, entryName);
  if (!handler) return { ownsClassFrames: false };
  let rootScope: RunnerModuleScope | undefined;
  try {
    const scopes = buildRunnerModuleScopes(records);
    rootScope = scopes.get(rootPath);
    if (!rootScope) return { entryHandler: handler, ownsClassFrames: false };
    markRunnerMachineRootScope(rootScope);
    const env = makeEnv({
      runnerFunctions: rootScope.functions,
      runnerClasses: rootScope.classes,
      runnerCallStack: [],
      runnerCallCache: new Map(),
    });
    let ownsClassFrames = false;
    try {
      ownsClassFrames = sourceRunnerMachineAdmission(handler.children ?? [], env, iterationBudget);
    } catch {
      // Structural diagnostics remain owned by execution preflight; planner reachability still uses the linked scope.
    }
    return { entryHandler: handler, ownsClassFrames, rootScope };
  } catch {
    return { entryHandler: handler, ownsClassFrames: false, rootScope };
  }
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
