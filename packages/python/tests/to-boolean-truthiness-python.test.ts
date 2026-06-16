/**
 * Slice S4 — ToBoolean / KERN truthiness substrate.
 *
 * Two layers of evidence, BOTH executed in real `python3`:
 *
 *   1. Helper-level battery — the `KERN_JS_HELPER_PY` source is run verbatim
 *      with the 17-row falsy-set table asserted INSIDE the Python program
 *      (incl. UserFalsy/__bool__, LengthZero/__len__, and the sentinel-vs-object
 *      interplay rows). This proves `_kern_truthy`/`js_truthy` is an explicit
 *      falsy-set predicate that never delegates to bool()/len()/__bool__/__len__
 *      or a ToNumber string conversion.
 *
 *   2. Live-emission consumer fixtures — `firstTruthy`, `if cond=`, the ternary
 *      condition, and unary `!` are emitted through production codegen, then the
 *      EMITTED Python is executed (with bound inputs) so a bare `if <expr>:` /
 *      `<a> or <b>` divergence cannot hide. Each touched site is also asserted to
 *      CONTAIN the helper call (Routing Rules). Negative-control rows prove
 *      `??`/`coalesce` stay NULLISH-based, not truthiness-based.
 *
 * Skip-marker: if `python3` is not on PATH the suite is skipped (local dev
 * without Python must not fail CI for missing tooling).
 */

import { spawnSync } from 'node:child_process';
import type { IRNode } from '@kernlang/core';
import { parseDocument, parseExpression } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports, emitPyExpressionWithImports } from '../src/codegen-body-python.js';
import { generateCoalesce, generateFirstTruthy } from '../src/codegen-python.js';
import { KERN_JS_HELPER_PY } from '../src/core/expr/helpers.js';

const pythonAvailable = (() => {
  try {
    return spawnSync('python3', ['--version'], { encoding: 'utf-8' }).status === 0;
  } catch {
    return false;
  }
})();
const describeIfPython = pythonAvailable ? describe : describe.skip;

/** Run a self-contained Python program and return trimmed stdout, asserting a
 *  clean exit (a failing `assert` inside the program surfaces here as a throw). */
function runPython(program: string): string {
  const r = spawnSync('python3', ['-c', program], { encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(`python3 exited ${r.status}\n--- stderr ---\n${r.stderr}\n--- program ---\n${program}`);
  }
  return (r.stdout ?? '').trim();
}

/** Emit a `lang=kern` handler body and assemble a runnable Python program:
 *  helpers + the caller's `setup` (binding definitions) + the body wrapped in a
 *  `def __run():` so a `return` inside the body yields a value we print. Returns
 *  both the raw emitted body (for CONTAINS assertions) and the program stdout. */
function runEmittedBody(bodyStatements: string, setup: string): { code: string; stdout: string } {
  const src = ['fn name=h params="" returns=any', '  handler lang=kern', bodyStatements].join('\n');
  const doc = parseDocument(src);
  const fn = (doc.children ?? []).find((c) => c.type === 'fn') as IRNode;
  const handler = (fn.children ?? []).find((c) => c.type === 'handler') as IRNode;
  // Bindings referenced by the body are passed as outerBindings so they resolve
  // as plain names (not renamed) and we define them in the program preamble.
  const bindingNames = [...setup.matchAll(/^(\w+)\s*=/gmu)].map((m) => m[1]);
  const res = emitNativeKernBodyPythonWithImports(handler, { outerBindings: bindingNames });
  const helpers = [...res.helpers].join('\n\n');
  const indentedBody = res.code
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
  const program = [helpers, '', setup, '', 'def __run():', indentedBody, '', 'print(repr(__run()))'].join('\n');
  return { code: res.code, stdout: runPython(program) };
}

/** Emit a single expression (ternary / unary !) through the production
 *  expression emitter and run it as `print(repr(<expr>))` after the helper +
 *  binding preamble. */
function runEmittedExpr(kernExpr: string, setup: string): { code: string; stdout: string } {
  const res = emitPyExpressionWithImports(parseExpression(kernExpr));
  const helpers = [...res.helpers].join('\n\n');
  const program = [helpers, '', setup, '', `print(repr(${res.code}))`].join('\n');
  return { code: res.code, stdout: runPython(program) };
}

// ── Helper-level battery ─────────────────────────────────────────────────────

describeIfPython('ToBoolean helper battery — executed in python3', () => {
  test('the 17-row falsy-set table holds (incl. UserFalsy/LengthZero/sentinel interplay)', () => {
    const program = [
      KERN_JS_HELPER_PY,
      '',
      'class UserFalsy:',
      '    def __bool__(self): return False',
      'class LengthZero:',
      '    def __len__(self): return 0',
      '',
      'rows = [',
      '    ("undefined", _KERN_UNDEFINED, False),',
      '    ("null", None, False),',
      '    ("false", False, False),',
      '    ("true", True, True),',
      '    ("0", 0, False),',
      '    ("-0.0", -0.0, False),',
      '    ("0j", 0j, False),',
      '    ("NaN", float("nan"), False),',
      '    ("Infinity", float("inf"), True),',
      '    ("emptystr", "", False),',
      '    ("zerostr", "0", True),',
      '    ("falsestr", "false", True),',
      '    ("spacestr", " ", True),',
      '    ("emptylist", [], True),',
      '    ("emptydict", {}, True),',
      '    ("userfalsy", UserFalsy(), True),',
      '    ("lengthzero", LengthZero(), True),',
      ']',
      'for name, val, expected in rows:',
      '    got = js_truthy(val)',
      '    assert got is expected, f"js_truthy({name}) = {got!r}, expected {expected!r}"',
      '    assert _kern_truthy(val) is expected, f"_kern_truthy({name}) mismatch"',
      '# Sentinel vs object interplay in the SAME process: the sentinel stays falsy',
      '# (identity), but a user object with __bool__=False stays truthy.',
      'assert js_truthy(_KERN_UNDEFINED) is False',
      'assert js_truthy(UserFalsy()) is True',
      'print("OK", len(rows))',
    ].join('\n');
    expect(runPython(program)).toBe('OK 17');
  });

  test('strings never route through ToNumber and are never trimmed', () => {
    const program = [
      KERN_JS_HELPER_PY,
      '',
      'assert js_truthy("0") is True',
      'assert js_truthy("false") is True',
      'assert js_truthy(" ") is True',
      'assert js_truthy("NaN") is True',
      'assert js_truthy("") is False',
      'print("OK")',
    ].join('\n');
    expect(runPython(program)).toBe('OK');
  });
});

// ── Live-emission: firstTruthy ───────────────────────────────────────────────

describeIfPython('firstTruthy live emission — executed in python3', () => {
  test('selects an empty container ([]) before the fallback, and calls the helper', () => {
    const { code, stdout } = runEmittedBody(
      '    firstTruthy name=winner values="xs, fallback"\n    return value="winner"',
      'xs = []\nfallback = "fallback"',
    );
    expect(code).toContain('_kern_truthy(');
    expect(code).not.toContain('xs or fallback');
    expect(stdout).toBe('[]');
  });

  test('skips NaN but keeps the non-empty numeric string "0"', () => {
    const { code, stdout } = runEmittedBody(
      '    firstTruthy name=winner values="badNumber, label, fallback"\n    return value="winner"',
      'badNumber = float("nan")\nlabel = "0"\nfallback = "fallback"',
    );
    expect(code).toContain('_kern_truthy(');
    expect(stdout).toBe("'0'");
  });

  test('evaluates each candidate AT MOST ONCE and lazily (no eager comprehension)', () => {
    // markA/markB/markC each append to CALLS and return their value. The body
    // returns CALLS (the eval-order log) so we can assert which candidates ran.
    const { stdout } = runEmittedBody(
      '    firstTruthy name=winner values="markA(), markB(), markC()"\n    return value="CALLS"',
      [
        'CALLS = []',
        'def markA():',
        '    CALLS.append("a")',
        '    return []',
        'def markB():',
        '    CALLS.append("b")',
        '    return "x"',
        'def markC():',
        '    CALLS.append("c")',
        '    return "y"',
      ].join('\n'),
    );
    // [] (markA) is KERN-truthy → only "a" runs; markB/markC never evaluated.
    expect(stdout).toBe("['a']");
  });

  test('all-falsy chain evaluates EVERY candidate exactly once, left to right', () => {
    const { stdout } = runEmittedBody(
      '    firstTruthy name=winner values="markA(), markB(), markC()"\n    return value="CALLS"',
      [
        'CALLS = []',
        'def markA():',
        '    CALLS.append("a")',
        '    return ""',
        'def markB():',
        '    CALLS.append("b")',
        '    return 0',
        'def markC():',
        '    CALLS.append("c")',
        '    return "last"',
      ].join('\n'),
    );
    // "" and 0 are KERN-falsy → all three candidates run, once each, in order.
    expect(stdout).toBe("['a', 'b', 'c']");
  });

  test('preserves object identity of the selected user-falsy instance', () => {
    // The winner is printed via `repr`; UserFalsy.__repr__ returns a unique tag,
    // so a matching tag proves the SAME instance was selected (identity, not a
    // string coercion or a rebuilt value).
    const { code, stdout } = runEmittedBody(
      '    firstTruthy name=winner values="user_falsy, fallback"\n    return value="winner"',
      [
        'class UserFalsy:',
        '    def __bool__(self): return False',
        '    def __repr__(self): return "USERFALSY#1"',
        'user_falsy = UserFalsy()',
        'fallback = "fallback"',
      ].join('\n'),
    );
    expect(code).toContain('_kern_truthy(');
    expect(code).not.toContain('user_falsy or fallback');
    expect(stdout).toBe('USERFALSY#1');
  });

  test('sentinel/object interplay: sentinel is skipped, the user-falsy object wins by identity', () => {
    const { stdout } = runEmittedBody(
      '    firstTruthy name=winner values="undefined_value, user_falsy, fallback"\n    return value="winner"',
      [
        'class UserFalsy:',
        '    def __bool__(self): return False',
        '    def __repr__(self): return "USERFALSY#2"',
        'undefined_value = _KERN_UNDEFINED',
        'user_falsy = UserFalsy()',
        'fallback = "fallback"',
      ].join('\n'),
    );
    expect(stdout).toBe('USERFALSY#2');
  });
});

// ── Live-emission: if cond= ──────────────────────────────────────────────────

describeIfPython('if cond= live emission — executed in python3', () => {
  function runIf(condBinding: string, setup: string): { code: string; stdout: string } {
    // Inner single quotes make `then`/`else` STRING literals (not identifiers).
    return runEmittedBody(`    if cond=${condBinding}\n      return value="'then'"\n    return value="'else'"`, setup);
  }

  test('empty container is KERN-truthy → takes the then branch (and calls the helper)', () => {
    const { code, stdout } = runIf('items', 'items = []');
    expect(code).toContain('if _kern_truthy(items):');
    expect(stdout).toBe("'then'");
  });

  test('NaN is KERN-falsy → takes the else branch', () => {
    const { stdout } = runIf('badNumber', 'badNumber = float("nan")');
    expect(stdout).toBe("'else'");
  });

  test('user object with __bool__=False is KERN-truthy → then branch', () => {
    const { stdout } = runIf(
      'user_falsy',
      ['class UserFalsy:', '    def __bool__(self): return False', 'user_falsy = UserFalsy()'].join('\n'),
    );
    expect(stdout).toBe("'then'");
  });

  test('user object with __len__=0 is KERN-truthy → then branch', () => {
    const { stdout } = runIf(
      'length_zero',
      ['class LengthZero:', '    def __len__(self): return 0', 'length_zero = LengthZero()'].join('\n'),
    );
    expect(stdout).toBe("'then'");
  });
});

// ── Live-emission: ternary condition ─────────────────────────────────────────

describeIfPython('ternary condition live emission — executed in python3', () => {
  test('flag={} is KERN-truthy → consequent (and calls the helper)', () => {
    const { code, stdout } = runEmittedExpr('flag ? "then" : "else"', 'flag = {}');
    expect(code).toContain('_kern_truthy(flag)');
    expect(stdout).toBe("'then'");
  });
});

// ── Live-emission: unary ! ───────────────────────────────────────────────────

describeIfPython('unary ! live emission — executed in python3', () => {
  test.each([
    ['!""', 'True'],
    ['!"0"', 'False'],
    ['![]', 'False'],
    ['!NaN', 'True'],
  ])('%s → %s and returns a real Python bool', (expr, expected) => {
    const setup = 'NaN = float("nan")';
    const { code, stdout } = runEmittedExpr(expr, setup);
    expect(code).toContain('not _kern_truthy(');
    expect(stdout).toBe(expected);
    // returns a bool, not a truthy/falsy value
    expect(['True', 'False']).toContain(stdout);
  });
});

// ── Negative control: ?? / coalesce stay NULLISH, not truthiness-based ────────

describeIfPython('nullish negative control — ?? / coalesce do NOT use ToBoolean', () => {
  test.each([
    ['0', '0'],
    ['""', "''"],
    ['false', 'False'],
  ])('%s ?? fallback keeps the falsy-but-defined value (%s)', (lhs, expected) => {
    const map: Record<string, string> = { '0': '0', '""': '""', false: 'False' };
    const { code, stdout } = runEmittedExpr(`val ?? "fallback"`, `val = ${map[lhs] ?? lhs}`);
    // `??` lowers to an `is None`/`is not _KERN_UNDEFINED` nullish test, NOT _kern_truthy.
    expect(code).not.toContain('_kern_truthy');
    expect(stdout).toBe(expected);
  });

  test('coalesce body statement: 0 stays 0 (nullish selection, never truthiness)', () => {
    // Ground-layer coalesce keeps `is not None` selection; assert via emitted code.
    const node: IRNode = {
      type: 'coalesce',
      props: { name: 'winner', values: "count, 'fallback'" },
      children: [],
    };
    const code = generateCoalesce(node).join('\n');
    expect(code).toContain('is not None');
    expect(code).not.toContain('_kern_truthy');
    expect(code).not.toContain('js_truthy');
    // Execute: count=0 must select 0, not "fallback".
    const program = [code.replace('winner = ', '__r = '), 'print(repr(__r))'].join('\n');
    // Bind count=0 ahead of the expression.
    expect(runPython(`count = 0\n${program}`)).toBe('0');
  });

  test('firstTruthy IS truthiness-based (contrast with coalesce): 0 is skipped', () => {
    // Sanity contrast — the same value (0) behaves OPPOSITELY under firstTruthy.
    const node: IRNode = {
      type: 'firstTruthy',
      props: { name: 'winner', values: "count, 'fallback'" },
      children: [],
    };
    const code = generateFirstTruthy(node).join('\n');
    expect(code).toContain('_kern_truthy');
    const assignLine = code.split('\n').find((l) => l.startsWith('winner = ')) ?? '';
    const program = [code, 'print(repr(winner))'].join('\n');
    expect(assignLine).toContain('_kern_truthy');
    expect(runPython(`count = 0\n${program}`)).toBe("'fallback'");
  });
});

if (!pythonAvailable) {
  describe('ToBoolean truthiness substrate', () => {
    it.skip('skipped: python3 not on PATH', () => {
      // Marker only.
    });
  });
}
