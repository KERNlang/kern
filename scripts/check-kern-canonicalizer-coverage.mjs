import assert from 'node:assert/strict';

import {
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
} from './kern-canonicalizer/coverage.mjs';
import { measureCanonicalizerPrerequisite } from './kern-canonicalizer/coverage-prerequisite.mjs';
import { m485ParameterMigration } from './kern-canonicalizer/coverage-m4-85-value-row-promotion.mjs';
import { assertM486ParameterMigration } from './kern-canonicalizer/coverage-m4-86-parameter-migration.mjs';
import {
  assertM490DualRowPromotion,
  m490ParameterMigration,
} from './kern-canonicalizer/coverage-m4-90-dual-row-promotion.mjs';
import {
  assertM491ParameterMigrations,
} from './kern-canonicalizer/coverage-m4-91-parameter-migrations.mjs';
import {
  currentM494ParameterMigration,
} from './kern-canonicalizer/coverage-current.mjs';
import {
  assertM494ParameterMigration,
} from './kern-canonicalizer/coverage-m4-94-parameter-migration.mjs';
import { loadCanonicalizerPolicy } from './kern-canonicalizer/policy.mjs';
import { assertM482ParameterMigration } from './kern-canonicalizer/coverage-m4-82-parameter-migration.mjs';
import { loadPublishedCanonicalizerPrerequisiteM444 } from './kern-canonicalizer/coverage-prerequisite-m4-44.mjs';
import { loadPublishedCanonicalizerPrerequisiteM448 } from './kern-canonicalizer/coverage-prerequisite-m4-48.mjs';
import { loadPublishedCanonicalizerPrerequisiteM452 } from './kern-canonicalizer/coverage-prerequisite-m4-52.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM456,
} from './kern-canonicalizer/coverage-prerequisite-m4-56.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM460,
} from './kern-canonicalizer/coverage-prerequisite-m4-60.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM464,
} from './kern-canonicalizer/coverage-prerequisite-m4-64.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM468,
} from './kern-canonicalizer/coverage-prerequisite-m4-68.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM472,
} from './kern-canonicalizer/coverage-prerequisite-m4-72.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM476,
} from './kern-canonicalizer/coverage-prerequisite-m4-76.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM481,
} from './kern-canonicalizer/coverage-prerequisite-m4-81.mjs';
import { assertM457ParameterMigrations } from './kern-canonicalizer/coverage-m4-57-parameter-migrations.mjs';
import { assertM461ParameterMigration } from './kern-canonicalizer/coverage-m4-61-parameter-migration.mjs';
import { assertM465ParameterMigrations } from './kern-canonicalizer/coverage-m4-65-parameter-migrations.mjs';
import { assertM469ParameterMigration } from './kern-canonicalizer/coverage-m4-69-parameter-migration.mjs';
import { assertM473ParameterMigration } from './kern-canonicalizer/coverage-m4-73-parameter-migration.mjs';
import { assertM477ParameterMigration } from './kern-canonicalizer/coverage-m4-77-parameter-migration.mjs';
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
import {
  loadPublishedCanonicalizerResidualAnalysisM454,
} from './kern-canonicalizer/coverage-residual-analysis-m4-54.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM462,
} from './kern-canonicalizer/coverage-residual-analysis-m4-62.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM466,
} from './kern-canonicalizer/coverage-residual-analysis-m4-66.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM470,
} from './kern-canonicalizer/coverage-residual-analysis-m4-70.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM474,
} from './kern-canonicalizer/coverage-residual-analysis-m4-74.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM478,
} from './kern-canonicalizer/coverage-residual-analysis-m4-78.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM483,
} from './kern-canonicalizer/coverage-residual-analysis-m4-83.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM487,
} from './kern-canonicalizer/coverage-residual-analysis-m4-87.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM492,
} from './kern-canonicalizer/coverage-residual-analysis-m4-92.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM495,
} from './kern-canonicalizer/coverage-residual-analysis-m4-95.mjs';
import {
  loadCanonicalizerRuntimeCostM493,
} from './kern-canonicalizer/runtime-cost-m4-93.mjs';
import {
  loadPublishedCanonicalizerDualRowHeadroomM455,
} from './kern-canonicalizer/dual-row-headroom-m4-55.mjs';
import {
  loadPublishedCanonicalizerDualRowHeadroomM471,
} from './kern-canonicalizer/dual-row-headroom-m4-71.mjs';
import {
  assertCanonicalizerDualRowHeadroomM475,
} from './kern-canonicalizer/dual-row-headroom-m4-75-check.mjs';
import {
  assertCanonicalizerDualRowHeadroomM488,
} from './kern-canonicalizer/dual-row-headroom-m4-88-check.mjs';
import { loadPublishedCanonicalizerNodeRowHeadroomM447 } from './kern-canonicalizer/node-row-headroom-m4-47.mjs';
import {
  loadPublishedCanonicalizerNodeRowHeadroomM463,
} from './kern-canonicalizer/node-row-headroom-m4-63.mjs';
import {
  loadPublishedCanonicalizerNodeRowHeadroomM467,
} from './kern-canonicalizer/node-row-headroom-m4-67.mjs';
import {
  loadPublishedCanonicalizerPropertyRowHeadroomM451,
} from './kern-canonicalizer/property-row-headroom-m4-51.mjs';
import {
  assertCanonicalizerPropertyRowHeadroomM479,
} from './kern-canonicalizer/property-row-headroom-m4-79-check.mjs';
import {
  assertCanonicalizerRuntimeCostM480,
} from './kern-canonicalizer/runtime-cost-m4-80-check.mjs';
import {
  checkCanonicalizerRuntimeCostM489,
} from './kern-canonicalizer/runtime-cost-m4-89-check.mjs';
import {
  assertCanonicalizerValueRowHeadroomM484,
} from './kern-canonicalizer/value-row-headroom-m4-84-check.mjs';
import {
  writeCanonicalizerRuntimeCostM480,
} from './kern-canonicalizer/runtime-cost-m4-80.mjs';
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
  formatM453ParameterMigrationStatus,
  formatM454ResidualAnalysisStatus,
  formatM455DualRowHeadroomStatus,
  formatM457ParameterMigrationStatus,
  formatM458WhilePrerequisiteStatus,
  formatM461ParameterMigrationStatus,
  formatM462ResidualAnalysisStatus,
  formatM463NodeRowHeadroomStatus,
  formatM465ParameterMigrationStatus,
  formatM466ResidualAnalysisStatus,
  formatM467NodeRowHeadroomStatus,
  formatM470ResidualAnalysisStatus,
  formatM471DualRowHeadroomStatus,
  formatM474ResidualAnalysisStatus,
  formatM475DualRowHeadroomStatus,
  formatM478ResidualAnalysisStatus,
  formatM479PropertyRowHeadroomStatus,
  formatM480RuntimeCostStatus,
  formatM481PropertyRowPromotionStatus,
  formatM482ParameterMigrationStatus,
  formatM483ResidualAnalysisStatus,
  formatM484ValueRowHeadroomStatus,
  formatM485ValueRowPromotionStatus,
  formatM486ParameterMigrationStatus,
  formatM487ResidualAnalysisStatus,
  formatM488DualRowHeadroomStatus,
  formatM489RuntimeCostStatus,
  formatM490DualRowPromotionStatus,
  formatM491ParameterMigrationStatus,
  formatM492ResidualAnalysisStatus,
  formatM493RuntimeCostStatus,
  formatM494ParameterMigrationStatus,
  formatM495ResidualAnalysisStatus,
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
const m454ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-54.json', import.meta.url);
const m462ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-62.json', import.meta.url);
const m466ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-66.json', import.meta.url);
const m470ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-70.json', import.meta.url);
const m474ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-74.json', import.meta.url);
const m478ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-78.json', import.meta.url);
const m483ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-83.json', import.meta.url);
const m487ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-87.json', import.meta.url);
const m492ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-92.json', import.meta.url);
const m493RuntimeCostUrl = new URL('./kern-canonicalizer/runtime-cost-m4-93.json', import.meta.url);
const m495ResidualAnalysisUrl = new URL('./kern-canonicalizer/coverage-residual-analysis-m4-95.json', import.meta.url);
const m488DualRowHeadroomUrl = new URL('./kern-canonicalizer/dual-row-headroom-m4-88.json', import.meta.url);
const m489RuntimeCostUrl = new URL('./kern-canonicalizer/runtime-cost-m4-89.json', import.meta.url);
const m455DualRowHeadroomUrl = new URL('./kern-canonicalizer/dual-row-headroom-m4-55.json', import.meta.url);
const m471DualRowHeadroomUrl = new URL('./kern-canonicalizer/dual-row-headroom-m4-71.json', import.meta.url);
const m463NodeRowHeadroomUrl = new URL('./kern-canonicalizer/node-row-headroom-m4-63.json', import.meta.url);
const m467NodeRowHeadroomUrl = new URL('./kern-canonicalizer/node-row-headroom-m4-67.json', import.meta.url);
const coverage = measureCanonicalizerCoverage();
const actual = summarizeCanonicalizerCoverage(coverage);
const prerequisite = measureCanonicalizerPrerequisite();
const m444PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM444();
const m448PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM448();
const m452PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM452();
const m456PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM456();
const m460PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM460();
const m464PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM464();
const m468PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM468();
const m472PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM472();
const m476PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM476();
const m481PrerequisiteHandoff = loadPublishedCanonicalizerPrerequisiteM481();
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
const m451PropertyRowHeadroomHandoff = loadPublishedCanonicalizerPropertyRowHeadroomM451();
const m451PropertyRowHeadroom = m451PropertyRowHeadroomHandoff.record;
const m454ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM454();
const m454ResidualAnalysis = m454ResidualAnalysisHandoff.record;
const m462ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM462();
const m462ResidualAnalysis = m462ResidualAnalysisHandoff.record;
const m466ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM466();
const m466ResidualAnalysis = m466ResidualAnalysisHandoff.record;
const m470ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM470();
const m470ResidualAnalysis = m470ResidualAnalysisHandoff.record;
const m474ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM474();
const m474ResidualAnalysis = m474ResidualAnalysisHandoff.record;
const m478ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM478();
const m478ResidualAnalysis = m478ResidualAnalysisHandoff.record;
const m483ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM483();
const m483ResidualAnalysis = m483ResidualAnalysisHandoff.record;
const m487ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM487();
const m487ResidualAnalysis = m487ResidualAnalysisHandoff.record;
const m492ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM492();
const m492ResidualAnalysis = m492ResidualAnalysisHandoff.record;
const m493RuntimeCost = loadCanonicalizerRuntimeCostM493();
const m495ResidualAnalysisHandoff = loadPublishedCanonicalizerResidualAnalysisM495();
const m495ResidualAnalysis = m495ResidualAnalysisHandoff.record;
const m488DualRowHeadroom = assertCanonicalizerDualRowHeadroomM488();
const m489RuntimeCost = checkCanonicalizerRuntimeCostM489();
const m455DualRowHeadroomHandoff = loadPublishedCanonicalizerDualRowHeadroomM455();
const m455DualRowHeadroom = m455DualRowHeadroomHandoff.record;
const m471DualRowHeadroomHandoff = loadPublishedCanonicalizerDualRowHeadroomM471();
const m471DualRowHeadroom = m471DualRowHeadroomHandoff.record;
const m475DualRowHeadroom = assertCanonicalizerDualRowHeadroomM475();
const m463NodeRowHeadroomHandoff = loadPublishedCanonicalizerNodeRowHeadroomM463();
const m463NodeRowHeadroom = m463NodeRowHeadroomHandoff.record;
const m467NodeRowHeadroomHandoff = loadPublishedCanonicalizerNodeRowHeadroomM467();
const m467NodeRowHeadroom = m467NodeRowHeadroomHandoff.record;
const m479PropertyRowHeadroom = assertCanonicalizerPropertyRowHeadroomM479();
if (process.argv.includes('--write')) writeCanonicalizerRuntimeCostM480();
const m480RuntimeCost = assertCanonicalizerRuntimeCostM480();
const m484ValueRowHeadroom = assertCanonicalizerValueRowHeadroomM484();
assertM486ParameterMigration(coverage, prerequisite, loadCanonicalizerPolicy());
assertM490DualRowPromotion(loadCanonicalizerPolicy());
assertM491ParameterMigrations(coverage);
assertM494ParameterMigration(coverage, prerequisite, loadCanonicalizerPolicy());
const prerequisiteHandoffs = loadCanonicalizerPrerequisiteProvenanceChain();
assertM457ParameterMigrations(coverage);
assertM461ParameterMigration(coverage);
assertM465ParameterMigrations(coverage);
assertM469ParameterMigration(coverage);
assertM473ParameterMigration(coverage);
assertM477ParameterMigration(coverage);
assertM482ParameterMigration(coverage);
if (process.argv.includes('--write')) {
  writeCoverageSummary(summaryUrl, actual);
  writeCoverageSummary(prerequisiteSummaryUrl, prerequisite);
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
  assert.equal(actual.prerequisiteProvenances.length, 6);
  assert.deepEqual(actual.prerequisiteProvenances, prerequisiteHandoffs);
  assert.deepEqual(actual.implementationProvenance, {
    family: 'while-iteration',
    provenanceDigest: prerequisiteHandoffs[5].digest,
    provenanceKind: 'prerequisite',
  });
  assert.equal(actual.base.id, 'kern.kir-canonicalizer.profile.m4.60');
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
    {
      family: 'while-iteration',
      provenanceDigest: '5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07',
      provenanceKind: 'prerequisite',
    },
  ], 'M4.60 must preserve the ten promoted provenance citations');
  assert.equal(actual.corpusMembers, 9, 'live M4.60 handwritten corpus count must remain exact');
  assert.equal(actual.functionCount, 109, 'live M4.94 authored function count must remain exact');
  assert.equal(actual.toolCount, 4, 'live M4.60 tool count must remain exact');
  assert.equal(actual.baseCompleteFunctions, 89, 'live M4.94 base completion must remain exactly 89/109');
  assert.equal(
    actual.blockers.find(({ id }) => id === 'fn.params')?.count,
    17,
    'live M4.94 fn.params blocker count must remain exactly 17',
  );
  assert.equal(actual.selection.winner, null, 'live M4.60 measurement must have no ordinary winner');
  assert.deepEqual(
    actual.selection.ranking.map(({ completeFunctions, completeTools, id }) => ({ completeFunctions, completeTools, id })),
    [{ completeFunctions: 0, completeTools: 0, id: 'exception-flow' }],
    'live M4.60 residual zero-completion ranking must remain exact',
  );
  assertCoverageSummary(summaryUrl, actual);
  assert.equal(prerequisite.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.deepEqual(prerequisite.parameterMigration, currentM494ParameterMigration());
  assert.equal(
    m481PrerequisiteHandoff.digest,
    'd41669c95edfab7e6a088abd14841f93fd49ea9c0daa4a0369230effb8859e7d',
  );
  assert.equal(
    m481PrerequisiteHandoff.sourceCommit,
    'e8ff7714d21266c8990384c543b96580a028e1f1',
  );
  assert.deepEqual(m481PrerequisiteHandoff.record.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 22,
    witnesses: [{
      id: 'examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore',
      parameterRows: 22,
      profileRows: { nodes: 38, properties: 61, values: 460 },
      tool: 'checker',
    }],
  });
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion.activeFamilies, ['exception-flow']);
  assert.equal(prerequisite.exhaustion.completingClosureCount, 0);
  assert.equal(prerequisite.exhaustion.evaluatedNonEmptyClosureCount, 1);
  assert.equal(prerequisite.exhaustion.residualFunctionCount, 17);
  assert.equal(
    prerequisite.exhaustion.reasonAssignmentsDigest,
    'ac1ce11255b827161910b883fb8061606849524c52f9531036dea2570e82264f',
  );
  assert.equal(m468PrerequisiteHandoff.digest,
    '0038f2a831533a8c6494a56a83cc4af96a50a2416d62de772707624cf634412c');
  assert.equal(m468PrerequisiteHandoff.sourceCommit,
    'c0a84888c53325a5c7dd6e19ba4f002b6b28d1a4');
  assert.deepEqual(m468PrerequisiteHandoff.record.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 1,
    witnesses: [{
      id: 'examples/capstone-checker-subset/checker.kern#3:isSurfaceKind',
      parameterRows: 1,
      profileRows: { nodes: 30, properties: 32, values: 219 },
      tool: 'checker',
    }],
  });
  assert.equal(m472PrerequisiteHandoff.digest,
    '617e5e0dc200d8f931d94ab9d6b09e6c7080f6216d40918927d340b339c27461');
  assert.equal(m472PrerequisiteHandoff.sourceCommit,
    '8d8326ed3071db4968e65bac29c067e1426c220b');
  assert.deepEqual(m472PrerequisiteHandoff.record.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 14,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist',
      parameterRows: 14,
      profileRows: { nodes: 31, properties: 53, values: 370 },
      tool: 'canonicalizer',
    }],
  });
  assert.equal(m476PrerequisiteHandoff.digest,
    'a963c0df94b563eb7df5e50eba68faf12cd607f92229ab0c748c412eaa3e88ca');
  assert.equal(m476PrerequisiteHandoff.sourceCommit,
    'f198ec30b8b00c2cdb9aca2b9aeb7a2e38a5e1df');
  assert.deepEqual(m476PrerequisiteHandoff.record.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 6,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
      parameterRows: 6,
      profileRows: { nodes: 38, properties: 51, values: 461 },
      tool: 'canonicalizer',
    }],
  });
  assert.equal(m456PrerequisiteHandoff.digest, '13a420892453e03eed314ddad2f50ceeed4fe0f01e50cc3ee1a72a253caad26b');
  assert.equal(m456PrerequisiteHandoff.sourceCommit, '8928684827706b2abac1f4906f785a389afb91c6');
  assert.equal(m460PrerequisiteHandoff.digest, 'c24a3f59fab134a0845980550196f5d843c05d28986ea68a6e31642e3577dfdf');
  assert.equal(m460PrerequisiteHandoff.sourceCommit, '828283e9694db3017dfc0121b6db8d6420f3988a');
  assert.deepEqual(m460PrerequisiteHandoff.record.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 1,
    witnesses: [{
      id: 'examples/selfhost-validator/validator.kern#19:sortstrings',
      parameterRows: 1,
      profileRows: { nodes: 25, properties: 43, values: 266 },
      tool: 'validator',
    }],
  });
  assert.equal(m464PrerequisiteHandoff.digest,
    '9bba0c10b55e732392fa68dd7f7174135a4ff380875e15ea787e045b46d5610f');
  assert.equal(m464PrerequisiteHandoff.sourceCommit,
    '9f60e3c3a43dd029626466223effbc08b51696b2');
  assert.deepEqual(m464PrerequisiteHandoff.record.parameterMigration, {
    completeFunctions: 4,
    completeTools: 2,
    migratedParameterRows: 37,
    witnesses: [
      {
        id: 'examples/capstone-checker-subset/checker-while.kern#1:isSafeMagnitude',
        parameterRows: 2,
        profileRows: { nodes: 27, properties: 39, values: 288 },
        tool: 'checker',
      },
      {
        id: 'examples/capstone-checker-subset/checker.kern#22:mapCallRejectDetail',
        parameterRows: 13,
        profileRows: { nodes: 28, properties: 42, values: 309 },
        tool: 'checker',
      },
      {
        id: 'examples/selfhost-validator/validator.kern#10:fnokat',
        parameterRows: 8,
        profileRows: { nodes: 28, properties: 38, values: 270 },
        tool: 'validator',
      },
      {
        id: 'examples/selfhost-validator/validator.kern#12:ownexportkind',
        parameterRows: 14,
        profileRows: { nodes: 28, properties: 48, values: 260 },
        tool: 'validator',
      },
    ],
  });
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
  assert.equal(m452PrerequisiteHandoff.digest, '220becc58afa59bb35f1fef2246038d7c7763b49db65d615f6c5725c87659c76');
  assert.equal(m452PrerequisiteHandoff.sourceCommit, '99905b044c3d981998a3beef846da283dac4a94c');
  assert.equal(m452PrerequisiteHandoff.record.baseline.baseCompleteFunctions, 64);
  assert.equal(m452PrerequisiteHandoff.record.baseline.legacyParameterBlockers, 39);
  assert.equal(m452PrerequisiteHandoff.record.parameterMigration.completeFunctions, 1);
  assert.equal(m452PrerequisiteHandoff.record.parameterMigration.migratedParameterRows, 6);
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
  assert.equal(m451PropertyRowHeadroomHandoff.digest, 'c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe');
  assert.equal(m451PropertyRowHeadroomHandoff.sourceCommit, '2e363bab008fd2f03ef21fdc1bcb0a2488bd0637');
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
  assertCoverageSummary(m454ResidualAnalysisUrl, m454ResidualAnalysis);
  assert.equal(
    m454ResidualAnalysisHandoff.digest,
    '9c8507a4fe5bacf1048bfc1f6946c3e493ee35cd7fb63ce3a2a7ced474ad1423',
  );
  assert.equal(
    m454ResidualAnalysisHandoff.inputCommit,
    '87431a527dfb8d0f3a707b74ce33907392670a51',
  );
  assert.equal(m454ResidualAnalysis.assignments.length, 38);
  assert.equal(
    m454ResidualAnalysis.assignmentsDigest,
    '158ee2e9ee592986fa70f10e7345a243db0b082f7949497275e2dce2141ae6c8',
  );
  assert.equal(m454ResidualAnalysis.frontier.evaluatedObservedSettings, 22);
  assert.equal(m454ResidualAnalysis.frontier.profileRowsAvailableFunctions, 22);
  assert.equal(m454ResidualAnalysis.frontier.actionableCandidates.length, 22);
  assert.deepEqual(m454ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxPropertyRows'],
    completeFunctions: 7,
    completeTools: 4,
    limits: { maxNodeRows: 25, maxPropertyRows: 50, maxValueRows: 388 },
    totalDelta: 25,
    witnesses: [
      'examples/capstone-assertion-engine/compare.kern#4:compareNode',
      'examples/capstone-checker-subset/checker-while.kern#14:literalTrue',
      'examples/capstone-checker-subset/checker-while.kern#17:checkerWhileRejectDetail',
      'examples/capstone-checker-subset/checker.kern#14:termProvenanced',
      'examples/capstone-checker-subset/checker.kern#6:whileRejectDetail',
      'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#3:emitstatementlist',
      'examples/selfhost-validator/validator.kern#11:owncallable',
    ],
  });
  assertCoverageSummary(m455DualRowHeadroomUrl, m455DualRowHeadroom);
  assert.equal(
    m455DualRowHeadroomHandoff.digest,
    '10e36abdda5e7de48c65689f9d2a318a6095497bdd3cff81aa64e3ab4e6e535b',
  );
  assert.equal(
    m455DualRowHeadroomHandoff.sourceCommit,
    '56a45251663840d2d8ab60a8c8ee84ae5b29975b',
  );
  assert.deepEqual(m455DualRowHeadroom.limits, {
    candidateProfile: { maxNodeRows: 25, maxPropertyRows: 50, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(m455DualRowHeadroom.summary, {
    maxExactFloor: 26_356,
    minimumProductionHeadroom: 39_180,
    minimumPromotionHeadroom: 22_796,
    witnessCount: 7,
  });
  assert.deepEqual(
    m455DualRowHeadroom.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [
      { exactFloor: 26_356, id: 'examples/capstone-assertion-engine/compare.kern#4:compareNode', parameterRows: 13, profileRows: { nodes: 24, properties: 39, values: 373 } },
      { exactFloor: 15_094, id: 'examples/capstone-checker-subset/checker-while.kern#14:literalTrue', parameterRows: 7, profileRows: { nodes: 23, properties: 33, values: 244 } },
      { exactFloor: 19_763, id: 'examples/capstone-checker-subset/checker-while.kern#17:checkerWhileRejectDetail', parameterRows: 22, profileRows: { nodes: 25, properties: 49, values: 189 } },
      { exactFloor: 17_423, id: 'examples/capstone-checker-subset/checker.kern#14:termProvenanced', parameterRows: 11, profileRows: { nodes: 24, properties: 36, values: 237 } },
      { exactFloor: 19_622, id: 'examples/capstone-checker-subset/checker.kern#6:whileRejectDetail', parameterRows: 22, profileRows: { nodes: 25, properties: 48, values: 188 } },
      { exactFloor: 21_985, id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#3:emitstatementlist', parameterRows: 15, profileRows: { nodes: 25, properties: 50, values: 235 } },
      { exactFloor: 17_931, id: 'examples/selfhost-validator/validator.kern#11:owncallable', parameterRows: 12, profileRows: { nodes: 24, properties: 42, values: 212 } },
    ],
  );
  assert.equal(
    m455DualRowHeadroom.witnesses.reduce((total, { parameterRows }) => total + parameterRows, 0),
    102,
  );
  assertCoverageSummary(m462ResidualAnalysisUrl, m462ResidualAnalysis);
  assert.equal(
    m462ResidualAnalysisHandoff.digest,
    '5339ffa5c128efbe857b53e64a67092d72b8b6b6cbe6cc3ea16c96f4939e79cc',
  );
  assert.equal(
    m462ResidualAnalysisHandoff.inputCommit,
    'f36a870843ccdd222e8cf2e7595c0e205ed545bf',
  );
  assert.equal(m462ResidualAnalysis.assignments.length, 30);
  assert.equal(
    m462ResidualAnalysis.assignmentsDigest,
    '6a2d680c3dfe3fdbddf24f5b6cd383e03d5c2b7ed1fdf5667ec6ea94551c40e5',
  );
  assert.equal(m462ResidualAnalysis.frontier.evaluatedObservedSettings, 12);
  assert.equal(m462ResidualAnalysis.frontier.profileRowsAvailableFunctions, 14);
  assert.equal(m462ResidualAnalysis.frontier.actionableCandidates.length, 12);
  assert.deepEqual(m462ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxNodeRows'],
    completeFunctions: 4,
    completeTools: 2,
    limits: { maxNodeRows: 28, maxPropertyRows: 50, maxValueRows: 388 },
    totalDelta: 3,
    witnesses: [
      'examples/capstone-checker-subset/checker-while.kern#1:isSafeMagnitude',
      'examples/capstone-checker-subset/checker.kern#22:mapCallRejectDetail',
      'examples/selfhost-validator/validator.kern#10:fnokat',
      'examples/selfhost-validator/validator.kern#12:ownexportkind',
    ],
  });
  assertCoverageSummary(m466ResidualAnalysisUrl, m466ResidualAnalysis);
  assert.equal(
    m466ResidualAnalysisHandoff.digest,
    '7c3748692b35c5c30c9241b70de86af69ff5046382dba8b07963bd1c6e7c5736',
  );
  assert.equal(
    m466ResidualAnalysisHandoff.inputCommit,
    'e81c1b9543ad53625f81c9bd9a513e55bfb18083',
  );
  assert.equal(m466ResidualAnalysis.assignments.length, 26);
  assert.equal(
    m466ResidualAnalysis.assignmentsDigest,
    '68108254cf57ba70b019f6556c6808e585eeb63355078b7f9c243271fdb989c6',
  );
  assert.equal(m466ResidualAnalysis.frontier.evaluatedObservedSettings, 10);
  assert.equal(m466ResidualAnalysis.frontier.profileRowsAvailableFunctions, 10);
  assert.equal(m466ResidualAnalysis.frontier.actionableCandidates.length, 10);
  assert.deepEqual(m466ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxNodeRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 30, maxPropertyRows: 50, maxValueRows: 388 },
    totalDelta: 2,
    witnesses: [
      'examples/capstone-checker-subset/checker.kern#3:isSurfaceKind',
    ],
  });
  assertCoverageSummary(m470ResidualAnalysisUrl, m470ResidualAnalysis);
  assert.equal(
    m470ResidualAnalysisHandoff.digest,
    '2e1b2dea394f8a238b2f63b4a7045576b1843948740b3a6666b0c002971d8401',
  );
  assert.equal(
    m470ResidualAnalysisHandoff.inputCommit,
    'e5069dc45a9d849ce02dbdc047cdfb78d0c55270',
  );
  assert.equal(m470ResidualAnalysis.assignments.length, 25);
  assert.equal(
    m470ResidualAnalysis.assignmentsDigest,
    '42ea4f41e325a8743710cb29b4f3b275dc2df7e2a233662d1e952df0568f8685',
  );
  assert.equal(m470ResidualAnalysis.frontier.evaluatedObservedSettings, 9);
  assert.equal(m470ResidualAnalysis.frontier.profileRowsAvailableFunctions, 9);
  assert.equal(m470ResidualAnalysis.frontier.actionableCandidates.length, 9);
  assert.deepEqual(m470ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxPropertyRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 31, maxPropertyRows: 53, maxValueRows: 388 },
    totalDelta: 4,
    witnesses: [
      'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist',
    ],
  });
  assertCoverageSummary(m474ResidualAnalysisUrl, m474ResidualAnalysis);
  assert.equal(
    m474ResidualAnalysisHandoff.digest,
    'dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0',
  );
  assert.equal(
    m474ResidualAnalysisHandoff.inputCommit,
    '1fe7851101cf2a25e1aebfd561655bb458aec66b',
  );
  assert.equal(m474ResidualAnalysis.assignments.length, 24);
  assert.equal(
    m474ResidualAnalysis.assignmentsDigest,
    'bc209e6142330b70cac9499b3cc66a6750bdf3baabe6763a9f6b847995c21831',
  );
  assert.equal(m474ResidualAnalysis.frontier.evaluatedObservedSettings, 8);
  assert.equal(m474ResidualAnalysis.frontier.profileRowsAvailableFunctions, 8);
  assert.equal(m474ResidualAnalysis.frontier.actionableCandidates.length, 8);
  assert.deepEqual(m474ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 },
    totalDelta: 80,
    witnesses: [
      'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
    ],
  });
  assertCoverageSummary(m478ResidualAnalysisUrl, m478ResidualAnalysis);
  assert.equal(
    m478ResidualAnalysisHandoff.digest,
    'f63342ef1f4b2754add412232fd4cf24758b0a0f77b8522361ea2f66cd1fadc2',
  );
  assert.equal(
    m478ResidualAnalysisHandoff.inputCommit,
    '2ee34545f1a97acd5889f95e52bdd0952eb362bd',
  );
  assert.equal(m478ResidualAnalysis.assignments.length, 23);
  assert.equal(
    m478ResidualAnalysis.assignmentsDigest,
    '0abacdcff2a8ee7dfd977de09a3af2488350a383347b226a0afe36b8ca786ae7',
  );
  assert.equal(m478ResidualAnalysis.frontier.evaluatedObservedSettings, 7);
  assert.equal(m478ResidualAnalysis.frontier.profileRowsAvailableFunctions, 7);
  assert.equal(m478ResidualAnalysis.frontier.actionableCandidates.length, 7);
  assert.deepEqual(m478ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxPropertyRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 461 },
    totalDelta: 8,
    witnesses: [
      'examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore',
    ],
  });
  assertCoverageSummary(m483ResidualAnalysisUrl, m483ResidualAnalysis);
  assert.equal(
    m483ResidualAnalysisHandoff.digest,
    '42815f7d4bd02daa625718deb8b8ae04590efb605dccc69ffc90b3a4bdcbf546',
  );
  assert.equal(
    m483ResidualAnalysisHandoff.inputCommit,
    '89083ba126201067c918ea7e130382ca171f4097',
  );
  assert.equal(m483ResidualAnalysis.assignments.length, 22);
  assert.equal(
    m483ResidualAnalysis.assignmentsDigest,
    '37f914f5ccfce7a4cb86c1235939e760a133936c22775f3a1d25043ea7c7dcec',
  );
  assert.equal(m483ResidualAnalysis.frontier.evaluatedObservedSettings, 6);
  assert.equal(m483ResidualAnalysis.frontier.profileRowsAvailableFunctions, 6);
  assert.equal(m483ResidualAnalysis.frontier.actionableCandidates.length, 6);
  assert.deepEqual(m483ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
    totalDelta: 119,
    witnesses: [
      'examples/capstone-checker-subset/checker.kern#16:argProvenanced',
    ],
  });
  assertCoverageSummary(m487ResidualAnalysisUrl, m487ResidualAnalysis);
  assert.equal(
    m487ResidualAnalysisHandoff.digest,
    '9046716d876c336140b567a8a40a9b52750106b2ac5db66f38f7621e935c203a',
  );
  assert.equal(
    m487ResidualAnalysisHandoff.inputCommit,
    '46337a6549390087ef095c18d0e178cf9ef28392',
  );
  assert.equal(m487ResidualAnalysis.assignments.length, 21);
  assert.equal(
    m487ResidualAnalysis.assignmentsDigest,
    '0e6700b777a3cf2f5ed462636ba292ef69df90de141e3466b8831d8f190b7328',
  );
  assert.equal(m487ResidualAnalysis.frontier.evaluatedObservedSettings, 5);
  assert.equal(m487ResidualAnalysis.frontier.profileRowsAvailableFunctions, 5);
  assert.equal(m487ResidualAnalysis.frontier.actionableCandidates.length, 5);
  assert.deepEqual(m487ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxPropertyRows'],
    completeFunctions: 3,
    completeTools: 2,
    limits: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
    totalDelta: 52,
    witnesses: [
      'examples/capstone-checker-subset/checker.kern#18:indexRejectDetail',
      'examples/capstone-checker-subset/checker.kern#23:callRejectCode',
      'examples/selfhost-validator/validator.kern#2:isreserved',
    ],
  });
  assertCoverageSummary(m492ResidualAnalysisUrl, m492ResidualAnalysis);
  assert.equal(
    m492ResidualAnalysisHandoff.digest,
    'c6311d6351db075292af7a36a850787dd3bdf135ab290b60098da3ce25509e24',
  );
  assert.equal(
    m492ResidualAnalysisHandoff.inputCommit,
    '730aa181e1e3ea40b88dd22f74c58e853a706009',
  );
  assert.equal(m492ResidualAnalysis.assignments.length, 18);
  assert.equal(
    m492ResidualAnalysis.assignmentsDigest,
    'b222027da0639addba00e2c0149684e1e02a9bfd199feacae921b5fc028e07fe',
  );
  assert.equal(m492ResidualAnalysis.frontier.evaluatedObservedSettings, 2);
  assert.equal(m492ResidualAnalysis.frontier.profileRowsAvailableFunctions, 2);
  assert.equal(m492ResidualAnalysis.frontier.actionableCandidates.length, 2);
  assert.deepEqual(m492ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
    totalDelta: 270,
    witnesses: [
      'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk',
    ],
  });
  assertCoverageSummary(m493RuntimeCostUrl, m493RuntimeCost);
  assert.equal(m493RuntimeCost.result.exactFloor, 1_075);
  assert.equal(m493RuntimeCost.result.belowFloor, 1_074);
  assert.equal(m493RuntimeCost.productionObservation.terminalEnvelopeObserved, false);
  assert.equal(m493RuntimeCost.promotion.nextMilestone, 'M4.94');
  assertCoverageSummary(m495ResidualAnalysisUrl, m495ResidualAnalysis);
  assert.equal(
    m495ResidualAnalysisHandoff.digest,
    'f69bbae69a3f25d059dcdc23e023f4432dcd23c19dc9e6228087811f178a4928',
  );
  assert.equal(
    m495ResidualAnalysisHandoff.inputCommit,
    'c623388fe7f8a8c288743f85bfaf79d55f889b94',
  );
  assert.equal(m495ResidualAnalysis.assignments.length, 17);
  assert.equal(
    m495ResidualAnalysis.assignmentsDigest,
    'ac1ce11255b827161910b883fb8061606849524c52f9531036dea2570e82264f',
  );
  assert.equal(m495ResidualAnalysis.frontier.evaluatedObservedSettings, 2);
  assert.equal(m495ResidualAnalysis.frontier.profileRowsAvailableFunctions, 2);
  assert.equal(m495ResidualAnalysis.frontier.actionableCandidates.length, 2);
  assert.deepEqual(m495ResidualAnalysis.selectedNextAction, {
    changedLimits: ['maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
    totalDelta: 270,
    witnesses: [
      'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk',
    ],
  });
  assertCoverageSummary(m488DualRowHeadroomUrl, m488DualRowHeadroom);
  assertCoverageSummary(m489RuntimeCostUrl, m489RuntimeCost);
  assertCoverageSummary(m471DualRowHeadroomUrl, m471DualRowHeadroom);
  assert.equal(
    m471DualRowHeadroomHandoff.digest,
    '8be340082e3a5de479b015d4f0f4248486286290ed981cbf5715538069638c12',
  );
  assert.equal(
    m471DualRowHeadroomHandoff.sourceCommit,
    '75a927c4faf36d4c18530ff30b4f877fdc411628',
  );
  assert.deepEqual(m471DualRowHeadroom.limits, {
    candidateProfile: { maxNodeRows: 31, maxPropertyRows: 53, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(m471DualRowHeadroom.summary, {
    maxExactFloor: 36_193,
    minimumProductionHeadroom: 29_343,
    minimumPromotionHeadroom: 12_959,
    witnessCount: 1,
  });
  assert.deepEqual(
    m471DualRowHeadroom.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [{
      exactFloor: 36_193,
      id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist',
      parameterRows: 14,
      profileRows: { nodes: 31, properties: 53, values: 370 },
    }],
  );
  assertCoverageSummary(m467NodeRowHeadroomUrl, m467NodeRowHeadroom);
  assert.equal(m467NodeRowHeadroomHandoff.digest,
    '61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca');
  assert.equal(m467NodeRowHeadroomHandoff.sourceCommit,
    '40b6961bbd41f3b60e346ef3246d6587c0c3a1f4');
  assert.deepEqual(m467NodeRowHeadroom.limits, {
    candidateProfile: { maxNodeRows: 30, maxPropertyRows: 50, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(m467NodeRowHeadroom.summary, {
    maxExactFloor: 17_552,
    minimumProductionHeadroom: 47_984,
    minimumPromotionHeadroom: 31_600,
    witnessCount: 1,
  });
  assert.deepEqual(
    m467NodeRowHeadroom.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [{
      exactFloor: 17_552,
      id: 'examples/capstone-checker-subset/checker.kern#3:isSurfaceKind',
      parameterRows: 1,
      profileRows: { nodes: 30, properties: 32, values: 219 },
    }],
  );
  assertCoverageSummary(m463NodeRowHeadroomUrl, m463NodeRowHeadroom);
  assert.equal(m463NodeRowHeadroomHandoff.digest,
    '110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3');
  assert.equal(m463NodeRowHeadroomHandoff.sourceCommit,
    '6aba5e056c833e7dd2e613a21ac52e3f718d9673');
  assert.deepEqual(m463NodeRowHeadroom.limits, {
    candidateProfile: { maxNodeRows: 28, maxPropertyRows: 50, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(m463NodeRowHeadroom.summary, {
    maxExactFloor: 27_076,
    minimumProductionHeadroom: 38_460,
    minimumPromotionHeadroom: 22_076,
    witnessCount: 4,
  });
  assert.deepEqual(
    m463NodeRowHeadroom.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [
      { exactFloor: 21_736, id: 'examples/capstone-checker-subset/checker-while.kern#1:isSafeMagnitude', parameterRows: 2, profileRows: { nodes: 27, properties: 39, values: 288 } },
      { exactFloor: 27_076, id: 'examples/capstone-checker-subset/checker.kern#22:mapCallRejectDetail', parameterRows: 13, profileRows: { nodes: 28, properties: 42, values: 309 } },
      { exactFloor: 21_825, id: 'examples/selfhost-validator/validator.kern#10:fnokat', parameterRows: 8, profileRows: { nodes: 28, properties: 38, values: 270 } },
      { exactFloor: 24_993, id: 'examples/selfhost-validator/validator.kern#12:ownexportkind', parameterRows: 14, profileRows: { nodes: 28, properties: 48, values: 260 } },
    ],
  );
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
  assert.equal(
    prerequisiteHandoffs[5].digest,
    '5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07',
  );
  assert.deepEqual(prerequisiteHandoffs[5].record.source, {
    commit: '5ad4f524f9e3434fb039033803f2988316a04564',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: 'b6f8ae2a49de9b8c2a859605a6c6a5da1bfcbc90d440efa9cdf259ccb7db7015',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.3',
    prerequisiteSummarySha256: '31a90a6e1bb413939a56ab9637c12c660dbfb6247b24a347698312839c366c58',
  });
  assert.deepEqual(prerequisiteHandoffs[5].record.snapshot, {
    baseline: {
      baseCompleteFunctions: 72,
      baseId: 'kern.kir-canonicalizer.profile.m4.36',
      corpusMembers: 9,
      functionCount: 104,
      legacyParameterBlockers: 31,
      toolCount: 4,
    },
    minimumFamilyCount: 1,
    selectedPrerequisite: {
      catalogFacts: 2,
      family: 'while-iteration',
      occurrences: 2,
    },
    winningClosure: {
      completeFunctions: 1,
      completeTools: 1,
      families: ['while-iteration'],
      migratedParameterRows: 1,
      occurrences: 2,
      witnesses: [
        'examples/selfhost-validator/validator.kern#19:sortstrings',
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
      ? 'bounded active-family exhaustion.'
    : `next prerequisite ${prerequisite.selectedPrerequisite.family} from a ` +
      `${prerequisite.minimumFamilyCount}-family closure.`) +
  ` ${formatM446ResidualAnalysisStatus(m446ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM447NodeRowHeadroomStatus(m447NodeRowHeadroom)}` +
  ` ${formatM450ResidualAnalysisStatus(m450ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM451PropertyRowHeadroomStatus(m451PropertyRowHeadroom)}` +
  ` ${formatM453ParameterMigrationStatus(m452PrerequisiteHandoff.record)}` +
  ` ${formatM454ResidualAnalysisStatus(m454ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM455DualRowHeadroomStatus(m455DualRowHeadroom)}` +
  ` ${formatM457ParameterMigrationStatus(m456PrerequisiteHandoff.record)}` +
  ` ${formatM458WhilePrerequisiteStatus(prerequisiteHandoffs[5])}` +
  ` ${formatM461ParameterMigrationStatus(m460PrerequisiteHandoff)}` +
  ` ${formatM462ResidualAnalysisStatus(m462ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM463NodeRowHeadroomStatus(m463NodeRowHeadroom)}` +
  ` ${formatM465ParameterMigrationStatus(m464PrerequisiteHandoff)}` +
  ` ${formatM466ResidualAnalysisStatus(m466ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM467NodeRowHeadroomStatus(m467NodeRowHeadroom)}` +
  ` ${formatM470ResidualAnalysisStatus(m470ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM471DualRowHeadroomStatus(m471DualRowHeadroom)}` +
  ` ${formatM474ResidualAnalysisStatus(m474ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM475DualRowHeadroomStatus(m475DualRowHeadroom)}` +
  ` ${formatM478ResidualAnalysisStatus(m478ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM479PropertyRowHeadroomStatus(m479PropertyRowHeadroom)}` +
  ` ${formatM480RuntimeCostStatus(m480RuntimeCost)}` +
  ` ${formatM481PropertyRowPromotionStatus(m481PrerequisiteHandoff.record)}` +
  ` ${formatM482ParameterMigrationStatus(m481PrerequisiteHandoff)}` +
  ` ${formatM483ResidualAnalysisStatus(m483ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM484ValueRowHeadroomStatus(m484ValueRowHeadroom)}` +
  ` ${formatM485ValueRowPromotionStatus({ parameterMigration: m485ParameterMigration() })}` +
  ` ${formatM486ParameterMigrationStatus({ parameterMigration: m485ParameterMigration() })}` +
  ` ${formatM487ResidualAnalysisStatus(m487ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM488DualRowHeadroomStatus(m488DualRowHeadroom)}` +
  ` ${formatM489RuntimeCostStatus(m489RuntimeCost)}` +
  ` ${formatM490DualRowPromotionStatus({ parameterMigration: m490ParameterMigration() })}` +
  ` ${formatM491ParameterMigrationStatus({ parameterMigration: m490ParameterMigration() })}` +
  ` ${formatM492ResidualAnalysisStatus(m492ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM493RuntimeCostStatus(m493RuntimeCost)}` +
  ` ${formatM494ParameterMigrationStatus(m493RuntimeCost)}` +
  ` ${formatM495ResidualAnalysisStatus(m495ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM443ResidualAnalysisStatus(m443ResidualAnalysis.selectedNextAction)}` +
  ` ${formatM442ResidualAnalysisStatus(m442ResidualAnalysis.selectedNextAction)}` +
  ` ${formatPublishedResidualAnalysisStatus(m438ResidualAnalysis.selectedNextAction)}` +
  ` ${formatHistoricalResidualAnalysisStatus(residualAnalysis.selectedNextAction)}\n`,
);
