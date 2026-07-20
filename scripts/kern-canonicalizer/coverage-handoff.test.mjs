import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
} from './coverage.mjs';
import {
  canonicalSelectionProvenanceBytes,
  loadCanonicalizerCallSelectionProvenance,
  loadCanonicalizerImplementationSelectionProvenance,
  loadCanonicalizerSelectionProvenance,
  loadCanonicalizerSelectionProvenanceChain,
  validateCanonicalizerSelectionProvenanceChain,
} from './coverage-selection-provenance.mjs';

const M43A_DIGEST = '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027';
const M43C_COMMIT = '736e2d1237b6d154b7abbf5f853103c459627424';
const M45_COMMIT = '91a1f91509f39887c7e5f23b413da28e8fb03c22';
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
test('M4.5a freezes call-expression selection as a third immutable record', () => {
  const call = loadCanonicalizerCallSelectionProvenance();
  assert.equal(call.record.source.commit, M45_COMMIT);
  assert.equal(
    call.record.source.coverageSummarySha256,
    '7baf457852184a7e6c2df54ab9ff2e7870e6b8cb5c58f2844187624c5ba75e50',
  );
  assert.deepEqual(call.record.snapshot, {
    corpusMembers: 9,
    functionCount: 104,
    selection: M45_SELECTION,
    toolCount: 4,
  });
  assert.deepEqual(
    canonicalSelectionProvenanceBytes(call.record),
    readFileSync(new URL('./coverage-call-selection-provenance.json', import.meta.url)),
  );
});

test('M4.5a selection history and implementation pointer fail closed on drift', () => {
  const chain = loadCanonicalizerSelectionProvenanceChain();
  assert.equal(chain.implementationSelectionProvenanceDigest, chain.selectionProvenances[2].digest);
  assert.deepEqual(chain.selectionProvenances.map(({ record }) => record.snapshot.selection.id), [
    'binary-expression',
    'conditional',
    'call-expression',
  ]);
  const mutations = [
    (copy) => { copy.selectionProvenances.reverse(); },
    (copy) => { copy.selectionProvenances.pop(); },
    (copy) => { copy.selectionProvenances[2].digest = '0'.repeat(64); },
    (copy) => { copy.selectionProvenances[2].record.format = 'future'; },
    (copy) => { copy.selectionProvenances[2].record.source.commit = '0'.repeat(40); },
    (copy) => { copy.selectionProvenances[2].record.snapshot.functionCount += 1; },
    (copy) => { copy.selectionProvenances[2].record.snapshot.selection.id = 'future'; },
    (copy) => { copy.selectionProvenances[2].record.snapshot.selection.witnesses.reverse(); },
    (copy) => { copy.implementationSelectionProvenanceDigest = chain.selectionProvenances[1].digest; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(chain);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerSelectionProvenanceChain(
        copy.selectionProvenances,
        copy.implementationSelectionProvenanceDigest,
      ),
      /selection provenance rejection/u,
    );
  }
});

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

test('M4.5c consumes frozen provenance while the call family joins the base', () => {
  const receipt = measureCanonicalizerCoverage();
  const summary = summarizeCanonicalizerCoverage(receipt);
  const promoted = loadCanonicalizerSelectionProvenance();
  const implementation = loadCanonicalizerImplementationSelectionProvenance();
  const call = loadCanonicalizerCallSelectionProvenance();
  assert.equal(receipt.format, 'kern.kir-canonicalizer.coverage-receipt.5');
  assert.equal(summary.format, 'kern.kir-canonicalizer.coverage-summary.5');
  assert.deepEqual(receipt.selectionProvenances, [promoted, implementation, call]);
  assert.deepEqual(summary.selectionProvenances, [promoted, implementation, call]);
  assert.equal(receipt.implementationSelectionProvenanceDigest, call.digest);
  assert.equal(summary.implementationSelectionProvenanceDigest, call.digest);
  assert.equal(implementation.record.snapshot.corpusMembers, 8);
  assert.equal(implementation.record.snapshot.functionCount, 99);
  assert.equal(receipt.corpus.length, 9);
  assert.equal(receipt.functions.length, 104);
  assert.notEqual(receipt.canonicalizerDigest, implementation.record.source.canonicalizerSha256);
  assert.notEqual(receipt.coveragePolicyDigest, implementation.record.source.coveragePolicySha256);
  assert.equal(implementation.record.snapshot.selection.occurrences, 1115);
  assert.equal(receipt.baseCompleteFunctions, 8);
  assert.equal(receipt.selection.winner, null);
  assert.deepEqual(call.record.snapshot.selection, M45_SELECTION);
});

test('M4.5c promotes exact call capability without rewriting selection evidence', () => {
  const implementationSource = readFileSync(new URL('./coverage-implementation.mjs', import.meta.url), 'utf8');
  const selectionSource = readFileSync(new URL('./coverage-selection.mjs', import.meta.url), 'utf8');
  const canonicalizerSource = readFileSync(
    new URL('../../examples/kern-canonicalizer/canonicalizer.composed.kern', import.meta.url),
  );
  assert.equal(implementationSource.includes('function completes('), false);
  assert.match(selectionSource, /export function rankCanonicalizerFamilies/u);
  assert.ok(implementationSource.split('\n').length - 1 < 450);
  assert.equal(
    loadCanonicalizerCallSelectionProvenance().record.source.canonicalizerSha256,
    'd7116ba9cb7bb3c86d5692dfb72f98a715322b028f59cec622dc21588aaa66cc',
    'M4.5a must retain the exact pre-call implementation selection bytes',
  );
  assert.equal(canonicalizerSource.length, 32301, 'M4.5b must bind the exact live KERN capability byte count');
  assert.equal(
    createHash('sha256').update(canonicalizerSource).digest('hex'),
    '279725b92d959ddbc734f096749d904fde36934ef4a1c73769e87a84e6e72087',
    'M4.5b must bind the exact live KERN capability digest',
  );
  assert.match(canonicalizerSource.toString('utf8'), /if cond="kind == \\"call\\""/u);
  const policy = JSON.parse(readFileSync(new URL('./coverage-policy.json', import.meta.url), 'utf8'));
  assert.equal(policy.format, 'kern.kir-canonicalizer.coverage-policy.2');
  assert.equal(policy.base.id, 'kern.kir-canonicalizer.profile.m4.5c');
  assert.equal(policy.families.some(({ id }) => id === 'conditional'), false);
  assert.equal(policy.families.some(({ id }) => id === 'call-expression'), false);
  assert.equal(policy.base.nodeKinds.includes('if'), true);
  assert.equal(policy.base.nodeKinds.includes('else'), true);
  assert.equal(policy.base.promotions[1].family, 'conditional');
  assert.equal(
    policy.base.promotions[1].selectionProvenanceDigest,
    loadCanonicalizerImplementationSelectionProvenance().digest,
  );
  assert.equal(policy.base.promotions[2].family, 'call-expression');
  assert.equal(
    policy.base.promotions[2].selectionProvenanceDigest,
    loadCanonicalizerCallSelectionProvenance().digest,
  );
});
