import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { M441_PARAMETER_NAMES_BY_PATH } from './coverage-m4-41-parameter-migrations.mjs';
import { M445_PARAMETER_NAMES_BY_PATH } from './coverage-m4-45-parameter-migrations.mjs';
import { M457_PARAMETER_MIGRATION_TARGETS } from './coverage-m4-57-parameter-migrations.mjs';
import {
  assertDirectParameterPrefix,
  M433_VALUE_BAND_NAMES_BY_PATH,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export function assertStructuredParameterMigrations(receipt) {
  const m457NamesByPath = new Map();
  for (const target of M457_PARAMETER_MIGRATION_TARGETS) {
    const names = m457NamesByPath.get(target.path) ?? [];
    names.push(target.name);
    m457NamesByPath.set(target.path, names);
  }
  const sortPath = 'examples/capstone-assertion-engine/sort.kern';
  const sortSource = readFileSync(new URL(`../../${sortPath}`, import.meta.url), 'utf8');
  const sortDocument = parseDocumentWithDiagnostics(sortSource);
  assert.deepEqual(sortDocument.diagnostics, []);
  const sortRoots = sortDocument.root.children.filter(({ type }) => type === 'fn');
  assert.equal(sortSource.split('\n').length - 1, 53);
  assert.deepEqual(sortRoots.map(({ props }) => props.name), ['halfFloor', 'mergeStrings', 'sortStrings']);
  assert.equal(sortRoots.every(({ props }) => !props.params), true);
  assert.deepEqual(
    sortRoots.map(({ children }) => children
      .filter(({ type }) => type === 'param')
      .map(({ props }) => [props.name, props.type])),
    [
      [['n', 'number']],
      [['left', 'string[]'], ['i', 'number'], ['right', 'string[]'], ['j', 'number'], ['acc', 'string[]']],
      [['xs', 'string[]']],
    ],
  );
  const sortFunctions = receipt.functions.filter(({ id }) => id.startsWith(`${sortPath}#`));
  assert.deepEqual(sortFunctions.map(({ id }) => id), [
    `${sortPath}#0:halfFloor`,
    `${sortPath}#1:mergeStrings`,
    `${sortPath}#2:sortStrings`,
  ]);
  assert.equal(sortFunctions.every(({ excludedProperties }) => !excludedProperties.includes('fn.params')), true);
  assert.equal(
    sortFunctions.flatMap(({ nodeOccurrences }) => nodeOccurrences).filter((kind) => kind === 'param').length,
    7,
  );
  assert.deepEqual(
    sortFunctions.map(({ profileBlockers, profileRows }) => ({ profileBlockers, profileRows })),
    [
      { profileBlockers: [], profileRows: { nodes: 6, properties: 9, values: 53 } },
      {
        profileBlockers: ['profile.rows.nodes', 'profile.rows.values'],
        profileRows: { nodes: 29, properties: 44, values: 493 },
      },
      { profileBlockers: [], profileRows: { nodes: 16, properties: 29, values: 197 } },
    ],
  );

  const checkerWhilePath = 'examples/capstone-checker-subset/checker-while.kern';
  const checkerWhileSource = readFileSync(new URL(`../../${checkerWhilePath}`, import.meta.url), 'utf8');
  const checkerWhileDocument = parseDocumentWithDiagnostics(checkerWhileSource);
  assert.deepEqual(checkerWhileDocument.diagnostics, []);
  const checkerWhileRoots = checkerWhileDocument.root.children.filter(({ type }) => type === 'fn');
  const checkerWhileTargetNames = [
    'isDecimalDigit',
    'hasDirectChild',
    'subtreeEnd',
    'isPositiveSafeIntText',
    'isLiteralKind',
    'literalToken',
  ];
  const checkerWhileStructuredNames = new Set([
    ...checkerWhileTargetNames,
    ...M433_VALUE_BAND_NAMES_BY_PATH.get(checkerWhilePath),
    ...M441_PARAMETER_NAMES_BY_PATH.get(checkerWhilePath),
    ...M445_PARAMETER_NAMES_BY_PATH.get(checkerWhilePath),
    ...m457NamesByPath.get(checkerWhilePath),
  ]);
  const checkerWhileTargets = checkerWhileRoots.filter(({ props }) =>
    checkerWhileTargetNames.includes(props.name));
  const checkerWhileLegacySiblings = checkerWhileRoots.filter(({ props }) =>
    !checkerWhileStructuredNames.has(props.name));
  assert.equal(checkerWhileSource.split('\n').length - 1, 301);
  assert.equal(checkerWhileRoots.length, 18);
  assert.deepEqual(checkerWhileTargets.map(({ props }) => props.name), checkerWhileTargetNames);
  assert.equal(checkerWhileTargets.every(({ props }) => props.params === undefined), true);
  assert.deepEqual(
    checkerWhileTargets.map(({ children }) => children
      .filter(({ type }) => type === 'param')
      .map(({ props }) => [props.name, props.type])),
    [
      [['ch', 'string']],
      [['row', 'number'], ['stmtParent', 'number[]']],
      [['row', 'number'], ['stmtParent', 'number[]']],
      [['raw', 'string']],
      [['kind', 'string']],
      [['kind', 'string'], ['name', 'string'], ['num', 'string']],
    ],
  );
  assert.equal(checkerWhileLegacySiblings.length, 5);
  assert.equal(checkerWhileLegacySiblings.every(({ props, children }) =>
    typeof props.params === 'string' &&
    props.params.length > 0 &&
    children.every(({ type }) => type !== 'param')), true);
  const checkerWhileFunctions = receipt.functions.filter(({ id }) =>
    id.startsWith(`${checkerWhilePath}#`) &&
    checkerWhileTargetNames.some((name) => id.endsWith(`:${name}`)));
  assert.deepEqual(checkerWhileFunctions.map(({ id }) => id), [
    `${checkerWhilePath}#0:isDecimalDigit`,
    `${checkerWhilePath}#12:isLiteralKind`,
    `${checkerWhilePath}#13:literalToken`,
    `${checkerWhilePath}#4:hasDirectChild`,
    `${checkerWhilePath}#6:subtreeEnd`,
    `${checkerWhilePath}#8:isPositiveSafeIntText`,
  ]);
  assert.equal(checkerWhileFunctions.every(({ excludedProperties }) =>
    !excludedProperties.includes('fn.params')), true);
  assert.equal(
    checkerWhileFunctions.flatMap(({ nodeOccurrences }) => nodeOccurrences)
      .filter((kind) => kind === 'param').length,
    10,
  );
  assert.deepEqual(
    checkerWhileFunctions.map(({ profileBlockers, profileRows }) => ({ profileBlockers, profileRows })),
    [
      { profileBlockers: [], profileRows: { nodes: 8, properties: 10, values: 43 } },
      { profileBlockers: [], profileRows: { nodes: 4, properties: 6, values: 67 } },
      { profileBlockers: [], profileRows: { nodes: 10, properties: 14, values: 49 } },
      { profileBlockers: [], profileRows: { nodes: 8, properties: 13, values: 53 } },
      { profileBlockers: [], profileRows: { nodes: 9, properties: 14, values: 70 } },
      { profileBlockers: [], profileRows: { nodes: 8, properties: 10, values: 70 } },
    ],
  );

  const checkerPath = 'examples/capstone-checker-subset/checker.kern';
  const checkerSource = readFileSync(new URL(`../../${checkerPath}`, import.meta.url), 'utf8');
  const checkerDocument = parseDocumentWithDiagnostics(checkerSource);
  assert.deepEqual(checkerDocument.diagnostics, []);
  const checkerRoots = checkerDocument.root.children.filter(({ type }) => type === 'fn');
  const checkerTargetNames = ['acceptLine', 'isSafeIntText', 'elseRejectDetail', 'isPrintNumberText'];
  const checkerStructuredNames = new Set([
    ...checkerTargetNames,
    ...M433_VALUE_BAND_NAMES_BY_PATH.get(checkerPath),
    ...M441_PARAMETER_NAMES_BY_PATH.get(checkerPath),
    ...m457NamesByPath.get(checkerPath),
    'isUserCallable',
    'isIndexRebound',
  ]);
  const checkerTargets = checkerRoots.filter(({ props }) => checkerTargetNames.includes(props.name));
  const checkerLegacySiblings = checkerRoots.filter(({ props }) => !checkerStructuredNames.has(props.name));
  assert.equal(checkerSource.split('\n').length - 1, 434);
  assert.equal(checkerRoots.length, 24);
  assert.deepEqual(checkerTargets.map(({ props }) => props.name), checkerTargetNames);
  assert.equal(checkerTargets.every(({ props }) => props.params === undefined), true);
  assert.deepEqual(
    checkerTargets.map(({ children }) => children
      .filter(({ type }) => type === 'param')
      .map(({ props }) => [props.name, props.type])),
    [
      [['path', 'string']],
      [['raw', 'string']],
      [['row', 'number'], ['stmtKind', 'string[]'], ['stmtParent', 'number[]']],
      [['raw', 'string']],
    ],
  );
  assert.equal(checkerLegacySiblings.length, 10);
  assert.equal(checkerLegacySiblings.every(({ props, children }) =>
    typeof props.params === 'string' &&
    props.params.length > 0 &&
    children.every(({ type }) => type !== 'param')), true);
  const checkerFunctions = receipt.functions.filter(({ id }) =>
    id.startsWith(`${checkerPath}#`) && checkerTargetNames.some((name) => id.endsWith(`:${name}`)));
  assert.deepEqual(checkerFunctions.map(({ id }) => id), [
    `${checkerPath}#1:acceptLine`,
    `${checkerPath}#4:isSafeIntText`,
    `${checkerPath}#5:elseRejectDetail`,
    `${checkerPath}#7:isPrintNumberText`,
  ]);
  assert.equal(checkerFunctions.every(({ excludedProperties }) =>
    !excludedProperties.includes('fn.params')), true);
  assert.equal(
    checkerFunctions.flatMap(({ nodeOccurrences }) => nodeOccurrences)
      .filter((kind) => kind === 'param').length,
    6,
  );
  assert.deepEqual(
    checkerFunctions.map(({ profileBlockers, profileRows }) => ({ profileBlockers, profileRows })),
    [
      { profileBlockers: [], profileRows: { nodes: 4, properties: 7, values: 20 } },
      { profileBlockers: [], profileRows: { nodes: 4, properties: 7, values: 21 } },
      { profileBlockers: [], profileRows: { nodes: 6, properties: 10, values: 36 } },
      { profileBlockers: [], profileRows: { nodes: 4, properties: 6, values: 20 } },
    ],
  );

  const validatorPath = 'examples/selfhost-validator/validator.kern';
  const validatorSource = readFileSync(new URL(`../../${validatorPath}`, import.meta.url), 'utf8');
  const validatorDocument = parseDocumentWithDiagnostics(validatorSource);
  assert.deepEqual(validatorDocument.diagnostics, []);
  const validatorRoots = validatorDocument.root.children.filter(({ type }) => type === 'fn');
  const validatorTargetNames = [
    'charoknext',
    'localname',
    'failline',
    'rootpath',
    'statusof',
    'paramcount',
    'containsid',
  ];
  const validatorStructuredNames = new Set([
    ...validatorTargetNames,
    ...M433_VALUE_BAND_NAMES_BY_PATH.get(validatorPath),
    ...M441_PARAMETER_NAMES_BY_PATH.get(validatorPath),
    ...m457NamesByPath.get(validatorPath),
    'appendid',
    'isportable',
    'classcyclefrom',
    'sortstrings',
  ]);
  const validatorTargets = validatorRoots.filter(({ props }) => validatorTargetNames.includes(props.name));
  const validatorLegacySiblings = validatorRoots.filter(({ props }) => !validatorStructuredNames.has(props.name));
  const appendid = validatorRoots[14];
  assert.equal(appendid?.props.name, 'appendid');
  assert.equal(appendid?.props.params, undefined, 'M4.37 appendid must not retain legacy fn.params');
  assertDirectParameterPrefix(appendid, [['xs', 'number[]'], ['id', 'number']]);
  assert.equal(semanticBodyDigest(appendid), '24064fe7a08b3e1c82733710d090dd7f10ec2e8ee1621b7cc2a4e6983aeed72e');
  assert.equal(validatorSource.split('\n').length - 1, 514);
  assert.equal(validatorRoots.length, 21);
  assert.deepEqual(validatorTargets.map(({ props }) => props.name), validatorTargetNames);
  assert.equal(validatorTargets.every(({ props }) => props.params === undefined), true);
  assert.deepEqual(
    validatorTargets.map(({ children }) => children
      .filter(({ type }) => type === 'param')
      .map(({ props }) => [props.name, props.type])),
    [
      [['c', 'string']],
      [['alias', 'string'], ['imported', 'string']],
      [['code', 'string'], ['subject', 'string'], ['rowId', 'number']],
      [['module', 'number'], ['moduleId', 'number[]'], ['moduleRoot', 'string[]']],
      [['module', 'number'], ['moduleId', 'number[]'], ['moduleStatus', 'string[]']],
      [['fnRow', 'number'], ['paramFn', 'number[]']],
      [['xs', 'number[]'], ['id', 'number']],
    ],
  );
  assert.equal(validatorLegacySiblings.length, 5);
  assert.equal(validatorLegacySiblings.every(({ props, children }) =>
    typeof props.params === 'string' &&
    props.params.length > 0 &&
    children.every(({ type }) => type !== 'param')), true);
  const validatorFunctions = receipt.functions.filter(({ id }) =>
    id.startsWith(`${validatorPath}#`) && validatorTargetNames.some((name) => id.endsWith(`:${name}`)));
  assert.deepEqual(validatorFunctions.map(({ id }) => id), [
    `${validatorPath}#13:containsid`,
    `${validatorPath}#1:charoknext`,
    `${validatorPath}#4:localname`,
    `${validatorPath}#5:failline`,
    `${validatorPath}#6:rootpath`,
    `${validatorPath}#7:statusof`,
    `${validatorPath}#9:paramcount`,
  ]);
  assert.equal(validatorFunctions.every(({ excludedProperties }) =>
    !excludedProperties.includes('fn.params')), true);
  assert.equal(
    validatorFunctions.flatMap(({ nodeOccurrences }) => nodeOccurrences)
      .filter((kind) => kind === 'param').length,
    16,
  );
  assert.deepEqual(
    validatorFunctions.map(({ profileBlockers, profileRows }) => ({ profileBlockers, profileRows })),
    [
      { profileBlockers: [], profileRows: { nodes: 8, properties: 14, values: 54 } },
      { profileBlockers: [], profileRows: { nodes: 8, properties: 11, values: 61 } },
      { profileBlockers: [], profileRows: { nodes: 7, properties: 11, values: 31 } },
      { profileBlockers: [], profileRows: { nodes: 6, properties: 11, values: 67 } },
      { profileBlockers: [], profileRows: { nodes: 9, properties: 16, values: 66 } },
      { profileBlockers: [], profileRows: { nodes: 9, properties: 16, values: 66 } },
      { profileBlockers: [], profileRows: { nodes: 9, properties: 17, values: 71 } },
    ],
  );
  const appendidFact = receipt.functions.find(({ id }) => id === `${validatorPath}#14:appendid`);
  assert.equal(appendidFact?.excludedProperties.includes('fn.params'), false);
  assert.deepEqual(appendidFact?.profileBlockers, []);
  assert.deepEqual(appendidFact?.profileRows, { nodes: 9, properties: 16, values: 80 });
  assert.equal(appendidFact?.nodeOccurrences.filter((kind) => kind === 'param').length, 2);

  const expressionHelperPath = 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern';
  const expressionHelperSource = readFileSync(new URL(`../../${expressionHelperPath}`, import.meta.url), 'utf8');
  const expressionHelperDocument = parseDocumentWithDiagnostics(expressionHelperSource);
  assert.deepEqual(expressionHelperDocument.diagnostics, []);
  const expressionHelperRoots = expressionHelperDocument.root.children.filter(({ type }) => type === 'fn');
  const expressionHelperTargetNames = [
    'validnext',
    'propcount',
    'stringat',
    'numberat',
    'childcount',
    'valuechildcount',
  ];
  const expressionHelperStructuredNames = new Set([
    ...expressionHelperTargetNames,
    ...M433_VALUE_BAND_NAMES_BY_PATH.get(expressionHelperPath),
    ...M441_PARAMETER_NAMES_BY_PATH.get(expressionHelperPath),
    'validinteger',
  ]);
  const expressionHelperTargets = expressionHelperRoots.filter(({ props }) =>
    expressionHelperTargetNames.includes(props.name));
  const expressionHelperLegacySiblings = expressionHelperRoots.filter(({ props }) =>
    !expressionHelperStructuredNames.has(props.name));
  assert.equal(expressionHelperSource.split('\n').length - 1, 192);
  assert.equal(expressionHelperRoots.length, 16);
  assert.deepEqual(expressionHelperTargets.map(({ props }) => props.name), expressionHelperTargetNames);
  assert.equal(expressionHelperTargets.every(({ props }) => props.params === undefined), true);
  assert.deepEqual(
    expressionHelperTargets.map(({ children }) => children
      .filter(({ type }) => type === 'param')
      .map(({ props }) => [props.name, props.type])),
    [
      [['c', 'string']],
      [['node', 'number'], ['propNode', 'number[]']],
      [['id', 'number'], ['values', 'string[]']],
      [['id', 'number'], ['values', 'number[]']],
      [['parent', 'number'], ['nodeParent', 'number[]']],
      [['parent', 'number'], ['valueParent', 'number[]']],
    ],
  );
  assert.equal(expressionHelperLegacySiblings.length, 1);
  assert.equal(expressionHelperLegacySiblings.every(({ props, children }) =>
    typeof props.params === 'string' &&
    props.params.length > 0 &&
    children.every(({ type }) => type !== 'param')), true);
  const expressionHelperFunctions = receipt.functions.filter(({ id }) =>
    expressionHelperTargetNames.some((name) => id.endsWith(`:${name}`)) &&
    id.startsWith(`${expressionHelperPath}#`));
  assert.deepEqual(expressionHelperFunctions.map(({ id }) => id), [
    `${expressionHelperPath}#11:childcount`,
    `${expressionHelperPath}#13:valuechildcount`,
    `${expressionHelperPath}#1:validnext`,
    `${expressionHelperPath}#7:propcount`,
    `${expressionHelperPath}#8:stringat`,
    `${expressionHelperPath}#9:numberat`,
  ]);
  assert.equal(expressionHelperFunctions.every(({ excludedProperties }) =>
    !excludedProperties.includes('fn.params')), true);
  assert.equal(
    expressionHelperFunctions.flatMap(({ nodeOccurrences }) => nodeOccurrences)
      .filter((kind) => kind === 'param').length,
    11,
  );
  assert.deepEqual(
    expressionHelperFunctions.map(({ profileBlockers, profileRows }) => ({ profileBlockers, profileRows })),
    [
      { profileBlockers: [], profileRows: { nodes: 9, properties: 17, values: 71 } },
      { profileBlockers: [], profileRows: { nodes: 9, properties: 17, values: 71 } },
      { profileBlockers: [], profileRows: { nodes: 6, properties: 9, values: 53 } },
      { profileBlockers: [], profileRows: { nodes: 9, properties: 17, values: 71 } },
      { profileBlockers: [], profileRows: { nodes: 5, properties: 9, values: 50 } },
      { profileBlockers: [], profileRows: { nodes: 5, properties: 9, values: 54 } },
    ],
  );

  const statementHelperPath = 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern';
  const statementHelperSource = readFileSync(new URL(`../../${statementHelperPath}`, import.meta.url), 'utf8');
  const statementHelperDocument = parseDocumentWithDiagnostics(statementHelperSource);
  assert.deepEqual(statementHelperDocument.diagnostics, []);
  const statementHelperRoots = statementHelperDocument.root.children.filter(({ type }) => type === 'fn');
  const indentation = statementHelperRoots.find(({ props }) => props.name === 'indentation');
  assert.equal(statementHelperSource.split('\n').length - 1, 182);
  assert.equal(indentation?.props.params, undefined);
  assert.deepEqual(
    indentation?.children.filter(({ type }) => type === 'param').map(({ props }) => [props.name, props.type]),
    [['level', 'number']],
  );
  assert.equal(statementHelperRoots.filter(({ props }) =>
    !['indentation', 'emitstatementlist'].includes(props.name)).every(({ props, children }) =>
    typeof props.params === 'string' &&
    props.params.length > 0 &&
    children.every(({ type }) => type !== 'param')), true);
  const indentationFact = receipt.functions.find(({ id }) =>
    id === `${statementHelperPath}#0:indentation`);
  assert.equal(indentationFact?.excludedProperties.includes('fn.params'), false);
  assert.equal(indentationFact?.nodeOccurrences.filter((kind) => kind === 'param').length, 1);
  assert.deepEqual(
    { profileBlockers: indentationFact?.profileBlockers, profileRows: indentationFact?.profileRows },
    { profileBlockers: [], profileRows: { nodes: 7, properties: 14, values: 42 } },
  );
}
