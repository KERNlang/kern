import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import type Parser from 'tree-sitter';
import { getContainerId, nodeSpan, nodeText, walkNodes } from '../helpers/ast.js';

export function extractStateMutation(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
  nodes: ConceptNode[],
): void {
  // Track global keyword usage
  const globalVarsInFile = new Set<string>();
  walkNodes(root, 'global_statement', (node) => {
    for (const child of node.namedChildren) {
      if (child.type === 'identifier') globalVarsInFile.add(child.text);
    }
  });

  walkNodes(root, 'assignment', (node) => {
    const left = node.childForFieldName('left');
    if (!left) return;

    // self.x = ... → scope 'module' (as requested)
    if (left.type === 'attribute') {
      const obj = left.childForFieldName('object');
      if (obj && obj.text === 'self') {
        nodes.push({
          id: conceptId(filePath, 'state_mutation', node.startIndex),
          kind: 'state_mutation',
          primarySpan: nodeSpan(filePath, node),
          evidence: nodeText(source, node, 100),
          confidence: 0.9,
          language: 'py',
          containerId: getContainerId(node, filePath),
          payload: { kind: 'state_mutation', target: left.text, scope: 'module' },
        });
        return;
      }
    }

    // Global or Module level assignment
    if (left.type === 'identifier') {
      const name = left.text;
      const containerId = getContainerId(node, filePath);

      if (globalVarsInFile.has(name)) {
        nodes.push({
          id: conceptId(filePath, 'state_mutation', node.startIndex),
          kind: 'state_mutation',
          primarySpan: nodeSpan(filePath, node),
          evidence: nodeText(source, node, 100),
          confidence: 1.0,
          language: 'py',
          containerId,
          payload: { kind: 'state_mutation', target: name, scope: 'global' },
        });
      } else if (!containerId) {
        // Module level (top level)
        nodes.push({
          id: conceptId(filePath, 'state_mutation', node.startIndex),
          kind: 'state_mutation',
          primarySpan: nodeSpan(filePath, node),
          evidence: nodeText(source, node, 100),
          confidence: 0.8,
          language: 'py',
          payload: { kind: 'state_mutation', target: name, scope: 'module' },
        });
      }
    }
  });
}
