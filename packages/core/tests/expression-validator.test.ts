import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { exportSchemaJSON } from '../src/schema.js';
import type { IRNode } from '../src/types.js';

function diagnosticsFor(src: string) {
  return parseDocumentWithDiagnostics(src).diagnostics;
}

function rootOf(src: string): IRNode {
  return parseDocumentWithDiagnostics(src).root;
}

function findNode(root: IRNode, type: string): IRNode | undefined {
  if (root.type === type) return root;
  if (!root.children) return undefined;
  for (const child of root.children) {
    const hit = findNode(child, type);
    if (hit) return hit;
  }
  return undefined;
}

describe('Expression validator (post-parse)', () => {
  test('const value=user?.name parses cleanly', () => {
    const diags = diagnosticsFor('const name=greeting value=user?.name\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('const value=42 parses cleanly', () => {
    const diags = diagnosticsFor('const name=answer value=42\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('const value=3.14 parses cleanly', () => {
    const diags = diagnosticsFor('const name=PI value=3.14\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('const value=1.5n emits INVALID_EXPRESSION (bigint with frac)', () => {
    const diags = diagnosticsFor('const name=bad value=1.5n\n');
    const errs = diags.filter((d) => d.code === 'INVALID_EXPRESSION');
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/BigInt/);
  });

  test('const value={{ JSON.stringify(x) }} bypasses validator', () => {
    // ExprObject — escape hatch, not parsed by us
    const diags = diagnosticsFor('const name=raw value={{ JSON.stringify(x) }}\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('const value="hello" bypasses validator (treated as string after parse)', () => {
    // Quoted strings store unwrapped value 'hello', which parses as ident — clean
    const diags = diagnosticsFor('const name=msg value="hello"\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('const without value emits no diagnostic', () => {
    const diags = diagnosticsFor('const name=just_name\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('non-const node with bare value not validated', () => {
    // text has no expression-kind props
    const diags = diagnosticsFor('text "hello"\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('exportSchemaJSON propKinds advertises expression and regex', () => {
    const json = exportSchemaJSON();
    expect(json.propKinds).toContain('expression');
    expect(json.propKinds).toContain('regex');
  });

  test('exportSchemaJSON const.value kind is "expression"', () => {
    const json = exportSchemaJSON();
    expect(json.schemas.const.props.value.kind).toBe('expression');
  });
});

describe('Quote-origin tracking (Slice 1i)', () => {
  test('quoted prop with slashes does not raise INVALID_EXPRESSION', () => {
    // Pre-1i this was masked by the looksQuotedOrigin heuristic. Now relies on metadata.
    const diags = diagnosticsFor('const name=endpoint value="/api/providers"\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('quoted prop with backslash does not raise INVALID_EXPRESSION', () => {
    const diags = diagnosticsFor('const name=pat value="a\\\\b"\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('quoted prop with embedded space does not raise INVALID_EXPRESSION', () => {
    const diags = diagnosticsFor('const name=msg value="hello world"\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('node.__quotedProps lists quoted prop names', () => {
    const node = findNode(rootOf('const name=msg value="hello world"\n'), 'const');
    // name is a bare ident ('msg' is unquoted), value is quoted — only value should be tracked
    expect(node?.__quotedProps).toEqual(['value']);
  });

  test('node.__quotedProps is omitted when no props are quoted', () => {
    const node = findNode(rootOf('const name=answer value=42\n'), 'const');
    expect(node?.__quotedProps).toBeUndefined();
  });

  test('mixed quoted/bare props track only the quoted ones', () => {
    const node = findNode(rootOf('const name=cfg value=user?.name type="string"\n'), 'const');
    // value is bare; type is quoted
    expect(node?.__quotedProps).toEqual(['type']);
  });

  test('__quotedProps survives JSON roundtrip (stored as plain array)', () => {
    const node = findNode(rootOf('const name=endpoint value="/api"\n'), 'const');
    const cloned = JSON.parse(JSON.stringify(node)) as IRNode;
    expect(cloned.__quotedProps).toEqual(['value']);
  });

  test('bare expression in const.value still validates (no regression on real expressions)', () => {
    const diags = diagnosticsFor('const name=g value=user?.name\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION')).toEqual([]);
  });

  test('bare invalid expression still raises INVALID_EXPRESSION', () => {
    const diags = diagnosticsFor('const name=bad value=1.5n\n');
    expect(diags.filter((d) => d.code === 'INVALID_EXPRESSION').length).toBe(1);
  });

  test('expr-token ({{...}}) is not added to __quotedProps', () => {
    const node = findNode(rootOf('const name=raw value={{ JSON.stringify(x) }}\n'), 'const');
    expect(node?.__quotedProps).toBeUndefined();
  });
});
