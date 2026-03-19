/**
 * Python Concept Mapper — tree-sitter based.
 *
 * Maps Python syntax → universal KERN concepts.
 * Phase 1: error_raise, error_handle, effect
 */

import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import type {
  ConceptMap, ConceptNode, ConceptEdge, ConceptSpan,
  ErrorHandlePayload,
} from '@kernlang/core';
import { conceptId, conceptSpan } from '@kernlang/core';

const EXTRACTOR_VERSION = '1.0.0';

// ── Network call patterns ────────────────────────────────────────────────

const NETWORK_MODULES = new Set(['requests', 'httpx', 'aiohttp', 'urllib']);
const NETWORK_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request', 'fetch']);

const DB_MODULES = new Set(['psycopg2', 'asyncpg', 'pymongo', 'sqlalchemy', 'django']);
const DB_METHODS = new Set(['execute', 'executemany', 'fetchone', 'fetchall', 'fetchmany', 'query', 'find', 'find_one', 'insert_one', 'insert_many', 'update_one', 'delete_one']);

const FS_FUNCTIONS = new Set(['open', 'read', 'write', 'readlines', 'writelines']);

// ── Parser setup ─────────────────────────────────────────────────────────

let parser: Parser | null = null;

function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Python as unknown as Parser.Language);
  }
  return parser;
}

// ── Main Extractor ───────────────────────────────────────────────────────

export function extractPythonConcepts(source: string, filePath: string): ConceptMap {
  const tree = getParser().parse(source);
  const nodes: ConceptNode[] = [];
  const edges: ConceptEdge[] = [];

  extractErrorRaise(tree.rootNode, source, filePath, nodes);
  extractErrorHandle(tree.rootNode, source, filePath, nodes);
  extractEffects(tree.rootNode, source, filePath, nodes);

  return {
    filePath,
    language: 'py',
    nodes,
    edges,
    extractorVersion: EXTRACTOR_VERSION,
  };
}

// ── error_raise ──────────────────────────────────────────────────────────

function extractErrorRaise(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
  nodes: ConceptNode[],
): void {
  // raise statements
  walkNodes(root, 'raise_statement', (node) => {
    const errorType = extractRaiseType(node);
    nodes.push({
      id: conceptId(filePath, 'error_raise', node.startIndex),
      kind: 'error_raise',
      primarySpan: nodeSpan(filePath, node),
      evidence: nodeText(source, node, 100),
      confidence: 1.0,
      language: 'py',
      containerId: getContainerId(node, filePath),
      payload: {
        kind: 'error_raise',
        subtype: 'throw', // Python raise ≡ throw
        errorType,
      },
    });
  });
}

// ── error_handle ─────────────────────────────────────────────────────────

function extractErrorHandle(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
  nodes: ConceptNode[],
): void {
  // except clauses
  walkNodes(root, 'except_clause', (node) => {
    const block = node.children.find(c => c.type === 'block');
    const disposition = classifyPythonDisposition(block, source);
    const errorVar = extractExceptVar(node);

    nodes.push({
      id: conceptId(filePath, 'error_handle', node.startIndex),
      kind: 'error_handle',
      primarySpan: nodeSpan(filePath, node),
      evidence: nodeText(source, node, 150),
      confidence: disposition.confidence,
      language: 'py',
      containerId: getContainerId(node, filePath),
      payload: {
        kind: 'error_handle',
        disposition: disposition.type,
        errorVariable: errorVar,
      },
    });
  });
}

function classifyPythonDisposition(
  block: Parser.SyntaxNode | undefined,
  source: string,
): { type: ErrorHandlePayload['disposition']; confidence: number } {
  if (!block) return { type: 'ignored', confidence: 1.0 };

  const children = block.namedChildren;

  // except: pass → ignored
  if (children.length === 1 && children[0].type === 'pass_statement') {
    return { type: 'ignored', confidence: 1.0 };
  }

  // except: ... (ellipsis) → ignored
  if (children.length === 1 && children[0].type === 'expression_statement') {
    const text = source.substring(children[0].startIndex, children[0].endIndex).trim();
    if (text === '...') return { type: 'ignored', confidence: 1.0 };
  }

  // Empty block
  if (children.length === 0) {
    return { type: 'ignored', confidence: 1.0 };
  }

  const bodyText = source.substring(block.startIndex, block.endIndex);

  // raise → rethrown or wrapped
  if (bodyText.includes('raise')) {
    // bare `raise` → rethrown
    if (/\braise\s*$|\braise\s*\n/m.test(bodyText)) {
      return { type: 'rethrown', confidence: 0.95 };
    }
    return { type: 'wrapped', confidence: 0.9 };
  }

  // return → returned
  if (bodyText.includes('return')) {
    return { type: 'returned', confidence: 0.85 };
  }

  // logging
  if (/\b(logging|logger|log|print)\b/.test(bodyText)) {
    if (children.length === 1) return { type: 'logged', confidence: 0.9 };
    return { type: 'logged', confidence: 0.7 };
  }

  return { type: 'wrapped', confidence: 0.5 };
}

// ── effect ───────────────────────────────────────────────────────────────

function extractEffects(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
  nodes: ConceptNode[],
): void {
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
        if (DB_METHODS.has(methodName) && (DB_MODULES.has(objName) || /cursor|conn|db|session|collection/i.test(objName))) {
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

// ── Tree-sitter Helpers ──────────────────────────────────────────────────

function walkNodes(
  root: Parser.SyntaxNode,
  type: string,
  callback: (node: Parser.SyntaxNode) => void,
): void {
  const cursor = root.walk();
  let reachedRoot = false;
  while (true) {
    if (cursor.nodeType === type) {
      callback(cursor.currentNode);
    }
    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;
    while (true) {
      if (!cursor.gotoParent()) { reachedRoot = true; break; }
      if (cursor.gotoNextSibling()) break;
    }
    if (reachedRoot) break;
  }
}

function nodeSpan(filePath: string, node: Parser.SyntaxNode): ConceptSpan {
  return conceptSpan(
    filePath,
    node.startPosition.row + 1,
    node.startPosition.column + 1,
    node.endPosition.row + 1,
    node.endPosition.column + 1,
  );
}

function nodeText(source: string, node: Parser.SyntaxNode, maxLen: number): string {
  return source.substring(node.startIndex, Math.min(node.endIndex, node.startIndex + maxLen));
}

function getContainerId(node: Parser.SyntaxNode, filePath: string): string | undefined {
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

function extractRaiseType(node: Parser.SyntaxNode): string | undefined {
  // raise ValueError("...") → "ValueError"
  const callNode = node.namedChildren.find(c => c.type === 'call');
  if (callNode) {
    const func = callNode.childForFieldName('function');
    if (func) return func.text;
  }
  // raise ValueError → just identifier
  const ident = node.namedChildren.find(c => c.type === 'identifier');
  if (ident) return ident.text;
  return undefined;
}

function extractExceptVar(node: Parser.SyntaxNode): string | undefined {
  // except Exception as e → "e"
  for (const child of node.children) {
    if (child.type === 'as_pattern') {
      const alias = child.childForFieldName('alias');
      if (alias) return alias.text;
    }
    // Also try direct identifier after 'as'
    if (child.type === 'identifier' && child.previousSibling?.text === 'as') {
      return child.text;
    }
  }
  return undefined;
}

function isInAsyncDef(node: Parser.SyntaxNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'function_definition') {
      // Check for 'async' keyword before 'def'
      return parent.children.some(c => c.type === 'async');
    }
    parent = parent.parent;
  }
  return false;
}
