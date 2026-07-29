import assert from 'node:assert/strict';

import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';
import { EMITSTATEMENT_M4113_TARGET } from './emitstatement-target.mjs';
import { m4112ParameterMigration } from './coverage-m4-112-kir-depth-promotion.mjs';
import { formatM4113ParameterMigrationStatus } from './coverage-status.mjs';

const POST_MIGRATION_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

export const M4113_PARAMETER_MIGRATION_TARGETS = [
  {
    bodyDigest: 'a3da282d65c94aea4b3f7f49fd6943a78a0c512252435de76c2a0270f30bf56f',
    exported: false,
    functionOrdinal: 0,
    id: 'examples/capstone-assertion-engine/compare.kern#2:compareList',
    name: 'compareList',
    parameters: [
      ['pA', 'number[]'], ['kA', 'string[]'], ['xA', 'number[]'], ['tA', 'string[]'],
      ['vA', 'string[]'], ['pB', 'number[]'], ['kB', 'string[]'], ['xB', 'number[]'],
      ['tB', 'string[]'], ['vB', 'string[]'], ['idxA', 'number'], ['idxB', 'number'],
      ['path', 'string'],
    ],
    path: 'examples/capstone-assertion-engine/compare.kern',
    profileRows: { nodes: 38, properties: 69, values: 432 },
    quotedReturns: false,
    returns: 'string',
    tool: 'assertion-engine',
  },
  {
    bodyDigest: 'bbdf20d9279e2c91f84c3a44f7da8f6d7a56234afc176437da284f089b97e638',
    exported: false,
    functionOrdinal: 1,
    id: 'examples/capstone-assertion-engine/compare.kern#3:compareMap',
    name: 'compareMap',
    parameters: [
      ['pA', 'number[]'], ['kA', 'string[]'], ['xA', 'number[]'], ['tA', 'string[]'],
      ['vA', 'string[]'], ['pB', 'number[]'], ['kB', 'string[]'], ['xB', 'number[]'],
      ['tB', 'string[]'], ['vB', 'string[]'], ['idxA', 'number'], ['idxB', 'number'],
      ['path', 'string'],
    ],
    path: 'examples/capstone-assertion-engine/compare.kern',
    profileRows: { nodes: 44, properties: 78, values: 606 },
    quotedReturns: false,
    returns: 'string',
    tool: 'assertion-engine',
  },
  {
    bodyDigest: 'f3d8d7f2458052b762a8deb98e6db6ad47e43aa1fae0434fbfbdbab8a6d350c3',
    exported: false,
    functionOrdinal: 11,
    id: 'examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven',
    name: 'lengthReceiverProven',
    parameters: [
      ['row', 'number'], ['fnName', 'string'], ['binding', 'string'],
      ['stmtKind', 'string[]'], ['stmtFn', 'string[]'], ['stmtParent', 'number[]'],
      ['stmtName', 'string[]'], ['stmtTarget', 'string[]'], ['stmtExprKind', 'string[]'],
      ['paramFn', 'string[]'], ['paramName', 'string[]'], ['paramType', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 34, properties: 57, values: 464 },
    quotedReturns: false,
    returns: 'boolean',
    tool: 'checker',
  },
  {
    bodyDigest: '6b36b974c1d1f38c527847eea83fb393173c51ff172d366bc4e55ee8059d12ae',
    exported: false,
    functionOrdinal: 9,
    id: 'examples/capstone-checker-subset/checker-while.kern#9:numericBindingProven',
    name: 'numericBindingProven',
    parameters: [
      ['row', 'number'], ['fnName', 'string'], ['binding', 'string'],
      ['requiredStep', 'string'], ['stmtKind', 'string[]'], ['stmtFn', 'string[]'],
      ['stmtParent', 'number[]'], ['stmtName', 'string[]'], ['stmtTarget', 'string[]'],
      ['stmtExprKind', 'string[]'], ['stmtExprName', 'string[]'],
      ['stmtExprNum', 'string[]'], ['stmtExprLeftKind', 'string[]'],
      ['stmtExprLeftName', 'string[]'], ['stmtExprRightKind', 'string[]'],
      ['stmtExprRightNum', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 54, properties: 80, values: 639 },
    quotedReturns: false,
    returns: 'boolean',
    tool: 'checker',
  },
  {
    bodyDigest: 'd4d08288efc1ecb557417f7d08d8c93251ca56e134ab2b5705120762a1a64f96',
    exported: false,
    functionOrdinal: 16,
    id: 'examples/capstone-checker-subset/checker.kern#17:paramCallsitesOk',
    name: 'paramCallsitesOk',
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
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 39, properties: 71, values: 325 },
    quotedReturns: false,
    returns: 'boolean',
    tool: 'checker',
  },
  {
    bodyDigest: '499ee3bf12507e17815395e7ef974aba7a3c8885d1b21563ff667d7c79f905c4',
    exported: false,
    functionOrdinal: 19,
    id: 'examples/capstone-checker-subset/checker.kern#20:mapKeyToken',
    name: 'mapKeyToken',
    parameters: [
      ['callId', 'number'], ['callFn', 'string[]'], ['argCall', 'number[]'],
      ['argOrdinal', 'number[]'], ['argKind', 'string[]'], ['argName', 'string[]'],
      ['stmtKind', 'string[]'], ['stmtFn', 'string[]'], ['stmtTarget', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 21, properties: 33, values: 230 },
    quotedReturns: false,
    returns: 'string',
    tool: 'checker',
  },
  {
    bodyDigest: 'a9bebbf601c301ddafa603e409c3dd5bbe12208adc938efae9eeeb20917d3bb0',
    exported: false,
    functionOrdinal: 20,
    id: 'examples/capstone-checker-subset/checker.kern#21:mapKnownBefore',
    name: 'mapKnownBefore',
    parameters: [
      ['callId', 'number'], ['callStmt', 'number[]'], ['callFn', 'string[]'],
      ['callMemberObject', 'string[]'], ['callMemberProp', 'string[]'],
      ['argCall', 'number[]'], ['argOrdinal', 'number[]'], ['argKind', 'string[]'],
      ['argName', 'string[]'], ['stmtKind', 'string[]'], ['stmtFn', 'string[]'],
      ['stmtTarget', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 31, properties: 48, values: 391 },
    quotedReturns: false,
    returns: 'boolean',
    tool: 'checker',
  },
  EMITSTATEMENT_M4113_TARGET,
  {
    bodyDigest: '0cdeaae1b47313bd535269f12f59061977a01976dcdc8355d958093eea54a636',
    exported: true,
    functionOrdinal: 15,
    id: 'examples/selfhost-validator/validator.kern#15:exportkind',
    name: 'exportkind',
    parameters: [
      ['module', 'number'], ['name', 'string'], ['fnModule', 'number[]'],
      ['fnName', 'string[]'], ['fnReturns', 'string[]'], ['fnAsync', 'number[]'],
      ['fnStream', 'number[]'], ['fnHandlers', 'number[]'], ['fnParams', 'string[]'],
      ['fnExport', 'number[]'], ['paramFn', 'number[]'], ['classModule', 'number[]'],
      ['className', 'string[]'], ['classExport', 'number[]'], ['useModule', 'number[]'],
      ['useTarget', 'number[]'], ['fromUse', 'number[]'], ['fromName', 'string[]'],
      ['fromAs', 'string[]'], ['fromExport', 'number[]'], ['path', 'number[]'],
    ],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 39, properties: 69, values: 483 },
    quotedReturns: false,
    returns: 'string',
    tool: 'validator',
  },
];

const RESIDUAL_LEGACY_PARAMETER_FUNCTION_IDS = [
  'examples/capstone-checker-subset/checker.kern#24:checkModule',
  'examples/capstone-checker-subset/checker.kern#2:rejectLine',
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
  'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
  'examples/selfhost-validator/validator.kern#20:validate',
];

function expectedQueue() {
  return {
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
  };
}

export function assertM4113ParameterTarget(root, fact, target) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
  assert.equal(root.props.export === 'true', target.exported);
  assert.equal(root.__quotedProps?.includes('returns') ?? false, target.quotedReturns);
  assertDirectParameterPrefix(root, target.parameters);
  assert.equal(semanticBodyDigest(root), target.bodyDigest);
  assert.ok(fact);
  assert.equal(fact.id, target.id);
  assert.deepEqual(fact.excludedProperties, []);
  assert.equal(fact.firstUnsupported, null);
  assert.deepEqual(fact.profileBlockers, []);
  assert.deepEqual(fact.profileRows, target.profileRows);
  assert.equal(
    fact.nodeOccurrences.filter((kind) => kind === 'param').length,
    target.parameters.length,
  );
  return fact;
}

export function m4113ParameterMigration() {
  return structuredClone(POST_MIGRATION_QUEUE);
}

export function m4113CoverageStatus() {
  const migration = m4112ParameterMigration();
  return formatM4113ParameterMigrationStatus({
    migratedFunctions: migration.completeFunctions,
    migratedRows: migration.migratedParameterRows,
  });
}

export function assertM4113ParameterMigrations(coverage) {
  assert.deepEqual(m4112ParameterMigration(), expectedQueue());
  const rootsByPath = parameterMigrationRoots(M4113_PARAMETER_MIGRATION_TARGETS);
  for (const target of M4113_PARAMETER_MIGRATION_TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    const fact = coverage.functions.find(({ id }) => id === target.id);
    assertM4113ParameterTarget(root, fact, target);
  }
  assert.equal(coverage.baseCompleteFunctions, 101);
  assert.equal(coverage.functions.length, 112);
  assert.deepEqual(
    coverage.functions
      .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
      .map(({ id }) => id),
    RESIDUAL_LEGACY_PARAMETER_FUNCTION_IDS,
  );
  return coverage;
}
