/**
 * Slice-0.75 ToNumericPrimitive substrate — Python leg of the differential
 * battery (tribunal amendment 4).
 *
 * Builds a self-contained Python module = the emitted `KERN_TO_NUMBER_HELPER_PY`
 * block + assertion calls for every fixture row, then executes it under
 * `python3`. The assertions live INSIDE the Python program (so the helper block
 * is actually exercised, never dead text): each row checks the numeric value,
 * `type(result) is float` (amendment 1), and the `-0.0` sign bit via
 * `math.copysign(1.0, r)` (amendment 2). A failing assertion makes the
 * subprocess exit non-zero with the failing probe name on stderr.
 *
 * The fixtures are the SAME `TO_NUMBER_FIXTURES` / `TO_*32_FIXTURES` arrays the
 * TS leg consumes (`@kernlang/core`), so the two targets are byte-aligned to one
 * oracle. If `python3` is not on PATH the suite is skipped, matching
 * `ir-semantics-python-leg.test.ts`.
 */

import { spawnSync } from 'node:child_process';
import {
  type IntFixture,
  TO_INT32_FIXTURES,
  TO_INTEGER_OR_INFINITY_FIXTURES,
  TO_NUMBER_FIXTURES,
  TO_UINT32_FIXTURES,
  type ToNumberFixture,
  UNDEFINED_INPUT,
} from '@kernlang/core';
import { KERN_TO_NUMBER_HELPER_PY } from '../src/core/expr/index.js';

const pythonAvailable = (() => {
  try {
    return spawnSync('python3', ['--version'], { encoding: 'utf-8' }).status === 0;
  } catch {
    return false;
  }
})();
const describeIfPython = pythonAvailable ? describe : describe.skip;

/** Python source expression for a fixture's input value. */
function pyInput(value: unknown, pyExpr: string): string {
  return value === UNDEFINED_INPUT ? '_KERN_UNDEFINED' : pyExpr;
}

/**
 * Emit the assertion lines for one ToNumber row. Returns Python statements that
 * raise `AssertionError` (with the probe label) on any divergence.
 */
function toNumberAssertions(fixture: ToNumberFixture): string[] {
  const label = JSON.stringify(fixture.probe);
  const arg = pyInput(fixture.value, fixture.pyExpr);

  if (fixture.failClosed) {
    // Fail-closed inputs MUST raise _KernNumericCoercionError, never coerce.
    return [
      'try:',
      `    _kern_to_number(${arg})`,
      `    raise AssertionError(${label} + ' should fail-closed but coerced')`,
      'except _KernNumericCoercionError:',
      '    pass',
    ];
  }

  const lines = [`__r = _kern_to_number(${arg})`];
  // Amendment 1: every numeric output is a float.
  lines.push(`assert type(__r) is float, ${label} + ' not float: ' + repr(type(__r))`);

  switch (fixture.expected.kind) {
    case 'nan':
      lines.push(`assert __r != __r, ${label} + ' expected NaN, got ' + repr(__r)`);
      break;
    case 'posinf':
      lines.push(`assert __r == float('inf'), ${label} + ' expected +inf, got ' + repr(__r)`);
      break;
    case 'neginf':
      lines.push(`assert __r == float('-inf'), ${label} + ' expected -inf, got ' + repr(__r)`);
      break;
    case 'negzero':
      lines.push(`assert __r == 0.0, ${label} + ' expected 0, got ' + repr(__r)`);
      // Amendment 2: -0.0 sign bit must survive.
      lines.push(`assert math.copysign(1.0, __r) < 0, ${label} + ' expected NEGATIVE zero sign'`);
      break;
    case 'poszero':
      lines.push(`assert __r == 0.0, ${label} + ' expected 0, got ' + repr(__r)`);
      lines.push(`assert math.copysign(1.0, __r) > 0, ${label} + ' expected POSITIVE zero sign'`);
      break;
    case 'value':
      lines.push(`assert __r == ${pyFloat(fixture.expected.n)}, ${label} + ' got ' + repr(__r)`);
      break;
  }
  return lines;
}

function pyFloat(n: number): string {
  if (Number.isNaN(n)) return "float('nan')";
  if (n === Number.POSITIVE_INFINITY) return "float('inf')";
  if (n === Number.NEGATIVE_INFINITY) return "float('-inf')";
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

function intAssertions(fn: string, fixture: IntFixture, expectFloat: boolean): string[] {
  const label = JSON.stringify(fixture.probe);
  const arg = pyInput(fixture.value, fixture.pyExpr);
  const lines = [`__r = ${fn}(${arg})`];
  if (expectFloat) {
    // toIntegerOrInfinity returns float (int-valued or ±inf).
    lines.push(`assert type(__r) is float, ${label} + ' not float: ' + repr(type(__r))`);
    lines.push(`assert __r == ${pyFloat(fixture.expected)}, ${label} + ' got ' + repr(__r)`);
  } else {
    // toInt32 / toUint32 return int.
    lines.push(`assert type(__r) is int, ${label} + ' not int: ' + repr(type(__r))`);
    lines.push(`assert __r == ${fixture.expected}, ${label} + ' got ' + repr(__r)`);
  }
  return lines;
}

function buildProgram(): string {
  const body: string[] = [];
  for (const f of TO_NUMBER_FIXTURES) body.push(...toNumberAssertions(f), '');
  for (const f of TO_INT32_FIXTURES) body.push(...intAssertions('_kern_to_int32', f, false), '');
  for (const f of TO_UINT32_FIXTURES) body.push(...intAssertions('_kern_to_uint32', f, false), '');
  for (const f of TO_INTEGER_OR_INFINITY_FIXTURES)
    body.push(...intAssertions('_kern_to_integer_or_infinity', f, true), '');
  body.push("print('ALL_OK')");
  return `${KERN_TO_NUMBER_HELPER_PY}\n\n${body.join('\n')}\n`;
}

describeIfPython('ToNumericPrimitive substrate — Python leg (emitted helper executed)', () => {
  it('every fixture row passes against the emitted _kern_to_number helper block', () => {
    const program = buildProgram();
    const result = spawnSync('python3', ['-c', program], { encoding: 'utf-8' });
    if (result.status !== 0) {
      throw new Error(
        `python3 leg failed (exit ${result.status}):\n` + `stderr=\n${result.stderr}\n` + `stdout=\n${result.stdout}`,
      );
    }
    expect(result.stdout.trim().endsWith('ALL_OK')).toBe(true);
  }, 30_000);

  it('exercises the full fixture battery (count guard)', () => {
    expect(TO_NUMBER_FIXTURES.length).toBe(48);
    const total =
      TO_NUMBER_FIXTURES.length +
      TO_INT32_FIXTURES.length +
      TO_UINT32_FIXTURES.length +
      TO_INTEGER_OR_INFINITY_FIXTURES.length;
    expect(total).toBe(68);
  });

  it('-0.0 sign probe actually discriminates (negzero row != poszero row in Python)', () => {
    // Guard against a tautological sign assertion: prove the emitted helper
    // produces opposite sign bits for "-0" vs "0".
    const program = `${KERN_TO_NUMBER_HELPER_PY}
import math
neg = _kern_to_number('-0')
pos = _kern_to_number('0')
assert math.copysign(1.0, neg) < 0, 'neg sign wrong'
assert math.copysign(1.0, pos) > 0, 'pos sign wrong'
assert type(neg) is float and type(pos) is float
print('SIGN_OK')
`;
    const result = spawnSync('python3', ['-c', program], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('SIGN_OK');
  }, 30_000);
});

if (!pythonAvailable) {
  describe('ToNumericPrimitive substrate — Python leg', () => {
    it.skip('skipped: python3 not on PATH', () => {
      // Marker only — see describeIfPython.
    });
  });
}
