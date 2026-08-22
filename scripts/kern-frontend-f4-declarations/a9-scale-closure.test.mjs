import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPolicy, validatePolicy } from './worker.mjs';

const SCALING_KEYS = [
  'densityCounts', 'maxAdjacentCpuTimeRatio', 'cpuTimeSlackMs', 'maxCpuTimeMs',
  'maxAdjacentRssRatio', 'rssSlackBytes', 'maxPeakRssBytes',
  'maxAdjacentEnvelopeRatio', 'maxEnvelopeBytes', 'maxAdjacentWorkRatio',
  'maxDocumentWorkSteps', 'maxModuleDocumentWorkSteps',
];
const FAMILIES = ['declaration', 'property', 'attachment', 'decorator', 'module'];
const policy = loadPolicy().policy;
const hasScalingWalls = policy.scalingWalls !== undefined;

function clonePolicy() {
  return structuredClone(loadPolicy().policy);
}

function reverse(value) {
  return Object.fromEntries(Object.entries(value).reverse());
}

function runMeasurement(family, count) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_DEBUG;
  delete childEnv.NODE_OPTIONS;
  delete childEnv.NODE_V8_COVERAGE;
  const child = spawnSync(process.execPath, [
    fileURLToPath(new URL('./a9-scale-worker.mjs', import.meta.url)), family, String(count),
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: Math.max(65_536, policy.scalingWalls.maxEnvelopeBytes * 2),
    timeout: policy.scheduler.timeoutMs * (family === 'module' ? count + 1 : 1),
  });
  assert.equal(child.status, 0, `${family}/${count}: ${child.stderr || child.error || 'child failure'}`);
  assert.equal(child.stderr, '', `${family}/${count}: no stderr`);
  assert.notEqual(child.stdout, '', `${family}/${count}: one JSON report`);
  assert.doesNotMatch(child.stdout, /\n/u, `${family}/${count}: one strict JSON object`);
  const report = JSON.parse(child.stdout);
  assert.equal(report.family, family);
  assert.equal(report.count, count);
  return report;
}

test('A9 policy authenticates one exact 1x/2x/4x/8x scaling-wall object', () => {
  assert.ok(policy.scalingWalls, 'F4 policy must authenticate scalingWalls');
  assert.deepEqual(Object.keys(policy.scalingWalls), SCALING_KEYS);
  assert.deepEqual(policy.scalingWalls.densityCounts, [1, 2, 4, 8]);
  assert.ok(policy.scalingWalls.maxDocumentWorkSteps <= policy.profileLimits.maxWorkSteps);
  assert.ok(policy.scalingWalls.maxModuleDocumentWorkSteps <= policy.profileLimits.maxWorkSteps);
  const reordered = clonePolicy();
  reordered.scalingWalls = reverse(reordered.scalingWalls);
  assert.doesNotThrow(() => validatePolicy(reordered));
});

test('A9 policy rejects scaling omissions, additions, malformed counts, and invalid walls',
  { skip: !hasScalingWalls }, async (t) => {
    for (const key of SCALING_KEYS) {
      await t.test(`missing ${key}`, () => {
        const mutated = clonePolicy();
        delete mutated.scalingWalls[key];
        assert.throws(() => validatePolicy(mutated), /scaling/u);
      });
    }
    await t.test('extra key', () => {
      const mutated = clonePolicy();
      mutated.scalingWalls.unexpected = 1;
      assert.throws(() => validatePolicy(mutated), /scaling/u);
    });
    for (const counts of [[1, 2, 4], [1, 2, 4, 9], [0, 1, 2, 4], [2, 4, 8, 16],
      [1, 2, 4, 2 ** 53]]) {
      await t.test(`counts ${JSON.stringify(counts)}`, () => {
        const mutated = clonePolicy();
        mutated.scalingWalls.densityCounts = counts;
        assert.throws(() => validatePolicy(mutated), /scaling/u);
      });
    }
    for (const key of SCALING_KEYS.filter((name) => name !== 'densityCounts')) {
      await t.test(`invalid ${key}`, () => {
        const mutated = clonePolicy();
        mutated.scalingWalls[key] = 0;
        assert.throws(() => validatePolicy(mutated), /scaling/u);
      });
    }
    for (const [key, value] of [
      ['maxCpuTimeMs', policy.scheduler.timeoutMs + 1],
      ['maxEnvelopeBytes', policy.runtimeLimits.maxBytes + 1],
    ]) {
      await t.test(`${key} parent ceiling`, () => {
        const mutated = clonePolicy();
        mutated.scalingWalls[key] = value;
        assert.throws(() => validatePolicy(mutated), /scaling/u);
      });
    }
  });
test('A9 deterministic evaluator kills adjacent and absolute metric crossings',
  { skip: !hasScalingWalls }, async () => {
    const { assertScaleReports } = await import('./a9-scale-worker.mjs');
    const reports = policy.scalingWalls.densityCounts.map((count) => ({
      family: 'declaration', count, status: 'classified', runtimeInvocations: 1,
      declarations: count, propertyOccurrences: count * 2,
      cpuMilliseconds: count, elapsedMilliseconds: count, peakRssBytes: 1_000 + count,
      envelopeBytes: 100 * count, workSteps: 100 * count,
    }));
    assert.doesNotThrow(() => assertScaleReports('declaration', reports, policy.scalingWalls));
    for (const [metric, ratioKey, slack, absolute] of [
      ['cpuMilliseconds', 'maxAdjacentCpuTimeRatio', policy.scalingWalls.cpuTimeSlackMs,
        policy.scalingWalls.maxCpuTimeMs],
      ['peakRssBytes', 'maxAdjacentRssRatio', policy.scalingWalls.rssSlackBytes,
        policy.scalingWalls.maxPeakRssBytes],
      ['envelopeBytes', 'maxAdjacentEnvelopeRatio', 0, policy.scalingWalls.maxEnvelopeBytes],
      ['workSteps', 'maxAdjacentWorkRatio', 0, policy.scalingWalls.maxDocumentWorkSteps],
    ]) {
      const mutated = structuredClone(reports);
      let value = absolute + 1;
      mutated.at(-1)[metric] = value;
      for (let index = mutated.length - 2; index >= 0; index -= 1) {
        value = Math.max(0, Math.ceil((value - slack) / policy.scalingWalls[ratioKey]));
        mutated[index][metric] = value;
      }
      assert.throws(() => assertScaleReports('declaration', mutated, policy.scalingWalls),
        new RegExp(`${metric} .*exceeds absolute`, 'u'));
    }
    for (const [metric, wall, slack = 0] of [
      ['cpuMilliseconds', 'maxAdjacentCpuTimeRatio', policy.scalingWalls.cpuTimeSlackMs],
      ['peakRssBytes', 'maxAdjacentRssRatio', policy.scalingWalls.rssSlackBytes],
      ['envelopeBytes', 'maxAdjacentEnvelopeRatio'],
      ['workSteps', 'maxAdjacentWorkRatio'],
    ]) {
      const mutated = structuredClone(reports);
      mutated[1][metric] = mutated[0][metric] * policy.scalingWalls[wall] + slack + 1;
      assert.throws(() => assertScaleReports('declaration', mutated, policy.scalingWalls),
        new RegExp(metric, 'u'));
    }
  });

test('A9 live isolated families satisfy exact semantics, invocation counts, and all walls',
  { skip: !hasScalingWalls }, async (t) => {
    const { assertScaleReports } = await import('./a9-scale-worker.mjs');
    for (const family of FAMILIES) {
      await t.test(family, () => {
        const reports = policy.scalingWalls.densityCounts.map((count) => runMeasurement(family, count));
        assertScaleReports(family, reports, policy.scalingWalls);
      });
    }
  });

test('A9 worker source retains public execution and process-resource measurement seams',
  { skip: !hasScalingWalls }, () => {
    const source = readFileSync(new URL('./a9-scale-worker.mjs', import.meta.url), 'utf8');
    for (const token of [
      'runDocument(', 'runModuleSet(', 'process.cpuUsage(', 'process.resourceUsage().maxRSS',
      'JSON.stringify(result.fields)', 'runtimeInvocations', 'documentRuntimeInvocations',
      'moduleSetRuntimeInvocations',
    ]) assert.ok(source.includes(token), token);
    assert.doesNotMatch(source, /Worker|worker_threads|warmup|reset/u);
    const testSource = readFileSync(new URL('./a9-scale-closure.test.mjs', import.meta.url), 'utf8');
    const liveStart = testSource.indexOf("test('A9 live isolated families");
    const liveEnd = testSource.indexOf("\ntest('A9 worker source", liveStart);
    assert.ok(liveStart >= 0 && liveEnd > liveStart, 'live measurement block');
    const liveBlock = testSource.slice(liveStart, liveEnd);
    assert.ok(liveBlock.includes('for (const family of FAMILIES)'), 'live family loop');
    const evaluatorCall = /^\s*assertScaleReports\(family, reports, policy\.scalingWalls\);$/gmu;
    assert.equal([...liveBlock.matchAll(evaluatorCall)].length, 1,
      'actual reports use the canonical evaluator exactly once');
  });
