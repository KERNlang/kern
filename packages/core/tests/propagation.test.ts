/** Slice 7 — `?` and `!` propagation operators tests.
 *
 *  Validator + rewriter at packages/core/src/parser-validate-propagation.ts. */

import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { rewritePropagationInBody } from '../src/parser-validate-propagation.js';

interface DiagSink {
  diagnostics: { code: string; message: string }[];
}

function freshSink(): DiagSink {
  return { diagnostics: [] };
}

function rewrite(
  body: string,
  fnReturn: 'result' | 'option' | 'other',
  knownResultFns: string[] = [],
  knownOptionFns: string[] = [],
): { code: string; usedUnwrap: boolean; diagnostics: DiagSink['diagnostics'] } {
  const sink = freshSink();
  const out = rewritePropagationInBody(
    body,
    fnReturn,
    {
      resultFns: new Set(knownResultFns),
      optionFns: new Set(knownOptionFns),
    },
    (code, message) => sink.diagnostics.push({ code, message }),
  );
  return { code: out.code, usedUnwrap: out.usedUnwrap, diagnostics: sink.diagnostics };
}

describe('rewritePropagationInBody — basic recognition', () => {
  test('rewrites `Result.ok(x)?` inside a Result-returning fn', () => {
    const out = rewrite('const u = Result.ok({ id: 1 })?;', 'result');
    expect(out.diagnostics).toEqual([]);
    expect(out.code).toContain("if (__k_t1.kind === 'err') return __k_t1");
    expect(out.code).toContain('return __k_t1.value');
  });

  test('rewrites `Option.some(x)?` inside an Option-returning fn', () => {
    const out = rewrite('const u = Option.some(1)?;', 'option');
    expect(out.diagnostics).toEqual([]);
    expect(out.code).toContain('if (__k_t');
    expect(out.code).toContain("'none'");
  });

  test('rewrites `parseUser(raw)?` when parseUser is in resultFns', () => {
    const out = rewrite('const u = parseUser(raw)?;', 'result', ['parseUser']);
    expect(out.diagnostics).toEqual([]);
    expect(out.code).toContain('if (__k_t');
    expect(out.code).toContain('parseUser(raw)');
  });

  test('does NOT rewrite `obj.prop!` (TS non-null assertion)', () => {
    // The schema example `closeSync(this.fd!)` must pass through unchanged
    // — it is not a call to a known Result-returning function.
    const out = rewrite('closeSync(this.fd!);', 'other');
    expect(out.code).toBe('closeSync(this.fd!);');
    expect(out.diagnostics).toEqual([]);
  });

  test('does NOT rewrite a call to an unknown identifier', () => {
    const out = rewrite('const u = unknownFn(raw)?;', 'result');
    expect(out.code).toBe('const u = unknownFn(raw)?;');
    expect(out.diagnostics).toEqual([]);
  });

  test('rewrites `!` and flips usedUnwrap', () => {
    const out = rewrite('const u = parseUser(raw)!;', 'other', ['parseUser']);
    expect(out.usedUnwrap).toBe(true);
    expect(out.code).toContain('throw new KernUnwrapError');
  });
});

describe('rewritePropagationInBody — diagnostics', () => {
  test('INVALID_PROPAGATION when `?` is in a non-Result/Option fn', () => {
    const out = rewrite('return parseUser(raw)?;', 'other', ['parseUser']);
    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics[0].code).toBe('INVALID_PROPAGATION');
    expect(out.diagnostics[0].message).toMatch(/Result.*Option/);
  });

  test('UNSAFE_UNWRAP_IN_RESULT_FN warns when `!` is inside a Result fn', () => {
    const out = rewrite('const u = parseUser(raw)!;', 'result', ['parseUser']);
    expect(out.diagnostics.some((d) => d.code === 'UNSAFE_UNWRAP_IN_RESULT_FN')).toBe(true);
    // Still rewrites (warning, not error)
    expect(out.code).toContain('throw new KernUnwrapError');
  });

  test('NESTED_PROPAGATION rejects `expr??`', () => {
    const out = rewrite('const u = parseUser(raw)??;', 'result', ['parseUser']);
    expect(out.diagnostics.some((d) => d.code === 'NESTED_PROPAGATION')).toBe(true);
  });

  test('INVALID_PROPAGATION when `?` is inside a nested arrow closure', () => {
    // `array.map(x => parseUser(x)?)` — the `?` is inside the arrow body.
    // Its early-return would belong to the arrow, not the outer fn.
    const out = rewrite('const xs = arr.map(x => parseUser(x)?);', 'result', ['parseUser']);
    expect(out.diagnostics.some((d) => d.code === 'INVALID_PROPAGATION')).toBe(true);
    expect(out.diagnostics[0].message).toMatch(/nested closure/);
  });
});

describe('rewritePropagationInBody — comment / string preservation', () => {
  test('does not rewrite `?` inside a string literal', () => {
    const body = 'const s = "parseUser(raw)?";';
    const out = rewrite(body, 'result', ['parseUser']);
    expect(out.code).toBe(body);
    expect(out.diagnostics).toEqual([]);
  });

  test('does not rewrite `?` inside a line comment', () => {
    const body = '// parseUser(raw)?\nconst x = 1;';
    const out = rewrite(body, 'result', ['parseUser']);
    expect(out.code).toBe(body);
  });

  test('does not rewrite `?` inside a block comment', () => {
    const body = '/* parseUser(raw)? */\nconst x = 1;';
    const out = rewrite(body, 'result', ['parseUser']);
    expect(out.code).toBe(body);
  });
});

describe('parseDocumentWithDiagnostics — propagation pipeline', () => {
  // End-to-end through the actual parser. Confirms that:
  //   1. The propagation pass walks the IR and rewrites handler bodies.
  //   2. Diagnostics flow back through the standard ParseDiagnostic stream.
  //   3. The known-fn set is built correctly from the IR (parseUser is
  //      auto-recognised because its `returns` is "Result<…>").

  function diagsFor(src: string) {
    return parseDocumentWithDiagnostics(src).diagnostics.filter(
      (d) =>
        d.code === 'INVALID_PROPAGATION' || d.code === 'NESTED_PROPAGATION' || d.code === 'UNSAFE_UNWRAP_IN_RESULT_FN',
    );
  }

  test('parseUser(raw)? in a Result-returning fn passes', () => {
    const src = [
      'fn name=loud params="raw:string" returns="Result<string, AppError>"',
      '  handler <<<',
      '    const u = parseUser(raw)?;',
      '    return Result.ok(u.toUpperCase());',
      '  >>>',
      'fn name=parseUser params="raw:string" returns="Result<string, AppError>"',
      '  handler <<<',
      '    return Result.ok(raw);',
      '  >>>',
    ].join('\n');
    expect(diagsFor(src)).toEqual([]);
  });

  test('parseUser(raw)? in a non-Result fn surfaces INVALID_PROPAGATION', () => {
    const src = [
      'fn name=loud params="raw:string" returns=string',
      '  handler <<<',
      '    const u = parseUser(raw)?;',
      '    return u;',
      '  >>>',
      'fn name=parseUser params="raw:string" returns="Result<string, AppError>"',
      '  handler <<<',
      '    return Result.ok(raw);',
      '  >>>',
    ].join('\n');
    const diags = diagsFor(src);
    expect(diags.some((d) => d.code === 'INVALID_PROPAGATION')).toBe(true);
  });

  test('this.fd! in handler body is preserved (no false positive on TS non-null)', () => {
    const src = [
      'class name=Recorder',
      '  field name=fd type="number | null" private=true',
      '  method name=close returns=void',
      '    handler <<<',
      '      closeSync(this.fd!);',
      '    >>>',
    ].join('\n');
    const result = parseDocumentWithDiagnostics(src);
    expect(diagsFor(src)).toEqual([]);
    // The handler body should still contain the literal `this.fd!`.
    const root = result.root;
    function findHandler(node: typeof root): string | null {
      if (node.type === 'handler' && typeof node.props?.code === 'string') {
        return node.props.code as string;
      }
      for (const c of node.children || []) {
        const found = findHandler(c);
        if (found) return found;
      }
      return null;
    }
    const code = findHandler(root);
    expect(code).toContain('this.fd!');
  });
});
