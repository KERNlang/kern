/** DECIMAL first-class member — Slice 1 (feasibility foundation), PYTHON leg
 *  + the differential-EXECUTION parity proof.
 *
 *  Three things are locked here:
 *    1. EMISSION — `Decimal.of`/`Decimal.add` lower to `__k_decimal.Decimal(...)` /
 *       native `+`, with the `decimal` stdlib import recorded in `ctx.imports`
 *       (rendered as `import decimal as __k_decimal` by the route generators).
 *    2. SYMMETRIC FAIL-CLOSE — every scale-divergent / non-string / bare-construction
 *       case throws the BYTE-IDENTICAL message on the TS leg and the Python leg
 *       (single-sourced from `@kernlang/core` `decimal-contract.ts`).
 *    3. DIFFERENTIAL EXECUTION — the emitted TS (run on node with decimal.js,
 *       configured precision 28 / ROUND_HALF_EVEN) and the emitted Python (run on
 *       python3 with stdlib `decimal`, rendered through KERN's canonical
 *       stringifier `_kern_decimal_str`) produce BYTE-EXACT identical output for the
 *       slice's construction + addition surface — the strongest possible proof.
 *
 *  The canonical stringifier is REQUIRED for output parity: Python's `decimal`
 *  PRESERVES scale (`Decimal("1.5") + Decimal("2.5")` renders `"4.0"`), decimal.js
 *  drops it (`"4"`). `_kern_decimal_str` re-renders the Python value under
 *  decimal.js's exact significance-free notation rule so the two agree. */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DECIMAL_BARE_CONSTRUCTION_FAILCLOSE,
  DECIMAL_SCALE_FAILCLOSE,
  decimalImportLineTS,
  emitExpression,
  emitExpressionWithImports,
  parseExpression,
} from '@kernlang/core';
import { emitPyExpression, emitPyExpressionWithImports } from '../src/codegen-body-python.js';
import { KERN_DECIMAL_STR_HELPER_PY } from '../src/core/expr/index.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

// ── Emission locks ───────────────────────────────────────────────────────────
describe('Decimal Slice 1 — Python construction + addition emission', () => {
  test('Decimal.of("1.5") → __k_decimal.Decimal("1.5") + decimal import', () => {
    const r = emitPyExpressionWithImports(parseExpression('Decimal.of("1.5")'));
    expect(r.code).toBe('__k_decimal.Decimal("1.5")');
    expect([...r.imports]).toEqual(['decimal']);
  });

  test('Decimal.add(...) → native + on two Decimal values (parenthesized, self-delimiting)', () => {
    expect(py('Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))')).toBe(
      '(__k_decimal.Decimal("0.1") + __k_decimal.Decimal("0.2"))',
    );
  });

  test('nested Decimal.add stays correct-by-construction (inner add wrapped)', () => {
    // a + (b + c) — NOT a + b + c. Associative so value-identical, but the parens
    // keep the form correct for the non-associative ops a later slice will add.
    expect(py('Decimal.add(Decimal.of("0.1"), Decimal.add(Decimal.of("0.2"), Decimal.of("0.3")))')).toBe(
      '(__k_decimal.Decimal("0.1") + (__k_decimal.Decimal("0.2") + __k_decimal.Decimal("0.3")))',
    );
  });
});

// ── Symmetric fail-close (byte-identical message on BOTH legs) ────────────────
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

describe('Decimal Slice 1 — symmetric scale/construction fail-close', () => {
  for (const lit of ['1.10', '1.2300', '0.00', '-0', '1E+2', '1.5e-10', '1.0']) {
    test(`Decimal.of("${lit}") fails closed symmetrically`, () => {
      assertSymmetricThrow(`Decimal.of("${lit}")`, DECIMAL_SCALE_FAILCLOSE);
    });
  }

  test('Decimal.of(0.1) (non-string literal) fails closed symmetrically', () => {
    assertSymmetricThrow('Decimal.of(0.1)', 'Decimal construction requires a string literal');
  });

  test('bare Decimal("1.5") fails closed symmetrically', () => {
    assertSymmetricThrow('Decimal("1.5")', DECIMAL_BARE_CONSTRUCTION_FAILCLOSE);
  });
});

// ── Differential execution: emit → run BOTH legs → diff byte-exact output ─────
const req = createRequire(import.meta.url);
let decimalJsPath: string | null = null;
try {
  // Resolve the absolute path to decimal.js so the emitted TS (written to a temp
  // dir) can import it regardless of where node's cwd is.
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

execDescribe('Decimal Slice 1 — DIFFERENTIAL EXECUTION (byte-exact runtime parity)', () => {
  // [KERN source, expected canonical rendered value on BOTH legs]. Restricted to
  // the in-core arithmetic range where 28-digit-precision values agree; covers the
  // probe's headline case (0.1+0.2 = exactly 0.3) plus output-scale cases
  // (1.5+2.5 = 4, where Python's raw "4.0" must be canonicalized) and signs.
  const cases: Array<[string, string]> = [
    ['Decimal.of("1.5")', '1.5'],
    ['Decimal.of("0.1")', '0.1'],
    ['Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))', '0.3'],
    ['Decimal.add(Decimal.of("1.5"), Decimal.of("2.5"))', '4'],
    ['Decimal.add(Decimal.of("0.3"), Decimal.of("0.6"))', '0.9'],
    ['Decimal.add(Decimal.of("100"), Decimal.of("200"))', '300'],
    ['Decimal.add(Decimal.of("-1.5"), Decimal.of("0.5"))', '-1'],
    ['Decimal.add(Decimal.of("0.05"), Decimal.of("0.95"))', '1'],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-decimal-slice1-exec-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function runTs(src: string): string {
    const r = emitExpressionWithImports(parseExpression(src));
    // Build the preamble from the canonical-context rule, but point the import at
    // the resolved absolute path so it loads from a temp dir.
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

  test('headline: 0.1 + 0.2 is EXACTLY 0.3 (not 0.30000000000000004) on both legs', () => {
    expect(runTs('Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))')).toBe('0.3');
    expect(runPy('Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))')).toBe('0.3');
  });
});
