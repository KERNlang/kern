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
    lines: 303,
    remainingLegacy: [
      'numericBindingProven', 'lengthReceiverProven',
      'comparisonOperandsOk', 'checkWhileCore',
    ],
    roots: 18,
    sha256: '84ca20346a655595cbaab095e3b46b964e46acabd90ead29d1d1a3c6813e8b60',
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
    'd3f2634afd1a52d27a50748a94e25cad67870eb9b54adec329939935e8818645'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    '94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56'],
  ['examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    'ffd3f352a7137d846e23a701672b91f99159d624027abaddb2f1408338544541'],
  ['examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
    'adfa0c49cee230106ba7cff2249a0306f98aefc009d7e2581a3ffc622f6e9ff7'],
  ['scripts/kern-canonicalizer/composition.json',
    'cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995'],
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
