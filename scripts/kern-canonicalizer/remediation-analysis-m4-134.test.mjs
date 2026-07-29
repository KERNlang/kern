import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerProjectionAnalysisM4133,
} from './projection-analysis-m4-133.mjs';
import { assertM4134RemediationAnalysis } from './coverage-m4-134-central.mjs';
import {
  analyzeRemediationExpressionSourceM4134,
  loadPublishedCanonicalizerRemediationAnalysisM4134,
  measureCanonicalizerRemediationAnalysisM4134,
  validatePublishedCanonicalizerRemediationAnalysisM4134,
} from './remediation-analysis-m4-134.mjs';

const summaryUrl = new URL('./remediation-analysis-m4-134.json', import.meta.url);
const PUBLISHED_DIGEST = '0023de4d890d0a1b25783f3a6f6ded2985285bb98664df210533744b6ac9e286';
const QUOTESOURCE_ID =
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource';
const EXPRESSIONSOURCES_ID =
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources';
const CANONICALIZE_ID =
  'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize';
const CHARACTER_BLOCKERS = [
  'if.properties.cond.expression.text.character-u007f',
  'if.properties.cond.expression.text.character-u0080',
  'if.properties.cond.expression.text.character-u009f',
  'if.properties.cond.expression.text.character-u2028',
  'if.properties.cond.expression.text.character-u2029',
  'if.properties.cond.expression.text.character-ufeff',
];

const EXPECTED_REQUIREMENTS = [
  {
    blockers: CHARACTER_BLOCKERS,
    id: QUOTESOURCE_ID,
    outcome: 'canonical-surface',
    parameterRows: 2,
    remediation: 'quotesource-code-point-rewrite',
    tool: 'canonicalizer',
  },
  {
    constructors: [{ arity: 0, count: 4, name: 'Map' }],
    id: EXPRESSIONSOURCES_ID,
    outcome: 'unsupported-expression',
    parameterRows: 6,
    projectionCode: 'unknown-expression-kind',
    remediation: 'bounded-new-expression-support',
    tool: 'canonicalizer',
  },
  {
    constructors: [{ arity: 1, count: 17, name: 'Error' }],
    id: CANONICALIZE_ID,
    outcome: 'unsupported-expression',
    parameterRows: 15,
    projectionCode: 'unknown-expression-kind',
    remediation: 'bounded-new-expression-support',
    tool: 'canonicalizer',
  },
];

const EXPECTED_CANDIDATES = [
  {
    completeFunctions: 2,
    constructors: [
      { arity: 1, count: 17, name: 'Error' },
      { arity: 0, count: 4, name: 'Map' },
    ],
    id: 'bounded-new-expression-support',
    parameterRows: 21,
    requiredContracts: [
      'kern-canonical-source-emission',
      'structural-expression-projection',
      'structural-expression-validation',
    ],
    witnesses: [EXPRESSIONSOURCES_ID, CANONICALIZE_ID],
  },
  {
    blockedCharacters: CHARACTER_BLOCKERS,
    completeFunctions: 1,
    id: 'quotesource-code-point-rewrite',
    parameterRows: 2,
    requiredContracts: [
      'portable-text-code-point-operation',
      'quotesource-source-rewrite',
    ],
    witnesses: [QUOTESOURCE_ID],
  },
];

test('M4.134 freezes the exact residual remediation decision', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerRemediationAnalysisM4134();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '6222871ce7e8025a4654ff1b0d4c3a43afe3f494');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.remediation-analysis.1');
  assert.deepEqual(handoff.record.input, {
    baseCompleteFunctions: 104,
    functionCount: 112,
    projectionAnalysisDigest: '89da63518b22003642eabba46177dce3e835d2fde82aebfb4ebe10bd3273bf0a',
    residualFunctions: 3,
  });
  assert.deepEqual(handoff.record.requirements, EXPECTED_REQUIREMENTS);
  assert.deepEqual(handoff.record.candidates, EXPECTED_CANDIDATES);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_CANDIDATES[0]);
  assert.deepEqual(handoff.record.summary, {
    canonicalSurfaceFunctions: 1,
    constructorFunctions: 2,
    constructorOccurrences: 21,
    remediationCandidates: 2,
  });
  assert.deepEqual(measureCanonicalizerRemediationAnalysisM4134(), handoff.record);
  assert.equal(
    assertM4134RemediationAnalysis(),
    'M4.134 selects bounded new-expression support for 2 functions/21 parameter rows; ' +
      'M4.135 owns the shared constructor contract while quotesource code-point remediation remains pending.',
  );
});

test('M4.134 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerRemediationAnalysisM4134().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.remediation-analysis.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.requirements.pop(); },
    (copy) => { copy.summary.constructorOccurrences += 1; },
    (copy) => { copy.candidates.reverse(); },
    (copy) => { copy.input.baseCompleteFunctions += 1; },
    (copy) => { copy.selectedNextAction = null; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerRemediationAnalysisM4134(copy),
      /coverage M4\.134 remediation analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerRemediationAnalysisM4134(decorated),
    /coverage M4\.134 remediation analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.candidates.push(shared.requirements);
  assert.throws(
    () => validatePublishedCanonicalizerRemediationAnalysisM4134(shared),
    /coverage M4\.134 remediation analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerRemediationAnalysisM4134(cyclic),
    /coverage M4\.134 remediation analysis rejection/u,
  );
});

test('M4.134 preserves the immutable M4.133 projection analysis', () => {
  assert.equal(
    loadPublishedCanonicalizerProjectionAnalysisM4133().digest,
    '89da63518b22003642eabba46177dce3e835d2fde82aebfb4ebe10bd3273bf0a',
  );
});

test('M4.134 rejects any unsupported expression outside the exact constructor population', () => {
  assert.deepEqual(
    analyzeRemediationExpressionSourceM4134('new Map()', EXPRESSIONSOURCES_ID),
    { arity: 0, name: 'Map' },
  );
  assert.deepEqual(
    analyzeRemediationExpressionSourceM4134(
      'new Error("KERN_CANONICALIZER_PROFILE")',
      CANONICALIZE_ID,
    ),
    { arity: 1, name: 'Error' },
  );
  assert.equal(
    analyzeRemediationExpressionSourceM4134('value === null', EXPRESSIONSOURCES_ID),
    null,
  );
  for (const source of ['await value', 'foo(await value)', 'new Date()', 'foo(new Map())']) {
    assert.throws(
      () => analyzeRemediationExpressionSourceM4134(source, EXPRESSIONSOURCES_ID),
      /coverage M4\.134 remediation analysis rejection/u,
    );
  }
});

test('M4.134 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerRemediationAnalysisM4134 as load} from './scripts/kern-canonicalizer/remediation-analysis-m4-134.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerRemediationAnalysisM4134());
});
