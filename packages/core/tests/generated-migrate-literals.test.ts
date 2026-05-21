import * as facade from '../src/migrate-literals.js';
import * as generated from '../src/generated/utils/migrate-literals.js';

describe('generated migrate-literals behavior', () => {
  it.each([
    ['42', true],
    ['-17', true],
    ['3.14', true],
    ['0xFF', true],
    ['0b1010', true],
    ['0o77', true],
    ['1e3', true],
    ['1_000_000', true],
    ['true', true],
    ['false', true],
    ['null', true],
    ['undefined', true],
    ['"hello"', false],
    ['foo', false],
    ['60 * 60', false],
    ['{}', false],
    ['[]', false],
    ['', false],
    ['   ', false],
  ])('isInlineSafeLiteral(%p) returns %p', (input, expected) => {
    expect(generated.isInlineSafeLiteral(input)).toBe(expected);
  });

  it.each([
    ['60 * 60 * 1000', true],
    ['"hello"', true],
    ['{ a: 1 }', true],
    ['', false],
    ['  ', false],
    ['x }} y', false],
  ])('isInlineSafeExpression(%p) returns %p', (input, expected) => {
    expect(generated.isInlineSafeExpression(input)).toBe(expected);
  });

  it.each([
    ['const', '42', { category: 'migratable', migration: 'literal-const' }],
    ['const', 'true', { category: 'migratable', migration: 'literal-const' }],
    ['const', '60 * 60 * 1000', { category: 'migratable', migration: 'literal-const' }],
    ['fn', 'return users.filter(u => u.active);', { category: 'migratable', migration: 'fn-expr' }],
    ['route', 'return [];', { category: 'detected' }],
    ['screen', 'return null;', { category: 'detected' }],
    ['const', 'const x = 1;\nreturn x * 2;', { category: 'detected' }],
    ['fn', 'const x = 1;\nreturn x * 2;', { category: 'detected' }],
    ['const', 'x }} y', { category: 'detected' }],
    ['fn', 'x }} y', { category: 'detected' }],
    [undefined, '42', { category: 'detected' }],
  ] satisfies Array<[string | undefined, string, ReturnType<typeof generated.classifyHandlerGap>]>)(
    'classifyHandlerGap(%p, %p) returns %p',
    (parentType, body, expected) => {
      expect(generated.classifyHandlerGap(parentType, body)).toEqual(expected);
    },
  );

  it('migrate-literals facade delegates all generated exports', () => {
    expect(facade.isInlineSafeLiteral('42')).toBe(generated.isInlineSafeLiteral('42'));
    expect(facade.isInlineSafeExpression('60 * 60')).toBe(generated.isInlineSafeExpression('60 * 60'));
    expect(facade.classifyHandlerGap('const', '42')).toEqual(generated.classifyHandlerGap('const', '42'));
  });
});
