import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFERRAL_LABEL,
  EXPRESSION_POSITIONS,
  STATEMENT_POSITIONS,
  WHILE_ROW_POSITIONS,
  assertNoPythonArtifact,
  compileJavaScript,
  compilePython,
  compileWithLowering,
  compilerRequest,
  indexSource,
  injectedLowering,
  ledgerRows,
  linked,
  loweringTable,
  verified,
} from './ledger-support.mjs';

const UNLINKABLE = STATEMENT_POSITIONS['handler-top-level']().replace(
  'assign target="acc" value="acc + i"',
  'let name=b value="!(1 < 2)"',
);

function manifest(result) {
  return JSON.parse(Buffer.from(result.manifest.bytes).toString('utf8'));
}

// The shape a deferral refusal must match is measured, not predicted: this is a live Python compile
// failure on this base, and `scripts/kern-5-c-py-1-contract/support.mjs` pins the same three keys.
test('a Python compile refusal carries exactly code, format and outcome, and no artifact', async () => {
  const result = compilePython(await verified(UNLINKABLE));
  assert.equal(assertNoPythonArtifact(result, 'the measured base refusal'), 'handler-entry-unsupported');
});

test('link is target neutral: one linker, one digest, whatever the target', async () => {
  const text = STATEMENT_POSITIONS['handler-top-level']();
  const value = await verified(text);
  const program = await linked(text);
  const javascript = compileJavaScript(value);
  const python = compilePython(value);
  assert.equal(javascript.outcome, 'success', `javascript compile failed: ${javascript.code}`);
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
  assert.equal(manifest(javascript).linkedProgramSha256, program.sha256);
  assert.equal(
    manifest(python).linkedProgramSha256,
    program.sha256,
    'PARITY_LEDGER_TARGET_LINK: the same program must link identically regardless of target',
  );
});

// The checked-in ledger now carries the `while` row, so this is no longer "with an empty ledger":
// it is "positions that carry no deferred kind still compile," which `STATEMENT_POSITIONS` and
// `EXPRESSION_POSITIONS` still exercise, because neither catalogue's fixtures carry a `while` node.
test('positions that carry no deferred kind still compile to Python', async () => {
  for (const [name, build] of Object.entries({ ...STATEMENT_POSITIONS, ...EXPRESSION_POSITIONS })) {
    const result = compilePython(await verified(build()));
    assert.equal(result.outcome, 'success', `PARITY_LEDGER_UNRELATED_REFUSAL: ${name} refused with ${result.code}`);
  }
});

test('the admission pass is wired ahead of emission at the compile entry', () => {
  const text = indexSource();
  const pass = text.indexOf('pythonLoweringDeferral(');
  const emit = text.indexOf('emitPython(');
  assert.ok(pass >= 0, 'PARITY_LEDGER_UNWIRED: the compile entry must call pythonLoweringDeferral');
  assert.ok(emit >= 0, 'the compile entry must still emit Python');
  assert.ok(pass < emit, 'PARITY_LEDGER_ORDER: the admission pass must run before emitPython');
});

test('every ledger row refuses with the exact label and no Python artifact', async () => {
  const compile = await compileWithLowering();
  const table = await loweringTable();
  for (const row of ledgerRows()) {
    assert.equal(table[row.surface][row.nodeKind], 'deferred', `${row.nodeKind}: the row must be deferred`);
    const positions =
      row.nodeKind === 'while'
        ? WHILE_ROW_POSITIONS
        : row.surface === 'statement'
          ? STATEMENT_POSITIONS
          : EXPRESSION_POSITIONS;
    for (const [name, fixture] of Object.entries(positions)) {
      const result = compile(await verified(fixture()), compilerRequest(), table);
      assert.equal(assertNoPythonArtifact(result, `${row.nodeKind} at ${name}`), row.label);
    }
  }
});

// The harness above iterates zero rows today, so these two rows prove it fires: a synthetic table
// that defers one kind must produce the refusal, through production code, with no artifact returned.
test('a synthetic deferred statement row refuses through the production compile entry', async () => {
  const compile = await compileWithLowering();
  const table = injectedLowering(await loweringTable(), 'statement', 'for', 'deferred');
  const value = await verified(STATEMENT_POSITIONS['handler-top-level']());
  assert.equal(assertNoPythonArtifact(compile(value, compilerRequest(), table), 'synthetic for'), DEFERRAL_LABEL);
});

test('a synthetic deferred expression row refuses through the production compile entry', async () => {
  const compile = await compileWithLowering();
  const table = injectedLowering(await loweringTable(), 'expression', 'binary', 'deferred');
  const value = await verified(EXPRESSION_POSITIONS['let-value']());
  assert.equal(assertNoPythonArtifact(compile(value, compilerRequest(), table), 'synthetic binary'), DEFERRAL_LABEL);
});

test('the production table admits what the synthetic table refuses', async () => {
  const compile = await compileWithLowering();
  const value = await verified(STATEMENT_POSITIONS['handler-top-level']());
  const result = compile(value, compilerRequest(), await loweringTable());
  assert.equal(result.outcome, 'success', 'PARITY_LEDGER_OVER_REFUSAL: the empty ledger must refuse nothing');
  assert.equal(result.artifact.path, 'entry.py');
});

// The seam must be the production path with an injectable table, never a parallel branch: called
// without a table it defaults to the production mapping and must be indistinguishable from the
// public entry, for every fixture in the position matrix.
test('the seam defaults to the production mapping and matches the public entry everywhere', async () => {
  const compile = await compileWithLowering();
  for (const [name, build] of Object.entries({ ...STATEMENT_POSITIONS, ...EXPRESSION_POSITIONS })) {
    const value = await verified(build());
    const direct = compilePython(value);
    assert.equal(direct.outcome, 'success', `${name}: ${direct.code}`);
    assert.deepEqual(
      compile(value, compilerRequest()),
      direct,
      `PARITY_LEDGER_SEAM_DRIFT: ${name} differs between the injectable entry and the public entry`,
    );
  }
});

test('the seam with the production table explicitly passed is the same result again', async () => {
  const compile = await compileWithLowering();
  const value = await verified(STATEMENT_POSITIONS['handler-top-level']());
  assert.deepEqual(compile(value, compilerRequest(), await loweringTable()), compilePython(value));
});

test('a deferral is Python-only: the JavaScript leg still compiles the same program', async () => {
  const compile = await compileWithLowering();
  const table = injectedLowering(await loweringTable(), 'statement', 'for', 'deferred');
  const value = await verified(STATEMENT_POSITIONS['handler-top-level']());
  assertNoPythonArtifact(compile(value, compilerRequest(), table), 'python leg');
  const javascript = compileJavaScript(value);
  assert.equal(javascript.outcome, 'success', 'PARITY_LEDGER_JS_BLEED: a Python deferral refused the JavaScript leg');
  assert.equal(javascript.artifact.path, 'entry.mjs');
});
