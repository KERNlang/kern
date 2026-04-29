/** Slice 4 layer 2 — `Result<>` / `Option<>` preamble detection tests.
 *
 *  Spec: docs/language/result-option-spec.md.
 *  Utility: packages/core/src/codegen/stdlib-preamble.ts. */

import { detectKernStdlibUsage, kernStdlibPreamble } from '../src/codegen/stdlib-preamble.js';
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
