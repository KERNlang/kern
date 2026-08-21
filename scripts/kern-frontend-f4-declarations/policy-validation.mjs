import { fail } from './decoder.mjs';

export const F3_COMPOSITION_PATHS = [
  'examples/kern-frontend/builtin-node-types.generated.kern',
  'examples/kern-frontend/f3-line-tree-collection-helpers.kern',
  'examples/kern-frontend/f3-line-tree-main.kern',
];
export const F2_COMPOSITION_PATHS = [
  'examples/kern-frontend/f2-expression-catalog.kern',
  'examples/kern-frontend/f2-expression-lexer.kernpart',
  'examples/kern-frontend/f2-expression-main.kern',
  'examples/kern-frontend/f2-expression-parser-01.kernpart',
  'examples/kern-frontend/f2-expression-parser-02.kernpart',
  'examples/kern-frontend/f2-expression-parser-03.kernpart',
  'examples/kern-frontend/f2-batch-main.kern',
];
export const F4_COMPOSITION_PATHS = [
  'examples/kern-frontend/f4-authority.generated.kern',
  'examples/kern-frontend/f4-declarations-helpers.kern',
  'examples/kern-frontend/f4-path-contract.kern',
  'examples/kern-frontend/f4-expression-evidence.kern',
  'examples/kern-frontend/f4-diagnostic-merge.kern',
  'examples/kern-frontend/f4-line-eligibility.kern',
  'examples/kern-frontend/f4-prerequisite-envelope.kern',
  'examples/kern-frontend/f4-declarations-semantic.kern',
  'examples/kern-frontend/f4-declarations-semantic-tail.kernpart',
  'examples/kern-frontend/f4-declarations-main.kern',
];
export const COMPOSITION_PATHS = [...F3_COMPOSITION_PATHS, ...F2_COMPOSITION_PATHS, ...F4_COMPOSITION_PATHS];
export const ALL_COMPOSITION_PATHS = [
  ...COMPOSITION_PATHS,
  'examples/kern-frontend/f4-module-set-f2-helpers.kern',
  'examples/kern-frontend/f4-module-set-output.kern',
  'examples/kern-frontend/f4-module-set-prefix.kern',
  'examples/kern-frontend/f4-module-set-graph.kern',
  'examples/kern-frontend/f4-module-set-main.kern',
];

export const AUTHORITY_PATHS = [
  'scripts/kern-frontend-builtin-node-type-attestation/catalog.json',
  'scripts/kir-structural/constitution.json',
  'scripts/kern-frontend-closure/closure-ledger.json',
  'scripts/kern-frontend-closure/static-goldens.json',
  'scripts/kern-frontend-keyword-handlers/policy.json',
];

const POLICY_KEYS = [
  'format', 'documentResultFormat', 'moduleSetResultFormat', 'documentPrivateAbi',
  'moduleSetPrivateAbi',
  'authorities', 'f1Policy', 'f2Policy', 'f2bPolicy', 'f3Policy',
  'composition', 'prerequisites',
  'profileLimits', 'runtimeLimits', 'scheduler',
];
const PROFILE_LIMIT_KEYS = [
  'maxModules', 'maxSourceScalars', 'maxRecords', 'maxLogicalLines', 'maxDeclarations',
  'maxPropertyOccurrences', 'maxAttachments', 'maxDecorators', 'maxSymbols', 'maxBindings',
  'maxDiagnostics', 'maxFacts', 'maxExpressionEvidence', 'maxF4LocalF2Calls',
  'maxAggregateExpressionScalars', 'maxAggregateExpressionNodes', 'maxExpressionAbsoluteSpans',
  'maxExpressionBoundaryEntries', 'maxExpressionReceiptScalars', 'maxModuleIdScalars',
  'maxModuleIdSegments', 'maxImportSpecifierScalars', 'maxImportSpecifierSegments',
  'maxWorkSteps', 'maxEncodedBytes',
];
const RUNTIME_LIMIT_KEYS = [
  'maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxStringBytes',
];
const PREREQUISITES = [
  'kern.frontend.f1.record-tape.1',
  'kern.frontend.f2-expression.1',
  'kern.frontend.f2.document-batch.1',
  'kern.frontend.f3-line-tree.1',
];
const POLICY_DESCRIPTORS = [
  ['F1', 'f1Policy', 'scripts/kern-frontend-f1-scan/policy.json'],
  ['F2', 'f2Policy', 'scripts/kern-frontend-f2-expression/policy.json'],
  ['F2B', 'f2bPolicy', 'scripts/kern-frontend-f2-batch/policy.json'],
  ['F3', 'f3Policy', 'scripts/kern-frontend-f3-line-tree/policy.json'],
];
const AUTHORITY_KEYS = [
  ['path', 'sha256', 'rows'],
  ['path', 'sha256', 'rows', 'nodeRows', 'propertyRows'],
  ['path', 'sha256'],
  ['path', 'sha256'],
  ['path', 'sha256', 'rows'],
];
const MODULE_SET_ARGUMENT_ORDER = [
  'moduleIds', 'mode', 'resourceKind', 'f4aModuleIds', 'f4aFormats', 'f4aStatuses', 'f4aSeals',
  'interfaceBlocks', 'maxModules', 'maxSymbols', 'maxBindings', 'maxWorkSteps', 'forceLateFailure',
  'maxModuleIdScalars', 'maxModuleIdSegments', 'maxImportSpecifierScalars',
  'maxImportSpecifierSegments', 'maxEncodedBytes',
];
const MODULE_SET_ARGUMENT_TYPES = [
  'string[]', 'string', 'string', 'string[]', 'string[]', 'string[]', 'string[]', 'string[]',
  'number', 'number', 'number', 'number', 'boolean', 'number', 'number', 'number', 'number', 'number',
];

function frame(value) {
  return `i${Array.from(value).length}:${value}`;
}

function minimalModuleSetFailureBytes() {
  const fact = frame([frame('F4_LIMIT'), frame(''), frame('')].join(''));
  const fields = ['kern.frontend.f4-module-set.3', 'fatal', '', '', fact, '', '', '', '', 'failure'];
  return fields.reduce((total, field) => total + new TextEncoder().encode(field).length, 0);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} keys`);
  const actual = Object.keys(value);
  if (actual.length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) {
    fail(`${label} keys`);
  }
}

export function validatePolicy(policy) {
  exactKeys(policy, POLICY_KEYS, 'policy');
  if (policy.format !== 'kern.frontend.f4-declarations-policy.4' ||
      policy.documentResultFormat !== 'kern.frontend.f4-document.2' ||
      policy.moduleSetResultFormat !== 'kern.frontend.f4-module-set.3' ||
      !Array.isArray(policy.authorities) || policy.authorities.length !== 5 ||
      !Array.isArray(policy.composition) || policy.composition.length !== ALL_COMPOSITION_PATHS.length ||
      !Array.isArray(policy.prerequisites) ||
      JSON.stringify(policy.prerequisites) !== JSON.stringify(PREREQUISITES)) fail('policy identity');
  exactKeys(policy.documentPrivateAbi, [
    'arity', 'stateOrder', 'states', 'legalVectors', 'payloadCounts', 'unavailableString', 'unavailableArrays',
  ], 'document private ABI');
  if (policy.documentPrivateAbi.arity !== 109 ||
      JSON.stringify(policy.documentPrivateAbi.stateOrder) !== JSON.stringify(['f1', 'f2b', 'f3']) ||
      JSON.stringify(policy.documentPrivateAbi.states) !== JSON.stringify(['available', 'failed', 'not-attempted']) ||
      JSON.stringify(policy.documentPrivateAbi.legalVectors) !== JSON.stringify(['AAA', 'FNN', 'AFN', 'AAF']) ||
      JSON.stringify(policy.documentPrivateAbi.payloadCounts) !== JSON.stringify([5, 10, 27]) ||
      policy.documentPrivateAbi.unavailableString !== '' ||
      policy.documentPrivateAbi.unavailableArrays !== 'empty') fail('document private ABI identity');
  exactKeys(policy.moduleSetPrivateAbi, [
    'arity', 'argumentOrder', 'argumentTypes', 'modes', 'resourceKinds',
  ], 'module set private ABI');
  if (policy.moduleSetPrivateAbi.arity !== 18 ||
      JSON.stringify(policy.moduleSetPrivateAbi.argumentOrder) !== JSON.stringify(MODULE_SET_ARGUMENT_ORDER) ||
      JSON.stringify(policy.moduleSetPrivateAbi.argumentTypes) !== JSON.stringify(MODULE_SET_ARGUMENT_TYPES) ||
      JSON.stringify(policy.moduleSetPrivateAbi.modes) !== JSON.stringify(['full', 'resource-prefix']) ||
      JSON.stringify(policy.moduleSetPrivateAbi.resourceKinds) !==
        JSON.stringify(['maxModules', 'maxSymbols', 'maxBindings'])) fail('module set private ABI identity');
  for (const [label, key, expectedPath] of POLICY_DESCRIPTORS) {
    const descriptor = policy[key];
    exactKeys(descriptor, ['path', 'sha256'], `${label} policy descriptor`);
    if (descriptor.path !== expectedPath || !/^[0-9a-f]{64}$/u.test(descriptor.sha256)) {
      fail(`${label} policy descriptor`);
    }
  }
  for (let index = 0; index < policy.authorities.length; index += 1) {
    const authority = policy.authorities[index];
    exactKeys(authority, AUTHORITY_KEYS[index], 'authority descriptor');
    if (authority.path !== AUTHORITY_PATHS[index] || !/^[0-9a-f]{64}$/u.test(authority.sha256)) {
      fail('authority descriptor');
    }
  }
  if (policy.authorities[0].rows !== 302 || policy.authorities[4].rows !== 26) fail('authority rows');
  const constitutionAuthority = policy.authorities[1];
  if (constitutionAuthority.nodeRows !== 302 || constitutionAuthority.propertyRows !== 1149 ||
      constitutionAuthority.rows !== constitutionAuthority.nodeRows + constitutionAuthority.propertyRows) {
    fail('constitution authority rows');
  }
  for (let index = 0; index < policy.composition.length; index += 1) {
    const descriptor = policy.composition[index];
    exactKeys(descriptor, ['path', 'sha256'], 'composition descriptor');
    if (descriptor.path !== ALL_COMPOSITION_PATHS[index] || !/^[0-9a-f]{64}$/u.test(descriptor.sha256)) {
      fail('composition descriptor');
    }
  }
  exactKeys(policy.profileLimits, PROFILE_LIMIT_KEYS, 'profile limits');
  exactKeys(policy.runtimeLimits, RUNTIME_LIMIT_KEYS, 'runtime limits');
  exactKeys(policy.scheduler, ['timeoutMs'], 'scheduler');
  for (const [key, value] of Object.entries(policy.profileLimits)) {
    if (!Number.isSafeInteger(value) || value < 1) fail(`profile limit ${key}`);
  }
  if (policy.profileLimits.maxEncodedBytes < minimalModuleSetFailureBytes()) {
    fail('module set encoded byte floor');
  }
  const scalarCap = policy.profileLimits.maxAggregateExpressionScalars;
  const localCallCap = policy.profileLimits.maxF4LocalF2Calls;
  const boundaryCap = policy.profileLimits.maxExpressionBoundaryEntries;
  if (!Number.isSafeInteger(scalarCap + 1) || boundaryCap < scalarCap + 1) {
    fail('expression boundary floor');
  }
  if (!Number.isSafeInteger(scalarCap + localCallCap) || boundaryCap > scalarCap + localCallCap) {
    fail('expression boundary unreachable');
  }
  for (const key of [
    'maxModuleIdScalars', 'maxModuleIdSegments', 'maxImportSpecifierScalars', 'maxImportSpecifierSegments',
  ]) {
    if (policy.profileLimits[key] > policy.profileLimits.maxSourceScalars) fail(`path limit ${key}`);
  }
  for (const [key, value] of Object.entries(policy.runtimeLimits)) {
    if (!Number.isSafeInteger(value) || value < 1) fail(`runtime limit ${key}`);
  }
  if (!Number.isSafeInteger(policy.scheduler.timeoutMs) || policy.scheduler.timeoutMs < 1) fail('scheduler');
  return policy;
}
