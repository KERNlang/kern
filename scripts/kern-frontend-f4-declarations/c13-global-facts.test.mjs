import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { __test, runDocument } from './worker.mjs';

const ROOT_PACKAGE = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const EXPRESSION_SOURCE = readFileSync(
  new URL('../../examples/kern-frontend/f4-expression-evidence.kern', import.meta.url), 'utf8');
const PATH_SOURCE = readFileSync(
  new URL('../../examples/kern-frontend/f4-path-contract.kern', import.meta.url), 'utf8');
const SEMANTIC_TAIL = readFileSync(
  new URL('../../examples/kern-frontend/f4-declarations-semantic-tail.kernpart', import.meta.url), 'utf8');

const CASES = [
  {
    label: 'expression',
    moduleId: 'c13-global-expression-🌍.kern',
    source: 'fn name=bad stray\n  handler lang=kern\n    return value="1 +"\n',
    facts: ['invalid-property', 'invalid-expression'],
  },
  {
    label: 'path',
    moduleId: 'dir/c13-global-path-🌍.kern',
    source: 'module name=app stray\n  use path="../../escape.kern"\n',
    facts: ['invalid-property', 'invalid-import-path'],
  },
];

const PREFIX_LIMIT_CASES = [
  {
    label: 'expression prefix',
    moduleId: 'c13-global-expression-prefix.kern',
    source: 'fn name=bad stray\n  handler lang=kern\n    return value="1 +" value="2 +"\n',
    facts: ['invalid-property', 'invalid-expression', 'invalid-expression'],
  },
  {
    label: 'path prefix',
    moduleId: 'dir/c13-global-path-prefix.kern',
    source: 'module name=app stray\n  use path="../../one.kern"\n  use path="../../two.kern"\n',
    facts: ['invalid-property', 'invalid-import-path', 'invalid-import-path'],
  },
];

function assertAtomicLimit(result, label) {
  assert.equal(result.runtimeInvocations, 1, `${label}: one real F4 invocation`);
  assert.equal(result.receipt.status, 'fatal', label);
  assert.deepEqual(result.receipt.diagnostics.map(({ code }) => code), ['F4_LIMIT'], label);
  for (const field of [
    'declarations', 'propertyOccurrences', 'propertyPresence', 'attachments', 'decorators',
    'symbols', 'bindings', 'facts', 'detachedLogicalOrdinals', 'expressionEvidence',
  ]) assert.deepEqual(result.receipt[field], [], `${label}: ${field} is atomic`);
}

function frame(value) {
  return `i${Array.from(value).length}:${value}`;
}

function functionBody(source, name) {
  const marker = `fn name=${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const next = source.indexOf('\nfn name=', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next + 1);
}

function globalFactProducerViolations(source, name) {
  const body = functionBody(source, name);
  const violations = [];
  if (/f4append\(facts,/u.test(body)) violations.push('growing fact prefix');
  const candidates = [...body.matchAll(
    /f4row6\([^\n]*\\"(?:invalid-expression|invalid-import-path)\\"[^\n]*\)/gu)].length;
  const admissions = [...body.matchAll(/f4globalfactadmit\(/gu)].length;
  if (candidates === 0 || admissions !== candidates) {
    violations.push(`global admission mismatch ${admissions}/${candidates}`);
  }
  if (!/f4balancedtapefold\(/u.test(body)) violations.push('missing bounded fact fold');
  const terminals = [...body.matchAll(/f4globalfactterminal\(/gu)].length;
  if (candidates === 0 || terminals !== candidates) {
    violations.push(`global terminal mismatch ${terminals}/${candidates}`);
  }
  if (!/factCount/u.test(body) || !/factBytes/u.test(body) || !/maxFacts/u.test(body) ||
      !/maxEncodedBytes/u.test(body) || !/maxWorkSteps/u.test(body)) {
    violations.push('missing cumulative fact state or cap');
  }
  return violations;
}

function globalFactConsumerViolations(source) {
  const violations = [];
  for (const stale of [
    'f4framedtapeparts(expressionResult[3], 6)',
    'f4framedtapeparts(pathBindings[2], 6)',
  ]) if (source.includes(stale)) violations.push(`wholesale materialization: ${stale}`);
  for (const tuple of [
    ['expressionResult', 'expressionFactParts', 11, 12, 13, 10, 11, 14],
    ['pathBindings', 'pathFactParts', 5, 6, 7, 4, 5, 8],
  ]) {
    const [name, verified, count, bytes, work, legacyWork, legacyWidth, fullWidth] = tuple;
    const legacyGate = `if cond="${name}.length == ${legacyWidth}"`;
    const fullGate = `if cond="${name}.length != ${fullWidth}"`;
    const firstAppendedRead = source.indexOf(`${name}[${count}]`);
    if (source.indexOf(legacyGate) < 0 || source.indexOf(legacyGate) > firstAppendedRead ||
        source.indexOf(fullGate) < 0 || source.indexOf(fullGate) > firstAppendedRead) {
      violations.push(`missing ${name} width-before-index gate`);
    }
    for (const [target, owner, slot] of [
      ['factCount', name, count], ['factBytes', name, bytes], ['workSteps', verified, 3],
    ]) {
      const adoption = new RegExp(`assign target=${target} value="f2uint\\(${owner}\\[${slot}\\]\\)"`, 'u');
      if (!adoption.test(source)) violations.push(`missing ${name} ${target} adoption`);
    }
    const verifierCall = new RegExp(`f4globalfactverify\\(${name}\\[`, 'u');
    if (!verifierCall.test(source) || !source.includes(`f2uint(${name}[${work}])`)) {
      violations.push(`missing ${name} producer work verification`);
    }
    const duplicateWork = new RegExp(`workSteps \\+ (?:f2uint\\()?${name}\\[${legacyWork}\\]`, 'u');
    if (duplicateWork.test(source)) violations.push(`duplicate ${name} legacy work`);
  }
  const verifications = [...source.matchAll(/f4globalfactverify\(/gu)].length;
  if (verifications !== 2) violations.push(`root verifier count ${verifications}/2`);
  return violations;
}

test('C13 GLOBAL public count and work crossings are atomic after an admitted local prefix', async (t) => {
  for (const entry of CASES) await t.test(entry.label, () => {
    const baseline = runDocument(entry.moduleId, entry.source);
    assert.equal(baseline.runtimeInvocations, 1);
    assert.equal(baseline.receipt.status, 'rejected');
    assert.deepEqual(baseline.receipt.facts.map(({ code }) => code), entry.facts,
      'local fact then imported producer fact retain source order');

    const exactCount = __test.runDocumentWithProfileLimits(entry.moduleId, entry.source, {
      maxFacts: entry.facts.length,
    });
    assert.deepEqual(exactCount.receipt.facts.map(({ code }) => code), entry.facts);
    assertAtomicLimit(__test.runDocumentWithProfileLimits(entry.moduleId, entry.source, {
      maxFacts: entry.facts.length - 1,
    }), `${entry.label}: count minus one`);

    const exactWork = __test.runDocumentWithProfileLimits(entry.moduleId, entry.source, {
      maxWorkSteps: baseline.receipt.workSteps,
    });
    assert.deepEqual(exactWork.receipt.facts.map(({ code }) => code), entry.facts);
    assertAtomicLimit(__test.runDocumentWithProfileLimits(entry.moduleId, entry.source, {
      maxWorkSteps: baseline.receipt.workSteps - 1,
    }), `${entry.label}: work minus one`);

    const afterFatal = runDocument(entry.moduleId, entry.source);
    assert.deepEqual(afterFatal.fields, baseline.fields,
      `${entry.label}: a fatal invocation cannot bleed handler-local state into the next execution`);
  });
});

test('C13 GLOBAL a second imported fact crossing preserves and verifies the admitted prefix', async (t) => {
  for (const entry of PREFIX_LIMIT_CASES) await t.test(entry.label, () => {
    const baseline = runDocument(entry.moduleId, entry.source);
    assert.equal(baseline.receipt.status, 'rejected');
    assert.deepEqual(baseline.receipt.facts.map(({ code }) => code), entry.facts);
    assertAtomicLimit(__test.runDocumentWithProfileLimits(entry.moduleId, entry.source, {
      maxFacts: entry.facts.length - 1,
    }), `${entry.label}: verified prefix limit`);
  });
});

test('C13 GLOBAL malformed returned tape wins before a simultaneous work limit', () => {
  assert.deepEqual(__test.runGlobalFactVerify('i1:x', 0, 0, 0, 0, 1, 4, 1, 0), ['drift']);
});

test('C13 GLOBAL verification charges its traversal and fold exactly once after producer work', () => {
  const row = ['structural', 'invalid-expression', '0', '1', '-1', '0'].map(frame).join('');
  const tape = frame(row);
  const bytes = Buffer.byteLength(tape, 'utf8');
  assert.deepEqual(__test.runGlobalFactVerify(tape, 0, 0, 5, 3, 1, bytes, 9, 10),
    ['ok', '1', String(bytes), '10', tape],
    'producer work 9 plus one verifier traversal step is adopted exactly once');
  assert.deepEqual(__test.runGlobalFactVerify(tape, 0, 0, 5, 3, 1, bytes, 9, 9), ['limit'],
    'the independently charged verification step crosses a cap of nine');
});

test('C13 GLOBAL producer and consumer source structure closes pre-admission allocation', () => {
  assert.deepEqual(globalFactProducerViolations(EXPRESSION_SOURCE, 'f4expressionevidence'), [],
    'expression producer owns prospective fact admission and bounded folding');
  assert.deepEqual(globalFactProducerViolations(PATH_SOURCE, 'f4pathbindings'), [],
    'path producer owns prospective fact admission and bounded folding');
  assert.deepEqual(globalFactConsumerViolations(SEMANTIC_TAIL), [],
    'root verifies and adopts the private cumulative fact state without wholesale materialization');

  assert.deepEqual(globalFactProducerViolations('fn name=f4expressionevidence\n  assign target=facts value="f4append(facts, row)"\n',
    'f4expressionevidence'), [
    'growing fact prefix', 'global admission mismatch 0/0', 'missing bounded fact fold',
    'global terminal mismatch 0/0',
    'missing cumulative fact state or cap',
  ], 'producer canary rejects growing-prefix and missing admission state');
  assert.ok(globalFactConsumerViolations(
    'f4framedtapeparts(expressionResult[3], 6)\nf4framedtapeparts(pathBindings[2], 6)\n').length >= 3,
  'consumer canary rejects wholesale parsing and missing state adoption');
  const shallowConsumer = [
    'f4globalfactverify(expressionResult[3])', 'f4globalfactverify(pathBindings[2])',
    'assign target=factCount value="f2uint(expressionResult[11])"',
    'assign target=factBytes value="f2uint(expressionResult[12])"',
    'assign target=workSteps value="workSteps + f2uint(expressionResult[10])"',
    'assign target=factCount value="f2uint(pathBindings[5])"',
    'assign target=factBytes value="f2uint(pathBindings[6])"',
    'assign target=workSteps value="workSteps + pathBindings[4]"',
  ].join('\n');
  assert.deepEqual(globalFactConsumerViolations(shallowConsumer), [
    'missing expressionResult width-before-index gate',
    'missing expressionResult workSteps adoption',
    'missing expressionResult producer work verification', 'duplicate expressionResult legacy work',
    'missing pathBindings width-before-index gate',
    'missing pathBindings workSteps adoption',
    'missing pathBindings producer work verification', 'duplicate pathBindings legacy work',
  ], 'consumer canary rejects shallow slot mentions and duplicate legacy work');
});

test('C13 GLOBAL oracle is included by the existing unpromoted F4 root glob', () => {
  assert.match(ROOT_PACKAGE.scripts['test:kern-frontend-f4-declarations'],
    /scripts\/kern-frontend-f4-declarations\/\*\.test\.mjs/u);
  assert.equal(Object.prototype.hasOwnProperty.call(ROOT_PACKAGE.scripts, 'test:kern-frontend'), false,
    'M3 does not promote the terminal frontend gate');
});
