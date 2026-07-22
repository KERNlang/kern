import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatCurrentResidualAnalysisStatus,
  formatCoverageWinnerStatus,
  formatHistoricalResidualAnalysisStatus,
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
});

test('coverage status records the published M4.38 action through M4.41 queue consumption', () => {
  assert.equal(
    formatPublishedResidualAnalysisStatus({ completeFunctions: 11, changedLimits: ['maxValueRows'] }),
    'M4.38 published analysis selected 11 functions by maxValueRows widening; M4.40 authenticated the profile promotion; M4.41 consumes the parameter queue.',
  );
});
