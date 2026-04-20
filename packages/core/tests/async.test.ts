/**
 * Tests for the `async` node — declarative async block with optional
 * `recover` child. Shipped in PR 6 to close the "async/await + try/catch"
 * language gap (handler-heavy agon files).
 *
 * Design (per codex tribunal-followup): async composes with the existing
 * recover/strategy machinery in ground-layer.ts. It does NOT add
 * await/timeout/retry props to derive/set/action — those stay identity-pure.
 */

import { generateAsync, generateCoreNode, isCoreNode } from '../src/codegen-core.js';
import { KernCodegenError } from '../src/errors.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('Ground Layer: async (no recover)', () => {
  it('emits a bare async IIFE wrapping the handler body', () => {
    const node = mk('async', { name: 'loadUser' }, [mk('handler', { code: 'const res = await fetch(url);' })]);
    const code = generateAsync(node).join('\n');

    expect(code).toContain('(async () => {');
    expect(code).toContain('const res = await fetch(url);');
    expect(code).toContain('})();');
    // No recovery wrapper should leak in.
    expect(code).not.toContain('WithRecovery');
  });

  it('preserves multi-line handler body indentation', () => {
    const node = mk('async', { name: 'loadUser' }, [
      mk('handler', { code: 'const res = await fetch(url);\nconst data = await res.json();\nsetUser(data);' }),
    ]);
    const code = generateAsync(node).join('\n');

    expect(code).toContain('const res = await fetch(url);');
    expect(code).toContain('const data = await res.json();');
    expect(code).toContain('setUser(data);');
  });

  it('throws when no handler child is supplied', () => {
    const node = mk('async', { name: 'loadUser' }, []);
    expect(() => generateAsync(node)).toThrow(KernCodegenError);
    expect(() => generateAsync(node)).toThrow(/handler/);
  });

  it('throws on invalid name (routes through emitIdentifier)', () => {
    const node = mk('async', { name: 'bad-name!' }, [mk('handler', { code: 'await foo();' })]);
    expect(() => generateAsync(node)).toThrow(KernCodegenError);
  });
});

describe('Ground Layer: async + recover', () => {
  it('delegates recovery to the reusable `<name>WithRecovery<T>` wrapper', () => {
    const node = mk('async', { name: 'loadUser' }, [
      mk('handler', { code: 'setUser(await fetchUser(id));' }),
      mk('recover', {}, [mk('strategy', { name: 'fallback' }, [mk('handler', { code: 'setUser(null);' })])]),
    ]);
    const code = generateAsync(node).join('\n');

    // Wrapper is declared with the async block's name.
    expect(code).toContain('async function loadUserWithRecovery');
    // Wrapper is invoked with the body as an async arrow.
    expect(code).toContain('loadUserWithRecovery(async () => {');
    expect(code).toContain('setUser(await fetchUser(id));');
    expect(code).toContain('});');
    // Fallback body is spliced by generateRecover.
    expect(code).toContain('setUser(null);');
  });

  it('injects the async block name into the recover child (ignores any pre-set name)', () => {
    // Authors should not need to duplicate the name on `recover`. If they do,
    // the async block's name wins so the wrapper and its call stay in sync.
    const node = mk('async', { name: 'loadUser' }, [
      mk('handler', { code: 'doWork();' }),
      mk('recover', { name: 'unused' }, [mk('strategy', { name: 'fallback' }, [mk('handler', { code: 'onFail();' })])]),
    ]);
    const code = generateAsync(node).join('\n');
    expect(code).toContain('async function loadUserWithRecovery');
    expect(code).not.toContain('unusedWithRecovery');
    expect(code).toContain('loadUserWithRecovery(async () => {');
  });

  it('propagates a missing `fallback` strategy as a KernCodegenError from generateRecover', () => {
    const node = mk('async', { name: 'loadUser' }, [
      mk('handler', { code: 'await foo();' }),
      mk('recover', {}, [mk('strategy', { name: 'retry', max: '3', delay: '100' })]),
    ]);
    // generateRecover enforces that a `fallback` strategy exists; the error
    // bubbles through our wrapper intact.
    expect(() => generateAsync(node)).toThrow(/fallback/);
  });
});

describe('Integration: generateCoreNode dispatches async', () => {
  it('dispatches async via the core dispatcher', () => {
    const code = generateCoreNode(mk('async', { name: 'x' }, [mk('handler', { code: 'await foo();' })])).join('\n');
    expect(code).toContain('(async () => {');
    expect(code).toContain('await foo();');
  });

  it('registers async as a core node type', () => {
    expect(isCoreNode('async')).toBe(true);
  });
});

describe('async — full parse pipeline', () => {
  it('parses and emits async + recover from .kern source', () => {
    const source = [
      'async name=loadUser',
      '  handler <<<',
      '    const res = await fetch("/api/users/1");',
      '    setUser(await res.json());',
      '  >>>',
      '  recover',
      '    strategy name=fallback',
      '      handler <<<',
      '        setUser(null);',
      '      >>>',
      '',
    ].join('\n');

    const ast = parse(source);
    const asyncNode = ast.type === 'async' ? ast : ast.children?.find((c) => c.type === 'async');
    expect(asyncNode).toBeDefined();
    expect((asyncNode as IRNode).props?.name).toBe('loadUser');

    const code = generateCoreNode(asyncNode as IRNode).join('\n');
    expect(code).toContain('async function loadUserWithRecovery');
    expect(code).toContain('loadUserWithRecovery(async () => {');
    expect(code).toContain('const res = await fetch("/api/users/1");');
    expect(code).toContain('setUser(await res.json());');
    expect(code).toContain('setUser(null);');
  });
});
