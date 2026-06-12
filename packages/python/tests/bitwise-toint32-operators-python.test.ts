/**
 * Slice 6 — bitwise / shift operators on the ToInt32 substrate (Python leg).
 *
 * Two layers of proof:
 *   1. EMITTED-STRING assertions — the native-handler lowering uses the LANDED
 *      slice-0.75 helpers (`_kern_to_int32` / `_kern_to_uint32`) per the S6
 *      emission contract, never ad-hoc coercion or raw Python `>>` for `>>>`.
 *   2. EXECUTION — the emitted body is run under python3 against the value
 *      tables (Int32 / Uint32 / composition) and the evaluation-once `mark()`
 *      probes, proving the Python target reproduces the JS oracle AND evaluates
 *      each operand exactly once, left-to-right.
 *
 * Every expected value was computed from native JS (`node -e`); the TS/core leg
 * (packages/core) is the reference this leg must match.
 */

import { spawnSync } from 'node:child_process';
import { emitNativeKernBodyPythonWithImports } from '../src/codegen-body-python.js';

const pythonAvailable = (() => {
  try {
    return spawnSync('python3', ['--version'], { encoding: 'utf-8' }).status === 0;
  } catch {
    return false;
  }
})();
const describeIfPython = pythonAvailable ? describe : describe.skip;

type IRNode = Parameters<typeof emitNativeKernBodyPythonWithImports>[0];

/** Build a native handler that binds `r = <expr>`. */
function letHandler(value: string): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: [{ type: 'let', props: { name: 'r', value } }],
  } as IRNode;
}

function emit(expr: string): { code: string; helpers: string; imports: string[] } {
  const r = emitNativeKernBodyPythonWithImports(letHandler(expr));
  return { code: r.code, helpers: [...r.helpers].join('\n\n'), imports: [...r.imports] };
}

describe('S6 Python emission — uses the slice-0.75 helpers (string assertions)', () => {
  test('binary Int32 ops wrap both operands and the result in _kern_to_int32', () => {
    expect(emit('a | b').code).toContain('_kern_to_int32(_kern_to_int32(a) | _kern_to_int32(b))');
    expect(emit('a & b').code).toContain('_kern_to_int32(_kern_to_int32(a) & _kern_to_int32(b))');
    expect(emit('a ^ b').code).toContain('_kern_to_int32(_kern_to_int32(a) ^ _kern_to_int32(b))');
  });

  test('<< and >> mask the count with _kern_to_uint32(b) & 31, result through _kern_to_int32', () => {
    expect(emit('a << b').code).toContain('_kern_to_int32(_kern_to_int32(a) << (_kern_to_uint32(b) & 31))');
    expect(emit('a >> b').code).toContain('_kern_to_int32(_kern_to_int32(a) >> (_kern_to_uint32(b) & 31))');
  });

  test('>>> uses _kern_to_uint32 on BOTH sides and masks the count — NEVER raw signed >>', () => {
    const code = emit('a >>> b').code;
    expect(code).toContain('_kern_to_uint32(_kern_to_uint32(a) >> (_kern_to_uint32(b) & 31))');
    // The >>> lowering must not sign-extend: it must not wrap the whole thing
    // in _kern_to_int32 (that would convert the Uint32 result back to signed).
    expect(code).not.toContain('_kern_to_int32(_kern_to_uint32(a) >>');
  });

  test('unary ~ wraps operand and result in _kern_to_int32', () => {
    expect(emit('~a').code).toContain('_kern_to_int32(~_kern_to_int32(a))');
  });

  test('emission registers the slice-0.75 helper block (_kern_to_int32 defined)', () => {
    const { helpers } = emit('a | b');
    expect(helpers).toContain('def _kern_to_int32(x):');
    expect(helpers).toContain('def _kern_to_uint32(x):');
    expect(helpers).toContain('def _kern_to_number(x):');
    // Must NOT fall back to the legacy `_i32` path for parsed native bodies.
    expect(emit('a | b').code).not.toContain('_i32(');
  });
});

/** Run a Python program (helpers + body) and return its stdout, asserting exit 0. */
function runPy(program: string): string {
  const result = spawnSync('python3', ['-c', program], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`python3 failed (exit ${result.status}):\nstderr=\n${result.stderr}\nstdout=\n${result.stdout}`);
  }
  return result.stdout;
}

/**
 * Emit `r = <expr>` against bound globals, execute under python3, and return
 * the printed repr of `r`. Bindings are emitted as plain Python assignments
 * BEFORE the lowered body so identifiers (`a`, `b`, `x`) resolve.
 */
function evalPy(expr: string, bindings: Record<string, string> = {}): string {
  const { code, helpers } = emit(expr);
  const setup = Object.entries(bindings)
    .map(([k, v]) => `${k} = ${v}`)
    .join('\n');
  const program = [helpers, setup, code, 'print(repr(r))'].filter(Boolean).join('\n');
  return runPy(program).trim();
}

describeIfPython('S6 Python execution — value tables match the JS oracle', () => {
  // [expr, expected python repr]. Uint32 results above 2^31-1 are large ints.
  const rows: [string, string][] = [
    // Shift-count mask
    ['1 << 33', '2'],
    ['1 << 32', '1'],
    ['-8 >> 33', '-4'],
    ['-8 >> 32', '-8'],
    ['8 >>> 33', '4'],
    ['8 >>> 32', '8'],
    // Zero-fill / Uint32 result
    ['-1 >>> 0', '4294967295'],
    ['-1 >>> 1', '2147483647'],
    ['-2147483648 >>> 1', '1073741824'],
    ['0x80000000 >>> 0', '2147483648'],
    ['0xffffffff >>> 4', '268435455'],
    // Bitwise Int32, truncate-toward-zero
    ['5.9 | 0', '5'],
    ['-5.9 | 0', '-5'],
    ['5.5 & 3', '1'],
    ['5 ^ 3', '6'],
    ['~0', '-1'],
    ['~-1', '0'],
    // Composition idioms
    ['(-1 >>> 0) | 0', '-1'],
    ['(-1 >>> 1) | 0', '2147483647'],
    ['(0x80000000 >>> 0) | 0', '-2147483648'],
    ['2147483648 | 0', '-2147483648'],
    ['~~5.9', '5'],
    ['~~-5.9', '-5'],
    ['~~4294967296', '0'],
  ];
  for (const [expr, expected] of rows) {
    test(`${expr} => ${expected}`, () => {
      expect(evalPy(expr)).toBe(expected);
    });
  }

  test('~~NaN => 0 and ~~Infinity => 0 (routed through ToInt32)', () => {
    expect(evalPy('~~x', { x: "float('nan')" })).toBe('0');
    expect(evalPy('~~x', { x: "float('inf')" })).toBe('0');
  });

  test('-0.0 | 0 => 0 (negative zero killed; Python int has no -0)', () => {
    expect(evalPy('x | 0', { x: '-0.0' })).toBe('0');
  });
});

describeIfPython('S6 Python execution — evaluation-once / order probes', () => {
  // A side-effecting marker shared with the JS leg: pushes the name to a log
  // and returns the value. Each probe asserts BOTH the numeric result and the
  // exact log order, proving each operand is evaluated exactly once L-to-R.
  const MARK = ['_log = []', 'def mark(name, value):', '    _log.append(name)', '    return value'].join('\n');

  function probe(expr: string, expectedValue: string, expectedLog: string[]): void {
    const { code, helpers } = emit(expr);
    const program = [
      helpers,
      MARK,
      code,
      `assert r == ${expectedValue}, 'value: ' + repr(r)`,
      `assert _log == ${JSON.stringify(expectedLog).replace(/"/g, "'")}, 'log: ' + repr(_log)`,
      "print('OK')",
    ].join('\n');
    expect(runPy(program).trim()).toBe('OK');
  }

  test('mark("a", 8) << mark("b", 33) => 16, log ["a","b"]', () => {
    probe('mark("a", 8) << mark("b", 33)', '16', ['a', 'b']);
  });

  test('mark("a", -1) >>> mark("b", 1) => 2147483647, log ["a","b"]', () => {
    probe('mark("a", -1) >>> mark("b", 1)', '2147483647', ['a', 'b']);
  });

  test('mark("a", 5.9) | mark("b", 0) => 5, log ["a","b"]', () => {
    probe('mark("a", 5.9) | mark("b", 0)', '5', ['a', 'b']);
  });

  test('~mark("x", -1) => 0, log ["x"]', () => {
    probe('~mark("x", -1)', '0', ['x']);
  });

  test('(mark("a", -1) >>> mark("b", 0)) | mark("c", 0) => -1, log ["a","b","c"]', () => {
    probe('(mark("a", -1) >>> mark("b", 0)) | mark("c", 0)', '-1', ['a', 'b', 'c']);
  });
});

if (!pythonAvailable) {
  describe('S6 bitwise operators — Python leg', () => {
    it.skip('skipped: python3 not on PATH', () => {
      // Marker only — see describeIfPython.
    });
  });
}
