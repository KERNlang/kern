import { parse, parseWithDiagnostics } from '../src/parser.js';
import { validateSchema } from '../src/schema.js';

// Regression coverage for the implicit-document-root bug: when `parse()` is
// called on a source with multiple top-level decls at the same indent, the
// first decl used to become the root and the rest were mis-nested as its
// children, producing bogus schema errors like
// "'interface' does not allow child type 'fn'".
describe('parse() auto-promotes to document for multi-toplevel sources', () => {
  test('interface + const + fn — no bogus child-type violations', () => {
    const source = [
      'interface name=Foo',
      '  field name=id type=string',
      'const name=X value=1',
      'fn name=bar returns=number',
      '  handler lang="kern"',
      '    return value="1"',
    ].join('\n');

    const root = parse(source);
    expect(root.type).toBe('document');
    const types = (root.children ?? []).map((c) => c.type);
    expect(types).toEqual(['interface', 'const', 'fn']);

    const violations = validateSchema(root);
    const childViolations = violations.filter((v) => /does not allow child type/.test(v.message));
    expect(childViolations).toEqual([]);
  });

  test('import + interface + union + fn — siblings, not nested children', () => {
    const source = [
      'import from="./types" names="Bar"',
      'interface name=Foo',
      '  field name=id type=string',
      'union name=Msg discriminant=kind',
      '  variant name=hello',
      'fn name=run',
      '  handler lang="kern"',
      '    return',
    ].join('\n');

    const { root, diagnostics } = parseWithDiagnostics(source);
    expect(root.type).toBe('document');
    expect((root.children ?? []).map((c) => c.type)).toEqual(['import', 'interface', 'union', 'fn']);
    // No DROPPED_LINE or schema-shaped error diagnostics
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

    const violations = validateSchema(root);
    const childViolations = violations.filter((v) => /does not allow child type/.test(v.message));
    expect(childViolations).toEqual([]);
  });

  test('single top-level decl still returns the decl as root (no promotion)', () => {
    const source = ['interface name=Foo', '  field name=id type=string'].join('\n');
    const root = parse(source);
    expect(root.type).toBe('interface');
  });

  test('single top-level fn + body statements still returns fn root (no promotion)', () => {
    const source = ['fn name=bar returns=number', '  handler lang="kern"', '    return value="1"'].join('\n');
    const root = parse(source);
    expect(root.type).toBe('fn');
  });
});
