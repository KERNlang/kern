/** Block-bodied arrow capture + v1 closure gate (slices 0+1, commit A).
 *
 *  Covers: parser accept/reject for block-bodied arrows, byte-stable TS
 *  round-trip, quote-aware lexer capture, `classifyClosureBlock` reject
 *  reasons, and the commit-A eligibility guard (`closure-stmt-body`) that
 *  keeps migrator eligibility unchanged. */

import { classifyClosureBlock, parseClosureBlockAst } from '../src/closure-eligibility.js';
import { emitExpression } from '../src/codegen-expression.js';
import { classifyHandlerBodyAst } from '../src/native-eligibility-ast.js';
import { parseExpression } from '../src/parser-expression.js';

describe('parseExpression — block-bodied arrow capture', () => {
  test('accepts let/const + return, storing the raw block verbatim', () => {
    const ir = parseExpression('(x) => { const y = x * 2; return y; }') as Extract<
      ReturnType<typeof parseExpression>,
      { kind: 'lambda' }
    >;
    expect(ir.kind).toBe('lambda');
    expect(ir.bodyBlock).toEqual({ raw: '{ const y = x * 2; return y; }' });
    expect(ir.body).toBeFalsy();
  });

  test('accepts if/else with block and single-statement branches', () => {
    const ir = parseExpression('(x) => { if (x > 2) { return 1 } return 0 }') as Extract<
      ReturnType<typeof parseExpression>,
      { kind: 'lambda' }
    >;
    expect(ir.kind).toBe('lambda');
    expect(ir.bodyBlock).toEqual({ raw: '{ if (x > 2) { return 1 } return 0 }' });
  });

  test('accepts single-ident param form (no parens) with a block body', () => {
    const ir = parseExpression('x => { return x + 1; }') as Extract<
      ReturnType<typeof parseExpression>,
      { kind: 'lambda' }
    >;
    expect(ir.kind).toBe('lambda');
    expect(ir.bodyBlock).toEqual({ raw: '{ return x + 1; }' });
  });

  test('THROWS on `this` inside a block', () => {
    expect(() => parseExpression('(x) => { this.y = 1; return x; }')).toThrow(/closure-this/);
  });

  test('THROWS on free-variable write (`count++`)', () => {
    expect(() => parseExpression('(x) => { count++; return count; }')).toThrow(/closure-free-var-assign/);
  });

  test('THROWS on a `for` loop inside the block', () => {
    expect(() => parseExpression('(x) => { for (const a of x) { y(a); } return x; }')).toThrow(/closure-loop/);
  });

  test('THROWS on destructuring declaration', () => {
    expect(() => parseExpression('(x) => { const {a} = x; return a; }')).toThrow(/closure-destructure/);
  });

  test('THROWS on `await` inside the block', () => {
    expect(() => parseExpression('(x) => { await f(); return 1; }')).toThrow(/closure-await/);
  });

  test('THROWS on a nested arrow', () => {
    expect(() => parseExpression('(x) => { const g = (y) => y; return g(x) }')).toThrow(/closure-nested-function/);
  });
});

describe('block-bodied arrow — quote-aware lexer capture', () => {
  test('captures braces inside string literals and templates correctly', () => {
    const src = '(x) => { const s = "a}b"; const t = `v: ${x}`; return s; }';
    const ir = parseExpression(src) as Extract<ReturnType<typeof parseExpression>, { kind: 'lambda' }>;
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
      expect(emitExpression(parseExpression(src))).toBe(src);
    }
  });
});

describe('classifyClosureBlock — accept set + reject reasons', () => {
  test('accepts the v1 statement shapes (null reason)', () => {
    expect(classifyClosureBlock('{ const y = 1; return y; }')).toBeNull();
    expect(classifyClosureBlock('{ return; }')).toBeNull();
    expect(classifyClosureBlock('{ foo(); return 1; }')).toBeNull();
    expect(classifyClosureBlock('{ if (c) { return 1 } else return 0 }')).toBeNull();
    // Method-call mutation on a captured object is allowed (the v1 mutation
    // story). Assignment EXPRESSIONS — even to closure-locals — are NOT (see
    // the assignment-free v1 rejections below; agon-review codex finding).
    expect(classifyClosureBlock('{ acc.push(x); return acc.length; }')).toBeNull();
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
    expect(classifyClosureBlock('{ count = count + 1; return count; }')).toBe('closure-free-var-assign');
    expect(classifyClosureBlock('{ count++; return count; }')).toBe('closure-free-var-assign');
    // Non-bare assignment targets (agon review, agy blocking finding) — a
    // destructuring assignment or parenthesized target could smuggle a
    // free-variable write past the bare-identifier check. Fail closed.
    expect(classifyClosureBlock('{ ({ a: outer } = x); return 1; }')).toBe('closure-unsupported-assign-target');
    expect(classifyClosureBlock('{ [outer] = x; return 1; }')).toBe('closure-unsupported-assign-target');
    expect(classifyClosureBlock('{ (outer) = x; return 1; }')).toBe('closure-unsupported-assign-target');
    // v1 is ASSIGNMENT-FREE inside closures (agon review, codex gate/lowerer
    // drift finding): the class-path lowering routes expression statements
    // through parseExpression, which has no assignment grammar — a
    // gate-approved assignment would be an eligible-handler compile error.
    // Local and member targets reject with precise not-yet-supported reasons.
    expect(classifyClosureBlock('{ let x = 1; x = x + 1; return x; }')).toBe('closure-local-assign');
    expect(classifyClosureBlock('{ let x = 1; x++; return x; }')).toBe('closure-local-assign');
    expect(classifyClosureBlock('{ acc.total = 1; return 1; }')).toBe('closure-member-assign');
    expect(classifyClosureBlock('{ acc[0] = 1; return 1; }')).toBe('closure-member-assign');
    expect(classifyClosureBlock('{ acc.n++; return 1; }')).toBe('closure-member-assign');
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

  test('a gate-passing block arrow INSIDE a loop is rejected with closure-in-loop', () => {
    const body =
      'const out = [];\nfor (const n of xs) {\n  const f = (x) => { return x + n; };\n  out.push(f(n));\n}\nreturn out;';
    const result = classifyHandlerBodyAst(body);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('closure-in-loop');
  });
});
