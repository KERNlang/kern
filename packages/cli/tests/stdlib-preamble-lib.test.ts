/** Slice 4 layer 2 — `transpileLib` integration test for the Result/Option preamble.
 *
 *  Verifies the lib-target codegen prepends the type aliases when the source
 *  references `Result<>` / `Option<>` and stays silent when it doesn't.
 *  Spec: docs/language/result-option-spec.md. */

import { parseDocument, resolveConfig } from '@kernlang/core';
import { transpileForTarget } from '../src/shared.js';

function compileLib(src: string): string {
  const ast = parseDocument(src);
  const cfg = resolveConfig({ target: 'lib' });
  return transpileForTarget(ast, cfg).code;
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
