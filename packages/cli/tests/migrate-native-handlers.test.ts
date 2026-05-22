/** Slice 5b — `kern migrate native-handlers` rewriter tests.
 *
 *  Verifies the pure rewriter in isolation. The rewriter takes raw `.kern`
 *  source containing `handler <<< … >>>` blocks and converts the eligible
 *  ones to `handler` body-statement form. Anything outside the
 *  supported AST shape (`var`, mutable destructuring, unsupported loops, comments,
 *  block-bodied arrow functions etc.) is skipped — never half-migrated.
 *
 *  Round-trip safety is provided by the slice 5b-pre parser surface
 *  (commit aa5d69e6): rewritten output parses strict and emits the same
 *  TS as the original raw body would. The `--verify` mode in `runMigrate`
 *  is the byte-equivalence safety net at file-system level.
 */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyTS, parseDocumentStrict } from '@kernlang/core';
import { rewriteNativeHandlers } from '../src/commands/migrate-native-handlers.js';

/** Walk the parsed IR and return the first `handler` node. Used by the
 *  byte-equivalence tests below to feed a migrated handler back through
 *  emitNativeKernBodyTS and assert the compiled TS matches the raw body. */
function findHandler(node: IRNode): IRNode | undefined {
  if (node.type === 'handler') return node;
  for (const child of node.children ?? []) {
    const found = findHandler(child);
    if (found) return found;
  }
  return undefined;
}

describe('rewriteNativeHandlers — supported statement types', () => {
  test('migrates a let-assignment + return body', () => {
    const source = [
      'fn name=greet returns=string',
      '  handler <<<',
      '    const msg = who;',
      '    return msg;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);

    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain('let name=msg value="who"');
    expect(result.output).toContain('return value="msg"');
    expect(result.output).not.toContain('<<<');
  });

  test('migrates a bare return', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    return;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*return\s*$/m);
  });

  test('migrates if/else with sibling layout', () => {
    const source = [
      'fn name=classify returns=string',
      '  handler <<<',
      '    if (n > 0) {',
      '      return "positive";',
      '    } else {',
      '      return "non-positive";',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('if cond="n > 0"');
    expect(result.output).toContain('return value="\\"positive\\""');
    expect(result.output).toMatch(/^\s*else\s*$/m);
    expect(result.output).toContain('return value="\\"non-positive\\""');
  });

  test('migrates try/catch/throw', () => {
    const source = [
      'fn name=safeRun returns=number',
      '  handler <<<',
      '    try {',
      '      const x = 42;',
      '      return x;',
      '    } catch (e) {',
      '      throw new Error("bad");',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*try\s*$/m);
    expect(result.output).toContain('let name=x value="42"');
    expect(result.output).toContain('catch name=e');
    expect(result.output).toContain('throw value="new Error(\\"bad\\")"');
  });

  test('migrates for-of block to each body-statement', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const user of users) {',
      '      notify(user);',
      '    }',
      '    return;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain('each name=user in="users"');
    expect(result.output).toContain('do value="notify(user)"');
    expect(result.output).toMatch(/^\s*return\s*$/m);
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates arbitrary sync destructured pair for-of block (KERN-GAPS `for-of-sync-pair`)', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [key, value] of pairs) {',
      '      notify(key, value);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    // Value-less `entries=true` attribute MUST be absent: the source did not
    // wrap in `Object.entries(...)`, so the migration emits the bare pair form
    // which re-emits as `for (const [key, value] of pairs)` byte-cleanly.
    expect(result.output).toContain('each pairKey=key pairValue=value in="pairs"');
    expect(result.output).not.toContain('entries=true');
    expect(result.output).toContain('do value="notify(key, value)"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates Map.entries() sync pair for-of block to bare pair-mode each', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [k, v] of map.entries()) {',
      '      notify(k, v);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('each pairKey=k pairValue=v in="map.entries()"');
    expect(result.output).not.toContain('entries=true');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('does not auto-migrate arbitrary sync key-only destructured for-of block', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [key] of pairs) {',
      '      notify(key);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('does not auto-migrate arbitrary sync value-only destructured for-of block', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [, value] of pairs) {',
      '      notify(value);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('migrates Object.entries pair for-of block to entries-mode each', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {',
      '      notify(key, value);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain(
      'each pairKey=key pairValue=value in="raw as Record<string, unknown>" entries=true',
    );
    expect(result.output).toContain('do value="notify(key, value)"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates Object.entries key-only for-of block to entryKey mode', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [key] of Object.entries(raw)) {',
      '      notify(key);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('each entryKey=key in="raw" entries=true');
    expect(result.output).toContain('do value="notify(key)"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates Object.entries value-only for-of block to entryValue mode', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [, value] of Object.entries(raw)) {',
      '      notify(value);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('each entryValue=value in="raw" entries=true');
    expect(result.output).toContain('do value="notify(value)"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('does not migrate async Object.entries pair for-of block', () => {
    const source = [
      'fn name=notify returns=void async=true',
      '  handler <<<',
      '    for await (const [key, value] of Object.entries(raw)) {',
      '      await notify(key, value);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('does not migrate async one-binding entry for-of block', () => {
    const source = [
      'fn name=notify returns=void async=true',
      '  handler <<<',
      '    for await (const [key] of stream) {',
      '      await notify(key);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('migrates destructured pair for-await-of block to async pair-mode each', () => {
    const source = [
      'fn name=notify returns=void async=true',
      '  handler <<<',
      '    for await (const [key, value] of cache) {',
      '      await notify(key, value);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain('each pairKey=key pairValue=value in="cache" await=true');
    expect(result.output).toContain('do value="await notify(key, value)"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates typed for-of block to typed each body-statement', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const user: User | null of users) {',
      '      notify(user);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain('each name=user in="users" type="User | null"');
    expect(result.output).toContain('do value="notify(user)"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates for-await-of block to async each body-statement', () => {
    const source = [
      'fn name=notify returns=void async=true',
      '  handler <<<',
      '    for await (const event of events) {',
      '      await notify(event);',
      '    }',
      '    return;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain('each name=event in="events" await=true');
    expect(result.output).toContain('do value="await notify(event)"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates typed for-await-of block to typed async each body-statement', () => {
    const source = [
      'fn name=notify returns=void async=true',
      '  handler <<<',
      '    for await (const event: Event of events) {',
      '      await notify(event);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain('each name=event in="events" type="Event" await=true');
    expect(result.output).toContain('do value="await notify(event)"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates regex literals, generic calls, and non-null assertions', () => {
    const source = [
      'fn name=clean returns=string',
      '  handler <<<',
      '    const seen = new Set<string>();',
      '    const value = data[1]!;',
      '    if (/^ok$/i.test(value)) {',
      '      return value.replace(/\\s+/g, " ");',
      '    }',
      '    return value;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=seen value="new Set<string>()"');
    expect(result.output).toContain('let name=value value="data[1]!"');
    expect(result.output).toContain('if cond="/^ok$/i.test(value)"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('const seen = new Set<string>();');
    expect(ts).toContain('const value = data[1]!;');
    expect(ts).toContain('if (/^ok$/i.test(value))');
    expect(ts).toContain('return value.replace(/\\s+/g, " ");');
  });

  test('migrates while block to while body-statement', () => {
    const source = [
      'fn name=drain returns=void',
      '  handler <<<',
      '    while (queue.length > 0) {',
      '      const item = queue.shift();',
      '      process(item);',
      '    }',
      '    return;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain('while cond="queue.length > 0"');
    expect(result.output).toContain('let name=item value="queue.shift()"');
    expect(result.output).toContain('do value="process(item)"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates typed const binding to typed let body-statement', () => {
    const source = [
      'fn name=load returns="User | null"',
      '  handler <<<',
      '    const user: User | null = loadUser();',
      '    return user;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=user type="User | null" value="loadUser()"');
    expect(result.output).toContain('return value="user"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates `let x;` (no initializer) to `let kind=let`', () => {
    // KERN-GAPS gap `var-no-init` (36 handlers in Agon). TS `let x;` is
    // uninitialised + mutable; the body emitter handles missing `value=`
    // by emitting `let x = undefined;`, so the migrator just emits
    // `let name=x kind=let` (no `value=` attr).
    const source = [
      'fn name=acc returns=number',
      '  handler <<<',
      '    let pending;',
      '    pending = compute();',
      '    return pending;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=pending kind=let');
    expect(result.output).not.toMatch(/let name=pending kind=let value=/);
    expect(result.output).toContain('assign target="pending" value="compute()"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates typed `let x: T;` (no initializer) preserving the type', () => {
    const source = [
      'fn name=acc returns=void',
      '  handler <<<',
      '    let count: number;',
      '    count = items.length;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=count type="number" kind=let');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates mutable let binding with compound assignment', () => {
    const source = [
      'fn name=sum returns=number',
      '  handler <<<',
      '    let total = 0;',
      '    total += item.value;',
      '    return total;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=total kind=let value="0"');
    expect(result.output).toContain('assign target="total" op="+=" value="item.value"');
    expect(result.output).toContain('return value="total"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates typed const binding inside loop bodies', () => {
    const source = [
      'fn name=scan returns=void',
      '  handler <<<',
      '    while (running) {',
      '      const user: User = loadUser();',
      '      process(user);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('while cond="running"');
    expect(result.output).toContain('let name=user type="User" value="loadUser()"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates expression-bodied callback values', () => {
    const source = [
      'fn name=names returns="string[]"',
      '  handler <<<',
      '    const names = List.map(users, user => user.name);',
      '    return names;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=names value="List.map(users, user => user.name)"');
    expect(result.output).toContain('return value="names"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
    const handler = findHandler(parseDocumentStrict(result.output));
    expect(handler).toBeDefined();
    expect(emitNativeKernBodyTS(handler!)).toContain('const names = users.map(user => user.name);');
  });

  test('migrates string-literal union type with escaping', () => {
    const source = [
      'fn name=mode returns="string"',
      '  handler <<<',
      '    const mode: "on" | "off" = readMode();',
      '    return mode;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=mode type="\\"on\\" | \\"off\\"" value="readMode()"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates break and continue inside loop bodies', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const user of users) {',
      '      if (skip(user)) {',
      '        continue;',
      '      }',
      '      notify(user);',
      '      break;',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('each name=user in="users"');
    expect(result.output).toContain('continue');
    expect(result.output).toContain('break');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates break and continue inside try blocks in loops', () => {
    const source = [
      'fn name=scan returns=void',
      '  handler <<<',
      '    for (const item of items) {',
      '      try {',
      '        break;',
      '      } catch (err) {',
      '        continue;',
      '      }',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('each name=item in="items"');
    expect(result.output).toContain('try');
    expect(result.output).toContain('break');
    expect(result.output).toContain('continue');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates object destructuring const to destructure body-statement', () => {
    const source = [
      'fn name=load returns=string',
      '  handler <<<',
      '    const { trackId, options } = req.body;',
      '    return trackId;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('destructure kind=const source="req.body"');
    expect(result.output).toContain('binding name=trackId');
    expect(result.output).toContain('binding name=options');
    expect(result.output).toContain('return value="trackId"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates typed object destructuring const', () => {
    const source = [
      'fn name=load returns=string',
      '  handler <<<',
      '    const { trackId, options }: { trackId: string; options: Options } = req.body;',
      '    return trackId;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain(
      'destructure kind=const type="{ trackId: string; options: Options }" source="req.body"',
    );
    expect(result.output).toContain('binding name=trackId');
    expect(result.output).toContain('binding name=options');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates renamed typed object destructuring with string-literal type', () => {
    const source = [
      'fn name=load returns=string',
      '  handler <<<',
      '    const { status: mode }: { status: "active" | "paused" } = req.body;',
      '    return mode;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain(
      'destructure kind=const type="{ status: \\"active\\" | \\"paused\\" }" source="req.body"',
    );
    expect(result.output).toContain('binding name=mode key=status');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates renamed object destructuring const', () => {
    const source = [
      'fn name=load returns=string',
      '  handler <<<',
      '    const { id: trackId } = req.params;',
      '    return trackId;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('destructure kind=const source="req.params"');
    expect(result.output).toContain('binding name=trackId key=id');
  });

  test('migrates array destructuring const', () => {
    const source = [
      'fn name=pair returns=string',
      '  handler <<<',
      '    const [first, second] = values;',
      '    return first;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('destructure kind=const source="values"');
    expect(result.output).toContain('element name=first index=0');
    expect(result.output).toContain('element name=second index=1');
  });

  test('migrates object destructuring let to destructure kind=let', () => {
    const source = [
      'fn name=load returns=string',
      '  handler <<<',
      '    let { trackId, options } = req.body;',
      '    return trackId;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('destructure kind=let source="req.body"');
    expect(result.output).toContain('binding name=trackId');
    expect(result.output).toContain('binding name=options');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates const = template-literal to fmt body-stmt', () => {
    const source = [
      'fn name=summarize params="count:number" returns=string',
      '  handler <<<',
      '    const label = `${count} files`;',
      '    return label;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('fmt name=label template="${count} files"');
    expect(result.output).toContain('return value="label"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates let = template-literal to fmt kind=let', () => {
    const source = [
      'fn name=summarize params="count:number" returns=string',
      '  handler <<<',
      '    let label = `${count} files`;',
      '    return label;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('fmt name=label kind=let template="${count} files"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates `return `template-literal`` to fmt return=true', () => {
    const source = [
      'fn name=formatMs params="ms:number" returns=string',
      '  handler <<<',
      '    return `${ms}ms`;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('fmt return=true template="${ms}ms"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates const = no-substitution template (literal only)', () => {
    const source = [
      'fn name=greet returns=string',
      '  handler <<<',
      '    const msg = `hello`;',
      '    return msg;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('fmt name=msg template="hello"');
  });

  test('preserves type annotation on template-literal const', () => {
    const source = [
      'fn name=summarize params="count:number" returns=string',
      '  handler <<<',
      '    const label: string = `${count} files`;',
      '    return label;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('fmt name=label type="string" template="${count} files"');
  });

  test('migrates template-literal with `\\n` escape to fmt (template-escapes gap)', () => {
    const source = [
      'fn name=summarize returns=string',
      '  handler <<<',
      '    const msg = `line1\\nline2`;',
      '    return msg;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    // The `template=` attribute carries the raw TS source — the `\\n` in the
    // JS string literal above is a single backslash + `n` in actual source,
    // and escapeKernString doubles the `\` for KERN-attr encoding.
    expect(result.output).toContain('fmt name=msg template="line1\\\\nline2"');
  });

  test('migrates template-literal with ANSI escape (`\\x1b`) to fmt return=true', () => {
    const source = [
      'fn name=red params="text:string" returns=string',
      '  handler <<<',
      '    return `\\x1b[31m${text}\\x1b[0m`;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('fmt return=true template="\\\\x1b[31m${text}\\\\x1b[0m"');
  });

  test('migrates template-literal with `\\t` and `\\${` escapes', () => {
    const source = [
      'fn name=demo returns=string',
      '  handler <<<',
      '    const s = `col1\\tcol2 \\${literal}`;',
      '    return s;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('fmt name=s template="col1\\\\tcol2 \\\\${literal}"');
  });

  test('does NOT migrate template-literal with ES6 code-point escape (`\\u{NNNN}`)', () => {
    // `\u{1F600}` is valid TS but Python f-strings only accept `\uNNNN`/`\UNNNNNNNN`.
    // Classifier rejects this form via `hasTsOnlyTemplateEscape` to keep
    // cross-target parity; the handler stays raw `<<<>>>`.
    const source = [
      'fn name=demo returns=string',
      '  handler <<<',
      '    const s = `face: \\u{1F600}`;',
      '    return s;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('multi-line template-literal stays in raw handler (not migrated)', () => {
    const source = [
      'fn name=summarize params="count:number" returns=string',
      '  handler <<<',
      '    const label = `line one',
      'line two ${count}`;',
      '    return label;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('migrates array destructuring let to destructure kind=let', () => {
    const source = [
      'fn name=pair returns=string',
      '  handler <<<',
      '    let [first, second] = values;',
      '    return first;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('destructure kind=let source="values"');
    expect(result.output).toContain('element name=first index=0');
    expect(result.output).toContain('element name=second index=1');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates typed array destructuring const', () => {
    const source = [
      'fn name=pair returns=string',
      '  handler <<<',
      '    const [first, second]: [string, number] = values;',
      '    return first;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('destructure kind=const type="[string, number]" source="values"');
    expect(result.output).toContain('element name=first index=0');
    expect(result.output).toContain('element name=second index=1');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates typed array destructuring with elision', () => {
    const source = [
      'fn name=pair returns=boolean',
      '  handler <<<',
      '    const [first, , third]: [string, number, boolean] = values;',
      '    return third;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('destructure kind=const type="[string, number, boolean]" source="values"');
    expect(result.output).toContain('element name=first index=0');
    expect(result.output).toContain('element name=third index=2');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates TS-style type assertions inside expressions', () => {
    const source = [
      'fn name=path returns=string',
      '  handler <<<',
      '    const p = params.filePath as string;',
      '    return p;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=p value="params.filePath as string"');
    expect(result.output).toContain('return value="p"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates indexed access inside expressions', () => {
    const source = [
      'fn name=first returns=string',
      '  handler <<<',
      '    const first = items[0];',
      '    return first;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=first value="items[0]"');
    expect(result.output).toContain('return value="first"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates optional element access inside expressions', () => {
    const source = [
      'fn name=first returns=string',
      '  handler <<<',
      '    const first = items?.[0];',
      '    return users?.[first]?.name;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=first value="items?.[0]"');
    expect(result.output).toContain('return value="users?.[first]?.name"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });
});

describe('rewriteNativeHandlers — bail conditions', () => {
  test('skips handlers whose body is ineligible (block-bodied callback)', () => {
    const source = [
      'fn name=fold returns=number',
      '  handler <<<',
      '    return items.map((x) => { return x.id; });',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('skips handlers already opted into lang="kern"', () => {
    const source = ['fn name=ok returns=number', '  handler lang="kern" <<<', '    return 1;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('skips handlers with explicit non-kern lang= (lang="ts", lang="python")', () => {
    const source = ['fn name=ok returns=number', '  handler lang="ts" <<<', '    return 1;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('migrates `let X = …` to mutable KERN let', () => {
    const source = ['fn name=ok returns=number', '  handler <<<', '    let x = 1;', '    return x;', '  >>>'].join(
      '\n',
    );
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=x kind=let value="1"');
    expect(result.output).toContain('return value="x"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('bails on `var X = …` (function-scoped, body-`let` cannot preserve)', () => {
    const source = ['fn name=ok returns=number', '  handler <<<', '    var x = 1;', '    return x;', '  >>>'].join(
      '\n',
    );
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('migrates mutable destructuring let to destructure kind=let', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    let { x } = obj;',
      '    return x;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('destructure kind=let source="obj"');
    expect(result.output).toContain('binding name=x');
  });

  test('bails on destructuring (const { a } = obj)', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    const { a, ...rest } = obj;',
      '    return a;',
      '  >>>',
    ].join('\n');
    // Rest destructuring still has no structured body-statement equivalent.
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('migrates bare side-effect call to `do` body-statement (slice α-1)', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    doIt();', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain('do value="doIt()"');
  });

  test('migrates plain assignment ExpressionStatement to `assign` body-statement', () => {
    const source = [
      'fn name=ok returns=void',
      '  handler <<<',
      '    x = 1;',
      '    obj.x = x;',
      '    arr[0] = obj.x;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('assign target="x" value="1"');
    expect(result.output).toContain('assign target="obj.x" value="x"');
    expect(result.output).toContain('assign target="arr[0]" value="obj.x"');
  });

  test('migrates `this` assignment and escaped string assignment values', () => {
    const source = [
      'fn name=ok returns=void',
      '  handler <<<',
      '    this.value = "a \\"quoted\\" value";',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('assign target="this.value" value="\\"a \\\\\\"quoted\\\\\\" value\\""');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates assignment inside for-of body', () => {
    const source = [
      'fn name=ok returns=void',
      '  handler <<<',
      '    for (const item of items) {',
      '      last = item.value;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('each name=item in="items"');
    expect(result.output).toContain('assign target="last" value="item.value"');
  });

  test('bails on compound assignment ExpressionStatement', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    x &&= next;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('bails on JS-only unsigned right shift assignment', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    x >>>= 1;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('bails on compound assignment with optional-chain target', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    obj?.x += 1;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('migrates compound assignment ExpressionStatement to assign op', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    total += item.value;',
      '    obj.count += 1;',
      '    arr[0] |= mask;',
      '    this.count += 1;',
      '    mask |= Flag.Ready;',
      '    return total;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('assign target="total" op="+=" value="item.value"');
    expect(result.output).toContain('assign target="obj.count" op="+=" value="1"');
    expect(result.output).toContain('assign target="arr[0]" op="|=" value="mask"');
    expect(result.output).toContain('assign target="mask" op="|=" value="Flag.Ready"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('bails on optional-chain assignment targets', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    obj?.x = 1;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('migrates `else if` chains as nested `else > if` (body emitter collapses to `else if`)', () => {
    const source = [
      'fn name=classify returns=number',
      '  handler <<<',
      '    if (a) {',
      '      return 1;',
      '    } else if (b) {',
      '      return 2;',
      '    } else {',
      '      return 3;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain('if cond="a"');
    expect(result.output).toContain('if cond="b"');
    // The nested-`if` lives inside `else`, not as a sibling. Expressed in
    // the migrated source as nested indentation.
    expect(result.output).toMatch(/else\s*\n\s+if cond="b"/);
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrates and preserves standalone line comments', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    // explain things',
      '    return 1;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('comment raw="// explain things"');
    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('// explain things');
    expect(ts).toContain('return 1;');
  });

  test('migrates and preserves standalone block comments', () => {
    const source = ['fn name=ok returns=number', '  handler <<<', '    /* explain */', '    return 1;', '  >>>'].join(
      '\n',
    );
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('comment raw="/* explain */"');
    const handler = findHandler(parseDocumentStrict(result.output));
    expect(emitNativeKernBodyTS(handler as IRNode)).toContain('/* explain */');
  });

  test('migrates multiline block comments as portable comment text nodes', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    /* first',
      '     * second */',
      '    return 1;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('comment text="first"');
    expect(result.output).toContain('comment text="second"');
    const handler = findHandler(parseDocumentStrict(result.output));
    expect(emitNativeKernBodyTS(handler as IRNode)).toContain('// first\n// second');
  });

  test('migrates try { } finally { } (no catch) to `try` with `finally` child (KERN-GAPS try-no-catch)', () => {
    const source = [
      'fn name=ok returns=void',
      '  handler <<<',
      '    try {',
      '      return;',
      '    } finally {',
      '      return;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('try');
    expect(result.output).toContain('finally');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('preserves catch type annotation (`any`/`unknown`) when migrating try (Codex impl-review fix)', () => {
    const source = [
      'fn name=ok returns=string',
      '  handler <<<',
      '    try {',
      '      return load();',
      '    } catch (err: any) {',
      '      return err.message;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('catch name=err type=any');
  });

  test('preserves catch type annotation (`unknown`) when migrating try (kimi review nit)', () => {
    const source = [
      'fn name=ok returns=string',
      '  handler <<<',
      '    try {',
      '      return load();',
      '    } catch (err: unknown) {',
      '      return String(err);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('catch name=err type=unknown');
  });

  test('rejects catch with non-any/unknown type annotation', () => {
    const source = [
      'fn name=ok returns=string',
      '  handler <<<',
      '    try {',
      '      return load();',
      '    } catch (err: Error) {',
      '      return err.message;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('migrates try { } catch { } finally { } to try with both children (KERN-GAPS try-finally)', () => {
    const source = [
      'fn name=ok returns=string',
      '  handler <<<',
      '    try {',
      '      return load();',
      '    } catch (err) {',
      '      return "fallback";',
      '    } finally {',
      '      cleanup();',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('catch name=err');
    expect(result.output).toContain('finally');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('bails on try with neither catch nor finally (bare try)', () => {
    // A `try` with no catch and no finally is a TS parse error in practice,
    // but defensively reject it in the migrator too.
    const source = ['fn name=ok returns=void', '  handler <<<', '    try {', '      return;', '    }', '  >>>'].join(
      '\n',
    );
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('bails on for-of without a block to avoid verify drift', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    for (const x of xs) doThing(x);', '  >>>'].join(
      '\n',
    );
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('bails on empty for-of block to avoid verify drift', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    for (const x of xs) {}', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('bails on unsupported destructured for-of binding shapes', () => {
    const source = [
      'fn name=ok returns=void',
      '  handler <<<',
      '    for (const { id } of users) {',
      '      use(id);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test.each([
    ['single element', '[only]', 'use(only);'],
    ['hole', '[, value]', 'use(value);'],
    ['rest element', '[k, ...rest]', 'use(k, rest);'],
    ['default value', '[k = "fallback", v]', 'use(k, v);'],
    ['nested pattern', '[[k], v]', 'use(k, v);'],
    ['typed async pair', '[k, v]: [string, number]', 'use(k, v);'],
  ])('bails on unsupported array for-of binding shape: %s', (_name, pattern, body) => {
    const awaitPrefix = pattern.includes(':') ? 'await ' : '';
    const source = [
      'fn name=ok returns=void',
      '  handler <<<',
      `    for ${awaitPrefix}(const ${pattern} of pairs) {`,
      `      ${body}`,
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('bails on unsafe const type annotation', () => {
    const source = [
      'fn name=ok returns=unknown',
      '  handler <<<',
      '    const x: typeof import("fs") = value;',
      '    return x;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('bails on for-of with unsafe type annotation', () => {
    const source = [
      'fn name=ok returns=void',
      '  handler <<<',
      '    for (const user: typeof import("fs") of users) {',
      '      notify(user);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('typed for-of migrates compound assignment body', () => {
    const source = [
      'fn name=ok returns=void',
      '  handler <<<',
      '    for (const user: User of users) {',
      '      count += 1;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('each name=user in="users" type="User"');
    expect(result.output).toContain('assign target="count" op="+=" value="1"');
  });

  test('bails on typed destructuring with unsafe type annotation', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    const { x }: typeof import("fs") = obj;',
      '    return x;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('migrates typed destructuring inside try blocks', () => {
    const source = [
      'fn name=load returns=void',
      '  handler <<<',
      '    try {',
      '      const { id }: { id: string } = req.body;',
      '      use(id);',
      '    } catch (err) {',
      '      return;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('try');
    expect(result.output).toContain('destructure kind=const type="{ id: string }" source="req.body"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('bails on while without a block to avoid verify drift', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    while (running) tick();', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('bails on empty while block to avoid verify drift', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    while (running) {}', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('bails on break and continue outside loops', () => {
    const breakSource = ['fn name=bad returns=void', '  handler <<<', '    break;', '  >>>'].join('\n');
    const continueSource = ['fn name=bad returns=void', '  handler <<<', '    continue;', '  >>>'].join('\n');
    expect(rewriteNativeHandlers(breakSource).hits).toHaveLength(0);
    expect(rewriteNativeHandlers(continueSource).hits).toHaveLength(0);
  });

  test('bails on labeled break and continue', () => {
    const breakSource = [
      'fn name=bad returns=void',
      '  handler <<<',
      '    while (running) {',
      '      break outer;',
      '    }',
      '  >>>',
    ].join('\n');
    const continueSource = [
      'fn name=bad returns=void',
      '  handler <<<',
      '    while (running) {',
      '      continue outer;',
      '    }',
      '  >>>',
    ].join('\n');
    expect(rewriteNativeHandlers(breakSource).hits).toHaveLength(0);
    expect(rewriteNativeHandlers(continueSource).hits).toHaveLength(0);
  });
});

describe('rewriteNativeHandlers — round-trip', () => {
  test('migrated output parses strict (slice 5b-pre validators are happy)', () => {
    const source = [
      'fn name=greet returns=string',
      '  handler <<<',
      '    const msg = who;',
      '    return msg;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrated try/catch round-trips through parseDocumentStrict', () => {
    const source = [
      'fn name=safeRun returns=number',
      '  handler <<<',
      '    try {',
      '      const x = 42;',
      '      return x;',
      '    } catch (e) {',
      '      throw new Error("bad");',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('preserves indentation in nested contexts', () => {
    const source = [
      'module name=Greetings',
      '  fn name=hello returns=string',
      '    handler <<<',
      '      const m = "hi";',
      '      return m;',
      '    >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^ {4}handler\s*$/m);
    expect(result.output).toContain('      let name=m value="\\"hi\\""');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });
});

describe('rewriteNativeHandlers — review-found regressions', () => {
  // Multi-line expression initializers lift via `canonicalKernExpression`,
  // which round-trips the TS AST through `ts.createPrinter` and collapses
  // newlines outside string/template literals before escaping into the
  // attribute value. The original Codex P2 hazard — literal `\n` inside
  // `value="…"` splitting the attribute mid-string — is avoided because
  // canonicalKernExpression returns single-line text by construction.
  test('lifts multi-line expression initializer to single-line value', () => {
    const source = [
      'fn name=ok returns=any',
      '  handler <<<',
      '    const opts = {',
      '      enabled: true',
      '    };',
      '    return opts;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=opts value="{ enabled: true }"');
    expect(result.output).toContain('return value="opts"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  // Slice α-2: ternary support shipped — parseExpression accepts `a ? b : c`.
  // Bodies that previously bailed here (Codex P2 review case) now migrate.
  test('migrates ternary return (slice α-2)', () => {
    const source = ['fn name=ok returns=any', '  handler <<<', '    return ok ? a : b;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*handler\s*$/m);
    expect(result.output).toContain('return value="ok ? a : b"');
  });

  // Gemini HIGH: scanner used indexOf('>>>') instead of trimStart-startsWith,
  // so a body line containing the literal `">>>"` inside a string would be
  // truncated mid-statement. Mirror parser-core.ts:476 exactly.
  test("does not terminate body early on a string containing '>>>'", () => {
    const source = ['fn name=ok returns=string', '  handler <<<', '    return ">>>";', '  >>>'].join('\n');
    // Slice 5a classifier accepts this body, so the rewriter sees it.
    // After the fix, the body terminates only on the line that trim-starts
    // with `>>>`, so the migration is valid.
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('return value="\\">>>\\""');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  // Gemini MED: the prior AST-walk hasComments missed comments inside block
  // bodies (e.g. `if (c) { // … }`). Scanner-based detection catches all
  // comment trivia regardless of position.
  test('migrates comments inside if-block bodies', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    if (c) {',
      '      // explain',
      '      return 1;',
      '    }',
      '    return 0;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/if cond="c"\n\s+comment raw="\/\/ explain"\n\s+return value="1"/);
    const handler = findHandler(parseDocumentStrict(result.output));
    expect(emitNativeKernBodyTS(handler as IRNode)).toContain('  // explain');
  });

  // KERN-GAPS gap `comments-present` lift — tail comments after the last
  // statement now migrate as trailing `comment` body-stmts (was: skipped).
  test('migrates tail comment after the last statement', () => {
    const source = ['fn name=ok returns=number', '  handler <<<', '    return 1;', '    // tail comment', '  >>>'].join(
      '\n',
    );
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('return value="1"');
    expect(result.output).toContain('comment raw="// tail comment"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  // KERN-GAPS gap `comments-present` lift (W1) — inline same-line trailing
  // comments (`foo(); // x`) on simple single-line statements now migrate via
  // the `trailingComment=` slot. The body emitters re-emit the comment inline
  // (`stmt; // x`), so the codegen stays byte-clean under `--verify` instead
  // of dropping the comment to its own line.
  test('migrates inline same-line trailing comments via the trailingComment slot', () => {
    const source = ['fn name=ok returns=number', '  handler <<<', '    return total; // done', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.output).toContain('return value="total" trailingComment="// done"');
  });

  test('migrates multiple simple statements each carrying a trailing comment', () => {
    const source = [
      'fn name=calc returns=number',
      '  handler <<<',
      '    let total = 0; // running sum',
      '    total += 5; // add five',
      '    return total; // done',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.output).toContain('let name=total kind=let value="0" trailingComment="// running sum"');
    expect(result.output).toContain('assign target="total" op="+=" value="5" trailingComment="// add five"');
    expect(result.output).toContain('return value="total" trailingComment="// done"');
  });

  // A trailing comment on a COMPOUND statement (e.g. after `if (x) { ... }`)
  // is not a simple single-line statement, so the migrator does not lift it
  // into a `trailingComment=` slot — the handler stays raw (comments-present).
  test('does NOT migrate a trailing comment on a compound statement header', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    if (x) { // guard',
      '      return 1;',
      '    }',
      '    return 0;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.skipped.some((s) => /comments/.test(s.reason))).toBe(true);
  });

  // KERN-GAPS gap `comments-present` — tail comments inside a nested block
  // (`if (x) { foo(); // tail }`) now migrate. The migrator emits the
  // comment as a `comment` body-stmt at the end of the nested block.
  test('migrates tail comment inside a nested if-block', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    if (cond) {',
      '      return 1;',
      '      // inside-block tail',
      '    }',
      '    return 0;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('comment raw="// inside-block tail"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  // KERN-GAPS gap `comments-present` lift — multi-line block comment at
  // body tail. Migrator preserves it as a multi-line comment text node
  // (same shape mid-body multiline block comments already used).
  test('migrates multi-line block comment at body tail', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    return 1;',
      '    /* first',
      '     * second */',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('comment text="first"');
    expect(result.output).toContain('comment text="second"');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });
});

describe('rewriteNativeHandlers — multi-handler files', () => {
  test('migrates multiple handlers in one file independently', () => {
    const source = [
      'fn name=a returns=number',
      '  handler <<<',
      '    return 1;',
      '  >>>',
      'fn name=b returns=number',
      '  handler <<<',
      '    return 2;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(2);
    expect((result.output.match(/^\s*handler\s*$/gm) ?? []).length).toBe(2);
  });

  test('mixed: migrates eligible, leaves ineligible alone', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    return 1;',
      '  >>>',
      'fn name=skip returns=void',
      '  handler <<<',
      '    for (const x of xs) doSideEffect(x);',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect((result.output.match(/^\s*handler\s*$/gm) ?? []).length).toBe(1);
    // Non-block for-of would drift under --verify because `each` emits braces,
    // so the second handler stays raw `<<<…>>>`.
    expect(result.output).toContain('for (const x of xs) doSideEffect(x);');
  });
});

describe('rewriteNativeHandlers — verify contract (compiled TS byte-equivalence)', () => {
  // Slice 5b's stated guarantee is that migrated source compiles to TS that
  // is byte-equivalent to the original raw body (so `--verify` passes).
  // The else-if collapse in body-ts.ts is the load-bearing piece: without
  // it, migrated `else if` chains would compile to `} else { if (...) {...} }`
  // and `--verify` would roll back. These tests assert the contract directly:
  // migrate → parse → emitNativeKernBodyTS → compare to expected raw output.

  test('if/else if/else compiles byte-equivalent to the raw body', () => {
    const source = [
      'fn name=classify returns=number',
      '  handler <<<',
      '    if (a) {',
      '      return 1;',
      '    } else if (b) {',
      '      return 2;',
      '    } else {',
      '      return 3;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const root = parseDocumentStrict(result.output);
    const handler = findHandler(root);
    expect(handler).toBeDefined();
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('if (a) {');
    expect(ts).toContain('  return 1;');
    expect(ts).toContain('} else if (b) {');
    expect(ts).toContain('  return 2;');
    expect(ts).toContain('} else {');
    expect(ts).toContain('  return 3;');
    // Critical: NO `else { if (...) ... }` shape — that's the bug the
    // else-if collapse exists to prevent.
    expect(ts).not.toMatch(/else \{\s*if/);
    // Closing brace count: outer if/else-if/else block has exactly one
    // top-level closing brace.
    const closes = (ts.match(/^}$/gm) ?? []).length;
    expect(closes).toBe(1);
  });

  test('three-level chain (if/else if/else if/else) compiles byte-equivalent', () => {
    const source = [
      'fn name=four returns=number',
      '  handler <<<',
      '    if (a) {',
      '      return 1;',
      '    } else if (b) {',
      '      return 2;',
      '    } else if (c) {',
      '      return 3;',
      '    } else {',
      '      return 4;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('if (a) {');
    expect(ts).toContain('} else if (b) {');
    expect(ts).toContain('} else if (c) {');
    expect(ts).toContain('} else {');
    expect(ts).toContain('  return 4;');
    expect(ts).not.toMatch(/else \{\s*if/);
    const closes = (ts.match(/^}$/gm) ?? []).length;
    expect(closes).toBe(1);
  });

  test('plain if/else (no chain) compiles byte-equivalent', () => {
    const source = [
      'fn name=b returns=number',
      '  handler <<<',
      '    if (a) {',
      '      return 1;',
      '    } else {',
      '      return 2;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('if (a) {');
    expect(ts).toContain('} else {');
    expect(ts).not.toContain('else if');
  });

  test('for-of block compiles through each body-statement', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const user of users) {',
      '      notify(user);',
      '    }',
      '    return;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('for (const user of users) {');
    expect(ts).toContain('  notify(user);');
    expect(ts).toContain('}');
    expect(ts).toContain('return;');
  });

  test('typed for-of block compiles byte-equivalent through each body-statement', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const user: User | null of users) {',
      '      notify(user);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['for (const user: User | null of users) {', '  notify(user);', '}'].join('\n'));
  });

  test('typed for-await-of block compiles byte-equivalent through each body-statement', () => {
    const source = [
      'fn name=notify returns=void async=true',
      '  handler <<<',
      '    for await (const event: Event of events) {',
      '      await notify(event);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['for await (const event: Event of events) {', '  await notify(event);', '}'].join('\n'));
  });

  test('while block compiles through while body-statement', () => {
    const source = [
      'fn name=drain returns=void',
      '  handler <<<',
      '    while (queue.length > 0) {',
      '      const item = queue.shift();',
      '      process(item);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('while (queue.length > 0) {');
    expect(ts).toContain('  const item = queue.shift();');
    expect(ts).toContain('  process(item);');
    expect(ts.split('\n').filter((line: string) => line === '}')).toHaveLength(1);
    expect(ts).not.toContain('}}\n');
    expect(ts).not.toContain('while (queue.length > 0) {\n}');
  });

  test('typed const binding compiles byte-equivalent', () => {
    const source = [
      'fn name=load returns="User | null"',
      '  handler <<<',
      '    const user: User | null = loadUser();',
      '    return user;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['const user: User | null = loadUser();', 'return user;'].join('\n'));
  });

  test('mutable let binding compiles byte-equivalent', () => {
    const source = [
      'fn name=sum returns=number',
      '  handler <<<',
      '    let total = 0;',
      '    total += item.value;',
      '    return total;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['let total = 0;', 'total += item.value;', 'return total;'].join('\n'));
  });

  test('typed mutable let binding compiles byte-equivalent', () => {
    const source = [
      'fn name=sum returns=number',
      '  handler <<<',
      '    let total: number = 0;',
      '    total += item.value;',
      '    return total;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('let name=total type="number" kind=let value="0"');

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['let total: number = 0;', 'total += item.value;', 'return total;'].join('\n'));
  });

  test('typed const binding inside loop compiles byte-equivalent', () => {
    const source = [
      'fn name=scan returns=void',
      '  handler <<<',
      '    while (running) {',
      '      const user: User = loadUser();',
      '      process(user);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['while (running) {', '  const user: User = loadUser();', '  process(user);', '}'].join('\n'));
  });

  test('string-literal union type compiles byte-equivalent', () => {
    const source = [
      'fn name=mode returns="string"',
      '  handler <<<',
      '    const mode: "on" | "off" = readMode();',
      '    return mode;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['const mode: "on" | "off" = readMode();', 'return mode;'].join('\n'));
  });

  test('nested while block compiles through while body-statement', () => {
    const source = [
      'fn name=drain returns=void',
      '  handler <<<',
      '    while (outer) {',
      '      while (inner) {',
      '        tick();',
      '      }',
      '      process();',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('while (outer) {');
    expect(ts).toContain('  while (inner) {');
    expect(ts).toContain('    tick();');
    expect(ts).toContain('  }');
    expect(ts).toContain('  process();');
    expect(ts.split('\n').filter((line: string) => line === '}')).toHaveLength(1);
    expect(ts.split('\n').filter((line: string) => line === '  }')).toHaveLength(1);
  });

  test('loop-control compiles through break and continue body-statements', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const user of users) {',
      '      if (skip(user)) {',
      '        continue;',
      '      }',
      '      notify(user);',
      '      break;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(
      [
        'for (const user of users) {',
        '  if (skip(user)) {',
        '    continue;',
        '  }',
        '  notify(user);',
        '  break;',
        '}',
      ].join('\n'),
    );
  });

  test('arbitrary sync destructured pair for-of compiles byte-equivalent through bare pair-mode each', () => {
    // KERN-GAPS `for-of-sync-pair` — sync pair iteration over arbitrary
    // iterables lifts to `each pairKey=k pairValue=v in=expr` (no
    // `entries=true`). Codegen emits `for (const [k, v] of expr) { … }`.
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [key, value] of pairs) {',
      '      if (skip(key)) {',
      '        continue;',
      '      }',
      '      notify(key, value);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(
      [
        'for (const [key, value] of pairs) {',
        '  if (skip(key)) {',
        '    continue;',
        '  }',
        '  notify(key, value);',
        '}',
      ].join('\n'),
    );
  });

  test('Object.entries pair for-of compiles byte-equivalent through entries-mode each', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {',
      '      notify(key, value);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(
      [
        'for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {',
        '  notify(key, value);',
        '}',
      ].join('\n'),
    );
  });

  test('Object.entries key-only for-of compiles byte-equivalent through entryKey mode', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [key] of Object.entries(raw)) {',
      '      notify(key);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['for (const [key] of Object.entries(raw)) {', '  notify(key);', '}'].join('\n'));
  });

  test('Object.entries value-only for-of compiles byte-equivalent through entryValue mode', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const [, value] of Object.entries(raw)) {',
      '      notify(value);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['for (const [, value] of Object.entries(raw)) {', '  notify(value);', '}'].join('\n'));
  });

  test('destructured pair for-await-of compiles byte-equivalent through async pair-mode each', () => {
    const source = [
      'fn name=notify returns=void async=true',
      '  handler <<<',
      '    for await (const [key, value] of cache) {',
      '      await notify(key, value);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['for await (const [key, value] of cache) {', '  await notify(key, value);', '}'].join('\n'));
  });

  test('loop-control compiles through try blocks inside loops', () => {
    const source = [
      'fn name=scan returns=void',
      '  handler <<<',
      '    for (const item of items) {',
      '      try {',
      '        break;',
      '      } catch (err) {',
      '        continue;',
      '      }',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(
      ['for (const item of items) {', '  try {', '    break;', '  } catch (err) {', '    continue;', '  }', '}'].join(
        '\n',
      ),
    );
  });

  test('nested loops compile break and continue byte-equivalent', () => {
    const source = [
      'fn name=scan returns=void',
      '  handler <<<',
      '    for (const group of groups) {',
      '      while (active) {',
      '        continue;',
      '      }',
      '      break;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(
      ['for (const group of groups) {', '  while (active) {', '    continue;', '  }', '  break;', '}'].join('\n'),
    );
  });

  test('for-of block with nested destructuring composes each and destructure', () => {
    const source = [
      'fn name=notify returns=void',
      '  handler <<<',
      '    for (const user of users) {',
      '      const { id } = user;',
      '      notify(id);',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('each name=user in="users"');
    expect(result.output).toContain('destructure kind=const source="user"');
    expect(result.output).toContain('binding name=id');
    expect(result.output).toContain('do value="notify(id)"');

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('for (const user of users) {');
    expect(ts).toContain('  const { id } = user;');
    expect(ts).toContain('  notify(id);');
  });

  test('object destructuring compiles byte-equivalent through destructure body-statement', () => {
    const source = [
      'fn name=load returns=string',
      '  handler <<<',
      '    const { trackId, options } = req.body;',
      '    return trackId;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('const { trackId, options } = req.body;');
    expect(ts).toContain('return trackId;');
  });

  test('typed object destructuring compiles byte-equivalent through destructure body-statement', () => {
    const source = [
      'fn name=load returns=string',
      '  handler <<<',
      '    const { trackId, options }: { trackId: string; options: Options } = req.body;',
      '    return trackId;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('const { trackId, options }: { trackId: string; options: Options } = req.body;');
    expect(ts).toContain('return trackId;');
  });

  test('renamed typed object destructuring compiles byte-equivalent', () => {
    const source = [
      'fn name=load returns=string',
      '  handler <<<',
      '    const { status: mode }: { status: "active" | "paused" } = req.body;',
      '    return mode;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['const { status: mode }: { status: "active" | "paused" } = req.body;', 'return mode;'].join('\n'));
  });

  test('typed array destructuring compiles byte-equivalent through destructure body-statement', () => {
    const source = [
      'fn name=pair returns=string',
      '  handler <<<',
      '    const [first, second]: [string, number] = values;',
      '    return first;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('const [first, second]: [string, number] = values;');
    expect(ts).toContain('return first;');
  });

  test('typed array destructuring with elision compiles byte-equivalent', () => {
    const source = [
      'fn name=pair returns=boolean',
      '  handler <<<',
      '    const [first, , third]: [string, number, boolean] = values;',
      '    return third;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['const [first, , third]: [string, number, boolean] = values;', 'return third;'].join('\n'));
  });

  test('typed destructuring inside try compiles byte-equivalent', () => {
    const source = [
      'fn name=load returns=void',
      '  handler <<<',
      '    try {',
      '      const { id }: { id: string } = req.body;',
      '      use(id);',
      '    } catch (err) {',
      '      return;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(
      ['try {', '  const { id }: { id: string } = req.body;', '  use(id);', '} catch (err) {', '  return;', '}'].join(
        '\n',
      ),
    );
  });

  test('type assertion compiles byte-equivalent through ValueIR typeAssert', () => {
    const source = [
      'fn name=path returns=string',
      '  handler <<<',
      '    const p = params.filePath as string;',
      '    return { role: "user" as const, p: p };',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('const p = params.filePath as string;');
    expect(ts).toContain('return { role: "user" as const, p: p };');
  });

  test('indexed access compiles byte-equivalent through ValueIR index', () => {
    const source = [
      'fn name=first returns=string',
      '  handler <<<',
      '    const first = items[0];',
      '    return users[first].name;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('const first = items[0];');
    expect(ts).toContain('return users[first].name;');
  });

  test('optional element access compiles byte-equivalent through ValueIR index', () => {
    const source = [
      'fn name=first returns=string',
      '  handler <<<',
      '    const first = items?.[0];',
      '    return users?.[first]?.name;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('const first = items?.[0];');
    expect(ts).toContain('return users?.[first]?.name;');
  });

  test('plain assignment compiles byte-equivalent through body assign', () => {
    const source = [
      'fn name=mutate returns=void',
      '  handler <<<',
      '    x = 1;',
      '    obj.x = x;',
      '    arr[0] = obj.x;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('x = 1;');
    expect(ts).toContain('obj.x = x;');
    expect(ts).toContain('arr[0] = obj.x;');
  });

  test('compound assignment compiles byte-equivalent through body assign op', () => {
    const source = [
      'fn name=mutate returns=void',
      '  handler <<<',
      '    total += item.value;',
      '    obj.count += 1;',
      '    arr[0] |= mask;',
      '    this.count += 1;',
      '    mask |= Flag.Ready;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(
      ['total += item.value;', 'obj.count += 1;', 'arr[0] |= mask;', 'this.count += 1;', 'mask |= Flag.Ready;'].join(
        '\n',
      ),
    );
  });

  test('compound assignment with optional-chain value compiles byte-equivalent', () => {
    const source = ['fn name=mutate returns=void', '  handler <<<', '    total += item?.value;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe('total += item?.value;');
  });

  test('compound assignment nested in typed for-of compiles byte-equivalent', () => {
    const source = [
      'fn name=mutate returns=void',
      '  handler <<<',
      '    for (const user: User of users) {',
      '      count += user.score;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['for (const user: User of users) {', '  count += user.score;', '}'].join('\n'));
  });

  test.each([
    '-=',
    '*=',
    '/=',
    '%=',
    '**=',
    '&=',
    '^=',
    '<<=',
    '>>=',
  ])('compound assignment %s compiles byte-equivalent through body assign op', (op) => {
    const source = ['fn name=mutate returns=void', '  handler <<<', `    value ${op} delta;`, '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(`value ${op} delta;`);
  });

  test('this assignment compiles byte-equivalent through body assign', () => {
    const source = ['fn name=mutate returns=void', '  handler <<<', '    this.value = "ready";', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('this.value = "ready";');
  });
});
