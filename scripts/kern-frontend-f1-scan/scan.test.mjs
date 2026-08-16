import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPolicy } from './decoder.mjs';
import { FAILURE_FIXTURES, VALID_FIXTURES } from './fixtures.mjs';
import { rejectedMutations } from './mutations.mjs';
import { assertProductionSource, loadComposition, runScan } from './worker.mjs';

const WORKER = fileURLToPath(new URL('./worker.mjs', import.meta.url));

function roles(result, kind) {
  return result.decoded.records.filter((record) => record.kind === kind).map((record) => record.flags);
}

function splitmix64Fragments(count) {
  let state = 0x4b45524e354631n;
  const mask = (1n << 64n) - 1n;
  const atoms = ['a', ' ', '1', ',', '/route', '$theme', '@', '\n', '# c\n', '"q"', '{{x}}', '{x:y}', '<<<z>>>'];
  const fragments = [];
  for (let index = 0; index < count; index += 1) {
    state = (state + 0x9e3779b97f4a7c15n) & mask;
    let value = state;
    value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & mask;
    value ^= value >> 31n;
    fragments.push(atoms[Number(value % BigInt(atoms.length))]);
  }
  return fragments;
}

function subprocessScan(source) {
  const completed = spawnSync(process.execPath, [WORKER, Buffer.from(source).toString('base64')], {
    encoding: 'utf8',
    timeout: 180_000,
  });
  assert.equal(completed.error, undefined, `scanner subprocess wall: ${completed.error?.message ?? ''}`);
  assert.equal(completed.status, 0, completed.stderr);
  return JSON.parse(completed.stdout);
}

test('production F1 scanner assets exist in authenticated order', () => {
  const policy = loadPolicy();
  const loaded = loadComposition(policy);
  assert.equal(loaded.modules.length, 4);
  assert.ok(loaded.modules.every((module) => module.source.length > 0));
  assert.match(loaded.modules.at(-1).source, /fn name=scanf1records/u);
  assert.ok(policy.modules.every((path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').length > 0));
  assert.throws(() => loadComposition({ ...policy, modules: [...policy.modules].reverse() }), /module order/u);
  assert.throws(() => assertProductionSource('do value="parseDocument(source)"', 'mutant.kern'), /forbidden production authority/u);
  assert.throws(() => assertProductionSource('capability("parser-shadow")', 'mutant.kern'), /forbidden production authority/u);
  const decoderSource = readFileSync(new URL('./decoder.mjs', import.meta.url), 'utf8');
  assert.equal(decoderSource.match(/Array\.from\(source\)/gu)?.length, 1);
});

test('KERN scanner partitions valid physical source exactly', () => {
  const observedKinds = new Set();
  const observedCompositeFlags = new Set();
  for (const fixture of VALID_FIXTURES) {
    const result = runScan(fixture.source);
    assert.equal(result.decoded.status, 'scanned', fixture.id);
    assert.equal(result.decoded.records.map((record) => record.raw).join(''), fixture.source, fixture.id);
    for (const record of result.decoded.records) {
      observedKinds.add(record.kind);
      if (['quoted', 'expr', 'style', 'fenceMarker', 'fenceBody'].includes(record.kind)) {
        observedCompositeFlags.add(record.flags);
      }
    }
  }
  assert.equal(observedKinds.size, 15, [...observedKinds].sort().join(','));
  assert.deepEqual([...observedCompositeFlags].sort((left, right) => left - right), [1, 2, 3, 4, 6]);
});

test('bug fingerprints preserve physical newlines and composite roles', () => {
  const byId = Object.fromEntries(VALID_FIXTURES.map((fixture) => [fixture.id, runScan(fixture.source)]));
  assert.deepEqual(roles(byId['quote-middle'], 'quoted'), [1, 4, 6]);
  assert.deepEqual(roles(byId['expression-continuation'], 'expr'), [1, 4, 6]);
  assert.deepEqual(roles(byId['fence-inline'], 'fenceMarker'), [1, 2]);
  assert.deepEqual(roles(byId['fence-lines'], 'fenceMarker'), [1, 2]);
  assert.deepEqual(
    byId.comments.decoded.records.filter((record) => record.kind === 'comment').map((record) => record.raw),
    ['# full', '// tail'],
  );
  assert.equal(byId.comments.decoded.records.some((record) => record.raw === '//x' && record.kind === 'slash'), true);
  for (const result of Object.values(byId)) {
    for (const record of result.decoded.records.filter((entry) => entry.kind === 'newline')) {
      assert.ok(record.raw === '\n' || record.raw === '\r\n');
    }
  }
});

test('KERN scanner returns atomic first-failure dispositions', () => {
  for (const fixture of FAILURE_FIXTURES) {
    const result = runScan(fixture.source);
    assert.equal(result.decoded.status, 'failure', fixture.id);
    assert.equal(result.decoded.diagnostic.code, fixture.code, fixture.id);
    assert.deepEqual(result.decoded.records, [], fixture.id);
  }
  const late = runScan('view name=Late\n', { forceLateFailure: true });
  assert.equal(late.decoded.diagnostic.code, 'FORCED_LATE_FAILURE');
  assert.deepEqual(late.decoded.records, []);
});

test('exact source cap succeeds and cap-plus-one fails before classification', () => {
  const cap = loadPolicy().profileLimits.maxSourceScalars;
  const exact = runScan('a'.repeat(cap));
  assert.equal(exact.decoded.status, 'scanned');
  assert.equal(exact.decoded.sourceScalars, cap);
  const over = runScan('a'.repeat(cap + 1));
  assert.equal(over.decoded.status, 'failure');
  assert.equal(over.decoded.diagnostic.code, 'SOURCE_LIMIT');
  assert.deepEqual(over.decoded.records, []);
});

test('frozen splitmix64 10k-fragment corpus is deterministic and lossless', () => {
  const fragments = splitmix64Fragments(10_000);
  assert.equal(fragments.length, 10_000);
  const source = fragments.join('');
  assert.ok(Array.from(source).length <= loadPolicy().profileLimits.maxSourceScalars);
  const first = runScan(source);
  const second = runScan(source);
  assert.equal(first.decoded.status, 'scanned');
  assert.deepEqual(second.fields, first.fields);
  assert.equal(first.decoded.records.map((record) => record.raw).join(''), source);
});

test('strict decoder rejects semantic, framing, state, and atomicity mutations', () => {
  const source = 'text value="x"\nhandler <<<z>>>\n';
  const run = runScan(source);
  assert.deepEqual(rejectedMutations(run.fields, source, loadPolicy()), [
    'class-drift',
    'constant-output',
    'drop-record',
    'duplicate-record',
    'flag-drift',
    'kind-drift',
    'marker-drift',
    'noncanonical-count',
    'partial-failure',
    'reorder-record',
    'span-drift',
    'swallowed-newline',
  ]);
});

test('1x/2x/4x/8x scanner corpora satisfy adjacent and absolute walls', () => {
  const limits = loadPolicy().profileLimits;
  const measurements = [4_096, 8_192, 16_384, 32_768].map((size) => subprocessScan('a '.repeat(size / 2)));
  for (const measurement of measurements) {
    assert.equal(measurement.status, 'scanned');
    assert.ok(measurement.elapsedMs <= limits.maxElapsedMs, JSON.stringify(measurement));
  }
  for (let index = 1; index < measurements.length; index += 1) {
    assert.ok(
      measurements[index].elapsedMs <=
        measurements[index - 1].elapsedMs * limits.scalingMultiplier + limits.scalingSlackMs,
      JSON.stringify(measurements),
    );
  }
});
