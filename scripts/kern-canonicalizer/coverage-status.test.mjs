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

test('coverage status records the published M4.38 action through M4.41 queue consumption', () => {
  assert.equal(
    formatPublishedResidualAnalysisStatus({ completeFunctions: 11, changedLimits: ['maxValueRows'] }),
    'M4.38 published analysis selected 11 functions by maxValueRows widening; M4.40 authenticated the profile promotion; M4.41 consumes the parameter queue.',
  );
});
