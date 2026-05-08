/** Native KERN handler bodies — `finally` body-statement (TS target).
 *
 *  Extends the slice-4c try/catch shape with an optional `finally` child of
 *  `try`. Either `catch` or `finally` (or both) must be present. Propagation
 *  `?` is rejected inside `finally` for the same reason it is rejected
 *  inside the try-block: the hoisted err-branch lowers to a `return tmp`
 *  that would suppress the original exception/return.
 */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('finally — TS body emit', () => {
  test('try / catch / finally — full triple emits in order', () => {
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
    const out = emitNativeKernBodyTS(handler);
    expect(out).toBe(
      ['try {', '  work();', '} catch (err) {', '  log(err);', '} finally {', '  cleanup();', '}'].join('\n'),
    );
  });

  test('try / finally without catch is allowed', () => {
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
    const out = emitNativeKernBodyTS(handler);
    expect(out).toBe(['try {', '  open();', '} finally {', '  close();', '}'].join('\n'));
  });

  test('try without catch and without finally throws', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [{ type: 'do', props: { value: 'noop()' } }],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/must contain a `catch` or `finally`/);
  });

  test('top-level finally throws (must be inside try)', () => {
    const handler = makeHandler([{ type: 'finally', children: [] }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/`finally` must be a child of `try`/);
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
    // Old slice-4c message said "bypasses catch"; Codex review-fix splits
    // this into a finally-specific diagnostic that names the actual hazard
    // — a `return` from finally overrides the pending exception/return.
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/inside a `finally` block/);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/overrides the pending exception/);
  });

  test('propagation `?` inside try-block (not finally) keeps the original try-block message', () => {
    // Pin existing slice-4c behavior so the finally-specific branch above
    // does not regress the try-block diagnostic.
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
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/inside a `try` block/);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/bypasses the enclosing `catch`/);
  });

  test('try nested inside finally reports the inner-try diagnostic, not the finally one', () => {
    // Codex review fix — `tryDepth` is checked before `finallyDepth` so a
    // user inside a nested `try { ? }` sees the more specific try message.
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
                  { type: 'let', props: { name: 'x', value: 'inner()?' } },
                  {
                    type: 'catch',
                    props: { name: 'err' },
                    children: [{ type: 'do', props: { value: 'log(err)' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/inside a `try` block/);
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
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/at most one `finally` child/);
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
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/at most one `catch` child/);
  });

  test('finally under async-orchestration `try name=…` is rejected at body emit', () => {
    // Async-orchestration `try` carries a `name` prop and is consumed by a
    // separate codegen path that has no finally branch. Body emit should
    // not silently drop it; reject loudly.
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
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/`finally` is only supported on body-statement `try`/);
  });

  test('propagation `?` inside catch is still allowed (catch sits outside tryDepth)', () => {
    // Sanity: catch's err-branch return is OK because by the time we are in
    // catch we have already left the try block. This test pins the existing
    // behavior so the finally addition does not regress catch's semantics.
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'do', props: { value: 'work()' } },
          {
            type: 'catch',
            props: { name: 'err' },
            children: [{ type: 'let', props: { name: 'x', value: 'recover()?' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('} catch (err) {');
    expect(out).toContain('const __k_t1 = recover();');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('const x = __k_t1.value;');
  });

  test('finally with return — emit is structural; runtime override semantics are user-visible', () => {
    // KERN doesn't paper over JS's `return inside finally overrides original
    // return` semantics; the emit is faithful. This test pins that — users
    // who don't want the override should not put `return` in finally.
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'return', props: { value: '1' } },
          {
            type: 'finally',
            children: [{ type: 'return', props: { value: '2' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('try {');
    expect(out).toContain('  return 1;');
    expect(out).toContain('} finally {');
    expect(out).toContain('  return 2;');
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
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('try {');
    expect(out).toContain('  outer();');
    expect(out).toContain('} finally {');
    expect(out).toContain('  try {');
    expect(out).toContain('    inner();');
    expect(out).toContain('  } catch (innerErr) {');
    expect(out).toContain('    log(innerErr);');
  });
});
