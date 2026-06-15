/** DECIMAL Slice 2 — PYTHON leg emission + DIFFERENTIAL EXECUTION for the new
 *  safe-arithmetic surface (`sub`/`mul`/`neg`/`abs`) AND the `_kern_fmt` Decimal
 *  canonicalization (Finding B) AND the symmetric `+`/`-`/`*` operator fail-close
 *  (item 3).
 *
 *  Mirrors the Slice-1 harness exactly:
 *    1. EMISSION — `Decimal.sub/mul/neg/abs` lower to native Python operators
 *       (parenthesized), with the `decimal` import recorded.
 *    2. SYMMETRIC FAIL-CLOSE — `Decimal <+/-/*> Decimal` (syntactically-proven
 *       Decimal operands) throws the BYTE-IDENTICAL message on both legs.
 *    3. DIFFERENTIAL EXECUTION — emitted TS (decimal.js, prec 28 / HALF_EVEN) and
 *       emitted Python (stdlib `decimal`, rendered through `_kern_decimal_str`)
 *       produce BYTE-EXACT output for every sub/mul/neg/abs case.
 *    4. _kern_fmt CANONICALIZATION — `String(Decimal.add(...))` / template / concat
 *       of a Decimal renders the SAME canonical (significance-free) string as the
 *       TS leg, because production `_kern_fmt` now routes Decimals through
 *       `_kern_decimal_str`. */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DECIMAL_OPERATOR_FAILCLOSE,
  decimalImportLineTS,
  emitExpression,
  emitExpressionWithImports,
  parseExpression,
} from '@kernlang/core';
import { emitPyExpression, emitPyExpressionWithImports } from '../src/codegen-body-python.js';
import { KERN_DECIMAL_STR_HELPER_PY, KERN_FMT_HELPER_PY } from '../src/core/expr/index.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

// ── Emission locks (Python leg) ──────────────────────────────────────────────
describe('Decimal Slice 2 — Python sub/mul/neg/abs emission', () => {
  test('Decimal.sub → native parenthesized subtraction', () => {
    expect(py('Decimal.sub(Decimal.of("1.5"), Decimal.of("2.5"))')).toBe(
      '(__k_decimal.Decimal("1.5") - __k_decimal.Decimal("2.5"))',
    );
  });
  test('Decimal.mul → native parenthesized multiplication', () => {
    expect(py('Decimal.mul(Decimal.of("1.5"), Decimal.of("1.5"))')).toBe(
      '(__k_decimal.Decimal("1.5") * __k_decimal.Decimal("1.5"))',
    );
  });
  test('Decimal.neg → parenthesized unary minus', () => {
    expect(py('Decimal.neg(Decimal.of("1.5"))')).toBe('(-__k_decimal.Decimal("1.5"))');
  });
  test('Decimal.abs → abs(...)', () => {
    expect(py('Decimal.abs(Decimal.of("1.5"))')).toBe('abs(__k_decimal.Decimal("1.5"))');
  });
  test('records the decimal import once', () => {
    const r = emitPyExpressionWithImports(parseExpression('Decimal.mul(Decimal.of("1.5"), Decimal.of("1.5"))'));
    expect([...r.imports]).toEqual(['decimal']);
  });
});

// ── Symmetric operator fail-close (item 3) ───────────────────────────────────
function assertSymmetricThrow(src: string, expectedSubstring: string): void {
  let tsMsg = '';
  let pyMsg = '';
  try {
    ts(src);
    throw new Error(`TS did not throw for ${src}`);
  } catch (e) {
    tsMsg = (e as Error).message;
  }
  try {
    py(src);
    throw new Error(`Python did not throw for ${src}`);
  } catch (e) {
    pyMsg = (e as Error).message;
  }
  expect(tsMsg).toContain(expectedSubstring);
  expect(tsMsg).toBe(pyMsg); // byte-identical refusal across targets
}

describe('Decimal Slice 2 — symmetric +/-/* operator fail-close (item 3)', () => {
  // Both operands syntactically-proven Decimal producers.
  test('Decimal.of(...) + Decimal.of(...) fails closed symmetrically', () => {
    assertSymmetricThrow('Decimal.of("1.5") + Decimal.of("2.5")', DECIMAL_OPERATOR_FAILCLOSE);
  });
  test('Decimal.of(...) - Decimal.of(...) fails closed symmetrically', () => {
    assertSymmetricThrow('Decimal.of("1.5") - Decimal.of("2.5")', DECIMAL_OPERATOR_FAILCLOSE);
  });
  test('Decimal.of(...) * Decimal.of(...) fails closed symmetrically', () => {
    assertSymmetricThrow('Decimal.of("1.5") * Decimal.of("2.5")', DECIMAL_OPERATOR_FAILCLOSE);
  });
  // One operand a Decimal producer (an add result) — still fail-closed.
  test('Decimal.add(...) + Decimal.of(...) fails closed symmetrically', () => {
    assertSymmetricThrow('Decimal.add(Decimal.of("1"), Decimal.of("2")) + Decimal.of("3")', DECIMAL_OPERATOR_FAILCLOSE);
  });
  test('message names the safe redirect (Decimal.add / sub / mul)', () => {
    let msg = '';
    try {
      ts('Decimal.of("1.5") * Decimal.of("2.5")');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('Decimal.mul');
  });
});

describe('Decimal Slice 2 — plain numeric +/-/* must NOT fail-close (narrowness)', () => {
  // The check is CONSERVATIVE: only a syntactically-proven Decimal operand fires
  // it. Ordinary numeric arithmetic compiles normally on both legs.
  for (const src of ['1 + 2', 'a - b', 'x * 3', '(a + b) * c', 'price * qty - discount', 'Math.max(a, b) + 1']) {
    test(`${src} compiles on both legs (no false fire)`, () => {
      expect(() => ts(src)).not.toThrow();
      expect(() => py(src)).not.toThrow();
    });
  }
  // A NON-arithmetic operator on Decimal producers is NOT covered by this slice
  // (comparison is a later slice) — must not fire the +/-/* fail-close.
  test('Decimal.of(...) == Decimal.of(...) is not the +/-/* fail-close', () => {
    let threw = false;
    try {
      ts('Decimal.of("1.5") == Decimal.of("1.5")');
    } catch (e) {
      threw = (e as Error).message.includes('Decimal does not support');
    }
    expect(threw).toBe(false);
  });
});

// ── Differential execution: emit → run BOTH legs → diff byte-exact output ─────
const req = createRequire(import.meta.url);
let decimalJsPath: string | null = null;
try {
  decimalJsPath = req.resolve('decimal.js');
} catch {
  decimalJsPath = null;
}

const haveExecRuntimes = (() => {
  if (decimalJsPath === null) return false;
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const execDescribe = haveExecRuntimes ? describe : describe.skip;

execDescribe('Decimal Slice 2 — DIFFERENTIAL EXECUTION (byte-exact runtime parity)', () => {
  // [KERN source, expected canonical rendered value on BOTH legs]. Covers
  // sub/mul/neg/abs incl. sign + scale-divergent canonicalization (Python's raw
  // "1.0"/"-0.3" forms must be re-rendered to decimal.js's significance-free form).
  const cases: Array<[string, string]> = [
    ['Decimal.sub(Decimal.of("1.5"), Decimal.of("2.5"))', '-1'],
    ['Decimal.sub(Decimal.of("0.3"), Decimal.of("0.6"))', '-0.3'],
    ['Decimal.sub(Decimal.of("5"), Decimal.of("5"))', '0'],
    ['Decimal.mul(Decimal.of("1.5"), Decimal.of("1.5"))', '2.25'],
    ['Decimal.mul(Decimal.of("2"), Decimal.of("0.5"))', '1'],
    ['Decimal.mul(Decimal.of("-3"), Decimal.of("2"))', '-6'],
    ['Decimal.neg(Decimal.of("1.5"))', '-1.5'],
    ['Decimal.neg(Decimal.of("-2.25"))', '2.25'],
    ['Decimal.abs(Decimal.of("-1.5"))', '1.5'],
    ['Decimal.abs(Decimal.of("3.14"))', '3.14'],
    // composition with slice-1 add
    ['Decimal.add(Decimal.mul(Decimal.of("2"), Decimal.of("3")), Decimal.of("0.5"))', '6.5'],
    ['Decimal.abs(Decimal.sub(Decimal.of("0.1"), Decimal.of("0.4")))', '0.3'],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-decimal-slice2-exec-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function runTs(src: string): string {
    const r = emitExpressionWithImports(parseExpression(src));
    const preamble = decimalImportLineTS().replace("'decimal.js'", `'${decimalJsPath}'`);
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `${r.imports.has('decimal.js') ? preamble : ''}\nconsole.log(String(${r.code}));\n`);
    return execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  function runPy(src: string): string {
    const r = emitPyExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import ${m} as __k_${m}`).join('\n');
    const file = join(dir, 'run.py');
    writeFileSync(
      file,
      [
        'from decimal import getcontext, ROUND_HALF_EVEN',
        imports,
        KERN_DECIMAL_STR_HELPER_PY,
        'getcontext().prec = 28',
        'getcontext().rounding = ROUND_HALF_EVEN',
        `print(_kern_decimal_str(${r.code}))`,
      ].join('\n'),
    );
    return execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  for (const [src, expected] of cases) {
    test(`${src} → ${expected} on BOTH legs (byte-exact)`, () => {
      const tsOut = runTs(src);
      const pyOut = runPy(src);
      expect(tsOut).toBe(expected);
      expect(pyOut).toBe(expected);
      expect(tsOut).toBe(pyOut);
    });
  }
});

// ── Finding B: _kern_fmt Decimal canonicalization (differential) ─────────────
//
// Production `_kern_fmt` must route Decimals through `_kern_decimal_str` so that
// String()/template/concat of a Decimal renders the SAME significance-free string
// as the TS leg (decimal.js `.toString()`). We verify the EMITTED helper text
// canonicalizes, then run it differentially.
execDescribe('Decimal Slice 2 — _kern_fmt canonicalizes Decimals (Finding B, differential)', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-decimal-slice2-fmt-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // Python side: define _kern_decimal_str + _kern_fmt, build a Decimal whose
  // raw str() would diverge (Python "4.0"), and assert _kern_fmt renders "4".
  function runPyFmt(decimalExpr: string): string {
    const file = join(dir, 'fmt.py');
    writeFileSync(
      file,
      [
        'from decimal import getcontext, ROUND_HALF_EVEN',
        'import decimal as __k_decimal',
        KERN_DECIMAL_STR_HELPER_PY,
        KERN_FMT_HELPER_PY,
        'getcontext().prec = 28',
        'getcontext().rounding = ROUND_HALF_EVEN',
        `print(_kern_fmt(${decimalExpr}))`,
      ].join('\n'),
    );
    return execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  function runTsString(jsExpr: string): string {
    const preamble = decimalImportLineTS().replace("'decimal.js'", `'${decimalJsPath}'`);
    const file = join(dir, 'fmt.mjs');
    writeFileSync(file, `${preamble}\nconsole.log(String(${jsExpr}));\n`);
    return execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  // [python Decimal expr, equivalent TS expr, expected canonical string]
  const cases: Array<[string, string, string]> = [
    ['__k_decimal.Decimal("1.5") + __k_decimal.Decimal("2.5")', 'new Decimal("1.5").plus(new Decimal("2.5"))', '4'],
    ['__k_decimal.Decimal("100") * __k_decimal.Decimal("1")', 'new Decimal("100").times(new Decimal("1"))', '100'],
    ['__k_decimal.Decimal("1.5")', 'new Decimal("1.5")', '1.5'],
    ['-__k_decimal.Decimal("1.5")', 'new Decimal("1.5").neg()', '-1.5'],
  ];

  for (const [pyExpr, tsExpr, expected] of cases) {
    test(`_kern_fmt(${pyExpr}) == String(${tsExpr}) == "${expected}"`, () => {
      const pyOut = runPyFmt(pyExpr);
      const tsOut = runTsString(tsExpr);
      expect(pyOut).toBe(expected);
      expect(tsOut).toBe(expected);
      expect(pyOut).toBe(tsOut);
    });
  }

  test('without canonicalization Python str() would diverge (sanity: raw str is "4.0")', () => {
    const file = join(dir, 'raw.py');
    writeFileSync(
      file,
      ['import decimal as __k_decimal', 'print(str(__k_decimal.Decimal("1.5") + __k_decimal.Decimal("2.5")))'].join(
        '\n',
      ),
    );
    const raw = execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
    expect(raw).toBe('4.0'); // the divergence _kern_fmt now fixes
  });
});
