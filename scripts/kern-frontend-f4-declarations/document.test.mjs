import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DOCUMENT_FIXTURES } from './fixtures.mjs';
import { __test, loadPolicy, runDocument } from './worker.mjs';

function codes(rows) {
  return rows.map((row) => row.code);
}

function assertAtomicDocumentFatal(receipt, label) {
  assert.equal(receipt.status, 'fatal', label);
  for (const section of [
    'declarations', 'propertyOccurrences', 'propertyPresence', 'attachments',
    'decorators', 'symbols', 'bindings', 'expressionEvidence', 'facts',
  ]) {
    assert.deepEqual(receipt[section], [], `${label}: ${section}`);
  }
}

function indentation(line) {
  return line.length - line.trimStart().length;
}

function kernFunctionBlock(source, functionName) {
  const start = source.indexOf(`fn name=${functionName}`);
  const end = source.indexOf('\nfn name=', start + 1);
  assert.ok(start >= 0, `${functionName} start`);
  return source.slice(start, end < 0 ? source.length : end);
}

function nestedPropertyValueTapeScan(functionBlock) {
  const lines = functionBlock.split('\n');
  const occurrenceLoop = lines.findIndex((line) =>
    line.trim() === 'for name=ordinal from=0 to=occurrenceRawValues.length');
  assert.ok(occurrenceLoop >= 0, 'occurrence loop');
  const occurrenceIndent = indentation(lines[occurrenceLoop]);
  for (let index = occurrenceLoop + 1; index < lines.length; index += 1) {
    if (lines[index].trim() !== '' && indentation(lines[index]) <= occurrenceIndent) break;
    if (!/^(?:for|while)\b/u.test(lines[index].trim())) continue;
    const loopIndent = indentation(lines[index]);
    let loopEnd = index + 1;
    while (loopEnd < lines.length && (lines[loopEnd].trim() === '' || indentation(lines[loopEnd]) > loopIndent)) {
      loopEnd += 1;
    }
    const nestedLoop = lines.slice(index, loopEnd).join('\n');
    if (/\bpropertyValueTapes\b/u.test(lines[index]) || /propertyValueTapes(?:\.length|\[)/u.test(nestedLoop)) {
      return true;
    }
  }
  return false;
}

test('policy pins the complete 302-node and 1,149-property authorities', () => {
  const { policy } = loadPolicy();
  assert.equal(policy.format, 'kern.frontend.f4-declarations-policy.4');
  assert.equal(policy.authorities.length, 5);
  assert.equal(policy.authorities[0].rows, 302);
  assert.equal(policy.authorities[1].rows, 1451);
  assert.equal(policy.authorities[1].nodeRows + policy.authorities[1].propertyRows, 1451);
  assert.equal(policy.authorities[4].rows, 26);
});

test('empty document produces one sealed classified F4A receipt', () => {
  const result = runDocument('empty.kern', DOCUMENT_FIXTURES.empty);
  assert.equal(result.runtimeInvocations, 1);
  assert.equal(result.receipt.status, 'classified');
  assert.deepEqual(result.receipt.declarations, []);
  assert.deepEqual(result.receipt.propertyOccurrences, []);
  assert.deepEqual(result.receipt.propertyPresence, []);
  assert.deepEqual(result.receipt.attachments, []);
  assert.deepEqual(result.receipt.decorators, []);
  assert.deepEqual(result.receipt.symbols, []);
  assert.deepEqual(result.receipt.bindings, []);
  assert.deepEqual(result.receipt.facts, []);
  assert.match(result.receipt.seal, /^[0-9a-f]{64}$/u);
});

test('legacy properties retain occurrences and last-write-wins presence', () => {
  const { receipt } = runDocument('page.kern', DOCUMENT_FIXTURES.duplicateProperty);
  assert.equal(receipt.status, 'classified');
  const page = receipt.declarations.find((row) => row.kind === 'page');
  assert.ok(page);
  const names = receipt.propertyOccurrences.filter((row) => row.ownerKind === 'page' && row.propertyName === 'name');
  assert.equal(names.length, 2);
  assert.ok(names[0].startScalar < names[1].startScalar);
  assert.equal(receipt.propertyPresence.find((row) =>
    row.ownerLogicalOrdinal === page.logicalOrdinal && row.propertyName === 'name').effectiveOccurrenceOrdinal, names[1].ordinal);
  assert.deepEqual(codes(receipt.diagnostics), ['DUPLICATE_PROP']);
  assert.equal(receipt.diagnostics[0].severity, 'warning');
  assert.deepEqual(receipt.facts, []);
});

test('required omissions and unknown properties reject without a consumable interface', () => {
  const missing = runDocument('missing.kern', DOCUMENT_FIXTURES.missingRequired).receipt;
  assert.equal(missing.status, 'rejected');
  assert.ok(codes(missing.facts).includes('missing-property'));
  assert.deepEqual(missing.symbols, []);
  assert.deepEqual(missing.bindings, []);

  const unknown = runDocument('unknown.kern', DOCUMENT_FIXTURES.unknownProperty).receipt;
  assert.equal(unknown.status, 'rejected');
  assert.ok(codes(unknown.facts).includes('unknown-property'));
  assert.equal(unknown.facts.find((row) => row.code === 'unknown-property').propertyName, 'constructor');
});

test('unrestricted, explicit, and closed child catalogs are distinct', () => {
  assert.equal(runDocument('unrestricted.kern', DOCUMENT_FIXTURES.unrestrictedChild).receipt.status, 'classified');
  assert.equal(runDocument('explicit.kern', DOCUMENT_FIXTURES.explicitChild).receipt.status, 'classified');

  for (const source of [DOCUMENT_FIXTURES.invalidExplicitChild, DOCUMENT_FIXTURES.closedChild]) {
    const receipt = runDocument('invalid-child.kern', source).receipt;
    assert.equal(receipt.status, 'rejected');
    assert.ok(codes(receipt.facts).includes('invalid-child'));
    assert.ok(receipt.detachedLogicalOrdinals.length >= 1);
  }
});

test('detached subtrees are locally checked but cannot export semantic effects', () => {
  const source = 'module name=app\n  list\n    fn name=detached export=true\n      page route="/also-missing"\n';
  const { receipt } = runDocument('detached.kern', source);
  assert.equal(receipt.status, 'rejected');
  assert.ok(codes(receipt.facts).includes('invalid-child'));
  assert.ok(codes(receipt.facts).includes('missing-property'));
  assert.deepEqual(receipt.symbols, []);
});

test('decorators attach only to the immediate same-indent fn and explicit export propagates', () => {
  const attached = runDocument('attached.kern', DOCUMENT_FIXTURES.decoratorAttached).receipt;
  assert.equal(attached.status, 'classified');
  assert.equal(attached.decorators[0].disposition, 'attached');
  assert.equal(attached.decorators[0].targetLogicalOrdinal, 1);
  assert.equal(attached.symbols[0].exported, false);

  const exported = runDocument('exported.kern', DOCUMENT_FIXTURES.decoratorExported).receipt;
  assert.equal(exported.symbols[0].exported, true);

  const dropped = runDocument('dropped.kern', DOCUMENT_FIXTURES.decoratorDropped).receipt;
  assert.equal(dropped.status, 'rejected');
  assert.equal(dropped.decorators[0].disposition, 'dropped');
  assert.deepEqual(codes(dropped.diagnostics), ['DROPPED_DECORATOR', 'FRONTEND_EXCLUDED_HOST_EXPRESSION']);
  assert.deepEqual(dropped.diagnostics.map(({ startScalar }) => startScalar), [0, 28]);
});

test('C14 oracle: source position wins over phase order while an independent blocker rejects', () => {
  const source = 'return value="1 +"\nmodule name=app\n  page name=Home constructor=poison\n';
  const receipt = runDocument('diagnostic-source-order.kern', source).receipt;
  assert.equal(receipt.status, 'rejected');
  assert.ok(codes(receipt.facts).includes('unknown-property'));
  assert.deepEqual(codes(receipt.diagnostics), [
    'FRONTEND_UNSUPPORTED_MODULE_ROOT',
    'FRONTEND_INVALID_EXPRESSION',
  ]);
  assert.ok(receipt.diagnostics[0].startScalar < receipt.diagnostics[1].startScalar);
});

test('C14 oracle: an isolated decorator stays classified with exactly one dropped diagnostic', () => {
  const receipt = runDocument('isolated-decorator.kern', '@trace\nmodule name=app\n').receipt;
  assert.equal(receipt.status, 'classified');
  assert.deepEqual(codes(receipt.diagnostics), ['DROPPED_DECORATOR']);
  assert.deepEqual(receipt.facts, []);
});

test('C14 oracle: equal and decreasing phase-local keys fail atomically before an ordinary receipt', () => {
  for (const mutation of ['equal', 'decreasing']) {
    const receipt = __test.runDocumentWithPhaseKeyMutation(
      `phase-key-${mutation}.kern`,
      'fn name=main export=true\n',
      mutation,
    ).receipt;
    assertAtomicDocumentFatal(receipt, mutation);
    assert.deepEqual(codes(receipt.diagnostics), ['F4_AUTHORITY_DRIFT'], mutation);
  }
});

test('C14 RED: frozen property diagnostic ranks admit all five closed phase-0 rules', () => {
  const frozenPropertyRules = [
    ['DUPLICATE_PROP', 0],
    ['UNEXPECTED_TOKEN', 1],
    ['FRONTEND_EXCLUDED_HOST_EXPRESSION', 2],
    ['FRONTEND_EXCLUDED_HOST_TYPE', 3],
    ['FRONTEND_EXCLUDED_RAW_BLOCK', 4],
  ];
  const statuses = frozenPropertyRules.map(([code, rank]) => ({
    code,
    rank,
    status: __test.runDiagnosticPropertyRuleRank(code, rank)[0],
  }));
  assert.deepEqual(statuses, frozenPropertyRules.map(([code, rank]) => ({ code, rank, status: 'ok' })));
  assert.equal(__test.runDiagnosticPropertyRuleRank('UNEXPECTED_TOKEN', 2)[0], 'drift');
  assert.equal(__test.runDiagnosticPropertyRuleRank('UNKNOWN_DIAGNOSTIC', 0)[0], 'drift');
});

test('C14 structural/scaling guard: property occurrence admission does not rescan authority value tapes', () => {
  const source = readFileSync(new URL('../../examples/kern-frontend/f4-diagnostic-merge.kern', import.meta.url), 'utf8');
  assert.equal(nestedPropertyValueTapeScan(kernFunctionBlock(source, 'f4diagpropertyphase')), false);
  assert.equal(nestedPropertyValueTapeScan(`fn name=f4diagpropertyphase returns="string[]"
  handler lang="kern"
    for name=ordinal from=0 to=occurrenceRawValues.length
      for name=renamedCursor from=0 to=propertyValueTapes.length
        let name=valueTape value="propertyValueTapes[renamedCursor]"`), true);
  assert.equal(nestedPropertyValueTapeScan(`fn name=f4diagpropertyphase returns="string[]"
  handler lang="kern"
    for name=mapCursor from=0 to=propertyValueTapes.length
      do value="Map.set(byOrdinal, String(mapCursor), propertyValueTapes[mapCursor])"
    for name=ordinal from=0 to=occurrenceRawValues.length
      let name=valueTape value="Map.get(byOrdinal, String(propertyOrdinal))"`), false);
});

test('multiline F2B expressions and astral quoted values retain exact spans', () => {
  const expression = runDocument('expression.kern', DOCUMENT_FIXTURES.expressionBound).receipt;
  const value = expression.propertyOccurrences.find((row) => row.ownerKind === 'return' && row.propertyName === 'value');
  assert.ok(value);
  assert.ok(value.f2bSegmentOrdinal >= 0);
  assert.equal(value.valueRepresentation, 'expression');

  const astral = runDocument('astral.kern', DOCUMENT_FIXTURES.astralQuoted).receipt;
  const route = astral.propertyOccurrences.find((row) => row.propertyName === 'route');
  assert.equal(route.endScalar - route.startScalar, Array.from('route="/hello/🌍"').length);
});

test('unsupported roots reject while admitted roots produce complete symbol candidates', () => {
  const unsupported = runDocument('unsupported.kern', DOCUMENT_FIXTURES.unsupportedRoot).receipt;
  assert.equal(unsupported.status, 'rejected');
  assert.deepEqual(codes(unsupported.diagnostics), ['FRONTEND_UNSUPPORTED_MODULE_ROOT']);

  const valid = runDocument('valid.kern', DOCUMENT_FIXTURES.validModuleRoot).receipt;
  assert.equal(valid.status, 'classified');
  assert.deepEqual(valid.symbols.map(({ kind, name, exported }) => ({ kind, name, exported })), [
    { kind: 'fn', name: 'main', exported: true },
  ]);
});

test('authority and prerequisite mutations fail closed before semantic rows escape', () => {
  for (const mutation of ['authority-row-reorder', 'f1-record-kind', 'f2b-segment-span', 'f3-parent-edge']) {
    const { receipt } = __test.runDocumentWithMutation('mutated.kern', DOCUMENT_FIXTURES.validModuleRoot, mutation);
    assertAtomicDocumentFatal(receipt, mutation);
    assert.equal(receipt.diagnostics.length, 1, mutation);
    assert.match(receipt.diagnostics[0].code, /^F4_(?:AUTHORITY|F1|F2B|F3)_DRIFT$/u, mutation);
  }
});

test('F4A late failure is private to the test seam', () => {
  const publicReceipt = runDocument('f4a-late-failure.kern', DOCUMENT_FIXTURES.validModuleRoot, {
    forceLateFailure: true,
  }).receipt;
  assert.equal(publicReceipt.status, 'classified');
  const privateReceipt = __test.runDocumentWithForcedLateFailure(
    'f4a-late-failure.kern', DOCUMENT_FIXTURES.validModuleRoot,
  ).receipt;
  assertAtomicDocumentFatal(privateReceipt, 'late failure');
  assert.deepEqual(codes(privateReceipt.diagnostics), ['FORCED_LATE_FAILURE']);
});
