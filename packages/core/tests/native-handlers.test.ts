/** Native KERN handler bodies — slice 1.
 *
 *  Surface: `handler lang=kern` opt-in. `let name=X value="EXPR"` and
 *  `return value="EXPR"` (or bare `return`). EXPR supports literals (string,
 *  number, bool, none, null, undefined), idents, calls, member-access (data
 *  fields), `await`, statement-level propagation `?` (Result-flavored).
 *
 *  Targets covered here: parse → AST shape, TS codegen via emitNativeKernBodyTS,
 *  end-to-end fn-codegen integration for `fn ... handler lang=kern ...`. */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { emitExpression } from '../src/codegen-expression.js';
import { parseDocument } from '../src/parser.js';
import { parseExpression } from '../src/parser-expression.js';
import type { IRNode } from '../src/types.js';

// ── Expression-parser additions ───────────────────────────────────────────

describe('parseExpression — slice 1 native body additions', () => {
  test('await prefix produces an await ValueIR node', () => {
    const ir = parseExpression('await fetchUser(raw)');
    expect(ir.kind).toBe('await');
    if (ir.kind === 'await') {
      expect(ir.argument.kind).toBe('call');
    }
  });

  test('postfix ? on a call produces a propagate ValueIR node', () => {
    const ir = parseExpression('fetchUser(raw)?');
    expect(ir.kind).toBe('propagate');
    if (ir.kind === 'propagate') {
      expect(ir.op).toBe('?');
      expect(ir.argument.kind).toBe('call');
    }
  });

  test('await + ? composes as propagate(await(call))', () => {
    const ir = parseExpression('await fetchUser(raw)?');
    expect(ir.kind).toBe('propagate');
    if (ir.kind === 'propagate') {
      expect(ir.argument.kind).toBe('await');
      if (ir.argument.kind === 'await') {
        expect(ir.argument.argument.kind).toBe('call');
      }
    }
  });

  test('`none` parses as nullLit (KERN-side alias for null)', () => {
    const ir = parseExpression('none');
    expect(ir.kind).toBe('nullLit');
  });

  test('member chain still parses with new postfix support', () => {
    const ir = parseExpression('user.profile.email');
    expect(ir.kind).toBe('member');
  });
});

// ── TS expression emitter additions ───────────────────────────────────────

describe('emitExpression — TS — await + propagate', () => {
  test('await emits TS `await ${arg}`', () => {
    expect(emitExpression(parseExpression('await foo()'))).toBe('await foo()');
  });

  test('propagate at expression level throws — must hoist at statement level', () => {
    expect(() => emitExpression(parseExpression('foo()?'))).toThrow(/only allowed at statement level/);
  });

  test('null and `none` both emit TS `null`', () => {
    expect(emitExpression(parseExpression('null'))).toBe('null');
    expect(emitExpression(parseExpression('none'))).toBe('null');
  });
});

// ── Body codegen — TypeScript ────────────────────────────────────────────

function makeHandler(stmts: Array<{ type: string; props: Record<string, unknown>; children?: IRNode[] }>): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: stmts.map((s) => ({ type: s.type, props: s.props, children: s.children })),
  };
}

describe('emitNativeKernBodyTS — slice 1 statements', () => {
  test('let with simple call expression', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'x', value: 'foo()' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('const x = foo();');
  });

  test('let with type annotation emits typed const', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'user', type: 'User | null', value: 'loadUser()' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('const user: User | null = loadUser();');
  });

  test('let kind=let emits mutable TS let', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'total', kind: 'let', value: '0' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('let total = 0;');
  });

  test('let kind=let with type annotation emits typed mutable TS let', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'total', kind: 'let', type: 'number', value: '0' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('let total: number = 0;');
  });

  test('let kind=let can be reassigned by assign', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'total', kind: 'let', value: '0' } },
      { type: 'assign', props: { target: 'total', op: '+=', value: '1' } },
    ]);
    expect(emitNativeKernBodyTS(handler)).toBe(['let total = 0;', 'total += 1;'].join('\n'));
  });

  test('assign rejects reassignment of default immutable let binding', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'total', value: '0' } },
      { type: 'assign', props: { target: 'total', value: '1' } },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/cannot reassign immutable/);
  });

  test('let kind=let can be reassigned inside a nested block', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'total', kind: 'let', value: '0' } },
      {
        type: 'if',
        props: { cond: 'ready' },
        children: [{ type: 'assign', props: { target: 'total', op: '+=', value: '1' }, children: [] }],
      },
    ]);
    expect(emitNativeKernBodyTS(handler)).toBe(['let total = 0;', 'if (ready) {', '  total += 1;', '}'].join('\n'));
  });

  test('duplicate local let in the same scope is rejected', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'total', kind: 'let', value: '0' } },
      { type: 'let', props: { name: 'total', kind: 'let', value: '1' } },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/already declared/);
  });

  test('assign rejects reassignment of loop binding that shadows an outer mutable let', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'item', kind: 'let', value: 'null' } },
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [{ type: 'assign', props: { target: 'item', value: '2' }, children: [] }],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/cannot reassign immutable/);
  });

  test('let invalid kind is rejected', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'total', kind: 'var', value: '0' } }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/supports only `const` or `let`/);
  });

  test('let with await call', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'u', value: 'await fetchUser(raw)' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('const u = await fetchUser(raw);');
  });

  test('let with propagation hoists statement-level (slice 7 shape, Result kind)', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'u', value: 'fetchUser(raw)?' } }]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = fetchUser(raw);');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('const u = __k_t1.value;');
  });

  test('let with type annotation preserves type after propagation hoist', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'u', type: 'User', value: 'fetchUser(raw)?' } }]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = fetchUser(raw);');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('const u: User = __k_t1.value;');
  });

  test('let kind=let preserves mutability after propagation hoist', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'u', kind: 'let', type: 'User', value: 'fetchUser(raw)?' } },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = fetchUser(raw);');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('let u: User = __k_t1.value;');
  });

  test('let with await + propagation prefixes await on the hoisted call', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'u', value: 'await fetchUser(raw)?' } }]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = await fetchUser(raw);');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('const u = __k_t1.value;');
  });

  test('return with value', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'Result.ok(u)' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('return Result.ok(u);');
  });

  test('bare return emits `return;`', () => {
    const handler = makeHandler([{ type: 'return', props: {} }]);
    expect(emitNativeKernBodyTS(handler)).toBe('return;');
  });

  test('return with propagation hoists', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'fetchUser(raw)?' } }]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = fetchUser(raw);');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('return __k_t1.value;');
  });

  test('multiple statements share a single per-handler gensym counter', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'a', value: 'first()?' } },
      { type: 'let', props: { name: 'b', value: 'second()?' } },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = first();');
    expect(out).toContain('const __k_t2 = second();');
  });

  test('non-propagate return and bare ident emit cleanly', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'u', value: 'getUser()' } },
      { type: 'return', props: { value: 'u' } },
    ]);
    expect(emitNativeKernBodyTS(handler)).toBe(['const u = getUser();', 'return u;'].join('\n'));
  });
});

describe('emitNativeKernBodyTS — destructure body statement', () => {
  test('emits object destructuring inside native body', () => {
    const handler = makeHandler([
      {
        type: 'destructure',
        props: { kind: 'const', source: 'req.body' },
        children: [
          { type: 'binding', props: { name: 'trackId' } },
          { type: 'binding', props: { name: 'opts', key: 'options' } },
        ],
      },
      { type: 'return', props: { value: 'trackId' } },
    ]);

    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const { trackId, options: opts } = req.body;');
    expect(out).toContain('return trackId;');
  });

  test('emits typed object destructuring inside native body', () => {
    const handler = makeHandler([
      {
        type: 'destructure',
        props: { kind: 'const', source: 'req.body', type: '{ trackId: string; options: Options }' },
        children: [
          { type: 'binding', props: { name: 'trackId' } },
          { type: 'binding', props: { name: 'opts', key: 'options' } },
        ],
      },
    ]);

    expect(emitNativeKernBodyTS(handler)).toContain(
      'const { trackId, options: opts }: { trackId: string; options: Options } = req.body;',
    );
  });

  test('emits array destructuring inside native body', () => {
    const handler = makeHandler([
      {
        type: 'destructure',
        props: { kind: 'const', source: 'pair' },
        children: [
          { type: 'element', props: { name: 'first', index: '0' } },
          { type: 'element', props: { name: 'third', index: '2' } },
        ],
      },
    ]);

    expect(emitNativeKernBodyTS(handler)).toContain('const [first, , third] = pair;');
  });

  test('emits typed array destructuring inside native body', () => {
    const handler = makeHandler([
      {
        type: 'destructure',
        props: { kind: 'const', source: 'pair', type: '[string, number]' },
        children: [
          { type: 'element', props: { name: 'first', index: '0' } },
          { type: 'element', props: { name: 'second', index: '1' } },
        ],
      },
    ]);

    expect(emitNativeKernBodyTS(handler)).toContain('const [first, second]: [string, number] = pair;');
  });

  test('emits let-kind object destructuring inside native body', () => {
    const handler = makeHandler([
      {
        type: 'destructure',
        props: { kind: 'let', source: 'req.body' },
        children: [
          { type: 'binding', props: { name: 'trackId' } },
          { type: 'binding', props: { name: 'opts', key: 'options' } },
        ],
      },
    ]);

    expect(emitNativeKernBodyTS(handler)).toContain('let { trackId, options: opts } = req.body;');
  });

  test('emits let-kind array destructuring inside native body', () => {
    const handler = makeHandler([
      {
        type: 'destructure',
        props: { kind: 'let', source: 'pair' },
        children: [
          { type: 'element', props: { name: 'first', index: '0' } },
          { type: 'element', props: { name: 'second', index: '1' } },
        ],
      },
    ]);

    expect(emitNativeKernBodyTS(handler)).toContain('let [first, second] = pair;');
  });

  test('rejects propagation source inside try with try-specific guidance', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          {
            type: 'destructure',
            props: { kind: 'const', source: 'loadPair()?' },
            children: [{ type: 'element', props: { name: 'first', index: '0' } }],
          },
          { type: 'catch', props: { name: 'e' }, children: [{ type: 'return', props: {} }] },
        ],
      },
    ]);

    expect(() => emitNativeKernBodyTS(handler)).toThrow(/not allowed inside a `try` block/);
  });
});

// ── End-to-end fn integration ─────────────────────────────────────────────

describe('fn handler lang=kern — TS codegen integration', () => {
  test('parses and emits a complete native-body fn', () => {
    const source = [
      'module name=test',
      'fn name=parseAndEcho params="raw:string" returns=Result async=true',
      '  handler lang=kern',
      '    let name=u value="await fetchUser(raw)?"',
      '    return value="Result.ok(u)"',
    ].join('\n');
    const ir = parseDocument(source);
    const fnNode = ir.children?.find((c) => c.type === 'fn');
    expect(fnNode).toBeDefined();
    if (!fnNode) return;
    const out = generateCoreNode(fnNode).join('\n');
    expect(out).toContain('async function parseAndEcho(raw: string): Result {');
    expect(out).toContain('const __k_t1 = await fetchUser(raw);');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('const u = __k_t1.value;');
    expect(out).toContain('return Result.ok(u);');
  });

  test('legacy `handler <<<…>>>` path still emits raw body unchanged', () => {
    const source = [
      'module name=test',
      'fn name=raw params="x:string" returns=void',
      '  handler <<<',
      '    return x.toUpperCase();',
      '  >>>',
    ].join('\n');
    const ir = parseDocument(source);
    const fnNode = ir.children?.find((c) => c.type === 'fn');
    if (!fnNode) return;
    const out = generateCoreNode(fnNode).join('\n');
    expect(out).toContain('return x.toUpperCase();');
    // The native body emitter must NOT have produced gensym lines for raw bodies.
    expect(out).not.toContain('__k_t1');
  });
});
