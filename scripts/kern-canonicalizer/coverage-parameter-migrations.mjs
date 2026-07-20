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
  const checkerWhileTargetNames = ['isDecimalDigit', 'isLiteralKind', 'literalToken'];
  const checkerWhileTargets = checkerWhileRoots.filter(({ props }) =>
    checkerWhileTargetNames.includes(props.name));
  const checkerWhileLegacySiblings = checkerWhileRoots.filter(({ props }) =>
    !checkerWhileTargetNames.includes(props.name));
  assert.equal(checkerWhileSource.split('\n').length - 1, 256);
  assert.equal(checkerWhileRoots.length, 18);
  assert.deepEqual(checkerWhileTargets.map(({ props }) => props.name), checkerWhileTargetNames);
  assert.equal(checkerWhileTargets.every(({ props }) => props.params === undefined), true);
  assert.deepEqual(
    checkerWhileTargets.map(({ children }) => children
      .filter(({ type }) => type === 'param')
      .map(({ props }) => [props.name, props.type])),
    [
      [['ch', 'string']],
      [['kind', 'string']],
      [['kind', 'string'], ['name', 'string'], ['num', 'string']],
    ],
  );
  assert.equal(checkerWhileLegacySiblings.length, 15);
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
  ]);
  assert.equal(checkerWhileFunctions.every(({ excludedProperties }) =>
    !excludedProperties.includes('fn.params')), true);
  assert.equal(
    checkerWhileFunctions.flatMap(({ nodeOccurrences }) => nodeOccurrences)
      .filter((kind) => kind === 'param').length,
    5,
  );
  assert.deepEqual(
    checkerWhileFunctions.map(({ profileBlockers, profileRows }) => ({ profileBlockers, profileRows })),
    [
      { profileBlockers: [], profileRows: { nodes: 8, properties: 10, values: 43 } },
      { profileBlockers: [], profileRows: { nodes: 4, properties: 6, values: 67 } },
      { profileBlockers: [], profileRows: { nodes: 10, properties: 14, values: 49 } },
    ],
  );
}
