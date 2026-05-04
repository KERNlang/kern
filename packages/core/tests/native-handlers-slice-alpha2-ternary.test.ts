/** Native KERN handler bodies — slice α-2: ternary `a ? b : c` in parser-expression.
 *
 *  Adds a `conditional` ValueIR variant (3-operand) and a parseConditional
 *  layer wrapping parseNullish. Closes the second-largest AST-rejection
 *  bucket in the slice 5b migrator (~12% of agon residual on 2026-05-04).
 *
 *  Disambiguation with propagation `?`: parsePostfix only consumes a postfix
 *  `?` when the next token is NOT an expression-start. So `call()?` (no
 *  trailing expression) stays propagation; `cond ? a : b` (trailing
 *  expression) is ternary. */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression } from '../src/parser-expression.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: Array<{ type: string; props?: Record<string, unknown> }>): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children: children.map((c) => ({ ...c, props: c.props ?? {} })) };
}

describe('parseExpression — ternary (slice α-2)', () => {
  test('basic ternary', () => {
    const ir = parseExpression('a ? b : c');
    expect(ir.kind).toBe('conditional');
    if (ir.kind !== 'conditional') throw new Error('shape');
    expect(ir.test.kind).toBe('ident');
    expect(ir.consequent.kind).toBe('ident');
    expect(ir.alternate.kind).toBe('ident');
  });

  test('right-associative: `a ? b : c ? d : e` parses as `a ? b : (c ? d : e)`', () => {
    const ir = parseExpression('a ? b : c ? d : e');
    expect(ir.kind).toBe('conditional');
    if (ir.kind !== 'conditional') throw new Error('shape');
    expect(ir.alternate.kind).toBe('conditional'); // nested ternary is the alternate
    if (ir.alternate.kind !== 'conditional') throw new Error('shape');
    expect((ir.alternate.test as { name: string }).name).toBe('c');
  });

  test('nested ternary in consequent: `a ? b ? c : d : e`', () => {
    const ir = parseExpression('a ? b ? c : d : e');
    expect(ir.kind).toBe('conditional');
    if (ir.kind !== 'conditional') throw new Error('shape');
    expect(ir.consequent.kind).toBe('conditional'); // nested ternary in consequent
  });

  test('binary ops bind tighter than ternary', () => {
    // `a + b ? c : d` parses as `(a + b) ? c : d`, not `a + (b ? c : d)`
    const ir = parseExpression('a + b ? c : d');
    expect(ir.kind).toBe('conditional');
    if (ir.kind !== 'conditional') throw new Error('shape');
    expect(ir.test.kind).toBe('binary');
  });

  test('propagation `?` survives — `call()?` is still propagate, not ternary', () => {
    const ir = parseExpression('call()?');
    expect(ir.kind).toBe('propagate');
  });

  test('propagation `?` followed by ternary: `(call()?) ? x : y` (paren-required)', () => {
    // Without parens, `call()? ? x : y` is ambiguous. Our rule: `?` followed
    // by an expression-start is ternary, so `call() ? x : y` (no propagate
    // intended) is fine. To get `(propagate) ? x : y` you must paren the
    // propagation explicitly: `(call()?) ? x : y`.
    const ir = parseExpression('(call()?) ? x : y');
    expect(ir.kind).toBe('conditional');
    if (ir.kind !== 'conditional') throw new Error('shape');
    expect(ir.test.kind).toBe('propagate');
  });

  test('ternary inside object-literal value', () => {
    const ir = parseExpression('{ x: a ? b : c }');
    expect(ir.kind).toBe('objectLit');
    if (ir.kind !== 'objectLit') throw new Error('shape');
    const entry = ir.entries[0] as { key: string; value: { kind: string } };
    expect(entry.value.kind).toBe('conditional');
  });

  test('ternary inside array literal', () => {
    const ir = parseExpression('[a ? b : c, d]');
    expect(ir.kind).toBe('arrayLit');
    if (ir.kind !== 'arrayLit') throw new Error('shape');
    expect(ir.items[0].kind).toBe('conditional');
  });

  test('ternary inside call arg', () => {
    const ir = parseExpression('f(a ? b : c)');
    expect(ir.kind).toBe('call');
    if (ir.kind !== 'call') throw new Error('shape');
    expect(ir.args[0].kind).toBe('conditional');
  });
});

describe('emitExpression — ternary TS lowering', () => {
  test('basic ternary round-trips byte-equivalent', () => {
    expect(emitExpression(parseExpression('a ? b : c'))).toBe('a ? b : c');
  });

  test('binary children get parens', () => {
    // `a + b ? c : d` → `(a + b) ? c : d` because the test is a binary node
    expect(emitExpression(parseExpression('a + b ? c : d'))).toBe('(a + b) ? c : d');
  });

  test('right-associative chain re-emits without redundant parens', () => {
    // Right-recursion is the natural shape; nested conditional in alternate
    // gets parens (per needsConditionalChildParens predicate).
    expect(emitExpression(parseExpression('a ? b : c ? d : e'))).toBe('a ? b : (c ? d : e)');
  });

  test('object-literal returns survive ternary inside', () => {
    expect(emitExpression(parseExpression('{ x: a ? b : c }'))).toBe('{ x: a ? b : c }');
  });
});

describe('emitNativeKernBodyTS — ternary in body-statement context', () => {
  test('return value="a ? b : c" lowers to `return a ? b : c;`', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'a ? b : c' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('return a ? b : c;');
  });

  test('let value="cond ? lo : hi" lowers to `const x = cond ? lo : hi;`', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'x', value: 'cond ? lo : hi' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('const x = cond ? lo : hi;');
  });

  test('do value="cond ? doA() : doB()" lowers to side-effect statement', () => {
    const handler = makeHandler([{ type: 'do', props: { value: 'cond ? doA() : doB()' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('cond ? doA() : doB();');
  });
});
