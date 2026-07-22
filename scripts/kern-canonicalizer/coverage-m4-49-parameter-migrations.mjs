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
    lines: 401,
    remainingLegacy: [
      'rejectLine', 'isSurfaceKind', 'whileRejectDetail', 'termProvenanced',
      'argProvenanced', 'paramCallsitesOk', 'indexRejectDetail', 'mapKeyToken',
      'mapKnownBefore', 'mapCallRejectDetail', 'callRejectCode', 'checkModule',
    ],
    roots: 24,
    sha256: '8183f4448fcc1f59d80f29f163ab1165e7a95105f6b2411f6a8ff7080dbfa8a6',
  }],
  ['examples/kern-canonicalizer/canonicalizer-expression-helpers.kern', {
    lines: 192,
    remainingLegacy: ['quotesource'],
    roots: 16,
    sha256: 'ffd3f352a7137d846e23a701672b91f99159d624027abaddb2f1408338544541',
  }],
  ['examples/selfhost-validator/validator.kern', {
    lines: 501,
    remainingLegacy: [
      'isreserved', 'fnokat', 'owncallable', 'ownexportkind', 'exportkind',
      'sortstrings', 'validate',
    ],
    roots: 21,
    sha256: 'd648518028d33df00a3a2c49d9c93c398076b529bd33d01d5d0fe71fbb09b17f',
  }],
]);

const GENERATED_ARTIFACT_CONTRACTS = new Map([
  ['examples/capstone-checker-subset/main.kern',
    'ff961e9e6c3796f8b21ae0622f8fe8c779f4734603e3a31db2b02b2f155aaea2'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    '9ef2e9f787f91efec3deb06ff07b11bf2093a07aa1301d59fda3551dc80d4bb5'],
  ['examples/kern-canonicalizer/canonicalizer.kern',
    'a04ae8f9af4f61c1560889277247963572de6a1c32c2f2cf63e4c341525b7019'],
  ['examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
    '475ec6bcaa3bcc3610a1dcb64cfa9175ee8faf00a20d458586b2003fd7009314'],
  ['scripts/kern-canonicalizer/composition.json',
    '708ea2c648dd2f8cf76aa5ac7fb89c609f54406a8da5b5ce4c33d92233c1e441'],
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
