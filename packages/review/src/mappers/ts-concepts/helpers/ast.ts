import type { ConceptSpan } from '@kernlang/core';
import { conceptSpan } from '@kernlang/core';
import { SyntaxKind } from 'ts-morph';
import { SKIP_CALLBACKS } from '../signatures.js';

export function span(filePath: string, node: import('ts-morph').Node): ConceptSpan {
  return conceptSpan(
    filePath,
    node.getStartLineNumber(),
    node.getStart() - node.getSourceFile().getFullText().lastIndexOf('\n', node.getStart()),
    node.getEndLineNumber(),
    1,
  );
}

export function getContainerId(node: import('ts-morph').Node, filePath: string): string | undefined {
  let parent = node.getParent();
  while (parent) {
    const kind = parent.getKind();
    if (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.MethodDeclaration) {
      const name = (parent as any).getName?.() || 'anonymous';
      return `${filePath}#fn:${name}@${parent.getStart()}`;
    }
    if (kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.FunctionExpression) {
      // Skip if this function is an argument to an incidental HOF (forEach, map, etc.)
      const grandparent = parent.getParent();
      if (grandparent?.getKind() === SyntaxKind.CallExpression) {
        const callee = (grandparent as import('ts-morph').CallExpression).getExpression();
        if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
          const methodName = (callee as import('ts-morph').PropertyAccessExpression).getName();
          if (SKIP_CALLBACKS.has(methodName)) {
            parent = grandparent.getParent();
            continue;
          }
        }
      }
      // Not a skippable callback — this IS the container
      const name = (parent as any).getName?.() || 'anonymous';
      return `${filePath}#fn:${name}@${parent.getStart()}`;
    }
    parent = parent.getParent();
  }
  return undefined;
}

export function extractThrowType(throwStmt: import('ts-morph').ThrowStatement): string | undefined {
  const expr = throwStmt.getExpression();
  if (!expr) return undefined;
  if (expr.getKind() === SyntaxKind.NewExpression) {
    return (expr as import('ts-morph').NewExpression).getExpression().getText();
  }
  return undefined;
}

export function isInAsyncContext(node: import('ts-morph').Node): boolean {
  let parent = node.getParent();
  while (parent) {
    if (parent.getKind() === SyntaxKind.FunctionDeclaration) {
      return (parent as import('ts-morph').FunctionDeclaration).isAsync();
    }
    if (parent.getKind() === SyntaxKind.ArrowFunction) {
      return (parent as import('ts-morph').ArrowFunction).isAsync();
    }
    if (parent.getKind() === SyntaxKind.MethodDeclaration) {
      return (parent as import('ts-morph').MethodDeclaration).isAsync();
    }
    parent = parent.getParent();
  }
  return false;
}

export function hasAwaitInBody(node: import('ts-morph').Node): boolean {
  // Check for AwaitExpression or ForOfStatement with await
  for (const desc of node.getDescendants()) {
    const kind = desc.getKind();
    if (kind === SyntaxKind.AwaitExpression) {
      // Verify this await is not inside a nested function
      let parent = desc.getParent();
      let isNested = false;
      while (parent && parent !== node) {
        const pk = parent.getKind();
        if (
          pk === SyntaxKind.FunctionDeclaration ||
          pk === SyntaxKind.FunctionExpression ||
          pk === SyntaxKind.ArrowFunction ||
          pk === SyntaxKind.MethodDeclaration
        ) {
          isNested = true;
          break;
        }
        parent = parent.getParent();
      }
      if (!isNested) return true;
    }
    if (kind === SyntaxKind.ForOfStatement) {
      // Check for `for await` by looking at the text
      if (/\bfor\s+await\b/.test(desc.getText().substring(0, 20))) {
        let parent = desc.getParent();
        let isNested = false;
        while (parent && parent !== node) {
          const pk = parent.getKind();
          if (
            pk === SyntaxKind.FunctionDeclaration ||
            pk === SyntaxKind.FunctionExpression ||
            pk === SyntaxKind.ArrowFunction ||
            pk === SyntaxKind.MethodDeclaration
          ) {
            isNested = true;
            break;
          }
          parent = parent.getParent();
        }
        if (!isNested) return true;
      }
    }
  }
  return false;
}

export function nodeContains(container: import('ts-morph').Node, target: import('ts-morph').Node): boolean {
  return target.getStart() >= container.getStart() && target.getEnd() <= container.getEnd();
}

export function nearestBlock(node: import('ts-morph').Node): import('ts-morph').Block | undefined {
  let parent = node.getParent();
  while (parent) {
    if (parent.getKind() === SyntaxKind.Block) return parent as import('ts-morph').Block;
    parent = parent.getParent();
  }
  return undefined;
}

export function nearestFunctionLike(node: import('ts-morph').Node): import('ts-morph').Node | undefined {
  let parent = node.getParent();
  while (parent) {
    const kind = parent.getKind();
    if (
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.MethodDeclaration ||
      kind === SyntaxKind.ArrowFunction ||
      kind === SyntaxKind.FunctionExpression
    ) {
      return parent;
    }
    parent = parent.getParent();
  }
  return undefined;
}

export function enclosingVariableDeclaration(
  node: import('ts-morph').Node,
): import('ts-morph').VariableDeclaration | undefined {
  let cursor: import('ts-morph').Node = node;
  for (let depth = 0; depth < 6; depth++) {
    const parent = cursor.getParent();
    if (!parent) return undefined;
    if (parent.getKind() === SyntaxKind.VariableDeclaration) return parent as import('ts-morph').VariableDeclaration;
    cursor = parent;
  }
  return undefined;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function numericLiteralValue(node: import('ts-morph').Node | undefined): number | undefined {
  if (!node || node.getKind() !== SyntaxKind.NumericLiteral) return undefined;
  const value = Number(node.getText());
  return Number.isFinite(value) ? value : undefined;
}

export function isExternalSourcePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('/node_modules/') || normalized.includes('/.pnpm/');
}

export function isSameConceptSourceFile(actualFilePath: string, conceptFilePath: string): boolean {
  const actual = actualFilePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const expected = conceptFilePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return actual === expected || actual.endsWith(`/${expected}`) || expected.endsWith(`/${actual}`);
}
