import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { decompile } from '../src/decompiler.js';
import { parseDocumentStrict } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

function findFirst(node: IRNode, type: string): IRNode | null {
  if (node.type === type) return node;
  for (const child of node.children ?? []) {
    const found = findFirst(child, type);
    if (found) return found;
  }
  return null;
}

describe('with — TS native body emit', () => {
  test('happy path lowers to const + try/finally', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'ClaudeCliSession.spawn()', cleanup: 'session.close()' },
        children: [{ type: 'do', props: { value: 'session.ask("hello")' } }],
      },
    ]);
    expect(emitNativeKernBodyTS(handler)).toBe(
      [
        'const session = ClaudeCliSession.spawn();',
        'try {',
        '  session.ask("hello");',
        '} finally {',
        '  session.close();',
        '}',
      ].join('\n'),
    );
  });

  test('nested with emits nested try/finally', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'outer', value: 'openOuter()', cleanup: 'outer.close()' },
        children: [
          {
            type: 'with',
            props: { name: 'inner', value: 'openInner()', cleanup: 'inner.close()' },
            children: [{ type: 'do', props: { value: 'work(inner)' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const outer = openOuter();');
    expect(out).toContain('const inner = openInner();');
    expect(out).toContain('inner.close();');
    expect(out).toContain('outer.close();');
  });

  test('with inside try is supported', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          {
            type: 'with',
            props: { name: 'session', value: 'spawn()', cleanup: 'session.close()' },
            children: [{ type: 'do', props: { value: 'session.ask("hello")' } }],
          },
          { type: 'catch', props: { name: 'err' }, children: [{ type: 'throw', props: { value: 'err' } }] },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('try {');
    expect(out).toContain('const session = spawn();');
    expect(out).toContain('} catch (err) {');
  });

  test('return inside with body is preserved', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'spawn()', cleanup: 'session.close()' },
        children: [{ type: 'return', props: { value: 'session.ask("hello")' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('return session.ask("hello");');
    expect(out).toContain('session.close();');
  });

  test('throw inside with body is preserved', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'spawn()', cleanup: 'session.close()' },
        children: [{ type: 'throw', props: { value: 'new Error("boom")' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('throw new Error("boom");');
    expect(out).toContain('session.close();');
  });

  test('propagation in with body still lowers with cleanup', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'spawn()', cleanup: 'session.close()' },
        children: [{ type: 'let', props: { name: 'user', value: 'fetchUser(raw)?' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = fetchUser(raw);');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('const user = __k_t1.value;');
    expect(out).toContain('session.close();');
  });
});

describe('with — decompile round-trip', () => {
  test('decompiled with is re-parseable and codegen-equivalent', () => {
    const source = [
      'fn name=ask returns=string',
      '  handler lang="kern"',
      '    with name=session value="spawn()" cleanup="session.close()"',
      '      do call="session.ask(\\"hello\\")"',
    ].join('\n');
    const root = parseDocumentStrict(source);
    const withNode = findFirst(root, 'with');
    const handler = findFirst(root, 'handler');
    if (!withNode || !handler) throw new Error('expected with + handler nodes');

    const text = decompile(withNode).code;
    expect(text).toContain('with name=session');
    expect(text).toContain('cleanup=');

    const indented = text
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n');
    const roundSource = ['fn name=ask returns=string', '  handler lang="kern"', indented].join('\n');
    const roundRoot = parseDocumentStrict(roundSource);
    const roundHandler = findFirst(roundRoot, 'handler');
    if (!roundHandler) throw new Error('expected handler in round root');

    expect(emitNativeKernBodyTS(handler)).toBe(emitNativeKernBodyTS(roundHandler));
  });
});

describe('with — async + cross-prop validation', () => {
  test('async=true awaits both acquire and cleanup (TS)', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: {
          name: 'session',
          value: 'spawnSession()',
          cleanup: 'session.close()',
          async: true,
        },
        children: [{ type: 'do', props: { value: 'session.work()' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const session = await spawnSession();');
    expect(out).toContain('await session.close();');
  });

  test('protocol=with is rejected on TS target', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'spawn()', protocol: 'with' },
        children: [{ type: 'do', props: { value: 'session.work()' } }],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/Python-only/);
  });
});
