/** Slice 4 layer 2 — `Result<>` / `Option<>` preamble detection tests.
 *
 *  Spec: docs/language/result-option-spec.md.
 *  Utility: packages/core/src/codegen/stdlib-preamble.ts. */

import { detectKernStdlibUsage, injectKernStdlibPreamble, kernStdlibPreamble } from '../src/codegen/stdlib-preamble.js';
import { parseDocument } from '../src/parser.js';

describe('detectKernStdlibUsage', () => {
  test('detects Result in fn returns', () => {
    const ast = parseDocument(
      [
        'fn name=parseUser params="raw:string" returns="Result<User, ParseError>"',
        '  handler <<<',
        '    return { kind: "ok", value: { name: "alice" } };',
        '  >>>',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast)).toEqual({ result: true, option: false });
  });

  test('detects Option in field type', () => {
    const ast = parseDocument(['interface name=Profile', '  field name=avatar type="Option<string>"'].join('\n'));
    expect(detectKernStdlibUsage(ast)).toEqual({ result: false, option: true });
  });

  test('detects both Result and Option in the same module', () => {
    const ast = parseDocument(
      [
        'interface name=Profile',
        '  field name=avatar type="Option<string>"',
        'fn name=loadProfile params="id:string" returns="Result<Profile, Error>"',
        '  handler <<<',
        '    return { kind: "ok", value: { avatar: { kind: "none" } } };',
        '  >>>',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast)).toEqual({ result: true, option: true });
  });

  test('returns false/false on a module that uses neither', () => {
    const ast = parseDocument(
      ['interface name=User', '  field name=name type=string', '  field name=age type=number'].join('\n'),
    );
    expect(detectKernStdlibUsage(ast)).toEqual({ result: false, option: false });
  });

  test('does not false-positive on identifiers that share a prefix', () => {
    // `Resulting` and `Optional` are common type names. The detector requires
    // the opening angle bracket immediately after the reserved name, so these
    // must not trip it.
    const ast = parseDocument(
      [
        'interface name=Box',
        '  field name=resulting type="Resulting<T>"',
        '  field name=optional type="Optional<T>"',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast)).toEqual({ result: false, option: false });
  });

  test('detects Result inside a nested generic', () => {
    const ast = parseDocument(
      [
        'fn name=batch params="ids:string[]" returns="Promise<Result<User[], Error>>"',
        '  handler <<<',
        '    return Promise.resolve({ kind: "ok", value: [] });',
        '  >>>',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast)).toEqual({ result: true, option: false });
  });

  test('detects Result on a method returns', () => {
    const ast = parseDocument(
      [
        'service name=UserService',
        '  method name=findById params="id:string" returns="Result<User, NotFoundError>"',
        '    handler <<<',
        '      return { kind: "ok", value: { name: "alice" } };',
        '    >>>',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast)).toEqual({ result: true, option: false });
  });

  test('detects Option inside a union variant field type', () => {
    const ast = parseDocument(
      [
        'union name=Inbox discriminant=kind',
        '  variant name=loaded',
        '    field name=preview type="Option<string>"',
        '  variant name=loading',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast)).toEqual({ result: false, option: true });
  });

  test('flags unwrap usage when handler body contains `new KernUnwrapError(`', () => {
    // Slice 7 — emitted by the rewriter for `expr!`.
    const ast = parseDocument(
      [
        'fn name=loud params="raw:string" returns=string',
        '  handler <<<',
        '    if (false) throw new KernUnwrapError({ kind: "err", error: "x" });',
        '    return raw;',
        '  >>>',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast).unwrap).toBe(true);
  });

  test('does NOT flag unwrap when user has only declared `class KernUnwrapError`', () => {
    // Without `new`, the bare reference shouldn't trigger preamble emission —
    // double-emission of the class would cause a TS redeclaration error.
    const ast = parseDocument(
      [
        'fn name=loud params="raw:string" returns=string',
        '  handler <<<',
        '    class KernUnwrapError extends Error {}',
        '    return raw;',
        '  >>>',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast).unwrap).toBeFalsy();
  });
});

describe('kernStdlibPreamble', () => {
  test('returns empty preamble when nothing is used', () => {
    expect(kernStdlibPreamble({ result: false, option: false })).toEqual([]);
  });

  test('emits only the Result alias when Option is unused', () => {
    const out = kernStdlibPreamble({ result: true, option: false }).join('\n');
    expect(out).toContain("type Result<T, E> = { kind: 'ok'; value: T } | { kind: 'err'; error: E };");
    expect(out).not.toContain('type Option<');
  });

  test('emits only the Option alias when Result is unused', () => {
    const out = kernStdlibPreamble({ result: false, option: true }).join('\n');
    expect(out).toContain("type Option<T> = { kind: 'some'; value: T } | { kind: 'none' };");
    expect(out).not.toContain('type Result<');
  });

  test('emits both aliases when both are used', () => {
    const out = kernStdlibPreamble({ result: true, option: true }).join('\n');
    expect(out).toContain('type Result<T, E>');
    expect(out).toContain('type Option<T>');
  });

  test('preamble emits the type alias AND the companion-object helpers', () => {
    // Slice 7's `?` / `!` operators rely on the exact discriminant key/value
    // shape. If this preamble drifts, the operator desugar breaks silently.
    // Layer 3 added the `Result` / `Option` companion objects (Codex/Gemini
    // synthesis vote). The helpers must reference the same `kind: 'ok' / …`
    // strings so user code that round-trips through them stays compatible
    // with the propagation-operator lowering.
    const out = kernStdlibPreamble({ result: true, option: true }).join('\n');
    // Type aliases — load-bearing for slice 7
    expect(out).toContain("type Result<T, E> = { kind: 'ok'; value: T } | { kind: 'err'; error: E };");
    expect(out).toContain("type Option<T> = { kind: 'some'; value: T } | { kind: 'none' };");
    // Companion objects — load-bearing for the value-level API
    expect(out).toContain('const Result = Object.freeze({');
    expect(out).toContain('const Option = Object.freeze({');
    // All 8 Result helpers per spec
    for (const helper of [
      'ok<T>',
      'err<E>',
      'isOk<T, E>',
      'isErr<T, E>',
      'map<T, E, U>',
      'mapErr<T, E, F>',
      'andThen<T, E, U>',
      'unwrapOr<T, E>',
    ]) {
      expect(out).toContain(helper);
    }
    // All 7 Option helpers (no mapErr — Option has no error side)
    for (const helper of [
      'some<T>',
      'none<T = never>',
      'isSome<T>',
      'isNone<T>',
      'map<T, U>',
      'andThen<T, U>',
      'unwrapOr<T>',
    ]) {
      expect(out).toContain(helper);
    }
  });

  test('Result helpers are emitted ONLY when Result type is used', () => {
    const out = kernStdlibPreamble({ result: true, option: false }).join('\n');
    expect(out).toContain('const Result = Object.freeze({');
    expect(out).not.toContain('const Option =');
  });

  test('Option helpers are emitted ONLY when Option type is used', () => {
    const out = kernStdlibPreamble({ result: false, option: true }).join('\n');
    expect(out).toContain('const Option = Object.freeze({');
    expect(out).not.toContain('const Result =');
  });

  test('helpers reference the same `kind: "ok" / "err" / "some" / "none"` strings as the type alias', () => {
    // Slice 7 invariant pinned: the propagation operators (`?` / `!`) work
    // by checking `r.kind === 'err'` directly. If a future rewrite changes
    // the helpers to use a different tag value, the operators silently
    // diverge from the helpers. This test catches that drift.
    const out = kernStdlibPreamble({ result: true, option: true }).join('\n');
    // Result helpers
    expect(out).toContain('return { kind: "ok", value };');
    expect(out).toContain('return { kind: "err", error };');
    expect(out).toContain('r.kind === "ok"');
    expect(out).toContain('r.kind === "err"');
    // Option helpers
    expect(out).toContain('return { kind: "some", value };');
    expect(out).toContain('return { kind: "none" };');
    expect(out).toContain('o.kind === "some"');
    expect(out).toContain('o.kind === "none"');
  });
});

describe('injectKernStdlibPreamble', () => {
  const PREAMBLE = ['// PREAMBLE', 'type Result<T, E> = ...;'];

  test('returns the original code when preamble is empty', () => {
    expect(injectKernStdlibPreamble('export const x = 1;\n', [])).toBe('export const x = 1;\n');
  });

  test('returns just the preamble joined when code is empty', () => {
    expect(injectKernStdlibPreamble('', PREAMBLE)).toBe('// PREAMBLE\ntype Result<T, E> = ...;');
  });

  test('prepends the preamble for plain TS code with no directive', () => {
    const code = ["import { foo } from './bar';", '', 'export const x = 1;'].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    expect(out.startsWith('// PREAMBLE\ntype Result<T, E> = ...;\n')).toBe(true);
    expect(out).toContain("import { foo } from './bar';");
  });

  test("inserts after a leading 'use client' directive (React Server Components)", () => {
    const code = [
      "'use client';",
      '',
      "import React from 'react';",
      '',
      'export default function App() { return null; }',
    ].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    // Critical: 'use client' MUST stay at line 0 — anything else means React
    // treats the module as a server component.
    expect(out.split('\n')[0]).toBe("'use client';");
    expect(out).toContain('// PREAMBLE');
    expect(out.indexOf('// PREAMBLE')).toBeGreaterThan(out.indexOf("'use client';"));
    expect(out.indexOf('// PREAMBLE')).toBeLessThan(out.indexOf('import React'));
  });

  test("inserts after a 'use server' directive", () => {
    const code = ["'use server';", "import { db } from './db';"].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    expect(out.split('\n')[0]).toBe("'use server';");
    expect(out.indexOf('// PREAMBLE')).toBeLessThan(out.indexOf('import { db }'));
  });

  test('inserts after a directive with double-quoted string (parser tolerance)', () => {
    const code = ['"use client";', "import React from 'react';"].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    expect(out.split('\n')[0]).toBe('"use client";');
  });

  test('inserts after multiple leading directives', () => {
    const code = ["'use strict';", "'use client';", "import React from 'react';"].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    expect(out.split('\n').slice(0, 2)).toEqual(["'use strict';", "'use client';"]);
  });

  test('treats a leading line that LOOKS like a directive but is something else as code', () => {
    // E.g. `'use client'` without a semicolon is a string-expression
    // statement, but our directive regex tolerates the missing `;`. This
    // test pins the tolerance — if a real production module ever emits a
    // bare `'use client'` literal, we still treat it as a directive.
    const code = ["'use client'", "import React from 'react';"].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    expect(out.split('\n')[0]).toBe("'use client'");
    expect(out.indexOf('// PREAMBLE')).toBeGreaterThan(out.indexOf("'use client'"));
  });

  // ── Codex review fixes — hashbang preservation ─────────────────────

  test('preserves a hashbang on line 1 (target=cli, Ink entry)', () => {
    // Without this, `target=cli` outputs no longer start with `#!/usr/bin/env node`
    // and Node refuses to execute the generated binary.
    const code = ['#!/usr/bin/env node', "import { foo } from './bar';"].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    expect(out.split('\n')[0]).toBe('#!/usr/bin/env node');
    expect(out.indexOf('// PREAMBLE')).toBeGreaterThan(out.indexOf('#!/usr/bin/env node'));
    expect(out.indexOf('// PREAMBLE')).toBeLessThan(out.indexOf('import { foo }'));
  });

  test('hashbang + use client both stay at the top in order', () => {
    const code = ['#!/usr/bin/env node', "'use client';", "import React from 'react';"].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    const lines = out.split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env node');
    expect(lines[1]).toBe("'use client';");
  });

  // ── Codex/Gemini review fixes — multi-line block comments ──────────

  test('skips a leading multi-line JSDoc block as a single unit', () => {
    // Prior `startsWith('/*')` check only matched the opening line; the
    // injector then dropped the preamble between `* …` lines, corrupting
    // the comment.
    const code = ['/**', ' * Copyright 2026', ' * @generated', ' */', "import { foo } from './bar';"].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    expect(out).toContain('/**\n * Copyright 2026\n * @generated\n */');
    expect(out.indexOf('// PREAMBLE')).toBeGreaterThan(out.indexOf('*/'));
    expect(out.indexOf('// PREAMBLE')).toBeLessThan(out.indexOf('import { foo }'));
  });

  test('handles a single-line block comment /* … */ on one line', () => {
    const code = ['/* generated */', "import { foo } from './bar';"].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    expect(out.split('\n')[0]).toBe('/* generated */');
    expect(out.indexOf('// PREAMBLE')).toBeLessThan(out.indexOf('import { foo }'));
  });

  // ── Gemini review fix — directive with trailing comment ────────────

  test("'use client'; with a trailing line comment still skips correctly", () => {
    const code = ["'use client'; // entry point", "import React from 'react';"].join('\n');
    const out = injectKernStdlibPreamble(code, PREAMBLE);
    expect(out.split('\n')[0]).toBe("'use client'; // entry point");
    expect(out.indexOf('// PREAMBLE')).toBeGreaterThan(out.indexOf("'use client';"));
    expect(out.indexOf('// PREAMBLE')).toBeLessThan(out.indexOf('import React'));
  });
});
