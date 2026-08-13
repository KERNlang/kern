import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadKernFormatterAssets } from '../../packages/cli/dist/kern-formatter-assets.js';

const RUNNER = fileURLToPath(new URL('../../packages/cli/dist/kern-formatter-cli.js', import.meta.url));

function run(input) {
  return spawnSync(process.execPath, [RUNNER], { encoding: null, input, maxBuffer: 8 * 1024 * 1024 });
}

function result(completed) {
  assert.equal(completed.signal, null);
  assert.equal(completed.stderr.toString('utf8'), '');
  return JSON.parse(completed.stdout.toString('utf8'));
}

test('private runner owns subprocess exits 0 formatted and 2 failure', () => {
  const formatted = run(JSON.stringify({ format: 'kern.formatter.request.1', source: 'x   ' }));
  assert.equal(formatted.status, 0);
  assert.equal(result(formatted).source, 'x\n');

  const failed = run(JSON.stringify({ format: 'kern.formatter.request.future', source: 'x' }));
  assert.equal(failed.status, 2);
  assert.equal(result(failed).outcome, 'failure');
});

test('raw oversized and malformed UTF-8 transports fail before JSON decoding', () => {
  const limit = loadKernFormatterAssets().policy.profileLimits.maxInputBytes;
  const oversized = run(Buffer.alloc(limit + 1, 0x20));
  assert.equal(oversized.status, 2);
  assert.match(result(oversized).diagnostics[0].message, /stdin exceeds maxInputBytes/u);

  const malformed = run(Buffer.from([0xff]));
  assert.equal(malformed.status, 2);
  const malformedResult = result(malformed);
  assert.equal(malformedResult.outcome, 'failure');
  assert.equal(malformedResult.diagnostics[0].message, 'KERN formatter internal contract rejection');
});

test('importing the runner has no stdin or process-exit side effects', () => {
  const imported = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(RUNNER).href)})`],
    { encoding: 'utf8', input: '' },
  );
  assert.equal(imported.status, 0);
  assert.equal(imported.stderr, '');
  assert.equal(imported.stdout, '');
});

test('Unicode line separators stay inside one escaped NDJSON record', () => {
  const source = 'text value="line\u2028paragraph\u2029"\n';
  const completed = run(JSON.stringify({ format: 'kern.formatter.request.1', source }));
  assert.equal(completed.status, 0);
  const stdout = completed.stdout.toString('utf8');
  assert.equal(stdout.includes('\u2028'), false);
  assert.equal(stdout.includes('\u2029'), false);
  assert.equal(stdout.split('\n').length, 2);
  assert.equal(JSON.parse(stdout).source, source);
});
