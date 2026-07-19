/** Slice 4 layer 2 — `Result<>` / `Option<>` preamble detection tests.
 *
 *  Spec: docs/language/result-option-spec.md.
 *  Utility: packages/core/src/codegen/stdlib-preamble.ts. */

import {
  detectKernStdlibUsage,
  emittedCodeUsesPower,
  injectKernStdlibPreamble,
  injectKernStdlibPreambleIntoSFC,
  kernStdlibPreamble,
} from '../src/codegen/stdlib-preamble.js';
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

  // ── DECIMAL Slice 2 (Finding 1 — remediation) — the Decimal producer detector
  //    must NOT false-positive on a `Decimal.of(` mention that lives only in a
  //    COMMENT or STRING LITERAL inside a `lang="kern"` handler. Tripping it injects
  //    a spurious `import Decimal from 'decimal.js'` + `Decimal.set(...)` into a
  //    Decimal-free module (a phantom runtime dependency). ─────────────────────

  test('does NOT flag decimal when `Decimal.of(` appears only in a line/block comment', () => {
    // Verified repro from the codex review: a handler whose only Decimal mention is
    // inside `/* … */` must not pull in the decimal.js import.
    const ast = parseDocument(
      [
        'fn name=noDecimal returns=number export=true',
        '  handler lang="kern"',
        '    let name=x value="1 /* Decimal.of(\\"1\\") */"',
        '    return value=x',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast).decimal).toBeFalsy();
  });

  test('does NOT flag decimal when `Decimal.of(` appears only inside a string literal', () => {
    const ast = parseDocument(
      [
        'fn name=stringy returns=string export=true',
        '  handler lang="kern"',
        '    let name=s value="\\"Decimal.of(x)\\""',
        '    return value=s',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast).decimal).toBeFalsy();
  });

  test('STILL flags decimal for a real `Decimal.of(...)` usage (no regression / no false negative)', () => {
    // Soundness guard: masking comments/strings must never MISS a genuine producer
    // call — a false negative would reintroduce the missing-import ReferenceError.
    const ast = parseDocument(
      [
        'fn name=real returns=Decimal export=true',
        '  handler lang="kern"',
        '    let name=x value="Decimal.of(\\"1.5\\")"',
        '    return value=x',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast).decimal).toBe(true);
  });

  test('flags decimal for a real producer even when a comment ALSO mentions a different producer', () => {
    // The real `Decimal.of(` survives the mask; the `Decimal.add(` in the trailing
    // comment is irrelevant — detection still fires (it never under-detects).
    const ast = parseDocument(
      [
        'fn name=mixed returns=Decimal export=true',
        '  handler lang="kern"',
        '    let name=x value="Decimal.of(\\"1.5\\") /* not Decimal.add( here */"',
        '    return value=x',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast).decimal).toBe(true);
  });

  // ── DECIMAL Slice 2 (BLOCKING — single-pass mask) — a `//` or `/*` marker that
  //    lives INSIDE a string literal (e.g. a URL) must NOT be misread as a comment
  //    that blanks out the real `Decimal.of(` producer that follows it on the same
  //    line. The prior sequential `.replace()` chain stripped line comments BEFORE
  //    masking strings, so `"http://x"; Decimal.of(…)` was read as having NO producer
  //    → the decimal.js import was omitted → runtime ReferenceError. ──────────────

  test('STILL flags decimal when a URL string (`"http://x"`) precedes the producer on the same line', () => {
    // The `//` inside `"http://x"` must be consumed as part of the STRING token, not
    // read as a line comment that blanks the trailing `Decimal.of(`.
    const ast = parseDocument(
      [
        'fn name=urlBefore returns=Decimal export=true',
        '  handler lang="kern"',
        '    let name=x value="\\"http://x\\"; Decimal.of(\\"1.5\\")"',
        '    return value=x',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast).decimal).toBe(true);
  });

  test('STILL flags decimal when a URL TEMPLATE literal (`` `url://x` ``) precedes the producer', () => {
    // Same hazard via a template literal — the `//` inside `` `url://x` `` must be
    // consumed by the template-string token, not treated as a comment.
    const ast = parseDocument(
      [
        'fn name=tplBefore returns=Decimal export=true',
        '  handler lang="kern"',
        '    let name=x value="`url://x`; Decimal.of(\\"1.5\\")"',
        '    return value=x',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast).decimal).toBe(true);
  });

  test('STILL flags decimal when a block-comment marker lives INSIDE a string before the producer', () => {
    // `let prefix = "/*"` — the `/*` is inside a string and must NOT open a block
    // comment that swallows the real `Decimal.of(` producer that follows. The trailing
    // `/* real comment */` is a genuine comment and is irrelevant to detection.
    const ast = parseDocument(
      [
        'fn name=blockMarkerInString returns=Decimal export=true',
        '  handler lang="kern"',
        '    let name=v value="let prefix = \\"/*\\"; let v = Decimal.of(\\"1.5\\"); /* real comment */"',
        '    return value=v',
      ].join('\n'),
    );
    expect(detectKernStdlibUsage(ast).decimal).toBe(true);
  });
});

describe('kernStdlibPreamble', () => {
  test('returns empty preamble when nothing is used', () => {
    expect(kernStdlibPreamble({ result: false, option: false })).toEqual([]);
  });

  test('detects emitted checked-power calls and injects one private helper', () => {
    expect(emittedCodeUsesPower('return __kern_pow_int([a, b]);')).toBe(true);
    expect(emittedCodeUsesPower('return a ** b;')).toBe(false);
    expect(emittedCodeUsesPower('return "__kern_pow_int([fake])";')).toBe(false);
    expect(emittedCodeUsesPower('// __kern_pow_int([fake])\nreturn 1;')).toBe(false);
    expect(emittedCodeUsesPower('return `__kern_pow_int([fake])`;')).toBe(false);
    expect(emittedCodeUsesPower('return /__kern_pow_int([x])/;')).toBe(false);
    expect(emittedCodeUsesPower('return `${__kern_pow_int([a, b])}`;')).toBe(true);
    expect(emittedCodeUsesPower('const view = <Box>__kern_pow_int([fake])</Box>;', 'tsx')).toBe(true);
    const out = kernStdlibPreamble({ result: false, option: false, power: true }).join('\n');
    expect(out.match(/const __kern_pow_int = \(/g)).toHaveLength(1);
    expect(out).toContain('const maxSafe = 9007199254740991;');
    expect(out).not.toMatch(/\b(?:Number|Math|Object)\./u);
    expect(out).not.toContain('new Error');
  });

  test('detects deeply nested template calls without recursive scanner overflow', () => {
    let code = '__kern_pow_int([a, b])';
    for (let depth = 0; depth < 5_000; depth += 1) code = `\`\${${code}}\``;
    expect(emittedCodeUsesPower(code)).toBe(true);
  });

  test('distinguishes direct helper calls from inert regex and property syntax', () => {
    expect(emittedCodeUsesPower('if (ok) /__kern_pow_int([x])/.test(s);')).toBe(false);
    expect(emittedCodeUsesPower('if (ok) {} /__kern_pow_int([x])/.test(s);')).toBe(false);
    expect(emittedCodeUsesPower('object.__kern_pow_int([a, b]);')).toBe(false);
    expect(emittedCodeUsesPower('obj.yield / 2; __kern_pow_int([a, b]);')).toBe(true);
    expect(emittedCodeUsesPower('const π = 1; return π / __kern_pow_int([a, b]);')).toBe(true);
    expect(emittedCodeUsesPower('const x = { a: 1 } / __kern_pow_int([a, b]);')).toBe(true);
    expect(emittedCodeUsesPower('return true && { a: 1 } / __kern_pow_int([a, b]);')).toBe(true);
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

describe('injectKernStdlibPreambleIntoSFC', () => {
  // Slice 4 follow-up — the preamble must land INSIDE the `<script setup
  // lang="ts">` block. Putting it before the SFC root corrupts the parse.

  const PREAMBLE = ['// PREAMBLE-LINE-1', '// PREAMBLE-LINE-2'];

  test('inserts after `<script setup lang="ts">` opening tag', () => {
    const sfc = [
      '<script setup lang="ts">',
      'const x = 1;',
      '</script>',
      '',
      '<template>',
      '  <div>{{ x }}</div>',
      '</template>',
    ].join('\n');
    const out = injectKernStdlibPreambleIntoSFC(sfc, PREAMBLE);
    const lines = out.split('\n');
    expect(lines[0]).toBe('<script setup lang="ts">');
    expect(lines[1]).toBe('// PREAMBLE-LINE-1');
    expect(lines[2]).toBe('// PREAMBLE-LINE-2');
    expect(lines[3]).toBe('const x = 1;');
  });

  test('inserts after `<script lang="ts" setup>` (attribute order swap)', () => {
    const sfc = ['<script lang="ts" setup>', 'const x = 1;', '</script>'].join('\n');
    const out = injectKernStdlibPreambleIntoSFC(sfc, PREAMBLE);
    expect(out.indexOf('// PREAMBLE-LINE-1')).toBeGreaterThan(out.indexOf('<script'));
    expect(out.indexOf('// PREAMBLE-LINE-1')).toBeLessThan(out.indexOf('const x'));
  });

  test("accepts single-quoted lang='ts'", () => {
    const sfc = ["<script setup lang='ts'>", 'const x = 1;', '</script>'].join('\n');
    const out = injectKernStdlibPreambleIntoSFC(sfc, PREAMBLE);
    expect(out).toContain('// PREAMBLE-LINE-1');
  });

  test('drops the preamble when no `lang="ts"` script block exists', () => {
    const sfc = ['<script setup>', 'const x = 1;', '</script>', '<template><div>x</div></template>'].join('\n');
    const out = injectKernStdlibPreambleIntoSFC(sfc, PREAMBLE);
    expect(out).toBe(sfc);
  });

  test('drops the preamble for template-only SFC (no script block)', () => {
    const sfc = '<template><div>hello</div></template>\n';
    const out = injectKernStdlibPreambleIntoSFC(sfc, PREAMBLE);
    expect(out).toBe(sfc);
  });

  test('returns code unchanged when preamble is empty', () => {
    const sfc = '<script setup lang="ts">\nconst x = 1;\n</script>\n';
    expect(injectKernStdlibPreambleIntoSFC(sfc, [])).toBe(sfc);
  });

  test('preamble lands BEFORE user imports inside the script block', () => {
    const sfc = ['<script setup lang="ts">', "import { ref } from 'vue';", 'const x = ref(1);', '</script>'].join('\n');
    const out = injectKernStdlibPreambleIntoSFC(sfc, PREAMBLE);
    expect(out.indexOf('// PREAMBLE-LINE-1')).toBeLessThan(out.indexOf('import { ref }'));
  });
});
