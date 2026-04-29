/** Slice 4 — `union kind=result|option` validator tests.
 *
 *  Spec: docs/language/result-option-spec.md.
 *  Validator: packages/core/src/parser-validate-union-kind.ts. */

import { generateCoreNode } from '../src/codegen-core.js';
import { parse, parseDocumentWithDiagnostics } from '../src/parser.js';

function diagnosticsFor(src: string) {
  return parseDocumentWithDiagnostics(src).diagnostics;
}

function kindErrors(src: string) {
  return diagnosticsFor(src).filter((d) => d.code === 'INVALID_UNION_KIND' || d.code === 'KIND_SHAPE_VIOLATION');
}

function unionDoc(lines: string[]): string {
  // Slice 4 unions still need a discriminant per the schema (no required-prop
  // check is being relaxed — `kind` is purely additive). Use `kind` as the
  // discriminant to match the spec example.
  return lines.join('\n');
}

describe('union kind — slice 4 validator', () => {
  // ── Happy path: shapes that match the spec pass ──────────────────

  test('kind=result with ok/err variants passes', () => {
    expect(
      kindErrors(
        unionDoc([
          'union name=ParseResult discriminant=kind kind=result',
          '  variant name=ok',
          '    field name=value type=User',
          '  variant name=err',
          '    field name=error type=ParseError',
        ]),
      ),
    ).toEqual([]);
  });

  test('kind=result with err/ok (reverse order) passes', () => {
    expect(
      kindErrors(
        unionDoc([
          'union name=ParseResult discriminant=kind kind=result',
          '  variant name=err',
          '    field name=error type=ParseError',
          '  variant name=ok',
          '    field name=value type=User',
        ]),
      ),
    ).toEqual([]);
  });

  test('kind=option with some/none variants passes', () => {
    expect(
      kindErrors(
        unionDoc([
          'union name=MaybeUser discriminant=kind kind=option',
          '  variant name=some',
          '    field name=value type=User',
          '  variant name=none',
        ]),
      ),
    ).toEqual([]);
  });

  test('omitted kind keeps slice 3 behaviour (regular DU)', () => {
    expect(
      kindErrors(
        unionDoc([
          'union name=Shape discriminant=kind',
          '  variant name=circle',
          '    field name=radius type=number',
          '  variant name=square',
          '    field name=side type=number',
        ]),
      ),
    ).toEqual([]);
  });

  test('regular DU with three variants still passes (kind opts in only)', () => {
    expect(
      kindErrors(
        unionDoc([
          'union name=Shape discriminant=kind',
          '  variant name=circle',
          '    field name=radius type=number',
          '  variant name=square',
          '    field name=side type=number',
          '  variant name=triangle',
          '    field name=base type=number',
        ]),
      ),
    ).toEqual([]);
  });

  // ── INVALID_UNION_KIND — unrecognised kind values ────────────────

  test('rejects kind=foo', () => {
    const diags = kindErrors(
      unionDoc(['union name=Bad discriminant=kind kind=foo', '  variant name=a', '  variant name=b']),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('INVALID_UNION_KIND');
    expect(diags[0].message).toMatch(/kind=foo/);
  });

  test('rejects kind=data — `data` is the implicit default and is not a literal value', () => {
    const diags = kindErrors(
      unionDoc(['union name=Bad discriminant=kind kind=data', '  variant name=a', '  variant name=b']),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('INVALID_UNION_KIND');
  });

  test('rejects empty kind value', () => {
    const diags = kindErrors(
      unionDoc(['union name=Bad discriminant=kind kind=""', '  variant name=a', '  variant name=b']),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('INVALID_UNION_KIND');
  });

  test('rejects expression-form kind={{ ... }}', () => {
    const diags = kindErrors(
      unionDoc(['union name=Bad discriminant=kind kind={{ "result" }}', '  variant name=ok', '  variant name=err']),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('INVALID_UNION_KIND');
  });

  // ── KIND_SHAPE_VIOLATION — wrong variant set ─────────────────────

  test('kind=result rejects wrong variant names', () => {
    const diags = kindErrors(
      unionDoc([
        'union name=Bad discriminant=kind kind=result',
        '  variant name=success',
        '    field name=value type=User',
        '  variant name=failure',
        '    field name=error type=ParseError',
      ]),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('KIND_SHAPE_VIOLATION');
    expect(diags[0].message).toMatch(/ok \/ err/);
    expect(diags[0].message).toMatch(/success, failure/);
  });

  test('kind=result rejects extra variant', () => {
    const diags = kindErrors(
      unionDoc([
        'union name=Bad discriminant=kind kind=result',
        '  variant name=ok',
        '    field name=value type=User',
        '  variant name=err',
        '    field name=error type=ParseError',
        '  variant name=loading',
      ]),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('KIND_SHAPE_VIOLATION');
  });

  test('kind=result rejects missing err variant', () => {
    const diags = kindErrors(
      unionDoc(['union name=Bad discriminant=kind kind=result', '  variant name=ok', '    field name=value type=User']),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('KIND_SHAPE_VIOLATION');
  });

  test('kind=option rejects wrong variant names (ok/err shape used)', () => {
    const diags = kindErrors(
      unionDoc(['union name=Bad discriminant=kind kind=option', '  variant name=ok', '  variant name=err']),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('KIND_SHAPE_VIOLATION');
    expect(diags[0].message).toMatch(/some \/ none/);
  });

  test('kind=option rejects missing none variant', () => {
    const diags = kindErrors(
      unionDoc([
        'union name=Bad discriminant=kind kind=option',
        '  variant name=some',
        '    field name=value type=User',
      ]),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('KIND_SHAPE_VIOLATION');
  });

  // ── Diagnostic locations point at the union node ─────────────────

  test('diagnostic is anchored at the union line, not a variant', () => {
    const diags = kindErrors(
      unionDoc([
        '',
        'union name=Bad discriminant=kind kind=result',
        '  variant name=success',
        '  variant name=failure',
      ]),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(2);
  });

  // ── KIND_SHAPE_VIOLATION — discriminant must be `kind` ────────────

  test('kind=result rejects MISSING discriminant (codegen would default to `type`)', () => {
    // Gemini review fix: prior validator only checked "if discriminant is
    // present, it must be kind". A missing discriminant let codegen's
    // default (`'type'`) silently emit `{ type: 'ok'; … }`, breaking the
    // slice 7 contract.
    const diags = kindErrors(unionDoc(['union name=R kind=result', '  variant name=ok', '  variant name=err']));
    expect(diags.some((d) => d.code === 'KIND_SHAPE_VIOLATION' && /discriminant=kind/.test(d.message))).toBe(true);
  });

  test('kind=result rejects duplicate variant names ([ok, ok])', () => {
    // Gemini review fix: prior `every(n => required.has(n))` allowed
    // [ok, ok] because both are in the required set and length matched.
    // Set comparison is the correct check.
    const diags = kindErrors(
      unionDoc([
        'union name=R discriminant=kind kind=result',
        '  variant name=ok',
        '    field name=value type=A',
        '  variant name=ok',
        '    field name=value type=B',
      ]),
    );
    expect(diags.some((d) => d.code === 'KIND_SHAPE_VIOLATION')).toBe(true);
  });

  test('kind=option rejects duplicate variant names ([some, some])', () => {
    const diags = kindErrors(
      unionDoc(['union name=O discriminant=kind kind=option', '  variant name=some', '  variant name=some']),
    );
    expect(diags.some((d) => d.code === 'KIND_SHAPE_VIOLATION')).toBe(true);
  });

  test('kind=result rejects discriminant=tag', () => {
    const diags = kindErrors(
      unionDoc([
        'union name=R discriminant=tag kind=result',
        '  variant name=ok',
        '    field name=value type=User',
        '  variant name=err',
        '    field name=error type=Err',
      ]),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('KIND_SHAPE_VIOLATION');
    expect(diags[0].message).toMatch(/discriminant=kind/);
    expect(diags[0].message).toMatch(/discriminant=tag/);
  });

  test('kind=option rejects discriminant=type', () => {
    const diags = kindErrors(
      unionDoc([
        'union name=O discriminant=type kind=option',
        '  variant name=some',
        '    field name=value type=User',
        '  variant name=none',
      ]),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('KIND_SHAPE_VIOLATION');
  });
});

describe('union kind — slice 4 codegen', () => {
  // The TS emit shape is the load-bearing contract for slice 7's `?` / `!`
  // operators (they desugar to `r.kind === 'err' ? return r : r.value`). If
  // the emit ever drifts from { kind: 'ok'; value: T } / { kind: 'err'; error: E },
  // the operator lowering breaks silently — pin the shape with snapshot tests.

  function gen(src: string): string {
    return generateCoreNode(parse(src)).join('\n');
  }

  test('kind=result emits the spec`d discriminated union shape', () => {
    const out = gen(
      [
        'union name=ParseUserResult discriminant=kind kind=result export=true',
        '  variant name=ok',
        '    field name=value type=User',
        '  variant name=err',
        '    field name=error type=ParseError',
      ].join('\n'),
    );
    expect(out).toContain("| { kind: 'ok'; value: User }");
    expect(out).toContain("| { kind: 'err'; error: ParseError };");
    expect(out).toContain('export type ParseUserResult');
  });

  test('kind=option emits the spec`d discriminated union shape', () => {
    const out = gen(
      [
        'union name=MaybeUser discriminant=kind kind=option export=true',
        '  variant name=some',
        '    field name=value type=User',
        '  variant name=none',
      ].join('\n'),
    );
    expect(out).toContain("| { kind: 'some'; value: User }");
    expect(out).toContain("| { kind: 'none' };");
  });

  test('kind=result emits the same shape as a regular union with discriminant=kind', () => {
    // Slice 4 codegen invariant: the `kind` prop is a hint to slice 7 and
    // future Python optimisation, NOT a TS-level emit difference. A regular
    // union with the same shape must produce byte-identical output (modulo
    // the surrounding doc context).
    const withKind = gen(
      [
        'union name=R discriminant=kind kind=result',
        '  variant name=ok',
        '    field name=value type=User',
        '  variant name=err',
        '    field name=error type=Err',
      ].join('\n'),
    );
    const withoutKind = gen(
      [
        'union name=R discriminant=kind',
        '  variant name=ok',
        '    field name=value type=User',
        '  variant name=err',
        '    field name=error type=Err',
      ].join('\n'),
    );
    expect(withKind).toBe(withoutKind);
  });
});
