import { typescriptCodeBindsOrWritesIdentifier } from '../src/typescript-generated-helper-safety.js';

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
});
