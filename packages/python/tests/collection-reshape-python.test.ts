import type { IRNode } from '@kernlang/core';
import {
  generateCountBy,
  generateGroupBy,
  generateIndexBy,
  generatePartition,
  generatePythonCoreNode,
  generateUniqueBy,
} from '../src/codegen-python.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('Python Ground Layer: collection reshape parity', () => {
  it('rejects unsafe Python binding names', () => {
    expect(() =>
      generatePartition(mk('partition', { pass: 'for', fail: 'inactive', in: 'users', where: 'item.active' })),
    ).toThrow(/unsafe Python binding name `for`/);
  });

  it('emits uniqueBy first-wins python code', () => {
    const node = mk('uniqueBy', { name: 'distinct', in: 'users', by: 'item.id' });
    const code = generateUniqueBy(node).join('\n');
    expect(code).toContain('distinct = []');
    expect(code).toContain('__kern_seen_distinct = set()');
    expect(code).toContain('for item in users:');
    expect(code).toContain('__kern_key_distinct = item.id');
    expect(code).toContain('if __kern_key_distinct is None:');
    expect(code).toContain('__kern_seen_key_distinct = ("null", None)');
    expect(code).toContain('__kern_seen_key_distinct = ("boolean", __kern_key_distinct)');
    expect(code).toContain('__kern_seen_key_distinct = ("number", "NaN")');
    expect(code).toContain('__kern_seen_key_distinct = ("number", __kern_key_distinct)');
    expect(code).toContain('__kern_seen_key_distinct = ("string", __kern_key_distinct)');
    expect(code).toContain('__kern_seen_objects_distinct = []');
    expect(code).toContain('for __kern_seen_object_distinct in __kern_seen_objects_distinct:');
    expect(code).toContain('if __kern_key_distinct is __kern_seen_object_distinct:');
    expect(code).toContain('__kern_seen_objects_distinct.append(__kern_key_distinct)');
    expect(code).toContain('continue');
    expect(code).toContain('if __kern_seen_key_distinct not in __kern_seen_distinct:');
    expect(code).toContain('__kern_seen_distinct.add(__kern_seen_key_distinct)');
    expect(code).toContain('distinct.append(item)');
  });

  it('emits groupBy buckets python code', () => {
    const node = mk('groupBy', { name: 'by_type', in: 'items', by: 'item.type' });
    const code = generateGroupBy(node).join('\n');
    expect(code).toContain('by_type = {}');
    expect(code).toContain('for item in items:');
    expect(code).toContain('__kern_key_by_type = item.type');
    expect(code).toContain('if __kern_key_by_type is None:');
    expect(code).toContain('__kern_key_by_type = "null"');
    expect(code).toContain('__kern_key_by_type = "true" if __kern_key_by_type else "false"');
    expect(code).toContain('__kern_key_by_type = "NaN"');
    expect(code).toContain('__kern_key_by_type = "Infinity"');
    expect(code).toContain('__kern_key_by_type = "-Infinity"');
    expect(code).toContain('elif isinstance(__kern_key_by_type, float):');
    expect(code).toContain('elif __kern_key_by_type.is_integer():');
    expect(code).toContain('__kern_key_by_type = str(int(__kern_key_by_type))');
    expect(code).toContain('raise TypeError("keyed reshape selector must produce a scalar key")');
    expect(code).toContain('by_type.setdefault(__kern_key_by_type, []).append(item)');
  });

  it('emits partition two-list split python code', () => {
    const node = mk('partition', { pass: 'active', fail: 'inactive', in: 'users', where: 'item.active' });
    const code = generatePartition(node).join('\n');
    expect(code).toContain('active = []');
    expect(code).toContain('inactive = []');
    expect(code).toContain('for item in users:');
    expect(code).toContain('if item.active:');
    expect(code).toContain('active.append(item)');
    expect(code).toContain('else:');
    expect(code).toContain('inactive.append(item)');
  });

  it('annotates partition outputs with the element type when provided', () => {
    const node = mk('partition', { pass: 'active', fail: 'inactive', in: 'users', where: 'item.active', type: 'User' });
    const code = generatePartition(node).join('\n');
    expect(code).toContain('active: list[User] = []');
    expect(code).toContain('inactive: list[User] = []');
  });

  it('emits indexBy last-write-wins python code', () => {
    const node = mk('indexBy', { name: 'by_id', in: 'users', by: 'item.id' });
    const code = generateIndexBy(node).join('\n');
    expect(code).toContain('by_id = {}');
    expect(code).toContain('for item in users:');
    expect(code).toContain('__kern_key_by_id = item.id');
    expect(code).toContain('if __kern_key_by_id is None:');
    expect(code).toContain('__kern_key_by_id = "null"');
    expect(code).toContain('__kern_key_by_id = "true" if __kern_key_by_id else "false"');
    expect(code).toContain('__kern_key_by_id = "NaN"');
    expect(code).toContain('elif isinstance(__kern_key_by_id, float):');
    expect(code).toContain('elif __kern_key_by_id.is_integer():');
    expect(code).toContain('__kern_key_by_id = str(int(__kern_key_by_id))');
    expect(code).toContain('raise TypeError("keyed reshape selector must produce a scalar key")');
    expect(code).toContain('by_id[__kern_key_by_id] = item');
  });

  it('emits countBy counts python code', () => {
    const node = mk('countBy', { name: 'counts', in: 'items', by: 'item.type' });
    const code = generateCountBy(node).join('\n');
    expect(code).toContain('counts = {}');
    expect(code).toContain('for item in items:');
    expect(code).toContain('__kern_key_counts = item.type');
    expect(code).toContain('if __kern_key_counts is None:');
    expect(code).toContain('__kern_key_counts = "null"');
    expect(code).toContain('__kern_key_counts = "true" if __kern_key_counts else "false"');
    expect(code).toContain('__kern_key_counts = "NaN"');
    expect(code).toContain('elif isinstance(__kern_key_counts, float):');
    expect(code).toContain('elif __kern_key_counts.is_integer():');
    expect(code).toContain('__kern_key_counts = str(int(__kern_key_counts))');
    expect(code).toContain('raise TypeError("keyed reshape selector must produce a scalar key")');
    expect(code).toContain('counts[__kern_key_counts] = counts.get(__kern_key_counts, 0) + 1');
  });

  it('treats type= as the full output container type except partition element type', () => {
    expect(
      generateUniqueBy(mk('uniqueBy', { name: 'distinct', in: 'users', by: 'item.id', type: 'User[]' })).join('\n'),
    ).toContain('distinct: list[User] = []');
    expect(
      generateGroupBy(
        mk('groupBy', { name: 'by_type', in: 'items', by: 'item.type', type: 'Record<string, User[]>' }),
      ).join('\n'),
    ).toContain('by_type: dict[str, list[User]] = {}');
    expect(
      generateIndexBy(mk('indexBy', { name: 'by_id', in: 'users', by: 'item.id', type: 'Record<string, User>' })).join(
        '\n',
      ),
    ).toContain('by_id: dict[str, User] = {}');
    expect(
      generateCountBy(mk('countBy', { name: 'counts', in: 'items', by: 'item.type', type: 'dict[str, int]' })).join(
        '\n',
      ),
    ).toContain('counts: dict[str, int] = {}');
    expect(
      generatePartition(
        mk('partition', { pass: 'active', fail: 'inactive', in: 'users', where: 'item.active', type: 'User' }),
      ).join('\n'),
    ).toContain('active: list[User] = []');
  });

  it('dispatches keyed reshape nodes through generatePythonCoreNode', () => {
    expect(
      generatePythonCoreNode(mk('uniqueBy', { name: 'distinct', in: 'users', by: 'item.id' })).join('\n'),
    ).toContain('distinct.append(item)');
    expect(
      generatePythonCoreNode(mk('groupBy', { name: 'by_type', in: 'items', by: 'item.type' })).join('\n'),
    ).toContain('by_type.setdefault(__kern_key_by_type, []).append(item)');
    expect(
      generatePythonCoreNode(
        mk('partition', { pass: 'active', fail: 'inactive', in: 'users', where: 'item.active' }),
      ).join('\n'),
    ).toContain('inactive.append(item)');
    expect(generatePythonCoreNode(mk('indexBy', { name: 'by_id', in: 'users', by: 'item.id' })).join('\n')).toContain(
      'by_id[__kern_key_by_id] = item',
    );
    expect(
      generatePythonCoreNode(mk('countBy', { name: 'counts', in: 'items', by: 'item.type' })).join('\n'),
    ).toContain('counts[__kern_key_counts] = counts.get(__kern_key_counts, 0) + 1');
  });

  it('rejects missing source and selector props', () => {
    expect(() => generateUniqueBy(mk('uniqueBy', { name: 'x', by: 'item.id' }))).toThrow(/uniqueBy .* 'in' prop/);
    expect(() => generateUniqueBy(mk('uniqueBy', { name: 'x', in: 'xs' }))).toThrow(/uniqueBy .* 'by' prop/);
    expect(() => generateGroupBy(mk('groupBy', { name: 'x', by: 'item.id' }))).toThrow(/groupBy .* 'in' prop/);
    expect(() => generateGroupBy(mk('groupBy', { name: 'x', in: 'xs' }))).toThrow(/groupBy .* 'by' prop/);
    expect(() => generatePartition(mk('partition', { pass: 'a', fail: 'b', where: 'item.ok' }))).toThrow(
      /partition .* 'in' prop/,
    );
    expect(() => generatePartition(mk('partition', { pass: 'a', fail: 'b', in: 'xs' }))).toThrow(
      /partition .* 'where' prop/,
    );
    expect(() => generatePartition(mk('partition', { fail: 'b', in: 'xs', where: 'item.ok' }))).toThrow(
      /partition .* 'pass' prop/,
    );
    expect(() => generatePartition(mk('partition', { pass: 'a', in: 'xs', where: 'item.ok' }))).toThrow(
      /partition .* 'fail' prop/,
    );
    expect(() => generateIndexBy(mk('indexBy', { name: 'x', by: 'item.id' }))).toThrow(/indexBy .* 'in' prop/);
    expect(() => generateIndexBy(mk('indexBy', { name: 'x', in: 'xs' }))).toThrow(/indexBy .* 'by' prop/);
    expect(() => generateCountBy(mk('countBy', { name: 'x', by: 'item.id' }))).toThrow(/countBy .* 'in' prop/);
    expect(() => generateCountBy(mk('countBy', { name: 'x', in: 'xs' }))).toThrow(/countBy .* 'by' prop/);
  });
});
