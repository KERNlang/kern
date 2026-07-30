import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
  validateCoveragePolicy,
} from './coverage.mjs';
import {
  loadCanonicalizerExceptionFlowImplementationHandoff,
} from './coverage-implementation-handoff.mjs';
import {
  loadCanonicalizerExceptionFlowPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';
import {
  assertPublishedM4141ImplementationDigest,
} from './coverage-m4-141-central.mjs';
import {
  loadPreM4142CoverageInputs,
} from './historical-parameter-sources.mjs';

const PROFILE_ID = 'kern.kir-canonicalizer.profile.m4.141';
const EXCEPTION_FLOW_PREREQUISITE_DIGEST =
  '2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4';
const EXCEPTION_FLOW_IMPLEMENTATION_DIGEST =
  'c9f9d4610800ca53cdec00f5d519d6c1ebaa3e76d26734ebcc69cb3c21ff7753';
const COVERAGE_IMPLEMENTATION_DIGEST =
  '507bae018e1494fe645b5ef762fc6eccf58e02dbbe81e9345f25cc7decb3533e';
const EXCEPTION_FLOW_PROMOTION = {
  family: 'exception-flow',
  provenanceDigest: EXCEPTION_FLOW_PREREQUISITE_DIGEST,
  provenanceKind: 'prerequisite',
};

test('M4.141 independently pins both frozen coverage implementation digests', () => {
  const coverage = { coverageImplementationDigest: COVERAGE_IMPLEMENTATION_DIGEST };
  const prerequisite = {
    baseline: { coverageImplementationDigest: COVERAGE_IMPLEMENTATION_DIGEST },
  };
  assert.equal(
    assertPublishedM4141ImplementationDigest(coverage, prerequisite),
    COVERAGE_IMPLEMENTATION_DIGEST,
  );
  for (const mutate of [
    (copy) => { copy.coverage.coverageImplementationDigest = '0'.repeat(64); },
    (copy) => { copy.prerequisite.baseline.coverageImplementationDigest = '0'.repeat(64); },
    (copy) => {
      copy.coverage.coverageImplementationDigest = '0'.repeat(64);
      copy.prerequisite.baseline.coverageImplementationDigest = '0'.repeat(64);
    },
  ]) {
    const copy = structuredClone({ coverage, prerequisite });
    mutate(copy);
    assert.throws(
      () => assertPublishedM4141ImplementationDigest(copy.coverage, copy.prerequisite),
    );
  }
});

test('M4.141 promotes exception flow through exact prerequisite and implementation evidence', () => {
  const historical = loadPreM4142CoverageInputs(loadCoveragePolicy());
  const policy = historical.policy;
  assert.equal(policy.base.id, PROFILE_ID);
  assert.deepEqual(policy.base.nodeKinds, [
    'assign',
    'do',
    'else',
    'fn',
    'for',
    'handler',
    'if',
    'let',
    'param',
    'return',
    'throw',
    'while',
  ]);
  assert.deepEqual(policy.base.propertyKeys.slice(-3), [
    'return.value',
    'throw.value',
    'while.cond',
  ]);
  assert.deepEqual(policy.base.promotions.at(-1), EXCEPTION_FLOW_PROMOTION);
  assert.deepEqual(policy.families, []);

  const prerequisite = loadCanonicalizerExceptionFlowPrerequisiteProvenance();
  const implementation = loadCanonicalizerExceptionFlowImplementationHandoff();
  assert.equal(prerequisite.digest, EXCEPTION_FLOW_PREREQUISITE_DIGEST);
  assert.equal(implementation.digest, EXCEPTION_FLOW_IMPLEMENTATION_DIGEST);
  assert.deepEqual(implementation.record.prerequisite, {
    digest: prerequisite.digest,
    family: prerequisite.record.snapshot.selectedPrerequisite.family,
  });

  const receipt = measureCanonicalizerCoverage(
    policy,
    undefined,
    { sourceOverrides: historical.sourceOverrides },
  );
  const summary = summarizeCanonicalizerCoverage(receipt);
  assert.deepEqual(receipt.base, policy.base);
  assert.deepEqual(summary.base, policy.base);
  assert.equal(receipt.baseCompleteFunctions, 109);
  assert.equal(receipt.functions.length, 112);
  assert.deepEqual(receipt.implementationProvenance, EXCEPTION_FLOW_PROMOTION);
  assert.deepEqual(summary.implementationProvenance, EXCEPTION_FLOW_PROMOTION);
  assert.deepEqual(receipt.selection, { ranking: [], winner: null });
});

test('M4.141 admits only the exact terminal active-family frontier', () => {
  const policy = loadCoveragePolicy();
  assert.deepEqual(validateCoveragePolicy(structuredClone(policy)).families, []);
  for (const mutate of [
    (copy) => { copy.base.id = 'kern.kir-canonicalizer.profile.future'; },
    (copy) => { copy.base.nodeKinds.splice(copy.base.nodeKinds.indexOf('throw'), 1); },
    (copy) => { copy.base.propertyKeys.splice(copy.base.propertyKeys.indexOf('throw.value'), 1); },
    (copy) => { copy.base.promotions.at(-1).provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions.at(-1).provenanceKind = 'selection'; },
    (copy) => {
      copy.families.push({
        expressionKinds: [],
        id: 'exception-flow',
        nodeKinds: ['throw'],
        propertyKeys: ['throw.value'],
      });
    },
  ]) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(() => validateCoveragePolicy(copy), /coverage policy rejection/u);
  }
});
