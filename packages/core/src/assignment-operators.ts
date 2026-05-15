import ts from 'typescript';

export const SUPPORTED_ASSIGN_OPERATORS = [
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '&=',
  '|=',
  '^=',
  '<<=',
  '>>=',
  // Postfix mutation operators — accepted by the `assign` body-statement as a
  // value-less form (`assign target=X op="++"`). Required for byte-equivalent
  // round-trip of standalone postfix expressions (`i++;`) in raw handler
  // migration — see migrate-native-handlers and the slice α-3 parity invariant.
  '++',
  '--',
] as const;

export type SupportedAssignOperator = (typeof SUPPORTED_ASSIGN_OPERATORS)[number];

const SUPPORTED_ASSIGN_OPERATOR_SET = new Set<string>(SUPPORTED_ASSIGN_OPERATORS);

export function isSupportedAssignOperator(op: string): op is SupportedAssignOperator {
  return SUPPORTED_ASSIGN_OPERATOR_SET.has(op);
}

export function isPostfixMutationOperator(op: string): op is '++' | '--' {
  return op === '++' || op === '--';
}

export function supportedCompoundAssignmentOperator(kind: ts.SyntaxKind): SupportedAssignOperator | null {
  switch (kind) {
    case ts.SyntaxKind.PlusEqualsToken:
      return '+=';
    case ts.SyntaxKind.MinusEqualsToken:
      return '-=';
    case ts.SyntaxKind.AsteriskEqualsToken:
      return '*=';
    case ts.SyntaxKind.SlashEqualsToken:
      return '/=';
    case ts.SyntaxKind.PercentEqualsToken:
      return '%=';
    case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
      return '**=';
    case ts.SyntaxKind.AmpersandEqualsToken:
      return '&=';
    case ts.SyntaxKind.BarEqualsToken:
      return '|=';
    case ts.SyntaxKind.CaretEqualsToken:
      return '^=';
    case ts.SyntaxKind.LessThanLessThanEqualsToken:
      return '<<=';
    case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
      return '>>=';
    default:
      return null;
  }
}
