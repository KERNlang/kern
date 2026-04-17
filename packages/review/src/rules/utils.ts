/**
 * Shared helpers for review rules — eliminates duplication of span() and finding()
 * across base.ts, react.ts, nextjs.ts, express.ts, security.ts, vue.ts, dead-logic.ts.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

/**
 * True when the file's runtime boundary is clearly non-client (server
 * component, API route, Next.js middleware). React hook rules should
 * short-circuit on these files — hooks cannot run there, so any match is
 * either unused code or a false positive.
 *
 * `shared` and `unknown` intentionally return false: shared utilities are
 * often imported from both client and server; unknown happens when reviewing
 * a single file without graph context.
 */
export function isNonClientBoundary(ctx: RuleContext): boolean {
  const b = ctx.fileContext?.boundary;
  return b === 'server' || b === 'api' || b === 'middleware';
}

/**
 * True when the source file looks like a React file — has JSX, a `react`
 * import, or calls a recognizable React hook. Used to override an aggressive
 * boundary classifier: `src/routes/Home.tsx` gets `boundary=api` from the
 * path-based classifier (because of `/routes/`), but its JSX content tells us
 * it really is a client React file where hook rules should still run.
 */
export function hasReactContent(ctx: RuleContext): boolean {
  const sf = ctx.sourceFile;
  if (sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).length > 0) return true;
  if (sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0) return true;
  if (sf.getImportDeclarations().some((i) => i.getModuleSpecifierValue() === 'react')) return true;
  const fullText = sf.getFullText();
  return /\buse(?:State|Effect|Ref|Callback|Memo|Reducer|Context|LayoutEffect)\s*[<(]/.test(fullText);
}

/**
 * Convenience: true when hook-specific rules should skip this file. Combines
 * the boundary gate with a React-content override so misclassified React
 * routes (`src/routes/Home.tsx`) still get checked.
 */
export function shouldSkipHookRules(ctx: RuleContext): boolean {
  if (!isNonClientBoundary(ctx)) return false;
  // Non-client boundary — but if it has React content, the classifier is wrong.
  return !hasReactContent(ctx);
}

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
