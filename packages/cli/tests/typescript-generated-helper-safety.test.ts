import {
  analyzeTypeScriptGeneratedHelperUsage,
  typescriptCodeBindsOrWritesIdentifier,
} from '../src/typescript-generated-helper-safety.js';
import { TYPESCRIPT_PARSER_EXHAUSTION_DEPTH } from './typescript-parser-exhaustion-fixture.js';

const RESERVED = '__kern_pow_int';

describe('target-generated helper binding safety', () => {
  test.each([
    'const __kern_pow_int = 1;',
    'const { value: __kern_pow_int } = source;',
    'function run(__kern_pow_int: number) {}',
    'function __kern_pow_int() {}',
    'class __kern_pow_int {}',
    "import __kern_pow_int from './helper.js';",
    "import { helper as __kern_pow_int } from './helper.js';",
    'try {} catch (__kern_pow_int) {}',
    '__kern_pow_int = replacement;',
    '++__kern_pow_int;',
    'for (__kern_pow_int of replacements) {}',
    'for (__kern_pow_int in replacements) {}',
    '(__kern_pow_int as any) = replacement;',
    '__kern_pow_int! = replacement;',
    '(__kern_pow_int satisfies any) = replacement;',
    '(<any>__kern_pow_int) = replacement;',
    '[(__kern_pow_int as any)] = replacements;',
    '({ value: (__kern_pow_int as any) } = source);',
    '[__kern_pow_int = fallback] = replacements;',
    '({ value: __kern_pow_int = fallback } = source);',
    'for ((__kern_pow_int as any) of replacements) {}',
  ])('detects a generated declaration or write: %s', (source) => {
    expect(typescriptCodeBindsOrWritesIdentifier(source, RESERVED)).toBe(true);
  });

  test.each([
    'const local = __kern_pow_int([2, 3]);',
    'const local = object.__kern_pow_int;',
    'object.__kern_pow_int = replacement;',
    'const { __kern_pow_int: local } = source;',
    'type __kern_pow_int = number;',
    'interface __kern_pow_int { value: number }',
  ])('does not confuse a reference or property key with a binding: %s', (source) => {
    expect(typescriptCodeBindsOrWritesIdentifier(source, RESERVED)).toBe(false);
  });

  test('analyzes the call and collision in the same TSX traversal', () => {
    expect(
      analyzeTypeScriptGeneratedHelperUsage(
        'const __kern_pow_int = useCallback(() => __kern_pow_int([2, 3]), []); return <Box />;',
        RESERVED,
        'tsx',
      ),
    ).toEqual({ calls: true, bindsOrWrites: true });
  });

  test('uses the caller-declared TSX syntax mode without internal diagnostic fields', () => {
    expect(
      analyzeTypeScriptGeneratedHelperUsage('const view = <Box>{__kern_pow_int([2, 3])}</Box>;', RESERVED, 'tsx'),
    ).toEqual({ calls: true, bindsOrWrites: false });
  });

  test('does not confuse inert JSX text with an executed helper call', () => {
    expect(
      analyzeTypeScriptGeneratedHelperUsage('const view = <Box>__kern_pow_int([2, 3])</Box>;', RESERVED, 'tsx'),
    ).toEqual({ calls: false, bindsOrWrites: false });
  });

  test('analyzes a 5,000-term generated expression without recursive overflow', () => {
    const chain = new Array(5_000).fill('1').join(' + ');
    const source = `const value = ${chain}; const result = __kern_pow_int([2, 3]);`;

    expect(analyzeTypeScriptGeneratedHelperUsage(source, RESERVED)).toEqual({
      calls: true,
      bindsOrWrites: false,
    });
  });

  test('fails closed when generated TypeScript exceeds the parser stack', () => {
    const nested = `${'('.repeat(TYPESCRIPT_PARSER_EXHAUSTION_DEPTH)}1${')'.repeat(TYPESCRIPT_PARSER_EXHAUSTION_DEPTH)}`;
    const source = `function deep() { return ${nested}; } const result = __kern_pow_int([2, 3]);`;

    expect(() => analyzeTypeScriptGeneratedHelperUsage(source, RESERVED)).toThrow(
      'Generated TypeScript helper safety analysis failed closed.',
    );
  });

  test('fails closed when TSX parser recovery could hide a reserved-helper write', () => {
    expect(() =>
      analyzeTypeScriptGeneratedHelperUsage('const value = <<< >>>; __kern_pow_int = replacement;', RESERVED, 'tsx'),
    ).toThrow('Generated TypeScript helper safety analysis failed closed.');
  });

  test.each([
    'return "__kern_pow_int([fake])";',
    '// __kern_pow_int([fake])\nreturn 1;',
    'return /__kern_pow_int([x])/;',
  ])('does not classify an inert mention as a call: %s', (source) => {
    expect(analyzeTypeScriptGeneratedHelperUsage(source, RESERVED).calls).toBe(false);
  });
});
