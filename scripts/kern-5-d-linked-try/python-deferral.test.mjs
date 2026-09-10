import assert from 'node:assert/strict';
import test from 'node:test';

import * as ledgerSupport from '../kern-5-parity-ledger/ledger-support.mjs';
import {
  LEDGER_THROW_ROW,
  LEDGER_TRY_FAMILY_ROWS,
  LEDGER_TRY_ROW,
  TRY_POSITIONS,
  assertLinkLabel,
  assertTryAdmitted,
  repositoryText,
  tryPythonCompile,
} from './k0-support.mjs';
import { LEDGER_NODE_KINDS, NEW_STATEMENT_KINDS, OMITTED_ROW_POSITION, SPENDING_SLICE, TRY_ROW_POSITION_NAMES } from './pins.mjs';

const {
  DEFERRAL_LABEL,
  LEDGER_SHA256,
  ROW_KEYS,
  compilerRequest,
  ledgerRows,
  sha256,
  source: ledgerSource,
  statementLowering,
  validateLedger,
  verified: ledgerVerified,
} = ledgerSupport;

const HELPER_REFUSAL_LABEL = 'KIR_TRY_FAMILY_IN_HELPER';

test('the ledger carries exactly the pinned rows, sorted by nodeKind', () => {
  const rows = ledgerRows();
  assert.deepEqual(
    rows.map((row) => row.nodeKind),
    [...LEDGER_NODE_KINDS],
    'D_LEDGER_ROWS: the ledger must carry exactly LEDGER_NODE_KINDS, in that order',
  );
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort(), `D_LEDGER_SHAPE: ${row.nodeKind} row shape drifted`);
  }
});

test('the throw and try rows carry the honest dependency order and this slice spec path', () => {
  const rows = ledgerRows();
  const throwRow = rows.find((row) => row.nodeKind === 'throw');
  const tryRow = rows.find((row) => row.nodeKind === 'try');
  assert.ok(throwRow !== undefined, 'D_LEDGER_ROWS: the throw row must exist');
  assert.ok(tryRow !== undefined, 'D_LEDGER_ROWS: the try row must exist');
  assert.deepEqual(
    throwRow,
    { ...LEDGER_THROW_ROW, blockedBy: [...LEDGER_THROW_ROW.blockedBy] },
    'D_LEDGER_ROWS: throw.blockedBy is empty -- there is no lowering dependency on the jump family',
  );
  assert.deepEqual(
    tryRow,
    { ...LEDGER_TRY_ROW, blockedBy: [...LEDGER_TRY_ROW.blockedBy] },
    "D_LEDGER_ROWS: try.blockedBy is ['throw'] -- a catch clause is meaningless before a throw lowers",
  );
  assert.equal(tryRow.since, SPENDING_SLICE);
});

test('the ledger document validates and its digest equals the checked-in hash', () => {
  assert.doesNotThrow(() => validateLedger(JSON.parse(ledgerSource(ledgerSupport.LEDGER_URL))));
  assert.equal(
    sha256(ledgerSource(ledgerSupport.LEDGER_URL)),
    LEDGER_SHA256,
    'D_LEDGER_DIGEST: LEDGER_SHA256 must be re-pinned by hand after the two rows land',
  );
});

test('the Python statement lowering marks exactly the ledger kinds as deferred', async () => {
  const statements = await statementLowering();
  const deferred = Object.entries(statements)
    .filter(([, state]) => state === 'deferred')
    .map(([kind]) => kind)
    .sort();
  assert.deepEqual(
    deferred,
    [...LEDGER_NODE_KINDS],
    'D_LOWERING_DRIFT: the deferred set and the ledger rows must agree exactly',
  );
  for (const kind of NEW_STATEMENT_KINDS) {
    assert.equal(statements[kind], 'deferred', `D_LOWERING_DRIFT: ${kind} must be marked deferred, never lowered`);
  }
});

test('the Python expression lowering table is unchanged, because D adds no expression kind', async () => {
  const request = repositoryText('packages/core/src/compiler/kir-python/request.ts');
  const table = request.slice(
    request.indexOf('export const KIR_PYTHON_EXPRESSION_LOWERING'),
    request.indexOf('satisfies Record<LinkedKernKirExpression'),
  );
  assert.ok(table.length > 0, 'the expression lowering table must be locatable');
  assert.equal(
    table.includes('deferred'),
    false,
    'D_LOWERING_DRIFT: no expression kind is deferred by D; the payload rides the record kind unchanged',
  );
});

// D-6's licensed edit, asserted by name: the two purpose-built catalogues must exist, or a try/throw
// row falls through to the `for`-shaped generic catalogue, the Python compile SUCCEEDS and
// assertNoPythonArtifact fails -- rt12's [RT12J-TD11] verbatim.
test('both purpose-built position catalogues exist and omit helper-body', () => {
  for (const name of ['THROW_ROW_POSITIONS', 'TRY_ROW_POSITIONS']) {
    const catalogue = ledgerSupport[name];
    assert.ok(
      catalogue !== undefined,
      `D_CATALOGUE_MISSING: ${name} must exist, or the row falls through to the for-shaped generic catalogue`,
    );
    assert.deepEqual(
      Object.keys(catalogue).sort(),
      [...TRY_ROW_POSITION_NAMES],
      `D_CATALOGUE_SHAPE: ${name} must carry the four reachable positions`,
    );
    assert.equal(
      Object.hasOwn(catalogue, OMITTED_ROW_POSITION),
      false,
      `D_CATALOGUE_SHAPE: ${name} must omit ${OMITTED_ROW_POSITION}, because the try family is a link refusal there`,
    );
  }
});

test('both position dispatchers wire the two new catalogues, so no row falls through', () => {
  for (const file of ['parent-positions.test.mjs', 'refusal-golden.test.mjs']) {
    const source = repositoryText(`scripts/kern-5-parity-ledger/${file}`);
    for (const key of ['THROW_ROW_POSITIONS', 'TRY_ROW_POSITIONS']) {
      assert.ok(
        source.includes(key),
        `D_DISPATCHER_GAP: ${file} must wire ${key}, or the row uses STATEMENT_POSITIONS and the Python compile succeeds`,
      );
    }
  }
});

// The deferral itself, position by position: the program links, the JavaScript artifact is produced,
// and the Python compile is refused with the deferral label and no artifact.
for (const name of TRY_ROW_POSITION_NAMES) {
  for (const kind of NEW_STATEMENT_KINDS) {
    test(`${kind} at ${name} links, emits JavaScript, and is refused on the Python leg`, async () => {
      const catalogue = ledgerSupport[kind === 'try' ? 'TRY_ROW_POSITIONS' : 'THROW_ROW_POSITIONS'];
      assert.ok(catalogue !== undefined, `D_CATALOGUE_MISSING: the ${kind} position catalogue must exist`);
      const source = catalogue[name]();
      await assertTryAdmitted(`${kind}@${name}`, source);
      const python = await tryPythonCompile(source);
      assert.equal(
        ledgerSupport.assertNoPythonArtifact(python, `${kind} at ${name}`),
        DEFERRAL_LABEL,
        `D_DEFERRAL_LEAK: ${kind} at ${name} must refuse on the Python leg with ${DEFERRAL_LABEL} and emit no artifact`,
      );
    });
  }
}

// The omitted position gets its own explicit row: `helper-body` is a LINK refusal on every leg, so a
// deferral row there would have gone RED for the linker's reason rather than the deferral's.
test('the helper-body position is a link refusal on all legs, which is why the catalogues omit it', async () => {
  await assertLinkLabel(TRY_POSITIONS['neg-throw-in-helper'](), HELPER_REFUSAL_LABEL);
  await assertLinkLabel(TRY_POSITIONS['neg-try-in-helper'](), HELPER_REFUSAL_LABEL);
});

test('the exhaustiveness scrape names both new kinds, so the surface pin cannot drift', () => {
  const exhaustiveness = repositoryText('scripts/kern-5-parity-ledger/exhaustiveness.test.mjs');
  for (const kind of NEW_STATEMENT_KINDS) {
    assert.ok(
      exhaustiveness.includes(`'${kind}'`),
      `D_SURFACE_DRIFT: the exhaustiveness STATEMENT_KINDS list must name ${kind}`,
    );
  }
  assert.ok(
    exhaustiveness.includes("['break', 'continue', 'do', 'each', 'throw', 'try', 'while']"),
    'D_SURFACE_DRIFT: the deferred deepEqual must be the whole ledger kind list',
  );
});

test('the ledger-aware gate rows move from three to five, for both the rows and the kinds', () => {
  const gates = repositoryText('scripts/kern-5-parity-ledger/ledger-aware-gates.test.mjs');
  assert.equal(
    gates.includes("['break', 'continue', 'while']"),
    false,
    'D_PRIOR_PIN_STALE: the ledger-aware gate kind list must move from three kinds to five',
  );
  for (const row of LEDGER_TRY_FAMILY_ROWS) {
    assert.ok(
      gates.includes(`nodeKind: '${row.nodeKind}'`),
      `D_PRIOR_PIN_STALE: the ledger-aware gate row literal must carry the ${row.nodeKind} row`,
    );
  }
});

// The parity-ledger oracle walks a linked program itself to recompute which kinds it carries. That
// walker visits statement children by field name, so it must learn the try clause blocks -- or a
// throw nested inside a try body is invisible to the deferral gate.
test('the ledger own recomputed walker visits the try clause blocks, so a nested throw is not missed', () => {
  const support = repositoryText('scripts/kern-5-parity-ledger/support.mjs');
  const walker = support.slice(support.indexOf('function walkStatements'), support.indexOf('export function pythonDeferral'));
  assert.ok(walker.length > 0, 'the recomputed walker must be locatable');
  for (const field of ['catchBody', 'finallyBody']) {
    assert.ok(
      walker.includes(field),
      `D_WALKER_HOLE: the parity-ledger walker must visit ${field}, or a deferred kind nested in that clause is invisible`,
    );
  }
});

test('a deferral is Python-only, so the same try program still compiles to JavaScript', async () => {
  const source = TRY_POSITIONS['try-catch']();
  await assertTryAdmitted('try-catch', source);
  const python = await tryPythonCompile(source);
  assert.equal(python.outcome, 'failure', 'D_DEFERRAL_LEAK: the Python leg must refuse a try program');
  assert.equal(python.code, DEFERRAL_LABEL);
  assert.ok(compilerRequest !== undefined && ledgerVerified !== undefined);
});
