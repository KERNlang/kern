import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { loadPolicy, runDocument } from './worker.mjs';

const FAMILIES = {
  siblings: (count) => 'item\n'.repeat(count),
  depth: (count) => Array.from({ length: count }, (_, index) => `${'  '.repeat(index)}item\n`).join(''),
  continuation: (count) => Array.from({ length: count }, (_, index) =>
    `let v${index} = "first\nsecond"\n`).join(''),
  decorators: (count) => Array.from({ length: count }, (_, index) =>
    `@d${index}\nfn n${index}\n`).join(''),
  raw: (count) => 'doc <<<\nraw\n>>>\n'.repeat(count),
};

function measure(source) {
  const started = performance.now();
  const result = runDocument(source);
  const elapsedMs = performance.now() - started;
  assert.equal(result.receipt.status, 'structured');
  assert.equal(result.runtimeInvocations, 1);
  return {
    bytes: Buffer.byteLength(JSON.stringify(result.fields), 'utf8'),
    elapsedMs,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    result,
  };
}

function measureIsolated(source) {
  const program = `
    import { performance } from 'node:perf_hooks';
    import { runDocument } from './scripts/kern-frontend-f3-line-tree/worker.mjs';
    const source = Buffer.from(process.argv[1], 'base64').toString('utf8');
    const started = performance.now();
    const result = runDocument(source);
    process.stdout.write(JSON.stringify({
      bytes: Buffer.byteLength(JSON.stringify(result.fields), 'utf8'),
      elapsedMs: performance.now() - started,
      logicalLines: result.receipt.logicalLines.length,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      runtimeInvocations: result.runtimeInvocations,
      status: result.receipt.status,
    }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program, Buffer.from(source).toString('base64')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test('1x/2x/4x/8x structural families remain inside adjacent scaling walls', () => {
  const { scalingWalls } = loadPolicy().policy;
  for (const [family, sourceFor] of Object.entries(FAMILIES)) {
    const measurements = scalingWalls.densityCounts.map((count) => measure(sourceFor(count)));
    for (let index = 1; index < measurements.length; index += 1) {
      const previous = measurements[index - 1];
      const current = measurements[index];
      assert.ok(
        current.bytes <= previous.bytes * scalingWalls.maxAdjacentByteRatio,
        `${family} bytes ${current.bytes} from ${previous.bytes}`,
      );
      assert.ok(
        current.elapsedMs <= previous.elapsedMs * scalingWalls.maxAdjacentTimeRatio + scalingWalls.timeSlackMs,
        `${family} elapsed ${current.elapsedMs} from ${previous.elapsedMs}`,
      );
    }
  }
});

test('exact full-density document stays within elapsed, RSS, byte, and invocation walls', () => {
  const policy = loadPolicy().policy;
  const measurement = measureIsolated(FAMILIES.siblings(policy.scalingWalls.fullDensityLines));
  assert.equal(measurement.status, 'structured');
  assert.equal(measurement.runtimeInvocations, 1);
  assert.equal(measurement.logicalLines, policy.scalingWalls.fullDensityLines);
  assert.ok(
    measurement.elapsedMs <= policy.scalingWalls.maxElapsedMs,
    `elapsed ${measurement.elapsedMs} exceeds ${policy.scalingWalls.maxElapsedMs}`,
  );
  assert.ok(
    measurement.peakRssBytes <= policy.scalingWalls.maxPeakRssBytes,
    `peak RSS ${measurement.peakRssBytes} exceeds ${policy.scalingWalls.maxPeakRssBytes}`,
  );
  assert.ok(
    measurement.bytes <= policy.profileLimits.maxEncodedBytes,
    `bytes ${measurement.bytes} exceeds ${policy.profileLimits.maxEncodedBytes}`,
  );
});
