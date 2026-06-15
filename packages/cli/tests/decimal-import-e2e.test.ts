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
    expect(code).toContain('Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });');
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

  test('every TS-family target renders the import (mcp / express / terminal share the seam)', () => {
    for (const target of ['lib', 'express', 'terminal'] as KernTarget[]) {
      const code = compile(DECIMAL_MODULE, target);
      expect(code).toContain("import Decimal from 'decimal.js';");
      expect(code).toContain('Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });');
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
