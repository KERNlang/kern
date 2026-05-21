import ts from 'typescript';

import * as facade from '../src/assignment-operators.js';
import * as generated from '../src/generated/utils/assignment-operators.js';

describe('generated assignment-operators behavior', () => {
  const supported = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=', '++', '--'];

  it('exports the supported operator list in schema display order', () => {
    expect(generated.SUPPORTED_ASSIGN_OPERATORS).toEqual(supported);
    expect(facade.SUPPORTED_ASSIGN_OPERATORS).toEqual(supported);
  });

  it.each(supported)('accepts supported operator %p', (op) => {
    expect(generated.isSupportedAssignOperator(op)).toBe(true);
    expect(facade.isSupportedAssignOperator(op)).toBe(true);
  });

  it.each(['', '+', '=>', '??=', '&&=', '||=', '>>>=', 'delete'])('rejects unsupported operator %p', (op) => {
    expect(generated.isSupportedAssignOperator(op)).toBe(false);
    expect(facade.isSupportedAssignOperator(op)).toBe(false);
  });

  it.each([
    ['++', true],
    ['--', true],
    ['+=', false],
    ['=', false],
  ])('isPostfixMutationOperator(%p) returns %p', (op, expected) => {
    expect(generated.isPostfixMutationOperator(op)).toBe(expected);
    expect(facade.isPostfixMutationOperator(op)).toBe(expected);
  });

  it('src facade preserves generated predicate behavior with public type guards', () => {
    for (const op of [...supported, '??=']) {
      expect(facade.isSupportedAssignOperator(op)).toBe(generated.isSupportedAssignOperator(op));
      expect(facade.isPostfixMutationOperator(op)).toBe(generated.isPostfixMutationOperator(op));
    }
  });

  it.each([
    [ts.SyntaxKind.PlusEqualsToken, '+='],
    [ts.SyntaxKind.MinusEqualsToken, '-='],
    [ts.SyntaxKind.AsteriskEqualsToken, '*='],
    [ts.SyntaxKind.SlashEqualsToken, '/='],
    [ts.SyntaxKind.PercentEqualsToken, '%='],
    [ts.SyntaxKind.AsteriskAsteriskEqualsToken, '**='],
    [ts.SyntaxKind.AmpersandEqualsToken, '&='],
    [ts.SyntaxKind.BarEqualsToken, '|='],
    [ts.SyntaxKind.CaretEqualsToken, '^='],
    [ts.SyntaxKind.LessThanLessThanEqualsToken, '<<='],
    [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, '>>='],
    [ts.SyntaxKind.EqualsToken, null],
  ] as const)('supportedCompoundAssignmentOperator(%p) returns %p', (kind, expected) => {
    expect(facade.supportedCompoundAssignmentOperator(kind)).toBe(expected);
  });

  it.each([
    ts.SyntaxKind.QuestionQuestionEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ] as const)('supportedCompoundAssignmentOperator rejects unsupported compound kind %p', (kind) => {
    expect(facade.supportedCompoundAssignmentOperator(kind)).toBeNull();
  });
});
