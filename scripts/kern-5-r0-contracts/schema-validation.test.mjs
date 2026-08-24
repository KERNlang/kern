import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { validateClosedSchema } from './schema-validator.mjs';

const DIRECTORY = resolve(fileURLToPath(new URL('.', import.meta.url)));
const SCHEMA = (name) => JSON.parse(readFileSync(resolve(DIRECTORY, 'schema', `${name}.json`), 'utf8'));

test('closed R0 target artifact schema rejects extra, missing, and wrong-typed fields', () => {
  const value = {
    artifacts: [{ executable: true, mediaType: 'text/javascript', path: 'hash/javascript-esm/main.mjs', sha256: 'a'.repeat(64) }],
    capabilities: [{ namespace: 'r0fixture', operation: 'resolve' }],
    compilerRequestSha256: 'b'.repeat(64),
    entry: { handlerName: 'compose', moduleId: 'r0/compose.kern' },
    format: 'kern.target.artifact.r0',
    kirSha256: 'c'.repeat(64),
    runtimeAbi: 'kern.runtime.kir.r0',
    semanticSha256: 'd'.repeat(64),
    target: 'javascript-esm',
  };
  assert.deepEqual(validateClosedSchema(SCHEMA('target-artifact'), value), []);
  assert.notDeepEqual(validateClosedSchema(SCHEMA('target-artifact'), { ...value, injected: true }), []);
  const { target, ...missing } = value;
  assert.notDeepEqual(validateClosedSchema(SCHEMA('target-artifact'), missing), []);
  assert.notDeepEqual(validateClosedSchema(SCHEMA('target-artifact'), { ...value, capabilities: 'r0fixture.resolve' }), []);
});

test('closed R0 runtime schemas reject added fields and wrong primitive types', () => {
  const request = {
    arguments: { text: 'input', textList: ['a'] }, artifactManifestSha256: 'a'.repeat(64), capabilityTranscript: [],
    control: { cancelAtTick: null, preCancelled: false, timeoutTicks: null }, entry: { handlerName: 'compose', moduleId: 'r0/compose.kern' },
    format: 'kern.runtime.kir.r0', kirSha256: 'b'.repeat(64), limits: { maxBytes: 1, maxCollectionLength: 1, maxDepth: 1, maxDiagnostics: 1, maxEvents: 1, maxStringBytes: 1 }, requestId: 'request',
  };
  assert.deepEqual(validateClosedSchema(SCHEMA('runtime-request'), request), []);
  assert.notDeepEqual(validateClosedSchema(SCHEMA('runtime-request'), { ...request, extra: null }), []);
  assert.notDeepEqual(validateClosedSchema(SCHEMA('runtime-request'), { ...request, requestId: 7 }), []);
  assert.notDeepEqual(validateClosedSchema(SCHEMA('runtime-request'), { ...request, control: { cancelAtTick: 1, preCancelled: false, timeoutTicks: 1 } }), []);
  assert.notDeepEqual(validateClosedSchema(SCHEMA('runtime-request'), { ...request, capabilityTranscript: [{ delayTicks: 0, input: { presence: 'absent' }, namespace: 'r0fixture', operation: 'resolve', result: { presence: 'value', value: { tag: 'integer', value: '9007199254740992' } } }] }), []);
  for (const value of [{ tag: 'text', value: true }, { tag: 'boolean', value: 'true' }, { tag: 'integer', value: false }, { tag: 'integer', value: '01' }]) {
    assert.notDeepEqual(validateClosedSchema(SCHEMA('runtime-request'), { ...request, capabilityTranscript: [{ delayTicks: 0, input: { presence: 'absent' }, namespace: 'r0fixture', operation: 'resolve', result: { presence: 'value', value } }] }), [], `rejects malformed ${value.tag} portable value`);
  }
  for (const key of Object.keys(request.limits)) {
    assert.notDeepEqual(validateClosedSchema(SCHEMA('runtime-request'), { ...request, limits: { ...request.limits, [key]: 9007199254740992 } }), [], `rejects unsafe ${key}`);
  }
  assert.deepEqual(validateClosedSchema(SCHEMA('runtime-request'), { ...request, control: { cancelAtTick: 0, preCancelled: false, timeoutTicks: null } }), []);
  assert.deepEqual(validateClosedSchema(SCHEMA('runtime-request'), { ...request, control: { cancelAtTick: null, preCancelled: false, timeoutTicks: 0 } }), []);
  assert.notDeepEqual(validateClosedSchema(SCHEMA('runtime-request'), { ...request, limits: { ...request.limits, injected: 1 } }), []);
  assert.notDeepEqual(validateClosedSchema(SCHEMA('runtime-request'), { ...request, requestId: '' }), []);
});

test('every R0 schema accepts its representative production shape and rejects hostile shape drift', () => {
  const values = {
    'compiler-request': {
      entry: { handlerName: 'compose', moduleId: 'r0/compose.kern' }, format: 'kern.compiler.request.r0',
      kir: { bytesHex: '00', format: 'kern.kir.v1', sha256: 'a'.repeat(64) }, runtimeAbi: 'kern.runtime.kir.r0', target: 'python',
    },
    'compiler-result': {
      artifact: { path: 'hash/python/main.py', sha256: 'a'.repeat(64) }, compilerRequestSha256: 'b'.repeat(64),
      format: 'kern.compiler.result.r0', manifest: { path: 'hash/python/manifest.json', sha256: 'c'.repeat(64) }, target: 'python',
    },
    'runtime-envelope': {
      completion: { kind: 'error' }, diagnostics: [{ category: 'runtime', code: 'capability-error', phase: 'execution' }],
      events: [], format: 'kern.runtime.kir.r0', outcome: 'failure', requestId: null, result: { presence: 'absent' },
    },
  };
  for (const [name, value] of Object.entries(values)) {
    assert.deepEqual(validateClosedSchema(SCHEMA(name), value), [], `${name} representative value`);
    assert.notDeepEqual(validateClosedSchema(SCHEMA(name), { ...value, injected: true }), [], `${name} extra field`);
    const [removed] = Object.keys(value);
    const { [removed]: _, ...missing } = value;
    assert.notDeepEqual(validateClosedSchema(SCHEMA(name), missing), [], `${name} missing field`);
  }
  assert.notDeepEqual(validateClosedSchema(SCHEMA('compiler-request'), { ...values['compiler-request'], target: 1 }), []);
  assert.notDeepEqual(validateClosedSchema(SCHEMA('compiler-result'), { ...values['compiler-result'], artifact: 'wrong' }), []);
  assert.notDeepEqual(validateClosedSchema(SCHEMA('runtime-envelope'), { ...values['runtime-envelope'], requestId: 1 }), []);
});
