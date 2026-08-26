import assert from 'node:assert/strict';
import test from 'node:test';

import { spawn } from 'node:child_process';

import {
  createBoundedTailCollector,
  failureExcerpt,
  MAX_CHILD_OUTPUT_BYTES,
  MAX_FAILURE_DIAGNOSTIC_BYTES,
} from './diagnostics.mjs';

test('failed child TAP output retains the inner KRI-A11 diagnostic within a bounded excerpt', () => {
  const result = {
    stdout: [
      'TAP version 13',
      '# Subtest: packed consumer',
      'not ok 2 - KRI-A11 packed consumer exposes the public KIR preview API',
      '  ---',
      '  duration_ms: 17.2',
      '  type: test',
      '  location: /tmp/packed-consumer.test.mjs:220:1',
      '  failureType: testCodeFailure',
      '  error: |-',
      '    KRI-A11 contract missing: @kernlang/review/kir-preview does not export reviewKernModuleSets',
      '  code: ERR_ASSERTION',
      '  stack: |-',
      '    AssertionError: KRI-A11 contract missing',
      '  ...',
      '1..2',
      '# tests 2',
      '# fail 1',
    ].join('\n'),
    stderr: '',
  };

  const excerpt = failureExcerpt(result);

  assert.match(excerpt, /not ok 2 - KRI-A11 packed consumer/u);
  assert.match(excerpt, /does not export reviewKernModuleSets/u);
  assert.ok(Buffer.byteLength(excerpt, 'utf8') <= MAX_FAILURE_DIAGNOSTIC_BYTES);
});

test('failed child TAP output is redacted and capped before CI prints it', () => {
  const excerpt = failureExcerpt({
    stdout: [
      'not ok 1 - KRI-A11 packed consumer',
      '  ---',
      '  error: |-',
      '    apiKey: test-secret-value',
      ...Array.from({ length: 100 }, (_, index) => `    diagnostic ${index}: ${'x'.repeat(160)}`),
    ].join('\n'),
    stderr: '',
  });

  assert.match(excerpt, /apiKey: \[REDACTED\]/u);
  assert.doesNotMatch(excerpt, /test-secret-value/u);
  assert.ok(Buffer.byteLength(excerpt, 'utf8') <= MAX_FAILURE_DIAGNOSTIC_BYTES);
  assert.match(excerpt, /\[diagnostic excerpt truncated\]/u);
});

test('non-TAP build output keeps the trailing compiler failure and its context', () => {
  const result = {
    stdout: Array.from({ length: 201 }, (_, index) => (
      index === 198 ? "src/review.ts(42,7): error TS2307: Cannot find module '@kernlang/missing'" : `build progress ${index}`
    )).join('\n'),
    stderr: '',
  };

  const excerpt = failureExcerpt(result);

  assert.match(excerpt, /build progress 197/u);
  assert.match(excerpt, /TS2307: Cannot find module/u);
  assert.ok(excerpt.split('\n').length <= 80);
});

test('output beginning with ok always returns actionable output', () => {
  const excerpt = failureExcerpt({
    stdout: 'ok 1 - preliminary check\nerror TS2307: Cannot find module \'@kernlang/missing\'',
    stderr: '',
  });

  assert.notEqual(excerpt, 'no failure detail');
  assert.match(excerpt, /TS2307/u);
});

test('failure excerpts redact structured credentials and multiline secret values', () => {
  const excerpt = failureExcerpt({
    stdout: [
      'build failed:',
      '  {"token": "json token value"}',
      '  AWS_SECRET_ACCESS_KEY=space containing secret value',
      '  Authorization: Basic dXNlcjpwYXNzd29yZA==',
      '  https://user:password@example.test/registry',
      '  -----BEGIN PRIVATE KEY-----',
      '  super secret private material',
      '  -----END PRIVATE KEY-----',
      '  password: another space containing secret',
    ].join('\n'),
    stderr: '',
  });

  for (const secret of [
    'json token value',
    'space containing secret value',
    'dXNlcjpwYXNzd29yZA==',
    'user:password',
    'super secret private material',
    'another space containing secret',
  ]) assert.doesNotMatch(excerpt, new RegExp(secret, 'u'));
  assert.match(excerpt, /"token": "\[REDACTED\]"/u);
  assert.match(excerpt, /AWS_SECRET_ACCESS_KEY=\[REDACTED\]/u);
  assert.match(excerpt, /Authorization: Basic \[REDACTED\]/u);
  assert.match(excerpt, /https:\/\/\[REDACTED\]@example\.test\/registry/u);
  assert.match(excerpt, /-----BEGIN PRIVATE KEY-----\n\[REDACTED PRIVATE KEY\]\n-----END PRIVATE KEY-----/u);
  assert.match(excerpt, /password: \[REDACTED\]/u);
});

test('bounded child capture retains the trailing failure without retaining more than its cap', async () => {
  const collector = createBoundedTailCollector();
  const child = spawn(process.execPath, ['-e', [
    "process.stdout.write('x'.repeat(70 * 1024));",
    "process.stderr.write('y'.repeat(70 * 1024));",
    "process.stderr.write('\\nerror TS2307: trailing failure\\n');",
  ].join('')]);

  child.stdout.on('data', (chunk) => collector.stdout.append(chunk));
  child.stderr.on('data', (chunk) => collector.stderr.append(chunk));
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  assert.ok(collector.stdout.byteLength <= MAX_CHILD_OUTPUT_BYTES);
  assert.ok(collector.stderr.byteLength <= MAX_CHILD_OUTPUT_BYTES);
  assert.match(collector.stderr.text(), /TS2307: trailing failure/u);
});

test('a single append larger than the cap retains its exact trailing bytes', () => {
  const collector = createBoundedTailCollector(8);
  const output = 'discarded-prefix--END-MARK';

  collector.stdout.append(output);

  assert.equal(collector.stdout.byteLength, 8);
  assert.equal(collector.stdout.text(), output.slice(-8));
});

test('bounded collectors preserve exact order across wrapped chunks and small-buffer reads', () => {
  const collector = createBoundedTailCollector(5);

  collector.stdout.append('ab');
  assert.equal(collector.stdout.text(), 'ab');
  collector.stdout.append('cdef');
  assert.equal(collector.stdout.text(), 'bcdef');
  collector.stdout.append('ghi');

  assert.equal(collector.stdout.byteLength, 5);
  assert.equal(collector.stdout.text(), 'efghi');
});

test('failure excerpts redact bare auth tokens and RSA or EC private-key blocks', () => {
  const excerpt = failureExcerpt({
    stdout: [
      'Bearer bare-bearer-token',
      'Basic bare-basic-token',
      '-----BEGIN RSA PRIVATE KEY-----',
      'rsa private key material',
      '-----END RSA PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----',
      'ec private key material',
      '-----END EC PRIVATE KEY-----',
    ].join('\n'),
    stderr: '',
  });

  for (const secret of [
    'bare-bearer-token',
    'bare-basic-token',
    'rsa private key material',
    'ec private key material',
  ]) assert.doesNotMatch(excerpt, new RegExp(secret, 'u'));
  assert.match(excerpt, /Bearer \[REDACTED\]/u);
  assert.match(excerpt, /Basic \[REDACTED\]/u);
  assert.match(excerpt, /-----BEGIN RSA PRIVATE KEY-----\n\[REDACTED PRIVATE KEY\]\n-----END RSA PRIVATE KEY-----/u);
  assert.match(excerpt, /-----BEGIN EC PRIVATE KEY-----\n\[REDACTED PRIVATE KEY\]\n-----END EC PRIVATE KEY-----/u);
});

test('TAP failure excerpts retain their subtest header but exclude the following result', () => {
  const excerpt = failureExcerpt({
    stdout: [
      'TAP version 13',
      '# Subtest: retains the relevant failure context',
      'not ok 1 - failing assertion',
      '  error: expected true',
      'ok 2 - following successful test',
      '# tests 2',
    ].join('\n'),
    stderr: '',
  });

  assert.match(excerpt, /# Subtest: retains the relevant failure context/u);
  assert.match(excerpt, /not ok 1 - failing assertion/u);
  assert.match(excerpt, /error: expected true/u);
  assert.doesNotMatch(excerpt, /following successful test/u);
});
