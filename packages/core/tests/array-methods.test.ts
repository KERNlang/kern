/**
 * Tests for `filter` / `find` / `some` / `every` — declarative array-method
 * primitives shipped in PR 8.
 *
 * All four share the same shape and lower to the same pattern:
 *   const <name>[:type] = (<coll>).<method>(<item> => <predicate>);
 *
 * Memo (2026-04-20): array methods are ~40-50% of handler bulk in rendering
 * blocks. Each primitive closes a slice of that — `.map` was already covered
 * by `each`.
 */

import {
  generateCoreNode,
  generateEvery,
  generateFilter,
  generateFind,
  generateSome,
  isCoreNode,
} from '../src/codegen-core.js';
import { KernCodegenError } from '../src/errors.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('Ground Layer: filter', () => {
  it('defaults the per-item binding to `item`', () => {
    const node = mk('filter', { name: 'active', in: 'items', where: 'item.active' });
    const code = generateFilter(node).join('\n');
    expect(code).toBe('export const active = (items).filter((item) => item.active);');
  });

  it('honours an explicit `item=` rename', () => {
    const node = mk('filter', { name: 'active', in: 'items', item: 'x', where: 'x.active' });
    const code = generateFilter(node).join('\n');
    expect(code).toBe('export const active = (items).filter((x) => x.active);');
  });

  it('applies an optional type annotation', () => {
    const node = mk('filter', { name: 'active', in: 'items', where: 'item.active', type: 'User[]' });
    const code = generateFilter(node).join('\n');
    expect(code).toBe('export const active: User[] = (items).filter((item) => item.active);');
  });

  it('respects export=false', () => {
    const node = mk('filter', { name: 'active', in: 'items', where: 'item.active', export: 'false' });
    const code = generateFilter(node).join('\n');
    expect(code).not.toContain('export');
    expect(code).toBe('const active = (items).filter((item) => item.active);');
  });

  it('throws when the `in` prop is missing', () => {
    const node = mk('filter', { name: 'active', where: 'item.active' });
    expect(() => generateFilter(node)).toThrow(KernCodegenError);
    expect(() => generateFilter(node)).toThrow(/filter .* 'in' prop/);
  });

  it('throws when the `where` prop is missing', () => {
    const node = mk('filter', { name: 'active', in: 'items' });
    expect(() => generateFilter(node)).toThrow(KernCodegenError);
    expect(() => generateFilter(node)).toThrow(/filter .* 'where' prop/);
  });
});

describe('Ground Layer: find / some / every share the same shape', () => {
  it('find emits .find(...)', () => {
    const node = mk('find', { name: 'admin', in: 'users', item: 'u', where: "u.role === 'admin'" });
    const code = generateFind(node).join('\n');
    expect(code).toBe("export const admin = (users).find((u) => u.role === 'admin');");
  });

  it('some emits .some(...)', () => {
    const node = mk('some', { name: 'hasError', in: 'results', where: '!item.ok' });
    const code = generateSome(node).join('\n');
    expect(code).toBe('export const hasError = (results).some((item) => !item.ok);');
  });

  it('every emits .every(...)', () => {
    const node = mk('every', { name: 'allDone', in: 'tasks', where: 'item.done' });
    const code = generateEvery(node).join('\n');
    expect(code).toBe('export const allDone = (tasks).every((item) => item.done);');
  });

  it('find honours type annotation (User | undefined)', () => {
    const node = mk('find', { name: 'admin', in: 'users', where: "item.role === 'admin'", type: 'User | undefined' });
    const code = generateFind(node).join('\n');
    expect(code).toContain('const admin: User | undefined = (users).find');
  });

  it('each of the three still throws on missing in/where', () => {
    expect(() => generateFind(mk('find', { name: 'x' }))).toThrow(/find .* 'in' prop/);
    expect(() => generateSome(mk('some', { name: 'x', in: 'xs' }))).toThrow(/some .* 'where' prop/);
    expect(() => generateEvery(mk('every', { name: 'x' }))).toThrow(/every .* 'in' prop/);
  });
});

describe('Integration: generateCoreNode dispatches array methods', () => {
  it('dispatches filter via the core dispatcher', () => {
    const code = generateCoreNode(mk('filter', { name: 'a', in: 'xs', where: 'item.ok' })).join('\n');
    expect(code).toContain('(xs).filter((item) => item.ok)');
  });

  it('registers all four as core node types', () => {
    expect(isCoreNode('filter')).toBe(true);
    expect(isCoreNode('find')).toBe(true);
    expect(isCoreNode('some')).toBe(true);
    expect(isCoreNode('every')).toBe(true);
  });
});

describe('Array methods — full parse pipeline', () => {
  it('parses and emits a filter+find sequence in a fn body', () => {
    const source = [
      'fn name=select params="items: User[]"',
      '  filter name=active in=items where="item.active"',
      '  find name=admin in=active item=u where="u.role === \'admin\'"',
      '  handler <<<',
      '    return admin;',
      '  >>>',
      '',
    ].join('\n');

    const ast = parse(source);
    const fn = ast.type === 'fn' ? ast : ast.children?.find((c) => c.type === 'fn');
    expect(fn).toBeDefined();

    const filterNode = (fn as IRNode).children?.find((c) => c.type === 'filter');
    const findNode = (fn as IRNode).children?.find((c) => c.type === 'find');
    expect(filterNode).toBeDefined();
    expect(findNode).toBeDefined();
    expect((filterNode as IRNode).props?.name).toBe('active');
    expect((findNode as IRNode).props?.name).toBe('admin');
  });
});
