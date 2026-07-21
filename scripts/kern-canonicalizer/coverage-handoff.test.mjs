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
  loadCanonicalizerMemberSelectionProvenance,
  loadCanonicalizerSelectionProvenance,
  loadCanonicalizerSelectionProvenanceChain,
  validateCanonicalizerSelectionProvenanceChain,
} from './coverage-selection-provenance.mjs';
import {
  canonicalPrerequisiteProvenanceBytes,
  loadCanonicalizerIndexPrerequisiteProvenance,
  validateCanonicalizerIndexPrerequisiteHandoff,
  validateCanonicalizerPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';

const M43A_DIGEST = '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027';
const M43C_COMMIT = '736e2d1237b6d154b7abbf5f853103c459627424';
const M45_COMMIT = '91a1f91509f39887c7e5f23b413da28e8fb03c22';
const M411_COMMIT = 'b2c653f6757f8af9996a59b998b3c52b9d033d29';
const M412_DIGEST = '83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d';
const M415_COMMIT = '003f3222b23d7543b529186957a67feeb72009b0';
const M416_DIGEST = '3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869';
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
const M411_SELECTION = {
  completeFunctions: 1,
  completeTools: 1,
  id: 'member-expression',
  occurrences: 259,
  witnesses: [
    'examples/capstone-checker-subset/checker-while.kern#8:isPositiveSafeIntText',
  ],
};

test('M4.16 freezes the exact published index prerequisite independently', () => {
  const handoff = loadCanonicalizerIndexPrerequisiteProvenance();
  assert.equal(handoff.digest, M416_DIGEST);
  assert.deepEqual(handoff.record.source, {
    commit: M415_COMMIT,
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.5',
    coverageSummarySha256: '12b26731a6f686f55e8e80736bbb6bdd7bbcb5e7ed514be9628885ddd8ef627c',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.1',
    prerequisiteSummarySha256: '54146de715b207e507d56e303937d0531d8832a5ced3e162b0288be83865f49f',
  });
  assert.deepEqual(handoff.record.snapshot, {
    baseline: {
      baseCompleteFunctions: 21,
      baseId: 'kern.kir-canonicalizer.profile.m4.14',
      corpusMembers: 9,
      functionCount: 104,
      legacyParameterBlockers: 81,
      toolCount: 4,
    },
    minimumFamilyCount: 2,
    selectedPrerequisite: {
      catalogFacts: 1,
      family: 'index-expression',
      occurrences: 494,
    },
    winningClosure: {
      completeFunctions: 6,
      completeTools: 3,
      families: ['counted-iteration', 'index-expression'],
      migratedParameterRows: 14,
      occurrences: 962,
      witnesses: [
        'examples/capstone-checker-subset/checker-while.kern#4:hasDirectChild',
        'examples/capstone-checker-subset/checker-while.kern#6:subtreeEnd',
        'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#8:stringat',
        'examples/selfhost-validator/validator.kern#13:containsid',
        'examples/selfhost-validator/validator.kern#6:rootpath',
        'examples/selfhost-validator/validator.kern#7:statusof',
      ],
    },
  });
  assert.deepEqual(
    canonicalPrerequisiteProvenanceBytes(handoff.record),
    readFileSync(new URL('./coverage-index-prerequisite-provenance.json', import.meta.url)),
  );
});

test('M4.16 prerequisite schema rejects each structural invariant independently', () => {
  const handoff = loadCanonicalizerIndexPrerequisiteProvenance();
  const mutations = [
    (copy) => {
      copy.snapshot.winningClosure.completeFunctions = 2;
      copy.snapshot.winningClosure.completeTools = 3;
      copy.snapshot.winningClosure.witnesses = copy.snapshot.winningClosure.witnesses.slice(0, 2);
    },
    (copy) => { copy.future = true; },
    (copy) => { copy.format = 'future'; },
    (copy) => { delete copy.source.commit; },
    (copy) => { copy.source.commit = 'malformed'; },
    (copy) => { copy.source.coverageSummarySha256 = 'malformed'; },
    (copy) => { copy.source.prerequisiteSummarySha256 = 'malformed'; },
    (copy) => { copy.snapshot.minimumFamilyCount = 1; },
    (copy) => { copy.snapshot.winningClosure.completeFunctions = 0; },
    (copy) => { copy.snapshot.winningClosure.families.reverse(); },
    (copy) => { copy.snapshot.winningClosure.families[1] = copy.snapshot.winningClosure.families[0]; },
    (copy) => { copy.snapshot.winningClosure.witnesses.reverse(); },
    (copy) => { copy.snapshot.winningClosure.witnesses.push(copy.snapshot.winningClosure.witnesses[0]); },
    (copy) => { copy.snapshot.winningClosure.witnesses.pop(); },
    (copy) => { copy.snapshot.selectedPrerequisite.family = 'unary-expression'; },
    (copy) => { copy.snapshot.selectedPrerequisite.catalogFacts = 0; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerPrerequisiteProvenance(copy),
      /prerequisite provenance rejection/u,
    );
  }
});

test('M4.16 exact handoff pin rejects structurally valid causal drift', () => {
  const handoff = loadCanonicalizerIndexPrerequisiteProvenance();
  const mutations = [
    (copy) => { copy.source.commit = '0'.repeat(40); },
    (copy) => { copy.source.coverageSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.source.prerequisiteSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.snapshot.baseline.functionCount += 1; },
    (copy) => { copy.snapshot.selectedPrerequisite.family = 'counted-iteration'; },
    (copy) => { copy.snapshot.selectedPrerequisite.occurrences += 1; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.doesNotThrow(() => validateCanonicalizerPrerequisiteProvenance(copy));
    assert.throws(
      () => validateCanonicalizerIndexPrerequisiteHandoff(copy),
      /prerequisite provenance rejection/u,
    );
  }
});

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

test('M4.12 freezes member-expression selection as a fourth immutable record', () => {
  const member = loadCanonicalizerMemberSelectionProvenance();
  assert.equal(member.digest, M412_DIGEST);
  assert.deepEqual(member.record.source, {
    canonicalizerSha256: 'e2930f10fddfbfc2682d420ec61e494a7171f051801455336f213af2e719e59b',
    commit: M411_COMMIT,
    coveragePolicySha256: 'be9e50847de262ce4c9cb1d78a12fd410cf304d3cd294a45f7dff544e18a2584',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.5',
    coverageSummarySha256: '90af9577a59318c27c60e9209113532e39b14d83c993de07882e24ae434ea846',
  });
  assert.deepEqual(member.record.snapshot, {
    corpusMembers: 9,
    functionCount: 104,
    selection: M411_SELECTION,
    toolCount: 4,
  });
  assert.deepEqual(
    canonicalSelectionProvenanceBytes(member.record),
    readFileSync(new URL('./coverage-member-expression-selection-provenance.json', import.meta.url)),
  );
});

test('M4.12 selection history and member implementation pointer fail closed on drift', () => {
  const chain = loadCanonicalizerSelectionProvenanceChain();
  assert.equal(chain.selectionProvenances.length, 4);
  assert.equal(chain.implementationSelectionProvenanceDigest, chain.selectionProvenances[3].digest);
  assert.deepEqual(chain.selectionProvenances.map(({ record }) => record.snapshot.selection.id), [
    'binary-expression',
    'conditional',
    'call-expression',
    'member-expression',
  ]);
  assert.equal(chain.selectionProvenances[3].digest, M412_DIGEST);
  const mutations = [
    (copy) => { copy.selectionProvenances.reverse(); },
    (copy) => { copy.selectionProvenances.pop(); },
    (copy) => { copy.selectionProvenances[3].digest = '0'.repeat(64); },
    (copy) => { copy.selectionProvenances[3].record.format = 'future'; },
    (copy) => { copy.selectionProvenances[3].record.source.commit = '0'.repeat(40); },
    (copy) => { copy.selectionProvenances[3].record.source.coverageSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.selectionProvenances[3].record.snapshot.functionCount += 1; },
    (copy) => { copy.selectionProvenances[3].record.snapshot.selection.id = 'call-expression'; },
    (copy) => { copy.selectionProvenances[3].record.snapshot.selection.witnesses.push(
      copy.selectionProvenances[3].record.snapshot.selection.witnesses[0],
    ); },
    (copy) => { copy.selectionProvenances[2].record.snapshot.selection.witnesses.reverse(); },
    (copy) => { copy.implementationSelectionProvenanceDigest = chain.selectionProvenances[2].digest; },
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

test('the current corpus consumes frozen M4.14 provenance after member promotion', () => {
  const receipt = measureCanonicalizerCoverage();
  const summary = summarizeCanonicalizerCoverage(receipt);
  const promoted = loadCanonicalizerSelectionProvenance();
  const implementation = loadCanonicalizerImplementationSelectionProvenance();
  const call = loadCanonicalizerCallSelectionProvenance();
  const member = loadCanonicalizerMemberSelectionProvenance();
  assert.equal(receipt.format, 'kern.kir-canonicalizer.coverage-receipt.5');
  assert.equal(summary.format, 'kern.kir-canonicalizer.coverage-summary.5');
  assert.deepEqual(receipt.selectionProvenances, [promoted, implementation, call, member]);
  assert.deepEqual(summary.selectionProvenances, [promoted, implementation, call, member]);
  assert.equal(receipt.selectionProvenances.length, 4);
  assert.equal(summary.selectionProvenances.length, 4);
  assert.equal(receipt.implementationSelectionProvenanceDigest, member.digest);
  assert.equal(summary.implementationSelectionProvenanceDigest, member.digest);
  assert.equal(implementation.record.snapshot.corpusMembers, 8);
  assert.equal(implementation.record.snapshot.functionCount, 99);
  assert.equal(receipt.corpus.length, 9);
  assert.equal(receipt.functions.length, 104);
  assert.notEqual(receipt.canonicalizerDigest, implementation.record.source.canonicalizerSha256);
  assert.notEqual(receipt.coveragePolicyDigest, implementation.record.source.coveragePolicySha256);
  assert.equal(implementation.record.snapshot.selection.occurrences, 1115);
  assert.equal(receipt.baseCompleteFunctions, 21);
  assert.equal(receipt.selection.winner, null);
  assert.deepEqual(call.record.snapshot.selection, M45_SELECTION);
});

test('M4.17 preserves M4.14 promotion while binding the exact live index capability', () => {
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
  assert.equal(canonicalizerSource.length, 34547, 'M4.17 must bind the exact live KERN capability byte count');
  assert.equal(
    createHash('sha256').update(canonicalizerSource).digest('hex'),
    '37b081f3ff01320b96cf7482d096999f4121429d700e8f8fe0852f2f8e1e9308',
    'M4.17 must bind the exact live KERN capability digest',
  );
  assert.match(canonicalizerSource.toString('utf8'), /if cond="kind == \\"call\\""/u);
  assert.match(canonicalizerSource.toString('utf8'), /if cond="kind == \\"member\\""/u);
  assert.match(canonicalizerSource.toString('utf8'), /if cond="kind == \\"index\\""/u);
  const policy = JSON.parse(readFileSync(new URL('./coverage-policy.json', import.meta.url), 'utf8'));
  assert.equal(policy.format, 'kern.kir-canonicalizer.coverage-policy.2');
  assert.equal(policy.base.id, 'kern.kir-canonicalizer.profile.m4.14');
  assert.equal(policy.families.some(({ id }) => id === 'conditional'), false);
  assert.equal(policy.families.some(({ id }) => id === 'call-expression'), false);
  assert.equal(policy.families.some(({ id }) => id === 'member-expression'), false);
  assert.equal(policy.families.some(({ id }) => id === 'index-expression'), true);
  assert.equal(policy.base.expressionKinds.includes('index'), false);
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
  assert.equal(policy.base.promotions[3].family, 'member-expression');
  assert.equal(
    policy.base.promotions[3].selectionProvenanceDigest,
    loadCanonicalizerMemberSelectionProvenance().digest,
  );
});
