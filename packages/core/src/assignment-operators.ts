// Facade. Source of truth: packages/core/src/kern/utils/assignment-operators.kern.
import ts from 'typescript';
import type { PostfixMutationOperator, SupportedAssignOperator } from './generated/utils/assignment-operators.js';
import {
  SUPPORTED_ASSIGN_OPERATORS as GENERATED_SUPPORTED_ASSIGN_OPERATORS,
  isPostfixMutationOperator as isGeneratedPostfixMutationOperator,
  isSupportedAssignOperator as isGeneratedSupportedAssignOperator,
} from './generated/utils/assignment-operators.js';

export type {
  PostfixMutationOperator,
  SupportedAssignOperator,
} from './generated/utils/assignment-operators.js';

export const SUPPORTED_ASSIGN_OPERATORS = GENERATED_SUPPORTED_ASSIGN_OPERATORS as readonly SupportedAssignOperator[];

export function isSupportedAssignOperator(op: string): op is SupportedAssignOperator {
  return isGeneratedSupportedAssignOperator(op);
}

export function isPostfixMutationOperator(op: string): op is PostfixMutationOperator {
  return isGeneratedPostfixMutationOperator(op);
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
