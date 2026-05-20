import * as generated from '../src/generated/utils/migrate-literals.js';
import * as source from '../src/migrate-literals.js';

describe('generated migrate-literals parity', () => {
  it.each([
    '42',
    '-17',
    '3.14',
    '0xFF',
    '0b1010',
    '0o77',
    '1e3',
    '1_000_000',
    'true',
    'false',
    'null',
    'undefined',
    '"hello"',
    'foo',
    '60 * 60',
    '{}',
    '[]',
    '',
    '   ',
  ])('isInlineSafeLiteral(%p) matches source', (input) => {
    expect(generated.isInlineSafeLiteral(input)).toBe(source.isInlineSafeLiteral(input));
  });

  it.each([
    '60 * 60 * 1000',
    '"hello"',
    '{ a: 1 }',
    '',
    '  ',
    'x }} y',
  ])('isInlineSafeExpression(%p) matches source', (input) => {
    expect(generated.isInlineSafeExpression(input)).toBe(source.isInlineSafeExpression(input));
  });

  it.each([
    ['const', '42'],
    ['const', 'true'],
    ['const', '60 * 60 * 1000'],
    ['fn', 'return users.filter(u => u.active);'],
    ['route', 'return [];'],
    ['screen', 'return null;'],
    ['const', 'const x = 1;\nreturn x * 2;'],
    ['fn', 'const x = 1;\nreturn x * 2;'],
    ['const', 'x }} y'],
    ['fn', 'x }} y'],
    [undefined, '42'],
  ])('classifyHandlerGap(%p, %p) matches source', (parentType, body) => {
    expect(generated.classifyHandlerGap(parentType, body)).toEqual(source.classifyHandlerGap(parentType, body));
  });
});
