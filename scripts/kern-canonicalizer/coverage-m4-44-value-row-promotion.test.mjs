import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
} from './coverage.mjs';
import {
  measureCanonicalizerPrerequisite,
  migrateLegacyFunctionForPrerequisite,
} from './coverage-prerequisite.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM443,
  validatePublishedCanonicalizerResidualAnalysisM443,
} from './coverage-residual-analysis-m4-43.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import {
  PROFILE_BOUNDARY_FIXTURE,
  PROFILE_LIMIT_FIXTURES,
} from './profile-limit-fixtures.mjs';
import {
  canonicalizerCompletionProfile,
  canonicalizerFunctionCompletes,
} from './coverage-selection.mjs';

const EXPECTED_QUEUE = {
  completeFunctions: 2,
  completeTools: 2,
  migratedParameterRows: 2,
  witnesses: [
    {
      id: 'examples/capstone-checker-subset/checker-while.kern#2:checkerSafeIntText',
      parameterRows: 1,
      profileRows: { nodes: 14, properties: 20, values: 161 },
      tool: 'checker',
    },
    {
      id: 'examples/kern-canonicalizer/canonicalizer.kern#1:validbinaryop',
      parameterRows: 1,
      profileRows: { nodes: 12, properties: 15, values: 388 },
      tool: 'canonicalizer',
    },
  ],
};

function sha256(path) {
  return createHash('sha256').update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest('hex');
}

function withoutLocations(node) {
  const copy = structuredClone(node);
  delete copy.loc;
  copy.children = copy.children.map(withoutLocations);
  return copy;
}

test('M4.44 promotes only the authenticated 388-row policy boundary', () => {
  const policy = loadCanonicalizerPolicy();
  const boundaryDocument = parseDocumentWithDiagnostics(PROFILE_BOUNDARY_FIXTURE.source);
  assert.deepEqual(boundaryDocument.diagnostics, []);
  const canonicalizerSource = readFileSync(
    new URL('../../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url),
    'utf8',
  );
  const canonicalizerDocument = parseDocumentWithDiagnostics(canonicalizerSource);
  assert.deepEqual(canonicalizerDocument.diagnostics, []);
  const validBinaryOp = canonicalizerDocument.root.children.filter(({ type }) => type === 'fn')[1];
  assert.equal(validBinaryOp?.props?.name, 'validbinaryop');
  assert.deepEqual(
    boundaryDocument.root.children.map(withoutLocations),
    [withoutLocations(migrateLegacyFunctionForPrerequisite(validBinaryOp).root)],
  );
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 16,
    maxPropertyRows: 30,
    maxValueRows: 388,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.deepEqual(PROFILE_BOUNDARY_FIXTURE.expectedRows, {
    nodes: 12,
    properties: 15,
    values: 388,
  });
  assert.deepEqual(
    PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-value-row-limit')?.expectedRows,
    { nodes: 12, properties: 16, values: 389 },
  );
});

test('M4.44 exposes exactly the published two-function parameter queue without consuming it', () => {
  const coverage = summarizeCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  assert.equal(coverage.baseCompleteFunctions, 58);
  assert.equal(coverage.blockers.find(({ id }) => id === 'fn.params')?.count, 45);
  assert.deepEqual(prerequisite.parameterMigration, EXPECTED_QUEUE);
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 43);

  const targets = [
    ['examples/capstone-checker-subset/checker-while.kern', 2, 'checkerSafeIntText', 'raw:string'],
    ['examples/kern-canonicalizer/canonicalizer.kern', 1, 'validbinaryop', 'op:string'],
  ];
  for (const [path, ordinal, name, legacyParameters] of targets) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    const document = parseDocumentWithDiagnostics(source);
    assert.deepEqual(document.diagnostics, []);
    const root = document.root.children.filter(({ type }) => type === 'fn')[ordinal];
    assert.equal(root.props.name, name);
    assert.equal(root.props.params, legacyParameters);
    assert.equal(root.children.some(({ type }) => type === 'param'), false);
  }
});

test('M4.44 admits only direct sortStrings outside the frozen legacy queue', () => {
  const policy = loadCoveragePolicy();
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const coverage = measureCanonicalizerCoverage(policy);
  const profile = canonicalizerCompletionProfile(policy.base, []);
  const previousLimits = { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 154 };
  const newlyComplete = coverage.functions.filter((fact) =>
    !canonicalizerFunctionCompletes(profile, fact, previousLimits) &&
    canonicalizerFunctionCompletes(profile, fact, canonicalizerPolicy.profileLimits));
  assert.deepEqual(newlyComplete.map(({ id }) => id), [
    'examples/capstone-assertion-engine/sort.kern#2:sortStrings',
  ]);
  assert.deepEqual(newlyComplete[0].profileRows, {
    nodes: 16,
    properties: 29,
    values: 197,
  });
  assert.deepEqual(newlyComplete[0].excludedProperties, []);
  assert.deepEqual(newlyComplete[0].profileBlockers, []);
  assert.equal(newlyComplete[0].nodeOccurrences.filter((kind) => kind === 'param').length, 1);
});

test('M4.44 freezes the optimized M4.43 frontier before active policy moves', () => {
  const handoff = loadPublishedCanonicalizerResidualAnalysisM443();
  assert.equal(handoff.digest, '823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8');
  assert.equal(handoff.sourceCommit, 'df27456aeda2880eb6bb76e5ed1b8fe314023a39');
  assert.deepEqual(handoff.record.selectedNextAction, {
    changedLimits: ['maxValueRows'],
    completeFunctions: 2,
    completeTools: 2,
    limits: { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 388 },
    totalDelta: 234,
    witnesses: [
      'examples/capstone-checker-subset/checker-while.kern#2:checkerSafeIntText',
      'examples/kern-canonicalizer/canonicalizer.kern#1:validbinaryop',
    ],
  });
  const checkedIn = JSON.parse(readFileSync(
    new URL('./coverage-residual-analysis-m4-43.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(validatePublishedCanonicalizerResidualAnalysisM443(checkedIn).record, checkedIn);
});

test('M4.44 leaves canonicalizer and older historical receipt bytes unchanged', () => {
  assert.equal(
    sha256('examples/kern-canonicalizer/canonicalizer.kern'),
    '394ebcf582c289d13f877b9546430991ea89cdea0ecd1a22b02bef64083d678d',
  );
  assert.equal(
    sha256('examples/kern-canonicalizer/canonicalizer.composed.kern'),
    '1114de23dc9f6bb036eb4734ed8e7aadef5c1d79d54b1d0395967065fc4e904d',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-42.json'),
    'f37fed74d24a739adf3584ceb7608f8d25c490d2325ebc1c127e05ee15238a8e',
  );
});

test('M4.43 published receipt rejects canonical and hidden drift', () => {
  const record = loadPublishedCanonicalizerResidualAnalysisM443().record;
  const mutations = [
    (copy) => { copy.baseline.currentProfileLimits.maxValueRows = 388; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.selectedNextAction = null; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM443(copy),
      /coverage M4\.43 residual analysis rejection/u,
    );
  }
  const decorated = structuredClone(record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM443(decorated),
    /coverage M4\.43 residual analysis rejection/u,
  );
});
