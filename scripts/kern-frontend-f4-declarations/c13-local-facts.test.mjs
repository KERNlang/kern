import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DOCUMENT_FIXTURES } from './fixtures.mjs';
import { __test, runDocument } from './worker.mjs';

const SEMANTIC = readFileSync(
  new URL('../../examples/kern-frontend/f4-declarations-semantic.kern', import.meta.url), 'utf8');
const TAIL = readFileSync(
  new URL('../../examples/kern-frontend/f4-declarations-semantic-tail.kernpart', import.meta.url), 'utf8');

function attempt(moduleId, source, limits = undefined) {
  return limits === undefined
    ? runDocument(moduleId, source)
    : __test.runDocumentWithProfileLimits(moduleId, source, limits);
}

function factCodes(receipt) {
  return receipt.facts.map(({ code }) => code);
}

function factBytes(result) {
  return Buffer.byteLength(result.fields[12], 'utf8');
}

function assertAtomicFatal(result, code, label) {
  assert.equal(result.fields.length, 17, `${label}: exact document arity`);
  assert.equal(result.receipt.status, 'fatal', label);
  assert.deepEqual(result.receipt.diagnostics.map(({ code: actual }) => actual), [code], label);
  for (const section of [
    'declarations', 'propertyOccurrences', 'propertyPresence', 'attachments', 'decorators',
    'symbols', 'bindings', 'facts', 'detachedLogicalOrdinals', 'expressionEvidence',
  ]) assert.deepEqual(result.receipt[section], [], `${label}: ${section} stays empty`);
}

function isAtomicLimit(result, label) {
  try {
    assertAtomicFatal(result, 'F4_LIMIT', label);
    return true;
  } catch {
    return false;
  }
}

function factPartsPushes(source) {
  return source.split('\n').flatMap((line, index) => {
    const match = line.match(/do value="factParts\.push\((.+)\)"$/u);
    return match === null ? [] : [{ line: index, value: match[1] }];
  });
}

function localFactPushViolations(source) {
  const lines = source.split('\n');
  const violations = [];
  for (const { line: index, value } of factPartsPushes(source)) {
    if (value === 'expressionFactPart' || value === 'pathFactPart') continue;
    const admission = value.match(/^([A-Za-z][A-Za-z0-9]*)\[4\]$/u);
    if (admission === null) {
      violations.push(`${index + 1}: local fact must use named admission[4]`);
      continue;
    }
    const name = admission[1];
    const start = Math.max(0, index - 12);
    const localBlock = lines.slice(start, index).join('\n');
    const admissionLine = new RegExp(
      `let name=${name} value="f4eligibilityleafadmit\\([^\\n]*, 6, [^\\n]*maxFacts, maxEncodedBytes, maxWorkSteps\\)"`, 'u');
    const guardAt = localBlock.indexOf(`if cond="${name}[0] != \\"ok\\""`);
    const guarded = guardAt >= 0 && localBlock.slice(guardAt).includes('return value=');
    if (!admissionLine.test(localBlock) || !guarded) {
      violations.push(`${index + 1}: ${name} lacks local six-field admission guard`);
    }
  }
  return violations;
}

function hasProspectiveFactFunnel(source) {
  return factPartsPushes(source).length > 0 && localFactPushViolations(source).length === 0;
}

function hasPreFoldFactCaps(source) {
  const fold = source.indexOf('f4balancedtapefold(factParts,');
  if (fold < 0) return false;
  const beforeFold = source.slice(0, fold);
  const count = beforeFold.search(/if cond="factCount > maxFacts"/u);
  const bytes = beforeFold.search(/if cond="factBytes > maxEncodedBytes"/u);
  return count >= 0 && bytes > count;
}

const FACT_CASES = [
  {
    name: 'ordinary bare token', moduleId: 'bare-facts.kern', source: 'module name=app stray other\n',
    code: 'invalid-property',
  },
  {
    name: 'malformed decorator', moduleId: 'malformed-facts.kern',
    source: '@trace tail\n@other trailing\nfn name=main\n', code: 'invalid-property',
  },
  {
    name: 'missing required property', moduleId: 'missing-facts.kern',
    source: 'module name=app\n  app name=a\n    view\n', code: 'missing-property',
  },
  {
    name: 'unknown node kind', moduleId: 'unknown-node.kern', source: 'mystery name=x\n',
    code: 'unknown-node-kind',
  },
  {
    name: 'unknown property', moduleId: 'unknown-property.kern',
    source: 'module name=app unknown=x another=y\n',
    code: 'unknown-property',
  },
  {
    name: 'rejected identifier value', moduleId: 'rejected-value.kern', source: 'fn name=1bad\nfn name=2bad\n',
    code: 'invalid-property',
  },
  {
    name: 'invalid child', moduleId: 'invalid-child.kern',
    source: 'module name=app\n  list\n    text value="detached-one"\n    text value="detached-two"\n',
    code: 'invalid-child',
  },
  {
    name: 'invalid module root', moduleId: 'invalid-root.kern', source: 'screen name=one\nscreen name=two\n',
    code: 'invalid-module-root',
  },
];

test('C13 LOCAL: every constructed-here fact family reaches its frozen public fact', async (t) => {
  for (const entry of FACT_CASES) await t.test(entry.name, () => {
    const result = attempt(entry.moduleId, entry.source);
    assert.equal(result.runtimeInvocations, 1, `${entry.name}: one actual F4 invocation`);
    assert.ok(factCodes(result.receipt).includes(entry.code), `${entry.name}: ${entry.code}`);
  });
});

test('C13 LOCAL: count ceilings distinguish exact aggregate capacity from the next fact', async (t) => {
  for (const entry of FACT_CASES) await t.test(entry.name, () => {
    const baseline = attempt(entry.moduleId, entry.source);
    const count = baseline.receipt.facts.length;
    assert.ok(count >= 2, `${entry.name}: policy-valid cap-minus-one baseline facts`);
    const exact = attempt(entry.moduleId, entry.source, { maxFacts: count });
    assert.notEqual(exact.receipt.status, 'fatal', `${entry.name}: exact fact count remains admitted`);
    const below = attempt(entry.moduleId, entry.source, { maxFacts: count - 1 });
    assertAtomicFatal(below, 'F4_LIMIT', `${entry.name}: cap minus one`);
  });
});

test('C13 LOCAL: diagnostic-free child facts have an independent UTF-8 cap crossing', async (t) => {
  for (const entry of FACT_CASES.filter(({ code }) => code === 'invalid-child')) {
    await t.test(entry.name, () => {
      const baseline = attempt(entry.moduleId, entry.source);
      const bytes = factBytes(baseline);
      assert.ok(bytes >= 64, `${entry.name}: policy-valid byte threshold`);
      const exact = attempt(entry.moduleId, entry.source, { maxEncodedBytes: bytes });
      assert.notEqual(exact.receipt.status, 'fatal', `${entry.name}: exact fact bytes remain admitted`);
      const below = attempt(entry.moduleId, entry.source, { maxEncodedBytes: bytes - 1 });
      assertAtomicFatal(below, 'F4_LIMIT', `${entry.name}: fact bytes minus one`);
    });
  }
});

test('C13 LOCAL RED: astral local facts use Buffer UTF-8 exact and one-less boundaries', () => {
  const moduleId = 'astral-unknown-property.kern';
  const source = 'module name=app 🌍=x 🌍=y\n';
  const baseline = attempt(moduleId, source);
  assert.deepEqual(factCodes(baseline.receipt), ['unknown-property', 'unknown-property']);
  assert.deepEqual(baseline.receipt.diagnostics, [], 'facts, not diagnostics, own this byte boundary');
  const bytes = factBytes(baseline);
  assert.ok(bytes > Array.from(baseline.fields[12]).length, 'astral property names add UTF-8 bytes');
  assert.equal(factBytes(baseline), Buffer.byteLength(baseline.fields[12], 'utf8'));
  assert.notEqual(attempt(moduleId, source, { maxEncodedBytes: bytes }).receipt.status, 'fatal');
  assertAtomicFatal(attempt(moduleId, source, { maxEncodedBytes: bytes - 1 }), 'F4_LIMIT', 'astral fact bytes minus one');
});

test('C13 LOCAL: a mixed unknown-property plus invalid-child source admits cumulatively or fails atomically', () => {
  const moduleId = 'mixed-c13.kern';
  const source = 'module name=app unknown=x\n  list\n    text value="detached"\n';
  const baseline = attempt(moduleId, source);
  assert.ok(factCodes(baseline.receipt).includes('unknown-property'));
  assert.ok(factCodes(baseline.receipt).includes('invalid-child'));
  const count = baseline.receipt.facts.length;
  assert.notEqual(attempt(moduleId, source, { maxFacts: count }).receipt.status, 'fatal');
  assertAtomicFatal(attempt(moduleId, source, { maxFacts: count - 1 }), 'F4_LIMIT', 'mixed cap minus one');
});

test('C13 LOCAL: a precomputed exact work ceiling remains an observable control', () => {
  const moduleId = 'child-work.kern';
  const source = DOCUMENT_FIXTURES.invalidExplicitChild;
  const baseline = attempt(moduleId, source);
  const work = baseline.receipt.workSteps;
  assert.ok(work > 0, 'baseline exposes positive KERN work');
  assert.notEqual(attempt(moduleId, source, { maxWorkSteps: work }).receipt.status, 'fatal');
  assertAtomicFatal(attempt(moduleId, source, { maxWorkSteps: work - 1 }), 'F4_LIMIT', 'work cap minus one');
});

test('C13 LOCAL: authority and transported prerequisite drift dominate constructed facts', () => {
  const source = 'module name=app unknown=x\n';
  for (const mutation of ['authority-row-reorder', 'f1-record-kind']) {
    const result = __test.runDocumentWithMutation('drift-precedence.kern', source, mutation);
    assert.equal(result.runtimeInvocations, 1, `${mutation}: one F4 invocation`);
    assertAtomicFatal(result, mutation === 'authority-row-reorder' ? 'F4_AUTHORITY_DRIFT' : 'F4_F1_DRIFT', mutation);
  }
});

test('C13 LOCAL RED: every constructed fact writer must use a prospective funnel, not the late maxFacts check', () => {
  const unsafe = [
    ...localFactPushViolations(SEMANTIC).map((entry) => `semantic:${entry}`),
    ...localFactPushViolations(TAIL).map((entry) => `tail:${entry}`),
  ];
  assert.deepEqual(unsafe, [], `unadmitted fact writers: ${unsafe.join(', ')}`);
  assert.equal(hasProspectiveFactFunnel('if cond="factCount > maxFacts"\n  return value="late"'), false,
    'a terminal late count check alone is not a prospective admission funnel');
  assert.equal(hasProspectiveFactFunnel([
    'let name=admitted value="f4eligibilityleafadmit(row, 6, count, bytes, work, maxFacts, maxEncodedBytes, maxWorkSteps)"',
    'if cond="admitted[0] != "ok""', '  return value=failure', 'do value="factParts.push(admitted[4])"',
  ].join('\n')), true, 'the canary recognizes a locally guarded six-field admission');
});

test('C13 LOCAL RED: fact count and bytes must be guarded before the balanced fold', () => {
  assert.equal(hasPreFoldFactCaps(TAIL), true,
    'the tail checks aggregate fact count then bytes before folding retained fact parts');
  assert.equal(hasPreFoldFactCaps('if cond="factCount > maxFacts"\n  return value="late"\nf4balancedtapefold(factParts, work, cap)'), false,
    'a count-only late guard cannot stand in for sequential pre-fold fact caps');
});

test('C13 LOCAL canary self-check: local bypasses cannot borrow another admission', () => {
  assert.deepEqual(localFactPushViolations('do value="factParts.push(preframed)"'),
    ['1: local fact must use named admission[4]']);
  assert.deepEqual(localFactPushViolations([
    'let name=dummy value="f4eligibilityleafadmit(row, 6, count, bytes, work, maxFacts, maxEncodedBytes, maxWorkSteps)"',
    'if cond="dummy[0] != "ok""', '  return value=failure', 'do value="factParts.push(f4item(row))"',
  ].join('\n')), ['4: local fact must use named admission[4]']);
  assert.equal(isAtomicLimit({ fields: [], receipt: { status: 'rejected', diagnostics: [] } }, 'synthetic'), false);
});
