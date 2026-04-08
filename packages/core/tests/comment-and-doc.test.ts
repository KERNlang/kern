import { generateCoreNode, isCoreNode } from '../src/codegen-core.js';
import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { parse } from '../src/parser.js';

// Helper: parse a .kern snippet and generate code for the root node
function gen(source: string): string {
  const root = parse(source);
  return generateCoreNode(root).join('\n');
}

describe('Comment support', () => {
  it('skips full-line // comments without errors', () => {
    const result = parseDocumentWithDiagnostics('// this is a comment\ntype name=Foo values="a|b"');
    expect(result.diagnostics.filter((d) => d.code === 'DROPPED_LINE')).toHaveLength(0);
    expect(result.root.children?.length).toBe(1);
    expect(result.root.children?.[0].type).toBe('type');
  });

  it('skips indented // comments', () => {
    const result = parseDocumentWithDiagnostics('type name=Foo values="a|b"\n  // indented comment');
    expect(result.diagnostics.filter((d) => d.code === 'DROPPED_LINE')).toHaveLength(0);
  });

  it('handles multiple comment lines', () => {
    const source = '// first\n// second\ntype name=Bar values="x|y"\n// trailing';
    const result = parseDocumentWithDiagnostics(source);
    expect(result.diagnostics.filter((d) => d.code === 'DROPPED_LINE')).toHaveLength(0);
    expect(result.root.children?.length).toBe(1);
  });
});

describe('doc node', () => {
  it('is a core node type', () => {
    expect(isCoreNode('doc')).toBe(true);
  });

  it('generates JSDoc comment from text prop', () => {
    const code = gen('doc text="Represents a user account"');
    expect(code).toBe('/** Represents a user account */');
  });

  it('generates empty JSDoc when no text prop', () => {
    const code = gen('doc');
    expect(code).toBe('/**  */');
  });
});
