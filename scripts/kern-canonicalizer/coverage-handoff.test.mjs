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

test('M4.3d receipt and summary bind both provenance roles without changing selection', () => {
  const receipt = measureCanonicalizerCoverage();
  const summary = summarizeCanonicalizerCoverage(receipt);
  const implementation = loadCanonicalizerImplementationSelectionProvenance();
  assert.equal(receipt.format, 'kern.kir-canonicalizer.coverage-receipt.4');
  assert.equal(summary.format, 'kern.kir-canonicalizer.coverage-summary.4');
  assert.deepEqual(receipt.selectionProvenance, loadCanonicalizerSelectionProvenance());
  assert.deepEqual(receipt.implementationSelectionProvenance, implementation);
  assert.deepEqual(summary.implementationSelectionProvenance, implementation);
  assert.equal(receipt.baseCompleteFunctions, 4);
  assert.deepEqual(receipt.selection.winner, M43C_SELECTION);
});

test('M4.3d extracts ranking without changing KERN capability or family policy', () => {
  const implementationSource = readFileSync(new URL('./coverage-implementation.mjs', import.meta.url), 'utf8');
  const selectionSource = readFileSync(new URL('./coverage-selection.mjs', import.meta.url), 'utf8');
  const canonicalizerSource = readFileSync(
    new URL('../../examples/kern-canonicalizer/canonicalizer.composed.kern', import.meta.url),
  );
  assert.equal(implementationSource.includes('function completes('), false);
  assert.match(selectionSource, /export function rankCanonicalizerFamilies/u);
  assert.ok(implementationSource.split('\n').length - 1 < 440);
  assert.equal(canonicalizerSource.length, 25892, 'M4.3d must not change the executable KERN canonicalizer bytes');
  const policy = JSON.parse(readFileSync(new URL('./coverage-policy.json', import.meta.url), 'utf8'));
  assert.equal(policy.format, 'kern.kir-canonicalizer.coverage-policy.2');
  assert.equal(policy.base.id, 'kern.kir-canonicalizer.profile.m4.3c');
  assert.equal(policy.families.some(({ id }) => id === 'conditional'), true);
});
