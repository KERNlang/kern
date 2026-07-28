import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { loadCoveragePolicy, measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM4113ParameterMigrations,
  assertM4113ParameterTarget,
  m4113ParameterMigration,
  M4113_PARAMETER_MIGRATION_TARGETS,
} from './coverage-m4-113-parameter-migration.mjs';
import { m4112ParameterMigration } from './coverage-m4-112-kir-depth-promotion.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { parameterMigrationRoots } from './coverage-value-band-parameter-migrations.mjs';

const EXPECTED_SIGNATURES = [
  {
    id: 'examples/capstone-assertion-engine/compare.kern#2:compareList',
    parameters: [
      ['pA', 'number[]'], ['kA', 'string[]'], ['xA', 'number[]'], ['tA', 'string[]'],
      ['vA', 'string[]'], ['pB', 'number[]'], ['kB', 'string[]'], ['xB', 'number[]'],
      ['tB', 'string[]'], ['vB', 'string[]'], ['idxA', 'number'], ['idxB', 'number'],
      ['path', 'string'],
    ],
  },
  {
    id: 'examples/capstone-assertion-engine/compare.kern#3:compareMap',
    parameters: [
      ['pA', 'number[]'], ['kA', 'string[]'], ['xA', 'number[]'], ['tA', 'string[]'],
      ['vA', 'string[]'], ['pB', 'number[]'], ['kB', 'string[]'], ['xB', 'number[]'],
      ['tB', 'string[]'], ['vB', 'string[]'], ['idxA', 'number'], ['idxB', 'number'],
      ['path', 'string'],
    ],
  },
  {
    id: 'examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven',
    parameters: [
      ['row', 'number'], ['fnName', 'string'], ['binding', 'string'],
      ['stmtKind', 'string[]'], ['stmtFn', 'string[]'], ['stmtParent', 'number[]'],
      ['stmtName', 'string[]'], ['stmtTarget', 'string[]'], ['stmtExprKind', 'string[]'],
      ['paramFn', 'string[]'], ['paramName', 'string[]'], ['paramType', 'string[]'],
    ],
  },
  {
    id: 'examples/capstone-checker-subset/checker-while.kern#9:numericBindingProven',
    parameters: [
      ['row', 'number'], ['fnName', 'string'], ['binding', 'string'],
      ['requiredStep', 'string'], ['stmtKind', 'string[]'], ['stmtFn', 'string[]'],
      ['stmtParent', 'number[]'], ['stmtName', 'string[]'], ['stmtTarget', 'string[]'],
      ['stmtExprKind', 'string[]'], ['stmtExprName', 'string[]'],
      ['stmtExprNum', 'string[]'], ['stmtExprLeftKind', 'string[]'],
      ['stmtExprLeftName', 'string[]'], ['stmtExprRightKind', 'string[]'],
      ['stmtExprRightNum', 'string[]'],
    ],
  },
  {
    id: 'examples/capstone-checker-subset/checker.kern#17:paramCallsitesOk',
    parameters: [
      ['callee', 'string'], ['ordinal', 'number'], ['callName', 'string[]'],
      ['callFn', 'string[]'], ['argCall', 'number[]'], ['argOrdinal', 'number[]'],
      ['argKind', 'string[]'], ['argName', 'string[]'], ['argNum', 'string[]'],
      ['argOp', 'string[]'], ['argLeftKind', 'string[]'], ['argLeftName', 'string[]'],
      ['argLeftNum', 'string[]'], ['argRightKind', 'string[]'],
      ['argRightName', 'string[]'], ['argRightNum', 'string[]'],
      ['stmtKind', 'string[]'], ['stmtFn', 'string[]'], ['stmtName', 'string[]'],
      ['stmtTarget', 'string[]'], ['paramFn', 'string[]'], ['paramName', 'string[]'],
      ['paramOrdinal', 'number[]'],
    ],
  },
  {
    id: 'examples/capstone-checker-subset/checker.kern#20:mapKeyToken',
    parameters: [
      ['callId', 'number'], ['callFn', 'string[]'], ['argCall', 'number[]'],
      ['argOrdinal', 'number[]'], ['argKind', 'string[]'], ['argName', 'string[]'],
      ['stmtKind', 'string[]'], ['stmtFn', 'string[]'], ['stmtTarget', 'string[]'],
    ],
  },
  {
    id: 'examples/capstone-checker-subset/checker.kern#21:mapKnownBefore',
    parameters: [
      ['callId', 'number'], ['callStmt', 'number[]'], ['callFn', 'string[]'],
      ['callMemberObject', 'string[]'], ['callMemberProp', 'string[]'],
      ['argCall', 'number[]'], ['argOrdinal', 'number[]'], ['argKind', 'string[]'],
      ['argName', 'string[]'], ['stmtKind', 'string[]'], ['stmtFn', 'string[]'],
      ['stmtTarget', 'string[]'],
    ],
  },
  {
    id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement',
    parameters: [
      ['id', 'number'], ['level', 'number'], ['returnType', 'string'],
      ['nodeKind', 'string[]'], ['nodeParent', 'number[]'], ['nodeOrder', 'number[]'],
      ['propNode', 'number[]'], ['propKey', 'string[]'], ['propValue', 'number[]'],
      ['valueTag', 'string[]'], ['valueParent', 'number[]'], ['valueRole', 'string[]'],
      ['valueOrder', 'number[]'], ['valueText', 'string[]'], ['valueBool', 'number[]'],
    ],
  },
  {
    id: 'examples/selfhost-validator/validator.kern#15:exportkind',
    parameters: [
      ['module', 'number'], ['name', 'string'], ['fnModule', 'number[]'],
      ['fnName', 'string[]'], ['fnReturns', 'string[]'], ['fnAsync', 'number[]'],
      ['fnStream', 'number[]'], ['fnHandlers', 'number[]'], ['fnParams', 'string[]'],
      ['fnExport', 'number[]'], ['paramFn', 'number[]'], ['classModule', 'number[]'],
      ['className', 'string[]'], ['classExport', 'number[]'], ['useModule', 'number[]'],
      ['useTarget', 'number[]'], ['fromUse', 'number[]'], ['fromName', 'string[]'],
      ['fromAs', 'string[]'], ['fromExport', 'number[]'], ['path', 'number[]'],
    ],
  },
];

function targetFixture(target, coverage) {
  const roots = parameterMigrationRoots([target]).get(target.path);
  return {
    fact: coverage.functions.find(({ id }) => id === target.id),
    root: roots?.[target.functionOrdinal],
    target,
  };
}

test('M4.113 consumes the exact immutable M4.112 nine-function queue', () => {
  assert.deepEqual(
    m4112ParameterMigration(),
    {
      completeFunctions: M4113_PARAMETER_MIGRATION_TARGETS.length,
      completeTools: new Set(M4113_PARAMETER_MIGRATION_TARGETS.map(({ tool }) => tool)).size,
      migratedParameterRows: M4113_PARAMETER_MIGRATION_TARGETS
        .reduce((sum, { parameters }) => sum + parameters.length, 0),
      witnesses: M4113_PARAMETER_MIGRATION_TARGETS.map((target) => ({
        id: target.id,
        parameterRows: target.parameters.length,
        profileRows: target.profileRows,
        tool: target.tool,
      })),
    },
  );
  assert.equal(M4113_PARAMETER_MIGRATION_TARGETS.length, 9);
  assert.equal(
    M4113_PARAMETER_MIGRATION_TARGETS.reduce(
      (sum, { parameters }) => sum + parameters.length,
      0,
    ),
    134,
  );
  assert.deepEqual(
    M4113_PARAMETER_MIGRATION_TARGETS.map(({ id, parameters }) => ({ id, parameters })),
    EXPECTED_SIGNATURES,
  );
});

test('M4.113 migrates all targets without changing bodies or contracts', () => {
  const coverage = measureCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  assertM4113ParameterMigrations(coverage, prerequisite);
  for (const target of M4113_PARAMETER_MIGRATION_TARGETS) {
    const fixture = targetFixture(target, coverage);
    assertM4113ParameterTarget(fixture.root, fixture.fact, fixture.target);
  }
  assert.equal(coverage.baseCompleteFunctions, 101);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) =>
      excludedProperties.includes('fn.params')).length,
    6,
  );
  assert.deepEqual(m4113ParameterMigration(), {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
  assert.deepEqual(prerequisite.parameterMigration, m4113ParameterMigration());
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 6);
});

test('M4.113 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const coverage = measureCanonicalizerCoverage();
  const fixture = targetFixture(M4113_PARAMETER_MIGRATION_TARGETS[0], coverage);
  assertM4113ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'pA:number[]'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'boolean'; },
    ({ root }) => { root.props.export = 'true'; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'string'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => {
      root.children.find(({ type }) => type === 'handler').children[0].props.value = 'false';
    },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.values'); },
    ({ fact }) => { fact.profileRows.values -= 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM4113ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.113 target sources remain parse-clean', () => {
  const rootsByPath = parameterMigrationRoots(M4113_PARAMETER_MIGRATION_TARGETS);
  for (const [path, roots] of rootsByPath) {
    assert.ok(path.endsWith('.kern'));
    assert.ok(roots.length > 0);
  }
  const source = [
    'fn name=probe returns=void',
    '  param name=value type=string',
    '  handler lang=kern',
    '    return',
  ].join('\n');
  assert.deepEqual(parseDocumentWithDiagnostics(source).diagnostics, []);
});

test('historical source overrides stay corpus-bound and reject generated evidence', () => {
  const policy = loadCoveragePolicy();
  assert.throws(
    () => measureCanonicalizerCoverage(policy, undefined, {
      sourceOverrides: new Map([['examples/future.kern', Buffer.from('fn name=future\n')]]),
    }),
    /source overrides must name only declared corpus members/u,
  );
  const generated = Buffer.from('# GENERATED FILE - do not hand-edit.\n');
  const generatedPolicy = structuredClone(policy);
  generatedPolicy.corpus[0].digest = createHash('sha256').update(generated).digest('hex');
  assert.throws(
    () => measureCanonicalizerCoverage(generatedPolicy, undefined, {
      sourceOverrides: new Map([[generatedPolicy.corpus[0].path, generated]]),
    }),
    /corpus member .* is generated/u,
  );
});
