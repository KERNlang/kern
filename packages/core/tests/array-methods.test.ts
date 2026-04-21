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
  generateAt,
  generateConcat,
  generateCoreNode,
  generateEvery,
  generateFilter,
  generateFind,
  generateFindIndex,
  generateFlat,
  generateFlatMap,
  generateForEach,
  generateIncludes,
  generateIndexOf,
  generateJoin,
  generateLastIndexOf,
  generateMap,
  generateReduce,
  generateReverse,
  generateSlice,
  generateSome,
  generateSort,
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

  it('registers all nineteen array primitives as core node types', () => {
    for (const t of [
      'filter',
      'find',
      'some',
      'every',
      'findIndex',
      'reduce',
      'map',
      'flatMap',
      'flat',
      'slice',
      'at',
      'sort',
      'reverse',
      'join',
      'includes',
      'indexOf',
      'lastIndexOf',
      'concat',
      'forEach',
    ]) {
      expect(isCoreNode(t)).toBe(true);
    }
  });
});

describe('Ground Layer: reduce', () => {
  it('defaults acc to `acc` and item to `item` and emits the .reduce(...) shape', () => {
    const node = mk('reduce', { name: 'total', in: 'items', initial: '0', expr: 'acc + item.value' });
    const code = generateReduce(node).join('\n');
    expect(code).toBe('export const total = (items).reduce((acc, item) => acc + item.value, 0);');
  });

  it('honours explicit acc= and item= renames', () => {
    const node = mk('reduce', { name: 'total', in: 'items', acc: 'sum', item: 'x', initial: '0', expr: 'sum + x.v' });
    const code = generateReduce(node).join('\n');
    expect(code).toBe('export const total = (items).reduce((sum, x) => sum + x.v, 0);');
  });

  it('applies type annotation and respects export=false', () => {
    const node = mk('reduce', {
      name: 'total',
      in: 'items',
      initial: '0',
      expr: 'acc + item.v',
      type: 'number',
      export: 'false',
    });
    const code = generateReduce(node).join('\n');
    expect(code).toBe('const total: number = (items).reduce((acc, item) => acc + item.v, 0);');
  });

  it('throws on missing in, initial, or expr', () => {
    expect(() => generateReduce(mk('reduce', { name: 'x', initial: '0', expr: 'acc' }))).toThrow(/reduce .* 'in' prop/);
    expect(() => generateReduce(mk('reduce', { name: 'x', in: 'xs', expr: 'acc' }))).toThrow(
      /reduce .* 'initial' prop/,
    );
    expect(() => generateReduce(mk('reduce', { name: 'x', in: 'xs', initial: '0' }))).toThrow(/reduce .* 'expr' prop/);
  });
});

describe('Ground Layer: flatMap', () => {
  it('emits `.flatMap(...)` with default item binding', () => {
    const node = mk('flatMap', { name: 'tags', in: 'posts', expr: 'item.tags' });
    const code = generateFlatMap(node).join('\n');
    expect(code).toBe('export const tags = (posts).flatMap((item) => item.tags);');
  });

  it('honours explicit item= and type annotation', () => {
    const node = mk('flatMap', { name: 'tags', in: 'posts', item: 'p', expr: 'p.tags', type: 'string[]' });
    const code = generateFlatMap(node).join('\n');
    expect(code).toBe('export const tags: string[] = (posts).flatMap((p) => p.tags);');
  });

  it('throws on missing in or expr', () => {
    expect(() => generateFlatMap(mk('flatMap', { name: 'x', expr: 'item' }))).toThrow(/flatMap .* 'in' prop/);
    expect(() => generateFlatMap(mk('flatMap', { name: 'x', in: 'xs' }))).toThrow(/flatMap .* 'expr' prop/);
  });
});

describe('Ground Layer: slice', () => {
  it('emits `.slice(start, end)` when both indices are supplied', () => {
    const node = mk('slice', { name: 'first5', in: 'items', start: '0', end: '5' });
    const code = generateSlice(node).join('\n');
    expect(code).toBe('export const first5 = (items).slice(0, 5);');
  });

  it('emits `.slice(start)` when only start is supplied', () => {
    const node = mk('slice', { name: 'tail', in: 'items', start: '2' });
    const code = generateSlice(node).join('\n');
    expect(code).toBe('export const tail = (items).slice(2);');
  });

  it('emits `.slice(0, end)` when only end is supplied (start defaults to 0)', () => {
    const node = mk('slice', { name: 'head', in: 'items', end: '3' });
    const code = generateSlice(node).join('\n');
    expect(code).toBe('export const head = (items).slice(0, 3);');
  });

  it('emits `.slice()` when neither start nor end is supplied (full copy)', () => {
    const node = mk('slice', { name: 'copy', in: 'items' });
    const code = generateSlice(node).join('\n');
    expect(code).toBe('export const copy = (items).slice();');
  });

  it('throws on missing in', () => {
    expect(() => generateSlice(mk('slice', { name: 'x' }))).toThrow(/slice .* 'in' prop/);
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

describe('Ground Layer: map', () => {
  it('emits `.map(...)` with default item binding', () => {
    const node = mk('map', { name: 'names', in: 'users', expr: 'item.name' });
    expect(generateMap(node).join('\n')).toBe('export const names = (users).map((item) => item.name);');
  });

  it('honours explicit item= and type annotation', () => {
    const node = mk('map', { name: 'names', in: 'users', item: 'u', expr: 'u.name', type: 'string[]' });
    expect(generateMap(node).join('\n')).toBe('export const names: string[] = (users).map((u) => u.name);');
  });

  it('respects export=false', () => {
    const node = mk('map', { name: 'names', in: 'users', expr: 'item.name', export: 'false' });
    expect(generateMap(node).join('\n')).toBe('const names = (users).map((item) => item.name);');
  });

  it('throws on missing in or expr', () => {
    expect(() => generateMap(mk('map', { name: 'x', expr: 'item' }))).toThrow(/map .* 'in' prop/);
    expect(() => generateMap(mk('map', { name: 'x', in: 'xs' }))).toThrow(/map .* 'expr' prop/);
  });
});

describe('Ground Layer: findIndex', () => {
  it('emits `.findIndex(...)` with default item binding', () => {
    const node = mk('findIndex', { name: 'pos', in: 'users', where: 'item.active' });
    expect(generateFindIndex(node).join('\n')).toBe('export const pos = (users).findIndex((item) => item.active);');
  });

  it('supports type=number', () => {
    const node = mk('findIndex', { name: 'pos', in: 'users', where: 'item.id === target', type: 'number' });
    expect(generateFindIndex(node).join('\n')).toBe(
      'export const pos: number = (users).findIndex((item) => item.id === target);',
    );
  });

  it('throws on missing in or where', () => {
    expect(() => generateFindIndex(mk('findIndex', { name: 'x', where: 'item.ok' }))).toThrow(/findIndex .* 'in' prop/);
    expect(() => generateFindIndex(mk('findIndex', { name: 'x', in: 'xs' }))).toThrow(/findIndex .* 'where' prop/);
  });
});

describe('Ground Layer: sort', () => {
  it('bare sort emits `[...coll].sort()`', () => {
    const node = mk('sort', { name: 'sorted', in: 'items' });
    expect(generateSort(node).join('\n')).toBe('export const sorted = [...(items)].sort();');
  });

  it('with compare emits `[...coll].sort((a, b) => body)`', () => {
    const node = mk('sort', { name: 'sorted', in: 'items', compare: 'a.age - b.age' });
    expect(generateSort(node).join('\n')).toBe('export const sorted = [...(items)].sort((a, b) => a.age - b.age);');
  });

  it('honours a=/b= binding renames', () => {
    const node = mk('sort', { name: 'sorted', in: 'items', a: 'x', b: 'y', compare: 'x.n - y.n' });
    expect(generateSort(node).join('\n')).toBe('export const sorted = [...(items)].sort((x, y) => x.n - y.n);');
  });

  it('never mutates — always spreads the source collection', () => {
    const node = mk('sort', { name: 'sorted', in: 'original', compare: 'a - b' });
    const code = generateSort(node).join('\n');
    expect(code).toContain('[...(original)]');
    expect(code).not.toContain('(original).sort');
  });

  it('throws on missing in', () => {
    expect(() => generateSort(mk('sort', { name: 'x' }))).toThrow(/sort .* 'in' prop/);
  });
});

describe('Ground Layer: reverse', () => {
  it('emits `[...coll].reverse()` (immutable)', () => {
    const node = mk('reverse', { name: 'reversed', in: 'items' });
    expect(generateReverse(node).join('\n')).toBe('export const reversed = [...(items)].reverse();');
  });

  it('applies type annotation', () => {
    const node = mk('reverse', { name: 'reversed', in: 'items', type: 'number[]' });
    expect(generateReverse(node).join('\n')).toBe('export const reversed: number[] = [...(items)].reverse();');
  });

  it('throws on missing in', () => {
    expect(() => generateReverse(mk('reverse', { name: 'x' }))).toThrow(/reverse .* 'in' prop/);
  });
});

describe('Ground Layer: flat', () => {
  it('emits `.flat()` with no depth', () => {
    const node = mk('flat', { name: 'flattened', in: 'nested' });
    expect(generateFlat(node).join('\n')).toBe('export const flattened = (nested).flat();');
  });

  it('emits `.flat(depth)` when depth is supplied', () => {
    const node = mk('flat', { name: 'flattened', in: 'nested', depth: '2' });
    expect(generateFlat(node).join('\n')).toBe('export const flattened = (nested).flat(2);');
  });

  it('throws on missing in', () => {
    expect(() => generateFlat(mk('flat', { name: 'x' }))).toThrow(/flat .* 'in' prop/);
  });
});

describe('Ground Layer: at', () => {
  it('emits `.at(index)` for positive indices', () => {
    const node = mk('at', { name: 'first', in: 'items', index: '0' });
    expect(generateAt(node).join('\n')).toBe('export const first = (items).at(0);');
  });

  it('supports negative indices for tail access', () => {
    const node = mk('at', { name: 'last', in: 'items', index: '-1' });
    expect(generateAt(node).join('\n')).toBe('export const last = (items).at(-1);');
  });

  it('throws on missing in or index', () => {
    expect(() => generateAt(mk('at', { name: 'x', index: '0' }))).toThrow(/at .* 'in' prop/);
    expect(() => generateAt(mk('at', { name: 'x', in: 'xs' }))).toThrow(/at .* 'index' prop/);
  });
});

describe('Ground Layer: join', () => {
  it('emits bare `.join()` when no separator is supplied', () => {
    const node = mk('join', { name: 'joined', in: 'fields' });
    expect(generateJoin(node).join('\n')).toBe('export const joined = (fields).join();');
  });

  it('emits `.join(",")` with a quoted string separator', () => {
    const node = mk('join', { name: 'csv', in: 'fields', separator: ',' });
    expect(generateJoin(node).join('\n')).toBe("export const csv = (fields).join(',');");
  });

  it('emits `.join("")` for an empty-string separator', () => {
    const node = mk('join', { name: 'concat', in: 'parts', separator: '' });
    expect(generateJoin(node).join('\n')).toBe("export const concat = (parts).join('');");
  });

  it('accepts an expression separator via __expr wrapping', () => {
    const node = mk('join', {
      name: 'csv',
      in: 'fields',
      separator: { __expr: true, code: 'delim' },
    });
    expect(generateJoin(node).join('\n')).toBe('export const csv = (fields).join(delim);');
  });

  it('escapes single quotes inside a plain-string separator', () => {
    const node = mk('join', { name: 'csv', in: 'parts', separator: "a'b" });
    expect(generateJoin(node).join('\n')).toBe("export const csv = (parts).join('a\\'b');");
  });

  it('throws on missing in', () => {
    expect(() => generateJoin(mk('join', { name: 'x' }))).toThrow(/join .* 'in' prop/);
  });
});

describe('Ground Layer: includes / indexOf / lastIndexOf', () => {
  it('includes emits .includes(value)', () => {
    const node = mk('includes', { name: 'hasFatal', in: 'errors', value: "'fatal'" });
    expect(generateIncludes(node).join('\n')).toBe("export const hasFatal = (errors).includes('fatal');");
  });

  it('indexOf emits .indexOf(value)', () => {
    const node = mk('indexOf', { name: 'pos', in: 'items', value: 'target' });
    expect(generateIndexOf(node).join('\n')).toBe('export const pos = (items).indexOf(target);');
  });

  it('lastIndexOf emits .lastIndexOf(value)', () => {
    const node = mk('lastIndexOf', { name: 'pos', in: 'items', value: 'target' });
    expect(generateLastIndexOf(node).join('\n')).toBe('export const pos = (items).lastIndexOf(target);');
  });

  it('passes `from` as a second arg when supplied', () => {
    const node = mk('indexOf', { name: 'pos', in: 'items', value: 'target', from: '5' });
    expect(generateIndexOf(node).join('\n')).toBe('export const pos = (items).indexOf(target, 5);');
  });

  it('each of the three throws on missing in / value', () => {
    expect(() => generateIncludes(mk('includes', { name: 'x', value: '0' }))).toThrow(/includes .* 'in' prop/);
    expect(() => generateIndexOf(mk('indexOf', { name: 'x', in: 'xs' }))).toThrow(/indexOf .* 'value' prop/);
    expect(() => generateLastIndexOf(mk('lastIndexOf', { name: 'x' }))).toThrow(/lastIndexOf .* 'in' prop/);
  });
});

describe('Ground Layer: concat', () => {
  it('emits `.concat(other)` with a single-arg with=', () => {
    const node = mk('concat', { name: 'all', in: 'items', with: 'other' });
    expect(generateConcat(node).join('\n')).toBe('export const all = (items).concat(other);');
  });

  it('emits `.concat(a, b)` when with= is a comma-separated spread', () => {
    const node = mk('concat', { name: 'all', in: 'items', with: 'a, b' });
    expect(generateConcat(node).join('\n')).toBe('export const all = (items).concat(a, b);');
  });

  it('throws on missing in or with', () => {
    expect(() => generateConcat(mk('concat', { name: 'x', with: 'other' }))).toThrow(/concat .* 'in' prop/);
    expect(() => generateConcat(mk('concat', { name: 'x', in: 'xs' }))).toThrow(/concat .* 'with' prop/);
  });
});

describe('Ground Layer: forEach', () => {
  it('emits `.forEach((item) => { body });` as a statement', () => {
    const node = mk('forEach', { in: 'items' }, [mk('handler', { code: 'doSomething(item);' })]);
    const code = generateForEach(node).join('\n');
    expect(code).toBe(['(items).forEach((item) => {', '  doSomething(item);', '});'].join('\n'));
  });

  it('emits no `const` binding and no `name`', () => {
    const node = mk('forEach', { in: 'items' }, [mk('handler', { code: 'log(item);' })]);
    const code = generateForEach(node).join('\n');
    expect(code).not.toContain('const ');
    expect(code).not.toContain('export');
  });

  it('honours item= and index= parameter renames', () => {
    const node = mk('forEach', { in: 'items', item: 'row', index: 'i' }, [mk('handler', { code: 'log(row, i);' })]);
    const code = generateForEach(node).join('\n');
    expect(code).toContain('(items).forEach((row, i) => {');
    expect(code).toContain('log(row, i);');
  });

  it('throws when the handler child is missing', () => {
    expect(() => generateForEach(mk('forEach', { in: 'items' }))).toThrow(/forEach .* `handler <<<>>>` child/);
  });

  it('throws on missing in', () => {
    expect(() => generateForEach(mk('forEach', {}, [mk('handler', { code: 'x' })]))).toThrow(/forEach .* 'in' prop/);
  });
});
