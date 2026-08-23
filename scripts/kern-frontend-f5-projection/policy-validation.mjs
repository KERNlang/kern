import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const COMPOSITION_PATHS = Object.freeze([
  'examples/kern-frontend/f5-canonical-instructions.kern',
  'examples/kern-frontend/f5-framing.kern',
  'examples/kern-frontend/f5-result-frame.kern',
  'examples/kern-frontend/f5-leaf-instructions.kern',
  'examples/kern-frontend/f5-composite-instructions.kern',
  'examples/kern-frontend/f5-expression-projection.kern',
  'examples/kern-frontend/f5-property-projection.kern',
  'examples/kern-frontend/f5-tree-projection.kern',
  'examples/kern-frontend/f5-module-projection.kern',
  'examples/kern-frontend/f5-projection-main.kern',
]);

export const MAPPING_PATHS = Object.freeze([
  'packages/core/src/kir-structural/expression.ts',
  'packages/core/src/kir-structural/handler-type.ts',
  'packages/core/src/kir-structural/branch-path-value.ts',
  'packages/core/src/kir-structural/each-collection-reference.ts',
  'packages/core/src/kir-structural/node.ts',
  'packages/core/src/kir-structural/module-canonical.ts',
  'packages/core/src/kir-structural/module-path.ts',
]);

const POLICY_KEYS = [
  'format', 'resultFormat', 'documentFormat', 'moduleSetFormat', 'f4Policy',
  'mappingAuthorities', 'composition', 'profileLimits', 'canonicalLimits', 'runtimeLimits', 'scheduler',
];
const PROFILE_KEYS = [
  'maxModules', 'maxInstructionScalars', 'maxWorkSteps', 'maxNodes', 'maxDepth',
  'maxCollectionLength', 'maxStringCodePoints',
];
const CANONICAL_KEYS = [
  'maxBytes', 'maxCollectionLength', 'maxDecimalChars', 'maxDepth', 'maxFractionDigits',
  'maxIntegerDigits', 'maxMapEntries', 'maxNodes', 'maxRecordFields', 'maxStringBytes',
];
const RUNTIME_KEYS = [
  'maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxStringBytes',
];

function fail(detail) {
  throw new Error(`F5 projection policy: ${detail}`);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exact(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} keys`);
}

function descriptor(value, path, label) {
  exact(value, ['path', 'sha256'], label);
  if (value.path !== path || !/^[0-9a-f]{64}$/u.test(value.sha256)) fail(`${label} identity`);
}

function positiveLimits(value, keys, label) {
  exact(value, keys, label);
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1) fail(`${label} ${key}`);
  }
}

export function validatePolicy(policy) {
  exact(policy, POLICY_KEYS, 'policy');
  if (policy.format !== 'kern.frontend.f5-projection-policy.1' ||
      policy.resultFormat !== 'kern.frontend.f5-projection.1' ||
      policy.documentFormat !== 'kern.frontend.f4-document.2' ||
      policy.moduleSetFormat !== 'kern.frontend.f4-module-set.4') fail('format identity');
  descriptor(policy.f4Policy, 'scripts/kern-frontend-f4-declarations/policy.json', 'F4 policy');
  if (!Array.isArray(policy.mappingAuthorities) || policy.mappingAuthorities.length !== MAPPING_PATHS.length ||
      !Array.isArray(policy.composition) || policy.composition.length !== COMPOSITION_PATHS.length) fail('descriptor counts');
  MAPPING_PATHS.forEach((path, index) => descriptor(policy.mappingAuthorities[index], path, `mapping ${index}`));
  COMPOSITION_PATHS.forEach((path, index) => descriptor(policy.composition[index], path, `composition ${index}`));
  positiveLimits(policy.profileLimits, PROFILE_KEYS, 'profile limits');
  positiveLimits(policy.canonicalLimits, CANONICAL_KEYS, 'canonical limits');
  positiveLimits(policy.runtimeLimits, RUNTIME_KEYS, 'runtime limits');
  exact(policy.scheduler, ['timeoutMs'], 'scheduler');
  if (!Number.isSafeInteger(policy.scheduler.timeoutMs) || policy.scheduler.timeoutMs < 1) fail('scheduler timeout');
  if (policy.profileLimits.maxDepth > policy.runtimeLimits.maxDepth ||
      policy.profileLimits.maxInstructionScalars > policy.runtimeLimits.maxStringBytes ||
      policy.canonicalLimits.maxDepth > policy.profileLimits.maxDepth) fail('limit relationship');
  return Object.freeze(policy);
}

export function loadPinned(policy, rootUrl) {
  const descriptors = [policy.f4Policy, ...policy.mappingAuthorities, ...policy.composition];
  const sources = new Map();
  for (const item of descriptors) {
    const source = readFileSync(new URL(item.path, rootUrl), 'utf8');
    if (sha256(source) !== item.sha256) fail(`digest ${item.path}`);
    sources.set(item.path, source);
  }
  return sources;
}
