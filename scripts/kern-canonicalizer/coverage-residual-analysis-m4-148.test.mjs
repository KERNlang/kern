import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
} from './coverage.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4143,
} from './coverage-residual-analysis-m4-143.mjs';
import {
  loadPublishedM4147CoverageInput,
  M4147_COVERAGE_IMPLEMENTATION_DIGEST,
} from './coverage-input-m4-147.mjs';
import { assertM4148ResidualAnalysis } from './coverage-m4-148-central.mjs';
import {
  assertM4148PublishedInput,
  loadPublishedCanonicalizerResidualAnalysisM4148,
  measureCanonicalizerResidualAnalysisM4148,
  validatePublishedCanonicalizerResidualAnalysisM4148,
} from './coverage-residual-analysis-m4-148.mjs';
import { formatM4148ResidualAnalysisStatus } from './coverage-status-m4-148.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-148.json', import.meta.url);
const PUBLISHED_DIGEST = 'bf5b7c6886f7f114995f59d916f4a87ecc2ea3f7fffc5289448d7ebb32abde2f';
const EXPECTED_ASSIGNMENT = {
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
};
const STATUS =
  'M4.148 publishes the exact one-function quotesource residual analysis with no actionable ' +
  'profile widening; M4.149 investigates the six canonical-surface text-character blockers.';

test('M4.148 freezes and reproduces the exact M4.147 quotesource residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4148();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '4115914127dc627edf8348af8a487ac1beae941a');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 111,
    baseId: 'kern.kir-canonicalizer.profile.m4.141',
    canonicalizerDigest: '836e71de0c456247fdd8e5725d388aeb0f60853083616f82666d2fd2c191d266',
    canonicalizerPolicyDigest: '13d9315aeaf7ffa89ec17ad86b01e39e4a7084657000beb11f8bd0d478b21db7',
    compiledCoreDigest: '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2',
    corpusDigest: '8308f89b292ed823e8b551e0533c550008ee98ba5f817081ae4c9919421a3b6c',
    coverageImplementationDigest: M4147_COVERAGE_IMPLEMENTATION_DIGEST,
    coveragePolicyDigest: '28b76e1260febf3e518a2a6d97b11f96bf202fcce149fb201b92b5b0a5d98019',
    coverageSummaryDigest: 'fc030f9b1140e15cca55fdcea93bcf7da15fd75825ae1cb6577b5620e0b95bf0',
    currentProfileLimits: {
      maxNodeRows: 205,
      maxPropertyRows: 332,
      maxValueRows: 6304,
    },
    familyRegistryDigest: '2be9640b87d863298e5fa93704d526d8b09f58a5c4eed78a46cb8213cca56df8',
    functionFactsDigest: '8a75842adba91baaeb54c959bbd2647dab0165817dfa7a2e1d341efc914adc54',
    legacyParameterBlockers: 1,
    prerequisiteSummaryDigest:
      '0ef253dba0b3ab80593d9fd3985e210736c3c9bc69763b21480330f1c0ba21f7',
    profileDigest: 'fe14493f42136a4c6d5593b0ec6eb8c5c96c89076264cbdb961e8c2e03acb44b',
    residualFunctionCount: 1,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    'e953208c40e51714c3e0338455f67437fb6a6fda6c3f9fb42df0870dda003720',
  );
  assert.deepEqual(handoff.record.assignments, [EXPECTED_ASSIGNMENT]);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 1);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 0);
  assert.deepEqual(handoff.record.frontier.actionableCandidates, []);
  assert.equal(handoff.record.selectedNextAction, null);
  assert.equal(formatM4148ResidualAnalysisStatus(handoff.record.selectedNextAction), STATUS);
  assert.deepEqual(measureCanonicalizerResidualAnalysisM4148(), handoff.record);
  assert.equal(assertM4148ResidualAnalysis(), STATUS);
});

test('M4.148 authenticates the exact archived M4.147 rolling input', () => {
  const published = loadPublishedM4147CoverageInput();
  assert.equal(
    published.coverageDigest,
    'fc030f9b1140e15cca55fdcea93bcf7da15fd75825ae1cb6577b5620e0b95bf0',
  );
  assert.equal(
    published.prerequisiteDigest,
    '0ef253dba0b3ab80593d9fd3985e210736c3c9bc69763b21480330f1c0ba21f7',
  );
  assert.equal(
    published.policyDigest,
    '28b76e1260febf3e518a2a6d97b11f96bf202fcce149fb201b92b5b0a5d98019',
  );
  assert.deepEqual(published.policy.base, published.coverage.base);
  assert.equal(
    published.coverage.coverageImplementationDigest,
    M4147_COVERAGE_IMPLEMENTATION_DIGEST,
  );
  assert.equal(
    published.prerequisite.baseline.coverageImplementationDigest,
    M4147_COVERAGE_IMPLEMENTATION_DIGEST,
  );
});

test('M4.148 rejects drift in every live or archived semantic dependency identity', () => {
  const policy = loadCoveragePolicy();
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const receipt = measureCanonicalizerCoverage(policy, canonicalizerPolicy);
  const prerequisite = measureCanonicalizerPrerequisite();
  const published = loadPublishedM4147CoverageInput();
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
      () => assertM4148PublishedInput(copy, prerequisite, canonicalizerPolicy, published),
      /coverage M4\.148 residual analysis rejection/u,
      key,
    );
  }

  const prerequisiteDrift = structuredClone(prerequisite);
  prerequisiteDrift.exhaustion.residualFunctionCount = 2;
  assert.throws(
    () => assertM4148PublishedInput(
      receipt,
      prerequisiteDrift,
      canonicalizerPolicy,
      published,
    ),
    /coverage M4\.148 residual analysis rejection/u,
  );

  const policyDrift = structuredClone(canonicalizerPolicy);
  policyDrift.kirLimits.maxDepth += 1;
  assert.throws(
    () => assertM4148PublishedInput(receipt, prerequisite, policyDrift, published),
    /coverage M4\.148 residual analysis rejection/u,
  );

  const archiveDrift = structuredClone(published);
  archiveDrift.coverage.functionFactsDigest = '0'.repeat(64);
  assert.throws(
    () => assertM4148PublishedInput(
      receipt,
      prerequisite,
      canonicalizerPolicy,
      archiveDrift,
    ),
    /coverage M4\.148 residual analysis rejection/u,
  );
});

test('M4.148 published digest rejects canonical and hostile object drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM4148().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.assignments[0].reasons.pop(); },
    (copy) => { copy.frontier.profileRowsAvailableFunctions = 0; },
    (copy) => { copy.frontier.evaluatedObservedSettings = -0; },
    (copy) => { copy.frontier.actionableCandidates = [{}]; },
    (copy) => { copy.baseline.currentProfileLimits.maxNodeRows = 206; },
    (copy) => { copy.selectedNextAction = {}; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM4148(copy),
      /coverage M4\.148 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4148(decorated),
    /coverage M4\.148 residual analysis rejection/u,
  );

  const readOnly = structuredClone(published);
  Object.defineProperty(readOnly.frontier, 'evaluatedObservedSettings', {
    configurable: true,
    enumerable: true,
    value: 0,
    writable: false,
  });
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4148(readOnly),
    /coverage M4\.148 residual analysis rejection/u,
  );

  const fixedLength = structuredClone(published);
  Object.defineProperty(fixedLength.assignments, 'length', { writable: false });
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4148(fixedLength),
    /coverage M4\.148 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.frontier.actionableCandidates.push(shared.assignments);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4148(shared),
    /coverage M4\.148 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4148(cyclic),
    /coverage M4\.148 residual analysis rejection/u,
  );
});

test('M4.148 receipt loader rejects missing, non-file, symlink, malformed, and noncanonical input', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'kern-m4-148-receipt-')));
  try {
    const missing = pathToFileURL(join(directory, 'missing.json'));
    assert.throws(
      () => loadPublishedCanonicalizerResidualAnalysisM4148(missing),
      /published receipt must be a regular non-symlink file/u,
    );

    const childDirectory = join(directory, 'directory.json');
    mkdirSync(childDirectory);
    assert.throws(
      () => loadPublishedCanonicalizerResidualAnalysisM4148(pathToFileURL(childDirectory)),
      /published receipt must be a regular non-symlink file/u,
    );

    const link = join(directory, 'link.json');
    symlinkSync(summaryUrl, link);
    assert.throws(
      () => loadPublishedCanonicalizerResidualAnalysisM4148(pathToFileURL(link)),
      /published receipt must be a regular non-symlink file/u,
    );

    const malformed = join(directory, 'malformed.json');
    writeFileSync(malformed, '{');
    assert.throws(
      () => loadPublishedCanonicalizerResidualAnalysisM4148(pathToFileURL(malformed)),
      /published receipt must contain JSON/u,
    );

    const noncanonical = join(directory, 'noncanonical.json');
    writeFileSync(
      noncanonical,
      JSON.stringify(loadPublishedCanonicalizerResidualAnalysisM4148().record),
    );
    assert.throws(
      () => loadPublishedCanonicalizerResidualAnalysisM4148(pathToFileURL(noncanonical)),
      /published receipt must use canonical JSON bytes/u,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('M4.148 preserves M4.143 and loads byte-identically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4143().digest,
    '22639a2453389244611a91560afcd8d03ecefca8874089015f338622e5ba6e3e',
  );
  const moduleUrl = new URL('./coverage-residual-analysis-m4-148.mjs', import.meta.url).href;
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import {loadPublishedCanonicalizerResidualAnalysisM4148 as load} from ` +
      `${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(load()))`,
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM4148());
});

test('M4.148 module import and direct-invocation detection are fail-closed', () => {
  const moduleUrl = new URL('./coverage-residual-analysis-m4-148.mjs', import.meta.url).href;
  const stdin = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    input: `import ${JSON.stringify(moduleUrl)}; process.stdout.write('ok')`,
  });
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.equal(stdin.stdout, 'ok');

  const placeholder = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import ${JSON.stringify(moduleUrl)}; process.stdout.write('ok')`,
    'not-a-repository-path',
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(placeholder.status, 0, placeholder.stderr);
  assert.equal(placeholder.stdout, 'ok');

  const directory = mkdtempSync(join(tmpdir(), 'kern-m4-148-entry-'));
  const link = join(directory, 'coverage-residual-analysis-m4-148.mjs');
  symlinkSync(new URL('./coverage-residual-analysis-m4-148.mjs', import.meta.url), link);
  try {
    const direct = spawnSync(process.execPath, [link], {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
    });
    assert.notEqual(direct.status, 0);
    assert.match(direct.stderr, /direct invocation requires exactly --write/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
