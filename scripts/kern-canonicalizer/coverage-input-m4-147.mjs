import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  validateCanonicalizerPrerequisiteSummaryStructure,
} from './coverage-prerequisite-structure.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const POLICY_URL = new URL('./coverage-policy-m4-147.json', import.meta.url);
const COVERAGE_URL = new URL('./coverage-summary-m4-147.json', import.meta.url);
const PREREQUISITE_URL = new URL(
  './coverage-prerequisite-summary-m4-147.json',
  import.meta.url,
);
const POLICY_DIGEST =
  '28b76e1260febf3e518a2a6d97b11f96bf202fcce149fb201b92b5b0a5d98019';
const COVERAGE_DIGEST =
  'fc030f9b1140e15cca55fdcea93bcf7da15fd75825ae1cb6577b5620e0b95bf0';
const PREREQUISITE_DIGEST =
  '0ef253dba0b3ab80593d9fd3985e210736c3c9bc69763b21480330f1c0ba21f7';
export const M4147_COVERAGE_IMPLEMENTATION_DIGEST =
  '10b3ae6b227aa3c42094a175b63989d9b3089277d3a4730972581f1ec7a9b22c';

function loadExactJson(url, expectedDigest, label, canonicalSummary = true) {
  const path = fileURLToPath(url);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || realpathSync(path) !== path) {
    throw new TypeError(`M4.147 ${label} must be a regular non-symlink file`);
  }
  const source = readFileSync(path);
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    expectedDigest,
    `M4.147 ${label} must retain its independently pinned bytes`,
  );
  let value;
  try {
    value = JSON.parse(source.toString('utf8'));
  } catch (cause) {
    throw new TypeError(`M4.147 ${label} must contain JSON`, { cause });
  }
  if (canonicalSummary) assertCoverageSummary(url, value);
  return value;
}

export function loadPublishedM4147CoverageInput() {
  const policy = loadExactJson(POLICY_URL, POLICY_DIGEST, 'coverage policy', false);
  const coverage = loadExactJson(COVERAGE_URL, COVERAGE_DIGEST, 'coverage summary');
  const prerequisite = loadExactJson(
    PREREQUISITE_URL,
    PREREQUISITE_DIGEST,
    'prerequisite summary',
  );
  validateCanonicalizerPrerequisiteSummaryStructure(prerequisite, policy);
  assert.equal(coverage.format, 'kern.kir-canonicalizer.coverage-summary.6');
  assert.equal(prerequisite.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.equal(coverage.coverageImplementationDigest, M4147_COVERAGE_IMPLEMENTATION_DIGEST);
  assert.equal(coverage.coveragePolicyDigest, POLICY_DIGEST);
  assert.deepEqual(policy.base, coverage.base);
  assert.equal(
    prerequisite.baseline.coverageImplementationDigest,
    M4147_COVERAGE_IMPLEMENTATION_DIGEST,
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
