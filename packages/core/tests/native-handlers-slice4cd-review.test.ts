/** Native KERN handler bodies — slice 4c+4d review fixes (TS target).
 *
 *  OpenCode + Gemini both flagged two real bugs in the slice 4c+4d ship:
 *
 *    CRITICAL — Propagation `?` inside a `try` block hoists to a `return`
 *    that exits the whole function, BYPASSING the enclosing `catch`. Users
 *    who write `?` inside try almost certainly want the err to be caught,
 *    not silently bubbled up past the catch. Reject at codegen with a
 *    let-bind hint.
 *
 *    HIGH — Orphan `try` (no `catch` sibling) emits `try { ... }` on TS
 *    (legal but useless) and a Python SyntaxError. Same pattern as the
 *    slice-2 orphan-`else` rule: fail loud at codegen.
 */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { emitExpression } from '../src/codegen-expression.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { emitParamList } from '../src/codegen/type-system.js';
import { parseExpression } from '../src/parser-expression.js';
import { typescriptClosureClassifier } from '../src/typescript-closure-classifier.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('slice 4c+4d review fix — orphan `try` rejection (TS)', () => {
  // Slice 5a deferred-fix: orphan = `try` without a `catch` CHILD (schema
  // shape). The previous "missing catch sibling" check is replaced with
  // "missing catch child"; the error message uses the same wording.
  test('try without catch child throws with structural error', () => {
    const handler = makeHandler([{ type: 'try', props: {}, children: [{ type: 'return', props: { value: '1' } }] }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/orphan `try`/);
  });

  test('try with non-catch children (no catch present) also throws', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'return', props: { value: '1' } },
          { type: 'let', props: { name: 'x', value: '2' } },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/orphan `try`/);
  });

  // Slice 5a deferred-fix (Codex review of the bundle): the schema lists
  // `step` and `handler` as allowed `try` children for the async-
  // orchestration shape (`try name=loadUser`). Body-emit only handles
  // body-statement try/catch — the orchestration-only nodes must fail
  // loud instead of silently dropping through the unmatched-child path.
  test('body-statement try with `step` child rejects loudly', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'step', props: { name: 'res', await: 'fetch(url)' }, children: [] },
          { type: 'catch', props: { name: 'e' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/`step` is only valid inside an async-orchestration/);
  });

  test('body-statement try with `handler` child rejects loudly', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'handler', props: {}, children: [] },
          { type: 'catch', props: { name: 'e' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/`handler` is only valid inside an async-orchestration/);
  });
});

describe('slice 4c+4d review fix — `?` propagation inside `try` rejection (TS)', () => {
  // Slice 5a deferred-fix: catch is a CHILD of try (schema-compliant
  // shape). Tests updated to mirror.
  test('`let x = call()?` inside try throws with let-bind hint', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'let', props: { name: 'x', value: 'call()?' } },
          { type: 'catch', props: { name: 'e' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/'\?' is not allowed inside a `try` block/);
  });

  test('`return call()?` inside try also throws', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'return', props: { value: 'call()?' } },
          { type: 'catch', props: { name: 'e' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/'\?' is not allowed inside a `try` block/);
  });

  test('`throw call()?` inside try also throws', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'throw', props: { value: 'call()?' } },
          { type: 'catch', props: { name: 'e' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/'\?' is not allowed inside a `try` block/);
  });

  test('top-level (outside try) `?` propagation still works as before', () => {
    // Sanity: the new restriction is scoped to inside-try only. Outside
    // try, the existing slice-1 propagation hoist semantics still apply.
    const handler = makeHandler([{ type: 'return', props: { value: 'call()?' } }]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = call();');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('return __k_t1.value;');
  });

  test('`?` after a try (next sibling, not nested) still works', () => {
    // The restriction is depth-scoped, not lexical-position-scoped: once
    // we exit the try block, ctx.tryDepth decrements back to 0 and
    // propagation re-enables for subsequent statements.
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'return', props: { value: '1' } },
          { type: 'catch', props: { name: 'e' }, children: [{ type: 'return', props: { value: '2' } }] },
        ],
      },
      { type: 'return', props: { value: 'call()?' } },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = call();');
  });
});

describe('host namespace scope tracking in body-statement try/catch (TS)', () => {
  test('catch binding shadows a reserved host root inside catch body', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'do', props: { value: 'work()' } },
          { type: 'catch', props: { name: 'Date' }, children: [{ type: 'return', props: { value: 'Date.now()' } }] },
        ],
      },
    ]);
    expect(emitNativeKernBodyTS(handler)).toContain('return Date.now();');
  });

  test('catch binding remains assignable like JavaScript and TypeScript catch parameters', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'throw', props: { value: '1' } },
          {
            type: 'catch',
            props: { name: 'e' },
            children: [
              { type: 'assign', props: { target: 'e', value: '2' } },
              { type: 'return', props: { value: 'e' } },
            ],
          },
        ],
      },
    ]);
    const code = emitNativeKernBodyTS(handler);
    expect(code).toContain('e = 2;');
    expect(new Function(`return (() => {\n${code}\n})();`)()).toBe(2);
  });
});

describe('host namespace checks in block-bodied lambda expressions (TS)', () => {
  test('block-bodied lambda rejects unmapped host roots before raw block passthrough', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'out', value: 'items.map((item) => { return Date.now(); })' } },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(
      /Unsupported host namespace in TypeScript expression: Date\.now .*not registered/,
    );
  });

  test.each([
    'items.map((item) => { return Date.now(); })',
    'items.map((item) => { return new Date(); })',
    'items.map((item) => { return Date(); })',
  ])('no-context emitExpression fail-closes raw block host roots: %s', (value) => {
    const parsed = parseExpression(value, { closureClassifier: typescriptClosureClassifier });
    expect(() => emitExpression(parsed)).toThrow(/Unsupported host namespace in TypeScript expression: Date\.(now|call|constructor) .*not registered/);
  });

  test.each([
    'items.map((item) => new Date())',
    'items.map((item) => { return new Date(); })',
  ])('%s rejects unmapped constructor host roots', (value) => {
    const handler = makeHandler([{ type: 'let', props: { name: 'out', value } }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(
      /Unsupported host namespace in TypeScript expression: Date\.(factory|constructor) .*not registered/,
    );
  });

  test('block-bodied lambda parameter shadows a reserved host root', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'out', value: 'items.map(Date => { return Date.now(); })' } },
    ]);
    expect(emitNativeKernBodyTS(handler)).toContain('const out = items.map(Date => { return Date.now(); });');
  });

  test('block-local host-root shadowing does not leak outside the block', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'out', value: 'items.map(item => { if (item) { const Date = clock; } return Date.now(); })' } },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(
      /Unsupported host namespace in TypeScript expression: Date\.now .*not registered/,
    );
  });

  test('block-local host-root shadowing applies after declaration in the same block', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'out', value: 'items.map(item => { const Date = clock; return Date.now(); })' } },
    ]);
    expect(emitNativeKernBodyTS(handler)).toContain('return Date.now();');
  });
});

describe('host namespace checks in top-level TypeScript expression props', () => {
  test('top-level user binding shadows a reserved host root for later const values', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'shadow-host-root' },
      children: [
        { type: 'const', props: { name: 'Date', value: 'clock' } },
        { type: 'const', props: { name: 'r', value: 'Date.now()' } },
      ],
    });
    expect(lines.join('\n')).toContain('const r = Date.now();');
  });

  test.each([
    '(Date as any).now()',
    'Date!.now()',
    '(Date as any)["now"]()',
  ])('%s rejects wrapped unmapped host-root receivers', (value) => {
    const handler = makeHandler([{ type: 'let', props: { name: 'out', value } }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(
      /Unsupported host namespace in TypeScript expression: Date\.(now|\[computed\]) .*not registered/,
    );
  });

  test('type-only declarations do not shadow reserved host roots for later const values', () => {
    expect(() =>
      generateCoreNode({
        type: 'module',
        props: { name: 'type-only-host-root' },
        children: [
          { type: 'type', props: { name: 'Date', alias: 'unknown' } },
          { type: 'const', props: { name: 'r', value: 'Date.now()' } },
        ],
      }),
    ).toThrow(/Unsupported host namespace in TypeScript expression: Date\.now .*not registered/);
  });

  test('module runtime binding shadows a reserved host root in class field values', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'field-shadow-host-root' },
      children: [
        { type: 'const', props: { name: 'Date', value: 'clock' } },
        { type: 'class', props: { name: 'Stamp' }, children: [{ type: 'field', props: { name: 'ts', value: 'Date.now()' } }] },
      ],
    });
    expect(lines.join('\n')).toContain('ts = Date.now();');
  });

  test('class self-name shadows a reserved host root in its own field value', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'class-self-shadow-host-root' },
      children: [
        { type: 'class', props: { name: 'Date' }, children: [{ type: 'field', props: { name: 'ts', value: 'Date.now()' } }] },
      ],
    });
    expect(lines.join('\n')).toContain('ts = Date.now();');
  });

  test('module runtime binding shadows a reserved host root in parameter defaults', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'param-shadow-host-root' },
      children: [
        { type: 'const', props: { name: 'Date', value: 'clock' } },
        {
          type: 'fn',
          props: { name: 'stamp', returns: 'number' },
          children: [
            { type: 'param', props: { name: 'ts', type: 'number', value: 'Date.now()' } },
            { type: 'handler', props: { code: 'return ts;' } },
          ],
        },
      ],
    });
    expect(lines.join('\n')).toContain('function stamp(ts: number = Date.now())');
  });

  test('function self-name shadows a reserved host root in its own parameter default', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'fn-self-shadow-host-root' },
      children: [
        {
          type: 'fn',
          props: { name: 'Date', returns: 'number' },
          children: [
            { type: 'param', props: { name: 'ts', type: 'number', value: 'Date.now()' } },
            { type: 'handler', props: { code: 'return ts;' } },
          ],
        },
      ],
    });
    expect(lines.join('\n')).toContain('function Date(ts: number = Date.now())');
  });

  test('host import shadows a reserved host root in later module expressions', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'host-import-shadow-host-root' },
      children: [
        { type: 'import', props: { from: './clock.js', names: 'Date', registry: 'host' } },
        { type: 'const', props: { name: 'r', value: 'Date.now()' } },
      ],
    });
    expect(lines.join('\n')).toContain('const r = Date.now();');
  });

  test('enum shadows a reserved host root as a runtime value in later module expressions', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'enum-shadow-host-root' },
      children: [
        { type: 'enum', props: { name: 'Date', values: 'Now|Later' } },
        { type: 'const', props: { name: 'r', value: 'Date.Now' } },
      ],
    });
    expect(lines.join('\n')).toContain('const r = Date.Now;');
  });

  test('legacy params string defaults fail-close before raw parameter emission', () => {
    expect(() =>
      generateCoreNode({
        type: 'fn',
        props: { name: 'stamp', params: 'ts:number=Date.now()', returns: 'number' },
        children: [{ type: 'handler', props: { code: 'return ts;' } }],
      }),
    ).toThrow(/Unsupported host namespace in TypeScript expression: Date\.now .*not registered/);
  });

  test('module runtime binding shadows host root in config field value emission', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'config-shadow-host-root' },
      children: [
        { type: 'const', props: { name: 'Date', value: 'clock' } },
        {
          type: 'config',
          props: { name: 'ClockConfig' },
          children: [{ type: 'field', props: { name: 'startedAt', type: 'number', value: 'Date.now()' } }],
        },
      ],
    });
    expect(lines.join('\n')).toContain('startedAt: Date.now(),');
  });

  test('module runtime binding shadows host root in repository legacy params', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'repo-shadow-host-root' },
      children: [
        { type: 'const', props: { name: 'Date', value: 'clock' } },
        {
          type: 'repository',
          props: { name: 'ClockRepo', model: 'Clock' },
          children: [
            {
              type: 'method',
              props: { name: 'find', params: 'ts:number=Date.now()', returns: 'Clock' },
              children: [{ type: 'handler', props: { code: 'return {} as Clock;' } }],
            },
          ],
        },
      ],
    });
    expect(lines.join('\n')).toContain('find(ts: number = Date.now())');
  });

  test('module runtime binding shadows host root in action legacy params', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'action-shadow-host-root' },
      children: [
        { type: 'const', props: { name: 'Date', value: 'clock' } },
        {
          type: 'action',
          props: { name: 'send', params: 'ts:number=Date.now()', returns: 'void' },
          children: [{ type: 'handler', props: { code: 'return;' } }],
        },
      ],
    });
    expect(lines.join('\n')).toContain('async function send(ts: number = Date.now())');
  });

  test('module runtime binding shadows host root in nested class method param defaults', () => {
    const lines = generateCoreNode({
      type: 'module',
      props: { name: 'nested-param-shadow-host-root' },
      children: [
        { type: 'const', props: { name: 'Date', value: 'clock' } },
        {
          type: 'class',
          props: { name: 'Clock' },
          children: [
            {
              type: 'method',
              props: { name: 'tick', returns: 'number' },
              children: [
                { type: 'param', props: { name: 'ts', type: 'number', value: 'Date.now()' } },
                { type: 'handler', props: { code: 'return ts;' } },
              ],
            },
          ],
        },
      ],
    });
    expect(lines.join('\n')).toContain('tick(ts: number = Date.now())');
  });

  test('param-default block lambdas fail-close raw host roots', () => {
    expect(() =>
      generateCoreNode({
        type: 'fn',
        props: { name: 'withDefault', returns: 'void' },
        children: [
          {
            type: 'param',
            props: { name: 'mapper', type: '(item: number) => number', value: '(item) => { return Date.now(); }' },
          },
          { type: 'handler', props: { code: 'return;' } },
        ],
      }),
    ).toThrow(/Unsupported host namespace in TypeScript expression: Date\.now .*not registered/);
  });

  test('structured param defaults can reference a preceding host-named parameter', () => {
    const lines = generateCoreNode({
      type: 'fn',
      props: { name: 'useDate', returns: 'number' },
      children: [
        { type: 'param', props: { name: 'Date', type: '{ now(): number }' } },
        { type: 'param', props: { name: 'ts', type: 'number', value: 'Date.now()' } },
        { type: 'handler', props: { code: 'return ts;' } },
      ],
    });
    expect(lines.join('\n')).toContain('function useDate(Date: { now(): number }, ts: number = Date.now())');
  });

  test('destructured param bindings enter scope for later parameter defaults', () => {
    const lines = generateCoreNode({
      type: 'fn',
      props: { name: 'useDestructuredDate', returns: 'number' },
      children: [
        {
          type: 'param',
          props: { name: 'ignored', type: '{ Date: { now(): number } }' },
          children: [{ type: 'binding', props: { name: 'Date' } }],
        },
        { type: 'param', props: { name: 'ts', type: 'number', value: 'Date.now()' } },
        { type: 'handler', props: { code: 'return ts;' } },
      ],
    });
    expect(lines.join('\n')).toContain('function useDestructuredDate({ Date }: { Date: { now(): number } }, ts: number = Date.now())');
  });

  test('destructure statement bindings shadow host roots for later body expressions', () => {
    expect(() =>
      generateCoreNode({
        type: 'handler',
        props: { lang: 'kern' },
        children: [
          {
            type: 'destructure',
            props: { source: 'clock' },
            children: [{ type: 'binding', props: { name: 'Date' } }],
          },
          { type: 'return', props: { value: 'Date.now()' } },
        ],
      }),
    ).not.toThrow();
  });

  test('loop and resource bindings shadow host roots for nested body expressions', () => {
    expect(() =>
      generateCoreNode({
        type: 'fn',
        props: { name: 'loopShadow', returns: 'number' },
        children: [
          {
            type: 'handler',
            props: { lang: 'kern' },
            children: [
              {
                type: 'each',
                props: { name: 'Date', in: 'items' },
                children: [{ type: 'do', props: { value: 'Date.now()' } }],
              },
              {
                type: 'for',
                props: { name: 'Date', from: '0', to: '1' },
                children: [{ type: 'do', props: { value: 'Date.toString()' } }],
              },
              {
                type: 'with',
                props: { name: 'Date', value: 'clock', cleanup: 'cleanup(Date)' },
                children: [{ type: 'do', props: { value: 'Date.now()' } }],
              },
              { type: 'return', props: { value: '0' } },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  test('validation scope is not memoized across standalone reuse of an IR node', () => {
    const child: IRNode = { type: 'const', props: { name: 'r', value: 'Date.now()' } };
    expect(() =>
      generateCoreNode({
        type: 'module',
        props: { name: 'reuse-shadow-host-root' },
        children: [{ type: 'const', props: { name: 'Date', value: 'clock' } }, child],
      }),
    ).not.toThrow();
    expect(() => generateCoreNode(child)).toThrow(
      /Unsupported host namespace in TypeScript expression: Date\.now .*not registered/,
    );
  });

  test('direct legacy param-list emission fails closed for host defaults', () => {
    expect(() =>
      emitParamList({
        type: 'method',
        props: { name: 'direct', params: 'ts:number=Date.now()' },
      }),
    ).toThrow(/Unsupported host namespace in TypeScript expression: Date\.now .*not registered/);
  });

  test('chained host namespace access fails-close before emission', () => {
    expect(() =>
      generateCoreNode({
        type: 'const',
        props: { name: 'bad', value: 'Date.now().toString()' },
      }),
    ).toThrow(/Unsupported host namespace in TypeScript expression: Date\.now .*not registered/);
  });

  test.each([
    'new Date.factory()',
    'new Date["factory"]()',
  ])('%s rejects constructor expressions rooted in reserved host namespaces', (value) => {
    const handler = makeHandler([{ type: 'let', props: { name: 'out', value } }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(
      /Unsupported host namespace in TypeScript expression: Date\.(factory|constructor) .*not registered/,
    );
  });

  test('parse-failure fallback does not raw-emit reserved host namespace access', () => {
    expect(() =>
      generateCoreNode({
        type: 'const',
        props: { name: 'bad', value: 'Date.now(]' },
      }),
    ).toThrow(/Unsupported host namespace in TypeScript expression: Date\.now .*not registered/);
  });

  test.each([
    ['Date()', /Unsupported host namespace in TypeScript expression: Date\.call .*not registered/],
    ['Array(5)', /Unknown KERN-stdlib method\/member 'Array\.call'/],
    ['Object(null)', /Unknown KERN-stdlib method\/member 'Object\.call'/],
  ])('%s rejects parsed bare host-root calls', (value, message) => {
    const handler = makeHandler([{ type: 'let', props: { name: 'out', value } }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(message);
  });

  test.each([
    ['Array(5)', /Unknown KERN-stdlib method\/member 'Array\.call'/],
    ['Object(null)', /Unknown KERN-stdlib method\/member 'Object\.call'/],
  ])('%s rejects in the pre-emission IR validation pass', (value, message) => {
    expect(() =>
      generateCoreNode({
        type: 'const',
        props: { name: 'bad', value },
      }),
    ).toThrow(message);
  });
});
