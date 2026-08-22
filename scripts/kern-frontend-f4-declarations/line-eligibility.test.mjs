import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runDocument as runF3Document } from '../kern-frontend-f3-line-tree/worker.mjs';
import { sha256 } from './decoder.mjs';
import { __test, loadPolicy, runDocument } from './worker.mjs';

const ELIGIBILITY_SOURCE = readFileSync(
  new URL('../../examples/kern-frontend/f4-line-eligibility.kern', import.meta.url), 'utf8');
const SEMANTIC_SOURCE = readFileSync(
  new URL('../../examples/kern-frontend/f4-declarations-semantic.kern', import.meta.url), 'utf8');
const DIAGNOSTIC_SOURCE = readFileSync(
  new URL('../../examples/kern-frontend/f4-diagnostic-merge.kern', import.meta.url), 'utf8');

function result(moduleId, source) {
  const value = runDocument(moduleId, source);
  assert.equal(value.runtimeInvocations, 1, `${moduleId}: one actual F4 invocation`);
  return value.receipt;
}

function fact(row) {
  return [row.code, row.startScalar, row.endScalar, row.logicalOrdinal, row.propertyName];
}

function diagnostic(row) {
  return [row.code, row.severity, row.startScalar, row.endScalar, row.logicalOrdinal];
}

function interfaceRows(receipt) {
  return { symbols: receipt.symbols, bindings: receipt.bindings };
}

function malformedSnapshot(receipt) {
  return {
    status: receipt.status,
    declarations: receipt.declarations.map((row) => row.kind),
    occurrences: receipt.propertyOccurrences.map((row) => [row.ownerKind, row.propertyName]),
    decorators: receipt.decorators,
    attachments: receipt.attachments,
    symbols: receipt.symbols,
    bindings: receipt.bindings,
    decoratorResidue: {
      declarations: receipt.declarations.filter((row) => row.kind === 'decorator'),
      occurrences: receipt.propertyOccurrences.filter((row) => row.ownerKind === 'decorator'),
      presence: receipt.propertyPresence.filter((row) => row.ownerLogicalOrdinal === 0),
      effectivePresence: receipt.propertyPresence.filter((row) =>
        row.ownerLogicalOrdinal === 0 && row.effectiveOccurrenceOrdinal !== -1),
    },
    diagnostics: receipt.diagnostics.map(diagnostic),
    facts: receipt.facts.map(fact),
  };
}

function assertAtomicFatal(receipt, code, label) {
  assert.equal(receipt.status, 'fatal', label);
  assert.deepEqual(receipt.diagnostics.map((row) => row.code), [code], label);
  for (const section of [
    'declarations', 'propertyOccurrences', 'propertyPresence', 'attachments', 'decorators',
    'symbols', 'bindings', 'facts', 'detachedLogicalOrdinals', 'expressionEvidence',
  ]) assert.deepEqual(receipt[section], [], `${label}: ${section}`);
}

function assertAtomicLimit(receipt, label) {
  assertAtomicFatal(receipt, 'F4_LIMIT', label);
}

function hasEligibilityGrowingPrefix(source) {
  const accumulators = '(?:facts|lineSyntaxDiagnostics|eligibilityDiagnostics|publicTape|diagnostics|tape)';
  return new RegExp(
    `assign target=${accumulators} value="(?:f4append\\(${accumulators},|${accumulators} \\+)|` +
    'return value="\\[[^\\n]*tape \\+', 'u').test(source);
}

function balancedFoldHeaders(source) {
  return [...source.matchAll(/^fn name=f4balancedtapefold returns="string\[\]"$/gmu)].length;
}

test('E1 RED: one ordinary bare token rejects at its exact scalar interval', () => {
  const receipt = result('one-bare.kern', 'module name=app stray\n');
  assert.deepEqual({
    status: receipt.status,
    facts: receipt.facts.map(fact),
    diagnostics: receipt.diagnostics.map(diagnostic),
    ...interfaceRows(receipt),
  }, {
    status: 'rejected',
    facts: [['invalid-property', 16, 21, 0, 'stray']],
    diagnostics: [['UNEXPECTED_TOKEN', 'error', 16, 21, 0]],
    symbols: [], bindings: [],
  });
});

test('E2 RED: every ordinary bare token has an independently ordered pair', () => {
  const receipt = result('two-bare.kern', 'module name=app stray other\n');
  assert.deepEqual({
    status: receipt.status,
    facts: receipt.facts.map(fact),
    diagnostics: receipt.diagnostics.map(diagnostic),
    ...interfaceRows(receipt),
  }, {
    status: 'rejected',
    facts: [
      ['invalid-property', 16, 21, 0, 'stray'],
      ['invalid-property', 22, 27, 0, 'other'],
    ],
    diagnostics: [
      ['UNEXPECTED_TOKEN', 'error', 16, 21, 0],
      ['UNEXPECTED_TOKEN', 'error', 22, 27, 0],
    ],
    symbols: [], bindings: [],
  });
});

test('E3 RED: one missing required property has its existing fact and owner-line error', () => {
  const receipt = result('missing-name.kern', 'fn export=true\n');
  assert.deepEqual({
    status: receipt.status,
    facts: receipt.facts.map(fact),
    diagnostics: receipt.diagnostics.map(diagnostic),
    ...interfaceRows(receipt),
  }, {
    status: 'rejected',
    facts: [['missing-property', 0, 14, 0, 'name']],
    diagnostics: [['UNEXPECTED_TOKEN', 'error', 0, 14, 0]],
    symbols: [], bindings: [],
  });
});

test('E4 RED: multi-required absence remains authority-ordered with one owner-line error', () => {
  const receipt = result('multi-required.kern', 'module name=app\n  app name=a\n    view\n');
  assert.deepEqual({
    status: receipt.status,
    facts: receipt.facts.filter((row) => row.code === 'missing-property').map(fact),
    diagnostics: receipt.diagnostics.map(diagnostic),
    ...interfaceRows(receipt),
  }, {
    status: 'rejected',
    facts: [
      ['missing-property', 29, 37, 2, 'name'],
      ['missing-property', 29, 37, 2, 'path'],
      ['missing-property', 29, 37, 2, 'source'],
    ],
    diagnostics: [['UNEXPECTED_TOKEN', 'error', 29, 37, 2]],
    symbols: [], bindings: [],
  });
});

test('E5 control: valid unknown property keeps its fact without an eligibility diagnostic', () => {
  const receipt = result('unknown-property.kern', 'module name=app unknown=x\n');
  assert.equal(receipt.status, 'rejected');
  assert.deepEqual(receipt.facts.map(fact), [['unknown-property', 16, 25, 0, 'unknown']]);
  assert.deepEqual(receipt.diagnostics, []);
});

test('E6 control: valid duplicates remain LWW with their frozen warning', () => {
  const receipt = result('duplicate.kern', 'fn name=a name=b\n');
  const names = receipt.propertyOccurrences.filter((row) => row.propertyName === 'name');
  assert.equal(receipt.status, 'classified');
  assert.deepEqual(names.map((row) => row.value), ['a', 'b']);
  assert.equal(receipt.propertyPresence.find((row) => row.propertyName === 'name').effectiveOccurrenceOrdinal,
    names[1].ordinal);
  assert.deepEqual(receipt.diagnostics.map(diagnostic), [['DUPLICATE_PROP', 'warning', 10, 16, 0]]);
  assert.deepEqual(receipt.facts, []);
});

test('E7 RED: valid decorator args and inline comment preserve exact args evidence', () => {
  const receipt = result('decorator-args.kern', '@trace.$x($arg, nested(call)) // note\nfn name=main\n');
  const values = receipt.propertyOccurrences.filter((row) => row.ownerKind === 'decorator').map((row) =>
    [row.propertyName, row.valueRepresentation, row.value, row.startScalar, row.endScalar]);
  const presence = receipt.propertyPresence.filter((row) => row.ownerLogicalOrdinal === 0).map((row) =>
    [row.propertyName, row.effectiveOccurrenceOrdinal]);
  assert.deepEqual({
    status: receipt.status,
    values,
    presence,
    decorators: receipt.decorators.map((row) =>
      [row.disposition, row.targetLogicalOrdinal, row.startScalar, row.endScalar]),
    diagnostics: receipt.diagnostics.map(diagnostic),
    facts: receipt.facts.map(fact),
  }, {
    status: 'classified',
    values: [
      ['name', 'bare', 'trace.$x', 1, 9],
      ['args', 'bare', '$arg, nested(call)', 10, 28],
    ],
    presence: [['args', 1], ['name', 0]],
    decorators: [['attached', 1, 0, 37]],
    diagnostics: [], facts: [],
  });
});

test('E15 RED: decorator outer trim, export separator, and args trim use legacy ECMAScript whitespace', () => {
  for (const [moduleId, source, expected] of [
    ['nbsp-export.kern', 'export\u00a0@trace\nfn name=main\n', { exported: true, args: undefined }],
    ['feff-outer.kern', '\ufeff@trace\u3000\nfn name=main\n', { exported: false, args: undefined }],
    ['thin-args.kern', '@trace(\u2009arg\u2009)\nfn name=main\n', { exported: false, args: 'arg' }],
  ]) {
    const receipt = result(moduleId, source);
    assert.equal(receipt.status, 'classified', moduleId);
    assert.deepEqual(receipt.decorators.map((row) => [row.disposition, row.explicitExport]),
      [['attached', expected.exported]], moduleId);
    const args = receipt.propertyOccurrences.filter((row) =>
      row.ownerKind === 'decorator' && row.propertyName === 'args');
    assert.equal(args.length, expected.args === undefined ? 0 : 1, moduleId);
    if (expected.args !== undefined) assert.equal(args[0].value, expected.args, moduleId);
  }
});

test('E15 control: non-ASCII whitespace does not delimit an inline comment', () => {
  const receipt = result('non-ascii-comment.kern', '@trace\u00a0// note\nfn name=main\n');
  assert.equal(receipt.status, 'rejected');
  assert.deepEqual(receipt.decorators, []);
  assert.deepEqual(receipt.attachments, []);
  assert.deepEqual(receipt.diagnostics.map((row) => row.code), ['UNEXPECTED_TOKEN']);
  assert.deepEqual(receipt.facts.map(fact), [['invalid-property', 0, 14, 0, '@trace\u00a0// note']]);
});

test('E16 control: parenthesized empty raw args retain one zero-width args occurrence', () => {
  const receipt = result('zero-width-args.kern', '@trace()\nfn name=main\n');
  const args = receipt.propertyOccurrences.filter((row) =>
    row.ownerKind === 'decorator' && row.propertyName === 'args');
  assert.equal(receipt.status, 'classified');
  assert.deepEqual(args.map((row) => [row.value, row.startScalar, row.endScalar]), [['', 7, 7]]);
  assert.deepEqual(receipt.propertyPresence.filter((row) =>
    row.ownerLogicalOrdinal === 0 && row.propertyName === 'args').map((row) => row.effectiveOccurrenceOrdinal),
  [args[0].ordinal]);
});

for (const [name, source, span] of [
  ['trailing', '@trace tail\nfn name=main\n', [0, 11]],
  ['bad-path', '@bad..name\nfn name=main\n', [0, 10]],
  ['unclosed-args', '@trace(foo\nfn name=main\n', [0, 10]],
]) test(`E9/E10 RED: malformed decorator ${name} has no semantic decorator output`, () => {
  const receipt = result(`malformed-${name}.kern`, source);
  assert.deepEqual(malformedSnapshot(receipt), {
    status: 'rejected',
    declarations: ['fn'],
    occurrences: [['fn', 'name']],
    decorators: [], attachments: [], symbols: [],
    bindings: [],
    decoratorResidue: { declarations: [], occurrences: [], presence: [], effectivePresence: [] },
    diagnostics: [['UNEXPECTED_TOKEN', 'error', span[0], span[1], 0]],
    facts: [['invalid-property', span[0], span[1], 0, source.slice(...span)]],
  });
});

test('E8 control: a valid exported decorator still attaches and exports the fn', () => {
  const receipt = result('export-decorator.kern', 'export @trace\nfn name=main\n');
  assert.equal(receipt.status, 'classified');
  assert.deepEqual(receipt.decorators.map((row) => [row.disposition, row.explicitExport]), [['attached', true]]);
  assert.deepEqual(receipt.symbols.map((row) => [row.kind, row.name, row.exported]), [['fn', 'main', true]]);
});

test('E9 RED: malformed decorator syntax wins before a would-be dropped target', () => {
  const source = '@trace tail\nmodule name=app\n';
  const receipt = result('malformed-before-target.kern', source);
  assert.deepEqual(malformedSnapshot(receipt), {
    status: 'rejected',
    declarations: ['module'],
    occurrences: [['module', 'name']],
    decorators: [], attachments: [], symbols: [],
    bindings: [],
    decoratorResidue: { declarations: [], occurrences: [], presence: [], effectivePresence: [] },
    diagnostics: [['UNEXPECTED_TOKEN', 'error', 0, 11, 0]],
    facts: [['invalid-property', 0, 11, 0, '@trace tail']],
  });
});

test('E11 control: grammar-valid bad target remains dropped and classified', () => {
  const receipt = result('dropped-decorator.kern', '@trace\nmodule name=app\n');
  assert.equal(receipt.status, 'classified');
  assert.deepEqual(receipt.decorators.map((row) => [row.disposition, row.targetLogicalOrdinal]), [['dropped', -1]]);
  assert.deepEqual(receipt.attachments, []);
  assert.deepEqual(receipt.symbols, []);
  assert.deepEqual(receipt.bindings, []);
  assert.deepEqual(receipt.diagnostics.map(diagnostic), [['DROPPED_DECORATOR', 'warning', 0, 6, 0]]);
  assert.deepEqual(receipt.facts, []);
});

test('E17 RED/control: low eligibility output ceilings return only atomic F4_LIMIT receipts', () => {
  const source = 'module name=app stray other\n';
  const facts = __test.runDocumentWithProfileLimits('eligibility-facts.kern', source, { maxFacts: 1 }).receipt;
  assertAtomicLimit(facts, 'facts');
  for (const [label, limits] of [
    ['diagnostics', { maxDiagnostics: 1 }], ['encoded bytes', { maxEncodedBytes: 64 }],
  ]) {
    const receipt = __test.runDocumentWithProfileLimits(`eligibility-${label}.kern`, source, limits).receipt;
    assertAtomicLimit(receipt, label);
  }
});

test('E18 RED: property-phase diagnostic count retains F4_LIMIT precedence past later occurrences', () => {
  const moduleId = 'property-phase-limit.kern';
  const source = 'module name=app\n  page name=Home name=Dash name=Third route="/home"\n';
  const baseline = result(moduleId, source);
  assert.equal(baseline.status, 'classified');
  assert.deepEqual(baseline.diagnostics.map((row) => row.code), ['DUPLICATE_PROP', 'DUPLICATE_PROP']);
  for (const [label, limits] of [
    ['diagnostic exact cap', { maxDiagnostics: 2 }],
  ]) {
    const receipt = __test.runDocumentWithProfileLimits(moduleId, source, limits).receipt;
    assert.equal(receipt.status, 'classified', label);
    assert.deepEqual(receipt.diagnostics.map((row) => row.code),
      ['DUPLICATE_PROP', 'DUPLICATE_PROP'], label);
  }
  for (const [label, limits] of [
    ['diagnostic overflow', { maxDiagnostics: 1 }],
  ]) {
    const receipt = __test.runDocumentWithProfileLimits(moduleId, source, limits).receipt;
    assertAtomicLimit(receipt, label);
  }
});

test('E17 oracle: eligibility parts require prospective admission and balanced finalization', () => {
  const compositionSources = `${ELIGIBILITY_SOURCE}\n${DIAGNOSTIC_SOURCE}`;
  assert.equal(hasEligibilityGrowingPrefix(DIAGNOSTIC_SOURCE), false,
    'diagnostic phase/final merge does not displace the same growing-prefix cost');
  assert.equal(hasEligibilityGrowingPrefix(SEMANTIC_SOURCE), false,
    'eligibility facts and diagnostics are buffered, not repeatedly prefixed');
  assert.equal(balancedFoldHeaders(compositionSources), 1,
    'one generic f4balancedtapefold owns exact dry-run and pairwise finalization');
  assert.match(compositionSources, /fn name=f4balancedtapefold returns="string\[\]"[\s\S]*new Map\(\)/u,
    'the generic fold owns its level state in a Map');
});

test('E17 oracle self-check: the growing-prefix scanner rejects both eligibility accumulator forms', () => {
  assert.equal(hasEligibilityGrowingPrefix('assign target=facts value="f4append(facts, bareFact)"'), true);
  assert.equal(hasEligibilityGrowingPrefix('assign target=lineSyntaxDiagnostics value="f4append(lineSyntaxDiagnostics, row)"'), true);
  assert.equal(hasEligibilityGrowingPrefix('assign target=diagnostics value="diagnostics + framedRow"'), true);
  assert.equal(hasEligibilityGrowingPrefix('return value="[\"ok\", tape + framedEntry]"'), true);
  assert.equal(hasEligibilityGrowingPrefix('do value=eligibilityParts.push(row)'), false);
  assert.equal(balancedFoldHeaders('fn name=f4balancedtapefold returns="string[]"'), 1);
});

test('E12 control: real phase-key mutation is an atomic authority-drift receipt', () => {
  for (const mutation of ['equal', 'decreasing']) {
    const receipt = __test.runDocumentWithPhaseKeyMutation('phase-key.kern', 'fn name=main\n', mutation).receipt;
    assertAtomicFatal(receipt, 'F4_AUTHORITY_DRIFT', mutation);
  }
});

test('E13 control: prerequisite failures retain their F4A precedence and one invocation', () => {
  const f1 = result('f1-failure.kern', 'module name="unterminated');
  const f2b = result('f2b-failure.kern', 'module name={{1 +}}');
  const stages = [];
  const f3 = __test.runDocumentWithF3Options(
    'f3-failure.kern',
    'fn name=main\n',
    { forceLateFailure: true },
    (stage) => stages.push(stage),
  );
  assert.equal(f3.runtimeInvocations, 1, 'F3 failure: one actual F4 invocation');
  assert.deepEqual(stages, ['f1', 'f2b', 'f3', 'f4']);
  for (const [label, receipt, code] of [
    ['F1', f1, 'F4_F1_DRIFT'],
    ['F2B', f2b, 'F4_F2B_DRIFT'],
    ['F3', f3.receipt, 'F4_F3_DRIFT'],
  ]) {
    assert.equal(receipt.status, 'fatal', label);
    assert.deepEqual(receipt.diagnostics.map((row) => row.code), [code], label);
    assert.deepEqual(receipt.declarations, [], label);
    assert.deepEqual(receipt.propertyOccurrences, [], label);
    assert.deepEqual(receipt.facts, [], label);
  }
});

test('E13 control: eligibility preserves F3 logical-line geometry', () => {
  const source = '@trace tail\nfn name=main\n';
  const f3 = runF3Document(source).receipt;
  assert.deepEqual(f3.logicalLines.map((row) =>
    [row.role, row.sourceStartScalar, row.sourceEndScalar, row.contentStartScalar]), [
    ['decorator', 0, 11, 0], ['ordinary', 12, 24, 12],
  ]);
  assert.equal(runDocument('geometry.kern', source).runtimeInvocations, 1, 'one actual F4 invocation');
});

test('E14 control: exact M1.1 composition pins and the loader guard precede public F4 execution', () => {
  const policy = loadPolicy().policy;
  for (const [path, source] of [
    ['examples/kern-frontend/f4-line-eligibility.kern', ELIGIBILITY_SOURCE],
    ['examples/kern-frontend/f4-declarations-semantic.kern', SEMANTIC_SOURCE],
  ]) {
    const descriptor = policy.composition.find((row) => row.path === path);
    assert.equal(sha256(source), descriptor.sha256, `${path}: policy pin matches current bytes`);
  }
  const workerSource = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
  assert.match(workerSource, /sha256\(source\) !== descriptor\.sha256\) fail\(`composition digest \$\{path\}`\)/u);
  const matching = result('matching-composition.kern', 'fn name=main\n');
  assert.equal(matching.status, 'classified');
});
