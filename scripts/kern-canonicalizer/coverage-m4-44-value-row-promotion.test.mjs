import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
} from './coverage.mjs';
import { loadPublishedCanonicalizerPrerequisiteM444 } from './coverage-prerequisite-m4-44.mjs';
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

test('M4.44 value boundary remains exact under the M4.52 property-row promotion', () => {
  const policy = loadCanonicalizerPolicy();
  const boundaryDocument = parseDocumentWithDiagnostics(PROFILE_BOUNDARY_FIXTURE.source);
  assert.deepEqual(boundaryDocument.diagnostics, []);
  const boundaryRoot = boundaryDocument.root.children[0];
  assert.ok(boundaryRoot);
  assert.equal(boundaryRoot.props.name, 'validbinaryop');
  assert.equal(boundaryRoot.props.params, undefined);
  assert.deepEqual(
    boundaryRoot.children.filter(({ type }) => type === 'param').map(({ props }) => [props.name, props.type]),
    [['op', 'string']],
  );
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 28,
    maxPropertyRows: 50,
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
    { nodes: 12, properties: 15, values: 389 },
  );
});

test('M4.44 publishes exactly the frozen two-function parameter queue', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM444();
  assert.equal(handoff.digest, '9741650d8567016fb029a8e51b4706da1da131d9870c94a3221b4550792dee01');
  assert.equal(handoff.sourceCommit, 'dd977ff493250127e2e416ffb4e3ab68985a61dc');
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 58);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 45);
  assert.deepEqual(handoff.record.parameterMigration, EXPECTED_QUEUE);
  assert.equal(handoff.record.exhaustion?.residualFunctionCount, 43);
});

test('M4.44 direct sortStrings admission remains distinct from the frozen legacy queue', () => {
  const policy = loadCoveragePolicy();
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const coverage = measureCanonicalizerCoverage(policy);
  const profile = canonicalizerCompletionProfile(policy.base, []);
  const previousLimits = { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 154 };
  const sortStrings = coverage.functions.find(({ id }) =>
    id === 'examples/capstone-assertion-engine/sort.kern#2:sortStrings');
  assert.ok(sortStrings);
  assert.equal(canonicalizerFunctionCompletes(profile, sortStrings, previousLimits), false);
  assert.equal(canonicalizerFunctionCompletes(profile, sortStrings, canonicalizerPolicy.profileLimits), true);
  assert.deepEqual(sortStrings.profileRows, {
    nodes: 16,
    properties: 29,
    values: 197,
  });
  assert.deepEqual(sortStrings.excludedProperties, []);
  assert.deepEqual(sortStrings.profileBlockers, []);
  assert.equal(sortStrings.nodeOccurrences.filter((kind) => kind === 'param').length, 1);
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

test('M4.44 and older historical receipt bytes remain unchanged', () => {
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-prerequisite-m4-44.json'),
    '9741650d8567016fb029a8e51b4706da1da131d9870c94a3221b4550792dee01',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-43.json'),
    '823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8',
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
