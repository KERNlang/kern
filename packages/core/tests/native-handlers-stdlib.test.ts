/** KERN-stdlib lowering — slice 2a (Text module).
 *
 *  Module-prefixed function calls (`Text.upper(s)`) are the native-KERN
 *  syntax for what TS expresses as method calls. This test verifies that
 *  the same KERN source emits idiomatic TS via `emitExpression` and the
 *  per-target lowering table picks the right shape (method / prop / freeFn). */

import { KERN_STDLIB_MODULES, lookupStdlib, suggestStdlibMethod } from '../src/codegen/kern-stdlib.js';
import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression } from '../src/parser-expression.js';

describe('KERN_STDLIB table — Text module slice 2a', () => {
  test('Text module is registered as known stdlib module', () => {
    expect(KERN_STDLIB_MODULES.has('Text')).toBe(true);
  });

  test('all seven Text ops (2a + KERN 4.5.0 item 3 code-point ops) are registered with both TS and Python lowerings', () => {
    for (const op of ['upper', 'lower', 'length', 'trim', 'charAt', 'slice', 'indexOf']) {
      const entry = lookupStdlib('Text', op);
      expect(entry).not.toBeNull();
      expect(entry!.ts).toBeDefined();
      expect(entry!.py).toBeDefined();
    }
  });

  test('lookupStdlib returns null for unknown module', () => {
    expect(lookupStdlib('NotAModule', 'upper')).toBeNull();
  });

  test('lookupStdlib returns null for unknown method on known module', () => {
    expect(lookupStdlib('Text', 'nonsense')).toBeNull();
  });

  test('suggestStdlibMethod returns a near match', () => {
    expect(suggestStdlibMethod('Text', 'uppr')).toBe('upper');
    expect(suggestStdlibMethod('Text', 'lwr')).toBe('lower');
    expect(suggestStdlibMethod('Text', 'trims')).toBe('trim');
  });

  test('suggestStdlibMethod returns null when no candidate is close enough', () => {
    expect(suggestStdlibMethod('Text', 'completelyOffTheMap')).toBeNull();
  });
});

describe('emitExpression — TS — KERN-stdlib dispatch', () => {
  test('Text.upper(s) lowers to TS s.toUpperCase()', () => {
    expect(emitExpression(parseExpression('Text.upper(s)'))).toBe('s.toUpperCase()');
  });

  test('Text.lower(s) lowers to TS s.toLowerCase()', () => {
    expect(emitExpression(parseExpression('Text.lower(name)'))).toBe('name.toLowerCase()');
  });

  // KERN 4.5.0 item 3 — string parity completion (tribunal-locked contract,
  // Option D — Unicode code points). `Text.length` now lowers to the shared
  // code-point-walking helper (NOT native `.length`, which is UTF-16-code-
  // UNIT-indexed and diverges from the runner's code-point contract for any
  // non-BMP character — see `text-contract.ts`).
  test('Text.length(s) lowers to TS __kern_text_length(s) (code-point-indexed, not native .length)', () => {
    expect(emitExpression(parseExpression('Text.length(s)'))).toBe('__kern_text_length(s)');
  });

  test('Text.charAt(s, i) lowers to TS __kern_text_char_at(s, i)', () => {
    expect(emitExpression(parseExpression('Text.charAt(s, i)'))).toBe('__kern_text_char_at(s, i)');
  });

  test('Text.slice(s, a, b) lowers to TS __kern_text_slice(s, a, b)', () => {
    expect(emitExpression(parseExpression('Text.slice(s, a, b)'))).toBe('__kern_text_slice(s, a, b)');
  });

  test('Text.indexOf(s, needle) lowers to TS __kern_text_index_of(s, needle)', () => {
    expect(emitExpression(parseExpression('Text.indexOf(s, needle)'))).toBe('__kern_text_index_of(s, needle)');
  });

  test('Text.startsWith(s, prefix) lowers to TS __kern_text_starts_with(s, prefix) (not native .startsWith)', () => {
    expect(emitExpression(parseExpression('Text.startsWith(s, prefix)'))).toBe('__kern_text_starts_with(s, prefix)');
  });

  test('Text.trim(s) lowers to TS s.trim()', () => {
    expect(emitExpression(parseExpression('Text.trim(input)'))).toBe('input.trim()');
  });

  test('nested stdlib calls compose', () => {
    expect(emitExpression(parseExpression('Text.upper(Text.trim(raw))'))).toBe('raw.trim().toUpperCase()');
  });

  test('Text.upper used inside another call falls through naturally', () => {
    // Result.ok is NOT a stdlib module — the outer call uses default emit.
    expect(emitExpression(parseExpression('Result.ok(Text.upper(s))'))).toBe('Result.ok(s.toUpperCase())');
  });

  test('unknown method on known module throws with did-you-mean', () => {
    expect(() => emitExpression(parseExpression('Text.uppr(s)'))).toThrow(/Text.upper/);
  });

  test('unknown method without close match throws without suggestion', () => {
    expect(() => emitExpression(parseExpression('Text.completelyOff(s)'))).toThrow(/Unknown KERN-stdlib method/);
  });

  test('non-stdlib module passes through unchanged', () => {
    // `user.email(x)` is NOT a stdlib call — emits verbatim.
    expect(emitExpression(parseExpression('user.email(x)'))).toBe('user.email(x)');
  });

  test('plain ident.method() (not module-prefixed-call style) still emits as-is when ident is not a known module', () => {
    expect(emitExpression(parseExpression('arr.push(x)'))).toBe('arr.push(x)');
  });

  test('call arguments allow a trailing comma', () => {
    expect(emitExpression(parseExpression('notify(message,)'))).toBe('notify(message)');
    expect(emitExpression(parseExpression('logger.info(prefix, `${value}`,)'))).toBe('logger.info(prefix, `${value}`)');
  });

  test('lambda callbacks emit through normal TS calls', () => {
    expect(emitExpression(parseExpression('() => value'))).toBe('() => value');
    expect(emitExpression(parseExpression('(a, b) => a + b'))).toBe('(a, b) => a + b');
    expect(emitExpression(parseExpression('x => y => x + y'))).toBe('x => y => x + y');
    expect(emitExpression(parseExpression('users.map(user => user.name)'))).toBe('users.map(user => user.name)');
    expect(emitExpression(parseExpression('users.map((user) => user.name)'))).toBe('users.map((user) => user.name)');
    expect(emitExpression(parseExpression('users.map((user: User) => user.name)'))).toBe(
      'users.map((user: User) => user.name)',
    );
    expect(
      emitExpression(parseExpression('values.filter((value: unknown): value is string => typeof value === "string")')),
    ).toBe('values.filter((value: unknown): value is string => typeof value === "string")');
    expect(emitExpression(parseExpression('(x => x)(5)'))).toBe('(x => x)(5)');
    expect(emitExpression(parseExpression('cond ? x => 1 : x => 2'))).toBe('cond ? (x => 1) : (x => 2)');
    expect(emitExpression(parseExpression('{ cb: x => x }'))).toBe('{ cb: x => x }');
    expect(emitExpression(parseExpression('[x => x]'))).toBe('[x => x]');
    expect(emitExpression(parseExpression('x => a ? b : c'))).toBe('x => a ? b : c');
  });

  // Nested-values slice-1 receiver gating (agon review): the nested-record-
  // field rewrite fires ONLY for idents the body emitter PROVED are record
  // literals with a PROVEN array-valued field (`ctx.isRecordBinding` plus
  // `ctx.isRecordArrayField`). Unproven idents keep their base verbatim
  // emission; proven record fields that are not proven arrays stay fenced.
  test('two-level chains without a proven record binding keep base verbatim emission', () => {
    const ctx = { isUserBinding: () => false, coerceJsValues: true };
    expect(emitExpression(parseExpression('item.tags.filter((x) => x)'), ctx)).toBe('item.tags.filter((x) => x)');
    expect(emitExpression(parseExpression('item.tags[0]'), ctx)).toBe('item.tags[0]');
    expect(emitExpression(parseExpression('this.data.filter((x) => x % 2 === 0)'), ctx)).toBe(
      'this.data.filter((x) => x % 2 === 0)',
    );
  });

  test('two-level chains on a proven record array field lower through the guarded nested helpers', () => {
    const ctx = {
      isUserBinding: () => false,
      coerceJsValues: true,
      isRecordBinding: (name: string) => name === 'r',
      isRecordArrayField: (name: string, field: string) => name === 'r' && field === 'b',
    };
    expect(emitExpression(parseExpression('r.b.length'), ctx)).toContain('__kern_record = r');
    expect(emitExpression(parseExpression('r.b[1]'), ctx)).toContain('__kern_index = 1');
    // Non-length property on a proven record array field stays fail-closed.
    expect(emitExpression(parseExpression('r.b.filter((x) => x)'), ctx)).toContain('has no portable property');
    // A scalar field on the same proven record has no array-field proof and stays fail-closed.
    expect(emitExpression(parseExpression('r.a.length'), ctx)).toContain('nested record field must be an array');
    // A DIFFERENT ident without the proof falls through verbatim.
    expect(emitExpression(parseExpression('other.b.length'), ctx)).toBe('other.b.length');
  });

  test('stdlib template args parenthesize lambda receivers', () => {
    // KERN 4.5.0 item 3 — `Text.length` lowers to a free-function-shaped
    // template now (`__kern_text_length($0)`), but `needsArgParens` still
    // wraps a lambda arg unconditionally regardless of template shape.
    expect(emitExpression(parseExpression('Text.length(x => x)'))).toBe('__kern_text_length((x => x))');
  });

  test('List.map and List.filter lower callback expressions to TS array methods', () => {
    expect(emitExpression(parseExpression('List.map(users, user => user.name)'))).toBe('users.map(user => user.name)');
    expect(emitExpression(parseExpression('List.filter(users, user => user.active)'))).toBe(
      'users.filter(user => user.active)',
    );
  });
});

// ── Json + Path slice — pure/sync stdlib, no closures, no IO ──────────────

describe('KERN_STDLIB table — Json module', () => {
  test('Json module is registered as known stdlib module', () => {
    expect(KERN_STDLIB_MODULES.has('Json')).toBe(true);
  });

  test('Json.parse and Json.stringify are registered with both targets', () => {
    for (const op of ['parse', 'stringify']) {
      const entry = lookupStdlib('Json', op);
      expect(entry).not.toBeNull();
      expect(entry!.ts).toBeDefined();
      expect(entry!.py).toBeDefined();
    }
  });

  test('Json.parse declares a Python `json` import requirement (TS none)', () => {
    const entry = lookupStdlib('Json', 'parse');
    expect(entry!.requires?.py).toBe('json');
    expect(entry!.requires?.ts).toBeUndefined();
  });

  test('Json.stringify declares a Python `json` import requirement (TS none)', () => {
    const entry = lookupStdlib('Json', 'stringify');
    expect(entry!.requires?.py).toBe('json');
    expect(entry!.requires?.ts).toBeUndefined();
  });

  test('suggestStdlibMethod on Json finds near matches', () => {
    expect(suggestStdlibMethod('Json', 'pase')).toBe('parse');
    expect(suggestStdlibMethod('Json', 'stringfy')).toBe('stringify');
  });
});

describe('KERN_STDLIB table — Path module', () => {
  test('Path module is registered as known stdlib module', () => {
    expect(KERN_STDLIB_MODULES.has('Path')).toBe(true);
  });

  test('Path.basename is registered (variadic Path.join intentionally omitted)', () => {
    expect(lookupStdlib('Path', 'basename')).not.toBeNull();
    // Variadic operations are not yet expressible in the StdlibEntry shape
    // (fixed `arity: number`), so `Path.join(a, b, ...rest)` is excluded
    // from this slice. Re-add when the table grows variadic support.
    expect(lookupStdlib('Path', 'join')).toBeNull();
  });

  test('Path.basename declares a Python `posixpath` import requirement (TS none)', () => {
    const entry = lookupStdlib('Path', 'basename');
    expect(entry!.requires?.py).toBe('posixpath');
    expect(entry!.requires?.ts).toBeUndefined();
  });
});

describe('emitExpression — TS — Json/Path stdlib dispatch', () => {
  test('Json.parse(x) lowers to TS JSON.parse(x)', () => {
    expect(emitExpression(parseExpression('Json.parse(s)'))).toBe('JSON.parse(s)');
  });

  test('Json.stringify(x) lowers to TS JSON.stringify(x)', () => {
    expect(emitExpression(parseExpression('Json.stringify(obj)'))).toBe('JSON.stringify(obj)');
  });

  test('Json.parse arity is enforced (zero args throws)', () => {
    expect(() => emitExpression(parseExpression('Json.parse()'))).toThrow(/takes 1 arg/);
  });

  test('Json.stringify arity is enforced (two args throws)', () => {
    expect(() => emitExpression(parseExpression('Json.stringify(a, b)'))).toThrow(/takes 1 arg/);
  });

  test('unknown method on Json throws with did-you-mean', () => {
    expect(() => emitExpression(parseExpression('Json.parze(s)'))).toThrow(/Json.parse/);
  });

  test('Path.basename(p) lowers to TS split-pop expression with empty-string fallback', () => {
    // Single-eval: `$0` is substituted once into `($0.split("/").at(-1) ?? "")`.
    expect(emitExpression(parseExpression('Path.basename(p)'))).toBe('(p.split("/").at(-1) ?? "")');
  });

  test('Path.basename composes inside another call', () => {
    expect(emitExpression(parseExpression('check(Path.basename(p))'))).toBe('check((p.split("/").at(-1) ?? ""))');
  });

  test('Path.basename arity is enforced', () => {
    expect(() => emitExpression(parseExpression('Path.basename(a, b)'))).toThrow(/takes 1 arg/);
  });

  test('unknown method on Path throws with did-you-mean', () => {
    expect(() => emitExpression(parseExpression('Path.basname(p)'))).toThrow(/Path.basename/);
  });

  test('nested Json + Text composes', () => {
    expect(emitExpression(parseExpression('Json.parse(Text.trim(raw))'))).toBe('JSON.parse(raw.trim())');
  });

  // OpenCode review-coverage fix: Path.basename's `?? ""` fallback is reached
  // for empty-string and trailing-slash inputs at runtime. Codegen-level
  // tests can't exercise runtime values directly, but we assert the emitted
  // form preserves the empty-fallback expression so the runtime contract
  // remains visible in source. The cross-target parity for those inputs is
  // documented in kern-stdlib.ts comments and confirmed in OpenCode's review
  // table (TS split-pop and Python posixpath.basename agree on `""`, `"a/"`,
  // `"//"`, and `"a/b"`).
  test('Path.basename emit preserves the empty-string fallback', () => {
    const out = emitExpression(parseExpression('Path.basename(p)'));
    expect(out).toContain('?? ""');
    expect(out).toContain('.split("/").at(-1)');
  });

  test('Path.basename works on a literal string arg', () => {
    // Confirms template substitution doesn't break on string-literal `$0`.
    expect(emitExpression(parseExpression('Path.basename("a/b/c.txt")'))).toBe('("a/b/c.txt".split("/").at(-1) ?? "")');
  });
});
