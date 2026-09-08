import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  FENCE_DIAGNOSTICS,
  TRY_FENCES,
  TRY_METER_POSITIONS,
  TRY_POSITIONS,
  TRY_TWINS,
  f5Row,
} from './k0-support.mjs';

const MATRIX_URL = new URL('./probe-matrix.json', import.meta.url);

// `f5Row` drives the whole F5 pipeline, and this file asks about the same ninety-odd sources from
// several rows. The projection is pure in its source text, so one cache keeps the evidence leaf
// affordable without weakening a single assertion.
const PROJECTIONS = new Map();

function row(source) {
  if (!PROJECTIONS.has(source)) PROJECTIONS.set(source, f5Row(source));
  return PROJECTIONS.get(source);
}

function recompute() {
  const walk = (table) =>
    Object.fromEntries(
      Object.entries(table)
        .map(([name, build]) => {
          const measured = row(build());
          return [name, { diagnostics: measured.diagnostics, status: measured.status }];
        })
        .sort(([left], [right]) => (left < right ? -1 : 1)),
    );
  return {
    fences: walk(TRY_FENCES),
    meters: walk(TRY_METER_POSITIONS),
    positions: walk(TRY_POSITIONS),
    twins: walk(TRY_TWINS),
  };
}

// GREEN at base and must stay GREEN. The matrix is the fence that keeps every linker row reachable:
// a fixture F5 starts rejecting would turn its linker assertion into a tautology, which is exactly
// the vacuity failure mode D.0 exists to prevent.
test('the committed F5 probe matrix is the measured one, so a shrunken probe is noticed', () => {
  const committed = JSON.parse(readFileSync(MATRIX_URL, 'utf8'));
  assert.deepEqual(
    recompute(),
    committed.matrix,
    'D_PROBE_DRIFT: the recomputed F5 matrix and the committed one disagree',
  );
});

test('the probe matrix is canonically serialized, so a hand edit is visible in the diff', () => {
  const raw = readFileSync(MATRIX_URL, 'utf8');
  const committed = JSON.parse(raw);
  assert.equal(`${JSON.stringify(committed, null, 2)}\n`, raw, 'D_PROBE_SHAPE: the matrix must stay canonical');
  assert.equal(committed.format, 'kern.oracle.d-linked-try.probe-matrix.v1');
});

test('every positive, twin and metering fixture projects with zero diagnostics', () => {
  for (const [label, table] of [
    ['position', TRY_POSITIONS],
    ['twin', TRY_TWINS],
    ['meter', TRY_METER_POSITIONS],
  ]) {
    for (const [name, build] of Object.entries(table)) {
      const measured = row(build());
      assert.equal(measured.status, 'projected', `D_FRONTEND_FENCE: ${label} ${name} must reach the linker`);
      assert.deepEqual(
        measured.diagnostics,
        [],
        `D_FRONTEND_FENCE: ${label} ${name} must project without a diagnostic`,
      );
    }
  }
});

// OQ-D1's finding, asserted rather than remembered: a bare `print` alone in a nested block is
// projection-rejected, identically for `while` and for `try`. Every fixture in this suite uses the
// assign- or if-wrapped idiom because of it, and this row is what keeps that true.
test('a bare print alone in a try body is projection-rejected, and the wrapped idiom is not', () => {
  const bare = row(
    [
      'fn name=route export=true returns=integer',
      '  handler lang=kern',
      '    let name=acc value="0"',
      '    try',
      '      print value="x"',
      '    catch name=e',
      '      assign target="acc" value="2"',
      '    return value="acc"',
      '',
    ].join('\n'),
  );
  assert.equal(
    bare.status,
    'rejected',
    'D_PRINT_HAZARD: a bare print alone in a nested block must stay projection-rejected, or the idiom note is stale',
  );
  assert.equal(row(TRY_POSITIONS['try-catch']()).status, 'projected');
});

// The refusals the spec attributes to the linker and the measurement attributes to F5. Each is
// asserted at the frontend so the linker's own gates are never credited with a refusal it cannot
// reach -- and so a later F5 relaxation moves this row instead of silently arming a dead gate.
test('F5 owns the try-family refusals the linker cannot reach', () => {
  for (const [name, build] of Object.entries(TRY_FENCES)) {
    const measured = row(build());
    assert.equal(measured.status, 'rejected', `D_FRONTEND_FENCE: ${name} must be refused by F5, not by the linker`);
    assert.deepEqual(
      measured.diagnostics,
      [...FENCE_DIAGNOSTICS[name]],
      `D_FRONTEND_FENCE: ${name} must carry the measured diagnostic set`,
    );
  }
});

// The one that matters most for the finally commit: F5's `for` and `while` allowedChildren exclude
// `finally`, so a finally-bearing `try` cannot sit directly in a loop body. The refusal
// KIR_LOOP_JUMP_CROSSES_TRY is therefore reachable ONLY through an if-wrapped try, and any row that
// spells the spec's own shape would be RED at projection rather than at link.
test('a finally clause in a loop body is refused by F5, so only the if-wrapped shape reaches the linker', () => {
  for (const name of ['fence-finally-in-for-body', 'fence-finally-in-while-body']) {
    assert.equal(
      row(TRY_FENCES[name]()).status,
      'rejected',
      `D_FINALLY_REACH: ${name} must stay projection-rejected, or the cross-try refusal changes shape`,
    );
  }
  for (const name of ['neg-break-crosses-finally', 'neg-continue-crosses-finally']) {
    const measured = row(TRY_POSITIONS[name]());
    assert.equal(
      measured.status,
      'projected',
      `D_FINALLY_REACH: ${name} must project, or KIR_LOOP_JUMP_CROSSES_TRY has no reachable fixture at all`,
    );
    assert.deepEqual(measured.diagnostics, []);
  }
});

// D-7e's asymmetry, measured: `finally` admits `while`, `each`, `try`, `throw`, `break` and
// `continue` but not `for`, `destructure` or `handler`. So a `for` inside a `finally` is an F5
// refusal and a `while` inside one must reach the linker and be admitted.
test('a for inside a finally is refused by F5 while a while inside one reaches the linker', () => {
  assert.equal(row(TRY_FENCES['fence-for-inside-finally']()).status, 'rejected');
  const measured = row(TRY_POSITIONS['try-finally-while']());
  assert.equal(measured.status, 'projected', 'D_FINALLY_ASYMMETRY: a while inside a finally must reach the linker');
  assert.deepEqual(measured.diagnostics, []);
});
