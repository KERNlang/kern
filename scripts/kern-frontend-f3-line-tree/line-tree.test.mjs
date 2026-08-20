import assert from 'node:assert/strict';
import test from 'node:test';

import { FIXTURES, ROLE_SUBSTITUTION_PAIRS } from './fixtures.mjs';
import { computeGeometryOracle } from './oracle.mjs';
import { runDocument } from './worker.mjs';

test('empty document produces sealed empty structured receipt', () => {
  const { receipt } = runDocument('');
  assert.equal(receipt.status, 'structured');
  assert.deepEqual(receipt.logicalLines, []);
  assert.deepEqual(receipt.parentEdges, []);
  assert.deepEqual(receipt.decoratorRuns, []);
  assert.deepEqual(receipt.rawBlocks, []);
  assert.deepEqual(receipt.diagnostics, []);
  assert.match(receipt.seal, /^[0-9a-f]{64}$/u);
});

test('hand-authored fixtures match independent geometric oracle', () => {
  for (const [id, source] of Object.entries(FIXTURES)) {
    const result = runDocument(source);
    assert.equal(result.receipt.status, 'structured', `fixture ${id} must succeed`);
    const oracle = computeGeometryOracle(result.scan.decoded.records, result.batch.receipt.segments, source);

    assert.equal(result.receipt.logicalLines.length, oracle.logicalLines.length, `${id} line count`);
    for (let i = 0; i < oracle.logicalLines.length; i += 1) {
      const actual = result.receipt.logicalLines[i];
      const expected = oracle.logicalLines[i];
      assert.deepEqual(actual, expected, `${id} line ${i} mismatch`);
    }

    assert.equal(result.receipt.parentEdges.length, oracle.parentEdges.length, `${id} edge count`);
    for (let i = 0; i < oracle.parentEdges.length; i += 1) {
      assert.deepEqual(result.receipt.parentEdges[i], oracle.parentEdges[i], `${id} edge ${i} mismatch`);
    }

    assert.equal(result.receipt.decoratorRuns.length, oracle.decoratorRuns.length, `${id} decorator run count`);
    for (let i = 0; i < oracle.decoratorRuns.length; i += 1) {
      assert.deepEqual(result.receipt.decoratorRuns[i], oracle.decoratorRuns[i], `${id} decorator run ${i} mismatch`);
    }

    assert.equal(result.receipt.rawBlocks.length, oracle.rawBlocks.length, `${id} raw block count`);
    for (let i = 0; i < oracle.rawBlocks.length; i += 1) {
      assert.deepEqual(result.receipt.rawBlocks[i], oracle.rawBlocks[i], `${id} raw block ${i} mismatch`);
    }

    assert.equal(result.receipt.diagnostics.length, oracle.diagnostics.length, `${id} diagnostic count`);
    for (let i = 0; i < oracle.diagnostics.length; i += 1) {
      assert.deepEqual(result.receipt.diagnostics[i], oracle.diagnostics[i], `${id} diagnostic ${i} mismatch`);
    }
  }
});

test('multiline composites consume trailing content through the closing physical terminator', () => {
  const sources = [
    'let text = "first\nsecond" suffix\n',
    'let value = {{ 1 +\n2 }} suffix\n',
    'doc <<<\nbody\n>>> suffix\n',
    'let mixed = "first\nsecond" {{ 1 +\n2 }} suffix\n',
  ];

  for (const source of sources) {
    const result = runDocument(source);
    assert.equal(result.receipt.status, 'structured');
    assert.equal(result.receipt.logicalLines.length, 1, source);
    assert.equal(
      result.receipt.logicalLines[0].lastRecordOrdinal,
      result.scan.decoded.records.length - 1,
      source,
    );
    assert.equal(
      result.receipt.logicalLines[0].sourceEndScalar,
      result.scan.decoded.records.at(-1).startScalar,
      source,
    );
  }
});

test('role-substitution and suffix opacity preserve the complete F3 byte projection', () => {
  for (const pair of ROLE_SUBSTITUTION_PAIRS) {
    const resultA = runDocument(pair.sourceA);
    const resultB = runDocument(pair.sourceB);
    assert.equal(resultA.receipt.status, 'structured', `${pair.name} A must succeed`);
    assert.equal(resultB.receipt.status, 'structured', `${pair.name} B must succeed`);
    assert.equal(Array.from(pair.sourceA).length, Array.from(pair.sourceB).length, `${pair.name} geometry width`);
    assert.deepEqual(resultA.fields, resultB.fields, `${pair.name} complete F3 projection`);
    assert.equal(resultA.receipt.decoratorRuns[0].disposition, 'candidate');
    assert.equal(resultB.receipt.decoratorRuns[0].disposition, 'candidate');
  }
});

test('blank and comment-only lines do not form logical lines and do not reset indent', () => {
  const source = 'fn parent\n  # comment\n\n  let child = 1\n';
  const { receipt } = runDocument(source);
  assert.equal(receipt.logicalLines.length, 2);
  assert.equal(receipt.parentEdges.length, 2);
  assert.equal(receipt.parentEdges[1].parentLogicalOrdinal, 0);
  assert.equal(receipt.parentEdges[1].childIndent, 2);
  assert.equal(receipt.parentEdges[1].parentIndent, 0);
});

test('tab in leading indentation emits INVALID_INDENT', () => {
  const source = 'fn main\n\tlet x = 1\n';
  const { receipt } = runDocument(source);
  assert.equal(receipt.diagnostics.length, 1);
  assert.equal(receipt.diagnostics[0].code, 'INVALID_INDENT');
  assert.equal(receipt.diagnostics[0].logicalOrdinal, 1);
});

test('unseen dedent emits INDENT_JUMP', () => {
  const source = 'fn main\n    let deep = 1\n  let jump = 2\n';
  const { receipt } = runDocument(source);
  const jumpDiag = receipt.diagnostics.find((d) => d.code === 'INDENT_JUMP');
  assert.ok(jumpDiag, 'INDENT_JUMP must be emitted');
  assert.equal(jumpDiag.logicalOrdinal, 2);
});

test('malformed line emits DROPPED_LINE with role error', () => {
  const source = '123 invalid\n';
  const { receipt } = runDocument(source);
  assert.equal(receipt.logicalLines.length, 1);
  assert.equal(receipt.logicalLines[0].role, 'error');
  assert.equal(receipt.diagnostics.length, 1);
  assert.equal(receipt.diagnostics[0].code, 'DROPPED_LINE');
});

test('forced late failure returns atomic failure receipt', () => {
  const { receipt } = runDocument('fn main\n  return 1\n', { forceLateFailure: true });
  assert.equal(receipt.status, 'failure');
  assert.equal(receipt.diagnostics[0].code, 'FORCED_LATE_FAILURE');
  assert.deepEqual(receipt.logicalLines, []);
  assert.deepEqual(receipt.parentEdges, []);
  assert.deepEqual(receipt.decoratorRuns, []);
  assert.deepEqual(receipt.rawBlocks, []);
  assert.equal(receipt.header.seal, 'failure');
});
