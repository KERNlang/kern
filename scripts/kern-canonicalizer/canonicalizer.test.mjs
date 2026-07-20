import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { VALID_FIXTURES } from './fixtures.mjs';
import { validateCanonicalizerPolicy } from './policy.mjs';

const mainSource = readFileSync(new URL('../../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url), 'utf8');
const helperSource = readFileSync(
  new URL('../../examples/kern-canonicalizer/canonicalizer-expression-helpers.kern', import.meta.url),
  'utf8',
);
const statementSource = readFileSync(
  new URL('../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern', import.meta.url),
  'utf8',
);
const source = `${helperSource}${statementSource}${mainSource}`;
const policyUrl = new URL('./policy.json', import.meta.url);

test('the KERN canonicalizer members are parseable, bounded, and contain the semantic source decisions', () => {
  for (const [name, member] of [
    ['expression helpers', helperSource],
    ['statement helpers', statementSource],
    ['main', mainSource],
  ]) {
    const parsedMember = parseDocumentWithDiagnostics(member);
    assert.notEqual(parsedMember.partial, true, name);
    assert.deepEqual(
      parsedMember.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
      [],
      name,
    );
    assert.ok(member.split('\n').length - 1 < 500, `${name} hand-written KERN source must stay below 500 lines`);
  }
  const parsed = parseDocumentWithDiagnostics(source);
  assert.notEqual(parsed.partial, true);
  assert.deepEqual(
    parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    [],
  );
  for (const owned of ['fn name=', 'param name=', 'handler lang=', 'return value=', 'quotesource', 'typesource']) {
    assert.ok(source.includes(owned), `missing KERN-owned source decision ${owned}`);
  }
});

test('conditional validation and emission stay in the KERN statement member', () => {
  for (const owned of ['validstatementlist', 'validstatement', 'emitstatementlist', 'emitstatement']) {
    assert.ok(statementSource.includes(`fn name=${owned}`), `missing KERN-owned conditional helper ${owned}`);
    assert.equal(
      [...source.matchAll(new RegExp(`^fn name=${owned}\\b`, 'gmu'))].length,
      1,
      `conditional helper ${owned} must have exactly one definition in the executable composition`,
    );
  }
  assert.ok(mainSource.includes('validstatementlist'));
  assert.ok(mainSource.includes('emitstatementlist'));
});

test('binary ownership stays in main and mechanically matches the structural operator catalog', () => {
  assert.equal(helperSource.includes('validbinaryop'), false);
  assert.equal(helperSource.includes('\\"binary\\"'), false);
  const expressionCatalog = readFileSync(
    new URL('../../packages/core/src/kir-structural/expression.ts', import.meta.url),
    'utf8',
  );
  const catalogBlock = /const BINARY_OPERATORS = new Set\(\[([\s\S]*?)\]\);/u.exec(expressionCatalog)?.[1];
  assert.ok(catalogBlock, 'missing structural binary catalog');
  const catalogOperators = [...catalogBlock.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  const kernFunction = /fn name=validbinaryop[\s\S]*?(?=\nfn name=)/u.exec(mainSource)?.[0];
  assert.ok(kernFunction, 'missing KERN validbinaryop');
  const kernOperators = [...kernFunction.matchAll(/op == \\"([^"\\]+)\\"/gu)].map((match) => match[1]);
  assert.equal(kernOperators.length, 24);
  assert.deepEqual(new Set(kernOperators), new Set(catalogOperators));
});

test('call validation and emission stay in the KERN-owned expression source', () => {
  assert.equal(helperSource.includes('\\"call\\"'), false);
  const callStart = mainSource.indexOf('if cond="kind == \\"call\\""');
  const callEnd = mainSource.indexOf('if cond="kind != \\"list\\""', callStart);
  assert.ok(callStart >= 0 && callEnd > callStart, 'missing KERN-owned call branch');
  const callBranch = mainSource.slice(callStart, callEnd);
  for (const field of ['args', 'callee', 'optional']) {
    assert.ok(
      callBranch.includes(`recordfield(fieldsId, \\"${field}\\", valueParent, valueRole)`),
      `call branch omitted ${field}`,
    );
  }
  assert.ok(callBranch.includes('numberat(optionalId, valueBool) != 0'), 'optional calls must remain fail-closed');
  assert.ok(callBranch.includes('exprsource(calleeId'), 'call callee must use recursive expression ownership');
  assert.ok(callBranch.includes('exprsource(argId'), 'call args must use recursive expression ownership');
});

test('member validation and emission stay in the KERN-owned expression source', () => {
  assert.equal(helperSource.includes('\\"member\\"'), false);
  const memberStart = mainSource.indexOf('if cond="kind == \\"member\\""');
  const memberEnd = mainSource.indexOf('if cond="kind == \\"call\\""', memberStart);
  assert.ok(memberStart >= 0 && memberEnd > memberStart, 'missing KERN-owned member branch');
  const memberBranch = mainSource.slice(memberStart, memberEnd);
  for (const field of ['object', 'optional', 'property']) {
    assert.ok(
      memberBranch.includes(`recordfield(fieldsId, \\"${field}\\", valueParent, valueRole)`),
      `member branch omitted ${field}`,
    );
  }
  assert.ok(memberBranch.includes('numberat(optionalId, valueBool) != 0'), 'optional members must remain fail-closed');
  assert.ok(memberBranch.includes('exprsource(objectId'), 'member object must use recursive expression ownership');
  assert.ok(memberBranch.includes('valididentifier(property)'), 'member properties must remain identifier-shaped');
  for (const rejected of ['null', 'none', 'undefined', 'true', 'false', 'await']) {
    assert.ok(memberBranch.includes(`property == \\"${rejected}\\"`), `member branch must reject ${rejected}`);
  }
});

test('the pre-M4.3b non-binary golden corpus bytes remain unchanged', () => {
  const hash = createHash('sha256');
  const nonBinary = VALID_FIXTURES.filter(({ id }) =>
    !id.startsWith('binary-') && !id.startsWith('conditional-') &&
    !id.startsWith('call-') && !id.startsWith('member-'));
  for (const fixture of nonBinary) {
    hash.update(`${fixture.id.length}:${fixture.id}:${Buffer.byteLength(fixture.golden)}:`);
    hash.update(fixture.golden);
  }
  assert.equal(nonBinary.length, 11);
  assert.equal(hash.digest('hex'), '92b55c08bb450e81b19a7f19257afd6e85b406eeb0657c207bdb0df91f68c176');
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
