import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const PARITY_LEDGER_URL = new URL('./parity-ledger.json', import.meta.url);
export const PARITY_LEDGER_FORMAT = 'kern.compiler.kir-python.parity-ledger.v1';
export const KIR_PYTHON_LEG_DEFERRED = 'KIR_PYTHON_LEG_DEFERRED';
export const PYTHON_COMPILER_FORMAT = 'kern.compiler.kir-python.v1';

export function loadParityLedger() {
  const document = JSON.parse(readFileSync(PARITY_LEDGER_URL, 'utf8'));
  assert.equal(document.format, PARITY_LEDGER_FORMAT, 'the parity ledger format moved');
  assert.equal(document.label, KIR_PYTHON_LEG_DEFERRED, 'the parity ledger label moved');
  assert.ok(Array.isArray(document.rows), 'the parity ledger rows must be an array');
  return document;
}

export function deferredNodeKinds(ledger = loadParityLedger()) {
  const kinds = { expression: new Set(), statement: new Set() };
  for (const row of ledger.rows) kinds[row.surface].add(row.nodeKind);
  return kinds;
}

function walkExpression(expression, kinds) {
  if (expression === undefined) return;
  kinds.expression.add(expression.kind);
  for (const child of [expression.left, expression.right, expression.argument, expression.object]) {
    walkExpression(child, kinds);
  }
  for (const item of expression.items ?? []) walkExpression(item, kinds);
  for (const entry of expression.entries ?? []) walkExpression(entry.value, kinds);
  for (const argument of expression.arguments ?? []) walkExpression(argument, kinds);
}

function walkStatements(statements, kinds) {
  for (const statement of statements) {
    kinds.statement.add(statement.kind);
    for (const child of [statement.value, statement.input, statement.condition, statement.from, statement.to, statement.step]) {
      walkExpression(child, kinds);
    }
    for (const block of [statement.body, statement.thenBranch, statement.elseBranch]) {
      if (block !== undefined) walkStatements(block, kinds);
    }
  }
}

// Recomputed here rather than imported from the compiler: the oracle's expectation must not be the
// production answer restated, or a walk that missed a nesting level would agree with itself.
export function linkedProgramKinds(linkedProgram) {
  const kinds = { expression: new Set(), statement: new Set() };
  walkStatements(linkedProgram.program.statements, kinds);
  // `helpers` is absent, not empty, on a program that declares no helper function.
  for (const helper of linkedProgram.helpers ?? []) walkStatements(helper.handler.statements, kinds);
  return kinds;
}

export function pythonDeferral(linkedProgram, ledger = loadParityLedger()) {
  if (linkedProgram === undefined) return undefined;
  const deferred = deferredNodeKinds(ledger);
  const present = linkedProgramKinds(linkedProgram);
  for (const surface of ['expression', 'statement']) {
    const hit = [...present[surface]].filter((kind) => deferred[surface].has(kind)).sort();
    if (hit.length > 0) return hit[0];
  }
  return undefined;
}

export function assertPythonDeferralRefusal(python, kind, label) {
  assert.equal(python.outcome, 'failure', `${label}: ${kind} is deferred, so the Python leg must refuse`);
  assert.deepEqual(
    Object.keys(python).sort(),
    ['code', 'format', 'outcome'],
    `${label}: a deferral refusal must carry no Python artifact`,
  );
  assert.equal(python.format, PYTHON_COMPILER_FORMAT, `${label}: the compiler format moved`);
  assert.equal(python.code, KIR_PYTHON_LEG_DEFERRED, `${label}: the deferral must report ${KIR_PYTHON_LEG_DEFERRED}`);
}

// The ledger-aware form of "both targets share one linker". Unchanged wording and unchanged
// assertion while the ledger defers nothing for the program at hand.
export function assertPythonLegAdmission({ javascriptCode, label, linkedProgram, ledger, python, pythonCode }) {
  const kind = pythonDeferral(linkedProgram, ledger ?? loadParityLedger());
  if (kind === undefined) {
    assert.equal(pythonCode, javascriptCode, `both targets share one linker; ${label} diverged`);
    return javascriptCode;
  }
  assertPythonDeferralRefusal(python, kind, label);
  return javascriptCode;
}

// The ledger-aware form of "python compile failed": a fixture whose kinds the Python leg has
// deferred cannot carry a three-leg byte-identity row at all, and says so by name.
export function assertPythonLegCompiled({ label = 'the fixture', ledger, linkedProgram, python }) {
  const kind = pythonDeferral(linkedProgram, ledger ?? loadParityLedger());
  if (kind !== undefined) {
    assertPythonDeferralRefusal(python, kind, label);
    assert.fail(`PARITY_LEDGER_THREE_LEG: ${label} carries deferred ${kind}; it cannot claim three-leg parity`);
  }
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
}
