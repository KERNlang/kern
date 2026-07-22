import assert from 'node:assert/strict';

import { summarizeCanonicalizerCoverage } from './kern-canonicalizer/coverage.mjs';
import { measureCanonicalizerPrerequisite } from './kern-canonicalizer/coverage-prerequisite.mjs';
import { loadPublishedCanonicalizerPrerequisiteM444 } from './kern-canonicalizer/coverage-prerequisite-m4-44.mjs';
import { loadPublishedCanonicalizerPrerequisiteM448 } from './kern-canonicalizer/coverage-prerequisite-m4-48.mjs';
import { loadCanonicalizerPrerequisiteProvenanceChain } from './kern-canonicalizer/coverage-prerequisite-provenance.mjs';
import {
  loadCanonicalizerResidualAnalysisHandoff,
} from './kern-canonicalizer/coverage-residual-analysis.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM438,
} from './kern-canonicalizer/coverage-residual-analysis-m4-38.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM442,
} from './kern-canonicalizer/coverage-residual-analysis-m4-42.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM443,
} from './kern-canonicalizer/coverage-residual-analysis-m4-43.mjs';
import { loadPublishedCanonicalizerResidualAnalysisM446 } from './kern-canonicalizer/coverage-residual-analysis-m4-46.mjs';
import { loadPublishedCanonicalizerResidualAnalysisM450 } from './kern-canonicalizer/coverage-residual-analysis-m4-50.mjs';
import { loadPublishedCanonicalizerNodeRowHeadroomM447 } from './kern-canonicalizer/node-row-headroom-m4-47.mjs';
import {
  measureCanonicalizerPropertyRowHeadroomM451,
} from './kern-canonicalizer/property-row-headroom-m4-51.mjs';
import { assertCoverageSummary, writeCoverageSummary } from './kern-canonicalizer/coverage-summary-writer.mjs';
import {
  formatCoverageWinnerStatus,
  formatHistoricalResidualAnalysisStatus,
  formatM442ResidualAnalysisStatus,
  formatM443ResidualAnalysisStatus,
  formatM446ResidualAnalysisStatus,
  formatM447NodeRowHeadroomStatus,
  formatM450ResidualAnalysisStatus,
  formatM451PropertyRowHeadroomStatus,
  formatPublishedResidualAnalysisStatus,
} from './kern-canonicalizer/coverage-status.mjs';

const summaryUrl = new URL('./kern-canonicalizer/coverage-summary.json', import.meta.url);
const prerequisiteSummaryUrl = new URL(
  './kern-canonicalizer/coverage-prerequisite-summary.json',
  import.meta.url,
);
const m442ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-42.json', import.meta.url);
const m443ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-43.json', import.meta.url);
const m446ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-46.json', import.meta.url);
const m447NodeRowHeadroomUrl = new URL('./kern-canonicalizer/node-row-headroom-m4-47.json', import.meta.url);
const m450ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-50.json', import.meta.url);
const m451PropertyRowHeadroomUrl = new URL('./kern-canonicalizer/property-row-headroom-m4-51.json', import.meta.url);
const actual = summarizeCanonicalizerCoverage();
const prerequisite = measureCanonicalizerPrerequisite();
const m444PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM444();
const m448PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM448();
const residualAnalysisHandoff = loadCanonicalizerResidualAnalysisHandoff();
const residualAnalysis = residualAnalysisHandoff.record;
const m438ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM438();
const m438ResidualAnalysis = m438ResidualAnalysisHandoff.record;
const m442ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM442();
const m442ResidualAnalysis = m442ResidualAnalysisHandoff.record;
const m443ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM443();
const m443ResidualAnalysis = m443ResidualAnalysisHandoff.record;
const m446ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM446();
const m446ResidualAnalysis = m446ResidualAnalysisHandoff.record;
const m447NodeRowHeadroomHandoff = loadPublishedCanonicalizerNodeRowHeadroomM447();
const m447NodeRowHeadroom = m447NodeRowHeadroomHandoff.record;
const m450ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM450();
const m450ResidualAnalysis = m450ResidualAnalysisHandoff.record;
const m451PropertyRowHeadroom = measureCanonicalizerPropertyRowHeadroomM451();
const prerequisiteHandoffs = loadCanonicalizerPrerequisiteProvenanceChain();
if (process.argv.includes('--write')) {
  writeCoverageSummary(summaryUrl, actual);
  writeCoverageSummary(prerequisiteSummaryUrl, prerequisite);
  writeCoverageSummary(m451PropertyRowHeadroomUrl, m451PropertyRowHeadroom);
} else {
  assert.equal(actual.format, 'kern.kir-canonicalizer.coverage-summary.6');
  assert.equal(actual.selectionProvenances.length, 4);
  assert.equal(actual.selectionProvenances[0].digest, '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027');
  assert.deepEqual(actual.selectionProvenances[0].record.snapshot, {
    corpusMembers: 7,
    functionCount: 98,
    selection: {
      completeFunctions: 3,
      completeTools: 1,
      id: 'binary-expression',
      occurrences: 941,
      witnesses: [
        'examples/capstone-assertion-engine/diag.kern#4:reasonTypeMismatch',
        'examples/capstone-assertion-engine/diag.kern#5:reasonValueMismatch',
        'examples/capstone-assertion-engine/diag.kern#7:reasonKeyMismatch',
      ],
    },
    toolCount: 4,
  }, 'frozen M4.3a selection provenance must remain exact');
  assert.equal(
    actual.selectionProvenances[1].digest,
    'fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b',
  );
  assert.deepEqual(actual.selectionProvenances[1].record.snapshot, {
    corpusMembers: 8,
    functionCount: 99,
    selection: {
      completeFunctions: 2,
      completeTools: 1,
      id: 'conditional',
      occurrences: 1115,
      witnesses: [
        'examples/capstone-assertion-engine/diag.kern#0:pathAppendKey',
        'examples/capstone-assertion-engine/diag.kern#3:failResult',
      ],
    },
    toolCount: 4,
  }, 'frozen M4.3c implementation selection provenance must remain exact');
  assert.equal(
    actual.selectionProvenances[2].digest,
    '7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605',
  );
  assert.deepEqual(actual.selectionProvenances[2].record.snapshot, {
    corpusMembers: 9,
    functionCount: 104,
    selection: {
      completeFunctions: 2,
      completeTools: 1,
      id: 'call-expression',
      occurrences: 481,
      witnesses: [
        'examples/capstone-assertion-engine/diag.kern#1:pathAppendIndex',
        'examples/capstone-assertion-engine/diag.kern#6:reasonLengthMismatch',
      ],
    },
    toolCount: 4,
  }, 'frozen M4.5 call-expression selection provenance must remain exact');
  assert.equal(
    actual.selectionProvenances[3].digest,
    '83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d',
  );
  assert.equal(actual.implementationSelectionProvenanceDigest, actual.selectionProvenances[3].digest);
  assert.deepEqual(actual.selectionProvenances[3].record.snapshot, {
    corpusMembers: 9,
    functionCount: 104,
    selection: {
      completeFunctions: 1,
      completeTools: 1,
      id: 'member-expression',
      occurrences: 259,
      witnesses: [
        'examples/capstone-checker-subset/checker-while.kern#8:isPositiveSafeIntText',
      ],
    },
    toolCount: 4,
  }, 'frozen M4.11 member-expression selection provenance must remain exact');
  assert.equal(actual.prerequisiteProvenances.length, 5);
  assert.deepEqual(actual.prerequisiteProvenances, prerequisiteHandoffs);
  assert.deepEqual(actual.implementationProvenance, {
    family: 'do-statement',
    provenanceDigest: prerequisiteHandoffs[4].digest,
    provenanceKind: 'prerequisite',
  });
  assert.equal(actual.base.id, 'kern.kir-canonicalizer.profile.m4.36');
  assert.deepEqual(actual.base.promotions, [
    {
      family: 'binary-expression',
      provenanceDigest: '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027',
      provenanceKind: 'selection',
    },
    {
      family: 'conditional',
      provenanceDigest: 'fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b',
      provenanceKind: 'selection',
    },
    {
      family: 'call-expression',
      provenanceDigest: '7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605',
      provenanceKind: 'selection',
    },
    {
      family: 'member-expression',
      provenanceDigest: '83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d',
      provenanceKind: 'selection',
    },
    {
      family: 'index-expression',
      provenanceDigest: '3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869',
      provenanceKind: 'prerequisite',
    },
    {
      family: 'counted-iteration',
      provenanceDigest: 'af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b',
      provenanceKind: 'prerequisite',
    },
    {
      family: 'binding',
      provenanceDigest: '00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab',
      provenanceKind: 'prerequisite',
    },
    {
      family: 'unary-expression',
      provenanceDigest: 'e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5',
      provenanceKind: 'prerequisite',
    },
    {
      family: 'do-statement',
      provenanceDigest: '3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72',
      provenanceKind: 'prerequisite',
    },
  ], 'M4.41 must preserve the nine promoted provenance citations');
  assert.equal(actual.corpusMembers, 9, 'live M4.41 handwritten corpus count must remain exact');
  assert.equal(actual.functionCount, 104, 'live M4.41 authored function count must remain exact');
  assert.equal(actual.toolCount, 4, 'live M4.41 tool count must remain exact');
  assert.equal(actual.baseCompleteFunctions, 64, 'live M4.49 base completion must remain exactly 64/104');
  assert.equal(
    actual.blockers.find(({ id }) => id === 'fn.params')?.count,
    39,
    'live M4.49 fn.params blocker count must remain exactly 39',
  );
  assert.equal(actual.selection.winner, null, 'live M4.41 measurement must have no ordinary winner');
  assert.deepEqual(
    actual.selection.ranking.map(({ completeFunctions, completeTools, id }) => ({ completeFunctions, completeTools, id })),
    [
      { completeFunctions: 0, completeTools: 0, id: 'exception-flow' },
      { completeFunctions: 0, completeTools: 0, id: 'while-iteration' },
    ],
    'live M4.41 residual zero-completion ranking must remain exact',
  );
  assertCoverageSummary(summaryUrl, actual);
  assert.equal(prerequisite.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.equal(m444PrerequisiteHandoff.digest, '9741650d8567016fb029a8e51b4706da1da131d9870c94a3221b4550792dee01');
  assert.equal(m444PrerequisiteHandoff.sourceCommit, 'dd977ff493250127e2e416ffb4e3ab68985a61dc');
  assert.deepEqual(m444PrerequisiteHandoff.record.parameterMigration, {
    completeFunctions: 2,
    completeTools: 2,
    migratedParameterRows: 2,
    witnesses: [
      {
        id: 'examples/capstone-checker-subset/checker-while.kern#2:checkerSafeIntText',
        parameterRows: 1,
        profileRows: { nodes: 14, properties: 20, values: 161 },
        tool: 'checker',
      },
      {
        id: 'examples/kern-canonicalizer/canonicalizer.kern#1:validbinaryop',
        parameterRows: 1,
        profileRows: { nodes: 12, properties: 15, values: 388 },
        tool: 'canonicalizer',
      },
    ],
  });
  assert.equal(m448PrerequisiteHandoff.digest, 'fbc4b671f665d1ed2ebb709201a4c3f4be27d9cec4f18708ce7130fd2b2a7b0a');
  assert.equal(m448PrerequisiteHandoff.sourceCommit, 'c16ab453b49d850d58022160a577c23eb70a2142');
  assert.equal(m448PrerequisiteHandoff.record.baseline.baseCompleteFunctions, 60);
  assert.equal(m448PrerequisiteHandoff.record.baseline.legacyParameterBlockers, 43);
  assert.equal(m448PrerequisiteHandoff.record.parameterMigration.completeFunctions, 4);
  assert.equal(m448PrerequisiteHandoff.record.parameterMigration.migratedParameterRows, 12);
  assert.deepEqual(prerequisite.exhaustion, {
    activeFamilies: ['exception-flow', 'while-iteration'],
    completingClosureCount: 0,
    evaluatedNonEmptyClosureCount: 3,
    reasonAssignmentsDigest: 'd3175ab22aaf82a3e37a5c439b4e603d3922e53224b649176c9940d9e04431dc',
    reasonCounts: [
      { count: 1, id: 'if.properties.cond.expression.text.character-u007f' },
      { count: 1, id: 'if.properties.cond.expression.text.character-u0080' },
      { count: 1, id: 'if.properties.cond.expression.text.character-u009f' },
      { count: 1, id: 'if.properties.cond.expression.text.character-u2028' },
      { count: 1, id: 'if.properties.cond.expression.text.character-u2029' },
      { count: 1, id: 'if.properties.cond.expression.text.character-ufeff' },
      { count: 2, id: 'let.value:unknown-expression-kind' },
      { count: 22, id: 'profile.rows.nodes' },
      { count: 23, id: 'profile.rows.properties' },
      { count: 8, id: 'profile.rows.values' },
      { count: 12, id: 'projection.limit-depth' },
      { count: 1, id: 'projection.limit-nodes' },
      { count: 3, id: 'projection.unknown-expression-kind' },
      { count: 1, id: 'throw.value:unknown-expression-kind' },
    ],
    residualFunctionCount: 39,
    scope: 'current-bounded-profile',
  });
  assertCoverageSummary(prerequisiteSummaryUrl, prerequisite);
  assert.equal(
    residualAnalysisHandoff.digest,
    '160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076',
  );
  assert.equal(
    residualAnalysisHandoff.sourceCommit,
    'fdf55cfb52616ef9bdf006a42f6a58a56a10b7c1',
  );
  assert.equal(residualAnalysis.format, 'kern.kir-canonicalizer.residual-analysis.1');
  assert.equal(residualAnalysis.assignments.length, 69);
  assert.equal(
    residualAnalysis.assignmentsDigest,
    '7cd89ffda2d591cf9a82fa0f836d5b7f095887a33a9b4c843a117a0ab6734c1c',
  );
  assert.equal(
    residualAnalysis.baseline.coverageImplementationDigest,
    '0c9f9c2ef46d8a9d3620e72fe12f24e5c111da531a72caa56b6988bc2ddc65b6',
  );
  assert.equal(
    residualAnalysis.baseline.coveragePolicyDigest,
    '6c19138011e493a28444fca1899c1c9418b292f30f0aff0ab7e02341d9a50f67',
  );
  assert.equal(
    residualAnalysis.baseline.functionFactsDigest,
    '74187341fcce01494d0e5cf4f5f85a4c422084197660a47ad91ba3bbf3421299',
  );
  assert.equal(residualAnalysis.frontier.evaluatedObservedSettings, 50);
  assert.equal(residualAnalysis.frontier.profileRowsAvailableFunctions, 53);
  assert.equal(residualAnalysis.frontier.actionableCandidates.length, 50);
  assert.deepEqual(residualAnalysis.selectedNextAction, {
    changedLimits: ['maxValueRows'],
    completeFunctions: 12,
    completeTools: 4,
    limits: { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 106 },
    totalDelta: 34,
    witnesses: [
      'examples/capstone-assertion-engine/compare.kern#5:compareTrees',
      'examples/capstone-checker-subset/checker-while.kern#3:previousSiblingKind',
      'examples/capstone-checker-subset/checker-while.kern#7:functionRow',
      'examples/capstone-checker-subset/checker.kern#10:isForCounter',
      'examples/capstone-checker-subset/checker.kern#11:isAssigned',
      'examples/capstone-checker-subset/checker.kern#13:paramOrdinalOf',
      'examples/capstone-checker-subset/checker.kern#15:argIndexOf',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#0:validfirst',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#6:structuralname',
      'examples/selfhost-validator/validator.kern#0:charokfirst',
      'examples/selfhost-validator/validator.kern#16:classrow',
      'examples/selfhost-validator/validator.kern#8:contained',
    ],
  });
  assert.equal(m438ResidualAnalysis.format, 'kern.kir-canonicalizer.residual-analysis.2');
  assert.equal(m438ResidualAnalysis.assignments.length, 56);
  assert.equal(
    m438ResidualAnalysis.assignmentsDigest,
    '8ae6a54e20836ad1b560c88c59fed44e6bd96ecdfbee30cf5cb5404d44f0daef',
  );
  assert.equal(m438ResidualAnalysisHandoff.digest, '8bc1be3c941c8fd2d8a4a5990de0266f54ae986fbfd1e4712e6044c78cc092cd');
  assert.equal(m438ResidualAnalysisHandoff.sourceCommit, '953811cb5fdc5d13c92ada4e7f894eb9ac5cf0dc');
  assert.equal(m438ResidualAnalysis.baseline.coverageImplementationDigest, '54d297b6a080d9862d8125b9c28a10f3309686c9e86e192205b8e4a9a68d66ce');
  assert.equal(m438ResidualAnalysis.baseline.coveragePolicyDigest, 'f441b42d80b0fbbe1d858efafddfc8b713b3633699f0d125df9541f90afdb987');
  assert.equal(m438ResidualAnalysis.baseline.functionFactsDigest, '513653af8508b60955f8f2fc9cb9289bcb26ad9f38a081380692d51cfd3a10c3');
  assert.deepEqual(m438ResidualAnalysis.baseline.currentProfileLimits, {
    maxNodeRows: 16,
    maxPropertyRows: 30,
    maxValueRows: 106,
  });
  assert.equal(m438ResidualAnalysis.frontier.evaluatedObservedSettings, 39);
  assert.equal(m438ResidualAnalysis.frontier.profileRowsAvailableFunctions, 40);
  assert.equal(m438ResidualAnalysis.frontier.actionableCandidates.length, 39);
  assert.deepEqual(m438ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxValueRows'],
    completeFunctions: 11,
    completeTools: 3,
    limits: { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 154 },
    totalDelta: 48,
    witnesses: [
      'examples/capstone-checker-subset/checker-while.kern#10:isLengthType',
      'examples/capstone-checker-subset/checker-while.kern#5:checkerElseRejectDetail',
      'examples/capstone-checker-subset/checker.kern#19:mapArgToken',
      'examples/capstone-checker-subset/checker.kern#8:isArrayBinding',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#10:propid',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#12:childat',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#14:valuechildat',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#15:recordfield',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#2:valididentifier',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#3:validexpressionidentifier',
      'examples/selfhost-validator/validator.kern#18:hasimportcyclefrom',
    ],
  });
  assert.equal(m442ResidualAnalysis.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.equal(
    m442ResidualAnalysisHandoff.digest,
    'f37fed74d24a739adf3584ceb7608f8d25c490d2325ebc1c127e05ee15238a8e',
  );
  assert.equal(m442ResidualAnalysisHandoff.sourceCommit, 'fa762508cf48beac0fce18afdda39beb08da51f1');
  assert.equal(m442ResidualAnalysis.assignments.length, 45);
  assert.equal(
    m442ResidualAnalysis.assignmentsDigest,
    'a965461fa32dc4bbb1fdfa3ca153d91d019865e6ddb10e57f64087be6d7402bf',
  );
  assert.equal(
    m442ResidualAnalysis.baseline.coverageImplementationDigest,
    '6c74f747f3df19ea9e09eb88be4e0aa10d54a7319f90af0eeffe4054ad9ebd2d',
  );
  assert.equal(
    m442ResidualAnalysis.baseline.coveragePolicyDigest,
    'c6fa85f4906716bc11f13b68192e4108a46d61329c690aaa6be53c5433f8a3e6',
  );
  assert.equal(
    m442ResidualAnalysis.baseline.functionFactsDigest,
    'ca9702a70e92e79aa384c04a09e4ea835009e19f726671dead147f160b632ea8',
  );
  assert.deepEqual(m442ResidualAnalysis.baseline.currentProfileLimits, {
    maxNodeRows: 16,
    maxPropertyRows: 30,
    maxValueRows: 154,
  });
  assert.equal(m442ResidualAnalysis.frontier.evaluatedObservedSettings, 29);
  assert.equal(m442ResidualAnalysis.frontier.profileRowsAvailableFunctions, 29);
  assert.equal(m442ResidualAnalysis.frontier.actionableCandidates.length, 29);
  assert.deepEqual(m442ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxValueRows'],
    completeFunctions: 2,
    completeTools: 2,
    limits: { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 388 },
    totalDelta: 234,
    witnesses: [
      'examples/capstone-checker-subset/checker-while.kern#2:checkerSafeIntText',
      'examples/kern-canonicalizer/canonicalizer.kern#1:validbinaryop',
    ],
  });
  assert.deepEqual(m443ResidualAnalysis.baseline, {
    baseCompleteFunctions: 57,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    coverageImplementationDigest: 'e1f76383da938ab2caad81fe9209fd58061a3f1b47f675a23aae7a607548b333',
    coveragePolicyDigest: '6c70a49fc5b8fabbefb902c3323534302448281fa998691598efd6a6d83fff6b',
    currentProfileLimits: {
      maxNodeRows: 16,
      maxPropertyRows: 30,
      maxValueRows: 154,
    },
    functionFactsDigest: '75ec5a9f2ce7c3b6a7c42b212ecbced4a4ecb9becb80766c2f04280eb05d4287',
    legacyParameterBlockers: 45,
    residualFunctionCount: 45,
  });
  assert.equal(m443ResidualAnalysisHandoff.digest, '823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8');
  assert.equal(m443ResidualAnalysisHandoff.sourceCommit, 'df27456aeda2880eb6bb76e5ed1b8fe314023a39');
  assert.equal(m443ResidualAnalysis.assignmentsDigest, 'fb73e3bfba455094fd188454de81c56e0a1ff8011bc3ec70eea2f02160537092');
  assert.equal(m443ResidualAnalysis.frontier.evaluatedObservedSettings, 29);
  assert.equal(m443ResidualAnalysis.frontier.profileRowsAvailableFunctions, 29);
  assert.equal(m443ResidualAnalysis.frontier.actionableCandidates.length, 29);
  assert.deepEqual(
    m443ResidualAnalysis.selectedNextAction,
    m442ResidualAnalysis.selectedNextAction,
    'the frozen optimized frontier must preserve the exact published action',
  );
  assertCoverageSummary(m442ResidualAnalysisUrl, m442ResidualAnalysis);
  assertCoverageSummary(m443ResidualAnalysisUrl, m443ResidualAnalysis);
  assertCoverageSummary(m446ResidualAnalysisUrl, m446ResidualAnalysis);
  assert.equal(m446ResidualAnalysisHandoff.digest, '67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402');
  assert.equal(m446ResidualAnalysisHandoff.sourceCommit, '77ba01b467b411def9343ffb3c064e1650e6fced');
  assertCoverageSummary(m447NodeRowHeadroomUrl, m447NodeRowHeadroom);
  assert.equal(m447NodeRowHeadroomHandoff.digest, '0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1');
  assert.equal(m447NodeRowHeadroomHandoff.sourceCommit, '233e71a84fe7afdd7566e19a5545a885ffc36e8f');
  assertCoverageSummary(m450ResidualAnalysisUrl, m450ResidualAnalysis);
  assert.equal(m450ResidualAnalysisHandoff.digest, '14fdff4dce865a79215eabdb02b05a29c62a66c633561e9643e2a46f38020e4f');
  assert.equal(m450ResidualAnalysisHandoff.sourceCommit, '8600d8110986b0ddf7772611fc29af3245ee7c1c');
  assert.deepEqual(m450ResidualAnalysis.baseline, {
    baseCompleteFunctions: 64,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    coverageImplementationDigest: 'dcaf4485e454b2aa366bb80d529fea9cb0bc8e79bc11a4d2cb336372c60b5d34',
    coveragePolicyDigest: '3f72981ab56a3b7c6d27b675384349cd93b1a36b5d554dfcead57648794ad00e',
    currentProfileLimits: {
      maxNodeRows: 19,
      maxPropertyRows: 30,
      maxValueRows: 388,
    },
    functionFactsDigest: '8b2c88aac92ede8551155c55b870bc2245db042e7cc246946ee60eaa1285c35e',
    legacyParameterBlockers: 39,
    residualFunctionCount: 39,
  });
  assert.equal(
    m450ResidualAnalysis.assignmentsDigest,
    'd3175ab22aaf82a3e37a5c439b4e603d3922e53224b649176c9940d9e04431dc',
  );
  assert.equal(m450ResidualAnalysis.assignments.length, 39);
  assert.equal(m450ResidualAnalysis.frontier.evaluatedObservedSettings, 23);
  assert.equal(m450ResidualAnalysis.frontier.profileRowsAvailableFunctions, 23);
  assert.equal(m450ResidualAnalysis.frontier.actionableCandidates.length, 23);
  assert.deepEqual(m450ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxPropertyRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 19, maxPropertyRows: 31, maxValueRows: 388 },
    totalDelta: 1,
    witnesses: [
      'examples/selfhost-validator/validator.kern#17:classcyclefrom',
    ],
  });
  assertCoverageSummary(m451PropertyRowHeadroomUrl, m451PropertyRowHeadroom);
  assert.deepEqual(m451PropertyRowHeadroom.limits, {
    candidateProfile: { maxNodeRows: 19, maxPropertyRows: 31, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(m451PropertyRowHeadroom.summary, {
    maxExactFloor: 11_951,
    minimumProductionHeadroom: 53_585,
    minimumPromotionHeadroom: 37_201,
    witnessCount: 1,
  });
  assert.deepEqual(m451PropertyRowHeadroom.witnesses.map(({
    exactFloor, id, parameterRows, profileRows,
  }) => ({ exactFloor, id, parameterRows, profileRows })), [{
    exactFloor: 11_951,
    id: 'examples/selfhost-validator/validator.kern#17:classcyclefrom',
    parameterRows: 6,
    profileRows: { nodes: 19, properties: 31, values: 202 },
  }]);
  assert.equal(
    prerequisiteHandoffs[0].digest,
    '3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869',
  );
  assert.deepEqual(prerequisiteHandoffs[0].record.source, {
    commit: '003f3222b23d7543b529186957a67feeb72009b0',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.5',
    coverageSummarySha256: '12b26731a6f686f55e8e80736bbb6bdd7bbcb5e7ed514be9628885ddd8ef627c',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.1',
    prerequisiteSummarySha256: '54146de715b207e507d56e303937d0531d8832a5ced3e162b0288be83865f49f',
  });
  assert.deepEqual(prerequisiteHandoffs[0].record.snapshot.selectedPrerequisite, {
    catalogFacts: 1,
    family: 'index-expression',
    occurrences: 494,
  });
  assert.equal(
    prerequisiteHandoffs[1].digest,
    'af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b',
  );
  assert.deepEqual(prerequisiteHandoffs[1].record.source, {
    commit: '8e6cc3a5b721923647a9b1564337d1fd7910edaa',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: '6e75ecfe710b9e4ba5ca8df2b5bb0080260a786f37674f5c938db8a5373db1a9',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.1',
    prerequisiteSummarySha256: '0759e372fa2c10e61bc341518be2b67121772757835107f0bbedc3399a3b3ded',
  });
  assert.deepEqual(prerequisiteHandoffs[1].record.snapshot.selectedPrerequisite, {
    catalogFacts: 4,
    family: 'counted-iteration',
    occurrences: 468,
  });
  assert.equal(
    prerequisiteHandoffs[2].digest,
    '00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab',
  );
  assert.deepEqual(prerequisiteHandoffs[2].record.source, {
    commit: 'ca99949f28aca5c39f182f67a35b1342762cc6cd',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: '9cfabe1ea53540a69d3ba4aa4444a2578f9d0c992c53f17a63826600abf2434a',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.2',
    prerequisiteSummarySha256: '44b2ce6e4542770cad06201a7d1cc9763a01b2960ce4ef654657b7d455836c8f',
  });
  assert.deepEqual(prerequisiteHandoffs[2].record.snapshot.selectedPrerequisite, {
    catalogFacts: 6,
    family: 'binding',
    occurrences: 801,
  });
  assert.equal(
    prerequisiteHandoffs[3].digest,
    'e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5',
  );
  assert.deepEqual(prerequisiteHandoffs[3].record.source, {
    commit: 'e22a02418f14b6de9619b08b63281abdbc002ef1',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: '276c3d0a0673cf22027f65b9c532a79be4e018749aa7b8d50d421defd125271c',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.2',
    prerequisiteSummarySha256: '8a1bc1d5082760c0cf81a38f71225761ac8bf22accac34ee0ddb7207abb7dffb',
  });
  assert.deepEqual(prerequisiteHandoffs[3].record.snapshot, {
    baseline: {
      baseCompleteFunctions: 32,
      baseId: 'kern.kir-canonicalizer.profile.m4.25',
      corpusMembers: 9,
      functionCount: 104,
      legacyParameterBlockers: 70,
      toolCount: 4,
    },
    minimumFamilyCount: 1,
    selectedPrerequisite: {
      catalogFacts: 1,
      family: 'unary-expression',
      occurrences: 48,
    },
    winningClosure: {
      completeFunctions: 1,
      completeTools: 1,
      families: ['unary-expression'],
      migratedParameterRows: 2,
      occurrences: 48,
      witnesses: [
        'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#9:numberat',
      ],
    },
  });
  assert.equal(
    prerequisiteHandoffs[4].digest,
    '3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72',
  );
  assert.deepEqual(prerequisiteHandoffs[4].record.source, {
    commit: 'f91c92aa63524c65c261d1f34f2187c55455ea6b',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: '8550b80e0a98da57f26a9c78ac762b0049cc02146202b278e817bf07051d774a',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.3',
    prerequisiteSummarySha256: 'd8c2fdd07c96ce6548edd1121ae0eea1596c14a52f25d4caab15cf259edf1e1c',
  });
  assert.deepEqual(prerequisiteHandoffs[4].record.snapshot, {
    baseline: {
      baseCompleteFunctions: 45,
      baseId: 'kern.kir-canonicalizer.profile.m4.29',
      corpusMembers: 9,
      functionCount: 104,
      legacyParameterBlockers: 57,
      toolCount: 4,
    },
    minimumFamilyCount: 1,
    selectedPrerequisite: {
      catalogFacts: 2,
      family: 'do-statement',
      occurrences: 176,
    },
    winningClosure: {
      completeFunctions: 1,
      completeTools: 1,
      families: ['do-statement'],
      migratedParameterRows: 2,
      occurrences: 176,
      witnesses: [
        'examples/selfhost-validator/validator.kern#14:appendid',
      ],
    },
  });
}
const leadingBlocker = actual.blockers[0];
process.stdout.write(
  `KERN canonicalizer coverage: ${actual.baseCompleteFunctions}/${actual.functionCount} base-complete; ` +
  `${leadingBlocker ? `${leadingBlocker.count} blocked by ${leadingBlocker.id}` : 'no profile blockers'}; ` +
  `${formatCoverageWinnerStatus(actual.selection.winner)}; ` +
  `${prerequisite.parameterMigration.completeFunctions} functions/${prerequisite.parameterMigration.migratedParameterRows} rows ` +
  `parameter-ready; ` +
  (prerequisite.parameterMigration.completeFunctions > 0
    ? 'next action parameter migration.'
    : prerequisite.selectedPrerequisite === null
      ? 'bounded active-family exhaustion; next action residual blocker analysis.'
    : `next prerequisite ${prerequisite.selectedPrerequisite.family} from a ` +
      `${prerequisite.minimumFamilyCount}-family closure.`) +
  ` ${formatM446ResidualAnalysisStatus(m446ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM447NodeRowHeadroomStatus(m447NodeRowHeadroom)}` +
  ` ${formatM450ResidualAnalysisStatus(m450ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM451PropertyRowHeadroomStatus(m451PropertyRowHeadroom)}` +
  ` ${formatM443ResidualAnalysisStatus(m443ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM442ResidualAnalysisStatus(m442ResidualAnalysis.selectedNextAction)}` +
  ` ${formatPublishedResidualAnalysisStatus(m438ResidualAnalysis.selectedNextAction)}` +
  ` ${formatHistoricalResidualAnalysisStatus(residualAnalysis.selectedNextAction)}\n`,
);
