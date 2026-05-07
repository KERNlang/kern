/** Native KERN handler bodies — `finally` body-statement (Python target).
 *
 *  Mirror of native-handlers-finally.test.ts for Python — same shape lowers
 *  to Python `try/except/finally` with the same combinations Python's
 *  language permits (`try-except`, `try-finally`, `try-except-finally`).
 */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('finally — Python body emit', () => {
  test('try / catch / finally — full triple emits in Python order', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'do', props: { value: 'work()' } },
          {
            type: 'catch',
            props: { name: 'err' },
            children: [{ type: 'do', props: { value: 'log(err)' } }],
          },
          {
            type: 'finally',
            children: [{ type: 'do', props: { value: 'cleanup()' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toBe(
      ['try:', '    work()', 'except Exception as err:', '    log(err)', 'finally:', '    cleanup()'].join('\n'),
    );
  });

  test('try / finally without catch is allowed (Python supports this directly)', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'do', props: { value: 'open()' } },
          {
            type: 'finally',
            children: [{ type: 'do', props: { value: 'close()' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toBe(['try:', '    open()', 'finally:', '    close()'].join('\n'));
  });

  test('try without catch or finally throws', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [{ type: 'do', props: { value: 'noop()' } }],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/must contain a `catch` or `finally`/);
  });

  test('top-level finally throws (must be inside try)', () => {
    const handler = makeHandler([{ type: 'finally', children: [] }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/`finally` must be a child of `try`/);
  });

  test('empty finally body emits a `pass` line', () => {
    // Python forbids empty blocks; the emitter inserts `pass` to keep the
    // output syntactically valid (mirrors how empty try-blocks are handled).
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'do', props: { value: 'work()' } },
          { type: 'finally', children: [] },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toBe(['try:', '    work()', 'finally:', '    pass'].join('\n'));
  });

  test('propagation `?` inside finally rejects with finally-specific message (Codex review fix)', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'do', props: { value: 'work()' } },
          {
            type: 'finally',
            children: [{ type: 'let', props: { name: 'x', value: 'cleanupResult()?' } }],
          },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/inside a `finally` block/);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/overrides the pending exception/);
  });

  test('propagation `?` inside try-block (not finally) keeps the original try-block message', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'let', props: { name: 'x', value: 'work()?' } },
          {
            type: 'catch',
            props: { name: 'err' },
            children: [{ type: 'do', props: { value: 'log(err)' } }],
          },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/inside a `try` block/);
  });

  test('duplicate finally rejected by body emit (Codex review fix)', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'do', props: { value: 'work()' } },
          { type: 'finally', children: [{ type: 'do', props: { value: 'cleanup1()' } }] },
          { type: 'finally', children: [{ type: 'do', props: { value: 'cleanup2()' } }] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/at most one `finally` child/);
  });

  test('duplicate catch rejected by body emit (defense-in-depth)', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'do', props: { value: 'work()' } },
          { type: 'catch', props: { name: 'a' }, children: [] },
          { type: 'catch', props: { name: 'b' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/at most one `catch` child/);
  });

  test('finally under async-orchestration `try name=…` is rejected at body emit', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: { name: 'loadUser' },
        children: [
          { type: 'finally', children: [{ type: 'do', props: { value: 'cleanup()' } }] },
          { type: 'catch', props: { name: 'err' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/`finally` is only supported on body-statement `try`/);
  });

  test('nested try inside finally body emits correctly', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'do', props: { value: 'outer()' } },
          {
            type: 'finally',
            children: [
              {
                type: 'try',
                children: [
                  { type: 'do', props: { value: 'inner()' } },
                  {
                    type: 'catch',
                    props: { name: 'innerErr' },
                    children: [{ type: 'do', props: { value: 'log(innerErr)' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('try:');
    expect(out).toContain('    outer()');
    expect(out).toContain('finally:');
    expect(out).toContain('    try:');
    expect(out).toContain('        inner()');
    expect(out).toContain('    except Exception as innerErr:');
    expect(out).toContain('        log(innerErr)');
  });

  test('finally body with let/do statements emits with target indentation', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'do', props: { value: 'op()' } },
          {
            type: 'finally',
            children: [
              { type: 'let', props: { name: 'now', value: 'time()' } },
              { type: 'do', props: { value: 'audit(now)' } },
            ],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toBe(['try:', '    op()', 'finally:', '    now = time()', '    audit(now)'].join('\n'));
  });
});
