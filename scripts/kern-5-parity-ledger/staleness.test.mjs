import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFERRAL_LABEL,
  LEDGER,
  deferralCode,
  expressionLowering,
  ledgerRows,
  linked,
  loweringDeferral,
  pythonContractsSource,
  statementLowering,
} from './ledger-support.mjs';

const LOWERED_PROGRAM = [
  'fn name=idp export=false returns=integer',
  '  param name=a type=integer',
  '  handler lang=kern',
  '    return value="a"',
  '',
  'fn name=route export=true returns=integer',
  '  handler lang=kern',
  '    let name=acc value="0"',
  '    for name=i from="0" to="3"',
  '      assign target="acc" value="acc + idp(i)"',
  '    return value="acc"',
  '',
].join('\n');

async function deferredKinds() {
  const statements = Object.entries(await statementLowering());
  const expressions = Object.entries(await expressionLowering());
  return [...statements, ...expressions].filter(([, state]) => state === 'deferred').map(([kind]) => kind);
}

test('the ledger label is the one canonical deferral string', () => {
  assert.equal(LEDGER.label, DEFERRAL_LABEL);
  assert.equal(DEFERRAL_LABEL, 'KIR_PYTHON_LEG_DEFERRED');
});

test('every deferred mapping entry has a ledger row', async () => {
  const rows = new Set(ledgerRows().map((row) => row.nodeKind));
  for (const kind of await deferredKinds()) {
    assert.ok(rows.has(kind), `PARITY_LEDGER_STALE: ${kind} is deferred in the mapping with no ledger row`);
  }
});

test('every ledger row is deferred in the mapping', async () => {
  const statements = await statementLowering();
  const expressions = await expressionLowering();
  for (const row of ledgerRows()) {
    const mapping = row.surface === 'statement' ? statements : expressions;
    assert.equal(
      mapping[row.nodeKind],
      'deferred',
      `PARITY_LEDGER_STALE: the ledger defers ${row.nodeKind} but the mapping lowers it`,
    );
  }
});

test('the refusal code the compiler returns is the string the ledger records', async () => {
  const code = await deferralCode();
  assert.equal(code, DEFERRAL_LABEL, 'PARITY_LEDGER_LABEL_DRIFT: the compile refusal code and the ledger label differ');
  for (const row of ledgerRows()) assert.equal(row.label, code);
});

test('the deferral code is a member of the closed Python compile failure union', () => {
  const text = pythonContractsSource();
  const start = text.indexOf('export type KernKirPythonCompileFailureCode =');
  assert.ok(start >= 0, 'contracts.ts must declare KernKirPythonCompileFailureCode');
  const end = text.indexOf('\n\n', start);
  assert.ok(
    text.slice(start, end).includes('typeof KIR_PYTHON_LEG_DEFERRED_CODE'),
    `PARITY_LEDGER_UNION_GAP: ${DEFERRAL_LABEL} must be a member of KernKirPythonCompileFailureCode`,
  );
});

test('the deferral pass reports no deferral for a program built only from lowered kinds', async () => {
  const deferral = await loweringDeferral();
  const program = await linked(LOWERED_PROGRAM);
  assert.equal(
    deferral(program),
    undefined,
    'PARITY_LEDGER_FALSE_POSITIVE: the admission pass refused a fully lowered program',
  );
});
