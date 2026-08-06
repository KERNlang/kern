import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import { validateRuntimeContractV1Authority } from '../runtime-contract-v1/validate-runtime-contract-v1-authority.mjs';
import { validateCoverageLedger } from './validate-coverage-ledger.mjs';
import { validateRunnerComposedEvidence } from './validate-runner-composed-evidence.mjs';

const EXPECTED_BLOCKERS = Object.freeze({
  'diagnostic-location-evidence': 'alpha-release',
  'clean-sha-alpha-manifest': 'alpha-release',
});
const EXPECTED_IDENTITY = Object.freeze({
  semanticIncludes: ['module-graph', 'imports', 'exports', 'node-kinds', 'semantic-properties', 'child-order'],
  semanticExcludes: ['comments', 'trivia', 'diagnostics', 'source-locations'],
  evidenceEnvelopeVersionedSeparately: true,
  locationOffsets: 'utf8-bytes-zero-based',
  locationEnd: 'half-open',
});
const EXPECTED_LIMIT_KEYS = Object.freeze([
  'max-input-bytes',
  'max-depth',
  'max-nodes',
  'max-modules',
  'max-collection-entries',
  'max-string-bytes',
  'max-diagnostics',
  'max-integer-digits',
]);
const EXPECTED_SKEW = Object.freeze({
  unknownVersions: 'reject-before-effect',
  unknownFields: 'reject-before-effect',
  unknownNodeKinds: 'reject-before-effect',
  unknownValueTags: 'reject-before-effect',
  unknownDiagnosticIds: 'reject-before-effect',
  fallback: 'forbidden',
});
const EXPECTED_CLAIMS = Object.freeze({
  kirV1Frozen: false,
  alphaAccepted: false,
  runtimeAbiFrozen: true,
  publicExport: false,
  semanticCutover: false,
});
const EXPECTED_DEFERRED = Object.freeze([
  ['public-versioned-kir-runtime-cutover', 'P1-composition'],
]);

function fail(message) {
  throw new Error(`KIR v1 eligibility: ${message}`);
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}

function exactKeys(value, expected, label) {
  record(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly ${wanted.join(', ')}`);
  }
}

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(`${label} must be non-empty text`);
}

function uniqueTextArray(values, label) {
  if (!Array.isArray(values) || values.length === 0) fail(`${label} must be a non-empty array`);
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    text(value, `${label}[${index}]`);
    if (seen.has(value)) fail(`${label} contains duplicate ${value}`);
    seen.add(value);
  }
  return seen;
}

function sameOrdered(actual, expected, label) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.find((value) => !actualSet.has(value));
    const extra = actual.find((value) => !expectedSet.has(value));
    fail(`${label} drifted${missing ? `; missing ${missing}` : ''}${extra ? `; unexpected ${extra}` : ''}`);
  }
}

function unwrapExpression(node) {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression);
  }
  return node;
}

function hasConstAssertion(node) {
  if (ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) {
    return hasConstAssertion(node.expression);
  }
  return (
    ts.isAsExpression(node) &&
    ts.isTypeReferenceNode(node.type) &&
    ts.isIdentifier(node.type.typeName) &&
    node.type.typeName.text === 'const'
  );
}

function topLevelDeclarations(sourceFile, constantName) {
  const declarations = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === constantName) declarations.push(declaration);
    }
  }
  if (declarations.length > 1) fail(`${sourceFile.fileName} contains duplicate top-level ${constantName}`);
  if (declarations.length === 0) fail(`${sourceFile.fileName} is missing top-level ${constantName}`);
  return declarations[0];
}

export function extractStaticStringArray(source, sourcePath, constantName) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail(`cannot parse ${sourcePath}`);
  const declaration = topLevelDeclarations(sourceFile, constantName);
  if (!declaration.initializer || !hasConstAssertion(declaration.initializer)) {
    fail(`${constantName} in ${sourcePath} must retain its const assertion`);
  }
  const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    fail(`${constantName} in ${sourcePath} must remain a static array literal`);
  }
  const result = initializer.elements.map((element, index) => {
    if (!ts.isStringLiteral(element)) fail(`${constantName}[${index}] must remain a string literal`);
    return element.text;
  });
  uniqueTextArray(result, `${constantName} source`);
  return result;
}

export function extractStaticStringConstant(source, sourcePath, constantName) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail(`cannot parse ${sourcePath}`);
  const declaration = topLevelDeclarations(sourceFile, constantName);
  const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
  if (!initializer || !ts.isStringLiteral(initializer)) {
    fail(`${constantName} in ${sourcePath} must remain a static string literal`);
  }
  return initializer.text;
}

function validateCatalog(catalog, expectedKeys, itemKey, readText) {
  exactKeys(catalog, ['path', 'constant', itemKey], `${itemKey} catalog`);
  text(catalog.path, `${itemKey} catalog path`);
  text(catalog.constant, `${itemKey} catalog constant`);
  if (catalog.path !== expectedKeys.path || catalog.constant !== expectedKeys.constant) {
    fail(`${itemKey} source binding changed`);
  }
  const declared = catalog[itemKey];
  uniqueTextArray(declared, `${itemKey} inventory`);
  const live = extractStaticStringArray(readText(catalog.path), catalog.path, catalog.constant);
  sameOrdered(declared, live, `${itemKey} inventory`);
  return new Set(declared);
}

function validateCandidate(policy, sourceIds, readText) {
  exactKeys(
    policy.candidateWitness,
    ['format', 'formatSource', 'canonicalSha256', 'nodeKinds', 'fixture'],
    'candidateWitness',
  );
  const witness = policy.candidateWitness;
  if (witness.format !== 'kern.semantic-kir.probe.1') fail('candidate format changed or was promoted');
  if (witness.formatSource !== 'packages/core/src/kir-reader-candidate/types.ts') fail('candidate format source changed');
  if (witness.fixture !== 'scripts/kir-seam-probe/fixtures.mjs') fail('candidate fixture changed');
  if (!/^[0-9a-f]{64}$/u.test(witness.canonicalSha256)) fail('candidate canonicalSha256 must be lowercase SHA-256');
  const typeSource = readText(witness.formatSource);
  const liveKinds = extractStaticStringArray(
    typeSource,
    witness.formatSource,
    'KIR_READER_CANDIDATE_NODE_KINDS',
  );
  uniqueTextArray(witness.nodeKinds, 'candidate node kinds');
  sameOrdered(witness.nodeKinds, liveKinds, 'candidate node kinds');
  for (const kind of witness.nodeKinds) {
    if (!sourceIds.has(kind)) fail(`candidate kind ${kind} is absent from NODE_TYPES`);
  }
  const liveFormat = extractStaticStringConstant(
    typeSource,
    witness.formatSource,
    'KIR_READER_CANDIDATE_FORMAT',
  );
  if (liveFormat !== witness.format) fail('candidate format evidence drifted');
  readText(witness.fixture);
  return new Set(witness.nodeKinds);
}

function validateCoverageLedgerBinding(policy, sourceIds, readText) {
  exactKeys(policy.coverageWitnessLedger, ['path', 'format', 'canonicalSha256'], 'coverageWitnessLedger');
  const binding = policy.coverageWitnessLedger;
  if (binding.path !== 'scripts/kir-v1/coverage-witness-ledger.json') fail('coverage ledger path changed');
  if (binding.format !== 'kern.kir.coverage-witness-ledger.r1.5i.1') fail('coverage ledger format changed');
  if (!/^[0-9a-f]{64}$/u.test(binding.canonicalSha256)) fail('coverage ledger SHA-256 is invalid');
  const ledgerText = readText(binding.path);
  const digest = createHash('sha256').update(ledgerText).digest('hex');
  if (digest !== binding.canonicalSha256) fail('coverage ledger digest drifted');
  const constitution = JSON.parse(readText('scripts/kir-structural/constitution.json'));
  const ledger = JSON.parse(ledgerText);
  const validated = validateCoverageLedger(ledger, constitution);
  sameOrdered(ledger.nodes.map((row) => row.id), [...sourceIds], 'coverage ledger node ids');
  return { ledger, validated };
}

function validateSourceCoverage(rows, sourceIds, ledger) {
  if (!Array.isArray(rows) || rows.length === 0) fail('sourceCoverage must be a non-empty array');
  rows.forEach((row, index) => {
    exactKeys(row, ['id', 'disposition', 'witnessId'], `sourceCoverage[${index}]`);
    const expected = ledger.nodes[index];
    if (
      row.id !== expected?.id ||
      row.disposition !== expected.disposition ||
      row.witnessId !== expected.witnessId
    ) {
      fail(`source coverage ${row.id ?? index} must exactly match the coverage ledger`);
    }
  });
  sameOrdered(rows.map((row) => row.id), [...sourceIds], 'source coverage ids');
}

function validateBlockers(policy) {
  if (!Array.isArray(policy.blockers)) fail('blockers must be an array');
  const ids = new Set();
  for (const [index, blocker] of policy.blockers.entries()) {
    exactKeys(blocker, ['id', 'appliesTo', 'detail'], `blockers[${index}]`);
    text(blocker.id, `blockers[${index}].id`);
    text(blocker.detail, `blockers[${index}].detail`);
    if (ids.has(blocker.id)) fail(`duplicate blocker ${blocker.id}`);
    ids.add(blocker.id);
    if (EXPECTED_BLOCKERS[blocker.id] !== blocker.appliesTo) fail(`blocker ${blocker.id} changed scope`);
  }
  sameOrdered([...ids], Object.keys(EXPECTED_BLOCKERS), 'blocker ids');
}

function validateDecisions(policy, validateRuntimeAuthority) {
  exactKeys(policy.identity, Object.keys(EXPECTED_IDENTITY), 'identity');
  sameOrdered(policy.identity.semanticIncludes, EXPECTED_IDENTITY.semanticIncludes, 'semantic identity inclusions');
  sameOrdered(policy.identity.semanticExcludes, EXPECTED_IDENTITY.semanticExcludes, 'semantic identity exclusions');
  for (const key of ['evidenceEnvelopeVersionedSeparately', 'locationOffsets', 'locationEnd']) {
    if (policy.identity[key] !== EXPECTED_IDENTITY[key]) fail(`identity.${key} changed`);
  }
  uniqueTextArray(policy.requiredLimitConfigKeys, 'requiredLimitConfigKeys');
  sameOrdered(policy.requiredLimitConfigKeys, EXPECTED_LIMIT_KEYS, 'required limit config keys');
  exactKeys(policy.skewPolicy, Object.keys(EXPECTED_SKEW), 'skewPolicy');
  for (const [key, value] of Object.entries(EXPECTED_SKEW)) {
    if (policy.skewPolicy[key] !== value) fail(`skewPolicy.${key} must remain ${value}`);
  }
  exactKeys(policy.claims, Object.keys(EXPECTED_CLAIMS), 'claims');
  for (const [claim, expected] of Object.entries(EXPECTED_CLAIMS)) {
    if (policy.claims[claim] !== expected) fail(`${claim} must remain ${expected} in Phase 1.1`);
  }
  const runtimeEvidence = validateRuntimeAuthority();
  if (runtimeEvidence?.runtimeAbiFrozen !== true) fail('runtimeAbiFrozen requires anchored runtime contract evidence');
}

function validateDeferred(policy) {
  if (!Array.isArray(policy.deferredContracts)) fail('deferredContracts must be an array');
  const actual = policy.deferredContracts.map((contract, index) => {
    exactKeys(contract, ['id', 'milestone'], `deferredContracts[${index}]`);
    return [contract.id, contract.milestone];
  });
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_DEFERRED)) fail('Phase 1 deferred contracts changed');
}

export function validateKirV1Eligibility(policy, options = {}) {
  const readText = options.readText ?? ((sourcePath) => readFileSync(sourcePath, 'utf8'));
  const validateRuntimeAuthority = options.validateRuntimeAuthority ?? validateRuntimeContractV1Authority;
  exactKeys(
    policy,
    [
      'schemaVersion', 'stage', 'decision', 'proofLabel', 'sourceCatalog', 'runnerCatalog',
      'runnerWitnessCatalog', 'candidateWitness', 'coverageWitnessLedger', 'blockers', 'identity',
      'requiredLimitConfigKeys', 'skewPolicy',
      'claims', 'deferredContracts', 'sourceCoverage', 'runnerCoverage',
    ],
    'policy',
  );
  if (policy.schemaVersion !== 3) fail('schemaVersion must be 3');
  if (policy.stage !== 'internal-alpha-candidate') fail('stage must remain internal-alpha-candidate');
  if (policy.decision !== 'no-go' || policy.proofLabel !== 'ALPHA-NO-GO') fail('R1.5a must remain ALPHA-NO-GO');

  const sourceIds = validateCatalog(
    policy.sourceCatalog,
    { path: 'packages/core/src/spec.ts', constant: 'NODE_TYPES' },
    'nodes',
    readText,
  );
  const runnerIds = validateCatalog(
    policy.runnerCatalog,
    {
      path: 'packages/core/src/runtime-envelope/source-runner-legacy.ts',
      constant: 'REQUIRED_RUNNER_CONTRACTS',
    },
    'contracts',
    readText,
  );
  const witnessedIds = validateCandidate(policy, sourceIds, readText);
  const { ledger } = validateCoverageLedgerBinding(policy, sourceIds, readText);
  validateBlockers(policy);
  validateDecisions(policy, validateRuntimeAuthority);
  validateDeferred(policy);

  validateSourceCoverage(policy.sourceCoverage, sourceIds, ledger);
  const runnerEvidence = validateRunnerComposedEvidence(
    policy.runnerWitnessCatalog,
    policy.runnerCoverage,
    [...runnerIds],
    readText,
  );
  return {
    proofLabel: policy.proofLabel,
    sourceNodeCount: sourceIds.size,
    witnessedNodeCount: witnessedIds.size,
    coveredSourceNodeCount: sourceIds.size,
    unresolvedSourceNodeCount: 0,
    ...runnerEvidence,
  };
}
