import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { type SourceFile, SyntaxKind } from 'ts-morph';
import { extractThrowType, getContainerId, span } from '../helpers/ast.js';

export function extractErrorRaise(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // throw statements
  for (const throwStmt of sf.getDescendantsOfKind(SyntaxKind.ThrowStatement)) {
    const start = throwStmt.getStart();
    const _line = throwStmt.getStartLineNumber();
    const errorType = extractThrowType(throwStmt);

    nodes.push({
      id: conceptId(filePath, 'error_raise', start),
      kind: 'error_raise',
      primarySpan: span(filePath, throwStmt),
      evidence: throwStmt.getText().substring(0, 100),
      confidence: 1.0,
      language: 'ts',
      containerId: getContainerId(throwStmt, filePath),
      payload: {
        kind: 'error_raise',
        subtype: 'throw',
        errorType,
      },
    });
  }

  // Promise.reject()
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (pa.getName() !== 'reject') continue;
    if (pa.getExpression().getText() !== 'Promise') continue;

    nodes.push({
      id: conceptId(filePath, 'error_raise', call.getStart()),
      kind: 'error_raise',
      primarySpan: span(filePath, call),
      evidence: call.getText().substring(0, 100),
      confidence: 1.0,
      language: 'ts',
      containerId: getContainerId(call, filePath),
      payload: { kind: 'error_raise', subtype: 'reject' },
    });
  }
}
