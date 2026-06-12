/**
 * Slice S5 — logical `&&` / `||` RESULT-VALUE semantics (Python leg).
 *
 * `&&`/`||` are operand-selectors, not boolean operators: `a && b` returns `a`
 * when `ToBoolean(a)` is false else `b`; `a || b` returns `a` when truthy else
 * `b`. They short-circuit the unselected operand. Python's `and`/`or` use
 * Python truthiness (`bool`/`len`), which DIVERGES from KERN ToBoolean on `[]`,
 * `{}`, `NaN`, `"0"`, `"false"`, `" "` — so they lower to a single-eval walrus
 * ternary gated on `_kern_truthy` (the S4 ToBoolean helper):
 *
 *   L && R  ->  (__k_logN if not _kern_truthy(__k_logN := L) else R)
 *   L || R  ->  (__k_logN if     _kern_truthy(__k_logN := L) else R)
 *
 * Two layers of proof:
 *   1. EMITTED-STRING assertions — the lowering is the walrus `_kern_truthy`
 *      form (never `and`/`or`), the helper is registered, and nested/composed
 *      forms parenthesize correctly.
 *   2. EXECUTION under python3 — the emitted body is run against the full
 *      contract table (incl. the `[]`/`{}`/`NaN`/`"0"` Python-divergence
 *      killers and the undefined sentinel), the chained/precedence rows, and
 *      the side-effecting `mark()` probes that assert BOTH `repr(result)` AND
 *      the exact call log — catching eager, boolean-cast, double-left, and
 *      wrong-precedence lowerings that a value-only test would miss.
 *
 * Expected values are the native-JS oracle (KERN/JS `&&`/`||` semantics).
 */

import { spawnSync } from 'node:child_process';
import { parseExpression } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports, emitPyExpression } from '../src/codegen-body-python.js';

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

// ───────────────────────────── string assertions ─────────────────────────────

describe('S5 Python emission — walrus `_kern_truthy` ternary, never `and`/`or`', () => {
  test('&& lowers to the conservative walrus ternary (single-eval, result-value)', () => {
    expect(emitPyExpression(parseExpression('a && b'))).toBe('(__k_log1 if not _kern_truthy(__k_log1 := a) else b)');
  });

  test('|| lowers to the conservative walrus ternary (single-eval, result-value)', () => {
    expect(emitPyExpression(parseExpression('a || b'))).toBe('(__k_log1 if _kern_truthy(__k_log1 := a) else b)');
  });

  test('NEVER emits bare Python `and`/`or` (those use the wrong truthiness)', () => {
    expect(emitPyExpression(parseExpression('a && b'))).not.toMatch(/\band\b/);
    expect(emitPyExpression(parseExpression('a || b'))).not.toMatch(/\bor\b/);
  });

  test('every left operand is bound with a walrus — no ident/pure-left fast path', () => {
    // Even a bare identifier left operand uses the walrus (single-eval law).
    expect(emitPyExpression(parseExpression('a && b'))).toContain('__k_log1 := a');
    // A call left operand is bound once, never double-read.
    expect(emitPyExpression(parseExpression('f() && b'))).toBe(
      '(__k_log1 if not _kern_truthy(__k_log1 := f()) else b)',
    );
  });

  test('nested logical expressions get distinct walrus temps (no collision)', () => {
    expect(emitPyExpression(parseExpression('a && b && c'))).toBe(
      '(__k_log2 if not _kern_truthy(__k_log2 := (__k_log1 if not _kern_truthy(__k_log1 := a) else b)) else c)',
    );
    expect(emitPyExpression(parseExpression('a || b || c'))).toBe(
      '(__k_log2 if _kern_truthy(__k_log2 := (__k_log1 if _kern_truthy(__k_log1 := a) else b)) else c)',
    );
  });

  test('`&&` binds tighter than `||` (precedence preserved, not left-grouped)', () => {
    // `'' || '0' && 'right'` must parse as `'' || ('0' && 'right')`.
    expect(emitPyExpression(parseExpression("'' || '0' && 'right'"))).toBe(
      '(__k_log2 if _kern_truthy(__k_log2 := "") else (__k_log1 if not _kern_truthy(__k_log1 := "0") else "right"))',
    );
  });

  test('the lowered expression is self-parenthesized for index/member composition', () => {
    expect(emitPyExpression(parseExpression('(a || b)[0]'))).toBe(
      '((__k_log1 if _kern_truthy(__k_log1 := a) else b))[0]',
    );
    expect(emitPyExpression(parseExpression('(a || b).x'))).toBe('(__k_log1 if _kern_truthy(__k_log1 := a) else b).x');
  });

  test('`??` is NOT rewritten by this slice (keeps its nullish lowering)', () => {
    const out = emitPyExpression(parseExpression('a ?? b'));
    expect(out).toContain('is not None');
    expect(out).not.toContain('_kern_truthy');
    expect(out).not.toContain('__k_log');
  });

  test('emission registers the KERN_JS_HELPER_PY block (_kern_truthy defined)', () => {
    expect(emit('a && b').helpers).toContain('def _kern_truthy(x):');
    expect(emit('a || b').helpers).toContain('def _kern_truthy(x):');
  });
});

// ─────────────────────────────── execution harness ───────────────────────────

/** Run a Python program (helpers + body) and return its stdout, asserting exit 0. */
function runPy(program: string): string {
  const result = spawnSync('python3', ['-c', program], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`python3 failed (exit ${result.status}):\nstderr=\n${result.stderr}\nstdout=\n${result.stdout}`);
  }
  return result.stdout;
}

/**
 * Emit `r = <expr>`, execute under python3, and return the printed repr of `r`.
 * `setup` is raw Python prepended before the body (e.g. to define `undefined`
 * as the sentinel or `mark`). Emitted imports are threaded so a helper that
 * declares `requires.py` cannot pass vacuously.
 */
function evalPy(expr: string, setup = ''): string {
  const { code, helpers, imports } = emit(expr);
  const importLines = imports.map((mod) => `import ${mod} as __k_${mod}`).join('\n');
  // KERN's `NaN` literal emits as a bare `NaN` identifier (Python has no NaN
  // literal), so bind it. `null`/`false` map to Python builtins `None`/`False`,
  // and the helper bootstraps `_KERN_UNDEFINED` for the undefined sentinel.
  const numericLiterals = "NaN = float('nan')\nInfinity = float('inf')";
  const program = [importLines, helpers, numericLiterals, setup, code, 'print(repr(r))'].filter(Boolean).join('\n');
  return runPy(program).trim();
}

// The KERN undefined sentinel, defined the same way the helper bootstraps it so
// `undefined && x` / `undefined ?? x` rows have a real sentinel to test.
const UNDEFINED_SETUP = [
  'try:',
  '    _KERN_UNDEFINED',
  'except NameError:',
  '    class _KernUndefined:',
  '        def __bool__(self): return False',
  "        def __repr__(self): return 'undefined'",
  '    _KERN_UNDEFINED = _KernUndefined()',
  'undefined = _KERN_UNDEFINED',
].join('\n');

describeIfPython('S5 Python execution — contract table (value rows)', () => {
  // `&&`: returns the original left operand when KERN-falsy, else the right.
  const andRows: [string, string][] = [
    ['0 && "right"', '0'],
    ['"" && "right"', "''"],
    ['false && "right"', 'False'],
    ['null && "right"', 'None'],
    ['NaN && "right"', 'nan'],
    ['"0" && "right"', "'right'"],
    ['"false" && "right"', "'right'"],
    ['" " && "right"', "'right'"],
    ['[] && "right"', "'right'"],
    ['({}) && "right"', "'right'"],
    ['1 && 2', '2'],
  ];
  // `||`: returns the original left operand when KERN-truthy, else the right.
  const orRows: [string, string][] = [
    ['0 || "fallback"', "'fallback'"],
    ['"" || "fallback"', "'fallback'"],
    ['false || "fallback"', "'fallback'"],
    ['null || "fallback"', "'fallback'"],
    ['NaN || "fallback"', "'fallback'"],
    ['"0" || "fallback"', "'0'"],
    ['"false" || "fallback"', "'false'"],
    ['" " || "fallback"', "' '"],
    ['[] || "fallback"', '[]'],
    ['[] || "x"', '[]'],
    ['({}) || "fallback"', '{}'],
    ['({}) || "x"', '{}'],
    ['1 || 2', '1'],
  ];
  for (const [expr, expected] of [...andRows, ...orRows]) {
    test(`${expr} => ${expected}`, () => {
      expect(evalPy(expr)).toBe(expected);
    });
  }

  // `undefined` requires the shared sentinel — it must NOT collapse to None and
  // must select like a falsy value.
  test('undefined && "right" => undefined (sentinel preserved, not None)', () => {
    expect(evalPy('undefined && "right"', UNDEFINED_SETUP)).toBe('undefined');
  });
  test('undefined || "fallback" => "fallback" (sentinel is falsy)', () => {
    expect(evalPy('undefined || "fallback"', UNDEFINED_SETUP)).toBe("'fallback'");
  });
});

describeIfPython('S5 Python execution — chained / precedence rows', () => {
  const rows: [string, string][] = [
    // `&&` binds tighter; `"0"` is truthy → "right". The required kill row.
    ['"" || "0" && "right"', "'right'"],
    // `("left" && 0)` returns 0, then `0 || "fallback"`.
    ['"left" && 0 || "fallback"', "'fallback'"],
    // `[]` is truthy under KERN ToBoolean, so the outer `||` returns it.
    ['"left" && [] || "fallback"', '[]'],
    // `NaN` falsy; `[]` truthy and returned.
    ['NaN || [] || "fallback"', '[]'],
    // `{}` truthy, `&&` returns `""`, then `||` falls through.
    ['{} && "" || "fallback"', "'fallback'"],
  ];
  for (const [expr, expected] of rows) {
    test(`${expr} => ${expected}`, () => {
      expect(evalPy(expr)).toBe(expected);
    });
  }

  test('("left" && []) ? "then" : "else" => "then" (ternary wraps the logical result once)', () => {
    expect(evalPy('("left" && []) ? "then" : "else"')).toBe("'then'");
  });

  // The undefined sentinel behaves as a KERN-falsy operand inside chained
  // `&&`/`||` (not just in isolation): it selects like any falsy value and is
  // preserved (never collapsed to None) when it is the chosen result. The
  // helper bootstraps `_KERN_UNDEFINED`, so no extra setup is needed.
  test('undefined && "right" || "fallback" => "fallback" (undefined is falsy through the chain)', () => {
    expect(evalPy('undefined && "right" || "fallback"')).toBe("'fallback'");
  });
  test('"" || undefined && "right" => undefined (sentinel selected and preserved)', () => {
    expect(evalPy('"" || undefined && "right"')).toBe('undefined');
  });
});

describeIfPython('S5 Python execution — side-effect / evaluation-count probes', () => {
  // `mark(name, value)` logs the name and returns the value. Each probe asserts
  // BOTH the result repr AND the exact call log — proving single-eval,
  // left-to-right order, and short-circuiting of the unselected operand.
  const MARK = ['_log = []', 'def mark(name, value):', '    _log.append(name)', '    return value'].join('\n');

  function probe(expr: string, expectedResultRepr: string, expectedLog: string[]): void {
    const { code, helpers } = emit(expr);
    const program = [
      helpers,
      "NaN = float('nan')",
      MARK,
      code,
      `assert repr(r) == ${JSON.stringify(expectedResultRepr)}, 'value: ' + repr(r)`,
      `assert _log == ${JSON.stringify(expectedLog).replace(/"/g, "'")}, 'log: ' + repr(_log)`,
      "print('OK')",
    ].join('\n');
    expect(runPy(program).trim()).toBe('OK');
  }

  const probes: [string, string, string[]][] = [
    ['mark("L", 0) && mark("R", "right")', '0', ['L']],
    ['mark("L", "0") && mark("R", "right")', "'right'", ['L', 'R']],
    ['mark("L", []) && mark("R", "right")', "'right'", ['L', 'R']],
    ['mark("L", NaN) && mark("R", "right")', 'nan', ['L']],
    ['mark("L", 0) || mark("R", "fallback")', "'fallback'", ['L', 'R']],
    ['mark("L", "0") || mark("R", "fallback")', "'0'", ['L']],
    ['mark("L", []) || mark("R", "fallback")', '[]', ['L']],
    ['mark("L", {}) || mark("R", "fallback")', '{}', ['L']],
    ['mark("L", NaN) || mark("R", "fallback")', "'fallback'", ['L', 'R']],
    ['mark("A", "x") && mark("B", 0) || mark("C", "c")', "'c'", ['A', 'B', 'C']],
    ['mark("A", 0) && mark("B", "b") || mark("C", "c")', "'c'", ['A', 'C']],
    ['mark("A", "x") || mark("B", "b") && mark("C", "c")', "'x'", ['A']],
    ['mark("A", "") || mark("B", "0") && mark("C", "right")', "'right'", ['A', 'B', 'C']],
    ['mark("A", []) || mark("B", "b") && mark("C", "c")', '[]', ['A']],
    ['mark("A", "left") && mark("B", []) || mark("C", "fallback")', '[]', ['A', 'B']],
  ];
  for (const [expr, value, log] of probes) {
    test(`${expr} => ${value}, log ${JSON.stringify(log)}`, () => {
      probe(expr, value, log);
    });
  }
});

describeIfPython('S5 Python execution — ?? boundary rows (?? is nullish, not truthy)', () => {
  // `??` must NOT be "fixed" by this slice: it stays nullish (None / undefined
  // sentinel), so falsy-but-defined values are KEPT, contrasting with `||`.
  const nullishRows: [string, string, string][] = [
    ['0 ?? "fallback"', '0', ''],
    ['"" ?? "fallback"', "''", ''],
    ['false ?? "fallback"', 'False', ''],
    ['NaN ?? "fallback"', 'nan', ''],
    ['[] ?? "fallback"', '[]', ''],
    ['({}) ?? "fallback"', '{}', ''],
    ['null ?? "fallback"', "'fallback'", ''],
    ['undefined ?? "fallback"', "'fallback'", UNDEFINED_SETUP],
  ];
  for (const [expr, expected, setup] of nullishRows) {
    test(`${expr} => ${expected}`, () => {
      expect(evalPy(expr, setup)).toBe(expected);
    });
  }

  // Direct contrast: `||` chooses fallback for falsy-but-defined, `??` keeps it.
  const contrastRows: [string, string][] = [
    ['0 || "fallback"', "'fallback'"],
    ['"" || "fallback"', "'fallback'"],
    ['false || "fallback"', "'fallback'"],
    ['NaN || "fallback"', "'fallback'"],
  ];
  for (const [expr, expected] of contrastRows) {
    test(`contrast: ${expr} => ${expected}`, () => {
      expect(evalPy(expr)).toBe(expected);
    });
  }

  // Mixed `??` / `||` rows: `??` keeps its nullish lowering, `||` becomes the
  // self-parenthesized walrus ternary; the two compose with JS precedence.
  const mixedRows: [string, string, string][] = [
    // `null ?? (0 || "fallback")` → 0 is falsy → "fallback".
    ['null ?? 0 || "fallback"', "'fallback'", ''],
    // `undefined ?? ("" || "fallback")` → "" falsy → "fallback".
    ['undefined ?? "" || "fallback"', "'fallback'", UNDEFINED_SETUP],
  ];
  for (const [expr, expected, setup] of mixedRows) {
    test(`mixed: ${expr} => ${expected}`, () => {
      expect(evalPy(expr, setup)).toBe(expected);
    });
  }
});

// ──────── r1 review fix — comprehension-iterable positions (walrus ban) ────────
//
// CPython REJECTS `:=` anywhere inside a comprehension/generator ITERABLE
// expression ("assignment expression cannot be used in a comprehension
// iterable expression") — a symtable check that NO nesting (parens, calls,
// lambdas, list displays) escapes. Sites that interpolate an operand into a
// `for … in <here>` head (List.map/filter source, `.join`/`.flat`/`.indexOf`
// receivers, the method-form comprehension receiver) therefore emit it under
// `ctx.banWalrus`, switching walrus producers (`&&`/`||`, impure-left `??`,
// `typeof`) to the lambda-parameter form — same single-eval + lazy unselected
// branch, no `:=`. Everywhere else the canonical walrus stays (oracle-pinned).

describe('S5 r1 — iterable positions emit the walrus-free lambda-parameter form', () => {
  test('List.map source: logical lowers to the lambda-parameter form, never `:=`', () => {
    const out = emitPyExpression(parseExpression('List.map(a || b, (x) => x)'));
    expect(out).toBe('[x for x in ((lambda __k_log1: (__k_log1 if _kern_truthy(__k_log1) else b))(a))]');
    expect(out).not.toContain(':=');
  });

  test('List.filter source: same ban applies', () => {
    expect(emitPyExpression(parseExpression('List.filter(a || b, (x) => x)'))).not.toContain(':=');
  });

  test('`.join`/`.flat` receivers: logical lowers walrus-free', () => {
    const join = emitPyExpression(parseExpression('(a || b).join(",")'));
    expect(join).toBe(
      '",".join(str(__v) for __v in ((lambda __k_log1: (__k_log1 if _kern_truthy(__k_log1) else b))(a)))',
    );
    expect(emitPyExpression(parseExpression('(a || b).flat()'))).not.toContain(':=');
  });

  test('impure-left `??` and `typeof` sources are banned too (same producer class)', () => {
    expect(emitPyExpression(parseExpression('List.map(f() ?? b, (x) => x)'))).not.toContain(':=');
    expect(emitPyExpression(parseExpression('List.map(typeof a, (x) => x)'))).not.toContain(':=');
  });

  test('the ban reaches ANY depth of the iterable operand (index expression)', () => {
    expect(emitPyExpression(parseExpression('List.map(items[i || 0], (x) => x)'))).not.toContain(':=');
  });

  test('nested logicals in iterable position nest the lambda form (each single-eval)', () => {
    const out = emitPyExpression(parseExpression('List.map(a || b || c, (x) => x)'));
    expect(out).not.toContain(':=');
    expect(out).toContain('(lambda __k_log2:');
    expect(out).toContain('(lambda __k_log1:');
  });

  test('NON-iterable positions keep the canonical walrus form (oracle-pinned)', () => {
    expect(emitPyExpression(parseExpression('a || b'))).toContain(':=');
    expect(emitPyExpression(parseExpression('g(a || b)'))).toContain(':=');
    expect(emitPyExpression(parseExpression('(a || b)[0]'))).toContain(':=');
  });

  test('bare ternary SOURCE is parenthesized (its `if` must not parse as the filter)', () => {
    expect(emitPyExpression(parseExpression('List.map(a ? b : c, (x) => x)'))).toBe(
      '[x for x in (b if _kern_truthy(a) else c)]',
    );
  });

  test('bare ternary RECEIVER of `.join`/`.flat` is parenthesized', () => {
    expect(emitPyExpression(parseExpression('(a ? b : c).join(",")'))).toBe(
      '",".join(str(__v) for __v in (b if _kern_truthy(a) else c))',
    );
    expect(emitPyExpression(parseExpression('(a ? b : c).flat()'))).toContain(
      'for __x in (b if _kern_truthy(a) else c)',
    );
  });

  test('compound MEMBER ROOT is parenthesized (`.prop` must bind the whole ternary)', () => {
    // Pre-fix this emitted `b if _kern_truthy(a) else c.indexOf(x)` — silently
    // wrong Python (member bound to the last operand only).
    expect(emitPyExpression(parseExpression('(a ? b : c).indexOf(x)'))).toBe(
      '(b if _kern_truthy(a) else c).indexOf(x)',
    );
    // Self-parenthesized lowerings stay bare — no double parens.
    expect(emitPyExpression(parseExpression('(a || b).x'))).toBe('(__k_log1 if _kern_truthy(__k_log1 := a) else b).x');
  });
});

describeIfPython('S5 r1 — iterable positions execute correctly (value + call-log rows)', () => {
  const valueRows: [string, string, string][] = [
    // KERN: `[] || x` returns `[]` (containers are KERN-truthy) — map over it.
    ['List.map([] || [3, 4], (x) => x * 2)', '[]', ''],
    ['List.map("" || [3, 4], (x) => x * 2)', '[6, 8]', ''],
    ['List.filter([1, 0, 2] || [9], (x) => x)', '[1, 2]', ''],
    // NaN && [1] → NaN (falsy left); NaN || [7, 8] → [7, 8]; joined.
    ['(NaN && [1] || [7, 8]).join("-")', "'7-8'", ''],
    ['([[1], [2, 3]] || []).flat()', '[1, 2, 3]', ''],
    // Ternary source/receiver: parenthesized, not parsed as comprehension filter.
    ['List.map(false ? [1] : [2, 3], (x) => x * 10)', '[20, 30]', ''],
    ['(false ? [1] : [2, 3]).join(",")', "'2,3'", ''],
    // Impure-left `??` source through the lambda-parameter form.
    ['List.map(f() ?? [9], (x) => x + 1)', '[10]', 'def f():\n    return None'],
    // `typeof` source (a string — List.map iterates its characters).
    ['List.map(typeof 0, (c) => c)', "['n', 'u', 'm', 'b', 'e', 'r']", ''],
  ];
  for (const [expr, expected, setup] of valueRows) {
    test(`${expr} => ${expected}`, () => {
      expect(evalPy(expr, setup)).toBe(expected);
    });
  }

  // Single-eval + short-circuit survive the lambda-parameter form.
  const MARK = ['_log = []', 'def mark(name, value):', '    _log.append(name)', '    return value'].join('\n');
  function probe(expr: string, expectedResultRepr: string, expectedLog: string[]): void {
    const { code, helpers } = emit(expr);
    const program = [
      helpers,
      "NaN = float('nan')",
      MARK,
      code,
      `assert repr(r) == ${JSON.stringify(expectedResultRepr)}, 'value: ' + repr(r)`,
      `assert _log == ${JSON.stringify(expectedLog).replace(/"/g, "'")}, 'log: ' + repr(_log)`,
      "print('OK')",
    ].join('\n');
    expect(runPy(program).trim()).toBe('OK');
  }
  const probes: [string, string, string[]][] = [
    // `[]` is KERN-truthy → selected, R never runs, mapped unchanged.
    ['List.map(mark("L", []) || mark("R", [5]), (x) => x)', '[]', ['L']],
    ['List.map(mark("L", 0) || mark("R", [5]), (x) => x)', '[5]', ['L', 'R']],
    // Nested chain in iterable position: left-to-right, each operand once.
    ['List.map(mark("A", 0) || mark("B", []) && mark("C", [1]), (x) => x)', '[1]', ['A', 'B', 'C']],
  ];
  for (const [expr, value, log] of probes) {
    test(`${expr} => ${value}, log ${JSON.stringify(log)}`, () => {
      probe(expr, value, log);
    });
  }
});

if (!pythonAvailable) {
  describe('S5 logical result-value — Python leg', () => {
    it.skip('skipped: python3 not on PATH', () => {
      // Marker only — see describeIfPython.
    });
  });
}
