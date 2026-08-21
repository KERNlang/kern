import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { __test, runDocument } from './worker.mjs';
import { F4_COMPOSITION_PATHS } from './policy-validation.mjs';

const F4_SOURCES = F4_COMPOSITION_PATHS.map((path) => ({ path,
  source: readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'),
}));
const TAIL = F4_SOURCES.find(({ path }) => path.endsWith('f4-declarations-semantic-tail.kernpart')).source;
const GOLDENS = JSON.parse(readFileSync(
  new URL('../kern-frontend-closure/static-goldens.json', import.meta.url), 'utf8'));

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

function goldenFailure(id) {
  const fixture = GOLDENS.failures.find((entry) => entry.id === id);
  assert.ok(fixture, `frozen static golden ${id} exists`);
  return fixture;
}

function framed(value) {
  return `i${Array.from(value).length}:${value}`;
}

function localFactRow(code = 'unknown-property') {
  return ['structural', code, '0', '1', '0', 'x'].map(framed).join('');
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

function sourceLines(source) {
  return source.split('\n');
}

function indentation(line) {
  return line.length - line.trimStart().length;
}

function factPartsPushes(source) {
  return sourceLines(source).flatMap((line, index) => {
    const match = line.match(/do value="factParts\.push\((.+)\)"$/u);
    return match === null ? [] : [{ line: index, value: match[1] }];
  });
}

function blockStart(lines, index, indent) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (indentation(lines[cursor]) < indent) return cursor + 1;
  }
  return 0;
}

function exactImportedFactPush(lines, index, value) {
  const imported = value === 'expressionFactPart'
    ? ['expressionFactIndex', 'expressionFactParts', 'expressionFactPart']
    : value === 'pathFactPart' ? ['pathFactIndex', 'pathFactParts', 'pathFactPart'] : undefined;
  if (!imported || index < 2) return false;
  const [indexName, partsName, partName] = imported;
  const pushIndent = indentation(lines[index]);
  const start = blockStart(lines, index, pushIndent);
  return lines[index - 1].trim() ===
      `let name=${partName} value="${partsName}[${indexName}]"` &&
    start > 0 && lines[start - 1].trim() ===
      `for name=${indexName} from=1 to=${partsName}.length`;
}

function directlyReturnsNonOk(lines, guard, push) {
  const guardIndent = indentation(lines[guard]);
  for (let cursor = guard + 1; cursor < push; cursor += 1) {
    const line = lines[cursor];
    const indent = indentation(line);
    if (indent <= guardIndent) return false;
    if (indent === guardIndent + 2 && line.trimStart().startsWith('return value=')) return true;
  }
  return false;
}

function directlyUpdatesFactState(lines, push, name) {
  const indent = indentation(lines[push]);
  const expected = [
    `assign target=factCount value="f2uint(${name}[1])"`,
    `assign target=factBytes value="f2uint(${name}[2])"`,
    `assign target=workSteps value="f2uint(${name}[3])"`,
  ];
  return expected.every((line, offset) => lines[push + offset + 1]?.trim() === line &&
    indentation(lines[push + offset + 1]) === indent);
}

function localFactPushViolations(source) {
  const lines = sourceLines(source);
  const violations = [];
  for (const { line: index, value } of factPartsPushes(source)) {
    if (exactImportedFactPush(lines, index, value)) continue;
    const admission = value.match(/^([A-Za-z][A-Za-z0-9]*)\[4\]$/u);
    if (admission === null) {
      violations.push(`${index + 1}: local fact must use named admission[4]`);
      continue;
    }
    const name = admission[1];
    const pushIndent = indentation(lines[index]);
    const start = blockStart(lines, index, pushIndent);
    const declaration = lines.findLastIndex((line, cursor) => cursor >= start && cursor < index &&
      indentation(line) === pushIndent && new RegExp(
        `^let name=${name} value="f4eligibilityleafadmit\\([^,]+, 6, factCount, factBytes, workSteps, maxFacts, maxEncodedBytes, maxWorkSteps\\)"$`, 'u').test(line.trim()));
    const guard = declaration < 0 ? -1 : lines.findIndex((line, cursor) => cursor > declaration && cursor < index &&
      indentation(line) === pushIndent && line.trim() === `if cond="${name}[0] != \\"ok\\""`);
    if (declaration < 0 || guard < 0 || !directlyReturnsNonOk(lines, guard, index) ||
        !directlyUpdatesFactState(lines, index, name)) {
      violations.push(`${index + 1}: ${name} lacks local six-field admission guard or state update`);
    }
  }
  return violations;
}

function hasProspectiveFactFunnel(source) {
  return factPartsPushes(source).length > 0 && localFactPushViolations(source).length === 0;
}

function hasPreFoldFactCaps(source) {
  const lines = sourceLines(source);
  const fold = lines.findIndex((line) => line.includes('f4balancedtapefold(factParts,'));
  if (fold < 0) return false;
  const foldIndent = indentation(lines[fold]);
  function guard(variable, limit, after) {
    const index = lines.findIndex((line, cursor) => cursor > after && cursor < fold &&
      indentation(line) === foldIndent && line.trim() === `if cond="${variable} > ${limit}"`);
    if (index < 0) return -1;
    const fatal = lines[index + 1] ?? '';
    const returned = lines[index + 2] ?? '';
    const fatalMatch = fatal.trim().match(/^let name=([A-Za-z][A-Za-z0-9]*) value="f4fatal\(\\"F4_LIMIT\\", sourceScalars\)"$/u);
    return fatalMatch !== null && indentation(fatal) === foldIndent + 2 &&
      returned.trim() === `return value=${fatalMatch[1]}` && indentation(returned) === foldIndent + 2 ? index : -1;
  }
  const count = guard('factCount', 'maxFacts', -1);
  const bytes = count >= 0 ? guard('factBytes', 'maxEncodedBytes', count) : -1;
  return bytes >= 0 && !lines.slice(count + 1, fold).some((line) =>
    line.includes('factParts.push(') || line.includes('assign target=factCount') ||
    line.includes('assign target=factBytes') || line.includes('assign target=workSteps'));
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

test('C13 LOCAL: unknown-node admission observes a preceding constructed fact', () => {
  const source = 'module name=app stray\n  page name=Home route="/"\n    mystery\n';
  const baseline = attempt('preceding-unknown-node.kern', source);
  assert.deepEqual(factCodes(baseline.receipt), ['invalid-property', 'unknown-node-kind']);
  assertAtomicFatal(attempt('preceding-unknown-node.kern', source, { maxFacts: 1 }), 'F4_LIMIT',
    'the second constructed fact crosses after the preceding bare fact');
  assert.notEqual(attempt('preceding-unknown-node.kern', source, { maxFacts: 2 }).receipt.status, 'fatal',
    'the exact two-fact capacity remains admitted');
});

test('C13 LOCAL: frozen excluded-host payload facts retain their independent public fixtures', async (t) => {
  for (const id of ['excluded-raw-block', 'excluded-host-expression', 'excluded-host-type']) {
    await t.test(id, () => {
      const fixture = goldenFailure(id);
      const source = `module name=app stray\n${fixture.source}`;
      const result = attempt(fixture.moduleId, source);
      assert.deepEqual(factCodes(result.receipt), ['invalid-property', 'excluded-host-payload'],
        `${id}: preceding bare and frozen host fact`);
      assertAtomicFatal(attempt(fixture.moduleId, source, { maxFacts: 1 }), 'F4_LIMIT',
        `${id}: cap one crosses at the host fact`);
      assert.notEqual(attempt(fixture.moduleId, source, { maxFacts: 2 }).receipt.status, 'fatal',
        `${id}: exact two-fact capacity remains admitted`);
    });
  }
});

test('C13 LOCAL RED: actual KERN leaf admission rejects the immediate work boundary', () => {
  const row = localFactRow();
  const admitted = __test.runEligibilityLeafAdmission(row, 6, 0, 0, 7, {
    maxFacts: 2, maxEncodedBytes: 1024, maxWorkSteps: 8,
  });
  assert.equal(admitted[0], 'ok', 'the actual helper admits at its exact immediate work ceiling');
  assert.equal(admitted[3], '8', 'the helper exposes its charged next work step');
  const limited = __test.runEligibilityLeafAdmission(row, 6, 0, 0, 7, {
    maxFacts: 2, maxEncodedBytes: 1024, maxWorkSteps: 7,
  });
  assert.equal(limited[0], 'limit', 'the actual helper exposes the immediate work limit');
  assert.equal(limited[4], '',
    'the actual helper rejects before retaining a leaf when its next work step exceeds the cap');
});

test('C13 LOCAL: authority and transported prerequisite drift dominate constructed facts', () => {
  const source = 'module name=app unknown=x another=y\n';
  assertAtomicFatal(attempt('drift-precedence.kern', source, { maxFacts: 1 }), 'F4_LIMIT',
    'the unmutated source would cross the local fact limit');
  for (const mutation of ['authority-row-reorder', 'f1-record-kind']) {
    const result = __test.runDocumentWithMutationAndProfileLimits(
      'drift-precedence.kern', source, mutation, { maxFacts: 1 });
    assert.equal(result.runtimeInvocations, 1, `${mutation}: one F4 invocation`);
    assertAtomicFatal(result, mutation === 'authority-row-reorder' ? 'F4_AUTHORITY_DRIFT' : 'F4_F1_DRIFT', mutation);
  }
});

test('C13 LOCAL RED: every constructed fact writer must use a prospective funnel, not the late maxFacts check', () => {
  const unsafe = F4_SOURCES.flatMap(({ path, source }) =>
    localFactPushViolations(source).map((entry) => `${path}:${entry}`));
  assert.deepEqual(unsafe, [], `unadmitted fact writers: ${unsafe.join(', ')}`);
  assert.equal(hasProspectiveFactFunnel('if cond="factCount > maxFacts"\n  return value="late"'), false,
    'a terminal late count check alone is not a prospective admission funnel');
  assert.equal(hasProspectiveFactFunnel([
    'let name=rowAdmission value="f4eligibilityleafadmit(row, 6, factCount, factBytes, workSteps, maxFacts, maxEncodedBytes, maxWorkSteps)"',
    'if cond="rowAdmission[0] != \\"ok\\""', '  return value=failure', 'do value="factParts.push(rowAdmission[4])"',
    'assign target=factCount value="f2uint(rowAdmission[1])"',
    'assign target=factBytes value="f2uint(rowAdmission[2])"',
    'assign target=workSteps value="f2uint(rowAdmission[3])"',
  ].join('\n')), true, 'the canary recognizes a locally guarded six-field admission');
});

test('C13 LOCAL RED: fact count and bytes must be guarded before the balanced fold', () => {
  assert.equal(hasPreFoldFactCaps(TAIL), true,
    'the tail checks aggregate fact count then bytes before folding retained fact parts');
  assert.equal(hasPreFoldFactCaps('if cond="factCount > maxFacts"\n  return value="late"\nf4balancedtapefold(factParts, work, cap)'), false,
    'a count-only late guard cannot stand in for sequential pre-fold fact caps');
  assert.equal(hasPreFoldFactCaps([
    'if cond="factCount > maxFacts"', '  let name=count value="f4fatal(\\"F4_LIMIT\\", sourceScalars)"',
    '  return value=count', 'if cond="factBytes > maxEncodedBytes"',
    '  let name=bytes value="f4fatal(\\"F4_LIMIT\\", sourceScalars)"', '  return value=bytes',
    'f4balancedtapefold(factParts, work, cap)',
  ].join('\n')), true, 'the canary requires sequential count then byte fatal returns before folding');
  assert.equal(hasPreFoldFactCaps([
    'if cond="factCount > maxFacts"', '  let name=count value="f4fatal(\\"F4_AUTHORITY_DRIFT\\", sourceScalars)"',
    '  return value=count', 'if cond="factBytes > maxEncodedBytes"',
    '  let name=bytes value="f4fatal(\\"F4_LIMIT\\", sourceScalars)"', '  return value=bytes',
    'f4balancedtapefold(factParts, work, cap)',
  ].join('\n')), false, 'the count guard must bind F4_LIMIT');
  assert.equal(hasPreFoldFactCaps([
    'if cond=outer', '  if cond="factCount > maxFacts"',
    '    let name=count value="f4fatal(\\"F4_LIMIT\\", sourceScalars)"', '    return value=count',
    'if cond="factBytes > maxEncodedBytes"', '  let name=bytes value="f4fatal(\\"F4_LIMIT\\", sourceScalars)"',
    '  return value=bytes', 'f4balancedtapefold(factParts, work, cap)',
  ].join('\n')), false, 'a nested count guard does not dominate the fold');
  assert.equal(hasPreFoldFactCaps([
    'if cond="factCount > maxFacts"', '  let name=count value="f4fatal(\\"F4_LIMIT\\", sourceScalars)"',
    '  return value=count', 'assign target=factCount value="1"', 'if cond="factBytes > maxEncodedBytes"',
    '  let name=bytes value="f4fatal(\\"F4_LIMIT\\", sourceScalars)"', '  return value=bytes',
    'f4balancedtapefold(factParts, work, cap)',
  ].join('\n')), false, 'no fact count, byte, or tape mutation may slip between pre-fold guards and fold');
  assert.equal(hasPreFoldFactCaps([
    'if cond="factCount > maxFacts"', '  let name=count value="f4fatal(\\"F4_LIMIT\\", sourceScalars)"',
    '  return value=count', 'if cond="factBytes > maxEncodedBytes"',
    '  let name=bytes value="f4fatal(\\"F4_LIMIT\\", sourceScalars)"', '  return value=bytes',
    'assign target=workSteps value="workSteps + 1"', 'f4balancedtapefold(factParts, work, cap)',
  ].join('\n')), false, 'no work mutation may slip between pre-fold guards and fold');
});

test('C13 LOCAL canary self-check: local bypasses cannot borrow another admission', () => {
  assert.deepEqual(localFactPushViolations('do value="factParts.push(preframed)"'),
    ['1: local fact must use named admission[4]']);
  assert.deepEqual(localFactPushViolations([
    'let name=dummy value="f4eligibilityleafadmit(row, 6, count, bytes, work, maxFacts, maxEncodedBytes, maxWorkSteps)"',
    'if cond="dummy[0] != \\"ok\\""', '  return value=failure', 'do value="factParts.push(f4item(row))"',
  ].join('\n')), ['4: local fact must use named admission[4]']);
  assert.deepEqual(localFactPushViolations([
    'let name=expressionFactPart value="row"', 'do value="factParts.push(expressionFactPart)"',
  ].join('\n')), ['2: local fact must use named admission[4]'],
  'a reserved imported name is exempt only inside its exact framed-parts loop');
  assert.deepEqual(localFactPushViolations([
    'if cond=maybe',
    '  let name=admission value="f4eligibilityleafadmit(row, 6, factCount, factBytes, workSteps, maxFacts, maxEncodedBytes, maxWorkSteps)"',
    '  if cond="admission[0] != \\"ok\\""', '    return value=failure',
    'do value="factParts.push(admission[4])"',
  ].join('\n')), ['5: admission lacks local six-field admission guard or state update'],
  'a nested admission cannot dominate a sibling push');
  assert.deepEqual(localFactPushViolations([
    'let name=admission value="f4eligibilityleafadmit(row, 6, factCount, factBytes, workSteps, maxFacts, maxEncodedBytes, maxWorkSteps)"',
    'if cond="admission[0] != \\"ok\\""', '  if cond=maybe', '    return value=failure',
    'do value="factParts.push(admission[4])"',
  ].join('\n')), ['5: admission lacks local six-field admission guard or state update'],
  'a nested return cannot prove a non-ok guard returns on every path');
  assert.deepEqual(localFactPushViolations([
    'let name=rowAdmission value="f4eligibilityleafadmit(row, 6, factCount, factBytes, workSteps, maxFacts, maxEncodedBytes, maxWorkSteps)"',
    'if cond="rowAdmission[0] != \\"ok\\""', '  return value=failure', 'do value="factParts.push(rowAdmission[4])"',
    'assign target=factCount value="f2uint(rowAdmission[1])"',
    'assign target=factBytes value="f2uint(rowAdmission[2])"',
  ].join('\n')), ['4: rowAdmission lacks local six-field admission guard or state update'],
  'a local push must update count, bytes, and work from the same admission result');
  assert.equal(isAtomicLimit({ fields: [], receipt: { status: 'rejected', diagnostics: [] } }, 'synthetic'), false);
});
