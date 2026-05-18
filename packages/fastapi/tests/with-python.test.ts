import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('with — Python native body emit', () => {
  test('default lowers to try/finally', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'ClaudeCliSession.spawn()', cleanup: 'session.close()' },
        children: [{ type: 'do', props: { value: 'session.ask("hello")' } }],
      },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      [
        'session = ClaudeCliSession.spawn()',
        'try:',
        '    session.ask("hello")',
        'finally:',
        '    session.close()',
      ].join('\n'),
    );
  });

  test('protocol=with lowers to native with statement', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'ClaudeCliSession.spawn()', protocol: 'with' },
        children: [{ type: 'do', props: { value: 'session.ask("hello")' } }],
      },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      ['with ClaudeCliSession.spawn() as session:', '    session.ask("hello")'].join('\n'),
    );
  });

  test('nested with emits nested scopes', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'outer', value: 'open_outer()', cleanup: 'outer.close()' },
        children: [
          {
            type: 'with',
            props: { name: 'inner', value: 'open_inner()', cleanup: 'inner.close()' },
            children: [{ type: 'do', props: { value: 'work(inner)' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('outer = open_outer()');
    expect(out).toContain('inner = open_inner()');
    expect(out).toContain('inner.close()');
    expect(out).toContain('outer.close()');
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
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('try:');
    expect(out).toContain('session = spawn()');
    expect(out).toContain('except Exception as err:');
  });

  test('return inside with body is preserved', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'spawn()', cleanup: 'session.close()' },
        children: [{ type: 'return', props: { value: 'session.ask("hello")' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('return session.ask("hello")');
    expect(out).toContain('session.close()');
  });

  test('throw inside with body is preserved', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'spawn()', cleanup: 'session.close()' },
        children: [{ type: 'throw', props: { value: 'Exception("boom")' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('raise Exception("boom")');
    expect(out).toContain('session.close()');
  });

  test('propagation in with body still lowers with cleanup', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'spawn()', cleanup: 'session.close()' },
        children: [{ type: 'let', props: { name: 'user', value: 'fetch_user(raw)?' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('__k_t1 = fetch_user(raw)');
    expect(out).toContain("if __k_t1.kind == 'err':");
    expect(out).toContain('return __k_t1');
    expect(out).toContain('user = __k_t1.value');
    expect(out).toContain('session.close()');
  });

  test('async=true awaits both acquire and cleanup (Python)', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 'session', value: 'spawn_session()', cleanup: 'session.close()', async: true },
        children: [{ type: 'do', props: { value: 'session.work()' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('session = await spawn_session()');
    expect(out).toContain('await session.close()');
  });

  test('protocol=with + cleanup is rejected at codegen', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 's', value: 'open_resource()', cleanup: 's.close()', protocol: 'with' },
        children: [{ type: 'do', props: { value: 's.work()' } }],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/delegates cleanup/);
  });

  test('no protocol + no cleanup is rejected at codegen', () => {
    const handler = makeHandler([
      {
        type: 'with',
        props: { name: 's', value: 'open_resource()' },
        children: [{ type: 'do', props: { value: 's.work()' } }],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/requires `cleanup=`/);
  });
});
