import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
} from './coverage.mjs';
import {
  canonicalSelectionProvenanceBytes,
  loadCanonicalizerImplementationSelectionProvenance,
  loadCanonicalizerSelectionProvenance,
} from './coverage-selection-provenance.mjs';

const M43A_DIGEST = '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027';
const M43C_COMMIT = '736e2d1237b6d154b7abbf5f853103c459627424';
const M43C_SELECTION = {
  completeFunctions: 2,
  completeTools: 1,
  id: 'conditional',
  occurrences: 1115,
  witnesses: [
    'examples/capstone-assertion-engine/diag.kern#0:pathAppendKey',
    'examples/capstone-assertion-engine/diag.kern#3:failResult',
  ],
};
const M45_SELECTION = {
  completeFunctions: 2,
  completeTools: 1,
  id: 'call-expression',
  occurrences: 481,
  witnesses: [
    'examples/capstone-assertion-engine/diag.kern#1:pathAppendIndex',
    'examples/capstone-assertion-engine/diag.kern#6:reasonLengthMismatch',
  ],
};

test('M4.3d freezes distinct promoted-base and implementation-selection provenance', () => {
  const promoted = loadCanonicalizerSelectionProvenance();
  const implementation = loadCanonicalizerImplementationSelectionProvenance();
  assert.equal(promoted.digest, M43A_DIGEST);
  assert.equal(promoted.record.snapshot.selection.id, 'binary-expression');
  assert.notEqual(implementation.digest, promoted.digest);
  assert.equal(implementation.record.source.commit, M43C_COMMIT);
  assert.equal(
    implementation.record.source.coverageSummarySha256,
    '2f201a51f1a2d580f6cf4521ebfa6f1a896851edc069bcb20562ecc2f53de8ee',
  );
  assert.deepEqual(implementation.record.snapshot, {
    corpusMembers: 8,
    functionCount: 99,
    selection: M43C_SELECTION,
    toolCount: 4,
  });
  assert.deepEqual(
    canonicalSelectionProvenanceBytes(implementation.record),
    readFileSync(new URL('./coverage-implementation-selection-provenance.json', import.meta.url)),
  );
});

test('M4.5 consumes frozen M4.3c provenance while live evidence advances', () => {
  const receipt = measureCanonicalizerCoverage();
  const summary = summarizeCanonicalizerCoverage(receipt);
  const implementation = loadCanonicalizerImplementationSelectionProvenance();
  assert.equal(receipt.format, 'kern.kir-canonicalizer.coverage-receipt.4');
  assert.equal(summary.format, 'kern.kir-canonicalizer.coverage-summary.4');
  assert.deepEqual(receipt.selectionProvenance, loadCanonicalizerSelectionProvenance());
  assert.deepEqual(receipt.implementationSelectionProvenance, implementation);
  assert.deepEqual(summary.implementationSelectionProvenance, implementation);
  assert.equal(implementation.record.snapshot.corpusMembers, 8);
  assert.equal(implementation.record.snapshot.functionCount, 99);
  assert.equal(receipt.corpus.length, 9);
  assert.equal(receipt.functions.length, 104);
  assert.notEqual(receipt.canonicalizerDigest, implementation.record.source.canonicalizerSha256);
  assert.notEqual(receipt.coveragePolicyDigest, implementation.record.source.coveragePolicySha256);
  assert.equal(implementation.record.snapshot.selection.occurrences, 1115);
  assert.equal(receipt.baseCompleteFunctions, 6);
  assert.deepEqual(receipt.selection.winner, M45_SELECTION);
});

test('M4.5 promotes conditional without changing the exact M4.4 KERN capability', () => {
  const implementationSource = readFileSync(new URL('./coverage-implementation.mjs', import.meta.url), 'utf8');
  const selectionSource = readFileSync(new URL('./coverage-selection.mjs', import.meta.url), 'utf8');
  const canonicalizerSource = readFileSync(
    new URL('../../examples/kern-canonicalizer/canonicalizer.composed.kern', import.meta.url),
  );
  assert.equal(implementationSource.includes('function completes('), false);
  assert.match(selectionSource, /export function rankCanonicalizerFamilies/u);
  assert.ok(implementationSource.split('\n').length - 1 < 500);
  assert.equal(
    canonicalizerSource.length,
    30866,
    'M4.4 must bind the exact three-member conditional canonicalizer bytes',
  );
  const policy = JSON.parse(readFileSync(new URL('./coverage-policy.json', import.meta.url), 'utf8'));
  assert.equal(policy.format, 'kern.kir-canonicalizer.coverage-policy.2');
  assert.equal(policy.base.id, 'kern.kir-canonicalizer.profile.m4.5');
  assert.equal(policy.families.some(({ id }) => id === 'conditional'), false);
  assert.equal(policy.base.nodeKinds.includes('if'), true);
  assert.equal(policy.base.nodeKinds.includes('else'), true);
  assert.equal(policy.base.promotions[1].family, 'conditional');
  assert.equal(
    policy.base.promotions[1].selectionProvenanceDigest,
    loadCanonicalizerImplementationSelectionProvenance().digest,
  );
});
