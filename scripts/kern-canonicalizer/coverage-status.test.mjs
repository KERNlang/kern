import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatCurrentResidualAnalysisStatus,
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
  formatPublishedResidualAnalysisStatus,
} from './coverage-status.mjs';

test('coverage status formats current and historical release decisions', () => {
  assert.equal(formatCoverageWinnerStatus(null), 'no tranche selected');
  assert.equal(formatCoverageWinnerStatus({ id: 'binary-expression' }), 'binary-expression tranche selected');
  assert.equal(
    formatHistoricalResidualAnalysisStatus(null),
    'M4.31 historical analysis found no actionable profile widening.',
  );
  assert.equal(
    formatHistoricalResidualAnalysisStatus({
      changedLimits: ['maxValueRows'],
      completeFunctions: 12,
    }),
    'M4.31 historical analysis selected 12 functions by maxValueRows widening.',
  );
  assert.equal(
    formatCurrentResidualAnalysisStatus(null),
    'Current residual analysis found no actionable profile widening.',
  );
  assert.equal(
    formatCurrentResidualAnalysisStatus({
      changedLimits: ['maxValueRows'],
      completeFunctions: 11,
    }),
    'Current residual analysis selected 11 functions by maxValueRows widening.',
  );
  assert.equal(
    formatM442ResidualAnalysisStatus(null),
    'M4.42 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM442ResidualAnalysisStatus({
      changedLimits: ['maxValueRows'],
      completeFunctions: 2,
    }),
    'M4.42 published analysis selected 2 functions by maxValueRows widening.',
  );
});

test('coverage status records the M4.46 published recommendation and M4.47 headroom', () => {
  assert.equal(
    formatM446ResidualAnalysisStatus(null),
    'M4.46 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM446ResidualAnalysisStatus({
      completeFunctions: 4,
      changedLimits: ['maxNodeRows'],
    }),
    'M4.46 published analysis selected 4 functions by maxNodeRows widening; M4.47 authenticates structural runtime headroom.',
  );
  assert.equal(
    formatM447NodeRowHeadroomStatus({ summary: { maxExactFloor: 15_236, witnessCount: 4 } }),
    'M4.47 structural headroom authenticated 4 witnesses at a 15236 maximum floor; M4.48 authenticates the node-row profile promotion.',
  );
});

test('coverage status records the M4.43 optimized promotion handoff', () => {
  assert.equal(
    formatM443ResidualAnalysisStatus({
      completeFunctions: 2,
      changedLimits: ['maxValueRows'],
    }),
    'M4.43 published analysis selected 2 functions by maxValueRows widening; M4.44 authenticates the profile promotion.',
  );
});

test('coverage status records the M4.50 recommendation and M4.51 headroom', () => {
  assert.equal(
    formatM450ResidualAnalysisStatus(null),
    'M4.50 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM450ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxPropertyRows'],
    }),
    'M4.50 published analysis selected 1 function by maxPropertyRows widening; M4.51 authenticates structural runtime headroom.',
  );
  assert.equal(
    formatM451PropertyRowHeadroomStatus({ summary: { maxExactFloor: 11_951, witnessCount: 1 } }),
    'M4.51 structural headroom authenticated 1 witness at an 11951 exact floor; M4.52 authenticates the property-row profile promotion.',
  );
});

test('coverage status records M4.53 consumption of the M4.52 parameter queue', () => {
  assert.equal(
    formatM453ParameterMigrationStatus({
      parameterMigration: { completeFunctions: 1, migratedParameterRows: 6 },
    }),
    'M4.53 consumes the exact M4.52 1-function/6-row parameter queue.',
  );
});

test('coverage status records M4.57 consumption of the M4.56 parameter queue', () => {
  assert.equal(
    formatM457ParameterMigrationStatus({
      parameterMigration: { completeFunctions: 7, migratedParameterRows: 102 },
    }),
    'M4.57 consumes the exact M4.56 7-functions/102-row parameter queue.',
  );
});

test('coverage status records the M4.58 while-iteration handoff boundary', () => {
  assert.equal(
    formatM458WhilePrerequisiteStatus({
      record: {
        snapshot: {
          selectedPrerequisite: {
            catalogFacts: 2,
            family: 'while-iteration',
            occurrences: 2,
          },
        },
      },
    }),
    'M4.58 freezes the exact M4.57 while-iteration prerequisite (2 catalog facts/2 occurrences); M4.59 owns canonicalizer implementation; M4.60 promotes it into the cumulative base.',
  );
});

test('coverage status records M4.61 consumption of the immutable M4.60 queue', () => {
  assert.equal(
    formatM461ParameterMigrationStatus({
      record: {
        parameterMigration: { completeFunctions: 1, migratedParameterRows: 1 },
      },
    }),
    'M4.61 consumes the exact M4.60 1-function/1-row parameter queue.',
  );
});

test('coverage status records the M4.62 residual recommendation', () => {
  assert.equal(
    formatM462ResidualAnalysisStatus(null),
    'M4.62 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM462ResidualAnalysisStatus({
      completeFunctions: 4,
      changedLimits: ['maxNodeRows'],
    }),
    'M4.62 published analysis selected 4 functions by maxNodeRows widening; M4.63 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.63 structural headroom handoff', () => {
  assert.equal(
    formatM463NodeRowHeadroomStatus({
      summary: { maxExactFloor: 27_076, witnessCount: 4 },
    }),
    'M4.63 structural headroom authenticated 4 witnesses at a 27076 maximum floor; M4.64 authenticates the node-row profile promotion.',
  );
});

test('coverage status records M4.65 consumption of the immutable M4.64 queue', () => {
  assert.equal(
    formatM465ParameterMigrationStatus({
      record: {
        parameterMigration: { completeFunctions: 4, migratedParameterRows: 37 },
      },
    }),
    'M4.65 consumes the exact M4.64 4-functions/37-row parameter queue.',
  );
});

test('coverage status records the M4.66 residual recommendation', () => {
  assert.equal(
    formatM466ResidualAnalysisStatus(null),
    'M4.66 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM466ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxNodeRows'],
    }),
    'M4.66 published analysis selected 1 function by maxNodeRows widening; M4.67 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.67 structural headroom handoff', () => {
  assert.equal(
    formatM467NodeRowHeadroomStatus({
      summary: { maxExactFloor: 17_552, witnessCount: 1 },
    }),
    'M4.67 structural headroom authenticated 1 witness at exact floor 17552; M4.68 authenticates the node-row profile promotion.',
  );
});

test('coverage status records the M4.70 residual recommendation', () => {
  assert.equal(
    formatM470ResidualAnalysisStatus(null),
    'M4.70 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM470ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxNodeRows', 'maxPropertyRows'],
    }),
    'M4.70 published analysis selected 1 function by maxNodeRows+maxPropertyRows widening; M4.71 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.74 residual recommendation', () => {
  assert.equal(
    formatM474ResidualAnalysisStatus(null),
    'M4.74 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM474ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxNodeRows', 'maxValueRows'],
    }),
    'M4.74 published analysis selected 1 function by maxNodeRows+maxValueRows widening; M4.75 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.78 residual recommendation', () => {
  assert.equal(
    formatM478ResidualAnalysisStatus(null),
    'M4.78 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM478ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxPropertyRows'],
    }),
    'M4.78 published analysis selected 1 function by maxPropertyRows widening; M4.79 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.83 residual recommendation', () => {
  assert.equal(
    formatM483ResidualAnalysisStatus(null),
    'M4.83 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM483ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxValueRows'],
    }),
    'M4.83 published analysis selected 1 function by maxValueRows widening; M4.84 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.87 residual recommendation', () => {
  assert.equal(
    formatM487ResidualAnalysisStatus(null),
    'M4.87 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM487ResidualAnalysisStatus({
      completeFunctions: 3,
      changedLimits: ['maxNodeRows', 'maxPropertyRows'],
    }),
    'M4.87 published analysis selected 3 functions by maxNodeRows+maxPropertyRows widening; M4.88 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.71 structural headroom handoff', () => {
  assert.equal(
    formatM471DualRowHeadroomStatus({
      summary: { maxExactFloor: 36_193, witnessCount: 1 },
    }),
    'M4.71 structural headroom authenticated 1 witness at exact floor 36193; M4.72 authenticates the dual-row profile promotion.',
  );
});

test('coverage status records the M4.75 structural headroom handoff', () => {
  assert.equal(
    formatM475DualRowHeadroomStatus({
      summary: { maxExactFloor: 46_255, witnessCount: 1 },
    }),
    'M4.75 structural headroom authenticated 1 witness at exact floor 46255; M4.76 authenticates the node+value profile promotion.',
  );
});

test('coverage status records the M4.79 property-row promotion NO-GO', () => {
  assert.equal(
    formatM479PropertyRowHeadroomStatus({
      summary: { maxExactFloor: 56_238, promotionBudgetDeficit: 7_086 },
    }),
    'M4.79 structural runtime floor 56238 rejects property-row promotion by 7086 steps; M4.80 reduces canonicalizer runtime cost.',
  );
});

test('coverage status records the M4.80 runtime-cost reduction', () => {
  assert.equal(
    formatM480RuntimeCostStatus({
      baseline: { exactFloor: 56_238 },
      result: { exactFloor: 35_998, floorReduction: 20_240, promotionHeadroom: 13_154 },
    }),
    'M4.80 reduces the exact structural runtime floor from 56238 to 35998 by 20240 steps with 13154 promotion headroom; M4.81 authenticates the property-row profile promotion.',
  );
});

test('coverage status records the M4.81 property-row promotion', () => {
  assert.equal(
    formatM481PropertyRowPromotionStatus({
      parameterMigration: { completeFunctions: 1, migratedParameterRows: 22 },
    }),
    'M4.81 promotes maxPropertyRows to 61 and publishes the exact 1-function/22-row parameter queue; M4.82 consumes it.',
  );
});

test('coverage status records M4.82 consumption of the immutable M4.81 queue', () => {
  assert.equal(
    formatM482ParameterMigrationStatus({
      record: { parameterMigration: { completeFunctions: 1, migratedParameterRows: 22 } },
    }),
    'M4.82 consumes the exact M4.81 1-function/22-row parameter queue and advances the cumulative base to 82/105.',
  );
});

test('coverage status records the M4.84 value-row structural headroom', () => {
  assert.equal(
    formatM484ValueRowHeadroomStatus({
      summary: { maxExactFloor: 38_773, minimumPromotionHeadroom: 10_379, witnessCount: 1 },
    }),
    'M4.84 structural headroom authenticates 1 witness at exact floor 38773 with 10379 promotion headroom; M4.85 authenticates the value-row profile promotion.',
  );
});

test('coverage status records the M4.85 value-row promotion', () => {
  assert.equal(
    formatM485ValueRowPromotionStatus({
      parameterMigration: { completeFunctions: 1, migratedParameterRows: 19 },
    }),
    'M4.85 promotes maxValueRows to 580 and publishes the exact 1-function/19-row parameter queue; M4.86 consumes it.',
  );
});

test('coverage status records M4.86 consumption of the immutable M4.85 queue', () => {
  assert.equal(
    formatM486ParameterMigrationStatus({
      parameterMigration: { completeFunctions: 1, migratedParameterRows: 19 },
    }),
    'M4.86 consumes the exact M4.85 1-function/19-row parameter queue and advances the cumulative base to 84/105.',
  );
});

test('coverage status records the M4.54 recommendation', () => {
  assert.equal(
    formatM454ResidualAnalysisStatus(null),
    'M4.54 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM454ResidualAnalysisStatus({
      completeFunctions: 7,
      changedLimits: ['maxNodeRows', 'maxPropertyRows'],
    }),
    'M4.54 published analysis selected 7 functions by maxNodeRows+maxPropertyRows widening; M4.55 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.55 structural headroom handoff', () => {
  assert.equal(
    formatM455DualRowHeadroomStatus({
      summary: { maxExactFloor: 26_356, witnessCount: 7 },
    }),
    'M4.55 structural headroom authenticated 7 witnesses at a 26356 maximum floor; M4.56 authenticates the dual-row profile promotion.',
  );
});

test('coverage status records the published M4.38 action through M4.41 queue consumption', () => {
  assert.equal(
    formatPublishedResidualAnalysisStatus({ completeFunctions: 11, changedLimits: ['maxValueRows'] }),
    'M4.38 published analysis selected 11 functions by maxValueRows widening; M4.40 authenticated the profile promotion; M4.41 consumes the parameter queue.',
  );
});
