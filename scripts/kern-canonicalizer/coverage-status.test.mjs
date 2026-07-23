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

test('coverage status records the M4.71 structural headroom handoff', () => {
  assert.equal(
    formatM471DualRowHeadroomStatus({
      summary: { maxExactFloor: 36_193, witnessCount: 1 },
    }),
    'M4.71 structural headroom authenticated 1 witness at exact floor 36193; M4.72 authenticates the dual-row profile promotion.',
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
