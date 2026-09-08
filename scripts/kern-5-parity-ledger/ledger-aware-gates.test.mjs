import assert from 'node:assert/strict';
import test from 'node:test';

import { EXPRESSION_POSITIONS, STATEMENT_POSITIONS, linked, source } from './ledger-support.mjs';
import {
  KIR_PYTHON_LEG_DEFERRED,
  PARITY_LEDGER_FORMAT,
  PYTHON_COMPILER_FORMAT,
  assertPythonLegAdmission,
  assertPythonLegCompiled,
  deferredNodeKinds,
  linkedProgramKinds,
  loadParityLedger,
  pythonDeferral,
} from './support.mjs';

const site = (path) => new URL(`../${path}`, import.meta.url);

// The four sites that call the shared gate directly, and the gate each one needs.
const DIRECT_SITES = Object.freeze([
  ['kern-5-rt2-boolean-if/k0-golden.test.mjs', 'assertPythonLegAdmission'],
  ['kern-5-rt3-binary-expression/k0-golden.test.mjs', 'assertPythonLegAdmission'],
  ['kern-5-rt2-boolean-if/k0-support.mjs', 'assertPythonLegCompiled'],
  ['kern-5-rt4-user-fn-call/k0-support.mjs', 'assertPythonLegAdmission'],
]);

// The four that reach it through rt4's `pythonLegAdmissionColumn` adapter, which owns the linking
// and the re-compile every admission golden would otherwise repeat.
const ADAPTER_SITES = Object.freeze([
  ['kern-5-rt9-linked-assign/k0-golden.test.mjs', 'assertAdmissionRowAgreement'],
  ['kern-5-rt10-pre-linked-arithmetic/k0-golden.test.mjs', 'assertAdmissionRowAgreement'],
  ['kern-5-rt10-cross-call-integer/k0-golden.test.mjs', 'assertAdmissionRowAgreement'],
  ['kern-5-rt5-async-user-fn-call/probe-matrix.test.mjs', 'pythonLegAdmissionColumn'],
]);

const ALL_SITES = Object.freeze([...DIRECT_SITES, ...ADAPTER_SITES].map(([path]) => path));

const REFUSAL = Object.freeze({
  code: KIR_PYTHON_LEG_DEFERRED,
  format: PYTHON_COMPILER_FORMAT,
  outcome: 'failure',
});

function syntheticLedger(surface, nodeKind) {
  return {
    format: PARITY_LEDGER_FORMAT,
    label: KIR_PYTHON_LEG_DEFERRED,
    rows: [
      {
        blockedBy: [],
        label: KIR_PYTHON_LEG_DEFERRED,
        nodeKind,
        since: 'kern-5-parity-ledger',
        spec: '.Codex/specs/kern-5-parity-ledger/spec.md',
        surface,
      },
    ],
  };
}

// kern-5-rt11-linked-while landed the ledger's first row (RT11W-TD5, Corrections Log): the checked-
// in ledger defers exactly `while`, and every `for`-shaped position these shared harnesses build
// stays inert, because none of them contains a `while`.
test('the checked-in ledger defers exactly the linked statement rows awaiting Python lowering', async () => {
  assert.deepEqual(loadParityLedger().rows, [
    {
      blockedBy: ['while'],
      label: KIR_PYTHON_LEG_DEFERRED,
      nodeKind: 'break',
      since: 'kern-5-rt12-linked-jumps',
      spec: '.Codex/specs/kern-5-rt12-linked-jumps/spec.md',
      surface: 'statement',
    },
    {
      blockedBy: ['while'],
      label: KIR_PYTHON_LEG_DEFERRED,
      nodeKind: 'continue',
      since: 'kern-5-rt12-linked-jumps',
      spec: '.Codex/specs/kern-5-rt12-linked-jumps/spec.md',
      surface: 'statement',
    },
    {
      blockedBy: [],
      label: KIR_PYTHON_LEG_DEFERRED,
      nodeKind: 'throw',
      since: 'kern-5-d',
      spec: '.Codex/specs/kern-5-d-linked-try/spec.md',
      surface: 'statement',
    },
    {
      blockedBy: ['throw'],
      label: KIR_PYTHON_LEG_DEFERRED,
      nodeKind: 'try',
      since: 'kern-5-d',
      spec: '.Codex/specs/kern-5-d-linked-try/spec.md',
      surface: 'statement',
    },
    {
      blockedBy: [],
      label: KIR_PYTHON_LEG_DEFERRED,
      nodeKind: 'while',
      since: 'kern-5-rt11-linked-while',
      spec: '.Codex/specs/kern-5-rt11-linked-while/spec.md',
      surface: 'statement',
    },
  ]);
  const kinds = deferredNodeKinds();
  assert.deepEqual([...kinds.statement], ['break', 'continue', 'throw', 'try', 'while']);
  assert.deepEqual([...kinds.expression], []);
  for (const [name, build] of Object.entries({ ...STATEMENT_POSITIONS, ...EXPRESSION_POSITIONS })) {
    assert.equal(pythonDeferral(await linked(build())), undefined, `${name} must not be deferred today`);
  }
});

// Discriminating on purpose: `helper-body` puts the loop inside a helper handler, and
// `member-source-record` buries the binary two levels under a record a member reads. A walk that
// visited only the entry's top-level statements would report neither.
test('the kind walk reaches helper bodies and nested expression operands', async () => {
  const helper = linkedProgramKinds(await linked(STATEMENT_POSITIONS['helper-body']()));
  assert.deepEqual([...helper.statement].sort(), ['assign', 'for', 'let', 'return']);
  assert.ok(helper.expression.has('user-call'));
  assert.ok(helper.expression.has('binary'));
  const nested = linkedProgramKinds(await linked(EXPRESSION_POSITIONS['member-source-record']()));
  for (const kind of ['binary', 'literal', 'member', 'record']) {
    assert.ok(nested.expression.has(kind), `the nested walk must reach ${kind}`);
  }
});

test('a synthetic statement row fires the predicate in every statement position', async () => {
  const ledger = syntheticLedger('statement', 'for');
  for (const [name, build] of Object.entries(STATEMENT_POSITIONS)) {
    assert.equal(pythonDeferral(await linked(build()), ledger), 'for', `${name} must be recognised as deferred`);
  }
  assert.equal(pythonDeferral(await linked(EXPRESSION_POSITIONS['let-value']()), ledger), undefined);
});

test('a synthetic expression row fires the predicate in every expression position', async () => {
  const ledger = syntheticLedger('expression', 'binary');
  for (const [name, build] of Object.entries(EXPRESSION_POSITIONS)) {
    assert.equal(pythonDeferral(await linked(build()), ledger), 'binary', `${name} must be recognised as deferred`);
  }
});

test('a link-refused program can never be deferred, so the agreement assertions stay exact', () => {
  assert.equal(pythonDeferral(undefined, syntheticLedger('statement', 'for')), undefined);
});

test('the admission gate keeps the equality wording while nothing is deferred', async () => {
  const linkedProgram = await linked(STATEMENT_POSITIONS['handler-top-level']());
  assert.equal(
    assertPythonLegAdmission({ javascriptCode: 'admitted', label: 'probe', linkedProgram, pythonCode: 'admitted' }),
    'admitted',
  );
  assert.throws(
    () => assertPythonLegAdmission({ javascriptCode: 'admitted', label: 'probe', linkedProgram, pythonCode: 'other' }),
    /both targets share one linker; probe diverged/u,
  );
});

test('the admission gate demands the slice-A refusal once a row defers the program', async () => {
  const linkedProgram = await linked(STATEMENT_POSITIONS['handler-top-level']());
  const ledger = syntheticLedger('statement', 'for');
  const call = (python) =>
    assertPythonLegAdmission({ javascriptCode: 'admitted', label: 'probe', ledger, linkedProgram, python, pythonCode: 'admitted' });
  assert.equal(call(REFUSAL), 'admitted');
  assert.throws(() => call({ ...REFUSAL, code: 'handler-entry-unsupported' }), /must report KIR_PYTHON_LEG_DEFERRED/u);
  assert.throws(() => call({ ...REFUSAL, artifact: { path: 'entry.py' } }), /must carry no Python artifact/u);
  assert.throws(() => call({ format: PYTHON_COMPILER_FORMAT, outcome: 'success' }), /the Python leg must refuse/u);
});

test('a deferred fixture cannot claim three-leg parity', async () => {
  const linkedProgram = await linked(STATEMENT_POSITIONS['handler-top-level']());
  assertPythonLegCompiled({ linkedProgram, python: { outcome: 'success' } });
  assert.throws(
    () =>
      assertPythonLegCompiled({
        label: 'rt-x fixture',
        ledger: syntheticLedger('statement', 'for'),
        linkedProgram,
        python: REFUSAL,
      }),
    /PARITY_LEDGER_THREE_LEG: rt-x fixture carries deferred for/u,
  );
});

test('the four direct cross-leg sites import and call the shared gate', () => {
  for (const [path, gate] of DIRECT_SITES) {
    const text = source(site(path));
    assert.ok(
      text.includes("from '../kern-5-parity-ledger/support.mjs'"),
      `PARITY_LEDGER_UNWIRED_GATE: ${path} must import the shared gate`,
    );
    assert.ok(text.includes(`${gate}({`), `PARITY_LEDGER_UNWIRED_GATE: ${path} must call ${gate}`);
  }
});

test('the four admission goldens reach the gate through the one rt4 adapter', () => {
  const adapter = source(site('kern-5-rt4-user-fn-call/k0-support.mjs'));
  assert.ok(adapter.includes('export function pythonLegAdmissionColumn(row, label)'));
  assert.ok(adapter.includes('export function assertAdmissionRowAgreement(row, label)'));
  for (const [path, gate] of ADAPTER_SITES) {
    const text = source(site(path));
    assert.ok(text.includes(`${gate}(row, name)`), `PARITY_LEDGER_UNWIRED_GATE: ${path} must call ${gate}`);
  }
});

test('no cross-leg agreement site keeps a bare Python equality of its own', () => {
  for (const path of ALL_SITES) {
    const text = source(site(path));
    for (const [pattern, why] of [
      ['both targets share one linker', 'the equality wording belongs to the shared gate now'],
      ['row.javascript, row.python', 'a bare per-row leg equality bypasses the ledger'],
      ['javascriptCode, pythonCode', 'a bare per-code leg equality bypasses the ledger'],
      ["assert.equal(python.outcome, 'success'", 'a bare Python compile-success assertion bypasses the ledger'],
    ]) {
      assert.equal(text.includes(pattern), false, `PARITY_LEDGER_BARE_EQUALITY: ${path}: ${why}`);
    }
  }
});

// rt5 keeps `row.python === row.rt1`, and that is now a consistency check over recorded golden
// rows rather than a live leg comparison: its `python` column is produced by the gate and records
// the linker's decision, so the two columns must agree whether or not a row is deferred.
test('the rt5 probe matrix python column is the gate output, so its golden equality stays exact', () => {
  const text = source(site('kern-5-rt5-async-user-fn-call/probe-matrix.test.mjs'));
  assert.ok(text.includes('python: pythonLegAdmissionColumn(row, name)'));
  assert.ok(text.includes('for (const [name, row] of Object.entries(golden.positions))'));
});

// The rt1-versus-JavaScript half of every agreement stays bare, and must: both are lowered from the
// one target-neutral linker, so a ledger row can never separate them.
test('the RT-1 and JavaScript half of the agreement is left exact', () => {
  assert.ok(
    source(site('kern-5-rt4-user-fn-call/k0-support.mjs')).includes(
      'RT-1 and the emitters share one linker; ${label} diverged',
    ),
  );
});
