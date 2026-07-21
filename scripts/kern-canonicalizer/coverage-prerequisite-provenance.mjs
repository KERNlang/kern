import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const FORMAT = 'kern.kir-canonicalizer.prerequisite-provenance.1';
const COVERAGE_SUMMARY_FORMAT = 'kern.kir-canonicalizer.coverage-summary.5';
const PREREQUISITE_SUMMARY_FORMAT = 'kern.kir-canonicalizer.prerequisite-summary.1';
const INDEX_PREREQUISITE = Object.freeze({
  digest: '3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869',
  source: readFileSync(new URL('./coverage-index-prerequisite-provenance.json', import.meta.url)),
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
  if (sourceInput.coverageSummaryFormat !== COVERAGE_SUMMARY_FORMAT) {
    fail(`source.coverageSummaryFormat must be ${COVERAGE_SUMMARY_FORMAT}`);
  }
  if (sourceInput.prerequisiteSummaryFormat !== PREREQUISITE_SUMMARY_FORMAT) {
    fail(`source.prerequisiteSummaryFormat must be ${PREREQUISITE_SUMMARY_FORMAT}`);
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
      coverageSummaryFormat: COVERAGE_SUMMARY_FORMAT,
      coverageSummarySha256: sha256(sourceInput.coverageSummarySha256, 'source.coverageSummarySha256'),
      prerequisiteSummaryFormat: PREREQUISITE_SUMMARY_FORMAT,
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

export function validateCanonicalizerIndexPrerequisiteHandoff(input) {
  const validated = validateCanonicalizerPrerequisiteProvenance(input);
  const canonical = Buffer.from(`${JSON.stringify(validated, null, 2)}\n`);
  const digest = createHash('sha256').update(canonical).digest('hex');
  if (digest !== INDEX_PREREQUISITE.digest) fail('index handoff must match the exact M4.15 prerequisite');
  return { digest, record: validated };
}

export function loadCanonicalizerIndexPrerequisiteProvenance() {
  const parsed = JSON.parse(INDEX_PREREQUISITE.source.toString('utf8'));
  const handoff = validateCanonicalizerIndexPrerequisiteHandoff(parsed);
  if (!INDEX_PREREQUISITE.source.equals(canonicalPrerequisiteProvenanceBytes(handoff.record))) {
    fail('checked-in prerequisite provenance must use canonical JSON bytes');
  }
  return handoff;
}
