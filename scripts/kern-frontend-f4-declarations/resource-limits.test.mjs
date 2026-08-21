import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPolicy as loadF2Policy } from '../kern-frontend-f2-expression/decoder.mjs';
import { decodeDocument, sha256 } from './decoder.mjs';
import { __test, loadPolicy, runDocument, validatePolicy } from './worker.mjs';

function withLimits(overrides) {
  const policy = structuredClone(loadPolicy().policy);
  Object.assign(policy.profileLimits, overrides);
  return policy;
}

function reversedKeys(value) {
  return Object.fromEntries(Object.entries(value).reverse());
}

function quotedExpressions(count) {
  const values = Array.from({ length: count }, (_, index) => `value="${index + 1}"`).join(' ');
  return `fn name=main\n  handler lang=kern\n    return ${values}\n`;
}

function contextFor(moduleId, source, result) {
  return {
    moduleId,
    sourceScalars: Array.from(source).length,
    sourceSha256: sha256(source),
    sourcePoints: Array.from(source),
    f2Policy: loadF2Policy(),
    f2bSegments: result.prerequisites.batch.receipt.segments,
    f2bExpressions: result.prerequisites.batch.expressions,
    f2bAbsoluteSpans: result.prerequisites.batch.receipt.absoluteSpans,
  };
}

function assertAtomicLimit(receipt, label) {
  assert.equal(receipt.status, 'fatal', label);
  assert.deepEqual(receipt.diagnostics.map(({ code }) => code), ['F4_LIMIT'], label);
  for (const key of ['declarations', 'propertyOccurrences', 'propertyPresence', 'attachments', 'decorators',
    'symbols', 'bindings', 'facts', 'detachedLogicalOrdinals', 'expressionEvidence']) {
    assert.deepEqual(receipt[key], [], `${label}: ${key}`);
  }
}

test('policy validates the independent expression-boundary ceiling relation', () => {
  const { profileLimits } = loadPolicy().policy;
  const scalars = profileLimits.maxAggregateExpressionScalars;
  const calls = profileLimits.maxF4LocalF2Calls;
  assert.doesNotThrow(() => validatePolicy(withLimits({ maxExpressionBoundaryEntries: scalars + 1 })));
  assert.doesNotThrow(() => validatePolicy(withLimits({ maxExpressionBoundaryEntries: scalars + calls })));
  assert.throws(() => validatePolicy(withLimits({ maxExpressionBoundaryEntries: scalars })), /boundary.*floor/u);
  assert.throws(() => validatePolicy(withLimits({ maxExpressionBoundaryEntries: scalars + calls + 1 })), /boundary.*reachable/u);
  assert.doesNotThrow(() => validatePolicy(withLimits({
    maxAggregateExpressionScalars: 60_000,
    maxF4LocalF2Calls: 5_546,
  })));
});

test('policy rejects missing or extra F4 profile, runtime, and scheduler keys before execution', () => {
  for (const key of ['maxSourceScalars', 'maxRecords', 'maxLogicalLines']) {
    const policy = withLimits({});
    delete policy.profileLimits[key];
    assert.throws(() => validatePolicy(policy), /profile.*keys/u, `missing ${key}`);
  }
  for (const [section, key] of [['profileLimits', 'unexpectedProfile'], ['runtimeLimits', 'unexpectedRuntime'],
    ['scheduler', 'unexpectedScheduler']]) {
    const policy = withLimits({});
    policy[section][key] = 1;
    assert.throws(() => validatePolicy(policy), new RegExp(`${section.replace('Limits', ' limits')}.*keys`, 'u'));
  }
});

test('nested F4 limit schemas accept the same keys in any property order', async (t) => {
  for (const section of ['profileLimits', 'runtimeLimits', 'scheduler']) {
    await t.test(section, () => {
      const policy = withLimits({});
      policy[section] = reversedKeys(policy[section]);
      assert.doesNotThrow(() => validatePolicy(policy));
    });
  }
});

test('policy rejects omitted or unknown keys on every pinned descriptor', async (t) => {
  const groups = [
    ['authority', (policy) => policy.authorities, /authority|constitution/u],
    ['composition', (policy) => policy.composition, /composition/u],
    ['F1', (policy) => [policy.f1Policy], /F1/u],
    ['F2', (policy) => [policy.f2Policy], /F2/u],
    ['F2B', (policy) => [policy.f2bPolicy], /F2B/u],
    ['F3', (policy) => [policy.f3Policy], /F3/u],
  ];
  for (const [label, select, error] of groups) {
    const baseline = withLimits({});
    for (const [index, descriptor] of select(baseline).entries()) {
      for (const key of Object.keys(descriptor)) {
        await t.test(`${label} ${index} missing ${key}`, () => {
          const policy = withLimits({});
          delete select(policy)[index][key];
          assert.throws(() => validatePolicy(policy), error);
        });
      }
      await t.test(`${label} ${index} rejects an extra key`, () => {
        const policy = withLimits({});
        select(policy)[index].unexpected = 'must-not-be-ignored';
        assert.throws(() => validatePolicy(policy), error);
      });
    }
  }
});

test('F1, F2, F2B, and F3 prerequisite identities are exact', async (t) => {
  const expected = withLimits({}).prerequisites;
  for (const [index, name] of expected.entries()) {
    await t.test(`${name} cannot drift`, () => {
      const policy = withLimits({});
      policy.prerequisites[index] = `${name}.unexpected`;
      assert.throws(() => validatePolicy(policy), /policy identity|prerequisite/u);
    });
  }
  for (const operation of ['missing', 'extra']) {
    await t.test(`${operation} prerequisite identity is rejected`, () => {
      const policy = withLimits({});
      if (operation === 'missing') policy.prerequisites.pop();
      else policy.prerequisites.push('kern.frontend.unexpected.1');
      assert.throws(() => validatePolicy(policy), /policy identity|prerequisite/u);
    });
  }
});

test('F4-owned source, record, and logical-line caps admit exactly at cap and reject cap plus one', () => {
  const source = 'fn name=one export=true\nfn name=two export=true\n';
  const moduleId = '.kern';
  const baseline = runDocument(moduleId, source);
  const sourceScalars = Array.from(source).length;
  const recordCount = baseline.prerequisites.scan.decoded.records.length;
  const lineCount = baseline.prerequisites.receipt.logicalLines.length;
  const pathCaps = {
    maxModuleIdScalars: moduleId.length,
    maxModuleIdSegments: 1,
    maxImportSpecifierScalars: 1,
    maxImportSpecifierSegments: 1,
  };
  const exact = { ...pathCaps, maxSourceScalars: sourceScalars, maxRecords: recordCount, maxLogicalLines: lineCount };
  assert.equal(__test.runDocumentWithProfileLimits(moduleId, source, exact).receipt.status, 'classified');
  for (const [name, override] of [
    ['source', { maxSourceScalars: sourceScalars - 1 }],
    ['record', { maxRecords: recordCount - 1 }],
    ['line', { maxLogicalLines: lineCount - 1 }],
  ]) assertAtomicLimit(__test.runDocumentWithProfileLimits(moduleId, source, { ...exact, ...override }).receipt, name);
});

test('scaled live boundary threshold rejects the next local success while S and L remain valid', () => {
  const limits = {
    maxAggregateExpressionScalars: 6,
    maxF4LocalF2Calls: 4,
    maxExpressionBoundaryEntries: 7,
  };
  const below = __test.runDocumentWithProfileLimits('below-boundary.kern', quotedExpressions(3), limits).receipt;
  const above = __test.runDocumentWithProfileLimits('above-boundary.kern', quotedExpressions(4), limits).receipt;
  assert.equal(below.status, 'classified');
  assert.equal(below.header.aggregateExpressionScalars, 3);
  assert.equal(below.header.f4LocalF2CallCount, 3);
  assert.equal(below.header.expressionBoundaryEntries, 6);
  assert.equal(above.status, 'fatal');
  assert.deepEqual(above.diagnostics.map(({ code }) => code), ['F4_LIMIT']);
});

test('a low but policy-valid F4 encoded-diagnostic cap reaches KERN and returns an atomic F4_LIMIT', () => {
  const source = `${Array.from({ length: 1_100 }, () => 'wat').join('\n')}\n`;
  assert.ok(Array.from(source).length > 4_096,
    'the source exceeds the cap, so an old worker runtime clamp rejected before KERN');
  assert.doesNotThrow(() => {
    const result = __test.runDocumentWithProfileLimits('low-output-cap.kern', source, {
      maxEncodedBytes: 4_096,
    });
    assertAtomicLimit(result.receipt, 'low output cap');
  });
});

test('decoder recomputes sealed scalar and boundary aggregates from authenticated evidence', () => {
  const moduleId = 'aggregate-mutation.kern';
  const source = quotedExpressions(2);
  const result = runDocument(moduleId, source);
  for (const sealIndex of [14, 17]) {
    const fields = [...result.fields];
    const seal = fields[16].split(':');
    seal[sealIndex] = String(Number(seal[sealIndex]) + 1);
    fields[16] = seal.join(':');
    assert.throws(() => decodeDocument(fields, contextFor(moduleId, source, result)), /expression aggregates/u);
  }
});
