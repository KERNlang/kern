import assert from 'node:assert/strict';
import test from 'node:test';

import { loadKernFormatterAssets } from '../../packages/cli/dist/kern-formatter-assets.js';
import {
  KERN_FORMATTER_REQUEST_FORMAT,
  validateKernFormatterRequest,
} from '../../packages/cli/dist/kern-formatter-contract.js';
import { INVALID_FORMATTER_FIXTURES, VALID_FORMATTER_FIXTURES } from './fixtures.mjs';
import { formatKernSource } from './production.mjs';

const assets = loadKernFormatterAssets();
const limits = assets.policy.profileLimits;

test('compiled KERN formatter owns every admitted fixture and is idempotent', () => {
  for (const fixture of VALID_FORMATTER_FIXTURES) {
    const first = formatKernSource(fixture.source);
    assert.equal(first.outcome, 'formatted', fixture.id);
    assert.equal(first.source, fixture.expected, fixture.id);
    assert.match(first.sourceSha256, /^[0-9a-f]{64}$/u, fixture.id);
    const second = formatKernSource(first.source);
    assert.equal(second.outcome, 'formatted', `${fixture.id}:second`);
    assert.equal(second.source, first.source, `${fixture.id}:idempotence`);
    assert.equal(second.edits, 0, `${fixture.id}:second edits`);
  }
});

test('invalid framing fails deterministically without partial source', () => {
  for (const fixture of INVALID_FORMATTER_FIXTURES) {
    const first = formatKernSource(fixture.source);
    const second = formatKernSource(fixture.source);
    assert.equal(first.outcome, 'failure', fixture.id);
    assert.equal(first.source, null, fixture.id);
    assert.equal(first.sourceSha256, null, fixture.id);
    assert.equal(first.diagnostics[0]?.code, fixture.code, fixture.id);
    assert.deepEqual(second, first, `${fixture.id}:determinism`);
  }
});

test('request shape and byte limits fail before formatted output', () => {
  const unsupported = formatKernSource('x', {
    assets: undefined,
  });
  assert.equal(unsupported.outcome, 'formatted');

  const exactSource = 'x'.repeat(limits.maxCodePoints);
  assert.equal(
    validateKernFormatterRequest(
      { format: KERN_FORMATTER_REQUEST_FORMAT, source: exactSource },
      limits,
    ).source.length,
    limits.maxCodePoints,
  );

  const oversized = formatKernSource(`${exactSource}x`);
  assert.equal(oversized.outcome, 'failure');
  assert.equal(oversized.source, null);
  assert.match(oversized.diagnostics[0].message, /maxCodePoints/u);
});

test('an exact source ceiling still admits a missing CRLF terminator', () => {
  const reducedAssets = {
    ...assets,
    policy: {
      ...assets.policy,
      profileLimits: {
        ...assets.policy.profileLimits,
        maxCodePoints: 5,
        maxResultCodePoints: 7,
      },
    },
  };
  const formatted = formatKernSource('\r\nxxx', { assets: reducedAssets });
  assert.equal(formatted.outcome, 'formatted');
  assert.equal(formatted.source, '\r\nxxx\r\n');
});
