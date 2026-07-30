import { isDeepStrictEqual } from 'node:util';

import { assertExactPlainData } from './coverage-prerequisite-shape.mjs';

const EXPECTED_ACTION = {
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

function fail() {
  throw new TypeError('M4.144 status requires the exact expressionsources candidate');
}

export function formatM4144ProjectionAnalysisStatus(action) {
  try {
    assertExactPlainData(action, 'M4.144 candidate');
  } catch {
    fail();
  }
  if (!isDeepStrictEqual(action, EXPECTED_ACTION)) fail();
  return `M4.144 projection analysis selects combined KIR ${action.kirLimits.maxBytes}/` +
    `${action.kirLimits.maxDepth}/${action.kirLimits.maxNodes} and profile ` +
    `${action.profileLimits.maxNodeRows}/${action.profileLimits.maxPropertyRows}/` +
    `${action.profileLimits.maxValueRows} for ${action.completeFunctions} function/` +
    `${action.migratedParameterRows} rows across ${action.completeTools} tool; ` +
    'M4.145 authenticates structural KIR and runtime-envelope headroom.';
}
