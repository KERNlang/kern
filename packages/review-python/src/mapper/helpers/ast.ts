import type { ConceptSpan } from '@kernlang/core';
import { conceptSpan } from '@kernlang/core';
import type Parser from 'tree-sitter';

export function walkNodes(root: Parser.SyntaxNode, type: string, callback: (node: Parser.SyntaxNode) => void): void {
  const cursor = root.walk();
  let reachedRoot = false;
  while (true) {
    if (cursor.nodeType === type) {
      callback(cursor.currentNode);
    }
    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;
    while (true) {
      if (!cursor.gotoParent()) {
        reachedRoot = true;
        break;
      }
      if (cursor.gotoNextSibling()) break;
    }
    if (reachedRoot) break;
  }
}

export function nodeSpan(filePath: string, node: Parser.SyntaxNode): ConceptSpan {
  return conceptSpan(
    filePath,
    node.startPosition.row + 1,
    node.startPosition.column + 1,
    node.endPosition.row + 1,
    node.endPosition.column + 1,
  );
}

export function nodeText(source: string, node: Parser.SyntaxNode, maxLen: number): string {
  return source.substring(node.startIndex, Math.min(node.endIndex, node.startIndex + maxLen));
}

export function getContainerId(node: Parser.SyntaxNode, filePath: string): string | undefined {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'function_definition' || parent.type === 'class_definition') {
      const nameNode = parent.childForFieldName('name');
      const name = nameNode ? nameNode.text : 'anonymous';
      return `${filePath}#fn:${name}@${parent.startIndex}`;
    }
    parent = parent.parent;
  }
  return undefined;
}

export function getSelfContainerId(node: Parser.SyntaxNode, filePath: string): string | undefined {
  if (node.type !== 'function_definition' && node.type !== 'class_definition') return undefined;
  const nameNode = node.childForFieldName('name');
  const name = nameNode ? nameNode.text : 'anonymous';
  return `${filePath}#fn:${name}@${node.startIndex}`;
}

export function isInAsyncDef(node: Parser.SyntaxNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'function_definition') {
      return isAsyncFunction(parent);
    }
    parent = parent.parent;
  }
  return false;
}

export function isAsyncFunction(node: Parser.SyntaxNode): boolean {
  return node.children.some((c) => c.type === 'async');
}
