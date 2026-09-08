import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFERRAL_LABEL,
  EXPRESSION_POSITIONS,
  JUMP_ROW_POSITIONS,
  POSITION_FENCES,
  STATEMENT_POSITIONS,
  THROW_ROW_POSITIONS,
  TRY_ROW_POSITIONS,
  WHILE_ROW_POSITIONS,
  admission,
  assertNoPythonArtifact,
  compileWithLowering,
  compilerRequest,
  injectedLowering,
  ledgerRows,
  loweringTable,
  verified,
} from './ledger-support.mjs';

const STATEMENT_NAMES = Object.freeze(['for-body', 'handler-top-level', 'helper-body', 'if-else', 'if-then']);
const EXPRESSION_NAMES = Object.freeze([
  'assign-value',
  'call-argument',
  'for-from',
  'for-step',
  'for-to',
  'if-condition',
  'json-call-argument',
  'let-value',
  'list-item',
  'member-source-record',
  'print-value',
  'record-value',
  'return-value',
]);

test('the position matrix is the measured one, so a shrunken probe is noticed', () => {
  assert.deepEqual(Object.keys(STATEMENT_POSITIONS).sort(), [...STATEMENT_NAMES]);
  assert.deepEqual(Object.keys(EXPRESSION_POSITIONS).sort(), [...EXPRESSION_NAMES]);
});

test('every position in the matrix projects, links and reaches the Python leg today', async () => {
  for (const [name, build] of Object.entries({ ...STATEMENT_POSITIONS, ...EXPRESSION_POSITIONS })) {
    const row = await admission(build());
    assert.equal(row.projection, 'projected', `${name} must project so a refusal is a compile decision`);
    assert.equal(row.rt1, 'admitted', `${name} must link so a refusal is not a link refusal`);
    assert.equal(row.python, 'admitted', `${name} must reach the Python emitter at base`);
  }
});

// Two positions a probe expression does not reach on this base. They are fences: if either starts
// to project or link, the matrix above is incomplete and the negative probe has a hole.
test('the two unreachable positions stay unreachable', async () => {
  for (const [name, fence] of Object.entries(POSITION_FENCES)) {
    const row = await admission(fence.build());
    assert.equal(row.projection, fence.projection, `PARITY_LEDGER_MATRIX_HOLE: ${name} changed projection`);
    if (fence.python !== undefined) {
      assert.equal(row.python, fence.python, `PARITY_LEDGER_MATRIX_HOLE: ${name} changed link admission`);
    }
  }
});

// `STATEMENT_POSITIONS`/`EXPRESSION_POSITIONS` are `for`/`binary`-shaped position sweeps and carry
// no `while` node, so a row whose nodeKind is `while` needs its own mirror catalogue
// (RT11W-TD7, Corrections Log) rather than the generic one.
test('each ledger row refuses in every position of its surface', async () => {
  const compile = await compileWithLowering();
  const table = await loweringTable();
  for (const row of ledgerRows()) {
    const statementPositions = {
      throw: THROW_ROW_POSITIONS,
      try: TRY_ROW_POSITIONS,
      while: WHILE_ROW_POSITIONS,
      ...JUMP_ROW_POSITIONS,
    };
    const positions =
      row.surface === 'statement' ? (statementPositions[row.nodeKind] ?? STATEMENT_POSITIONS) : EXPRESSION_POSITIONS;
    for (const [name, build] of Object.entries(positions)) {
      const result = compile(await verified(build()), compilerRequest(), table);
      assert.equal(assertNoPythonArtifact(result, `${row.nodeKind} at ${name}`), row.label);
    }
  }
});

test('a synthetic deferred statement refuses in all five statement positions', async () => {
  const compile = await compileWithLowering();
  const table = injectedLowering(await loweringTable(), 'statement', 'for', 'deferred');
  for (const [name, build] of Object.entries(STATEMENT_POSITIONS)) {
    const result = compile(await verified(build()), compilerRequest(), table);
    assert.equal(assertNoPythonArtifact(result, `synthetic for at ${name}`), DEFERRAL_LABEL);
  }
});

test('a synthetic deferred expression refuses in all thirteen expression positions', async () => {
  const compile = await compileWithLowering();
  const table = injectedLowering(await loweringTable(), 'expression', 'binary', 'deferred');
  for (const [name, build] of Object.entries(EXPRESSION_POSITIONS)) {
    const result = compile(await verified(build()), compilerRequest(), table);
    assert.equal(assertNoPythonArtifact(result, `synthetic binary at ${name}`), DEFERRAL_LABEL);
  }
});

// `record`, `list` and `member` are the three lowering paths a deferred node could smuggle itself
// through, because each one recurses into a child expression the shallow walk would not visit.
test('a deferred node cannot smuggle itself through record, list or member lowering', async () => {
  const compile = await compileWithLowering();
  const table = injectedLowering(await loweringTable(), 'expression', 'binary', 'deferred');
  for (const name of ['list-item', 'member-source-record', 'record-value']) {
    const result = compile(await verified(EXPRESSION_POSITIONS[name]()), compilerRequest(), table);
    assert.equal(assertNoPythonArtifact(result, `nested binary at ${name}`), DEFERRAL_LABEL);
  }
});
