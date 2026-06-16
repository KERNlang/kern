/** Slice 0.9 — TypeScript-AST helper split out of `assignment-operators.ts`.
 *
 *  `supportedCompoundAssignmentOperator` maps a `ts.SyntaxKind` token to a KERN
 *  compound-assignment operator. It is the ONLY assignment-operator helper that
 *  depends on `typescript`, so it lives here (the Node/codegen side) rather than
 *  in `assignment-operators.ts`. That keeps `assignment-operators.ts` — and the
 *  `@kernlang/core` barrel that re-exports its string predicates — free of the
 *  `typescript` import (R1 barrel-isolation). Reachable only via the Node subpath
 *  (`@kernlang/core/node`) or direct module import. */

import ts from 'typescript';
import type { SupportedAssignOperator } from './generated/utils/assignment-operators.js';

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
