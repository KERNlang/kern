import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  validateCanonicalizerPrerequisiteSummaryStructure,
} from './coverage-prerequisite-structure.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const POLICY_URL = new URL('./coverage-policy-m4-142.json', import.meta.url);
const COVERAGE_URL = new URL('./coverage-summary-m4-142.json', import.meta.url);
const PREREQUISITE_URL = new URL(
  './coverage-prerequisite-summary-m4-142.json',
  import.meta.url,
);
const COVERAGE_DIGEST =
  'c7d7d31a693df43302368fd1dc19e8f0488bdceea74d76da3037e3e54aa735cc';
const PREREQUISITE_DIGEST =
  '98aaa464c5b4da345664949dd865a006b8ac8580775695b74705ae31b25c3ef3';
const POLICY_DIGEST =
  '3512347baf3870f21b879b632041eea72ffea304e037f0a26fcf720cbe596877';
export const M4142_COVERAGE_IMPLEMENTATION_DIGEST =
  '7f7d25c5dc4ff389789ab72af5a7831ff180bacb354d1f648db19d189a295e24';

function loadExactSummary(url, expectedDigest, label) {
  const path = fileURLToPath(url);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || realpathSync(path) !== path) {
    throw new TypeError(`M4.142 ${label} must be a regular non-symlink file`);
  }
  const source = readFileSync(path);
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    expectedDigest,
    `M4.142 ${label} must retain its independently pinned bytes`,
  );
  let summary;
  try {
    summary = JSON.parse(source.toString('utf8'));
  } catch (cause) {
    throw new TypeError(`M4.142 ${label} must contain JSON`, { cause });
  }
  assertCoverageSummary(url, summary);
  return summary;
}

function loadExactPolicy() {
  const path = fileURLToPath(POLICY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || realpathSync(path) !== path) {
    throw new TypeError('M4.142 coverage policy must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    POLICY_DIGEST,
    'M4.142 coverage policy must retain its independently pinned bytes',
  );
  try {
    return JSON.parse(source.toString('utf8'));
  } catch (cause) {
    throw new TypeError('M4.142 coverage policy must contain JSON', { cause });
  }
}

export function loadPublishedM4142CoverageInput() {
  const policy = loadExactPolicy();
  const coverage = loadExactSummary(COVERAGE_URL, COVERAGE_DIGEST, 'coverage summary');
  const prerequisite = loadExactSummary(
    PREREQUISITE_URL,
    PREREQUISITE_DIGEST,
    'prerequisite summary',
  );
  validateCanonicalizerPrerequisiteSummaryStructure(prerequisite, policy);
  assert.equal(coverage.format, 'kern.kir-canonicalizer.coverage-summary.6');
  assert.equal(prerequisite.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.equal(coverage.coverageImplementationDigest, M4142_COVERAGE_IMPLEMENTATION_DIGEST);
  assert.equal(coverage.coveragePolicyDigest, POLICY_DIGEST);
  assert.deepEqual(policy.base, coverage.base);
  assert.equal(
    prerequisite.baseline.coverageImplementationDigest,
    M4142_COVERAGE_IMPLEMENTATION_DIGEST,
  );
  assert.equal(prerequisite.baseline.baseId, coverage.base.id);
  assert.equal(prerequisite.baseline.baseCompleteFunctions, coverage.baseCompleteFunctions);
  assert.equal(prerequisite.baseline.functionCount, coverage.functionCount);
  assert.equal(prerequisite.baseline.functionFactsDigest, coverage.functionFactsDigest);
  assert.equal(prerequisite.baseline.coveragePolicyDigest, coverage.coveragePolicyDigest);
  return {
    coverage: structuredClone(coverage),
    coverageDigest: COVERAGE_DIGEST,
    policy: structuredClone(policy),
    policyDigest: POLICY_DIGEST,
    prerequisite: structuredClone(prerequisite),
    prerequisiteDigest: PREREQUISITE_DIGEST,
  };
}
