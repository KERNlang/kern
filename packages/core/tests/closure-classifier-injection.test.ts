/** Slice 0.9 — closure-classifier capability injection matrix.
 *
 *  Proves the browser-safe spine cut: the default parser (no classifier) is
 *  dependency-free and fail-closes ONLY on block-bodied arrows, while the
 *  TypeScript-backed adapter — injected explicitly — preserves every existing
 *  closure accept/reject behavior byte-for-byte.
 *
 *  Matrix: {classifier injected, classifier absent}
 *        × {expression-bodied arrow, block-bodied arrow, ordinary expression}.
 *
 *  Binding tribunal amendments exercised here:
 *   - R2: the fail-closed diagnostic is target-agnostic
 *     (`closure-parser-unavailable`, NO typescript/node/browser/deno/bun).
 *   - R4: the full injection matrix.
 */

import { unavailableClosureClassifier } from '../src/closure-classifier.js';
import { hasDirectSuperCtorCall, parse, validateSemantics } from '../src/index.js';
import { parseExpression } from '../src/parser-expression.js';
import { typescriptClosureClassifier } from '../src/typescript-closure-classifier.js';

type Lambda = Extract<ReturnType<typeof parseExpression>, { kind: 'lambda' }>;

const TS = { closureClassifier: typescriptClosureClassifier };

describe('closure-classifier injection matrix', () => {
  describe('classifier ABSENT (default, browser-safe)', () => {
    test('expression-bodied arrow parses without a classifier', () => {
      const ir = parseExpression('x => x + 1') as Lambda;
      expect(ir.kind).toBe('lambda');
      expect(ir.body).toBeTruthy();
      expect(ir.bodyBlock).toBeFalsy();
    });

    test('ordinary expressions parse without a classifier', () => {
      expect(parseExpression('users.map(user => user.name)')).toBeTruthy();
      expect(parseExpression('a ? b : c')).toBeTruthy();
      expect(parseExpression('typeof value === "string"')).toBeTruthy();
    });

    test('block-bodied arrow fails closed with the target-agnostic diagnostic', () => {
      expect(() => parseExpression('(x) => { return x + 1; }')).toThrow(/closure-parser-unavailable/);
    });

    test('explicitly-injected unavailable classifier behaves like the default', () => {
      expect(() =>
        parseExpression('(x) => { return x + 1; }', { closureClassifier: unavailableClosureClassifier }),
      ).toThrow(/closure-parser-unavailable/);
      expect(parseExpression('x => x + 1', { closureClassifier: unavailableClosureClassifier })).toBeTruthy();
    });
  });

  describe('classifier INJECTED (TypeScript adapter, Node/codegen)', () => {
    test('expression-bodied arrow still parses', () => {
      const ir = parseExpression('x => x + 1', TS) as Lambda;
      expect(ir.kind).toBe('lambda');
      expect(ir.body).toBeTruthy();
    });

    test('ordinary expressions still parse', () => {
      expect(parseExpression('a ? b : c', TS)).toBeTruthy();
      expect(parseExpression('typeof value === "string"', TS)).toBeTruthy();
    });

    test('block-bodied arrow is accepted and stores the raw block verbatim', () => {
      const ir = parseExpression('(x) => { const y = x * 2; return y; }', TS) as Lambda;
      expect(ir.kind).toBe('lambda');
      expect(ir.bodyBlock).toEqual({ raw: '{ const y = x * 2; return y; }' });
      expect(ir.body).toBeFalsy();
    });

    test('existing closure reject reasons are unchanged (byte-identical)', () => {
      expect(() => parseExpression('(x) => { this.y = 1; return x; }', TS)).toThrow(/closure-this/);
      expect(() => parseExpression('(x) => { function inner() {} return x; }', TS)).toThrow(/closure-nested-function/);
    });

    test('a block that does not parse as a statement block fails with the unsupported-parse message', () => {
      expect(() => parseExpression('(x) => { return x + }', TS)).toThrow(/does not parse as a statement block/);
    });

    test('block-bodied arrow inside a template interpolation inherits the injected classifier', () => {
      // The `${…}` sub-parser must thread the classifier; without injection
      // propagation this fail-closed even when a classifier was provided.
      const ir = parseExpression('`${((x) => { return x + 1; })(2)}`', TS);
      expect(ir.kind).toBe('tmplLit');
    });
  });

  describe('classifier ABSENT — template interpolation still fails closed', () => {
    test('block-bodied arrow inside a template interpolation fails closed without a classifier', () => {
      expect(() => parseExpression('`${((x) => { return x + 1; })(2)}`')).toThrow(/closure-parser-unavailable/);
    });
  });
});

describe('closure-parser-unavailable diagnostic — R2 target-agnostic wording', () => {
  test('message names the capability, not a runtime', () => {
    let message = '';
    try {
      parseExpression('(x) => { return x + 1; }');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/closure-parser-unavailable/);
    expect(message).toMatch(/closure classifier/i);
    expect(message).not.toMatch(/typescript|node|browser|deno|bun/i);
  });
});

describe('slice 0.9 r2 review fixes — analysis re-parses survive block-bodied arrows', () => {
  // Both repros are codex's verified blockings from the r2 panel: re-parse
  // sites with swallowing catches turned a block arrow into silently-dropped
  // diagnostics (validator) or a misclassified constructor (super detection).
  function findCtor(node: { type?: string; children?: unknown[] }): unknown {
    if (node.type === 'ctor') return node;
    for (const c of (node.children ?? []) as { type?: string; children?: unknown[] }[]) {
      const r = findCtor(c);
      if (r) return r;
    }
    return null;
  }

  test('semantic validation still fires with a block-bodied arrow in the same expression', () => {
    const src = (expr: string) =>
      [
        'enum name=Status',
        '  variant name=Active',
        'fn name=f',
        '  handler lang=kern',
        `    let name=k value="${expr}"`,
      ].join('\n');
    const plain = JSON.stringify(validateSemantics(parse(src('Object.keys(Status) || 1'))));
    const withArrow = JSON.stringify(validateSemantics(parse(src('Object.keys(Status) || ((x) => { return x; })(1)'))));
    expect(plain).toContain('enum');
    expect(withArrow).toContain('enum');
  });

  test('explicit super(...) with a block-bodied arrow argument is still detected', () => {
    const src = (arg: string) =>
      [
        'class name=Base',
        'class name=Kid extends=Base',
        '  ctor',
        '    handler lang=kern',
        `      do value="super(${arg})"`,
      ].join('\n');
    const plainCtor = findCtor(parse(src('1')));
    const arrowCtor = findCtor(parse(src('((x) => { return x; })(1)')));
    expect(hasDirectSuperCtorCall(plainCtor as Parameters<typeof hasDirectSuperCtorCall>[0])).toBe(true);
    expect(hasDirectSuperCtorCall(arrowCtor as Parameters<typeof hasDirectSuperCtorCall>[0])).toBe(true);
  });
});
