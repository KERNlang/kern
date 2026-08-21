import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runDocument as runF3Document } from '../kern-frontend-f3-line-tree/worker.mjs';
import { __test, loadPolicy, runDocument } from './worker.mjs';

const ELIGIBILITY_SOURCE = readFileSync(
  new URL('../../examples/kern-frontend/f4-line-eligibility.kern', import.meta.url), 'utf8');
const DIAGNOSTIC_SOURCE = readFileSync(
  new URL('../../examples/kern-frontend/f4-diagnostic-merge.kern', import.meta.url), 'utf8');

function f4(moduleId, source) {
  const result = runDocument(moduleId, source);
  assert.equal(result.runtimeInvocations, 1, `${moduleId}: one real F4 invocation`);
  return result.receipt;
}

function f3(source) {
  const result = runF3Document(source);
  assert.equal(result.runtimeInvocations, 1, 'one real F3 invocation');
  assert.equal(result.receipt.status, 'structured');
  return result;
}

function decoratorRows(receipt) {
  // F4 scalar spans include indentation, exclude the physical newline, and use an exclusive end.
  return receipt.decorators.map((row) => [
    row.logicalOrdinal, row.disposition, row.targetLogicalOrdinal, row.explicitExport,
    row.startScalar, row.endScalar,
  ]);
}

function diagnostics(receipt) {
  return receipt.diagnostics.map((row) => [
    row.code, row.severity, row.startScalar, row.endScalar, row.logicalOrdinal,
  ]);
}

function atomicFatal(receipt, code, label) {
  assert.equal(receipt.status, 'fatal', label);
  assert.deepEqual(receipt.diagnostics.map((row) => row.code), [code], label);
  for (const key of ['declarations', 'propertyOccurrences', 'propertyPresence', 'attachments',
    'decorators', 'symbols', 'bindings', 'facts', 'detachedLogicalOrdinals', 'expressionEvidence']) {
    assert.deepEqual(receipt[key], [], `${label}: ${key}`);
  }
}

function functionBlock(source, name) {
  const start = source.indexOf(`fn name=${name}`);
  assert.notEqual(start, -1, `${name}: function exists`);
  const end = source.indexOf('\nfn name=', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}

function projectionFailures(eligibilitySource, diagnosticSource) {
  const projection = functionBlock(eligibilitySource, 'f4decoratorrows');
  const diagnostic = functionBlock(diagnosticSource, 'f4diagdecoratorphase');
  return [
    ['transport run loop', projection.includes('for name=eligibilityDecoratorRun from=0 to=decoratorFirsts.length')],
    ['per-line row loop', projection.includes('for name=eligibilityDecoratorLine from=0 to=lineStarts.length')],
    ['run membership', projection.includes('let name=inRun value="eligibilityDecoratorLine <= activeLast"')],
    ['transported disposition', projection.includes('let name=disposition value="inRun ? activeDisposition : \\"candidate\\""')],
    ['candidate fn predicate', projection.includes('disposition == \\"candidate\\" && successorInRange && successorKind == \\"fn\\"')],
    ['indent and detached predicate', projection.includes('successorIndent == decoratorIndent && !successorDetached')],
    ['row disposition', projection.includes('attach ? \\"attached\\" : \\"dropped\\"')],
    ['explicit export predicate', projection.includes('if cond="attach && explicit"')],
    ['diagnostic row loop', diagnostic.includes('while cond="cursor < Text.length(decorators)"')],
    ['dropped warning predicate', diagnostic.includes('if cond="f4tapefield(item[0], 1) == \\"dropped\\""')],
    ['warning append', diagnostic.includes('publicParts.push(f4item(row))')],
  ].filter(([, passes]) => !passes).map(([name]) => name);
}

function mutateDecoratorTransport(input, operation) {
  const keys = ['decoratorFirsts', 'decoratorLasts', 'decoratorSuccessors', 'decoratorDispositions'];
  const vectors = keys.map((key) => input[key]);
  const minimum = operation === 'swap' || operation === 'successor' ? 2 : 1;
  assert.ok(vectors.every((vector) => vector.length >= minimum),
    `${operation}: needs ${minimum} run(s), got ${vectors.map((vector) => vector.length).join('/')}`);
  if (operation === 'delete') {
    for (const vector of vectors) vector.splice(0, 1);
  } else if (operation === 'duplicate') {
    for (const vector of vectors) vector.splice(0, 0, vector[0]);
  } else if (operation === 'swap') {
    for (const vector of vectors) [vector[0], vector[1]] = [vector[1], vector[0]];
  } else if (operation === 'successor') {
    input.decoratorSuccessors[0] = input.decoratorSuccessors[1];
  } else if (operation === 'disposition') {
    input.decoratorDispositions[0] = input.decoratorDispositions[0] === 'candidate' ?
      'orphan-indent' : 'candidate';
  } else if (operation === 'malformed') {
    input.decoratorDispositions.pop();
  } else {
    throw new Error(`unknown decorator transport mutation ${operation}`);
  }
}

test('A4-D1: a plain decorator run attaches in order and explicit export is an independent control', () => {
  const runSource = '@first\n@second\nfn name=main\n';
  const runF3 = f3(runSource).receipt;
  assert.deepEqual(runF3.decoratorRuns, [{
    runOrdinal: 0, firstDecoratorOrdinal: 0, lastDecoratorOrdinal: 1,
    successorOrdinal: 2, disposition: 'candidate',
  }]);
  const runReceipt = f4('a4-attached-run.kern', runSource);
  assert.equal(runReceipt.status, 'classified');
  assert.deepEqual(decoratorRows(runReceipt), [
    [0, 'attached', 2, false, 0, 6],
    [1, 'attached', 2, false, 7, 14],
  ]);
  assert.deepEqual(runReceipt.diagnostics, []);
  assert.deepEqual(runReceipt.symbols.map((row) => [row.kind, row.name, row.exported]),
    [['fn', 'main', false]]);

  const explicitSource = 'export @trace\nfn name=main\n';
  assert.deepEqual(f3(explicitSource).receipt.decoratorRuns, [], 'export prefix is not an F3 run row');
  const explicit = f4('a4-explicit.kern', explicitSource);
  assert.deepEqual(decoratorRows(explicit), [[0, 'attached', 1, true, 0, 13]]);
  assert.deepEqual(explicit.symbols.map((row) => [row.kind, row.name, row.exported]),
    [['fn', 'main', true]]);
  assert.deepEqual(explicit.diagnostics, []);
});

test('A4-D2/D7: explicit non-fn and detached targets drop without export effects', () => {
  const nonFn = f4('a4-explicit-drop.kern', 'export @trace\ntype name=Alias alias=string\n');
  assert.equal(nonFn.status, 'rejected');
  assert.deepEqual(decoratorRows(nonFn), [[0, 'dropped', -1, true, 0, 13]]);
  assert.equal(nonFn.symbols.some((row) => row.exported), false);
  assert.equal(nonFn.diagnostics.filter((row) => row.code === 'DROPPED_DECORATOR').length, 1);

  const detachedSource = 'module name=app\n  list\n    text value="detached"\n      @trace\n      export fn name=inner\n';
  const detached = f4('a4-detached.kern', detachedSource);
  assert.deepEqual(detached.detachedLogicalOrdinals, [2, 4]);
  assert.deepEqual(decoratorRows(detached), [[3, 'dropped', -1, false, 49, 61]]);
  assert.deepEqual(diagnostics(detached).filter(([code]) => code === 'DROPPED_DECORATOR'),
    [['DROPPED_DECORATOR', 'warning', 49, 61, 3]]);
  assert.deepEqual(detached.symbols, []);
  assert.deepEqual(detached.bindings, []);
  assert.deepEqual(detached.expressionEvidence, []);
});

test('A4-D3: every decorator in an EOF run drops with its own ordered warning', () => {
  const source = 'fn name=main\n@eofA\n@eofB\n';
  assert.deepEqual(f3(source).receipt.decoratorRuns, [{
    runOrdinal: 0, firstDecoratorOrdinal: 1, lastDecoratorOrdinal: 2,
    successorOrdinal: -1, disposition: 'orphan-eof',
  }]);
  const receipt = f4('a4-eof.kern', source);
  assert.deepEqual(decoratorRows(receipt), [
    [1, 'dropped', -1, false, 13, 18],
    [2, 'dropped', -1, false, 19, 24],
  ]);
  assert.deepEqual(diagnostics(receipt), [
    ['DROPPED_DECORATOR', 'warning', 13, 18, 1],
    ['DROPPED_DECORATOR', 'warning', 19, 24, 2],
  ]);
});

test('A4-D4: every decorator in an indent-orphan run drops and the successor remains independent', () => {
  const source = 'module name=app\n  @indentA\n  @indentB\n    fn name=inner\n';
  assert.deepEqual(f3(source).receipt.decoratorRuns, [{
    runOrdinal: 0, firstDecoratorOrdinal: 1, lastDecoratorOrdinal: 2,
    successorOrdinal: 3, disposition: 'orphan-indent',
  }]);
  const receipt = f4('a4-indent.kern', source);
  assert.deepEqual(decoratorRows(receipt), [
    [1, 'dropped', -1, false, 16, 26],
    [2, 'dropped', -1, false, 27, 37],
  ]);
  assert.deepEqual(diagnostics(receipt), [
    ['DROPPED_DECORATOR', 'warning', 16, 26, 1],
    ['DROPPED_DECORATOR', 'warning', 27, 37, 2],
  ]);
  assert.deepEqual(receipt.declarations.map((row) => [row.logicalOrdinal, row.kind]),
    [[0, 'module'], [1, 'decorator'], [2, 'decorator'], [3, 'fn']]);
});

test('A4-D5: equal F3 geometry diverges only at KERN-owned fn versus non-fn projection', () => {
  const fnSource = '@trace\nfn name=WorldX\n';
  const typeSource = '@trace\ntype name=Main\n';
  const fnF3 = f3(fnSource);
  const typeF3 = f3(typeSource);
  assert.deepEqual(fnF3.fields, typeF3.fields);
  const fn = f4('a4-fn.kern', fnSource);
  const type = f4('a4-type.kern', typeSource);
  assert.deepEqual(decoratorRows(fn).map((row) => row.slice(0, 4)), [[0, 'attached', 1, false]]);
  assert.deepEqual(decoratorRows(type).map((row) => row.slice(0, 4)), [[0, 'dropped', -1, false]]);
  assert.deepEqual(type.declarations.map((row) => [row.logicalOrdinal, row.kind]),
    [[0, 'decorator'], [1, 'type']]);
});

test('A4-D6: malformed candidates never produce decorator rows or dropped warnings', () => {
  for (const [moduleId, source] of [
    ['a4-malformed-trailing.kern', '@trace tail\nfn name=main\n'],
    ['a4-malformed-path.kern', '@bad..name\nfn name=main\n'],
    ['a4-malformed-args.kern', '@trace(foo\nfn name=main\n'],
  ]) {
    const receipt = f4(moduleId, source);
    assert.equal(receipt.status, 'rejected', moduleId);
    assert.deepEqual(receipt.decorators, [], moduleId);
    assert.equal(receipt.diagnostics.some((row) => row.code === 'DROPPED_DECORATOR'), false, moduleId);
    assert.deepEqual(receipt.diagnostics.map((row) => row.code), ['UNEXPECTED_TOKEN'], moduleId);
    assert.deepEqual(receipt.facts.map((row) => row.code), ['invalid-property'], moduleId);
  }
});

test('A4-D8: composite rows and diagnostics preserve exact source order without deduplication', () => {
  const source = '@a\nexport @b\nfn name=one\n@c\ntype name=Alias alias=string\nmodule name=app\n  @d\n    fn name=inner\n@bad tail\n@e\n@f\n';
  const receipt = f4('a4-composite.kern', source);
  assert.equal(receipt.status, 'rejected');
  assert.deepEqual(decoratorRows(receipt).map((row) => row.slice(0, 4)), [
    [0, 'dropped', -1, false], [1, 'attached', 2, true], [3, 'dropped', -1, false],
    [6, 'dropped', -1, false], [9, 'dropped', -1, false], [10, 'dropped', -1, false],
  ]);
  assert.deepEqual(diagnostics(receipt), [
    ['DROPPED_DECORATOR', 'warning', 0, 2, 0],
    ['DROPPED_DECORATOR', 'warning', 25, 27, 3],
    ['FRONTEND_EXCLUDED_HOST_EXPRESSION', 'error', 50, 56, 4],
    ['DROPPED_DECORATOR', 'warning', 73, 77, 6],
    ['UNEXPECTED_TOKEN', 'error', 96, 105, 8],
    ['DROPPED_DECORATOR', 'warning', 106, 108, 9],
    ['DROPPED_DECORATOR', 'warning', 109, 111, 10],
  ]);
  const starts = receipt.diagnostics.map((row) => row.startScalar);
  assert.deepEqual(starts, [...starts].sort((left, right) => left - right), 'C14 source order is monotonic');
  assert.equal(receipt.diagnostics.filter((row) => row.code === 'DROPPED_DECORATOR').length, 5);
});

test('A4-D9: public isolation and frozen policy, document, and ABI identities remain exact', () => {
  const source = '@trace\nfn name=main\n';
  const result = __test.runDocumentWithTestInput('a4-identity.kern', source, { mutateInput() {} });
  const { policy } = loadPolicy();
  assert.equal(runDocument.length, 2);
  assert.equal(policy.format, 'kern.frontend.f4-declarations-policy.4');
  assert.equal(policy.documentResultFormat, 'kern.frontend.f4-document.2');
  assert.equal(policy.documentPrivateAbi.arity, 109);
  assert.equal(result.__testActualArgs.length, 109);
  assert.equal(result.fields.length, 17);
  assert.equal(result.fields[0], policy.documentResultFormat);
});

test('A4-D10: decorator-run transport mutations fail atomically before semantic rows escape', () => {
  const source = '@first\nfn name=one\n@second\nfn name=two\n';
  for (const operation of ['delete', 'duplicate', 'swap', 'successor', 'disposition']) {
    const result = __test.runDocumentWithTestInput(`a4-f3-${operation}.kern`, source, {
      mutateInput(input) { mutateDecoratorTransport(input, operation); },
    });
    assert.equal(result.__testOutcome, 'returned', operation);
    assert.equal(result.runtimeInvocations, 1, operation);
    atomicFatal(result.receipt, 'F4_F3_DRIFT', operation);
  }
  const malformed = __test.runDocumentWithTestInput('a4-f3-malformed.kern', source, {
    mutateInput(input) { mutateDecoratorTransport(input, 'malformed'); },
  });
  assert.equal(malformed.__testOutcome, 'returned');
  assert.equal(malformed.runtimeInvocations, 1);
  atomicFatal(malformed.receipt, 'F4_INVALID_REQUEST', 'malformed transport');
});

test('A4-D11/D12: structural canaries kill per-run, disposition, target-kind, and warning suppression', () => {
  assert.deepEqual(projectionFailures(ELIGIBILITY_SOURCE, DIAGNOSTIC_SOURCE), [], 'current source is complete');
  for (const [name, eligibility, diagnostic] of [
    ['per-run emission', ELIGIBILITY_SOURCE.replace(
      'for name=eligibilityDecoratorLine from=0 to=lineStarts.length',
      'for name=eligibilityDecoratorRun from=0 to=decoratorFirsts.length'), DIAGNOSTIC_SOURCE],
    ['ignore disposition', ELIGIBILITY_SOURCE.replace(
      'let name=disposition value="inRun ? activeDisposition : \\"candidate\\""',
      'let name=disposition value="\\"candidate\\""'), DIAGNOSTIC_SOURCE],
    ['attach regardless of kind', ELIGIBILITY_SOURCE.replace(
      'successorKind == \\"fn\\"', 'successorKind != \\"\\"'), DIAGNOSTIC_SOURCE],
    ['drop row suppressed', ELIGIBILITY_SOURCE, DIAGNOSTIC_SOURCE.replace(
      'if cond="f4tapefield(item[0], 1) == \\"dropped\\""',
      'if cond="f4tapefield(item[0], 1) == \\"attached\\""')],
    ['warning append removed', ELIGIBILITY_SOURCE, DIAGNOSTIC_SOURCE.replace(
      'do value="publicParts.push(f4item(row))"', 'do value="String(row)"')],
  ]) assert.notDeepEqual(projectionFailures(eligibility, diagnostic), [], name);
});
