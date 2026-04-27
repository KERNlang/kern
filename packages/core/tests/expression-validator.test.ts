import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { exportSchemaJSON } from '../src/schema.js';

function diagnosticsFor(src: string) {
  return parseDocumentWithDiagnostics(src).diagnostics;
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
