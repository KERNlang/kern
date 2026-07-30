import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
} from './coverage.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4132,
} from './coverage-residual-analysis-m4-132.mjs';
import {
  loadPublishedM4142CoverageInput,
  M4142_COVERAGE_IMPLEMENTATION_DIGEST,
} from './coverage-input-m4-142.mjs';
import { assertM4143ResidualAnalysis } from './coverage-m4-143-central.mjs';
import {
  assertM4143PublishedInput,
  loadPublishedCanonicalizerResidualAnalysisM4143,
  measureCanonicalizerResidualAnalysisM4143,
  validatePublishedCanonicalizerResidualAnalysisM4143,
} from './coverage-residual-analysis-m4-143.mjs';
import { formatM4143ResidualAnalysisStatus } from './coverage-status-m4-143.mjs';
import { loadPreM4146CanonicalizerPolicy } from './historical-policy.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-143.json', import.meta.url);
const PUBLISHED_DIGEST = '22639a2453389244611a91560afcd8d03ecefca8874089015f338622e5ba6e3e';
const EXPECTED_ASSIGNMENTS = [
  {
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
    parameterRows: 2,
    profileRows: { nodes: 54, properties: 82, values: 932 },
    reasons: [
      'if.properties.cond.expression.text.character-u007f',
      'if.properties.cond.expression.text.character-u0080',
      'if.properties.cond.expression.text.character-u009f',
      'if.properties.cond.expression.text.character-u2028',
      'if.properties.cond.expression.text.character-u2029',
      'if.properties.cond.expression.text.character-ufeff',
    ],
    tool: 'canonicalizer',
  },
  {
    id: 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
    parameterRows: 6,
    profileRows: null,
    reasons: ['projection.limit-nodes'],
    tool: 'canonicalizer',
  },
];
const STATUS =
  'M4.143 published analysis found no actionable profile widening across the two-function ' +
  'residual frontier; M4.144 investigates structural projection and canonical-surface blockers.';

test('M4.143 freezes the exact published M4.142 residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4143();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '91a2fda256cc16b62bd2faf1f2fdfb8cf0581f90');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 110,
    baseId: 'kern.kir-canonicalizer.profile.m4.141',
    canonicalizerDigest: '9e7ecb330e665b7bf2a0d7e13d78f4cf3c0b9e5b27a799bdafbabd0e18ca770a',
    canonicalizerPolicyDigest: '54d5a78b40f47e1ca1bfdbf1a7d3836c756aae1ace22ff0245d008af78178ff4',
    compiledCoreDigest: '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2',
    corpusDigest: '923813c69d6f7e8cdb15e68237e61f155ab7bca0f764102cfeb29b5071288c89',
    coverageImplementationDigest: '7f7d25c5dc4ff389789ab72af5a7831ff180bacb354d1f648db19d189a295e24',
    coveragePolicyDigest: '3512347baf3870f21b879b632041eea72ffea304e037f0a26fcf720cbe596877',
    coverageSummaryDigest: 'c7d7d31a693df43302368fd1dc19e8f0488bdceea74d76da3037e3e54aa735cc',
    currentProfileLimits: {
      maxNodeRows: 202,
      maxPropertyRows: 308,
      maxValueRows: 4493,
    },
    familyRegistryDigest: '2be9640b87d863298e5fa93704d526d8b09f58a5c4eed78a46cb8213cca56df8',
    functionFactsDigest: '72c677544b56de4b6e714d0f124f88f7f3db811b6442aeb6c8cb405ad7b9998f',
    legacyParameterBlockers: 2,
    prerequisiteSummaryDigest:
      '98aaa464c5b4da345664949dd865a006b8ac8580775695b74705ae31b25c3ef3',
    profileDigest: 'fe14493f42136a4c6d5593b0ec6eb8c5c96c89076264cbdb961e8c2e03acb44b',
    residualFunctionCount: 2,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    '1da9a57ec132a8147f75ab0d252e188aa86b2744b23d58cf3dfa3510b7bcc106',
  );
  assert.deepEqual(handoff.record.assignments, EXPECTED_ASSIGNMENTS);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 1);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 0);
  assert.deepEqual(handoff.record.frontier.actionableCandidates, []);
  assert.equal(handoff.record.selectedNextAction, null);
  assert.equal(formatM4143ResidualAnalysisStatus(handoff.record.selectedNextAction), STATUS);
  assert.deepEqual(measureCanonicalizerResidualAnalysisM4143(), handoff.record);
  assert.equal(assertM4143ResidualAnalysis(), STATUS);
});

test('M4.143 authenticates the exact archived M4.142 rolling input', () => {
  const published = loadPublishedM4142CoverageInput();
  assert.equal(
    published.coverageDigest,
    'c7d7d31a693df43302368fd1dc19e8f0488bdceea74d76da3037e3e54aa735cc',
  );
  assert.equal(
    published.prerequisiteDigest,
    '98aaa464c5b4da345664949dd865a006b8ac8580775695b74705ae31b25c3ef3',
  );
  assert.equal(
    published.policyDigest,
    '3512347baf3870f21b879b632041eea72ffea304e037f0a26fcf720cbe596877',
  );
  assert.deepEqual(published.policy.base, published.coverage.base);
  assert.equal(
    published.coverage.coverageImplementationDigest,
    M4142_COVERAGE_IMPLEMENTATION_DIGEST,
  );
  assert.equal(
    published.prerequisite.baseline.coverageImplementationDigest,
    M4142_COVERAGE_IMPLEMENTATION_DIGEST,
  );
});

test('M4.143 rejects drift in every live semantic dependency identity', () => {
  const canonicalizerPolicy = loadPreM4146CanonicalizerPolicy();
  const receipt = measureCanonicalizerCoverage(loadCoveragePolicy(), canonicalizerPolicy);
  for (const key of [
    'canonicalizerDigest',
    'canonicalizerPolicyDigest',
    'compiledCoreDigest',
    'corpusDigest',
    'coveragePolicyDigest',
    'familyRegistryDigest',
    'functionFactsDigest',
    'profileDigest',
  ]) {
    const copy = structuredClone(receipt);
    copy[key] = '0'.repeat(64);
    assert.throws(
      () => assertM4143PublishedInput(copy, canonicalizerPolicy),
      key === 'canonicalizerPolicyDigest'
        ? /canonicalizer policy must match the measured receipt/u
        : /live semantic facts must match the exact published M4\.142 input/u,
      key,
    );
  }

  const decoratedDigest = structuredClone(receipt);
  decoratedDigest.canonicalizerPolicyDigest = {
    toJSON: () => receipt.canonicalizerPolicyDigest,
  };
  assert.throws(
    () => assertM4143PublishedInput(decoratedDigest, canonicalizerPolicy),
    /canonicalizer policy must match the measured receipt/u,
  );

  const mismatchedPolicy = structuredClone(canonicalizerPolicy);
  mismatchedPolicy.kirLimits.maxDepth += 1;
  assert.throws(
    () => assertM4143PublishedInput(receipt, mismatchedPolicy),
    /canonicalizer policy must match the measured receipt/u,
  );
});

test('M4.143 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM4143().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.profileRowsAvailableFunctions = 0; },
    (copy) => { copy.frontier.evaluatedObservedSettings = -0; },
    (copy) => { copy.frontier.actionableCandidates = [{}]; },
    (copy) => { copy.baseline.currentProfileLimits.maxNodeRows = 203; },
    (copy) => { copy.selectedNextAction = {}; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM4143(copy),
      /coverage M4\.143 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4143(decorated),
    /coverage M4\.143 residual analysis rejection/u,
  );

  const readOnly = structuredClone(published);
  Object.defineProperty(readOnly.frontier, 'evaluatedObservedSettings', {
    configurable: true,
    enumerable: true,
    value: 0,
    writable: false,
  });
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4143(readOnly),
    /coverage M4\.143 residual analysis rejection/u,
  );

  const fixedLength = structuredClone(published);
  Object.defineProperty(fixedLength.assignments, 'length', { writable: false });
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4143(fixedLength),
    /coverage M4\.143 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.frontier.actionableCandidates.push(shared.assignments);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4143(shared),
    /coverage M4\.143 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4143(cyclic),
    /coverage M4\.143 residual analysis rejection/u,
  );
});

test('M4.143 preserves the immutable M4.132 analysis', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4132().digest,
    '1f260e985d3fd8990a387da07144eca4f59c22a3133407b6c408e26e597b521e',
  );
});

test('M4.143 loads byte-identically in a fresh locale-independent process', () => {
  const moduleUrl = new URL('./coverage-residual-analysis-m4-143.mjs', import.meta.url).href;
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import {loadPublishedCanonicalizerResidualAnalysisM4143 as load} from ` +
      `${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(load()))`,
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM4143());
});

test('M4.143 module imports from stdin without treating argv dash as a path', () => {
  const moduleUrl = new URL('./coverage-residual-analysis-m4-143.mjs', import.meta.url).href;
  const fresh = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    input: `import ${JSON.stringify(moduleUrl)}; process.stdout.write('ok')`,
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(fresh.stdout, 'ok');
});

test('M4.143 direct invocation through a symlink still requires --write', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kern-m4-143-entry-'));
  const link = join(directory, 'coverage-residual-analysis-m4-143.mjs');
  symlinkSync(new URL('./coverage-residual-analysis-m4-143.mjs', import.meta.url), link);
  try {
    const fresh = spawnSync(process.execPath, [link], {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
    });
    assert.notEqual(fresh.status, 0);
    assert.match(fresh.stderr, /direct invocation requires exactly --write/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('M4.143 import ignores a non-path argv placeholder', () => {
  const moduleUrl = new URL('./coverage-residual-analysis-m4-143.mjs', import.meta.url).href;
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import ${JSON.stringify(moduleUrl)}; process.stdout.write('ok')`,
    'not-a-repository-path',
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(fresh.stdout, 'ok');
});
