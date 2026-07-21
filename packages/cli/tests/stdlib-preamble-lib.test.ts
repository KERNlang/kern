/** Slice 4 layer 2 — `transpileForTarget` integration test for the Result/Option preamble.
 *
 *  Verifies the dispatcher-level post-pass prepends the type aliases for
 *  TS-family targets when the source references `Result<>` / `Option<>` and
 *  stays silent for FastAPI (Python) and when no usage is detected.
 *  Spec: docs/language/result-option-spec.md. */

import type { KernTarget } from '@kernlang/core';
import { parseDocument, resolveConfig } from '@kernlang/core';
import { transpileForTarget } from '../src/shared.js';

function compile(src: string, target: KernTarget = 'lib'): string {
  const ast = parseDocument(src);
  const cfg = resolveConfig({ target });
  return transpileForTarget(ast, cfg).code;
}

function compileLib(src: string): string {
  return compile(src, 'lib');
}

describe('transpileLib — slice 4 stdlib preamble', () => {
  test('prepends Result alias when fn returns Result<…>', () => {
    const code = compileLib(
      [
        'fn name=parseUser params="raw:string" returns="Result<User, ParseError>" export=true',
        '  handler <<<',
        '    return { kind: "ok", value: { name: "alice" } };',
        '  >>>',
      ].join('\n'),
    );
    expect(code).toContain("type Result<T, E> = { kind: 'ok'; value: T } | { kind: 'err'; error: E };");
    expect(code).toContain('export function parseUser');
    // Preamble must come before the function declaration.
    expect(code.indexOf('type Result<T, E>')).toBeLessThan(code.indexOf('export function parseUser'));
  });

  test('prepends Option alias when an interface field uses Option<…>', () => {
    const code = compileLib(
      ['interface name=Profile export=true', '  field name=avatar type="Option<string>"'].join('\n'),
    );
    expect(code).toContain("type Option<T> = { kind: 'some'; value: T } | { kind: 'none' };");
    expect(code).toContain('export interface Profile');
  });

  test('omits the preamble when neither Result nor Option appears', () => {
    const code = compileLib(
      ['interface name=User export=true', '  field name=name type=string', '  field name=age type=number'].join('\n'),
    );
    expect(code).not.toContain('KERN stdlib');
    expect(code).not.toContain('type Result<');
    expect(code).not.toContain('type Option<');
    expect(code).toContain('export interface User');
  });

  test('emits both aliases when the module uses both', () => {
    const code = compileLib(
      [
        'interface name=Profile export=true',
        '  field name=avatar type="Option<string>"',
        'fn name=loadProfile params="id:string" returns="Result<Profile, Error>" export=true',
        '  handler <<<',
        '    return { kind: "ok", value: { avatar: { kind: "none" } } };',
        '  >>>',
      ].join('\n'),
    );
    expect(code).toContain('type Result<T, E>');
    expect(code).toContain('type Option<T>');
  });

  test('does not double-prepend when the file already declares its own Result type', () => {
    // Edge case — if the user wrote their own `Result<T,E>` alias via a
    // `type` node, the preamble would emit a duplicate. TS rejects duplicate
    // type aliases in the same scope, so this would break compilation.
    //
    // Slice 4 acceptable behaviour: the user's explicit declaration shadows
    // the stdlib one. The auto-emit still fires (the IR has Result<…>
    // references in the user's `type` node), producing two `type Result<…>`
    // statements. TS will surface a clear error. Documented as a slice-4
    // limitation in the spec doc — fix is to detect a top-level
    // `type name=Result generics="<…>"` and skip the auto-emit.
    //
    // This test pins the current behaviour so the limitation is intentional
    // and visible. When a follow-up commit adds the skip-detection, this
    // test gets flipped to assert single emission.
    const code = compileLib(
      [
        'type name=Result generics="<T, E>" alias="{ ok: T } | { err: E }"',
        'fn name=foo params="" returns="Result<string, Error>"',
        '  handler <<<',
        '    return { ok: "hi" } as any;',
        '  >>>',
      ].join('\n'),
    );
    // Both the user alias AND the stdlib alias are present today (known limitation).
    const userAlias = code.match(/type Result<T, E> = \{ ok: T \} \| \{ err: E \};/g);
    const stdlibAlias = code.match(/type Result<T, E> = \{ kind: 'ok'; value: T \} \| \{ kind: 'err'; error: E \};/g);
    expect(userAlias?.length).toBe(1);
    expect(stdlibAlias?.length).toBe(1);
  });
});

describe('transpileForTarget — slice 4 stdlib preamble dispatch', () => {
  // Cross-target verification — the dispatcher-level post-pass should apply
  // the preamble for TS-family targets and skip Python (FastAPI).

  const SRC_WITH_RESULT = [
    'fn name=parseUser params="raw:string" returns="Result<User, ParseError>" export=true',
    '  handler <<<',
    '    return { kind: "ok", value: { name: "alice" } };',
    '  >>>',
  ].join('\n');

  test('FastAPI target does NOT get the TS preamble (Python output)', () => {
    // FastAPI emits Python — the TS `type Result<T, E> = …` alias would be
    // a syntax error in a .py file. The dispatcher-level guard must skip it.
    const code = compile(SRC_WITH_RESULT, 'fastapi');
    expect(code).not.toContain('type Result<T, E>');
    expect(code).not.toContain('// ── KERN stdlib');
  });

  test('Nuxt target also injects the preamble inside `<script setup lang="ts">`', () => {
    const src = [
      'screen name=Page',
      '  text value="hello"',
      'fn name=parseUser params="raw:string" returns="Result<User, ParseError>"',
      '  handler <<<',
      '    return { kind: "ok", value: { name: "alice" } };',
      '  >>>',
    ].join('\n');
    const code = compile(src, 'nuxt');
    const scriptOpen = code.indexOf('<script setup lang="ts">');
    const preamble = code.indexOf('type Result<T, E>');
    const scriptClose = code.indexOf('</script>');
    expect(scriptOpen).toBeGreaterThanOrEqual(0);
    expect(scriptOpen).toBeLessThan(preamble);
    expect(preamble).toBeLessThan(scriptClose);
  });

  test('Vue target injects the TS preamble INSIDE `<script setup lang="ts">`', () => {
    // Slice 4 follow-up: SFC-aware injection. The preamble must land
    // INSIDE the script block (so `<template>` parsing isn't broken) and
    // BEFORE any user code in that block.
    const src = [
      'screen name=Page',
      '  text value="hello"',
      'fn name=parseUser params="raw:string" returns="Result<User, ParseError>"',
      '  handler <<<',
      '    return { kind: "ok", value: { name: "alice" } };',
      '  >>>',
    ].join('\n');
    const code = compile(src, 'vue');
    expect(code).toContain('type Result<T, E>');
    expect(code).toContain('// ── KERN stdlib');
    // Order: opening script tag, then preamble, then `</script>`.
    const scriptOpen = code.indexOf('<script setup lang="ts">');
    const preamble = code.indexOf('type Result<T, E>');
    const scriptClose = code.indexOf('</script>');
    expect(scriptOpen).toBeGreaterThanOrEqual(0);
    expect(scriptOpen).toBeLessThan(preamble);
    expect(preamble).toBeLessThan(scriptClose);
    // SFC structure preserved.
    expect(code).toContain('<template>');
  });

  test('layer 3 — Result.ok / Result.err / Result.map are usable end-to-end on lib', () => {
    // The companion-object helpers only land if the type alias also lands.
    // This test pins the full layer-3 emit AND checks that a handler body
    // calling `Result.ok(...)` / `Result.map(...)` reads the helper from the
    // auto-emitted preamble (rather than hitting an undefined identifier).
    const code = compile(
      [
        'fn name=parseUser params="raw:string" returns="Result<User, ParseError>" export=true',
        '  handler <<<',
        '    if (!raw) return Result.err({ code: "EMPTY" });',
        '    return Result.ok({ id: raw, name: "alice" });',
        '  >>>',
        'fn name=loudName params="r:Result<User, ParseError>" returns="Result<string, ParseError>" export=true',
        '  handler <<<',
        '    return Result.map((u) => u.name.toUpperCase(), r);',
        '  >>>',
      ].join('\n'),
      'lib',
    );
    // Companion object emitted before the user fns
    expect(code).toContain('const Result = Object.freeze({');
    expect(code.indexOf('const Result = Object.freeze({')).toBeLessThan(code.indexOf('export function parseUser'));
    // User code referencing the helpers stays verbatim
    expect(code).toContain('return Result.err({ code: "EMPTY" });');
    expect(code).toContain('return Result.ok({ id: raw, name: "alice" });');
    expect(code).toContain('return Result.map((u) => u.name.toUpperCase(), r);');
  });

  test('layer 3 — Option helpers ride along when Option is used', () => {
    const code = compile(
      [
        'fn name=findUser params="id:string" returns="Option<User>" export=true',
        '  handler <<<',
        '    return id ? Option.some({ id, name: "alice" }) : Option.none();',
        '  >>>',
      ].join('\n'),
      'lib',
    );
    expect(code).toContain('const Option = Object.freeze({');
    expect(code).toContain('return id ? Option.some({ id, name: "alice" }) : Option.none();');
  });

  const NATIVE_LOOSE = [
    'fn name=check params="a:number,b:string" returns=boolean export=true',
    '  handler lang="kern"',
    '    let name=r value="a == b"',
    '    return value=r',
  ].join('\n');

  const NATIVE_POWER = [
    'fn name=power params="a:number,b:number" returns=number export=true',
    '  handler lang="kern"',
    '    return value="a ** b"',
  ].join('\n');

  test('portable power injects one checked helper before the native TS call site', () => {
    const code = compile(NATIVE_POWER, 'lib');
    expect(code.match(/const __kern_pow_int = \(/g)).toHaveLength(1);
    expect(code).toContain('return __kern_pow_int([a, b]);');
    expect(code.indexOf('const __kern_pow_int = (')).toBeLessThan(code.indexOf('return __kern_pow_int([a, b]);'));
  });

  test('portable power injects the equivalent checked helper on FastAPI', () => {
    const code = compile(NATIVE_POWER, 'fastapi');
    expect(code.match(/def _kern_pow_int\(/g)).toHaveLength(1);
    expect(code).toContain('return _kern_pow_int([a, b])');
  });

  test('portable power inside an accepted block closure lowers structurally on both native targets', () => {
    const source = [
      'fn name=closurePower returns=number export=true',
      '  handler lang="kern"',
      '    return value="List.map([1], x => { return 2 ** 3; })[0]"',
    ].join('\n');
    const tsCode = compile(source, 'lib');
    const pyCode = compile(source, 'fastapi');
    expect(tsCode).toContain('x => { return __kern_pow_int([2, 3]); }');
    expect(pyCode).toContain('return _kern_pow_int([2, 3])');
  });

  test.each([
    ['satisfies wrapper', '(2 ** 3 satisfies number) ** 2'],
    ['legacy type assertion', '(<number>(2 ** 3)) ** 2'],
    ['inline comment', '(2 /* base */ ** 3) ** 2'],
  ])('portable closure power normalizes a TypeScript-only %s on both native targets', (_name, expression) => {
    const source = [
      'fn name=closurePower returns=number export=true',
      '  handler lang="kern"',
      `    return value="List.map([1], x => { return ${expression}; })[0]"`,
    ].join('\n');

    expect(compile(source, 'lib')).toContain('return __kern_pow_int([__kern_pow_int([2, 3]), 2]);');
    expect(compile(source, 'fastapi')).toContain('return _kern_pow_int([_kern_pow_int([2, 3]), 2])');
  });

  test.each([
    ['block-comment characters', '/[/*]/.test(value)'],
    ['line-comment characters', '/[//]/.test(value)'],
    ['escaped slash before star', '/a\\/*b/.test(value)'],
  ])('portable closure power preserves regex literals containing %s on both native targets', (_name, condition) => {
    const source = [
      'fn name=closureRegexPower params="value:string" returns=number export=true',
      '  handler lang="kern"',
      `    return value="List.map([value], value => { return (${condition} ? 2 : 3) ** 2; })[0]"`,
    ].join('\n');

    expect(compile(source, 'lib')).toContain('__kern_pow_int([');
    expect(compile(source, 'fastapi')).toContain('_kern_pow_int([');
  });

  test.each([
    ['block marker after interpolation', '`${value}/*safe*/` == value', '/*safe*/'],
    ['line marker after interpolation', '`${value}//safe` == value', '//safe'],
    ['multiple interpolations', '`${value}/*safe*/${value}//tail` == value', '//tail'],
  ])(
    'portable closure power preserves template raw text with %s on both native targets',
    (_name, condition, marker) => {
      const source = [
        'fn name=closureTemplatePower params="value:string" returns=number export=true',
        '  handler lang="kern"',
        `    return value="List.map([value], value => { return (${condition} ? 2 : 3) ** 2; })[0]"`,
      ].join('\n');

      expect(compile(source, 'lib')).toContain(marker);
      expect(compile(source, 'fastapi')).toContain(marker);
    },
  );

  test.each([
    ['compact', 'identity<number /* type */>(2 ** 3) ** 2'],
    ['spaced', 'identity < number > (2 ** 3) ** 2'],
    ['trailing comma', 'identity<number,>(2 ** 3) ** 2'],
  ])('portable closure power removes %s generic call arguments on both native targets', (_name, expression) => {
    const source = [
      'fn name=closurePower returns=number export=true',
      '  handler lang="kern"',
      `    return value="List.map([1], x => { return ${expression}; })[0]"`,
    ].join('\n');

    expect(compile(source, 'lib')).toContain('return __kern_pow_int([identity(__kern_pow_int([2, 3])), 2]);');
    expect(compile(source, 'fastapi')).toContain('return _kern_pow_int([identity(_kern_pow_int([2, 3])), 2])');
  });

  test.each(['lib', 'fastapi'] as const)(
    'portable power compiles a 1,200-operand block closure iteratively on %s',
    (target) => {
      const chain = new Array(1_200).fill('1').join(' ** ');
      const source = [
        'fn name=closurePowerChain returns=number export=true',
        '  handler lang="kern"',
        `    return value="List.map([1], x => { return ${chain}; })[0]"`,
      ].join('\n');

      const code = compile(source, target);
      expect(code).toContain(target === 'lib' ? '__kern_pow_int([' : '_kern_pow_int([');
    },
  );

  test('generated-helper analysis remains stack-safe on a deep raw TypeScript handler', () => {
    const chain = new Array(3_000).fill('value').join(' + ');
    const source = [
      'fn name=deepRaw params="value:number" returns=number export=true',
      '  handler <<<',
      '    const marker = "__kern_pow_int";',
      `    return ${chain};`,
      '  >>>',
    ].join('\n');

    const code = compile(source, 'lib');
    expect(code).toContain(`return ${chain};`);
    expect(code).not.toContain('const __kern_pow_int = (');
  });

  test('generated-helper analysis fails closed on parser stack exhaustion', () => {
    const nested = `${'('.repeat(1_000)}value${')'.repeat(1_000)}`;
    const source = [
      'fn name=deepRaw params="value:number" returns=number export=true',
      '  handler <<<',
      `    return ${nested};`,
      '  >>>',
      'fn name=power returns=number export=true',
      '  handler lang="kern"',
      '    return value="2 ** 3"',
    ].join('\n');

    expect(() => compile(source, 'lib')).toThrow('Generated TypeScript helper safety analysis failed closed.');
  });

  test.each(['lib', 'fastapi'] as const)(
    'portable power compiles a 10,001-operand chain iteratively on %s',
    (target) => {
      const chain = new Array(10_001).fill('1').join(' ** ');
      const source = [
        'fn name=powerChain returns=number export=true',
        '  handler lang="kern"',
        `    return value="${chain}"`,
      ].join('\n');
      const code = compile(source, target);
      const helperCall = target === 'lib' ? '__kern_pow_int(' : '_kern_pow_int(';
      const returnLine = code.split('\n').find((line) => line.includes(`return ${helperCall}`)) ?? '';
      expect(returnLine).not.toBe('');
      expect(returnLine.slice(returnLine.indexOf(helperCall)).split(', ')).toHaveLength(10_001);
    },
  );

  test.each([
    [
      'fn name=__kern_pow_int params="a:number,b:number" returns=number export=true\n  handler <<<\n    return 7;\n  >>>',
    ],
    [
      'fn name=power params="__kern_pow_int:number,b:number" returns=number export=true\n  handler lang="kern"\n    return value="2 ** b"',
    ],
    [
      'fn name=power params="__kern_pow_int=2,b=3" returns=number export=true\n  handler lang="kern"\n    return value="__kern_pow_int ** b"',
    ],
    [
      'fn name=power params="a:number,b:number" returns=number export=true\n  handler lang="kern"\n    let name=__kern_pow_int value=7\n    return value="a ** b"',
    ],
    [
      'import from="./power" names="power as __kern_pow_int"\nfn name=power params="a:number,b:number" returns=number export=true\n  handler lang="kern"\n    return value="a ** b"',
    ],
    [
      'fn name=power params="xs:number[]" returns="number[]" export=true\n  handler lang="kern"\n    return value="List.map(xs, __kern_pow_int => 2 ** 3)"',
    ],
    [
      'fn name=power returns=number export=true\n  handler lang="kern"\n    each name=__kern_pow_int in="[1]"\n      return value="2 ** 3"',
    ],
    [
      'fn name=power params="record:object" returns=number export=true\n  handler lang="kern"\n    destructure source=record\n      binding name=__kern_pow_int\n    return value="2 ** 3"',
    ],
    [
      'fn name=power returns=number export=true\n  handler lang="kern"\n    try\n      throw value="1"\n      catch name=__kern_pow_int\n        return value="2 ** 3"',
    ],
    [
      'fn name=power returns=number export=true\n  handler lang="kern"\n    set name=__kern_pow_int to=1\n    return value="2 ** 3"',
    ],
    [
      'fn name=power returns=number export=true\n  handler lang="kern"\n    assign target=__kern_pow_int value=1\n    return value="2 ** 3"',
    ],
    [
      'fn name=power returns=string export=true\n  handler lang="kern"\n    fmt name=__kern_pow_int template="captured"\n    return value=__kern_pow_int',
    ],
    [
      'fn name=power returns=number export=true\n  handler lang="kern"\n    return value="List.map([1], x => { const __kern_pow_int = x; return __kern_pow_int; })[0]"',
    ],
  ])('rejects authored TypeScript bindings that capture the private power helper', (source) => {
    expect(() => compile(source, 'lib')).toThrow(/reserved.*power helper/i);
  });

  test.each([
    ['fn name=_kern_pow_int params="a:number,b:number" returns=number export=true\n  handler <<<\n    return 7\n  >>>'],
    [
      'fn name=power params="_kern_pow_int:number,b:number" returns=number export=true\n  handler lang="kern"\n    return value="2 ** b"',
    ],
    [
      'fn name=power params="a:number,b:number" returns=number export=true\n  handler lang="kern"\n    let name=_kern_pow_int value=7\n    return value="a ** b"',
    ],
    [
      'fn name=power params="xs:number[]" returns="number[]" export=true\n  handler lang="kern"\n    return value="List.map(xs, _kern_pow_int => 2 ** 3)"',
    ],
    [
      'fn name=power returns=number export=true\n  handler lang="kern"\n    each name=_kern_pow_int in="[1]"\n      return value="2 ** 3"',
    ],
    [
      'fn name=power params="record:object" returns=number export=true\n  handler lang="kern"\n    destructure source=record\n      binding name=_kern_pow_int\n    return value="2 ** 3"',
    ],
    [
      'fn name=power returns=number export=true\n  handler lang="kern"\n    try\n      throw value="1"\n      catch name=_kern_pow_int\n        return value="2 ** 3"',
    ],
    [
      'fn name=power returns=number export=true\n  handler lang="kern"\n    set name=_kern_pow_int to=1\n    return value="2 ** 3"',
    ],
    [
      'fn name=power returns=number export=true\n  handler lang="kern"\n    assign target=_kern_pow_int value=1\n    return value="2 ** 3"',
    ],
    [
      'fn name=power returns=string export=true\n  handler lang="kern"\n    fmt name=_kern_pow_int template="captured"\n    return value=_kern_pow_int',
    ],
    [
      'fn name=power returns=number export=true\n  handler lang="kern"\n    return value="List.map([1], x => { const _kern_pow_int = x; return _kern_pow_int; })[0]"',
    ],
  ])('rejects authored Python bindings that capture the private power helper', (source) => {
    expect(() => compile(source, 'fastapi')).toThrow(/reserved.*power helper/i);
  });

  test.each([
    'import from="./power" default=_kern_pow_int\nfn name=power params="a:number,b:number" returns=number export=true\n  handler lang="kern"\n    return value="a ** b"',
    'import from="./power" names="power as _kern_pow_int"\nfn name=power params="a:number,b:number" returns=number export=true\n  handler lang="kern"\n    return value="a ** b"',
  ])('Python imports cannot capture the private power helper', (source) => {
    expect(() => compile(source, 'fastapi')).toThrow();
  });

  test('D1b — a native `lang="kern"` body with loose `==` injects `__kern_loose_eq` on lib (TS)', () => {
    // Production-path coverage for the D1b helper: `applyKernStdlibPreamble` sets
    // `looseEq` from the EMITTED code (`emittedCodeUsesLooseEq`), so the helper def is
    // injected exactly when a `__kern_loose_eq(` call was emitted (detection==emission).
    const code = compile(NATIVE_LOOSE, 'lib');
    expect(code).toContain('function __kern_loose_eq(');
    expect(code).toContain('__kern_loose_eq(a, b)');
    // The def is injected ABOVE the call site.
    expect(code.indexOf('function __kern_loose_eq(')).toBeLessThan(code.lastIndexOf('__kern_loose_eq(a, b)'));
  });

  test('D1b — the FastAPI (Python) target does NOT get the TS loose helper', () => {
    // Python emits its own `_kern_loose_equal`; the TS helper would be a syntax error
    // in a .py file. The dispatcher guard (TS-family only) must skip it.
    const code = compile(NATIVE_LOOSE, 'fastapi');
    expect(code).not.toContain('__kern_loose_eq');
  });

  test('D1b — a module with only strict `===` does NOT inject the loose helper', () => {
    const code = compile(
      [
        'fn name=check params="a:number,b:number" returns=boolean export=true',
        '  handler lang="kern"',
        '    let name=r value="a === b"',
        '    return value=r',
      ].join('\n'),
      'lib',
    );
    expect(code).not.toContain('__kern_loose_eq');
  });

  test('mcp target gets the preamble for TS-family targets', () => {
    // MCP server emits TS — Result/Option aliases should land at the top.
    // We use `target=mcp` plus a minimal kern doc that the MCP transpiler
    // can process without error; we only assert on the preamble presence.
    const src = [
      'mcp name=TestServer version="1.0.0"',
      '  tool name=parseUser',
      '    param name=raw type=string',
      '    handler <<<',
      '      return { kind: "ok", value: { name: "alice" } } as Result<User, ParseError>;',
      '    >>>',
    ].join('\n');
    const code = compile(src, 'mcp');
    expect(code).toContain('type Result<T, E>');
  });
});

// ── KERN 4.5.0 item 3 — Text code-point-ops helper block via the production
//    pipeline (`applyKernStdlibPreamble`'s textOps detection == emission). ──
describe('transpileForTarget — Text code-point-ops helper preamble', () => {
  const NATIVE_TEXT = [
    'fn name=labelLen params="label:string" returns=number export=true',
    '  handler lang="kern"',
    '    return value="Text.length(label)"',
  ].join('\n');

  test('a native `lang="kern"` body using Text.length injects the __kern_text_* helper block on lib (TS)', () => {
    const code = compile(NATIVE_TEXT, 'lib');
    expect(code).toContain('__kern_text_length(label)');
    expect(code).toContain('function __kern_text_length(');
    // The def is injected ABOVE the call site.
    expect(code.indexOf('function __kern_text_length(')).toBeLessThan(code.lastIndexOf('__kern_text_length(label)'));
  });

  test('the FastAPI (Python) target does NOT get the TS text helper block', () => {
    // Python emits its own inline `_kern_text_*` defs via the `'text-ops'`
    // stdlib requirement; the TS `function __kern_text_…` block would be a
    // syntax error in a .py file. The dispatcher guard (TS-family only) must skip it.
    const code = compile(NATIVE_TEXT, 'fastapi');
    expect(code).not.toContain('function __kern_text_');
  });

  test('a module with no Text.* usage does NOT inject the text helper block', () => {
    const code = compile(
      [
        'fn name=check params="a:number,b:number" returns=boolean export=true',
        '  handler lang="kern"',
        '    let name=r value="a === b"',
        '    return value=r',
      ].join('\n'),
      'lib',
    );
    expect(code).not.toContain('__kern_text_');
  });

  // THE .vue VERDICT (agon review, verified empirically): today's vue/nuxt
  // transpilers never route a `lang="kern"` handler through the KERN-stdlib
  // lowering — they emit RAW handler text via `handlerCode` (zero
  // `emitNativeKernBody*` imports in packages/vue), so a `__kern_text_*(`
  // call CANNOT land in vue/nuxt output via `transpileForTarget` today, and
  // the missed-helper runtime crash the review hypothesized is unreachable.
  // This test PINS that finding: if the vue transpiler ever starts lowering
  // KERN bodies (making the scenario real), this fails and forces the
  // detection/injection story to be re-verified end-to-end.
  test('.vue verdict pin — the vue target does not lower Text.* through the KERN stdlib today', () => {
    const src = [
      'screen name=Page',
      '  text value="hello"',
      'fn name=labelLen params="label:string" returns=number',
      '  handler lang="kern"',
      '    return value="Text.length(label)"',
    ].join('\n');
    const code = compile(src, 'vue');
    // No lowered call anywhere in the SFC — the fn body is not KERN-lowered
    // on this target, so no helper block is needed (and none is injected).
    expect(code).not.toContain('__kern_text_length(');
  });

  // Defensive-closure halves (the shared.ts scan now includes .vue artifacts;
  // this proves both halves of that wiring at the unit level, since the
  // structured-vue output that would exercise it end-to-end is not reachable
  // from `transpileForTarget` yet — see the shared.ts comment):
  //   1. detection — `emittedCodeUsesTextOps` fires on SFC-shaped content;
  //   2. injection — the SFC injector places the helper INSIDE the
  //      `<script lang="ts">` block (and safely DROPS it for a template-only
  //      SFC rather than corrupting the parse).
  test('defensive .vue closure — detection fires on SFC content and SFC injection stays inside the script block', async () => {
    const { emittedCodeUsesTextOps, kernStdlibPreamble, injectKernStdlibPreambleIntoSFC } = await import(
      '@kernlang/core'
    );
    const sfc = [
      '<script setup lang="ts">',
      'function labelLen(label: string): number {',
      '  return __kern_text_length(label);',
      '}',
      '</script>',
      '',
      '<template>',
      '  <div>hello</div>',
      '</template>',
    ].join('\n');
    expect(emittedCodeUsesTextOps(sfc)).toBe(true);
    const preamble = kernStdlibPreamble({
      result: false,
      option: false,
      textOps: true,
    });
    const injected = injectKernStdlibPreambleIntoSFC(sfc, preamble);
    const scriptOpen = injected.indexOf('<script setup lang="ts">');
    const helperDef = injected.indexOf('function __kern_text_length(');
    const scriptClose = injected.indexOf('</script>');
    expect(scriptOpen).toBeGreaterThanOrEqual(0);
    expect(helperDef).toBeGreaterThan(scriptOpen);
    expect(helperDef).toBeLessThan(scriptClose);
    // Template-only SFC: preamble is DROPPED (documented safe behavior), the
    // file is returned unchanged rather than corrupted.
    const templateOnly = '<template>\n  <div>hello</div>\n</template>\n';
    expect(injectKernStdlibPreambleIntoSFC(templateOnly, preamble)).toBe(templateOnly);
  });
});
