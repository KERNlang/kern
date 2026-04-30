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
    expect(out.code).toContain('const u = __k_t1.value;');
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

describe('rewritePropagationInBody — runtime semantics', () => {
  // Compile + execute the rewritten body and assert outer-fn return values.
  // Caught the IIFE-doesn't-propagate bug — a string-presence assertion
  // alone is insufficient.

  function execBody(
    body: string,
    fnReturn: 'result' | 'option' | 'other',
    knownResultFns: string[] = [],
    knownOptionFns: string[] = [],
    ctx: Record<string, unknown> = {},
  ): { returned: unknown; threw: unknown | null; rewritten: string; diagnostics: DiagSink['diagnostics'] } {
    const out = rewrite(body, fnReturn, knownResultFns, knownOptionFns);
    const argNames = Object.keys(ctx);
    const argValues = argNames.map((n) => ctx[n]);
    // Wrap the rewritten body in an outer fn with a sentinel trailing return.
    // If propagation works, the outer fn returns the err/none Result early
    // (via the body's `return __k_tN;`). Otherwise it falls through to the
    // sentinel, exposing the bug.
    const wrapped = `${out.code}\n; return { __sentinel: true };`;
    let returned: unknown;
    let threw: unknown | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(...argNames, wrapped);
      returned = fn(...argValues);
    } catch (e) {
      threw = e;
    }
    return { returned, threw, rewritten: out.code, diagnostics: out.diagnostics };
  }

  test('?: outer fn returns the err Result when callee returns err', () => {
    const errResult = { kind: 'err', error: 'bad' };
    const r = execBody('const u = parse(x)?;', 'result', ['parse'], [], {
      parse: () => errResult,
      x: 1,
    });
    expect(r.threw).toBeNull();
    // Critical: outer must return the err Result early, NOT the sentinel.
    expect(r.returned).toEqual(errResult);
  });

  test('?: outer fn continues past the propagation when callee returns ok', () => {
    const r = execBody('const u = parse(x)?;\nreturn { ok: true, u };', 'result', ['parse'], [], {
      parse: () => ({ kind: 'ok', value: 42 }),
      x: 1,
    });
    expect(r.threw).toBeNull();
    expect(r.returned).toEqual({ ok: true, u: 42 });
  });

  test('?: works as a `return` statement (return parse(x)?)', () => {
    const okR = execBody('return parse(x)?;', 'result', ['parse'], [], {
      parse: () => ({ kind: 'ok', value: 'hello' }),
      x: 1,
    });
    expect(okR.threw).toBeNull();
    expect(okR.returned).toBe('hello');

    const errResult = { kind: 'err', error: 'bad' };
    const errR = execBody('return parse(x)?;', 'result', ['parse'], [], {
      parse: () => errResult,
      x: 1,
    });
    expect(errR.threw).toBeNull();
    expect(errR.returned).toEqual(errResult);
  });

  test('?: works as an expression statement (parse(x)?;)', () => {
    const errResult = { kind: 'err', error: 'discard' };
    const r = execBody('parse(x)?;\nreturn "completed";', 'result', ['parse'], [], {
      parse: () => errResult,
      x: 1,
    });
    expect(r.threw).toBeNull();
    expect(r.returned).toEqual(errResult);
  });

  test("?: Option callee uses kind==='none' for early return", () => {
    const noneResult = { kind: 'none' };
    const r = execBody('const u = lookup(x)?;', 'option', [], ['lookup'], {
      lookup: () => noneResult,
      x: 'k',
    });
    expect(r.threw).toBeNull();
    expect(r.returned).toEqual(noneResult);
  });

  test('!: throws KernUnwrapError when callee returns err', () => {
    const errResult = { kind: 'err', error: 'panic' };
    const r = execBody('const u = parse(x)!;', 'other', ['parse'], [], {
      parse: () => errResult,
      x: 1,
      KernUnwrapError: class KernUnwrapError extends Error {
        constructor(public cause: unknown) {
          super('kern unwrap');
        }
      },
    });
    expect(r.returned).toBeUndefined();
    expect(r.threw).toBeInstanceOf(Error);
    expect((r.threw as { cause: unknown }).cause).toEqual(errResult);
  });

  test('!: passes through the value when callee returns ok', () => {
    const r = execBody('const u = parse(x)!;\nreturn u;', 'other', ['parse'], [], {
      parse: () => ({ kind: 'ok', value: 99 }),
      x: 1,
      KernUnwrapError: class KernUnwrapError extends Error {
        constructor(public cause: unknown) {
          super('kern unwrap');
        }
      },
    });
    expect(r.threw).toBeNull();
    expect(r.returned).toBe(99);
  });
});

describe('rewritePropagationInBody — recognition negatives', () => {
  // These cases must NOT be rewritten. They are valid TypeScript that happen
  // to look propagation-shaped to a naive scanner.

  test('does not rewrite TS optional chaining `parse(x)?.foo`', () => {
    const body = 'const u = parse(x)?.foo;';
    const out = rewrite(body, 'result', ['parse']);
    expect(out.code).toBe(body);
  });

  test('does not rewrite `parse(x) !== null`', () => {
    const body = 'const u = parse(x) !== null;';
    const out = rewrite(body, 'result', ['parse']);
    expect(out.code).toBe(body);
  });

  test('does not rewrite `parse(x) != null`', () => {
    const body = 'const u = parse(x) != null;';
    const out = rewrite(body, 'result', ['parse']);
    expect(out.code).toBe(body);
  });

  test('does not rewrite ternary `Result.isOk(r) ? a : b`', () => {
    const body = 'const u = Result.isOk(r) ? r.value : 0;';
    const out = rewrite(body, 'result');
    expect(out.code).toBe(body);
  });

  test('does not rewrite `Result.unwrapOr(null, r)!` (returns plain value, not Result)', () => {
    // unwrapOr is a non-propagating helper — its return is the unwrapped
    // value, not a Result. The trailing `!` is a TS non-null assertion.
    const body = 'const u = Result.unwrapOr(null, r)!;';
    const out = rewrite(body, 'other');
    expect(out.code).toBe(body);
  });

  test('does not rewrite member-access call `this.parse(x)?` (receiver kept)', () => {
    // Until cross-module / receiver-aware recognition lands, member-access
    // calls must pass through verbatim instead of producing invalid
    // `this.(() => …)()`.
    const body = 'const u = this.parse(x)?;';
    const out = rewrite(body, 'result', ['parse']);
    expect(out.code).toBe(body);
  });

  test('rejects `await call()?` with INVALID_PROPAGATION (no await? fusion in v1)', () => {
    const body = 'const u = await fetch(x)?;';
    const out = rewrite(body, 'result', ['fetch']);
    expect(out.diagnostics.some((d) => d.code === 'INVALID_PROPAGATION')).toBe(true);
    // Must not produce a broken IIFE/hoist that checks Promise.kind.
    expect(out.code).not.toContain("__k_t1.kind === 'err'");
  });

  test('rejects mid-expression `foo(parse(x)?)` with INVALID_PROPAGATION', () => {
    const body = 'const u = foo(parse(x)?);';
    const out = rewrite(body, 'result', ['parse']);
    expect(out.diagnostics.some((d) => d.code === 'INVALID_PROPAGATION')).toBe(true);
  });
});

describe('rewritePropagationInBody — failure-kind from callee', () => {
  // The discriminant ('err' vs 'none') must come from the CALLEE's kind, not
  // the enclosing fn's return type. Mixed cases (Option callee inside
  // Result fn) are REJECTED in v1 — no implicit bridge.

  test("Result callee inside Result fn uses kind==='err'", () => {
    const out = rewrite('const u = parse(x)?;', 'result', ['parse']);
    expect(out.diagnostics).toEqual([]);
    expect(out.code).toContain("if (__k_t1.kind === 'err')");
  });

  test("Option callee inside Option fn uses kind==='none'", () => {
    const out = rewrite('const u = lookup(x)?;', 'option', [], ['lookup']);
    expect(out.diagnostics).toEqual([]);
    expect(out.code).toContain("if (__k_t1.kind === 'none')");
  });

  test('rejects Option callee `?` inside a Result-returning fn', () => {
    const out = rewrite('const u = Option.some(v)?;', 'result');
    expect(out.diagnostics.some((d) => d.code === 'INVALID_PROPAGATION')).toBe(true);
    expect(out.diagnostics[0].message).toMatch(/Option.*Result/);
  });

  test('rejects Result callee `?` inside an Option-returning fn', () => {
    const out = rewrite('const u = Result.ok(v)?;', 'option');
    expect(out.diagnostics.some((d) => d.code === 'INVALID_PROPAGATION')).toBe(true);
    expect(out.diagnostics[0].message).toMatch(/Result.*Option/);
  });

  test('`!` on Option callee throws regardless of containing fn', () => {
    const out = rewrite('const u = lookup(x)!;', 'other', [], ['lookup']);
    expect(out.code).toContain("if (__k_t1.kind === 'none')");
    expect(out.code).toContain('throw new KernUnwrapError');
    expect(out.usedUnwrap).toBe(true);
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
