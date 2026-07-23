import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';

import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M465_PARAMETER_MIGRATION_TARGETS = [
  {
    bodyDigest: 'c59ee3eaea805e80363c3ce62b8ab4af3786f77fda9364f94eaa5d47d75b511b',
    exported: false,
    functionOrdinal: 1,
    id: 'examples/capstone-checker-subset/checker-while.kern#1:isSafeMagnitude',
    name: 'isSafeMagnitude',
    parameters: [['raw', 'string'], ['start', 'number']],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 27, properties: 39, values: 288 },
    returns: 'boolean',
  },
  {
    bodyDigest: '072e5e4f3e8d483b5f86db3eb6b041a195cac734a65e30e66ccff9d7581999ba',
    exported: false,
    functionOrdinal: 21,
    id: 'examples/capstone-checker-subset/checker.kern#22:mapCallRejectDetail',
    name: 'mapCallRejectDetail',
    parameters: [
      ['callId', 'number'], ['callStmtKind', 'string[]'], ['callMemberProp', 'string[]'],
      ['callStmt', 'number[]'], ['callFn', 'string[]'], ['callMemberObject', 'string[]'],
      ['argCall', 'number[]'], ['argOrdinal', 'number[]'], ['argKind', 'string[]'],
      ['argName', 'string[]'], ['stmtKind', 'string[]'], ['stmtFn', 'string[]'],
      ['stmtTarget', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 28, properties: 42, values: 309 },
    returns: 'string',
  },
  {
    bodyDigest: '396cb0c68e779689979d21d774a27db0df5cd05588b3a3f469bc05de3a25dd87',
    exported: true,
    functionOrdinal: 10,
    id: 'examples/selfhost-validator/validator.kern#10:fnokat',
    name: 'fnokat',
    parameters: [
      ['idx', 'number'], ['fnName', 'string[]'], ['fnReturns', 'string[]'],
      ['fnAsync', 'number[]'], ['fnStream', 'number[]'], ['fnHandlers', 'number[]'],
      ['fnParams', 'string[]'], ['paramFn', 'number[]'],
    ],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 28, properties: 38, values: 270 },
    returns: 'boolean',
  },
  {
    bodyDigest: 'b9939d73ba23e8e52beb618584d80074a5ada3248914f12bc0fe2505d76be083',
    exported: true,
    functionOrdinal: 12,
    id: 'examples/selfhost-validator/validator.kern#12:ownexportkind',
    name: 'ownexportkind',
    parameters: [
      ['module', 'number'], ['name', 'string'], ['fnModule', 'number[]'],
      ['fnName', 'string[]'], ['fnReturns', 'string[]'], ['fnAsync', 'number[]'],
      ['fnStream', 'number[]'], ['fnHandlers', 'number[]'], ['fnParams', 'string[]'],
      ['fnExport', 'number[]'], ['paramFn', 'number[]'], ['classModule', 'number[]'],
      ['className', 'string[]'], ['classExport', 'number[]'],
    ],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 28, properties: 48, values: 260 },
    returns: 'string',
  },
];

const FILE_CONTRACTS = new Map([
  ['examples/capstone-checker-subset/checker-while.kern', {
    lines: 303,
    remainingLegacy: [
      'numericBindingProven', 'lengthReceiverProven', 'comparisonOperandsOk', 'checkWhileCore',
    ],
    roots: 18,
    sha256: '84ca20346a655595cbaab095e3b46b964e46acabd90ead29d1d1a3c6813e8b60',
  }],
  ['examples/capstone-checker-subset/checker.kern', {
    lines: 448,
    remainingLegacy: [
      'rejectLine', 'argProvenanced', 'paramCallsitesOk',
      'indexRejectDetail', 'mapKeyToken', 'mapKnownBefore', 'callRejectCode', 'checkModule',
    ],
    roots: 24,
    sha256: 'a703952e717a77015179987a4e5a6940b0b16846a9c122810e959a595eee5017',
  }],
  ['examples/selfhost-validator/validator.kern', {
    lines: 536,
    remainingLegacy: ['isreserved', 'exportkind', 'validate'],
    roots: 21,
    sha256: 'a9d278832edf050f3a96699980d88fa740f345d85192222b241bb6cc3ac2a2ee',
  }],
]);

const GENERATED_ARTIFACTS = new Map([
  ['examples/capstone-assertion-engine/main.kern',
    'a9df3dca6aa1eb6aa705446e4bb37ee7934ce507fb059e791ca42ed624cc9a03'],
  ['examples/capstone-checker-subset/main.kern',
    'c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
  ['examples/selfhost-validator/main.kern',
    '9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7'],
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    '94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56'],
  ['scripts/kern-canonicalizer/composition.json',
    'cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertM465ParameterTarget(root, fact, target) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
  assert.equal(root.props.export, target.exported ? 'true' : undefined);
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

export function assertM465ParameterMigrations(receipt) {
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

    for (const target of M465_PARAMETER_MIGRATION_TARGETS.filter((entry) => entry.path === path)) {
      const fact = receipt.functions.find(({ id }) => id === target.id);
      assertM465ParameterTarget(roots[target.functionOrdinal], fact, target);
    }
  }

  assert.equal(
    M465_PARAMETER_MIGRATION_TARGETS.reduce((sum, target) => sum + target.parameters.length, 0),
    37,
  );
  for (const [path, digest] of GENERATED_ARTIFACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
}
