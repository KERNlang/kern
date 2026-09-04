import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateLanes } from '../ci/evaluate-ci-lanes.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const EVALUATOR = resolve(ROOT, 'scripts/ci/evaluate-ci-lanes.mjs');
const POLICY = resolve(ROOT, 'scripts/ci/ci-lane-policy.json');

const LANES = [
  'frontend-composition',
  'frontend-foundation',
  'frontend-language',
  'frontend-properties-core',
  'frontend-properties-extended',
  'frontend-tooling',
  'infrastructure-contracts',
  'kern-5-evidence',
  'package-tests',
  'product-smoke',
  'quality',
  'semantics',
];

const policy = {
  lanes: LANES,
  classes: {
    DOCS_ONLY: ['quality'],
    FULL: LANES,
  },
};

function resultsFor(ciClass, overrides = {}) {
  const successLanes = new Set(policy.classes[ciClass]);
  const base = Object.fromEntries(
    LANES.map((lane) => [lane, { result: successLanes.has(lane) ? 'success' : 'skipped' }]),
  );
  for (const [lane, result] of Object.entries(overrides)) base[lane] = { result };
  return base;
}

test('every lane succeeding under FULL is ok', () => {
  assert.deepEqual(evaluateLanes({ policy, ciClass: 'FULL', results: resultsFor('FULL') }), {
    ok: true,
    violations: [],
  });
});

test('a single lane failure under FULL is reported by name', () => {
  const result = evaluateLanes({ policy, ciClass: 'FULL', results: resultsFor('FULL', { semantics: 'failure' }) });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((line) => line.includes('semantics')));
});

test('DOCS_ONLY with quality success and every other lane skipped is ok', () => {
  assert.deepEqual(evaluateLanes({ policy, ciClass: 'DOCS_ONLY', results: resultsFor('DOCS_ONLY') }), {
    ok: true,
    violations: [],
  });
});

test('DOCS_ONLY with an unexpected lane run is not ok', () => {
  const result = evaluateLanes({
    policy,
    ciClass: 'DOCS_ONLY',
    results: resultsFor('DOCS_ONLY', { 'product-smoke': 'success' }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((line) => line.includes('product-smoke')));
});

test('DOCS_ONLY with quality skipped is not ok', () => {
  const result = evaluateLanes({ policy, ciClass: 'DOCS_ONLY', results: resultsFor('DOCS_ONLY', { quality: 'skipped' }) });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((line) => line.includes('quality')));
});

test('a cancelled lane is not ok', () => {
  const result = evaluateLanes({ policy, ciClass: 'FULL', results: resultsFor('FULL', { 'package-tests': 'cancelled' }) });
  assert.equal(result.ok, false);
});

test('a missing lane key is not ok', () => {
  const results = resultsFor('FULL');
  delete results['frontend-tooling'];
  const result = evaluateLanes({ policy, ciClass: 'FULL', results });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((line) => line.includes('frontend-tooling')));
});

test('an unknown lane in results is not ok', () => {
  const result = evaluateLanes({
    policy,
    ciClass: 'FULL',
    results: resultsFor('FULL', { 'not-a-real-lane': 'success' }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((line) => line.includes('not-a-real-lane')));
});

test('the CLI tolerates a toJSON(needs)-shaped payload carrying the detect-changes control key', () => {
  const realPolicy = JSON.parse(readFileSync(POLICY, 'utf8'));
  const needsShapedResults = Object.fromEntries(
    realPolicy.classes.FULL.map((lane) => [lane, { result: 'success', outputs: {} }]),
  );
  needsShapedResults['detect-changes'] = { result: 'success', outputs: { ci_class: 'FULL' } };
  const stdout = execFileSync(
    process.execPath,
    [EVALUATOR, POLICY, 'FULL', JSON.stringify(needsShapedResults)],
    { encoding: 'utf8' },
  );
  assert.equal(stdout, 'CI lanes match the FULL policy\n');
});
