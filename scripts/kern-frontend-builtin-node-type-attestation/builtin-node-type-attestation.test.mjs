import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import {
  executeFrontendBuiltinNodeTypeAttestation,
  executeNativeBuiltinNodeTypeAttestationFields,
  loadBuiltinNodeTypeAttestationSource,
  validateNativeBuiltinNodeTypeAttestationSource,
} from '../check-kern-frontend-builtin-node-type-attestation.mjs';
import { BUILTIN_ATTESTATION_FIXTURES, MUTABLE_REGISTRY_NAMES } from './fixtures.mjs';
import {
  extractBuiltinNodeTypes,
  loadBuiltinNodeCatalog,
  renderBuiltinNodeCatalog,
  renderBuiltinNodeKern,
  validateBuiltinNodeCatalog,
  writeBuiltinNodeCatalogFiles,
} from './catalog.mjs';
import { normalizeBuiltinNodeTypeAttestationOracle } from './oracle.mjs';
import {
  loadFrontendBuiltinNodeTypeAttestationPolicy,
  validateFrontendBuiltinNodeTypeAttestationPolicy,
} from './policy.mjs';

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function mutate(source, from, to, occurrence = 0) {
  let cursor = -1;
  let searchStart = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    cursor = source.indexOf(from, searchStart);
    assert.notEqual(cursor, -1, `mutation target occurrence ${occurrence} missing: ${from}`);
    searchStart = cursor + from.length;
  }
  return `${source.slice(0, cursor)}${to}${source.slice(cursor + from.length)}`;
}

function mutateAttestationMember(source, from, to, occurrence = 0) {
  const memberStart = source.lastIndexOf('fn name=attestationfailure');
  assert.notEqual(memberStart, -1, 'M4.161 member is missing');
  return `${source.slice(0, memberStart)}${mutate(source.slice(memberStart), from, to, occurrence)}`;
}

function unknownWarning(source, runtime) {
  return parseDocumentWithDiagnostics(source, runtime).diagnostics.some(({ code }) => code === 'UNKNOWN_NODE_TYPE');
}

test('native attestation matches the independent immutable-catalog oracle', () => {
  const policy = loadFrontendBuiltinNodeTypeAttestationPolicy();
  const source = loadBuiltinNodeTypeAttestationSource();
  for (const fixture of BUILTIN_ATTESTATION_FIXTURES) {
    assert.deepEqual(
      executeFrontendBuiltinNodeTypeAttestation(fixture.source, policy, source),
      normalizeBuiltinNodeTypeAttestationOracle(fixture.source, policy),
      fixture.id,
    );
  }
});

test('positive membership carries the exact canonical catalog index', () => {
  const catalog = loadBuiltinNodeCatalog();
  for (const type of ['screen', 'fn', 'route', 'expression-v1']) {
    const result = executeFrontendBuiltinNodeTypeAttestation(type);
    assert.equal(result.attestation, 'builtin');
    assert.equal(result.catalogIndex, catalog.indexOf(type));
  }
  const normalized = executeFrontendBuiltinNodeTypeAttestation('evolved:text');
  assert.equal(normalized.admittedType, 'text');
  assert.equal(normalized.catalogIndex, catalog.indexOf('text'));
});

test('negative immutable membership is unresolved, never unknown or rejected', () => {
  for (const source of ['mystery', 'Text', 'textual', 'mytext', 'tuple', 'evolved:widget']) {
    const result = executeFrontendBuiltinNodeTypeAttestation(source);
    assert.equal(result.status, 'admitted', source);
    assert.equal(result.attestation, 'unresolved', source);
    assert.equal(result.catalogIndex, null, source);
  }
});

test('mutable runtime registries change bootstrap knownness but not immutable attestation', () => {
  for (const [kind, name] of Object.entries(MUTABLE_REGISTRY_NAMES)) {
    const runtime = new KernRuntime();
    const baseline = executeFrontendBuiltinNodeTypeAttestation(name);
    assert.equal(baseline.attestation, 'unresolved');
    assert.equal(unknownWarning(name, runtime), true, kind);
    if (kind === 'dynamic') runtime.registerEvolvedType(name);
    if (kind === 'multiline') runtime.multilineBlockTypes.add(name);
    if (kind === 'template') runtime.templateRegistry.set(name, {});
    assert.equal(unknownWarning(name, runtime), false, kind);
    assert.deepEqual(executeFrontendBuiltinNodeTypeAttestation(name), baseline, kind);
  }
});

test('dropped and inherited failures remain atomic and never become unresolved', () => {
  for (const source of ['  text', '@ text', '"😀" text # payload']) {
    const result = executeFrontendBuiltinNodeTypeAttestation(source);
    assert.equal(result.status, 'dropped');
    assert.equal(result.attestation, 'none');
    assert.equal(result.catalogIndex, null);
  }
  assert.deepEqual(executeFrontendBuiltinNodeTypeAttestation(''), failure('EMPTY_RETAINED_CODE'));
  assert.deepEqual(executeFrontendBuiltinNodeTypeAttestation('\ud800'), failure('MALFORMED_UTF16'));
});

test('catalog bytes are exact, ordered, unique, and statically source-bound', () => {
  const liveSource = String.raw`export const NODE_TYPES = ['a', 'b'] as const;`;
  const values = extractBuiltinNodeTypes(liveSource, 'packages/core/src/spec.ts');
  assert.deepEqual(values, ['a', 'b']);
  const json = Buffer.from(renderBuiltinNodeCatalog(values));
  const kern = Buffer.from(renderBuiltinNodeKern(values));
  assert.deepEqual(validateBuiltinNodeCatalog(json, kern, Buffer.from(liveSource)), values);
  assert.throws(() => extractBuiltinNodeTypes(`export const NODE_TYPES = ['a'];`, 'packages/core/src/spec.ts'), /const assertion/u);
  assert.throws(() => extractBuiltinNodeTypes(`export let NODE_TYPES = ['a'] as const;`, 'packages/core/src/spec.ts'), /const declaration/u);
  assert.throws(() => extractBuiltinNodeTypes(`export var NODE_TYPES = ['a'] as const;`, 'packages/core/src/spec.ts'), /const declaration/u);
  assert.throws(() => extractBuiltinNodeTypes(`export const NODE_TYPES = ['a', 'a'] as const;`, 'packages/core/src/spec.ts'), /unique/u);
  assert.throws(() => validateBuiltinNodeCatalog(Buffer.from(`${json} `), kern, Buffer.from(liveSource)), /catalog bytes/u);
  assert.throws(() => validateBuiltinNodeCatalog(json, Buffer.from(`${kern} `), Buffer.from(liveSource)), /KERN bytes/u);
});

test('generated KERN preserves quotes, backslashes, and controls in catalog strings', () => {
  const values = ['a"b', 'a\\b', 'line\nbreak'];
  const source = renderBuiltinNodeKern(values);
  const policy = loadFrontendBuiltinNodeTypeAttestationPolicy();
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [],
    identity: { handlerName: 'builtinnodetypes', sourcePath: 'generated-test.kern' },
    source,
  }, { enabled: true, limits: policy.runtimeLimits });
  assert.equal(envelope.outcome, 'success');
  assert.deepEqual(envelope.result.value, {
    tag: 'list', value: values.map((value) => ({ tag: 'text', value })),
  });
});

test('catalog write mode rejects symlink outputs without touching their targets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kern-builtin-catalog-'));
  try {
    const target = join(directory, 'target');
    const catalog = join(directory, 'catalog.json');
    const kern = join(directory, 'catalog.kern');
    writeFileSync(target, 'sentinel');
    symlinkSync(target, catalog);
    writeFileSync(kern, 'kern-sentinel');
    assert.throws(
      () => writeBuiltinNodeCatalogFiles(pathToFileURL(catalog), pathToFileURL(kern), ['a']),
      /pre-existing regular file/u,
    );
    assert.equal(readFileSync(target, 'utf8'), 'sentinel');
    assert.equal(readFileSync(kern, 'utf8'), 'kern-sentinel');
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('policy bounds catalog and complete inherited-auth output', () => {
  const policy = loadFrontendBuiltinNodeTypeAttestationPolicy();
  assert.equal(policy.builtinNodeCatalog.length, 302);
  assert.ok(policy.builtinNodeCatalog.length <= policy.maxCatalogEntries);
  assert.ok(policy.maxAttestationEnvelopeFields <= policy.runtimeLimits.maxCollectionLength);
  assert.throws(() => validateFrontendBuiltinNodeTypeAttestationPolicy({ format: policy.builtinNodeTypeAttestationFormat }), /exactly/u);
  assert.throws(
    () => validateFrontendBuiltinNodeTypeAttestationPolicy(
      { catalogFormat: policy.builtinNodeCatalogFormat, format: policy.builtinNodeTypeAttestationFormat,
        maxCatalogEntries: 1, sourceProfile: policy.builtinNodeTypeAttestationSourceProfile },
    ),
    /catalog exceeds/u,
  );
});

test('configured maximum input remains bounded with complete admission authentication', () => {
  const policy = loadFrontendBuiltinNodeTypeAttestationPolicy();
  const diagnosticTokenWidth = 2;
  const source = `${','.repeat(policy.profileLimits.maxTokens - policy.profileLimits.maxDiagnostics * diagnosticTokenWidth)}${
    '1.0n '.repeat(policy.profileLimits.maxDiagnostics)}`;
  const result = executeFrontendBuiltinNodeTypeAttestation(source, policy);
  assert.equal(result.status, 'dropped');
  assert.equal(result.inherited.decision.tokenCount, policy.profileLimits.maxTokens);
});

test('native source composes M4.160 and contains no parser or mutable-registry delegation', () => {
  const source = loadBuiltinNodeTypeAttestationSource();
  assert.match(source, /observenodetypetokenadmission/u);
  assert.match(source, /builtinnodetypes/u);
  assert.match(source, /observebuiltinnodetypeattestation/u);
  assert.doesNotMatch(source, /NODE_TYPES|isKnownNodeType|KernRuntime|UNKNOWN_NODE_TYPE|parseDocument/u);
  assert.throws(
    () => validateNativeBuiltinNodeTypeAttestationSource(source.replace('handler lang="kern"', 'handler')),
    /every source handler/u,
  );
});

test('named verdict, index, catalog, inherited-auth, dropped, and seal mutations are rejected', () => {
  const policy = loadFrontendBuiltinNodeTypeAttestationPolicy();
  const source = loadBuiltinNodeTypeAttestationSource();
  const cases = [
    ['constant builtin', 'assign target=attestation value="\\"unresolved\\""', 'assign target=attestation value="\\"builtin\\""', 'mystery', 0],
    ['wrong index', 'assign target=catalogIndex value="String(candidateIndex)"', 'assign target=catalogIndex value="String(candidateIndex + 1)"', 'text', 0],
    ['prefix match', 'catalog[candidateIndex] == admittedType', 'catalog[candidateIndex] == Text.slice(admittedType, 0, Text.length(catalog[candidateIndex]))', 'textual', 0],
    ['classify dropped', 'if cond="status == \\"admitted\\""', 'if cond="status == \\"admitted\\" || status == \\"dropped\\""', '@ text', 1],
    ['forge decision catalog count', 'out.push(String(catalog.length))', 'out.push(String(catalog.length + 1))', 'text', 0],
    ['forge seal catalog count', 'out.push(String(catalog.length))', 'out.push(String(catalog.length + 1))', 'text', 1],
    ['corrupt emitted inherited auth', 'out.push(admission[authStart + authField])', 'out.push(\\"forged-inherited-field\\")', 'text', 0],
    ['corrupt seal source', 'out.push(retainedSource)', 'out.push(content)', 'text # payload', 1],
  ];
  for (const [label, from, to, content, occurrence] of cases) {
    assert.throws(
      () => executeFrontendBuiltinNodeTypeAttestation(
        content, policy, mutateAttestationMember(source, from, to, occurrence),
      ),
      /record rejection|runtime rejection/u,
      label,
    );
  }
  const forgedUpstream = mutate(
    source, 'out.push(streamAuthField0)', 'out.push(\\"forged-upstream-field\\")', 0,
  );
  const nativeFailure = executeNativeBuiltinNodeTypeAttestationFields('text', policy, forgedUpstream);
  assert.equal(nativeFailure.length, 17);
  assert.deepEqual(nativeFailure.slice(0, 4), [policy.builtinNodeTypeAttestationFormat, 'failure', 'ATTESTATION_INVALID', '']);
  assert.ok(nativeFailure.slice(4).every((field) => field === ''));
  const forgedCatalog = mutate(source, 'values.push(\\"screen\\")', 'values.push(\\"forged-screen\\")');
  assert.throws(
    () => executeFrontendBuiltinNodeTypeAttestation('screen', policy, forgedCatalog),
    /record rejection|runtime rejection/u,
  );
});
