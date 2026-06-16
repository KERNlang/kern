/** Block-bodied arrow capture + v1 closure gate (slices 0+1, commit A).
 *
 *  Covers: parser accept/reject for block-bodied arrows, byte-stable TS
 *  round-trip, quote-aware lexer capture, `classifyClosureBlock` reject
 *  reasons, and the commit-A eligibility guard (`closure-stmt-body`) that
 *  keeps migrator eligibility unchanged. */

import { classifyClosureBlock, collectFreeIdentifierNames, parseClosureBlockAst } from '../src/closure-eligibility.js';
import { emitExpression } from '../src/codegen-expression.js';
import { classifyHandlerBodyAst } from '../src/native-eligibility-ast.js';
import { parseExpression } from '../src/parser-expression.js';
import { typescriptClosureClassifier } from '../src/typescript-closure-classifier.js';

// Slice 0.9 — block-bodied arrows require an injected closure classifier; these
// tests exercise the full TypeScript-backed behavior, so they inject the adapter.
const parseExpr = (input: string): ReturnType<typeof parseExpression> =>
  parseExpression(input, { closureClassifier: typescriptClosureClassifier });

describe('parseExpression — block-bodied arrow capture', () => {
  test('accepts let/const + return, storing the raw block verbatim', () => {
    const ir = parseExpr('(x) => { const y = x * 2; return y; }') as Extract<
      ReturnType<typeof parseExpression>,
      { kind: 'lambda' }
    >;
    expect(ir.kind).toBe('lambda');
    expect(ir.bodyBlock).toEqual({ raw: '{ const y = x * 2; return y; }' });
    expect(ir.body).toBeFalsy();
  });

  test('accepts if/else with block and single-statement branches', () => {
    const ir = parseExpr('(x) => { if (x > 2) { return 1 } return 0 }') as Extract<
      ReturnType<typeof parseExpression>,
      { kind: 'lambda' }
    >;
    expect(ir.kind).toBe('lambda');
    expect(ir.bodyBlock).toEqual({ raw: '{ if (x > 2) { return 1 } return 0 }' });
  });

  test('accepts single-ident param form (no parens) with a block body', () => {
    const ir = parseExpr('x => { return x + 1; }') as Extract<ReturnType<typeof parseExpression>, { kind: 'lambda' }>;
    expect(ir.kind).toBe('lambda');
    expect(ir.bodyBlock).toEqual({ raw: '{ return x + 1; }' });
  });

  test('THROWS on `this` inside a block', () => {
    expect(() => parseExpr('(x) => { this.y = 1; return x; }')).toThrow(/closure-this/);
  });

  test('ACCEPTS a free-variable write (mutation v1) — `count++` parses', () => {
    // Mutation v1 lifted the assignment reject: a bare free write is accepted at
    // the gate (the Python emitter adds `nonlocal`; TS re-emits verbatim).
    const ir = parseExpr('(x) => { count++; return count; }') as { kind: string; bodyBlock?: { raw: string } };
    expect(ir.kind).toBe('lambda');
    expect(ir.bodyBlock).toEqual({ raw: '{ count++; return count; }' });
  });

  test('THROWS on a `this`-rooted assign target (still closure-this)', () => {
    expect(() => parseExpr('(x) => { this.y = 1; return x; }')).toThrow(/closure-this/);
  });

  test('THROWS on a value-position ++ (`arr.push(x++)`) — closure-incdec-value-position', () => {
    expect(() => parseExpr('(x) => { arr.push(x++); return 0; }')).toThrow(/closure-incdec-value-position/);
  });

  test('THROWS on value-position assignments — closure-assign-value-position (agon review, claude 0.85)', () => {
    // Same drift class as value-position ++: the lowerer can only emit an
    // assignment that is the DIRECT expression of an ExpressionStatement.
    expect(() => parseExpr('(x) => { arr.push(x = 5); return 0; }')).toThrow(/closure-assign-value-position/);
    expect(() => parseExpr('(x) => { const y = (x = 5); return y; }')).toThrow(/closure-assign-value-position/);
    expect(() => parseExpr('(x) => { return (x = 5); }')).toThrow(/closure-assign-value-position/);
    expect(() => parseExpr('(x) => { let a = 0; a = (x = 2); return a; }')).toThrow(/closure-assign-value-position/);
  });

  test('THROWS on an unsupported assignment operator (`x &= 1`) — closure-unsupported-operator', () => {
    expect(() => parseExpr('(x) => { count &= 1; return count; }')).toThrow(/closure-unsupported-operator/);
  });

  test('THROWS on a `for` loop inside the block', () => {
    expect(() => parseExpr('(x) => { for (const a of x) { y(a); } return x; }')).toThrow(/closure-loop/);
  });

  test('THROWS on destructuring declaration', () => {
    expect(() => parseExpr('(x) => { const {a} = x; return a; }')).toThrow(/closure-destructure/);
  });

  test('THROWS on `await` inside the block', () => {
    expect(() => parseExpr('(x) => { await f(); return 1; }')).toThrow(/closure-await/);
  });

  test('THROWS on a nested arrow', () => {
    expect(() => parseExpr('(x) => { const g = (y) => y; return g(x) }')).toThrow(/closure-nested-function/);
  });
});

describe('block-bodied arrow — quote-aware lexer capture', () => {
  test('captures braces inside string literals and templates correctly', () => {
    const src = '(x) => { const s = "a}b"; const t = `v: ${x}`; return s; }';
    const ir = parseExpr(src) as Extract<ReturnType<typeof parseExpression>, { kind: 'lambda' }>;
    expect(ir.bodyBlock).toEqual({ raw: '{ const s = "a}b"; const t = `v: ${x}`; return s; }' });
  });
});

describe('TS re-emit — byte-stable round-trip', () => {
  test('parse → emit reproduces the raw block byte-identically', () => {
    for (const src of [
      '(x) => { const y = x * 2; return y; }',
      '(x) => { if (x > 2) { return 1 } return 0 }',
      'x => { return x + 1; }',
      '(x) => { acc.push(x * 2); return acc.length; }',
      '(x) => { const s = "a}b"; const t = `v: ${x}`; return s; }',
    ]) {
      expect(emitExpression(parseExpr(src))).toBe(src);
    }
  });
});

describe('classifyClosureBlock — accept set + reject reasons', () => {
  test('accepts the v1 statement shapes (null reason)', () => {
    expect(classifyClosureBlock('{ const y = 1; return y; }')).toBeNull();
    expect(classifyClosureBlock('{ return; }')).toBeNull();
    expect(classifyClosureBlock('{ foo(); return 1; }')).toBeNull();
    expect(classifyClosureBlock('{ if (c) { return 1 } else return 0 }')).toBeNull();
    // Method-call mutation on a captured object is allowed (the original v1
    // mutation story).
    expect(classifyClosureBlock('{ acc.push(x); return acc.length; }')).toBeNull();
    // Mutation v1 — bare assignments (local OR free), compound forms, statement-
    // position ++/--, and non-this member/index writes are now ACCEPTED. The
    // gate is a shape classifier; the Python emitter decides pinned-vs-nonlocal.
    expect(classifyClosureBlock('{ count = count + 1; return count; }')).toBeNull();
    expect(classifyClosureBlock('{ count++; return count; }')).toBeNull();
    expect(classifyClosureBlock('{ let x = 1; x = x + 1; return x; }')).toBeNull();
    expect(classifyClosureBlock('{ let x = 1; x++; return x; }')).toBeNull();
    expect(classifyClosureBlock('{ x *= 2; return x; }')).toBeNull();
    expect(classifyClosureBlock('{ x -= 1; return x; }')).toBeNull();
    expect(classifyClosureBlock('{ x /= 2; return x; }')).toBeNull();
    expect(classifyClosureBlock('{ x %= 2; return x; }')).toBeNull();
    expect(classifyClosureBlock('{ acc.total = 1; return 1; }')).toBeNull();
    expect(classifyClosureBlock('{ acc[0] = 1; return 1; }')).toBeNull();
    expect(classifyClosureBlock('{ acc.n++; return 1; }')).toBeNull();
    expect(classifyClosureBlock('{ acc[0] += 5; return 1; }')).toBeNull();
  });

  test('returns a distinct reason for each reject category', () => {
    expect(classifyClosureBlock('{ return this.x; }')).toBe('closure-this');
    expect(classifyClosureBlock('{ const g = (y) => y; return g(1); }')).toBe('closure-nested-function');
    expect(classifyClosureBlock('{ await f(); return 1; }')).toBe('closure-await');
    expect(classifyClosureBlock('{ for (const a of x) { f(a); } return 1; }')).toBe('closure-loop');
    expect(classifyClosureBlock('{ while (c) { f(); } return 1; }')).toBe('closure-loop');
    expect(classifyClosureBlock('{ throw new Error("x"); }')).toBe('closure-throw');
    expect(classifyClosureBlock('{ try { f(); } catch (e) {} return 1; }')).toBe('closure-try');
    expect(classifyClosureBlock('{ switch (x) { default: return 1; } }')).toBe('closure-switch');
    expect(classifyClosureBlock('{ var n = 1; return n; }')).toBe('closure-var');
    expect(classifyClosureBlock('{ const {a} = x; return a; }')).toBe('closure-destructure');
    // A `this`-rooted assign target is first and foremost a `this` usage.
    expect(classifyClosureBlock('{ this.x = 1; return 1; }')).toBe('closure-this');
    // Non-bare assignment targets (a destructuring assignment or parenthesized
    // target could smuggle a free-variable write past the bare-identifier
    // check). Fail closed.
    expect(classifyClosureBlock('{ ({ a: outer } = x); return 1; }')).toBe('closure-unsupported-assign-target');
    expect(classifyClosureBlock('{ [outer] = x; return 1; }')).toBe('closure-unsupported-assign-target');
    expect(classifyClosureBlock('{ (outer) = x; return 1; }')).toBe('closure-unsupported-assign-target');
    // Mutation-v1 NEW reasons: an assignment operator outside {=,+=,-=,*=,/=,%=}
    // and a value-position ++/-- (operand of a larger expression).
    expect(classifyClosureBlock('{ count &= 1; return count; }')).toBe('closure-unsupported-operator');
    expect(classifyClosureBlock('{ count |= 1; return count; }')).toBe('closure-unsupported-operator');
    expect(classifyClosureBlock('{ count <<= 1; return count; }')).toBe('closure-unsupported-operator');
    expect(classifyClosureBlock('{ count **= 2; return count; }')).toBe('closure-unsupported-operator');
    expect(classifyClosureBlock('{ acc.push(x++); return 0; }')).toBe('closure-incdec-value-position');
    expect(classifyClosureBlock('{ const y = x++; return y; }')).toBe('closure-incdec-value-position');
    expect(classifyClosureBlock('{ f(--n); return 0; }')).toBe('closure-incdec-value-position');
    // Method CALLS on captured objects remain the v1 mutation story.
    expect(classifyClosureBlock('{ acc.push(1); return acc.length; }')).toBeNull();
    // Statement outside the accept set (e.g. a labeled statement is caught by
    // the construct walk first; a for-loop by closure-loop). A bare nested
    // block is not in the accept set.
    expect(classifyClosureBlock('{ { return 1; } }')).toBe('closure-unsupported-stmt-Block');
  });

  test('parseClosureBlockAst returns null for non-block / unparseable input', () => {
    expect(parseClosureBlockAst('x + 1')).toBeNull();
    expect(parseClosureBlockAst('{ const = ; }')).toBeNull();
  });
});

describe('commit B — eligibility flip (gate-passing block arrows are eligible)', () => {
  test('a let-bound gate-passing block arrow is now ELIGIBLE', () => {
    const body = 'const scale = (x) => { const y = x * 2; return y; };\nreturn scale(7);';
    const result = classifyHandlerBodyAst(body);
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('ok');
  });

  test('a return-position gate-passing block arrow call is ELIGIBLE', () => {
    const body = 'const f = (x) => { return x + 1; };\nreturn f(2);';
    const result = classifyHandlerBodyAst(body);
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('ok');
  });

  test('a gate-FAILING block arrow keeps the statement ineligible with the gate reason', () => {
    // `this` inside the closure → gate reason surfaces as the statement reason.
    const thisBody = 'const f = (x) => { return this.x + x; };\nreturn f(1);';
    expect(classifyHandlerBodyAst(thisBody)).toEqual({ eligible: false, reason: 'closure-this' });
    // Nested arrow.
    const nestedBody = 'const f = (x) => { const g = (y) => y; return g(x); };\nreturn f(1);';
    expect(classifyHandlerBodyAst(nestedBody)).toEqual({
      eligible: false,
      reason: 'closure-nested-function',
    });
    // Destructuring declaration inside the closure.
    const destrBody = 'const f = (x) => { const {a} = x; return a; };\nreturn f({a:1});';
    expect(classifyHandlerBodyAst(destrBody)).toEqual({ eligible: false, reason: 'closure-destructure' });
  });

  test('a gate-passing block arrow INSIDE a loop is now ELIGIBLE (slice 2 lifted closure-in-loop)', () => {
    // Slice 2: the Python lowerer pins per-iteration captures via default args,
    // so a gate-passing block arrow inside a loop is eligible (was rejected as
    // `closure-in-loop` in slices 0+1). The arrow still funnels through the
    // closure gate; only the loop-context veto was removed.
    const body =
      'const out = [];\nfor (const n of xs) {\n  const f = (x) => { return x + n; };\n  out.push(f(n));\n}\nreturn out;';
    const result = classifyHandlerBodyAst(body);
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('ok');
  });

  test('a GATE-FAILING block arrow inside a loop still rejects with the gate reason', () => {
    // The loop-context lift does NOT relax the closure gate itself — a `this`
    // usage inside a looped closure still rejects with the gate reason, not
    // `ok`.
    const body =
      'const out = [];\nfor (const n of xs) {\n  const f = (x) => { return this.v + x; };\n  out.push(f(n));\n}\nreturn out;';
    const result = classifyHandlerBodyAst(body);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('closure-this');
  });
});

describe('collectFreeIdentifierNames — captured free variables', () => {
  test('returns identifiers referenced but not declared inside the block or in params', () => {
    // `factor` is captured (free); `y` is a block-local; `x` is a param.
    const free = collectFreeIdentifierNames('{ const y = x * factor; return y; }', ['x']);
    expect([...free].sort()).toEqual(['factor']);
  });

  test('member-access reads only the ROOT identifier, never the property name', () => {
    // `acc` is the free root; `length`/`push` are property NAMES (not refs).
    const free = collectFreeIdentifierNames('{ acc.push(x); return acc.length; }', ['x']);
    expect([...free].sort()).toEqual(['acc']);
  });

  test('object-literal KEYS are excluded; shorthand and value refs are kept', () => {
    // `a` is a key (excluded); `b` shorthand IS a read; `v` value IS a read.
    const free = collectFreeIdentifierNames('{ return { a: v, b }; }', []);
    expect([...free].sort()).toEqual(['b', 'v']);
  });

  test('closure params are excluded even when also referenced', () => {
    const free = collectFreeIdentifierNames('{ return x + y; }', ['x', 'y']);
    expect([...free]).toEqual([]);
  });

  test('a block-local that SHADOWS an outer name is not free (declared inside wins)', () => {
    // `x` is re-declared inside, so the reference resolves to the inner local,
    // not the outer capture — `x` is NOT free. `seed` IS free (its initializer).
    const free = collectFreeIdentifierNames('{ const x = seed; return x; }', []);
    expect([...free].sort()).toEqual(['seed']);
  });

  test('nested if-branch declarations are excluded from the free set', () => {
    const free = collectFreeIdentifierNames('{ if (cond) { const t = base; return t; } return base; }', []);
    expect([...free].sort()).toEqual(['base', 'cond']);
  });
});
