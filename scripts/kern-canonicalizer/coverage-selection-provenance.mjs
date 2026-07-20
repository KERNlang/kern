import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const FORMAT = 'kern.kir-canonicalizer.selection-provenance.1';
const PROMOTED_SELECTION = Object.freeze({
  digest: '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027',
  label: 'M4.3a selection',
  source: readFileSync(new URL('./coverage-selection-provenance.json', import.meta.url)),
});
const IMPLEMENTATION_SELECTION = Object.freeze({
  digest: 'fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b',
  label: 'M4.3c implementation selection',
  source: readFileSync(new URL('./coverage-implementation-selection-provenance.json', import.meta.url)),
});
const CALL_SELECTION = Object.freeze({
  digest: '7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605',
  label: 'M4.5 call-expression selection',
  source: readFileSync(new URL('./coverage-call-selection-provenance.json', import.meta.url)),
});
const MEMBER_SELECTION = Object.freeze({
  digest: '83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d',
  label: 'M4.11 member-expression selection',
  source: readFileSync(new URL('./coverage-member-expression-selection-provenance.json', import.meta.url)),
});
const SELECTION_CHAIN_DIGESTS = [
  PROMOTED_SELECTION.digest,
  IMPLEMENTATION_SELECTION.digest,
  CALL_SELECTION.digest,
  MEMBER_SELECTION.digest,
];

function fail(message) {
  throw new TypeError(`selection provenance rejection: ${message}`);
}

function record(value, fields, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
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

function sha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) fail(`${label} must be lowercase SHA-256`);
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be non-empty text`);
  return value;
}

export function validateCanonicalizerSelectionProvenance(input) {
  const value = record(input, ['format', 'snapshot', 'source'], 'provenance');
  if (value.format !== FORMAT) fail(`format must be ${FORMAT}`);
  const snapshotInput = record(
    value.snapshot,
    ['corpusMembers', 'functionCount', 'selection', 'toolCount'],
    'snapshot',
  );
  const selectionInput = record(
    snapshotInput.selection,
    ['completeFunctions', 'completeTools', 'id', 'occurrences', 'witnesses'],
    'snapshot.selection',
  );
  if (!Array.isArray(selectionInput.witnesses) || selectionInput.witnesses.length === 0) {
    fail('snapshot.selection.witnesses must be a non-empty array');
  }
  const witnesses = selectionInput.witnesses.map((entry, index) => text(
    entry,
    `snapshot.selection.witnesses[${index}]`,
  ));
  if (new Set(witnesses).size !== witnesses.length || witnesses.some((entry, index) => (
    index > 0 && witnesses[index - 1] >= entry
  ))) {
    fail('snapshot.selection.witnesses must be sorted and unique');
  }
  const sourceInput = record(
    value.source,
    [
      'canonicalizerSha256',
      'commit',
      'coveragePolicySha256',
      'coverageSummaryFormat',
      'coverageSummarySha256',
    ],
    'source',
  );
  if (typeof sourceInput.commit !== 'string' || !/^[0-9a-f]{40}$/u.test(sourceInput.commit)) {
    fail('source.commit must be a full lowercase git object id');
  }
  return {
    format: FORMAT,
    snapshot: {
      corpusMembers: positiveInteger(snapshotInput.corpusMembers, 'snapshot.corpusMembers'),
      functionCount: positiveInteger(snapshotInput.functionCount, 'snapshot.functionCount'),
      selection: {
        completeFunctions: positiveInteger(selectionInput.completeFunctions, 'snapshot.selection.completeFunctions'),
        completeTools: positiveInteger(selectionInput.completeTools, 'snapshot.selection.completeTools'),
        id: text(selectionInput.id, 'snapshot.selection.id'),
        occurrences: positiveInteger(selectionInput.occurrences, 'snapshot.selection.occurrences'),
        witnesses,
      },
      toolCount: positiveInteger(snapshotInput.toolCount, 'snapshot.toolCount'),
    },
    source: {
      canonicalizerSha256: sha256(sourceInput.canonicalizerSha256, 'source.canonicalizerSha256'),
      commit: sourceInput.commit,
      coveragePolicySha256: sha256(sourceInput.coveragePolicySha256, 'source.coveragePolicySha256'),
      coverageSummaryFormat: text(sourceInput.coverageSummaryFormat, 'source.coverageSummaryFormat'),
      coverageSummarySha256: sha256(sourceInput.coverageSummarySha256, 'source.coverageSummarySha256'),
    },
  };
}

export function canonicalSelectionProvenanceBytes(input) {
  return Buffer.from(`${JSON.stringify(validateCanonicalizerSelectionProvenance(input), null, 2)}\n`);
}

function loadPinnedSelectionProvenance(pin) {
  const record = validateCanonicalizerSelectionProvenance(JSON.parse(pin.source.toString('utf8')));
  const canonical = canonicalSelectionProvenanceBytes(record);
  if (!pin.source.equals(canonical)) fail('checked-in provenance must use canonical JSON bytes');
  const digest = createHash('sha256').update(canonical).digest('hex');
  if (digest !== pin.digest) fail(`checked-in provenance differs from the frozen ${pin.label}`);
  return { digest, record };
}

export function loadCanonicalizerSelectionProvenance() {
  return loadPinnedSelectionProvenance(PROMOTED_SELECTION);
}

export function loadCanonicalizerImplementationSelectionProvenance() {
  return loadPinnedSelectionProvenance(IMPLEMENTATION_SELECTION);
}

export function loadCanonicalizerCallSelectionProvenance() {
  return loadPinnedSelectionProvenance(CALL_SELECTION);
}

export function loadCanonicalizerMemberSelectionProvenance() {
  return loadPinnedSelectionProvenance(MEMBER_SELECTION);
}

export function validateCanonicalizerSelectionProvenanceChain(
  selectionProvenances,
  implementationSelectionProvenanceDigest,
) {
  if (!Array.isArray(selectionProvenances) || selectionProvenances.length !== SELECTION_CHAIN_DIGESTS.length) {
    fail('selection provenance chain must contain the exact M4.12 history');
  }
  const validated = selectionProvenances.map((entry, index) => {
    const value = record(entry, ['digest', 'record'], `selectionProvenances[${index}]`);
    const provenance = validateCanonicalizerSelectionProvenance(value.record);
    const canonical = canonicalSelectionProvenanceBytes(provenance);
    const actualDigest = createHash('sha256').update(canonical).digest('hex');
    if (value.digest !== SELECTION_CHAIN_DIGESTS[index] || value.digest !== actualDigest) {
      fail(`selectionProvenances[${index}] must match the exact canonical history`);
    }
    return { digest: value.digest, record: provenance };
  });
  const families = validated.map(({ record: provenance }) => provenance.snapshot.selection.id);
  if (new Set(families).size !== families.length) fail('selection provenance families must be unique');
  if (new Set(validated.map(({ digest }) => digest)).size !== validated.length) {
    fail('selection provenance digests must be unique');
  }
  if (
    implementationSelectionProvenanceDigest !== MEMBER_SELECTION.digest ||
    validated.filter(({ digest }) => digest === implementationSelectionProvenanceDigest).length !== 1
  ) {
    fail('implementation selection provenance digest must resolve exactly once');
  }
  return {
    implementationSelectionProvenanceDigest,
    selectionProvenances: validated,
  };
}

export function loadCanonicalizerSelectionProvenanceChain() {
  return validateCanonicalizerSelectionProvenanceChain(
    [
      loadCanonicalizerSelectionProvenance(),
      loadCanonicalizerImplementationSelectionProvenance(),
      loadCanonicalizerCallSelectionProvenance(),
      loadCanonicalizerMemberSelectionProvenance(),
    ],
    MEMBER_SELECTION.digest,
  );
}
