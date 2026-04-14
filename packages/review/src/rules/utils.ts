/**
 * Shared helpers for review rules — eliminates duplication of span() and finding()
 * across base.ts, react.ts, nextjs.ts, express.ts, security.ts, vue.ts, dead-logic.ts.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

export function span(file: string, line: number, col = 1, endLine?: number, endCol?: number): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: endLine ?? line, endCol: endCol ?? col };
}

/**
 * Compute a precise SourceSpan for a ts-morph Node, using 1-based line/column.
 * Used by autofix rules that need character-accurate replacement coordinates.
 */
export function nodeSpan(node: Node, file: string): SourceSpan {
  const sf = node.getSourceFile();
  const start = sf.getLineAndColumnAtPos(node.getStart());
  const end = sf.getLineAndColumnAtPos(node.getEnd());
  return {
    file,
    startLine: start.line,
    startCol: start.column,
    endLine: end.line,
    endCol: end.column,
  };
}

/**
 * Compute a SourceSpan for the insertion point immediately before a node.
 * For use with FixAction.type === 'insert-before'.
 */
export function insertBeforeSpan(node: Node, file: string): SourceSpan {
  const sf = node.getSourceFile();
  const start = sf.getLineAndColumnAtPos(node.getStart());
  return {
    file,
    startLine: start.line,
    startCol: start.column,
    endLine: start.line,
    endCol: start.column,
  };
}

/**
 * Compute a SourceSpan for the insertion point immediately after a node.
 * For use with FixAction.type === 'insert-after'.
 */
export function insertAfterSpan(node: Node, file: string): SourceSpan {
  const sf = node.getSourceFile();
  const end = sf.getLineAndColumnAtPos(node.getEnd());
  return {
    file,
    startLine: end.line,
    startCol: end.column,
    endLine: end.line,
    endCol: end.column,
  };
}

export function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  category: ReviewFinding['category'],
  message: string,
  file: string,
  line: number,
  col = 1,
  extra?: Partial<ReviewFinding>,
): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity,
    category,
    message,
    primarySpan: span(file, line, col),
    fingerprint: createFingerprint(ruleId, line, col),
    ...extra,
  };
}

export interface CleanupMatcherSpec {
  cleanupPatterns: RegExp[];
  cleanupReturnIdentifiers?: string[];
  cleanupReturnCallPattern?: RegExp;
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findAssignedIdentifier(node: Node): string | undefined {
  let cur: Node | undefined = node.getParent();
  while (cur && !Node.isVariableDeclaration(cur)) {
    cur = cur.getParent();
  }
  if (!cur || !Node.isVariableDeclaration(cur)) return undefined;
  const nameNode = cur.getNameNode();
  return Node.isIdentifier(nameNode) ? nameNode.getText() : undefined;
}

export function getTopLevelCleanupExpressions(body: Node): Node[] {
  if (!Node.isBlock(body)) return [body];

  const cleanupExprs: Node[] = [];
  for (const retStmt of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    let inNested = false;
    let cur: Node | undefined = retStmt.getParent();
    while (cur && cur !== body) {
      if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur) || Node.isFunctionDeclaration(cur)) {
        inNested = true;
        break;
      }
      cur = cur.getParent();
    }
    if (inNested) continue;

    const expr = retStmt.getExpression();
    if (expr) cleanupExprs.push(expr);
  }

  return cleanupExprs;
}

export function resolveCleanupExpressionTexts(expr: Node): string[] {
  if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) return [expr.getText(), expr.getBody().getText()];
  if (Node.isCallExpression(expr)) return [expr.getText()];
  if (!Node.isIdentifier(expr)) return [expr.getText()];

  const texts = [expr.getText()];
  const declarations = expr.getSymbol()?.getDeclarations() ?? [];
  for (const decl of declarations) {
    if (Node.isFunctionDeclaration(decl) && decl.getBody()) {
      texts.push(decl.getText(), decl.getBody()!.getText());
      continue;
    }
    if (!Node.isVariableDeclaration(decl)) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    texts.push(init.getText());
    if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
      texts.push(init.getBody().getText());
    }
  }
  return texts;
}

export function cleanupExpressionMatches(expr: Node, spec: CleanupMatcherSpec): boolean {
  if (Node.isIdentifier(expr) && spec.cleanupReturnIdentifiers?.includes(expr.getText())) return true;
  if (Node.isCallExpression(expr) && spec.cleanupReturnCallPattern?.test(expr.getText())) return true;

  const texts = resolveCleanupExpressionTexts(expr);
  return texts.some((text) => spec.cleanupPatterns.some((pattern) => pattern.test(text)));
}
