import type { IRNode } from '@kernlang/core';
import { emitPureHandlers } from '../src/core/handlers/index.js';

function routeWith(child: IRNode): IRNode {
  return {
    type: 'server',
    props: { name: 'API' },
    children: [
      {
        type: 'route',
        props: { method: 'post', path: '/api/t' },
        children: [
          child,
          {
            type: 'respond',
            props: { status: 200, json: { __expr: true, code: '{ ok: true }' } },
          },
        ],
      },
    ],
  };
}

describe('pure Python handlers: keyed reshape route scope', () => {
  test('uses the correct node label when rejecting unsafe count and uniqueBy names', () => {
    const countServer = routeWith({ type: 'count', props: { name: 'class', in: 'users' } });
    expect(() => emitPureHandlers(countServer, new Set(), countServer)).toThrow(
      /count emits unsafe Python binding name `class`/,
    );
    const uniqueByServer = routeWith({ type: 'uniqueBy', props: { name: 'class', in: 'users', by: 'item.id' } });
    expect(() => emitPureHandlers(uniqueByServer, new Set(), uniqueByServer)).toThrow(
      /uniqueBy emits unsafe Python binding name `class`/,
    );
  });

  test('rejects unsafe Python binding names', () => {
    const server = routeWith({ type: 'countBy', props: { name: 'class', in: 'users', by: 'item.type' } });
    expect(() => emitPureHandlers(server, new Set(), server)).toThrow(/unsafe Python binding name `class`/);
  });

  test('lowers uniqueBy node correctly', () => {
    const server = routeWith({ type: 'uniqueBy', props: { name: 'distinct', in: 'users', by: 'item.id' } });
    const handlers = emitPureHandlers(server, new Set(), server);
    expect(handlers).toHaveLength(1);
    const body = handlers[0].bodyLines.join('\n');
    expect(body).toContain('distinct = []');
    expect(body).toContain('__kern_seen_distinct = set()');
    expect(body).toContain('for item in users:');
    expect(body).toContain('__kern_key_distinct = item.id');
    expect(body).toContain('if __kern_key_distinct is None:');
    expect(body).toContain('__kern_seen_key_distinct = ("null", None)');
    expect(body).toContain('__kern_seen_key_distinct = ("boolean", __kern_key_distinct)');
    expect(body).toContain('__kern_seen_key_distinct = ("number", "NaN")');
    expect(body).toContain('__kern_seen_key_distinct = ("number", __kern_key_distinct)');
    expect(body).toContain('__kern_seen_key_distinct = ("string", __kern_key_distinct)');
    expect(body).toContain('__kern_seen_objects_distinct = []');
    expect(body).toContain('for __kern_seen_object_distinct in __kern_seen_objects_distinct:');
    expect(body).toContain('if __kern_key_distinct is __kern_seen_object_distinct:');
    expect(body).toContain('__kern_seen_objects_distinct.append(__kern_key_distinct)');
    expect(body).toContain('continue');
    expect(body).toContain('if __kern_seen_key_distinct not in __kern_seen_distinct:');
    expect(body).toContain('__kern_seen_distinct.add(__kern_seen_key_distinct)');
    expect(body).toContain('distinct.append(item)');
  });

  test('lowers filter predicate node with helper-backed evaluation', () => {
    const server = routeWith({
      type: 'filter',
      props: {
        name: 'eligible',
        in: 'users',
        predicate: { __expr: true, code: '{and: [{eq: ["active", true]}, {gte: ["age", 18]}]}' },
      },
    });
    const handlers = emitPureHandlers(server, new Set(), server);
    expect(handlers).toHaveLength(1);
    const body = handlers[0].bodyLines.join('\n');
    expect(body).toContain('def __kern_get_path_eligible(record, path):');
    expect(body).toContain('def __kern_eval_predicate_eligible(predicate, record):');
    expect(body).toContain('__kern_predicate_eligible = {"and": [{"eq": ["active", True]}, {"gte": ["age", 18]}]}');
    expect(body).toContain(
      'eligible = [item for item in users if __kern_eval_predicate_eligible(__kern_predicate_eligible, item)]',
    );
  });

  test('lowers filter predicate node with or/not composition', () => {
    const server = routeWith({
      type: 'filter',
      props: {
        name: 'eligible',
        in: 'users',
        predicate: {
          __expr: true,
          code: '{and: [{or: [{eq: ["role", "admin"]}, {eq: ["role", "staff"]}]}, {not: {eq: ["status", "banned"]}}]}',
        },
      },
    });
    const handlers = emitPureHandlers(server, new Set(), server);
    expect(handlers).toHaveLength(1);
    const body = handlers[0].bodyLines.join('\n');
    expect(body).toContain('if "or" in predicate:');
    expect(body).toContain('return any(__kern_eval_predicate_eligible(p, record) for p in predicate["or"])');
    expect(body).toContain('if "not" in predicate:');
    expect(body).toContain('return not __kern_eval_predicate_eligible(predicate["not"], record)');
    expect(body).toContain(
      '__kern_predicate_eligible = {"and": [{"or": [{"eq": ["role", "admin"]}, {"eq": ["role", "staff"]}]}, {"not": {"eq": ["status", "banned"]}}]}',
    );
  });

  test('lowers filter predicate node with richer leaf predicates', () => {
    const server = routeWith({
      type: 'filter',
      props: {
        name: 'eligible',
        in: 'users',
        predicate: {
          __expr: true,
          code: '{and: [{exists: "profile.tags.0"}, {in: ["role", ["admin", "staff"]]}, {nin: ["status", ["banned"]]}, {contains: ["profile.tags", "vip"]}, {startsWith: ["email", "a"]}, {endsWith: ["email", ".com"]}]}',
        },
      },
    });
    const handlers = emitPureHandlers(server, new Set(), server);
    expect(handlers).toHaveLength(1);
    const body = handlers[0].bodyLines.join('\n');
    expect(body).toContain('if "exists" in predicate:');
    expect(body).toContain('if op in ("in", "nin"):');
    expect(body).toContain('if op == "contains":');
    expect(body).toContain('if op in ("startsWith", "endsWith"):');
    expect(body).toContain(
      '__kern_predicate_eligible = {"and": [{"exists": "profile.tags.0"}, {"in": ["role", ["admin", "staff"]]}, {"nin": ["status", ["banned"]]}, {"contains": ["profile.tags", "vip"]}, {"startsWith": ["email", "a"]}, {"endsWith": ["email", ".com"]}]}',
    );
  });

  test('lowers count predicate node with helper-backed evaluation', () => {
    const server = routeWith({
      type: 'count',
      props: {
        name: 'eligible_count',
        in: 'users',
        predicate: { __expr: true, code: '{and: [{lt: ["age", 30]}, {lte: ["score", 10]}]}' },
      },
    });
    const handlers = emitPureHandlers(server, new Set(), server);
    expect(handlers).toHaveLength(1);
    const body = handlers[0].bodyLines.join('\n');
    expect(body).toContain('def __kern_eval_predicate_eligible_count(predicate, record):');
    expect(body).toContain('__kern_predicate_eligible_count = {"and": [{"lt": ["age", 30]}, {"lte": ["score", 10]}]}');
    expect(body).toContain(
      'eligible_count = sum(1 for item in users if __kern_eval_predicate_eligible_count(__kern_predicate_eligible_count, item))',
    );
  });

  test('lowers route object merge, pick, and omit nodes', () => {
    const server = {
      type: 'server',
      props: { name: 'API' },
      children: [
        {
          type: 'route',
          props: { method: 'post', path: '/api/t' },
          children: [
            {
              type: 'objectMerge',
              props: { name: 'merged', sources: 'body.user, body.override, { "role": "member" }' },
            },
            {
              type: 'objectPick',
              props: { name: 'public_user', in: 'merged', keys: "['id', 'missing', 'count', 'enabled', 'role']" },
            },
            {
              type: 'objectOmit',
              props: { name: 'safe_user', in: 'merged', keys: "['password', 'token']" },
            },
            {
              type: 'respond',
              props: { status: 200, json: { __expr: true, code: '{ publicUser: public_user, safeUser: safe_user }' } },
            },
          ],
        },
      ],
    } satisfies IRNode;
    const handlers = emitPureHandlers(server, new Set(), server);
    expect(handlers).toHaveLength(1);
    const body = handlers[0].bodyLines.join('\n');
    expect(body).toContain('merged = {**(lambda __k_src:');
    expect(body).toContain('body.user');
    expect(body).toContain('body.override');
    expect(body).toContain('public_user = (lambda __k_dict, __k_keys:');
    expect(body).toContain('for key in __k_keys');
    expect(body).toContain('["id", "missing", "count", "enabled", "role"]');
    expect(body).toContain('safe_user = {key: value for key, value in (lambda __k_src:');
  });

  test('lowers groupBy node correctly', () => {
    const server = routeWith({ type: 'groupBy', props: { name: 'by_type', in: 'users', by: 'item.type' } });
    const handlers = emitPureHandlers(server, new Set(), server);
    expect(handlers).toHaveLength(1);
    const body = handlers[0].bodyLines.join('\n');
    expect(body).toContain('by_type = {}');
    expect(body).toContain('for item in users:');
    expect(body).toContain('__kern_key_by_type = item.type');
    expect(body).toContain('if __kern_key_by_type is None:');
    expect(body).toContain('__kern_key_by_type = "null"');
    expect(body).toContain('__kern_key_by_type = "true" if __kern_key_by_type else "false"');
    expect(body).toContain('__kern_key_by_type = "NaN"');
    expect(body).toContain('__kern_key_by_type = "Infinity"');
    expect(body).toContain('__kern_key_by_type = "-Infinity"');
    expect(body).toContain('elif isinstance(__kern_key_by_type, float):');
    expect(body).toContain('elif __kern_key_by_type.is_integer():');
    expect(body).toContain('__kern_key_by_type = str(int(__kern_key_by_type))');
    expect(body).toContain('raise TypeError("keyed reshape selector must produce a scalar key")');
    expect(body).toContain('by_type.setdefault(__kern_key_by_type, []).append(item)');
  });

  test('lowers partition node correctly', () => {
    const server = routeWith({
      type: 'partition',
      props: { pass: 'active', fail: 'inactive', in: 'users', where: 'item.active' },
    });
    const handlers = emitPureHandlers(server, new Set(), server);
    expect(handlers).toHaveLength(1);
    const body = handlers[0].bodyLines.join('\n');
    expect(body).toContain('active = []');
    expect(body).toContain('inactive = []');
    expect(body).toContain('for item in users:');
    expect(body).toContain('if item.active:');
    expect(body).toContain('active.append(item)');
    expect(body).toContain('else:');
    expect(body).toContain('inactive.append(item)');
  });

  test('lowers indexBy node correctly', () => {
    const server = routeWith({ type: 'indexBy', props: { name: 'by_id', in: 'users', by: 'item.id' } });
    const handlers = emitPureHandlers(server, new Set(), server);
    expect(handlers).toHaveLength(1);
    const body = handlers[0].bodyLines.join('\n');
    expect(body).toContain('by_id = {}');
    expect(body).toContain('for item in users:');
    expect(body).toContain('__kern_key_by_id = item.id');
    expect(body).toContain('if __kern_key_by_id is None:');
    expect(body).toContain('__kern_key_by_id = "null"');
    expect(body).toContain('__kern_key_by_id = "true" if __kern_key_by_id else "false"');
    expect(body).toContain('__kern_key_by_id = "NaN"');
    expect(body).toContain('elif isinstance(__kern_key_by_id, float):');
    expect(body).toContain('elif __kern_key_by_id.is_integer():');
    expect(body).toContain('__kern_key_by_id = str(int(__kern_key_by_id))');
    expect(body).toContain('raise TypeError("keyed reshape selector must produce a scalar key")');
    expect(body).toContain('by_id[__kern_key_by_id] = item');
  });

  test('lowers countBy node correctly', () => {
    const server = routeWith({ type: 'countBy', props: { name: 'counts', in: 'users', by: 'item.type' } });
    const handlers = emitPureHandlers(server, new Set(), server);
    expect(handlers).toHaveLength(1);
    const body = handlers[0].bodyLines.join('\n');
    expect(body).toContain('counts = {}');
    expect(body).toContain('for item in users:');
    expect(body).toContain('__kern_key_counts = item.type');
    expect(body).toContain('if __kern_key_counts is None:');
    expect(body).toContain('__kern_key_counts = "null"');
    expect(body).toContain('__kern_key_counts = "true" if __kern_key_counts else "false"');
    expect(body).toContain('__kern_key_counts = "NaN"');
    expect(body).toContain('elif isinstance(__kern_key_counts, float):');
    expect(body).toContain('elif __kern_key_counts.is_integer():');
    expect(body).toContain('__kern_key_counts = str(int(__kern_key_counts))');
    expect(body).toContain('raise TypeError("keyed reshape selector must produce a scalar key")');
    expect(body).toContain('counts[__kern_key_counts] = counts.get(__kern_key_counts, 0) + 1');
  });
});
