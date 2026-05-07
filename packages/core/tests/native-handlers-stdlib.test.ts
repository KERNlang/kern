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

  test('all four slice-2a Text ops are registered with both TS and Python lowerings', () => {
    for (const op of ['upper', 'lower', 'length', 'trim']) {
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

  test('Text.length(s) lowers to TS s.length (property, not call)', () => {
    expect(emitExpression(parseExpression('Text.length(s)'))).toBe('s.length');
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
