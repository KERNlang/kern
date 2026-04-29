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

  test('preamble shape matches the spec exactly', () => {
    // Slice 7's `?` / `!` operators rely on the exact discriminant key/value
    // shape. If this preamble drifts, the operator desugar breaks silently.
    const out = kernStdlibPreamble({ result: true, option: true });
    expect(out).toEqual([
      '// ── KERN stdlib (auto-emitted) ──────────────────────────────────────',
      "type Result<T, E> = { kind: 'ok'; value: T } | { kind: 'err'; error: E };",
      "type Option<T> = { kind: 'some'; value: T } | { kind: 'none' };",
      '',
    ]);
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
});
