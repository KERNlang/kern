import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M449_PARAMETER_MIGRATION_TARGETS = [
  {
    bodyDigest: '39c146c913925457ec457895f4c52e8a7c3138ccbc26aa4fc281018f77080bfa',
    functionOrdinal: 11,
    id: 'examples/capstone-checker-subset/checker.kern#12:isIndexRebound',
    name: 'isIndexRebound',
    parameters: [
      ['fnName', 'string'], ['binding', 'string'], ['stmtKind', 'string[]'],
      ['stmtFn', 'string[]'], ['stmtName', 'string[]'], ['stmtTarget', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 17, properties: 26, values: 152 },
    returns: 'boolean',
  },
  {
    bodyDigest: 'f7881f6af604243aa53372ad92012fece7eada5ff720715036a0008145523fef',
    functionOrdinal: 8,
    id: 'examples/capstone-checker-subset/checker.kern#9:isUserCallable',
    name: 'isUserCallable',
    parameters: [
      ['name', 'string'], ['stmtKind', 'string[]'], ['stmtName', 'string[]'],
      ['stmtTarget', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 19, properties: 26, values: 185 },
    returns: 'boolean',
  },
  {
    bodyDigest: '5b9f89a40af34a1e9100162ccfe2ccffb95f460a5ce5b22c0b840cbea9e04e8b',
    functionOrdinal: 4,
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#4:validinteger',
    name: 'validinteger',
    parameters: [['value', 'string']],
    path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    profileRows: { nodes: 19, properties: 28, values: 290 },
    returns: 'boolean',
  },
  {
    bodyDigest: 'dc76caed49b207b6d6369ac259b51a05837b41ffa73cfb5beb83e11e634bb6f2',
    functionOrdinal: 3,
    id: 'examples/selfhost-validator/validator.kern#3:isportable',
    name: 'isportable',
    parameters: [['name', 'string']],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 18, properties: 24, values: 217 },
    returns: 'boolean',
  },
];

const FILE_CONTRACTS = new Map([
  ['examples/capstone-checker-subset/checker.kern', {
    lines: 448,
    remainingLegacy: [
      'rejectLine', 'argProvenanced', 'paramCallsitesOk',
      'indexRejectDetail', 'mapKeyToken',
      'mapKnownBefore', 'callRejectCode', 'checkModule',
    ],
    roots: 24,
    sha256: 'a703952e717a77015179987a4e5a6940b0b16846a9c122810e959a595eee5017',
  }],
  ['examples/kern-canonicalizer/canonicalizer-expression-helpers.kern', {
    lines: 213,
    remainingLegacy: ['quotesource'],
    roots: 17,
    sha256: '1a1ae1f95e20b458021bf78b82f6b0d1cbe639579fcdd64c6709f1c741ce35e4',
  }],
  ['examples/selfhost-validator/validator.kern', {
    lines: 536,
    remainingLegacy: [
      'isreserved', 'exportkind', 'validate',
    ],
    roots: 21,
    sha256: 'a9d278832edf050f3a96699980d88fa740f345d85192222b241bb6cc3ac2a2ee',
  }],
]);

const GENERATED_ARTIFACT_CONTRACTS = new Map([
  ['examples/capstone-checker-subset/main.kern',
    'c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    'fe5087dfcb79898a4b5d46cd233a2bbbeea156417f18ac314e87330172e31b28'],
  ['examples/kern-canonicalizer/canonicalizer.kern',
    'de5eb248401e933a05c7f55789a872f07c084c28e140f6561dd4205b71c57e00'],
  ['examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
    '158175ac9404fb93acc5b82fc8b87d10f2946a11b228ce9686f2423f75bcf667'],
  ['scripts/kern-canonicalizer/composition.json',
    '894cf14bc391d3109a20fb6abef8d1c98cab426e2ed6d238d414c8aee46cff3b'],
  ['examples/selfhost-validator/main.kern',
    '9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertM449ParameterTarget(root, fact, target) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
  assert.equal(root.__quotedProps?.includes('params') ?? false, false);
  assertDirectParameterPrefix(root, target.parameters);
  assert.equal(semanticBodyDigest(root), target.bodyDigest);

  assert.ok(fact);
  assert.equal(fact.id, target.id);
  assert.equal(fact.excludedProperties.includes('fn.params'), false);
  assert.deepEqual(fact.profileBlockers, []);
  assert.deepEqual(fact.profileRows, target.profileRows);
  assert.equal(
    fact.nodeOccurrences.filter((kind) => kind === 'param').length,
    target.parameters.length,
  );
}

export function assertM449ParameterMigrations(receipt) {
  const rootsByPath = new Map();
  for (const [path, contract] of FILE_CONTRACTS) {
    const sourceBytes = readFileSync(new URL(`../../${path}`, import.meta.url));
    const source = sourceBytes.toString('utf8');
    const document = parseDocumentWithDiagnostics(source);
    assert.deepEqual(document.diagnostics, []);
    assert.equal(sha256(sourceBytes), contract.sha256);
    assert.equal(source.split('\n').length - 1, contract.lines);
    const roots = document.root.children.filter(({ type }) => type === 'fn');
    assert.equal(roots.length, contract.roots);
    assert.deepEqual(
      roots.filter(({ props }) => typeof props.params === 'string').map(({ props }) => props.name),
      contract.remainingLegacy,
    );
    rootsByPath.set(path, roots);
  }

  let migratedRows = 0;
  for (const target of M449_PARAMETER_MIGRATION_TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    const fact = receipt.functions.find(({ id }) => id === target.id);
    assertM449ParameterTarget(root, fact, target);
    migratedRows += target.parameters.length;
  }
  assert.equal(migratedRows, 12);

  for (const [path, digest] of GENERATED_ARTIFACT_CONTRACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
}
