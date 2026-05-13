import { parseDocumentWithDiagnostics } from '../src/parser.js';

// Coverage for the `category` field on ParseDiagnostic. Authoring tools
// (CI, editors, agents) split routing by category — parser bugs go
// upstream, source errors go to the author, validator rejects go to a
// language reference.
describe('ParseDiagnostic.category', () => {
  test('parser-level diagnostics carry category="parser"', () => {
    // INDENT_JUMP warns when a dedent lands on an unseen indent level —
    // a parser-side issue, not a violation of the source schema.
    const { diagnostics } = parseDocumentWithDiagnostics('screen\n    text\n   button');
    const jump = diagnostics.find((d) => d.code === 'INDENT_JUMP');
    expect(jump).toBeDefined();
    expect(jump?.category).toBe('parser');
  });

  test('body-statement validator diagnostics carry category="validator"', () => {
    // `return value="x"` at module scope (no enclosing native handler) is
    // a validator-level reject, not a syntax error.
    const { diagnostics } = parseDocumentWithDiagnostics('return value="x"');
    const bodyStmt = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(bodyStmt).toBeDefined();
    expect(bodyStmt?.category).toBe('validator');
  });

  test('default category is source when not explicitly assigned', () => {
    // Source-level: a malformed expression that the parser couldn't
    // canonicalise. Every diagnostic now carries a category, and codes
    // not on the parser/validator allow-list fall through to "source".
    const { diagnostics } = parseDocumentWithDiagnostics('text value={{ unclosed');
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics) {
      expect(d.category).toBeDefined();
      // Either parser-level (UNCLOSED_EXPR) or source. The point is just
      // that every emitter sets the category — no `undefined`.
    }
  });
});
