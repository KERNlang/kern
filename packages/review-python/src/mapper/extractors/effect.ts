import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import type Parser from 'tree-sitter';
import { getContainerId, isInAsyncDef, nodeSpan, nodeText, walkNodes } from '../helpers/ast.js';
import { DB_METHODS, DB_MODULES, NETWORK_METHODS, NETWORK_MODULES } from '../signatures.js';

export function extractEffects(root: Parser.SyntaxNode, source: string, filePath: string, nodes: ConceptNode[]): void {
  walkNodes(root, 'call', (node) => {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    const funcText = source.substring(funcNode.startIndex, funcNode.endIndex);

    // Network: requests.get(), httpx.post(), etc.
    if (funcNode.type === 'attribute') {
      const obj = funcNode.childForFieldName('object');
      const attr = funcNode.childForFieldName('attribute');
      if (obj && attr) {
        const objName = source.substring(obj.startIndex, obj.endIndex);
        const methodName = source.substring(attr.startIndex, attr.endIndex);

        if (NETWORK_MODULES.has(objName) && NETWORK_METHODS.has(methodName)) {
          nodes.push({
            id: conceptId(filePath, 'effect', node.startIndex),
            kind: 'effect',
            primarySpan: nodeSpan(filePath, node),
            evidence: nodeText(source, node, 120),
            confidence: 0.95,
            language: 'py',
            containerId: getContainerId(node, filePath),
            payload: { kind: 'effect', subtype: 'network', async: isInAsyncDef(node) },
          });
          return;
        }

        // DB: cursor.execute(), db.query(), etc.
        if (
          DB_METHODS.has(methodName) &&
          (DB_MODULES.has(objName) || /cursor|conn|db|session|collection/i.test(objName))
        ) {
          nodes.push({
            id: conceptId(filePath, 'effect', node.startIndex),
            kind: 'effect',
            primarySpan: nodeSpan(filePath, node),
            evidence: nodeText(source, node, 120),
            confidence: 0.85,
            language: 'py',
            containerId: getContainerId(node, filePath),
            payload: { kind: 'effect', subtype: 'db', async: isInAsyncDef(node) },
          });
          return;
        }
      }
    }

    // FS: open()
    if (funcText === 'open') {
      nodes.push({
        id: conceptId(filePath, 'effect', node.startIndex),
        kind: 'effect',
        primarySpan: nodeSpan(filePath, node),
        evidence: nodeText(source, node, 120),
        confidence: 0.9,
        language: 'py',
        containerId: getContainerId(node, filePath),
        payload: { kind: 'effect', subtype: 'fs', async: false },
      });
    }

    // fetch() in async context (aiohttp pattern)
    if (funcText === 'fetch' || funcText === 'aiohttp.request') {
      nodes.push({
        id: conceptId(filePath, 'effect', node.startIndex),
        kind: 'effect',
        primarySpan: nodeSpan(filePath, node),
        evidence: nodeText(source, node, 120),
        confidence: 0.8,
        language: 'py',
        containerId: getContainerId(node, filePath),
        payload: { kind: 'effect', subtype: 'network', async: true },
      });
    }
  });
}
