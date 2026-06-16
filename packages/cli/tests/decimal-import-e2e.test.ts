/** DECIMAL Slice 2 — remediation Finding 1: the TS `decimal.js` import channel must
 *  render END-TO-END, not just surface a leaf-level requirement.
 *
 *  Before the remediation, a real KERN module with a `handler lang="kern"` using
 *  `Decimal.of(...)` compiled to TS with `new Decimal(...)` in the body but NO
 *  `import Decimal from 'decimal.js'` and NO `Decimal.set(...)` preamble → a runtime
 *  ReferenceError. The remediation wires the import through the EXISTING post-
 *  transpile stdlib-preamble pass (`detectKernStdlibUsage` → `kernStdlibPreamble` →
 *  `injectKernStdlibPreamble`), which AST-detects `lang="kern"` Decimal handlers and
 *  renders the `decimal.js` import + canonical-context preamble at file TOP-LEVEL
 *  (where an ESM import is legal) across every TS-family target — mirroring how the
 *  Python leg injects `import decimal as __k_decimal` inline per function.
 *
 *  This compiles a FULL module to a TS string and asserts the import + preamble +
 *  `new Decimal(...)` are all present, that a Decimal-FREE module gets none of them
 *  (no leak), and that the same handler on the Python target renders `import decimal`. */

import type { KernTarget, TranspileResult } from '@kernlang/core';
import { parseDocument, resolveConfig } from '@kernlang/core';
import { transpileForTarget } from '../src/shared.js';

function compileResult(src: string, target: KernTarget): TranspileResult {
  const ast = parseDocument(src);
  const cfg = resolveConfig({ target });
  return transpileForTarget(ast, cfg);
}

function compile(src: string, target: KernTarget = 'lib'): string {
  return compileResult(src, target).code;
}

const DECIMAL_MODULE = [
  'fn name=priceTotal returns=Decimal export=true',
  '  handler lang="kern"',
  '    let name=base value="Decimal.of(\\"1.5\\")"',
  '    let name=total value="Decimal.add(base, Decimal.of(\\"2.5\\"))"',
  '    return value=total',
].join('\n');

const DECIMAL_OF_ONLY = [
  'fn name=oneAndAHalf returns=Decimal export=true',
  '  handler lang="kern"',
  '    let name=x value="Decimal.of(\\"1.5\\")"',
  '    return value=x',
].join('\n');

const DECIMAL_FREE_MODULE = [
  'fn name=add2 params="a:number,b:number" returns=number export=true',
  '  handler lang="kern"',
  '    let name=s value="a + b"',
  '    return value=s',
].join('\n');

describe('Decimal Slice 2 — TS import channel renders end-to-end (Finding 1)', () => {
  test('a lang="kern" handler using Decimal.of/Decimal.add gets the import + preamble + new Decimal()', () => {
    const code = compile(DECIMAL_MODULE, 'lib');
    // The runtime import lands at file top-level (legal ESM).
    expect(code).toContain("import Decimal from 'decimal.js';");
    // The one-time canonical-context preamble (matches CPython's default decimal context).
    expect(code).toContain(
      'Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN, modulo: Decimal.ROUND_DOWN });',
    );
    // The body lowering itself.
    expect(code).toContain('new Decimal("1.5")');
    expect(code).toContain('.plus(new Decimal("2.5"))');
    // The import must precede the function declaration that uses `new Decimal`.
    expect(code.indexOf("import Decimal from 'decimal.js';")).toBeLessThan(code.indexOf('export function priceTotal'));
    expect(code.indexOf("import Decimal from 'decimal.js';")).toBeLessThan(code.indexOf('new Decimal("1.5")'));
  });

  test('the import + preamble appear exactly ONCE per file (no duplication)', () => {
    const code = compile(DECIMAL_OF_ONLY, 'lib');
    expect(code.match(/import Decimal from 'decimal\.js';/g)?.length).toBe(1);
    expect(code.match(/Decimal\.set\(\{ precision: 28/g)?.length).toBe(1);
  });

  test('a Decimal-FREE module gets NEITHER the import NOR the preamble (no leak)', () => {
    const code = compile(DECIMAL_FREE_MODULE, 'lib');
    expect(code).not.toContain('decimal.js');
    expect(code).not.toContain('Decimal.set(');
    expect(code).not.toContain('KERN Decimal runtime');
    // The actual fn body still compiles.
    expect(code).toContain('export function add2');
  });

  test('every TS-family target renders the import (lib / mcp / express / terminal share the seam)', () => {
    for (const target of ['lib', 'mcp', 'express', 'terminal'] as KernTarget[]) {
      const code = compile(DECIMAL_MODULE, target);
      expect(code).toContain("import Decimal from 'decimal.js';");
      expect(code).toContain(
        'Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN, modulo: Decimal.ROUND_DOWN });',
      );
    }
  });

  test('a raw lang="ts" handler does NOT get the auto-injected import (author owns its imports)', () => {
    // A raw TS handler that mentions Decimal is the author's own concern — the
    // canonical-context auto-injection only fires for KERN-lowered `lang="kern"`.
    const rawTs = [
      'fn name=raw returns=number export=true',
      '  handler lang="ts" <<<',
      '    return 1 + 2;',
      '  >>>',
    ].join('\n');
    const code = compile(rawTs, 'lib');
    expect(code).not.toContain('decimal.js');
  });
});

const DECIMAL_DIV_MODULE = [
  'fn name=ratio returns=Decimal export=true',
  '  handler lang="kern"',
  '    let name=q value="Decimal.div(Decimal.of(\\"10\\"), Decimal.of(\\"3\\"))"',
  '    return value=q',
].join('\n');

describe('Decimal Slice 3 — the guarded div/mod/pow helpers render end-to-end (TS leg)', () => {
  test('a lang="kern" Decimal.div handler emits the import + guarded helpers + the helper call', () => {
    const code = compile(DECIMAL_DIV_MODULE, 'lib');
    // import + canonical context (same seam slice 2 built).
    expect(code).toContain("import Decimal from 'decimal.js';");
    expect(code).toContain(
      'Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN, modulo: Decimal.ROUND_DOWN });',
    );
    // the three guarded helper DEFINITIONS ride the same preamble block.
    expect(code).toContain('function __k_decimal_div(');
    expect(code).toContain('function __k_decimal_mod(');
    expect(code).toContain('function __k_decimal_pow_int(');
    // the symmetric zero-guard diagnostic text.
    expect(code).toContain('KERN Decimal division by zero');
    // the body lowering itself calls the helper.
    expect(code).toContain('__k_decimal_div(new Decimal("10"), new Decimal("3"))');
    // the helper DEFINITION must precede its CALL in the body.
    expect(code.indexOf('function __k_decimal_div(')).toBeLessThan(code.indexOf('__k_decimal_div(new Decimal("10")'));
  });

  test('the guarded helpers appear exactly ONCE per file (no duplication)', () => {
    const code = compile(DECIMAL_DIV_MODULE, 'lib');
    expect(code.match(/function __k_decimal_div\(/g)?.length).toBe(1);
    expect(code.match(/function __k_decimal_pow_int\(/g)?.length).toBe(1);
  });
});

describe('Decimal Slice 3 — the guarded helpers render end-to-end (Python leg)', () => {
  test('the same Decimal.div handler on the Python (fastapi) target renders the guarded ops helper', () => {
    const fastapiSrc = [
      'server name=Calc',
      '  route method=GET path="/ratio"',
      '    handler lang="kern"',
      '      let name=q value="Decimal.div(Decimal.of(\\"10\\"), Decimal.of(\\"3\\"))"',
      '      return value=q',
    ].join('\n');
    const result = compileResult(fastapiSrc, 'fastapi');
    const allPy = [result.code, ...(result.artifacts ?? []).map((a) => a.content)].join('\n');
    // the guarded ops helper block (def + the byte-identical KERN zero diagnostic).
    expect(allPy).toContain('def __k_decimal_div(');
    expect(allPy).toContain("raise Exception('KERN Decimal division by zero')");
    // the decimal import + the body call.
    expect(/\bimport decimal\b/.test(allPy)).toBe(true);
    expect(allPy).toContain('__k_decimal_div(__k_decimal.Decimal("10"), __k_decimal.Decimal("3"))');
    // the helper DEFINITION must precede its CALL (Python defines before use).
    expect(allPy.indexOf('def __k_decimal_div(')).toBeLessThan(
      allPy.indexOf('__k_decimal_div(__k_decimal.Decimal("10")'),
    );
    // the TS-only decimal.js import + Decimal.set(...) must NOT leak into Python.
    expect(allPy).not.toContain('decimal.js');
    expect(allPy).not.toContain('Decimal.set(');
  });
});

describe('Decimal Slice 2 — Python twin renders its runtime import end-to-end (Finding 1)', () => {
  test('the same Decimal handler on the Python (fastapi) target renders import decimal', () => {
    // The Python leg injects `import decimal as __k_decimal` inline in the function
    // body (legal in Python, idempotent). FastAPI is the Python target whose route
    // handlers render `lang="kern"` bodies end-to-end; the handler lives in a route
    // ARTIFACT (`routes/get_total.py`), so we inspect the artifacts, not just `.code`.
    const fastapiSrc = [
      'server name=Billing',
      '  route method=GET path="/total"',
      '    handler lang="kern"',
      '      let name=base value="Decimal.of(\\"1.5\\")"',
      '      let name=total value="Decimal.add(base, Decimal.of(\\"2.5\\"))"',
      '      return value=total',
    ].join('\n');
    const result = compileResult(fastapiSrc, 'fastapi');
    const allPy = [result.code, ...(result.artifacts ?? []).map((a) => a.content)].join('\n');
    // The Python leg surfaces the decimal import (inline `import decimal as __k_decimal`).
    expect(/\bimport decimal\b/.test(allPy)).toBe(true);
    // And the Python lowering of the body.
    expect(allPy).toContain('__k_decimal.Decimal("1.5")');
    // The TS-only `decimal.js` import + `Decimal.set(...)` preamble must NOT leak into Python output.
    expect(allPy).not.toContain('decimal.js');
    expect(allPy).not.toContain('Decimal.set(');
  });
});
