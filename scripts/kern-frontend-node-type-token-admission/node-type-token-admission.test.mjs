import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  executeFrontendNodeTypeTokenAdmission,
  loadNodeTypeTokenAdmissionSource,
  validateNativeNodeTypeTokenAdmissionSource,
} from '../check-kern-frontend-node-type-token-admission.mjs';
import { INHERITED_ADMISSION_FAILURE_FIXTURES, NODE_TYPE_TOKEN_ADMISSION_FIXTURES } from './fixtures.mjs';
import { normalizeNodeTypeTokenAdmissionOracle } from './oracle.mjs';
import {
  loadFrontendNodeTypeTokenAdmissionPolicy,
  validateFrontendNodeTypeTokenAdmissionPolicy,
} from './policy.mjs';

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function mutate(source, from, to) {
  const changed = source.replace(from, to);
  assert.notEqual(changed, source, `mutation target missing: ${from}`);
  return changed;
}

test('native admission matches the independent cursor-zero oracle', () => {
  const policy = loadFrontendNodeTypeTokenAdmissionPolicy();
  const source = loadNodeTypeTokenAdmissionSource();
  for (const fixture of NODE_TYPE_TOKEN_ADMISSION_FIXTURES) {
    assert.deepEqual(
      executeFrontendNodeTypeTokenAdmission(fixture.source, policy, source),
      normalizeNodeTypeTokenAdmissionOracle(fixture.source, policy),
      fixture.id,
    );
  }
});

test('content-relative decisions and drop recovery agree with the bootstrap parser', () => {
  const policy = loadFrontendNodeTypeTokenAdmissionPolicy();
  for (const fixture of NODE_TYPE_TOKEN_ADMISSION_FIXTURES.filter(({ id }) => id !== 'leading-whitespace-no-skip')) {
    const expected = normalizeNodeTypeTokenAdmissionOracle(fixture.source, policy);
    if ('status' in expected) continue;
    const bootstrap = parseDocumentWithDiagnostics(fixture.source);
    const child = bootstrap.root.children?.[0];
    if (expected.decision.status === 'admitted') {
      assert.equal(child?.type, expected.decision.admittedType, fixture.id);
      continue;
    }
    const dropped = bootstrap.diagnostics.find((diagnostic) => diagnostic.code === 'DROPPED_LINE');
    assert.equal(child?.type, '__error', fixture.id);
    assert.deepEqual(child?.props, expected.error.props, fixture.id);
    assert.deepEqual(dropped, expected.diagnostic, fixture.id);
  }
});

test('tryIdent semantics do not skip leading whitespace or classify node names', () => {
  const whitespace = executeFrontendNodeTypeTokenAdmission('  text value=ok');
  assert.equal(whitespace.decision.status, 'dropped');
  assert.equal(whitespace.decision.cursorAfter, 0);
  assert.equal(whitespace.decision.firstNonWhitespaceIndex, 1);
  assert.equal(whitespace.diagnostic.col, 3);
  assert.equal(whitespace.error.props.raw, '  text value=ok');
  assert.equal(executeFrontendNodeTypeTokenAdmission('mystery').decision.status, 'admitted');
});

test('evolved identifier admission uses normalized token value and exact cursor movement', () => {
  const result = executeFrontendNodeTypeTokenAdmission('evolved:name value=1');
  assert.equal(result.decision.tokenZeroValue, 'name');
  assert.equal(result.decision.admittedType, 'name');
  assert.equal(result.decision.cursorAfter, 1);
});

test('drop recovery uses retained code, UTF-16 parser locations, and scalar/byte seals', () => {
  const result = executeFrontendNodeTypeTokenAdmission('"😀" text \t# payload');
  assert.equal(result.decision.status, 'dropped');
  assert.equal(result.error.props.raw, '"😀" text');
  assert.equal(result.error.rawLength, 9);
  assert.equal(result.error.loc.endCol, 10);
  assert.equal(result.seal.retainedByteLength, Buffer.byteLength('"😀" text', 'utf8'));
  assert.equal(result.seal.originalContent, '"😀" text \t# payload');
});

test('inherited empty and unsupported streams fail atomically', () => {
  for (const fixture of INHERITED_ADMISSION_FAILURE_FIXTURES) {
    assert.deepEqual(executeFrontendNodeTypeTokenAdmission(fixture.source), failure(fixture.code), fixture.id);
  }
});

test('inherited failures authenticate the complete M4.159 failure envelope', () => {
  const policy = loadFrontendNodeTypeTokenAdmissionPolicy();
  const source = loadNodeTypeTokenAdmissionSource();
  const forged = mutate(
    source,
    'do value="out.push(\\"kern.frontend.retained-token-stream-shadow.1\\")"',
    'do value="out.push(\\"kern.frontend.retained-token-stream-shadow.FORGED\\")"',
  );
  assert.throws(
    () => executeFrontendNodeTypeTokenAdmission('', policy, forged),
    /record rejection|runtime rejection/u,
  );
});

test('policy is exact and the maximum admission result fits the runtime collection', () => {
  const policy = loadFrontendNodeTypeTokenAdmissionPolicy();
  const maxInheritedStreamFields = 1 + (policy.maxStreamRecords + 2) * 10;
  const maxStreamAuthRecords = Math.ceil(maxInheritedStreamFields / 12);
  assert.ok(1 + (4 + maxStreamAuthRecords) * 16 <= policy.runtimeLimits.maxCollectionLength);
  assert.ok(policy.profileLimits.maxOutputJsonBytes <= policy.runtimeLimits.maxBytes);
  assert.throws(() => validateFrontendNodeTypeTokenAdmissionPolicy({ format: policy.nodeTypeTokenAdmissionFormat }), /exactly/u);
});

test('configured maxima succeed within the deterministic runtime budget', () => {
  const policy = loadFrontendNodeTypeTokenAdmissionPolicy();
  const diagnosticTokenWidth = 2;
  const atLimitSource = `${','.repeat(
    policy.profileLimits.maxTokens - policy.profileLimits.maxDiagnostics * diagnosticTokenWidth,
  )}${'1.0n '.repeat(policy.profileLimits.maxDiagnostics)}`;
  const atLimit = executeFrontendNodeTypeTokenAdmission(atLimitSource, policy);
  assert.equal(atLimit.decision.tokenCount, policy.profileLimits.maxTokens);
  assert.equal(
    atLimit.decision.inheritedStreamFieldCount,
    1 + (policy.profileLimits.maxTokens + policy.profileLimits.maxDiagnostics + 2) * 10,
  );
  assert.deepEqual(
    executeFrontendNodeTypeTokenAdmission(','.repeat(policy.profileLimits.maxTokens + 1), policy),
    failure('TOKEN_LIMIT'),
  );
  assert.deepEqual(
    executeFrontendNodeTypeTokenAdmission('1.0n '.repeat(policy.profileLimits.maxDiagnostics + 1), policy),
    failure('DIAGNOSTIC_LIMIT'),
  );
});

test('native source composes M4.159 without parser or registry delegation', () => {
  const source = loadNodeTypeTokenAdmissionSource();
  assert.match(source, /observeretainedtokenstream/u);
  assert.match(source, /fn name=observenodetypetokenadmission/u);
  assert.doesNotMatch(source, /TokenStream|tryIdent|isKnownNodeType|UNKNOWN_NODE_TYPE|parseDocument/u);
  assert.throws(
    () => validateNativeNodeTypeTokenAdmissionSource(source.replace('handler lang="kern"', 'handler')),
    /every source handler/u,
  );
});

test('named cursor, normalization, raw-source, coordinate, and status mutations are rejected', () => {
  const policy = loadFrontendNodeTypeTokenAdmissionPolicy();
  const source = loadNodeTypeTokenAdmissionSource();
  const cases = [
    ['skip whitespace', 'tokenZeroKind == \\"identifier\\"', 'firstNonWhitespaceKind == \\"identifier\\"', '  text'],
    ['move dropped cursor', 'assign target=cursorAfter value="1"', 'assign target=cursorAfter value="0"', 'text'],
    ['raw original content', 'do value="out.push(retainedSource)"', 'do value="out.push(content)"', '@ # payload'],
    [
      'shift diagnostic column',
      'String(firstNonWhitespaceUtf16Start + 1)',
      'String(firstNonWhitespaceUtf16Start + 2)',
      '@ text',
    ],
    [
      'constant admitted type',
      'assign target=admittedType value="tokenZeroValue"',
      'assign target=admittedType value="\\"text\\""',
      'evolved:name',
    ],
    [
      'collapse astral UTF-16 width',
      'assign target=units value="units + 2"',
      'assign target=units value="units + 1"',
      '"😀" text',
    ],
    [
      'corrupt retained token delta',
      'do value="out.push(tokenDelta)"',
      'do value="out.push(tokenDelta + \\"x\\")"',
      'text value=ok',
    ],
    [
      'forge retained marker offset',
      'do value="out.push(trimmed[18])"\n    do value="out.push(markerOffsetText)"\n    do value="out.push(trimmed[14])"',
      'do value="out.push(trimmed[18])"\n    do value="out.push(\\"none\\")"\n    do value="out.push(trimmed[14])"',
      'text # payload',
    ],
    [
      'forge retained marker text',
      'do value="out.push(trimmed[15])"',
      'do value="out.push(\\"//\\")"',
      'text # payload',
    ],
    [
      'forge retained raw payload',
      'do value="out.push(trimmed[16])"',
      'do value="out.push(\\"forged\\")"',
      'text # payload',
    ],
    [
      'substitute retained diagnostic code',
      'do value="out.push(tokenized[diagnosticCursor + 1])"',
      'do value="out.push(\\"UNCLOSED_STYLE\\")"',
      'text value="open',
    ],
    [
      'substitute later retained token kind',
      'do value="out.push(tokenized[tokenCursor + 1])"',
      'if cond="tokenIndex == 0"\n          do value="out.push(tokenized[tokenCursor + 1])"\n        else\n          do value="out.push(\\"whitespace\\")"',
      'text value=ok',
    ],
    [
      'substitute later retained token value',
      'do value="out.push(tokenized[tokenCursor + 2])"',
      'if cond="tokenIndex == 0"\n          do value="out.push(tokenized[tokenCursor + 2])"\n        else\n          do value="out.push(\\"forged-value\\")"',
      'text value=ok',
    ],
  ];
  for (const [label, from, to, content] of cases) {
    assert.throws(
      () => executeFrontendNodeTypeTokenAdmission(content, policy, mutate(source, from, to)),
      /record rejection|runtime rejection/u,
      label,
    );
  }
});
