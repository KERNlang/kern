import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runDocument as runF3Document } from '../kern-frontend-f3-line-tree/worker.mjs';
import { __test, loadPolicy, runDocument } from './worker.mjs';

function f4(moduleId, source) {
  const result = runDocument(moduleId, source);
  assert.equal(result.runtimeInvocations, 1, `${moduleId}: one F4 invocation`);
  return result.receipt;
}

function f3Edges(source, expected) {
  const result = runF3Document(source);
  assert.equal(result.runtimeInvocations, 1, 'one F3 invocation');
  assert.equal(result.receipt.status, 'structured');
  assert.deepEqual(result.receipt.parentEdges.map((row) => [
    row.childLogicalOrdinal, row.parentLogicalOrdinal, row.childIndent, row.parentIndent,
  ]), expected);
}

function declarations(receipt) {
  return receipt.declarations.map((row) => [row.logicalOrdinal, row.kind]);
}

function attachments(receipt) {
  return receipt.attachments.map((row) => [
    row.parentLogicalOrdinal, row.childLogicalOrdinal, row.disposition,
  ]);
}

function facts(receipt) {
  return receipt.facts.map((row) => [row.code, row.logicalOrdinal, row.propertyName]);
}

function occurrences(receipt) {
  return receipt.propertyOccurrences.map((row) => [
    row.ownerLogicalOrdinal, row.ownerKind, row.propertyName,
  ]);
}

function presence(receipt) {
  return receipt.propertyPresence.map((row) => [
    row.ownerLogicalOrdinal, row.propertyName, row.effectiveOccurrenceOrdinal,
  ]);
}

function atomicFatal(receipt, code) {
  assert.equal(receipt.status, 'fatal');
  assert.deepEqual(receipt.diagnostics.map((row) => row.code), [code]);
  for (const key of ['declarations', 'propertyOccurrences', 'propertyPresence', 'attachments',
    'decorators', 'symbols', 'bindings', 'facts', 'detachedLogicalOrdinals', 'expressionEvidence']) {
    assert.deepEqual(receipt[key], [], `${code}: ${key} is atomic`);
  }
}

function testInput(moduleId, source, mutateInput = () => {}) {
  const result = __test.runDocumentWithTestInput(moduleId, source, { mutateInput });
  assert.equal(result.__testOutcome, 'returned', `${moduleId}: real runtime returned`);
  assert.equal(result.runtimeInvocations, 1, `${moduleId}: one actual F4 invocation`);
  return result;
}

function mutateEdges(input, operation) {
  const keys = ['edgeChildren', 'edgeParents', 'edgeChildIndents', 'edgeParentIndents'];
  const vectors = keys.map((key) => input[key]);
  const index = 1;
  if (operation === 'reorder') {
    for (const vector of vectors) vector.reverse();
  } else if (operation === 'duplicate') {
    for (const vector of vectors) vector.splice(index, 0, vector[index]);
  } else if (operation === 'delete') {
    for (const vector of vectors) vector.splice(index, 1);
  } else if (operation === 'swap') {
    for (const vector of vectors) [vector[0], vector[1]] = [vector[1], vector[0]];
  } else if (operation === 'malformed') {
    input.edgeParents.pop();
  } else {
    throw new Error(`unknown edge mutation ${operation}`);
  }
}

function source(path) {
  return readFileSync(new URL(`../../examples/kern-frontend/${path}`, import.meta.url), 'utf8');
}

function block(sourceText, name) {
  const marker = `fn name=${name}`;
  const start = sourceText.indexOf(marker);
  assert.notEqual(start, -1, `${name}: function exists`);
  const next = sourceText.indexOf('\nfn name=', start + marker.length);
  return sourceText.slice(start, next === -1 ? sourceText.length : next);
}

function preprojectionShape(helper, semantic, tail) {
  const eligibilityCalls = [...helper.matchAll(/let name=\w+ value="f4lineeligibility\(/gu)].length;
  const semanticCalls = [...semantic.matchAll(/f4lineeligibility\(/gu)].length;
  const folds = [...helper.matchAll(/let name=(\w+) value="f4balancedtapefold\(/gu)];
  const chained = folds.length === 5 && folds.every((match, index) => {
    const nextIndex = index + 1 < folds.length ? folds[index + 1].index : helper.length;
    const segment = helper.slice(match.index, nextIndex);
    return /f4balancedtapefold\([^\n]+, work, maxWorkSteps\)/u.test(segment) &&
      segment.includes(`assign target=work value="f2uint(${match[1]}[2])"`);
  });
  const invalidInput = /f4tapecount\([^)]*\) != 4/gu.test(tail) &&
    /f4row6\([^\n]+invalid-child/gu.test(tail) &&
    /f4eligibilityleafadmit\(/gu.test(tail);
  const noJoinOrLateFilter = !/List\.join|\.join\(/gu.test(helper) &&
    !/f4filterdetacheddeclarations|f4detachedoccurrenceflags/gu.test(semantic) &&
    !/assign target=(?:eligibility|attachments|detached|invalidEdgeInputs|parents) value="[^"\n]+ \+/gu.test(helper);
  const f3Preserved = !/edge(?:Children|Parents|ChildIndents|ParentIndents)\.(?:push|splice)|assign target=edge(?:Children|Parents|ChildIndents|ParentIndents)/gu.test(helper);
  return eligibilityCalls === 1 && semanticCalls === 0 && chained && invalidInput && noJoinOrLateFilter && f3Preserved;
}

function compliantPreprojection() {
  return [
    'fn name=f4attachmentclosure',
    '  let name=eligibility value="f4lineeligibility(rawLine)"',
    '  let name=eligibilityFold value="f4balancedtapefold(eligibilityParts, work, maxWorkSteps)"',
    '  assign target=work value="f2uint(eligibilityFold[2])"',
    '  let name=attachmentFold value="f4balancedtapefold(attachmentParts, work, maxWorkSteps)"',
    '  assign target=work value="f2uint(attachmentFold[2])"',
    '  let name=detachedFold value="f4balancedtapefold(detachedParts, work, maxWorkSteps)"',
    '  assign target=work value="f2uint(detachedFold[2])"',
    '  let name=invalidFold value="f4balancedtapefold(invalidEdgeInputs, work, maxWorkSteps)"',
    '  assign target=work value="f2uint(invalidFold[2])"',
    '  let name=parentFold value="f4balancedtapefold(parentParts, work, maxWorkSteps)"',
    '  assign target=work value="f2uint(parentFold[2])"',
  ].join('\n');
}

test('E1 RED: closure suppresses detached declarations and path projection but retains property provenance', () => {
  const source = 'module name=app\n  list\n    text value="detached"\n      use path="../../escape"\n';
  f3Edges(source, [
    [0, -1, 0, -1], [1, 0, 2, 0], [2, 1, 4, 2], [3, 2, 6, 4],
  ]);
  const receipt = f4('a6-e1.kern', source);
  assert.equal(receipt.status, 'rejected');
  assert.deepEqual(receipt.detachedLogicalOrdinals, [2, 3]);
  assert.deepEqual(declarations(receipt), [[0, 'module'], [1, 'list']]);
  assert.deepEqual(attachments(receipt), [[0, 1, 'attached'], [2, 3, 'detached-local']]);
  assert.deepEqual(facts(receipt), [['invalid-child', 2, 'text']]);
  assert.equal(receipt.facts.some((row) => row.code === 'invalid-import-path'), false);
  assert.deepEqual(occurrences(receipt), [
    [0, 'module', 'name'], [2, 'text', 'value'], [3, 'use', 'path'],
  ]);
  assert.deepEqual(presence(receipt), [
    [0, 'export', -1], [0, 'name', 0], [2, 'value', 1], [3, 'path', 2],
  ]);
  assert.deepEqual(receipt.symbols, []);
  assert.deepEqual(receipt.bindings, []);
  assert.deepEqual(receipt.expressionEvidence, []);
});

test('E3 RED: a candidate decorator on a detached target is dropped and never exports', () => {
  const source = 'module name=app\n  list\n    text value="detached"\n      @trace\n      export fn name=inner\n';
  f3Edges(source, [
    [0, -1, 0, -1], [1, 0, 2, 0], [2, 1, 4, 2], [4, 2, 6, 4],
  ]);
  const receipt = f4('a6-e3.kern', source);
  assert.equal(receipt.status, 'rejected');
  assert.deepEqual(receipt.detachedLogicalOrdinals, [2, 4]);
  assert.deepEqual(declarations(receipt).filter(([ordinal]) => ordinal === 2 || ordinal === 4), []);
  assert.deepEqual(attachments(receipt), [[0, 1, 'attached'], [2, 4, 'detached-local']]);
  assert.deepEqual(receipt.decorators.map((row) => [
    row.logicalOrdinal, row.disposition, row.targetLogicalOrdinal, row.explicitExport,
  ]), [[3, 'dropped', -1, false]]);
  assert.deepEqual(receipt.diagnostics.map((row) => [row.code, row.severity, row.logicalOrdinal]), [
    ['DROPPED_DECORATOR', 'warning', 3],
  ]);
  assert.deepEqual(facts(receipt), [['invalid-child', 2, 'text']]);
  assert.deepEqual(receipt.symbols, []);
  assert.deepEqual(receipt.bindings, []);
});

test('E5 RED: each intrinsically invalid nested edge retains its fact while the whole subtree closes', () => {
  const source = 'module name=app\n  list\n    fn name=detached\n      item value="child"\n';
  f3Edges(source, [
    [0, -1, 0, -1], [1, 0, 2, 0], [2, 1, 4, 2], [3, 2, 6, 4],
  ]);
  const receipt = f4('a6-e5.kern', source);
  assert.equal(receipt.status, 'rejected');
  assert.deepEqual(receipt.detachedLogicalOrdinals, [2, 3]);
  assert.deepEqual(declarations(receipt), [[0, 'module'], [1, 'list']]);
  assert.deepEqual(attachments(receipt), [[0, 1, 'attached']]);
  assert.deepEqual(facts(receipt), [
    ['invalid-child', 2, 'fn'], ['invalid-child', 3, 'item'],
  ]);
});

test('E2 RED: detached local expression work remains attempted while no evidence or S/B escapes', () => {
  const source = 'module name=app\n  list\n    fn name=detached\n      handler lang=kern\n        return value="1 + 2"\n';
  f3Edges(source, [
    [0, -1, 0, -1], [1, 0, 2, 0], [2, 1, 4, 2], [3, 2, 6, 4], [4, 3, 8, 6],
  ]);
  const receipt = f4('a6-e2.kern', source);
  assert.deepEqual(receipt.detachedLogicalOrdinals, [2, 3, 4]);
  assert.deepEqual(declarations(receipt), [[0, 'module'], [1, 'list']]);
  assert.deepEqual(receipt.expressionEvidence, []);
  assert.equal(receipt.header.f4LocalF2CallCount, 1);
  assert.equal(receipt.header.aggregateExpressionScalars, 0);
  assert.equal(receipt.header.expressionBoundaryEntries, 0);
});

test('E4 controls: unrestricted and explicit valid child trees remain fully attached', () => {
  for (const [moduleId, source, expectedAttachments] of [
    ['a6-unrestricted.kern', 'module name=app\n  page name=Home\n    text value="hello"\n',
      [[0, 1, 'attached'], [1, 2, 'attached']]],
    ['a6-explicit.kern', 'module name=app\n  list\n    item value="ok"\n',
      [[0, 1, 'attached'], [1, 2, 'attached']]],
  ]) {
    const receipt = f4(moduleId, source);
    assert.equal(receipt.status, 'classified', moduleId);
    assert.deepEqual(receipt.detachedLogicalOrdinals, [], moduleId);
    assert.deepEqual(attachments(receipt), expectedAttachments, moduleId);
    assert.deepEqual(receipt.facts, [], moduleId);
  }
});

test('E6: well-shaped F3 edge mutations drift atomically and malformed transport is invalid request', () => {
  const source = 'module name=app\n  page name=Home\n    text value="hello"\n';
  for (const operation of ['reorder', 'duplicate', 'delete', 'swap']) {
    const result = testInput(`a6-e6-${operation}.kern`, source, (input) => mutateEdges(input, operation));
    atomicFatal(result.receipt, 'F4_F3_DRIFT');
  }
  const malformed = testInput('a6-e6-malformed.kern', source, (input) => mutateEdges(input, 'malformed'));
  atomicFatal(malformed.receipt, 'F4_INVALID_REQUEST');
});

test('E8: multi-descendant max-work baseline and exact boundary preserve atomicity', () => {
  const source = 'module name=app\n  list\n    fn name=detached\n      item value="child"\n';
  const moduleId = 'a6-e8-boundary.kern';
  const baseline = __test.runDocumentWithProfileLimits(moduleId, source, {});
  assert.equal(baseline.runtimeInvocations, 1);
  const exact = __test.runDocumentWithProfileLimits(moduleId, source, {
    maxWorkSteps: baseline.receipt.workSteps,
  });
  assert.equal(exact.runtimeInvocations, 1);
  assert.equal(exact.receipt.status, baseline.receipt.status, 'exact cap preserves status');
  assert.deepEqual(exact.fields.filter((_, index) => index !== 15),
    baseline.fields.filter((_, index) => index !== 15), 'exact cap preserves semantic fields');
  const below = __test.runDocumentWithProfileLimits(moduleId, source, {
    maxWorkSteps: baseline.receipt.workSteps - 1,
  });
  assert.equal(below.runtimeInvocations, 1);
  atomicFatal(below.receipt, 'F4_LIMIT');
});

test('E9: actual F4 runtime receives ABI 109 and returns policy .4/document .2 17-field receipt', () => {
  const source = 'module name=app\n';
  const result = testInput('a6-e9.kern', source);
  const { policy } = loadPolicy();
  assert.equal(runDocument.length, 2, 'public API has no test control');
  assert.equal(policy.format, 'kern.frontend.f4-declarations-policy.4');
  assert.equal(policy.documentResultFormat, 'kern.frontend.f4-document.2');
  assert.equal(policy.documentPrivateAbi.arity, 109);
  assert.equal(result.__testActualArgs.length, 109);
  assert.equal(result.fields.length, 17);
  assert.equal(result.fields[0], policy.documentResultFormat);
});

test('E10: source guard requires cached preprojection, five chained folds, and immediate invalid-edge admission', () => {
  const helper = compliantPreprojection();
  const semantic = 'fn name=semantic\n  let name=eligibility value="cachedEligibility"\n';
  const tail = 'if cond="f4tapecount(invalidItem) != 4"\n  let name=fact value="f4row6(\"structural\", \"invalid-child\")"\n  let name=admission value="f4eligibilityleafadmit(fact)"\n';
  assert.equal(preprojectionShape(helper, semantic, tail), true, 'compliant control passes');
  assert.equal(preprojectionShape(helper.replace('assign target=work value="f2uint(attachmentFold[2])"', ''), semantic, tail), false,
    'missing fold-work assignment canary fails');
  assert.equal(preprojectionShape(helper.replace('assign target=work value="f2uint(attachmentFold[2])"', 'assign target=work value="work + 1"'), semantic, tail), false,
    'altered fold-work assignment canary fails');
  assert.equal(preprojectionShape(helper, `${semantic}let name=replay value="f4lineeligibility(rawLine)"`, tail), false,
    'semantic eligibility replay canary fails');
  assert.equal(preprojectionShape(`${helper}\n  do value="edgeChildren.push(0)"`, semantic, tail), false,
    'F3 mutation canary fails');
  const actualHelper = block(source('f4-attachment-closure.kern'), 'f4attachmentclosure');
  const actualSemantic = source('f4-declarations-semantic.kern');
  const actualTail = source('f4-declarations-semantic-tail.kernpart');
  assert.equal(preprojectionShape(actualHelper, actualSemantic, actualTail), true,
    'A6 implementation has one cached preprojection with five prospective folds');
});

test('detached local expression attempts count against L without claiming a visible-evidence cap', () => {
  const source = 'module name=app\n  list\n    fn name=detached\n      handler lang=kern\n        return value="1 + 2"\n        return value="3 + 4"\n';
  const scalarCap = loadPolicy().policy.profileLimits.maxAggregateExpressionScalars;
  const exact = __test.runDocumentWithProfileLimits('a6-detached-l-exact.kern', source, {
    maxF4LocalF2Calls: 2, maxExpressionBoundaryEntries: scalarCap + 2,
  });
  assert.equal(exact.runtimeInvocations, 1);
  assert.equal(exact.receipt.header.f4LocalF2CallCount, 2);
  assert.deepEqual(exact.receipt.expressionEvidence, []);
  const below = __test.runDocumentWithProfileLimits('a6-detached-l-below.kern', source, {
    maxF4LocalF2Calls: 1, maxExpressionBoundaryEntries: scalarCap + 1,
  });
  assert.equal(below.runtimeInvocations, 1);
  atomicFatal(below.receipt, 'F4_LIMIT');
});
