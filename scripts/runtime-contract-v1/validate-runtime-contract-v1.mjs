import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const RUNTIME_CONTRACT_PATHS = Object.freeze({
  constitution: 'scripts/runtime-contract-v1/constitution.json',
  proofInventory: 'scripts/runtime-contract-v1/proof-inventory.json',
  declarationSchema: 'scripts/runtime-contract-v1/public-declaration-schema.json',
  goldens: 'scripts/runtime-contract-v1/goldens.json',
  lineage: 'scripts/runtime-contract-v1/lineage.json',
});

const EXPECTED = Object.freeze({
  abi: 'kern.runtime.handler.v1',
  completionKinds: ['normal', 'return', 'error'],
  diagnosticCodes: [
    'capability-error',
    'encoded-limit',
    'escaped-control',
    'execution-cancelled',
    'execution-timeout',
    'handler-entry-ambiguous',
    'handler-entry-not-found',
    'handler-entry-unsupported',
    'handler-link-error',
    'invalid-handler-arguments',
    'invalid-handler-result',
    'internal-runner-error',
    'non-portable-value',
    'uncaught-throw',
    'unsupported-runtime-input',
  ],
  eventOperations: ['stdout', 'stderr', 'capability'],
  limits: ['maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxIterations', 'maxStringBytes'],
  outcomes: ['success', 'failure'],
  thrownErrorCodes: ['disabled', 'invalid-abi', 'invalid-limits', 'invalid-options', 'invalid-request'],
  valueTags: ['null', 'boolean', 'text', 'integer', 'decimal', 'list', 'record'],
  behaviorIds: [
    'success-typed-return',
    'success-capability-transcript',
    'failure-link',
    'failure-uncaught-throw',
    'failure-invalid-handler-arguments',
    'failure-unsupported-handler',
    'failure-invalid-capability-input',
    'failure-invalid-provider-result',
    'failure-declared-result-mismatch',
    'scheduler-pre-aborted',
    'scheduler-timeout',
    'portable-value-rejection',
  ],
  ingressIds: ['disabled', 'invalid-abi', 'invalid-request', 'invalid-limits', 'invalid-options'],
  effectIds: [
    'pre-invalid-abi',
    'pre-invalid-request',
    'pre-invalid-options',
    'pre-invalid-limits',
    'pre-unsupported-handler',
    'pre-invalid-arguments',
    'pre-invalid-capability-input',
    'post-invalid-provider-result',
    'post-declared-result-mismatch',
  ],
  importEdges: [
    'runtime-esm-import',
    'runtime-esm-re-export',
    'import-equals-require',
    'direct-literal-require',
    'literal-dynamic-import',
    'package-entry',
    'source-alias',
    'built-javascript',
  ],
});

function fail(message) {
  throw new Error(`runtime contract v1: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const actual = Object.keys(value);
  if (JSON.stringify(actual) !== JSON.stringify(keys)) fail(`${label} keys drifted`);
}

function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} drifted`);
}

function canonicalJson(text, label) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${label} must be JSON`);
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== text) fail(`${label} bytes must remain canonical`);
  return value;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function rejectSelfAuthority(value, label) {
  function visit(item, path) {
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (/^(?:authority|commit|selfSha256|introductionSha)$/u.test(key)) {
        fail(`${label} supplies its own authority at ${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  }
  visit(value, label);
}

function validateConstitution(value) {
  exactKeys(
    value,
    [
      'format', 'abi', 'publicEntry', 'internalFormat', 'publicSymbols', 'limits', 'capability', 'valueTags',
      'slotPresences', 'eventOperations', 'diagnostics', 'completionKinds', 'outcomes', 'thrownErrorCodes',
      'rejectionPhases', 'determinism', 'runtimeModuleEdges', 'controlEffects', 'forbiddenPublicTypes', 'claims',
    ],
    'constitution',
  );
  if (value.format !== 'kern.runtime.contract.v1' || value.abi !== EXPECTED.abi) fail('constitution identity drifted');
  if (value.publicEntry !== '@kernlang/core/runtime/handler') fail('public entry drifted');
  if (value.internalFormat !== 'kern.runtime.internal.r0') fail('internal format binding drifted');
  same(value.limits, EXPECTED.limits, 'limit inventory');
  same(value.valueTags, EXPECTED.valueTags, 'value tags');
  same(value.eventOperations, EXPECTED.eventOperations, 'event operations');
  same(value.completionKinds, EXPECTED.completionKinds, 'completion kinds');
  same(value.outcomes, EXPECTED.outcomes, 'outcomes');
  same(value.thrownErrorCodes, EXPECTED.thrownErrorCodes, 'thrown error codes');
  same(value.runtimeModuleEdges, EXPECTED.importEdges, 'runtime module edges');
  exactKeys(value.diagnostics, ['category', 'phases', 'codes', 'locations'], 'diagnostics');
  if (value.diagnostics.category !== 'runtime') fail('diagnostic category drifted');
  same(value.diagnostics.phases, ['execution', 'link'], 'diagnostic phases');
  same(value.diagnostics.codes, EXPECTED.diagnosticCodes, 'diagnostic codes');
  if (value.diagnostics.locations !== 'separately-versioned-kir-evidence') fail('diagnostic location boundary drifted');
  exactKeys(
    value.rejectionPhases,
    ['pre-dispatch-before-effect', 'post-provider-pre-publication', 'post-effect-declared-result-mismatch'],
    'rejection phases',
  );
  exactKeys(value.claims, ['runtimeAbiFrozen', 'kirV1Frozen', 'publicKirReader', 'semanticCutover', 'phase1Complete'], 'claims');
  if (Object.values(value.claims).some((claim) => claim !== false)) fail('candidate constitution must not promote claims');
  if (value.determinism.unconditional !== false) fail('unconditional determinism must remain false');
  exactKeys(
    value.controlEffects,
    ['scope', 'invariant', 'semanticEffectLedger'],
    'control effects',
  );
  if (
    value.controlEffects.scope !== 'caller-authorized-scheduler-and-provider-timeout' ||
    value.controlEffects.invariant !== 'balanced-cleanup-zero-residual-resources' ||
    value.controlEffects.semanticEffectLedger !== 'provider-publication-and-state-only'
  ) {
    fail('control effect boundary drifted');
  }
  rejectSelfAuthority(value, 'constitution');
}

function validateGoldens(value, proofInventory) {
  exactKeys(
    value,
    [
      'format',
      'limits',
      'envelopes',
      'cases',
      'ingress',
      'limitValidation',
      'limitEnforcement',
      'schedulerEffects',
    ],
    'goldens',
  );
  if (value.format !== 'kern.runtime.contract.goldens.v1') fail('golden format drifted');
  exactKeys(value.limits, EXPECTED.limits, 'golden limits');
  for (const key of EXPECTED.limits) {
    if (!Number.isSafeInteger(value.limits[key]) || value.limits[key] <= 0) fail(`golden limit ${key} must be positive`);
  }
  if (!Array.isArray(value.cases)) fail('golden cases must be an array');
  same(Object.keys(value.envelopes), EXPECTED.behaviorIds, 'golden envelope ids');
  same(value.cases.map((item) => item.id), EXPECTED.behaviorIds, 'golden case ids');
  for (const [index, item] of value.cases.entries()) {
    exactKeys(
      item,
      ['id', 'modes', 'request', 'provider', 'scheduler', 'limits', 'expected'],
      `goldens.cases[${index}]`,
    );
    same(item.modes, proofInventory.behavior[index].modes, `${item.id} modes`);
    exactKeys(item.request, ['arguments', 'handlerName', 'sourcePath', 'source'], `${item.id} request`);
    if (item.expected !== item.id) fail(`${item.id} envelope binding drifted`);
    const expectedEnvelope = value.envelopes[item.expected];
    if (expectedEnvelope.format !== EXPECTED.abi) fail(`${item.id} envelope ABI drifted`);
    if (!EXPECTED.outcomes.includes(expectedEnvelope.outcome)) fail(`${item.id} outcome drifted`);
  }
  same(value.ingress.map(({ id }) => id), EXPECTED.ingressIds, 'golden ingress ids');
  for (const [index, entry] of value.ingress.entries()) {
    exactKeys(entry, ['id', 'modes', 'error'], `goldens.ingress[${index}]`);
    same(entry.modes, proofInventory.ingress[index].modes, `${entry.id} ingress modes`);
    exactKeys(entry.error, ['name', 'code', 'message'], `${entry.id} error`);
    if (entry.error.name !== 'KernRuntimeHandlerError' || !EXPECTED.thrownErrorCodes.includes(entry.error.code)) {
      fail(`${entry.id} error identity drifted`);
    }
  }
  same(value.limitValidation.map(({ id }) => id), EXPECTED.limits, 'golden limit validation ids');
  for (const entry of value.limitValidation) {
    exactKeys(entry, ['id', 'minimum', 'invalid'], `golden limit validation ${entry.id}`);
    if (entry.minimum !== 1 || entry.invalid !== 0) fail(`${entry.id} validation boundary drifted`);
  }
  same(value.limitEnforcement.map(({ id }) => id), [
    'bytes', 'collection', 'depth', 'diagnostics', 'events', 'string-bytes',
  ], 'golden limit enforcement ids');
  for (const [index, entry] of value.limitEnforcement.entries()) {
    exactKeys(entry, ['id', 'boundaries', 'expected'], `golden limit enforcement ${entry.id}`);
    same(entry.boundaries, proofInventory.limitEnforcement[index].boundaries, `${entry.id} boundaries`);
    if (!Array.isArray(entry.expected) || entry.expected.length !== 2) fail(`${entry.id} expectations drifted`);
  }
  same(value.schedulerEffects, proofInventory.schedulerEffects, 'golden scheduler effect witnesses');
  rejectSelfAuthority(value, 'goldens');
}

function validateProofInventory(value) {
  exactKeys(
    value,
    [
      'format',
      'importEdges',
      'forbiddenDynamicBindings',
      'behavior',
      'ingress',
      'limitValidation',
      'limitEnforcement',
      'schedulerEffects',
      'effects',
    ],
    'proof inventory',
  );
  if (value.format !== 'kern.runtime.contract.proof-inventory.v1') fail('proof inventory format drifted');
  same(value.importEdges, EXPECTED.importEdges, 'proof import edges');
  same(value.forbiddenDynamicBindings, [
    'Bun', 'Deno', 'Function', 'WebAssembly', 'constructor', 'createRequire', 'eval',
    'global', 'globalThis', 'importScripts', 'module', 'process',
  ], 'forbidden dynamic bindings');
  same(value.behavior.map(({ id }) => id), EXPECTED.behaviorIds, 'behavior proof ids');
  same(value.ingress.map(({ id }) => id), EXPECTED.ingressIds, 'ingress proof ids');
  same(value.limitValidation.map(({ id }) => id), EXPECTED.limits, 'limit validation ids');
  same(value.limitEnforcement.map(({ id }) => id), [
    'bytes', 'collection', 'depth', 'diagnostics', 'events', 'string-bytes',
  ], 'limit enforcement ids');
  same(value.effects.map(({ id }) => id), EXPECTED.effectIds, 'effect proof ids');
  for (const entry of [...value.behavior, ...value.ingress]) {
    exactKeys(entry, ['id', 'modes'], `proof ${entry.id}`);
    if (!Array.isArray(entry.modes) || entry.modes.length === 0) fail(`proof ${entry.id} modes drifted`);
  }
  for (const entry of value.effects) {
    exactKeys(entry, ['id', 'phase', 'controlEffects', 'modes'], `proof ${entry.id}`);
    if (!Array.isArray(entry.modes) || entry.modes.length === 0) fail(`proof ${entry.id} modes drifted`);
  }
  const schedulerIds = [
    'invalid-input-no-scheduler',
    'invalid-input-live-signal',
    'invalid-input-pre-aborted',
    'invalid-input-timeout',
    'invalid-input-signal-timeout',
  ];
  same(value.schedulerEffects.map(({ id }) => id), schedulerIds, 'scheduler effect witness ids');
  for (const entry of value.schedulerEffects) {
    exactKeys(
      entry,
      ['id', 'diagnostic', 'listenerAdds', 'listenerRemoves', 'timerRegistrations', 'timerClears'],
      `scheduler effect ${entry.id}`,
    );
    if (entry.listenerAdds !== entry.listenerRemoves || entry.timerRegistrations !== entry.timerClears) {
      fail(`${entry.id} leaves residual scheduler controls`);
    }
  }
  rejectSelfAuthority(value, 'proof inventory');
}

function validateDeclarationSchema(value, constitution) {
  exactKeys(value, ['format', 'declarations'], 'declaration schema');
  if (value.format !== 'kern.runtime.handler.declaration-schema.v1') fail('declaration schema format drifted');
  if (
    !Array.isArray(value.declarations) ||
    value.declarations.length !== constitution.publicSymbols.length ||
    value.declarations.some((item) => typeof item !== 'string' || item.length === 0) ||
    new Set(value.declarations).size !== value.declarations.length
  ) {
    fail('declaration schema inventory drifted');
  }
  for (const symbol of constitution.publicSymbols) {
    if (!value.declarations.some((declaration) => new RegExp(`\\b${symbol}\\b`, 'u').test(declaration))) {
      fail(`declaration schema omits ${symbol}`);
    }
  }
  rejectSelfAuthority(value, 'declaration schema');
}

function validateLineage(value, texts) {
  exactKeys(value, ['format', 'versions'], 'lineage');
  if (value.format !== 'kern.runtime.contract.lineage.v1') fail('lineage format drifted');
  if (!Array.isArray(value.versions) || value.versions.length !== 1) fail('lineage must contain exactly v1');
  const [version] = value.versions;
  exactKeys(
    version,
    ['abi', 'constitutionSha256', 'proofInventorySha256', 'declarationSchemaSha256', 'goldensSha256'],
    'lineage v1',
  );
  if (version.abi !== EXPECTED.abi) fail('lineage ABI drifted');
  if (version.constitutionSha256 !== sha256(texts.constitution)) fail('lineage constitution digest drifted');
  if (version.proofInventorySha256 !== sha256(texts.proofInventory)) fail('lineage proof inventory digest drifted');
  if (version.declarationSchemaSha256 !== sha256(texts.declarationSchema)) {
    fail('lineage declaration schema digest drifted');
  }
  if (version.goldensSha256 !== sha256(texts.goldens)) fail('lineage goldens digest drifted');
  rejectSelfAuthority(value, 'lineage');
}

export function validateRuntimeContractV1(options = {}) {
  const readText = options.readText ?? ((path) => readFileSync(path, 'utf8'));
  const texts = Object.fromEntries(Object.entries(RUNTIME_CONTRACT_PATHS).map(([id, path]) => [id, readText(path)]));
  const constitution = canonicalJson(texts.constitution, 'constitution');
  const proofInventory = canonicalJson(texts.proofInventory, 'proof inventory');
  const declarationSchema = canonicalJson(texts.declarationSchema, 'declaration schema');
  const goldens = canonicalJson(texts.goldens, 'goldens');
  const lineage = canonicalJson(texts.lineage, 'lineage');
  validateConstitution(constitution);
  validateProofInventory(proofInventory);
  validateDeclarationSchema(declarationSchema, constitution);
  validateGoldens(goldens, proofInventory);
  validateLineage(lineage, texts);
  return Object.freeze({
    abi: constitution.abi,
    caseCount: goldens.cases.length,
    constitutionSha256: sha256(texts.constitution),
    goldensSha256: sha256(texts.goldens),
    runtimeAbiFrozen: false,
  });
}
