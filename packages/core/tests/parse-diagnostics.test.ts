import { KernParseError } from '../src/errors.js';
import { getParseDiagnostics, parse, parseDocumentStrict, parseStrict, parseWithDiagnostics } from '../src/parser.js';
import type { ParseErrorCode } from '../src/types.js';

describe('Parse Diagnostics', () => {
  test('parseStrict throws KernParseError with diagnostics', () => {
    expect(() => parseStrict('text value={{broken')).toThrow(KernParseError);

    try {
      parseStrict('text value={{broken');
    } catch (err) {
      const error = err as KernParseError;
      expect(error.diagnostics.some((d) => d.code === 'UNCLOSED_EXPR')).toBe(true);
      expect(error.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    }
  });

  test('parseDocumentStrict throws on error diagnostics and returns document for valid input', () => {
    expect(() => parseDocumentStrict('text value="broken')).toThrow(KernParseError);
    expect(parseDocumentStrict('screen\n  text').type).toBe('document');
  });

  test('parseStrict does not throw when diagnostics are warnings only', () => {
    expect(() => parseStrict('mystery value="a" value="b"')).not.toThrow();
  });

  test('emits INDENT_JUMP warning on dedent to unseen indent level', () => {
    const { diagnostics } = parseWithDiagnostics('screen\n    text\n   button');
    const jump = diagnostics.find((d) => d.code === 'INDENT_JUMP');
    expect(jump).toBeDefined();
    expect(jump?.severity).toBe('warning');
  });

  test('emits DUPLICATE_PROP warning when a property is set twice', () => {
    const { diagnostics } = parseWithDiagnostics('text value="a" value="b"');
    const duplicate = diagnostics.find((d) => d.code === 'DUPLICATE_PROP');
    expect(duplicate).toBeDefined();
    expect(duplicate?.severity).toBe('warning');
    expect(duplicate?.message).toContain('value');
  });

  test('emits DROPPED_LINE when a non-empty line cannot start a node', () => {
    const { diagnostics } = parseWithDiagnostics('screen\n  )oops');
    const dropped = diagnostics.find((d) => d.code === 'DROPPED_LINE');
    expect(dropped).toBeDefined();
    expect(dropped?.severity).toBe('error');
  });

  test('emits an error diagnostic for an unclosed multiline block', () => {
    const { diagnostics } = parseWithDiagnostics('handler <<<\nconst value = 1;');
    const block = diagnostics.find((d) => d.message.includes('Unclosed multiline block'));
    expect(block).toBeDefined();
    expect(block?.severity).toBe('error');
  });

  test('captures multiple diagnostics from one file', () => {
    const { diagnostics } = parseWithDiagnostics('text value={{broken\n  {bg:red');
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(3);
    expect(diagnostics.some((d) => d.code === 'UNCLOSED_EXPR')).toBe(true);
    expect(diagnostics.some((d) => d.code === 'UNCLOSED_STYLE')).toBe(true);
    expect(diagnostics.some((d) => d.code === 'DROPPED_LINE')).toBe(true);
  });

  test('leaf node spans use the full raw line length', () => {
    const ast = parse('text');
    expect(ast.loc?.endLine).toBe(1);
    expect(ast.loc?.endCol).toBe(5);
  });

  test.each<{ code: ParseErrorCode; source: string }>([
    { code: 'UNCLOSED_EXPR', source: 'text value={{broken' },
    { code: 'UNCLOSED_STYLE', source: 'text {bg:red' },
    { code: 'UNCLOSED_STRING', source: 'text value="broken' },
    { code: 'UNEXPECTED_TOKEN', source: 'text )' },
    { code: 'EMPTY_DOCUMENT', source: '' },
    { code: 'INVALID_INDENT', source: 'screen\n\ttext' },
    { code: 'UNKNOWN_NODE_TYPE', source: 'mystery' },
    { code: 'INDENT_JUMP', source: 'screen\n    text\n   button' },
    { code: 'DUPLICATE_PROP', source: 'text value="a" value="b"' },
    { code: 'DROPPED_LINE', source: ')' },
  ])('$code produces structured diagnostics', ({ code, source }) => {
    const { diagnostics } = parseWithDiagnostics(source);
    const match = diagnostics.find((d) => d.code === code);

    expect(match).toBeDefined();
    expect(match?.code).toBe(code);
    expect(typeof match?.severity).toBe('string');
    expect(typeof match?.message).toBe('string');
    expect(typeof match?.line).toBe('number');
    expect(typeof match?.col).toBe('number');
    expect(typeof match?.endCol).toBe('number');
    expect(match?.endCol).toBeGreaterThanOrEqual(match?.col ?? 0);
    expect(typeof match?.suggestion).toBe('string');
    expect(match?.suggestion.length).toBeGreaterThan(0);
  });

  test('getParseDiagnostics returns the last parse diagnostics', () => {
    parse('mystery');
    expect(getParseDiagnostics().some((d) => d.code === 'UNKNOWN_NODE_TYPE')).toBe(true);

    parse('screen');
    expect(getParseDiagnostics()).toEqual([]);
  });
});
