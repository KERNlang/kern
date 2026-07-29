import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const FORMAT = 'kern.kir-canonicalizer.prerequisite-provenance.1';
const COVERAGE_SUMMARY_FORMATS = new Set([
  'kern.kir-canonicalizer.coverage-summary.5',
  'kern.kir-canonicalizer.coverage-summary.6',
]);
const PREREQUISITE_SUMMARY_FORMATS = new Set([
  'kern.kir-canonicalizer.prerequisite-summary.1',
  'kern.kir-canonicalizer.prerequisite-summary.2',
  'kern.kir-canonicalizer.prerequisite-summary.3',
]);
const INDEX_PREREQUISITE = Object.freeze({
  digest: '3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869',
  source: readFileSync(new URL('./coverage-index-prerequisite-provenance.json', import.meta.url)),
});
const COUNTED_ITERATION_PREREQUISITE = Object.freeze({
  digest: 'af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b',
  source: readFileSync(
    new URL('./coverage-counted-iteration-prerequisite-provenance.json', import.meta.url),
  ),
});
const BINDING_PREREQUISITE = Object.freeze({
  digest: '00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab',
  source: readFileSync(
    new URL('./coverage-binding-prerequisite-provenance.json', import.meta.url),
  ),
});
const UNARY_PREREQUISITE = Object.freeze({
  digest: 'e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5',
  source: readFileSync(
    new URL('./coverage-unary-prerequisite-provenance.json', import.meta.url),
  ),
});
const DO_PREREQUISITE = Object.freeze({
  digest: '3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72',
  source: readFileSync(
    new URL('./coverage-do-prerequisite-provenance.json', import.meta.url),
  ),
});
const WHILE_PREREQUISITE = Object.freeze({
  digest: '5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07',
  source: readFileSync(
    new URL('./coverage-while-prerequisite-provenance.json', import.meta.url),
  ),
});
const NEW_EXPRESSION_PREREQUISITE = Object.freeze({
  digest: 'ca3b4053df5707126d97c21300cf20004d7c01e9fcc0b78d40dd249fd8d1af0e',
  source: readFileSync(
    new URL('./coverage-new-expression-prerequisite-provenance.json', import.meta.url),
  ),
});

function fail(message) {
  throw new TypeError(`prerequisite provenance rejection: ${message}`);
}

function record(value, fields, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain record`);
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => typeof key !== 'string')) fail(`${label} contains symbol fields`);
  if (keys.some((key) => descriptors[key].get || descriptors[key].set || !descriptors[key].enumerable)) {
    fail(`${label} must be inspectable plain data`);
  }
  const actual = [...keys].sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly ${expected.join(',')}`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer`);
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be non-empty text`);
  return value;
}

function sha256(value, label) {
  const digest = text(value, label);
  if (!/^[0-9a-f]{64}$/u.test(digest)) fail(`${label} must be lowercase SHA-256`);
  return digest;
}

function sortedUniqueText(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  const result = value.map((entry, index) => text(entry, `${label}[${index}]`));
  if (
    new Set(result).size !== result.length ||
    result.some((entry, index) => index > 0 && result[index - 1] >= entry)
  ) {
    fail(`${label} must be sorted and unique`);
  }
  return result;
}

export function validateCanonicalizerPrerequisiteProvenance(input) {
  const value = record(input, ['format', 'snapshot', 'source'], 'provenance');
  if (value.format !== FORMAT) fail(`format must be ${FORMAT}`);
  const snapshotInput = record(
    value.snapshot,
    ['baseline', 'minimumFamilyCount', 'selectedPrerequisite', 'winningClosure'],
    'snapshot',
  );
  const baselineInput = record(
    snapshotInput.baseline,
    [
      'baseCompleteFunctions',
      'baseId',
      'corpusMembers',
      'functionCount',
      'legacyParameterBlockers',
      'toolCount',
    ],
    'snapshot.baseline',
  );
  const selectedInput = record(
    snapshotInput.selectedPrerequisite,
    ['catalogFacts', 'family', 'occurrences'],
    'snapshot.selectedPrerequisite',
  );
  const closureInput = record(
    snapshotInput.winningClosure,
    [
      'completeFunctions',
      'completeTools',
      'families',
      'migratedParameterRows',
      'occurrences',
      'witnesses',
    ],
    'snapshot.winningClosure',
  );
  const sourceInput = record(
    value.source,
    [
      'commit',
      'coverageSummaryFormat',
      'coverageSummarySha256',
      'prerequisiteSummaryFormat',
      'prerequisiteSummarySha256',
    ],
    'source',
  );
  const baseline = {
    baseCompleteFunctions: positiveInteger(
      baselineInput.baseCompleteFunctions,
      'snapshot.baseline.baseCompleteFunctions',
    ),
    baseId: text(baselineInput.baseId, 'snapshot.baseline.baseId'),
    corpusMembers: positiveInteger(baselineInput.corpusMembers, 'snapshot.baseline.corpusMembers'),
    functionCount: positiveInteger(baselineInput.functionCount, 'snapshot.baseline.functionCount'),
    legacyParameterBlockers: positiveInteger(
      baselineInput.legacyParameterBlockers,
      'snapshot.baseline.legacyParameterBlockers',
    ),
    toolCount: positiveInteger(baselineInput.toolCount, 'snapshot.baseline.toolCount'),
  };
  const selectedPrerequisite = {
    catalogFacts: positiveInteger(selectedInput.catalogFacts, 'snapshot.selectedPrerequisite.catalogFacts'),
    family: text(selectedInput.family, 'snapshot.selectedPrerequisite.family'),
    occurrences: positiveInteger(selectedInput.occurrences, 'snapshot.selectedPrerequisite.occurrences'),
  };
  const winningClosure = {
    completeFunctions: positiveInteger(
      closureInput.completeFunctions,
      'snapshot.winningClosure.completeFunctions',
    ),
    completeTools: positiveInteger(closureInput.completeTools, 'snapshot.winningClosure.completeTools'),
    families: sortedUniqueText(closureInput.families, 'snapshot.winningClosure.families'),
    migratedParameterRows: positiveInteger(
      closureInput.migratedParameterRows,
      'snapshot.winningClosure.migratedParameterRows',
    ),
    occurrences: positiveInteger(closureInput.occurrences, 'snapshot.winningClosure.occurrences'),
    witnesses: sortedUniqueText(closureInput.witnesses, 'snapshot.winningClosure.witnesses'),
  };
  const minimumFamilyCount = positiveInteger(snapshotInput.minimumFamilyCount, 'snapshot.minimumFamilyCount');
  if (minimumFamilyCount !== winningClosure.families.length) {
    fail('minimum family count must equal the winning closure size');
  }
  if (!winningClosure.families.includes(selectedPrerequisite.family)) {
    fail('selected prerequisite must belong to the winning closure');
  }
  if (winningClosure.witnesses.length !== winningClosure.completeFunctions) {
    fail('winning closure witnesses must equal complete functions');
  }
  if (winningClosure.completeTools > winningClosure.completeFunctions) {
    fail('winning closure complete tools cannot exceed complete functions');
  }
  if (
    winningClosure.completeFunctions > baseline.functionCount ||
    winningClosure.completeTools > baseline.toolCount ||
    baseline.baseCompleteFunctions > baseline.functionCount ||
    baseline.legacyParameterBlockers > baseline.functionCount
  ) {
    fail('snapshot counts exceed the authenticated baseline');
  }
  const commit = text(sourceInput.commit, 'source.commit');
  if (!/^[0-9a-f]{40}$/u.test(commit)) fail('source.commit must be a full lowercase git object id');
  if (!COVERAGE_SUMMARY_FORMATS.has(sourceInput.coverageSummaryFormat)) {
    fail('source.coverageSummaryFormat must be a supported historical format');
  }
  if (!PREREQUISITE_SUMMARY_FORMATS.has(sourceInput.prerequisiteSummaryFormat)) {
    fail('source.prerequisiteSummaryFormat must be a supported historical format');
  }
  return {
    format: FORMAT,
    snapshot: {
      baseline,
      minimumFamilyCount,
      selectedPrerequisite,
      winningClosure,
    },
    source: {
      commit,
      coverageSummaryFormat: sourceInput.coverageSummaryFormat,
      coverageSummarySha256: sha256(sourceInput.coverageSummarySha256, 'source.coverageSummarySha256'),
      prerequisiteSummaryFormat: sourceInput.prerequisiteSummaryFormat,
      prerequisiteSummarySha256: sha256(
        sourceInput.prerequisiteSummarySha256,
        'source.prerequisiteSummarySha256',
      ),
    },
  };
}

export function canonicalPrerequisiteProvenanceBytes(input) {
  return Buffer.from(`${JSON.stringify(validateCanonicalizerPrerequisiteProvenance(input), null, 2)}\n`);
}

function validateExactPrerequisiteHandoff(input, expected, label) {
  const validated = validateCanonicalizerPrerequisiteProvenance(input);
  const canonical = Buffer.from(`${JSON.stringify(validated, null, 2)}\n`);
  const digest = createHash('sha256').update(canonical).digest('hex');
  if (digest !== expected.digest) fail(`${label} handoff must match its exact published prerequisite`);
  return { digest, record: validated };
}

function loadExactPrerequisiteProvenance(expected, validate) {
  const parsed = JSON.parse(expected.source.toString('utf8'));
  const handoff = validate(parsed);
  if (!expected.source.equals(canonicalPrerequisiteProvenanceBytes(handoff.record))) {
    fail('checked-in prerequisite provenance must use canonical JSON bytes');
  }
  return handoff;
}

export function validateCanonicalizerIndexPrerequisiteHandoff(input) {
  return validateExactPrerequisiteHandoff(input, INDEX_PREREQUISITE, 'index');
}

export function loadCanonicalizerIndexPrerequisiteProvenance() {
  return loadExactPrerequisiteProvenance(
    INDEX_PREREQUISITE,
    validateCanonicalizerIndexPrerequisiteHandoff,
  );
}

export function validateCanonicalizerCountedIterationPrerequisiteHandoff(input) {
  return validateExactPrerequisiteHandoff(
    input,
    COUNTED_ITERATION_PREREQUISITE,
    'counted iteration',
  );
}

export function loadCanonicalizerCountedIterationPrerequisiteProvenance() {
  return loadExactPrerequisiteProvenance(
    COUNTED_ITERATION_PREREQUISITE,
    validateCanonicalizerCountedIterationPrerequisiteHandoff,
  );
}

export function validateCanonicalizerBindingPrerequisiteHandoff(input) {
  return validateExactPrerequisiteHandoff(input, BINDING_PREREQUISITE, 'binding');
}

export function loadCanonicalizerBindingPrerequisiteProvenance() {
  return loadExactPrerequisiteProvenance(
    BINDING_PREREQUISITE,
    validateCanonicalizerBindingPrerequisiteHandoff,
  );
}

export function validateCanonicalizerUnaryPrerequisiteHandoff(input) {
  return validateExactPrerequisiteHandoff(input, UNARY_PREREQUISITE, 'unary expression');
}

export function loadCanonicalizerUnaryPrerequisiteProvenance() {
  return loadExactPrerequisiteProvenance(
    UNARY_PREREQUISITE,
    validateCanonicalizerUnaryPrerequisiteHandoff,
  );
}

export function validateCanonicalizerDoPrerequisiteHandoff(input) {
  return validateExactPrerequisiteHandoff(input, DO_PREREQUISITE, 'do statement');
}

export function loadCanonicalizerDoPrerequisiteProvenance() {
  return loadExactPrerequisiteProvenance(
    DO_PREREQUISITE,
    validateCanonicalizerDoPrerequisiteHandoff,
  );
}

export function validateCanonicalizerWhilePrerequisiteHandoff(input) {
  return validateExactPrerequisiteHandoff(input, WHILE_PREREQUISITE, 'while iteration');
}

export function loadCanonicalizerWhilePrerequisiteProvenance() {
  return loadExactPrerequisiteProvenance(
    WHILE_PREREQUISITE,
    validateCanonicalizerWhilePrerequisiteHandoff,
  );
}

export function validateCanonicalizerNewExpressionPrerequisiteHandoff(input) {
  return validateExactPrerequisiteHandoff(
    input,
    NEW_EXPRESSION_PREREQUISITE,
    'new expression',
  );
}

export function loadCanonicalizerNewExpressionPrerequisiteProvenance() {
  return loadExactPrerequisiteProvenance(
    NEW_EXPRESSION_PREREQUISITE,
    validateCanonicalizerNewExpressionPrerequisiteHandoff,
  );
}

export function validateCanonicalizerPrerequisiteProvenanceChain(input) {
  if (!Array.isArray(input) || input.length !== 7) {
    fail('prerequisite provenance chain must contain exactly seven records');
  }
  const validators = [
    validateCanonicalizerIndexPrerequisiteHandoff,
    validateCanonicalizerCountedIterationPrerequisiteHandoff,
    validateCanonicalizerBindingPrerequisiteHandoff,
    validateCanonicalizerUnaryPrerequisiteHandoff,
    validateCanonicalizerDoPrerequisiteHandoff,
    validateCanonicalizerWhilePrerequisiteHandoff,
    validateCanonicalizerNewExpressionPrerequisiteHandoff,
  ];
  return input.map((entry, index) => {
    const row = record(entry, ['digest', 'record'], `chain[${index}]`);
    const claimedDigest = sha256(row.digest, `chain[${index}].digest`);
    const validated = validators[index](row.record);
    if (claimedDigest !== validated.digest) fail(`chain[${index}] digest must match its record`);
    return validated;
  });
}

export function loadCanonicalizerPrerequisiteProvenanceChain() {
  return validateCanonicalizerPrerequisiteProvenanceChain([
    loadCanonicalizerIndexPrerequisiteProvenance(),
    loadCanonicalizerCountedIterationPrerequisiteProvenance(),
    loadCanonicalizerBindingPrerequisiteProvenance(),
    loadCanonicalizerUnaryPrerequisiteProvenance(),
    loadCanonicalizerDoPrerequisiteProvenance(),
    loadCanonicalizerWhilePrerequisiteProvenance(),
    loadCanonicalizerNewExpressionPrerequisiteProvenance(),
  ]);
}
