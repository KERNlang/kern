import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPolicy as loadF2Policy } from '../kern-frontend-f2-expression/decoder.mjs';
import { runDocument as runF3Document } from '../kern-frontend-f3-line-tree/worker.mjs';
import { decodeDocument, sha256 } from './decoder.mjs';
import { __test, loadPolicy, runDocument, validatePolicy } from './worker.mjs';

const HELPERS = readFileSync(
  new URL('../../examples/kern-frontend/f4-declarations-helpers.kern', import.meta.url), 'utf8');
const POLICY_VALIDATION = readFileSync(new URL('./policy-validation.mjs', import.meta.url), 'utf8');
const constitution = JSON.parse(readFileSync(
  new URL('../kir-structural/constitution.json', import.meta.url), 'utf8'));
const NODE_KEYS = ['nodeIds', 'nodeSchemaStatuses', 'nodeAllowedModes', 'nodeChildTapes', 'nodePropertyStarts', 'nodePropertyCounts'];
const PROPERTY_KEYS = ['propertyNodes', 'propertyNames', 'propertyKinds', 'propertyRequired', 'propertyValueTapes', 'propertyDispositions', 'propertyReasonIds'];

function policyWith(limits) {
  const policy = structuredClone(loadPolicy().policy);
  Object.assign(policy.profileLimits, limits);
  return policy;
}

function atomic(receipt, code, label) {
  assert.equal(receipt.status, 'fatal', label);
  assert.deepEqual(receipt.diagnostics.map((row) => row.code), [code], label);
  for (const key of ['declarations', 'propertyOccurrences', 'propertyPresence', 'attachments', 'decorators',
    'symbols', 'bindings', 'facts', 'detachedLogicalOrdinals', 'expressionEvidence']) {
    assert.deepEqual(receipt[key], [], `${label}: ${key}`);
  }
}

function quoted(count) {
  return `fn name=main\n  handler lang=kern\n    return ${Array.from({ length: count }, (_, i) => `value="${i + 1}"`).join(' ')}\n`;
}

function context(moduleId, source, result) {
  return {
    moduleId, sourceScalars: Array.from(source).length, sourceSha256: sha256(source),
    propertyAuthority: {
      nodeKinds: constitution.properties.map((row) => row.nodeKind),
      propertyNames: constitution.properties.map((row) => row.propertyName),
      schemaKinds: constitution.properties.map((row) => row.schemaKind),
      required: constitution.properties.map((row) => row.required ? 'true' : 'false'),
      dispositions: constitution.properties.map((row) => row.disposition),
    },
    sourcePoints: Array.from(source), f2Policy: loadF2Policy(),
    f2bSegments: result.prerequisites.batch?.receipt.segments ?? [],
    f2bExpressions: result.prerequisites.batch?.expressions ?? [],
    f2bAbsoluteSpans: result.prerequisites.batch?.receipt.absoluteSpans ?? [],
  };
}

function authoritiesMatchShape(source) {
  const start = source.indexOf('fn name=f4authoritiesmatch returns=boolean');
  const end = source.indexOf('\nfn name=', start + 1);
  if (start < 0) return false;
  const block = source.slice(start, end < 0 ? source.length : end);
  const loops = [
    ['nodeIndex', 'nodeIds', 'frozenNodeRows', ['nodeIds', 'nodeSchemaStatuses', 'nodeAllowedModes', 'nodeChildTapes']],
    ['propertyIndex', 'propertyNodes', 'frozenPropertyRows', ['propertyNodes', 'propertyNames', 'propertyKinds', 'propertyRequired', 'propertyValueTapes', 'propertyDispositions', 'propertyReasonIds']],
    ['keywordIndex', 'keywordForms', 'frozenKeywordRows', ['keywordForms', 'keywordSourceProfiles']],
  ];
  return loops.every(([index, length, frozen, fields], position) => {
    const header = `for name=${index} from=0 to=${length}.length`;
    const loopStart = block.indexOf(header);
    const nextHeaders = loops.slice(position + 1).map(([next]) =>
      block.indexOf(`for name=${next} from=0 to=`)).filter((next) => next >= 0);
    const loop = block.slice(loopStart, nextHeaders.length === 0 ? block.length : Math.min(...nextHeaders));
    return loopStart >= 0 && loop.includes(String.raw`String(${index}) + \"|\"`) &&
      fields.every((field) => loop.includes(`${field}[${index}]`)) &&
      loop.includes(`if cond="row != ${frozen}[${index}]"`);
  });
}

function expressionBoundaryValidationShape(source) {
  return source.includes('!Number.isSafeInteger(scalarCap + 1) || boundaryCap < scalarCap + 1') &&
    source.includes('!Number.isSafeInteger(scalarCap + localCallCap) || boundaryCap > scalarCap + localCallCap');
}

test('EA-A1: equal F3 geometry has distinct KERN-owned F4 declaration semantics', () => {
  const fnSource = '@trace\nfn name=WorldX\n';
  const typeSource = '@trace\ntype name=Main\n';
  assert.equal(Array.from(fnSource).length, Array.from(typeSource).length);
  const fnF3 = runF3Document(fnSource);
  const typeF3 = runF3Document(typeSource);
  assert.deepEqual(fnF3.fields, typeF3.fields, 'complete F3 fields');
  assert.deepEqual([fnF3.receipt.decoratorRuns[0].disposition, typeF3.receipt.decoratorRuns[0].disposition], ['candidate', 'candidate']);
  const fn = runDocument('a1-fn.kern', fnSource);
  const type = runDocument('a1-type.kern', typeSource);
  assert.equal(fn.runtimeInvocations, 1);
  assert.equal(type.runtimeInvocations, 1);
  assert.equal(fn.receipt.status, 'classified');
  assert.equal(fn.receipt.decorators[0].disposition, 'attached');
  assert.equal(fn.receipt.decorators[0].targetLogicalOrdinal, 1);
  assert.deepEqual(fn.receipt.diagnostics, []);
  assert.equal(type.receipt.status, 'rejected');
  assert.equal(type.receipt.decorators[0].disposition, 'dropped');
  assert.equal(type.receipt.decorators[0].targetLogicalOrdinal, -1);
  assert.deepEqual(type.receipt.diagnostics.map((row) => row.code),
    ['DROPPED_DECORATOR', 'FRONTEND_UNSUPPORTED_MODULE_ROOT']);
  assert.deepEqual(type.receipt.facts.map((row) => row.code), ['invalid-module-root']);
});

test('EA-A2: complete authority transport and every cyclic row substitution reach real F4A', () => {
  const source = 'fn name=main\n';
  const ordinary = __test.runDocumentWithTestInput('a2-complete.kern', source, { mutateInput() {} });
  assert.equal(ordinary.runtimeInvocations, 1);
  assert.equal(ordinary.receipt.status, 'classified');
  for (const key of NODE_KEYS) assert.equal(ordinary.__testInput.authorities[key].length, 302, key);
  for (const key of PROPERTY_KEYS) assert.equal(ordinary.__testInput.authorities[key].length, 1149, key);
  const descriptors = [['node', 302], ['property', 1149]].flatMap(([family, count]) =>
    Array.from({ length: count }, (_, ordinal) => ({ family, operation: 'cyclic', ordinal })));
  const results = __test.runDocumentWithAuthorityMutations('a2-cyclic.kern', source, descriptors);
  assert.equal(results.length, descriptors.length);
  results.forEach((result, index) => {
    const { family, ordinal } = descriptors[index];
    assert.equal(result.runtimeInvocations, 1, `${family}:${ordinal}: one F4 invocation`);
    atomic(result.receipt, 'F4_AUTHORITY_DRIFT', `${family}:${ordinal}`);
  });
});

test('EA-A2: deletion, duplicate, swap, and scalar substitution reject first and final rows', () => {
  const source = 'fn name=main\n';
  for (const [family, count] of [['node', 302], ['property', 1149]]) {
    for (const ordinal of [0, count - 1]) {
      for (const operation of ['delete', 'duplicate', 'swap', 'substitute']) {
        const result = __test.runDocumentWithAuthorityMutation('a2-shape.kern', source,
          { family, operation, ordinal });
        assert.equal(result.runtimeInvocations, 1, `${family}/${operation}/${ordinal}: one invocation`);
        atomic(result.receipt, 'F4_AUTHORITY_DRIFT', `${family}/${operation}/${ordinal}`);
      }
    }
  }
});

test('EA-A2: structural comparator guard rejects a shortened loop control', () => {
  assert.equal(authoritiesMatchShape(HELPERS), true, 'all three actual full-row loops');
  const shortened = HELPERS.replace('to=propertyNodes.length', 'to=1');
  const missingComparison = HELPERS.replace('if cond="row != frozenPropertyRows[propertyIndex]"', 'if cond=true');
  const nonOrdinalField = HELPERS.replace('propertyReasonIds[propertyIndex]', 'propertyReasonIds[0]');
  assert.notEqual(shortened, HELPERS, 'shortened control changed source');
  assert.notEqual(missingComparison, HELPERS, 'comparison control changed source');
  assert.notEqual(nonOrdinalField, HELPERS, 'field control changed source');
  assert.equal(authoritiesMatchShape(shortened), false,
    'shortened property loop control');
  assert.equal(authoritiesMatchShape(missingComparison), false,
    'removed frozen property comparison control');
  assert.equal(authoritiesMatchShape(nonOrdinalField), false,
    'non-ordinal property field control');
  assert.equal(NODE_KEYS.length, 6);
  assert.equal(PROPERTY_KEYS.length, 7);
});

test('EA-A11: policy admits interior/endpoints and rejects crossings or unsafe arithmetic', () => {
  for (const boundary of [7, 8, 10]) assert.doesNotThrow(() => validatePolicy(policyWith({
    maxAggregateExpressionScalars: 6, maxF4LocalF2Calls: 4, maxExpressionBoundaryEntries: boundary,
  })));
  assert.throws(() => validatePolicy(policyWith({
    maxAggregateExpressionScalars: 6, maxF4LocalF2Calls: 4, maxExpressionBoundaryEntries: 6,
  })), /expression boundary floor/u);
  assert.throws(() => validatePolicy(policyWith({
    maxAggregateExpressionScalars: 6, maxF4LocalF2Calls: 4, maxExpressionBoundaryEntries: 11,
  })), /expression boundary unreachable/u);
  assert.throws(() => validatePolicy(policyWith({
    maxAggregateExpressionScalars: Number.MAX_SAFE_INTEGER, maxF4LocalF2Calls: 1,
    maxExpressionBoundaryEntries: Number.MAX_SAFE_INTEGER,
  })), /expression boundary floor/u);
  assert.throws(() => validatePolicy(policyWith({
    maxAggregateExpressionScalars: 1, maxF4LocalF2Calls: Number.MAX_SAFE_INTEGER,
    maxExpressionBoundaryEntries: 2,
  })), /expression boundary unreachable/u);
  assert.equal(expressionBoundaryValidationShape(POLICY_VALIDATION), true, 'both safe-integer branch guards');
  const removedFloorSafeCheck = POLICY_VALIDATION.replace('!Number.isSafeInteger(scalarCap + 1) || ', '');
  const removedReachableSafeCheck = POLICY_VALIDATION.replace('!Number.isSafeInteger(scalarCap + localCallCap) || ', '');
  assert.notEqual(removedFloorSafeCheck, POLICY_VALIDATION, 'floor branch canary changed source');
  assert.notEqual(removedReachableSafeCheck, POLICY_VALIDATION, 'reachable branch canary changed source');
  assert.equal(expressionBoundaryValidationShape(removedFloorSafeCheck), false, 'floor safe-integer branch required');
  assert.equal(expressionBoundaryValidationShape(removedReachableSafeCheck), false, 'reachable safe-integer branch required');
});

test('EA-A11: zero, failed-local, F2B-origin, and B=7/8/10 runtime boundaries are KERN-owned', () => {
  const zeroReceipt = runDocument('a11-zero.kern', 'fn name=main\n').receipt;
  const zero = zeroReceipt.header;
  assert.equal(zeroReceipt.status, 'classified');
  assert.deepEqual(zeroReceipt.expressionEvidence, []);
  assert.deepEqual([zero.f4LocalF2CallCount, zero.aggregateExpressionScalars, zero.expressionBoundaryEntries], [0, 0, 0]);
  const failedReceipt = runDocument('a11-failed.kern', 'fn name=main\n  handler lang=kern\n    return value="1 +"\n').receipt;
  const failed = failedReceipt.header;
  assert.equal(failedReceipt.status, 'rejected');
  assert.deepEqual(failedReceipt.expressionEvidence, []);
  assert.deepEqual(failedReceipt.diagnostics.map((row) => row.code), ['FRONTEND_INVALID_EXPRESSION']);
  assert.deepEqual([failed.f4LocalF2CallCount, failed.aggregateExpressionScalars, failed.expressionBoundaryEntries], [1, 0, 0]);
  const f2bReceipt = runDocument('a11-f2b.kern', 'fn name=main\n  handler lang=kern\n    return value={{ 1 + 2 }}\n').receipt;
  const f2b = f2bReceipt.header;
  assert.equal(f2bReceipt.status, 'classified');
  assert.equal(f2bReceipt.expressionEvidence.length, 1);
  assert.equal(f2bReceipt.expressionEvidence[0].origin, 'f2b');
  assert.equal(f2b.f4LocalF2CallCount, 0);
  assert.equal(f2b.expressionBoundaryEntries, 0);
  assert.ok(f2b.aggregateExpressionScalars > 0);
  assert.equal(f2b.aggregateExpressionScalars, Array.from(f2bReceipt.expressionEvidence[0].decodedSource).length);
  const limits = { maxAggregateExpressionScalars: 6, maxF4LocalF2Calls: 4 };
  const under = __test.runDocumentWithProfileLimits('a11-under.kern', quoted(4), { ...limits, maxExpressionBoundaryEntries: 8 }).receipt;
  assert.deepEqual([under.header.aggregateExpressionScalars, under.header.f4LocalF2CallCount, under.header.expressionBoundaryEntries], [4, 4, 8]);
  for (const boundary of [10]) {
    const exact = __test.runDocumentWithProfileLimits(`a11-exact-${boundary}.kern`, quoted(4), { ...limits, maxExpressionBoundaryEntries: boundary }).receipt;
    assert.equal(exact.status, 'classified');
    assert.deepEqual([exact.header.aggregateExpressionScalars, exact.header.f4LocalF2CallCount, exact.header.expressionBoundaryEntries], [4, 4, 8]);
  }
  atomic(__test.runDocumentWithProfileLimits('a11-limit.kern', quoted(4), { ...limits, maxExpressionBoundaryEntries: 7 }).receipt,
    'F4_LIMIT', 'B=7 next local success');
});

test('EA-A11: independent sealed scalar and boundary mutations reject unchanged evidence', () => {
  const moduleId = 'a11-seal.kern';
  const source = quoted(2);
  const result = runDocument(moduleId, source);
  const baselineSeal = result.fields[16].split(':');
  assert.equal(baselineSeal.length, 20, 'sealed receipt has all 20 fields');
  assert.equal(baselineSeal[14], String(result.receipt.header.aggregateExpressionScalars), 'slot 14 scalar aggregate');
  assert.equal(baselineSeal[17], String(result.receipt.header.expressionBoundaryEntries), 'slot 17 boundary aggregate');
  for (const slot of [14, 17]) {
    const fields = [...result.fields];
    const seal = [...baselineSeal];
    seal[slot] = String(Number(seal[slot]) + 1);
    fields[16] = seal.join(':');
    assert.throws(() => decodeDocument(fields, context(moduleId, source, result)), /expression aggregates/u);
  }
});

test('EA-A12: public isolation and frozen policy/ABI identity remain controls', () => {
  assert.equal(runDocument.length, 2, 'public worker exposes only moduleId and source');
  const source = 'fn name=main\n';
  const ordinary = runDocument('a12.kern', source);
  const ignored = runDocument('a12.kern', source, { mutation: 'authority-row-reorder' });
  assert.deepEqual(ignored.fields, ordinary.fields, 'a public third argument cannot request a mutation');
  const policy = loadPolicy().policy;
  assert.deepEqual([policy.format, policy.documentResultFormat, policy.documentPrivateAbi.arity],
    ['kern.frontend.f4-declarations-policy.4', 'kern.frontend.f4-document.2', 109]);
  for (const descriptor of [
    [{ family: 'node', operation: 'cyclic', ordinal: -1 }, /authority mutation bounds/u],
    [{ family: 'property', operation: 'unknown', ordinal: 0 }, /authority mutation descriptor/u],
    [{ family: 'node', operation: 'cyclic', ordinal: 302, extra: true }, /authority mutation descriptor/u],
  ]) assert.throws(() => __test.runDocumentWithAuthorityMutation('a12-invalid.kern', source, descriptor[0]), descriptor[1]);
  assert.throws(() => __test.runDocumentWithAuthorityMutations('a12-invalid.kern', source, [
    { family: 'node', operation: 'cyclic', ordinal: 0 },
    { family: 'node', operation: 'cyclic', ordinal: 302 },
  ]), /authority mutation bounds/u, 'batch validates every descriptor before preparation');
});
