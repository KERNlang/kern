import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4144ProjectionAnalysisStatus } from './coverage-status-m4-144.mjs';

const ACTION = {
  changedKirLimits: ['maxBytes', 'maxDepth', 'maxNodes'],
  changedProfileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  kirLimits: { maxBytes: 367_368, maxDepth: 122, maxNodes: 7_136 },
  migratedParameterRows: 6,
  profileLimits: { maxNodeRows: 205, maxPropertyRows: 332, maxValueRows: 6_304 },
  totalDelta: 98_002,
  witnesses: ['examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources'],
};

test('M4.144 status reports the exact candidate and M4.145 handoff', () => {
  assert.equal(
    formatM4144ProjectionAnalysisStatus(ACTION),
    'M4.144 projection analysis selects combined KIR 367368/122/7136 and profile ' +
      '205/332/6304 for 1 function/6 rows across 1 tool; M4.145 authenticates ' +
      'structural KIR and runtime-envelope headroom.',
  );
});

test('M4.144 status rejects every candidate drift and decorated data', () => {
  for (const mutate of [
    (copy) => { copy.changedKirLimits.pop(); },
    (copy) => { copy.changedProfileLimits.pop(); },
    (copy) => { copy.completeFunctions = 2; },
    (copy) => { copy.completeTools = 2; },
    (copy) => { copy.kirLimits.maxBytes -= 1; },
    (copy) => { copy.migratedParameterRows -= 1; },
    (copy) => { copy.profileLimits.maxValueRows -= 1; },
    (copy) => { copy.totalDelta -= 1; },
    (copy) => { copy.witnesses = []; },
    (copy) => { copy.future = true; },
  ]) {
    const copy = structuredClone(ACTION);
    mutate(copy);
    assert.throws(
      () => formatM4144ProjectionAnalysisStatus(copy),
      /M4\.144 status requires the exact expressionsources candidate/u,
    );
  }
  assert.throws(
    () => formatM4144ProjectionAnalysisStatus(
      Object.assign(Object.create({ inherited: true }), ACTION),
    ),
    /M4\.144 status requires the exact expressionsources candidate/u,
  );
});
