import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { VALID_FIXTURES } from './fixtures.mjs';
import { validateCanonicalizerPolicy } from './policy.mjs';

const source = readFileSync(new URL('../../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url), 'utf8');
const policyUrl = new URL('./policy.json', import.meta.url);

test('the KERN canonicalizer is parseable, bounded, and contains the semantic source decisions', () => {
  const parsed = parseDocumentWithDiagnostics(source);
  assert.notEqual(parsed.partial, true);
  assert.deepEqual(
    parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    [],
  );
  assert.ok(source.split('\n').length - 1 < 500, 'hand-written KERN source must stay below 500 lines');
  for (const owned of ['fn name=', 'param name=', 'handler lang=', 'return value=', 'quotesource', 'typesource']) {
    assert.ok(source.includes(owned), `missing KERN-owned source decision ${owned}`);
  }
});

test('the admitted table profile is policy-owned and enforced by KERN', () => {
  assert.equal(existsSync(policyUrl), true, 'missing canonicalizer policy');
  const policy = JSON.parse(readFileSync(policyUrl, 'utf8'));
  validateCanonicalizerPolicy(policy);
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 16,
    maxPropertyRows: 30,
    maxValueRows: 72,
  });
  assert.deepEqual(policy.expansionLimits, {
    kirToSourceMaxFactor: 4,
    runtimeEnvelopeMaxFactor: 2,
  });
  assert.equal(policy.runtimeLimits.maxStringBytes, 1_048_576);
  assert.equal(policy.runtimeLimits.maxBytes, 2_097_152);
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  for (const limitName of Object.keys(policy.profileLimits)) {
    assert.match(source, new RegExp(limitName, 'u'), `KERN omitted ${limitName}`);
  }
  for (const mutate of [
    (copy) => delete copy.expansionLimits.kirToSourceMaxFactor,
    (copy) => delete copy.kirLimits.maxBytes,
    (copy) => {
      copy.runtimeLimits.futureLimit = 1;
    },
    ...Object.keys(policy.profileLimits).map((key) => (copy) => delete copy.profileLimits[key]),
  ]) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(() => validateCanonicalizerPolicy(copy), /must contain exactly/u);
  }
  for (const mutate of [
    (copy) => { copy.runtimeLimits.maxStringBytes -= 1; },
    (copy) => { copy.runtimeLimits.maxBytes -= 1; },
  ]) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(() => validateCanonicalizerPolicy(copy), /must cover the configured/u);
  }
});

test('the canonicalizer has no host-handler, capability, import, or delegated runtime escape', () => {
  for (const forbidden of ['handler lang=ts', 'capability namespace=', 'import ', 'use path=', 'handler code=', '<<<']) {
    assert.equal(source.includes(forbidden), false, `forbidden canonicalizer escape ${forbidden}`);
  }
});

test('the valid corpus covers every admitted return and parameter type', () => {
  const coveredReturns = new Set();
  const coveredParameters = new Set();
  for (const fixture of VALID_FIXTURES) {
    const parsed = parseDocumentWithDiagnostics(fixture.source);
    for (const root of parsed.root.children ?? []) {
      if (root.type !== 'fn') continue;
      if (typeof root.props?.returns === 'string') coveredReturns.add(root.props.returns);
      for (const child of root.children ?? []) {
        if (child.type === 'param' && typeof child.props?.type === 'string') {
          coveredParameters.add(child.props.type);
        }
      }
    }
  }
  assert.deepEqual(
    [...coveredReturns].sort(),
    ['boolean', 'boolean[]', 'number', 'number[]', 'string', 'string[]', 'void'],
  );
  assert.deepEqual(
    [...coveredParameters].sort(),
    ['boolean', 'boolean[]', 'number', 'number[]', 'string', 'string[]'],
  );
});
