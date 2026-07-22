import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M445_PARAMETER_MIGRATION_TARGETS = [
  {
    bodyDigest: '6bb07b0387477b389d1d65d8e7e9a11669ea7574be3a5e2f4a49b547188fe026',
    functionOrdinal: 2,
    id: 'examples/capstone-checker-subset/checker-while.kern#2:checkerSafeIntText',
    name: 'checkerSafeIntText',
    parameters: [['raw', 'string']],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 14, properties: 20, values: 161 },
    returns: 'boolean',
  },
  {
    bodyDigest: 'f89118ca7fbca49d8abe04fb187f1cdca5484e7c9c49eaddd82a86ee079d748d',
    functionOrdinal: 1,
    id: 'examples/kern-canonicalizer/canonicalizer.kern#1:validbinaryop',
    name: 'validbinaryop',
    parameters: [['op', 'string']],
    path: 'examples/kern-canonicalizer/canonicalizer.kern',
    profileRows: { nodes: 12, properties: 15, values: 388 },
    returns: 'boolean',
  },
];

export const M445_PARAMETER_NAMES_BY_PATH = new Map();
for (const target of M445_PARAMETER_MIGRATION_TARGETS) {
  const names = M445_PARAMETER_NAMES_BY_PATH.get(target.path) ?? [];
  names.push(target.name);
  M445_PARAMETER_NAMES_BY_PATH.set(target.path, names);
}

const FILE_CONTRACTS = new Map([
  ['examples/capstone-checker-subset/checker-while.kern', {
    lines: 272,
    remainingLegacy: [
      'isSafeMagnitude', 'numericBindingProven', 'lengthReceiverProven', 'literalTrue',
      'comparisonOperandsOk', 'checkWhileCore', 'checkerWhileRejectDetail',
    ],
    roots: 18,
    sha256: '906b1190e1a5abceb5a7620182b8c11417d1da60b963956d3363466167a04a45',
  }],
  ['examples/kern-canonicalizer/canonicalizer.kern', {
    lines: 443,
    remainingLegacy: ['typesource', 'exprsource', 'tablesok', 'canonicalize'],
    roots: 5,
    sha256: 'a04ae8f9af4f61c1560889277247963572de6a1c32c2f2cf63e4c341525b7019',
  }],
]);

const GENERATED_ARTIFACT_CONTRACTS = new Map([
  ['examples/capstone-checker-subset/main.kern',
    'ff961e9e6c3796f8b21ae0622f8fe8c779f4734603e3a31db2b02b2f155aaea2'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    '9ef2e9f787f91efec3deb06ff07b11bf2093a07aa1301d59fda3551dc80d4bb5'],
  ['examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    'ffd3f352a7137d846e23a701672b91f99159d624027abaddb2f1408338544541'],
  ['examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
    '475ec6bcaa3bcc3610a1dcb64cfa9175ee8faf00a20d458586b2003fd7009314'],
  ['scripts/kern-canonicalizer/composition.json',
    '708ea2c648dd2f8cf76aa5ac7fb89c609f54406a8da5b5ce4c33d92233c1e441'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertM445ParameterTarget(root, fact, target) {
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

export function assertM445ParameterMigrations(receipt) {
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
  for (const target of M445_PARAMETER_MIGRATION_TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    const fact = receipt.functions.find(({ id }) => id === target.id);
    assertM445ParameterTarget(root, fact, target);
    migratedRows += target.parameters.length;
  }
  assert.equal(migratedRows, 2);

  for (const [path, digest] of GENERATED_ARTIFACT_CONTRACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
}
