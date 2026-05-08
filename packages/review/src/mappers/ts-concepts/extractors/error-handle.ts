import type { ConceptNode, ErrorHandlePayload } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { type SourceFile, SyntaxKind } from 'ts-morph';
import { getContainerId, span } from '../helpers/ast.js';

export function extractErrorHandle(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  for (const catchClause of sf.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const block = catchClause.getBlock();
    const stmts = block.getStatements();
    const errorVar = catchClause.getVariableDeclaration()?.getName();

    const disposition = classifyDisposition(stmts, errorVar, block);

    nodes.push({
      id: conceptId(filePath, 'error_handle', catchClause.getStart()),
      kind: 'error_handle',
      primarySpan: span(filePath, catchClause),
      evidence: catchClause.getText().substring(0, 150),
      confidence: disposition.confidence,
      language: 'ts',
      containerId: getContainerId(catchClause, filePath),
      payload: {
        kind: 'error_handle',
        disposition: disposition.type,
        errorVariable: errorVar,
      },
    });
  }

  // .catch() on promises
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (pa.getName() !== 'catch') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    // Check if the catch callback is empty or just logs
    const callbackText = args[0].getText();
    let disposition: ErrorHandlePayload['disposition'] = 'wrapped';
    let confidence = 0.7;

    if (callbackText.includes('() => {}') || callbackText.includes('() => undefined')) {
      disposition = 'ignored';
      confidence = 1.0;
    } else if (/console\.(log|error|warn)/.test(callbackText)) {
      disposition = 'logged';
      confidence = 0.9;
    }

    nodes.push({
      id: conceptId(filePath, 'error_handle', call.getStart()),
      kind: 'error_handle',
      primarySpan: span(filePath, call),
      evidence: call.getText().substring(0, 150),
      confidence,
      language: 'ts',
      containerId: getContainerId(call, filePath),
      payload: {
        kind: 'error_handle',
        disposition,
      },
    });
  }
}

function classifyDisposition(
  stmts: import('ts-morph').Statement[],
  errorVar?: string,
  block?: import('ts-morph').Block,
): { type: ErrorHandlePayload['disposition']; confidence: number } {
  // Empty catch — trust author intent comments. Real-world generated code
  // (AudioFacets, Agon) routinely uses short explanations like
  // `/* non-fatal */`, `/* already gone */`, `// process likely exited`.
  // If the author wrote a comment, they thought about it; the lint job is
  // to flag CARE-less code, not to override documented decisions.
  if (stmts.length === 0) {
    if (block && hasIntentComment(block.getText())) {
      return { type: 'wrapped', confidence: 0.4 };
    }
    return { type: 'ignored', confidence: 1.0 };
  }

  const bodyText = stmts.map((s) => s.getText()).join('\n');

  // Check for rethrow
  if (bodyText.includes('throw')) {
    // throw new XError(err) → wrapped (use word boundary to avoid 'e' matching 'HttpException')
    if (errorVar && new RegExp(`\\b${errorVar}\\b`).test(bodyText)) {
      return { type: 'wrapped', confidence: 0.95 };
    }
    return { type: 'rethrown', confidence: 0.9 };
  }

  // Check for return (error bubbling)
  const lastStmt = stmts[stmts.length - 1];
  if (lastStmt.getKind() === SyntaxKind.ReturnStatement) {
    return { type: 'returned', confidence: 0.85 };
  }

  // Check for logging only
  if (/console\.(log|error|warn)/.test(bodyText) || /logger\.\w+/.test(bodyText)) {
    if (stmts.length === 1) {
      return { type: 'logged', confidence: 0.9 };
    }
    return { type: 'logged', confidence: 0.7 };
  }

  return { type: 'wrapped', confidence: 0.5 };
}

/**
 * Does the text of an empty catch block carry ANY non-trivial comment?
 * A comment with at least one non-whitespace character beyond the marker
 * counts — we don't judge whether the reasoning is right, only that the
 * author documented their choice.
 */
function hasIntentComment(text: string): boolean {
  // Single-line `// content` with at least one non-whitespace char after the slashes.
  if (/\/\/[^\n]*\S/.test(text)) return true;
  // Block `/* content */` with at least one non-whitespace char inside.
  if (/\/\*[\s\S]*?\S[\s\S]*?\*\//.test(text)) return true;
  return false;
}
