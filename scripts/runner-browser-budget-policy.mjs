import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export function loadRunnerBrowserBudgetPolicy(path) {
  let policy;
  try {
    policy = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`runner browser budget policy is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (policy?.schemaVersion !== 1 || typeof policy.baseline !== 'object' || typeof policy.limits !== 'object') {
    throw new Error('runner browser budget policy must use schemaVersion 1 with baseline and limits objects');
  }
  if (typeof policy.transition !== 'object') {
    throw new Error('runner browser budget policy must define its transition lifecycle');
  }
  const integers = [
    ['baseline.measuredRawBytes', policy.baseline.measuredRawBytes],
    ['baseline.measuredGzipBytes', policy.baseline.measuredGzipBytes],
    ['baseline.measuredModules', policy.baseline.measuredModules],
    ['limits.maxInternalRawBytes', policy.limits.maxInternalRawBytes],
    ['limits.maxInternalGzipBytes', policy.limits.maxInternalGzipBytes],
    ['limits.maxColdImportExecuteMs', policy.limits.maxColdImportExecuteMs],
    ['limits.maxBrowserImportExecuteMs', policy.limits.maxBrowserImportExecuteMs],
    ['limits.coldStartRuns', policy.limits.coldStartRuns],
    ['limits.browserStartRuns', policy.limits.browserStartRuns],
    ['limits.cdpTimeoutMs', policy.limits.cdpTimeoutMs],
    ['transition.preTransitionMaxInternalRawBytes', policy.transition.preTransitionMaxInternalRawBytes],
    ['transition.preTransitionMaxInternalGzipBytes', policy.transition.preTransitionMaxInternalGzipBytes],
  ];
  for (const [name, value] of integers) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`runner browser budget policy ${name} must be a positive safe integer`);
    }
  }
  if (typeof policy.baseline.milestone !== 'string' || policy.baseline.milestone === '') {
    throw new Error('runner browser budget policy baseline.milestone must be non-empty');
  }
  const legacyModule = policy.transition.legacyModule;
  if (
    typeof legacyModule !== 'string' ||
    legacyModule === '' ||
    isAbsolute(legacyModule) ||
    legacyModule.split(/[\\/]/u).some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('runner browser budget policy transition.legacyModule must be a safe relative module path');
  }
  return policy;
}

export function assertRunnerBrowserBudgetLifecycle(policy, visitedModules, distRoot) {
  const legacyModule = resolve(distRoot, policy.transition.legacyModule);
  if (visitedModules.has(legacyModule)) return;
  const rawCeilingRaised = policy.limits.maxInternalRawBytes > policy.transition.preTransitionMaxInternalRawBytes;
  const gzipCeilingRaised = policy.limits.maxInternalGzipBytes > policy.transition.preTransitionMaxInternalGzipBytes;
  if (!rawCeilingRaised && !gzipCeilingRaised) return;
  throw new Error('runner legacy compatibility module left the browser graph; restore pre-transition byte ceilings');
}
