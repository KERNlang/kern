// Facade. Source of truth: packages/core/src/kern/utils/assignment-operators.kern.
// NOTE (slice 0.9): the `ts.SyntaxKind`-based `supportedCompoundAssignmentOperator`
// was split into `assignment-operators-ts.ts` (Node/TS side) so this module — and
// the browser-safe `@kernlang/core` barrel that re-exports its string predicates —
// stays free of the `typescript` import.
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
