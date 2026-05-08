import type { ConceptEdge } from '@kernlang/core';
import type Parser from 'tree-sitter';
import { nodeSpan, nodeText, walkNodes } from '../helpers/ast.js';
import { STDLIB_MODULES } from '../signatures.js';

export function extractDependencyEdges(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
  edges: ConceptEdge[],
): void {
  const addDependency = (node: Parser.SyntaxNode, specifier: string): void => {
    let subtype: 'stdlib' | 'external' | 'internal' = 'external';
    if (specifier.startsWith('.')) {
      subtype = 'internal';
    } else {
      const rootModule = specifier.split('.')[0];
      if (STDLIB_MODULES.has(rootModule)) {
        subtype = 'stdlib';
      }
    }

    edges.push({
      id: `${filePath}#dep@${node.startIndex}`,
      kind: 'dependency',
      sourceId: filePath,
      targetId: specifier,
      primarySpan: nodeSpan(filePath, node),
      evidence: nodeText(source, node, 100),
      confidence: 1.0,
      language: 'py',
      payload: { kind: 'dependency', subtype, specifier },
    });
  };

  walkNodes(root, 'import_statement', (node) => {
    // import x, y as z
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name') {
        addDependency(node, child.text);
      } else if (child.type === 'aliased_import') {
        const name = child.childForFieldName('name');
        if (name) addDependency(node, name.text);
      }
    }
  });

  walkNodes(root, 'import_from_statement', (node) => {
    // from x import y
    const moduleNode = node.childForFieldName('module_name');
    const relativeMatch = node.text.match(/^from\s+(\.+)/);
    let specifier = moduleNode ? moduleNode.text : '';
    if (relativeMatch) {
      specifier = relativeMatch[1] + specifier;
    }
    if (specifier) {
      addDependency(node, specifier);
    }
  });
}
