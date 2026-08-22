import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  captureF4ADocument,
  decodeCapturedDocument,
  executeF4AComposition,
  loadPristineF4AComposition,
  replaceExactly,
  runA8DocumentControls,
  runA8DocumentMutations,
} from './a8-document-support.mjs';
import { __test, runDocument } from './worker.mjs';

const EXPECTED = Object.freeze({
  'A8-F1': ['F4_F2B_DRIFT', 0],
  'A8-F4': ['F4_AUTHORITY_DRIFT', 1],
  'A8-F5': ['independent-oracle-mismatch', 1],
  'A8-F6': ['decoder-atomicity-rejection', 1],
  'A8-F8': ['resource-and-source-rejection', 1],
  'A8-F9': ['decoder-seal-rejection', 1],
});

test('A8.2 primitives capture, execute, replace, and decode authentic F4A state', () => {
  const moduleId = 'a8-primitives.kern';
  const source = 'fn name=primitiveWitness export=true\n';
  const publicResult = runDocument(moduleId, source);
  const captured = captureF4ADocument(moduleId, source);
  assert.equal(captured.args.length, 109);
  assert.deepEqual(captured.fields, publicResult.fields);
  assert.deepEqual(captured.receipt, publicResult.receipt);

  const executed = executeF4AComposition(
    loadPristineF4AComposition(captured.policy),
    structuredClone(captured.args),
    captured.policy,
  );
  assert.equal(executed.envelope, 'success');
  assert.equal(executed.runtimeInvocations, 1);
  assert.deepEqual(executed.fields, captured.fields);
  assert.deepEqual(decodeCapturedDocument(executed.fields, captured), captured.receipt);

  assert.deepEqual(replaceExactly('before TARGET after', 'TARGET', 'replacement'), {
    source: 'before replacement after',
    replacementCount: 1,
  });
  assert.throws(() => replaceExactly('no target', 'TARGET', 'replacement'), /exactly one|replacement/iu);
  assert.throws(() => replaceExactly('TARGET TARGET', 'TARGET', 'replacement'), /exactly one|replacement/iu);
  assert.throws(() => replaceExactly('TARGET', 'TARGET', 'TARGET'), /no-op|replacement/iu);
});

test('A8.2 document mutants reach one authentic F4A root and only their designated killers', async () => {
  const reports = await runA8DocumentMutations();
  assert.deepEqual(reports.map(({ id }) => id), Object.keys(EXPECTED));
  for (const report of reports) {
    const [killer, replacementCount] = EXPECTED[report.id];
    assert.equal(report.control, 'passed', `${report.id}: pristine control`);
    assert.equal(report.sentinel, 'reached', `${report.id}: paired reachability sentinel`);
    assert.equal(report.abi, 109, `${report.id}: authentic F4A ABI`);
    assert.equal(report.runtimeInvocations, 1, `${report.id}: exactly one mutated root call`);
    assert.equal(report.replacementCount, replacementCount, `${report.id}: one deliberate source defect`);
    assert.equal(report.envelope, 'success', `${report.id}: runtime crashes cannot kill mutants`);
    assert.equal(report.killedBy, killer, `${report.id}: exact designated killer`);
  }
});

test('A8.2 controls cover composition skew, stale generation, C13 claims, and oracle self-kills', () => {
  assert.deepEqual(runA8DocumentControls(), {
    compositionSkewRejected: true,
    staleAuthorityRejected: true,
    c13ExactControl: 'ok',
    c13ExactLimit: 'limit',
    c13ClaimMutationsRejected: 6,
    oracleCanariesRejected: 3,
  });

  const frame = (value) => `i${Array.from(value).length}:${value}`;
  const row = ['structural', 'invalid-expression', '0', '1', '-1', '0'].map(frame).join('');
  const tape = frame(row);
  const bytes = Buffer.byteLength(tape, 'utf8');
  assert.deepEqual(__test.runGlobalFactVerify(tape, 0, 0, 5, 3, 1, bytes, 9, 10),
    ['ok', '1', String(bytes), '10', tape]);
  assert.deepEqual(__test.runGlobalFactVerify(tape, 0, 0, 5, 3, 1, bytes, 9, 9), ['limit']);
  for (const args of [
    ['', -1, 0, 0, 0, -1, 0, 0, 10],
    ['', 0, -1, 0, 0, 0, -1, 0, 10],
    ['', 0, 0, -1, 0, 0, 0, -1, 10],
    ['', 1, 0, 0, 0, 0, 0, 0, 10],
  ]) assert.deepEqual(__test.runGlobalFactVerify(...args), ['drift'], `invalid accounting ${args}`);
  for (const args of [
    [`${tape}x`, 0, 0, 5, 3, 1, bytes, 9, 10],
    [frame('x'), 0, 0, 5, 3, 1, bytes, 9, 10],
    [frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(frame).join('')), 0, 0, 5, 3, 1, bytes, 9, 10],
    [tape, 0, 0, 5, 3, 2, bytes, 9, 10],
    [tape, 0, 0, 5, 3, 1, bytes + 1, 9, 10],
    [tape, 0, 0, 5, 3, 1, bytes, 8, 10],
  ]) assert.deepEqual(__test.runGlobalFactVerify(...args), ['drift']);
});

test('A8.2 runner source owns authentic execution and attribution machinery', () => {
  const source = readFileSync(new URL('./a8-document-support.mjs', import.meta.url), 'utf8');
  for (const token of [
    'executeKernRuntimeHandlerSync',
    'runDocumentWithTestInput',
    'runDocumentWithProfileLimits',
    'decodeDocument',
    'renderAuthority',
    'runGlobalFactVerify',
  ]) assert.ok(source.includes(token), token);
  assert.match(source, /function replaceExactly\b/u);
  assert.match(source, /replacementCount/u);
  assert.doesNotMatch(source,
    /catch(?:\s*\([^)]*\))?\s*\{\s*return\s+(?:true|['"]passed['"])/u);
});
