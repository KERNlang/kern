import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';

export function assertStructuredParameterMigrations(receipt) {
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
        profileBlockers: ['profile.rows.nodes', 'profile.rows.properties', 'profile.rows.values'],
        profileRows: { nodes: 29, properties: 44, values: 493 },
      },
      { profileBlockers: ['profile.rows.values'], profileRows: { nodes: 16, properties: 29, values: 197 } },
    ],
  );

  const checkerWhilePath = 'examples/capstone-checker-subset/checker-while.kern';
  const checkerWhileSource = readFileSync(new URL(`../../${checkerWhilePath}`, import.meta.url), 'utf8');
  const checkerWhileDocument = parseDocumentWithDiagnostics(checkerWhileSource);
  assert.deepEqual(checkerWhileDocument.diagnostics, []);
  const checkerWhileRoots = checkerWhileDocument.root.children.filter(({ type }) => type === 'fn');
  const checkerWhileTargetNames = ['isDecimalDigit', 'isPositiveSafeIntText', 'isLiteralKind', 'literalToken'];
  const checkerWhileTargets = checkerWhileRoots.filter(({ props }) =>
    checkerWhileTargetNames.includes(props.name));
  const checkerWhileLegacySiblings = checkerWhileRoots.filter(({ props }) =>
    !checkerWhileTargetNames.includes(props.name));
  assert.equal(checkerWhileSource.split('\n').length - 1, 257);
  assert.equal(checkerWhileRoots.length, 18);
  assert.deepEqual(checkerWhileTargets.map(({ props }) => props.name), checkerWhileTargetNames);
  assert.equal(checkerWhileTargets.every(({ props }) => props.params === undefined), true);
  assert.deepEqual(
    checkerWhileTargets.map(({ children }) => children
      .filter(({ type }) => type === 'param')
      .map(({ props }) => [props.name, props.type])),
    [
      [['ch', 'string']],
      [['raw', 'string']],
      [['kind', 'string']],
      [['kind', 'string'], ['name', 'string'], ['num', 'string']],
    ],
  );
  assert.equal(checkerWhileLegacySiblings.length, 14);
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
    `${checkerWhilePath}#8:isPositiveSafeIntText`,
  ]);
  assert.equal(checkerWhileFunctions.every(({ excludedProperties }) =>
    !excludedProperties.includes('fn.params')), true);
  assert.equal(
    checkerWhileFunctions.flatMap(({ nodeOccurrences }) => nodeOccurrences)
      .filter((kind) => kind === 'param').length,
    6,
  );
  assert.deepEqual(
    checkerWhileFunctions.map(({ profileBlockers, profileRows }) => ({ profileBlockers, profileRows })),
    [
      { profileBlockers: [], profileRows: { nodes: 8, properties: 10, values: 43 } },
      { profileBlockers: [], profileRows: { nodes: 4, properties: 6, values: 67 } },
      { profileBlockers: [], profileRows: { nodes: 10, properties: 14, values: 49 } },
      { profileBlockers: [], profileRows: { nodes: 8, properties: 10, values: 70 } },
    ],
  );

  const checkerPath = 'examples/capstone-checker-subset/checker.kern';
  const checkerSource = readFileSync(new URL(`../../${checkerPath}`, import.meta.url), 'utf8');
  const checkerDocument = parseDocumentWithDiagnostics(checkerSource);
  assert.deepEqual(checkerDocument.diagnostics, []);
  const checkerRoots = checkerDocument.root.children.filter(({ type }) => type === 'fn');
  const checkerTargetNames = ['acceptLine', 'isSafeIntText', 'elseRejectDetail', 'isPrintNumberText'];
  const checkerTargets = checkerRoots.filter(({ props }) => checkerTargetNames.includes(props.name));
  const checkerLegacySiblings = checkerRoots.filter(({ props }) => !checkerTargetNames.includes(props.name));
  assert.equal(checkerSource.split('\n').length - 1, 360);
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
  assert.equal(checkerLegacySiblings.length, 20);
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
  const validatorTargetNames = ['charoknext', 'localname', 'failline'];
  const validatorTargets = validatorRoots.filter(({ props }) => validatorTargetNames.includes(props.name));
  const validatorLegacySiblings = validatorRoots.filter(({ props }) => !validatorTargetNames.includes(props.name));
  assert.equal(validatorSource.split('\n').length - 1, 471);
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
    ],
  );
  assert.equal(validatorLegacySiblings.length, 18);
  assert.equal(validatorLegacySiblings.every(({ props, children }) =>
    typeof props.params === 'string' &&
    props.params.length > 0 &&
    children.every(({ type }) => type !== 'param')), true);
  const validatorFunctions = receipt.functions.filter(({ id }) =>
    id.startsWith(`${validatorPath}#`) && validatorTargetNames.some((name) => id.endsWith(`:${name}`)));
  assert.deepEqual(validatorFunctions.map(({ id }) => id), [
    `${validatorPath}#1:charoknext`,
    `${validatorPath}#4:localname`,
    `${validatorPath}#5:failline`,
  ]);
  assert.equal(validatorFunctions.every(({ excludedProperties }) =>
    !excludedProperties.includes('fn.params')), true);
  assert.equal(
    validatorFunctions.flatMap(({ nodeOccurrences }) => nodeOccurrences)
      .filter((kind) => kind === 'param').length,
    6,
  );
  assert.deepEqual(
    validatorFunctions.map(({ profileBlockers, profileRows }) => ({ profileBlockers, profileRows })),
    [
      { profileBlockers: [], profileRows: { nodes: 8, properties: 11, values: 61 } },
      { profileBlockers: [], profileRows: { nodes: 7, properties: 11, values: 31 } },
      { profileBlockers: [], profileRows: { nodes: 6, properties: 11, values: 67 } },
    ],
  );

  const expressionHelperPath = 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern';
  const expressionHelperSource = readFileSync(new URL(`../../${expressionHelperPath}`, import.meta.url), 'utf8');
  const expressionHelperDocument = parseDocumentWithDiagnostics(expressionHelperSource);
  assert.deepEqual(expressionHelperDocument.diagnostics, []);
  const expressionHelperRoots = expressionHelperDocument.root.children.filter(({ type }) => type === 'fn');
  const expressionHelperTargets = expressionHelperRoots.filter(({ props }) => props.name === 'validnext');
  const expressionHelperLegacySiblings = expressionHelperRoots.filter(({ props }) => props.name !== 'validnext');
  assert.equal(expressionHelperSource.split('\n').length - 1, 166);
  assert.equal(expressionHelperRoots.length, 16);
  assert.deepEqual(expressionHelperTargets.map(({ props }) => props.name), ['validnext']);
  assert.equal(expressionHelperTargets.every(({ props }) => props.params === undefined), true);
  assert.deepEqual(
    expressionHelperTargets.map(({ children }) => children
      .filter(({ type }) => type === 'param')
      .map(({ props }) => [props.name, props.type])),
    [[['c', 'string']]],
  );
  assert.equal(expressionHelperLegacySiblings.length, 15);
  assert.equal(expressionHelperLegacySiblings.every(({ props, children }) =>
    typeof props.params === 'string' &&
    props.params.length > 0 &&
    children.every(({ type }) => type !== 'param')), true);
  const expressionHelperFunctions = receipt.functions.filter(({ id }) =>
    id === `${expressionHelperPath}#1:validnext`);
  assert.deepEqual(expressionHelperFunctions.map(({ id }) => id), [
    `${expressionHelperPath}#1:validnext`,
  ]);
  assert.equal(expressionHelperFunctions.every(({ excludedProperties }) =>
    !excludedProperties.includes('fn.params')), true);
  assert.equal(
    expressionHelperFunctions.flatMap(({ nodeOccurrences }) => nodeOccurrences)
      .filter((kind) => kind === 'param').length,
    1,
  );
  assert.deepEqual(
    expressionHelperFunctions.map(({ profileBlockers, profileRows }) => ({ profileBlockers, profileRows })),
    [{ profileBlockers: [], profileRows: { nodes: 6, properties: 9, values: 53 } }],
  );
}
