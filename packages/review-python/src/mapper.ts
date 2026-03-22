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
  ErrorHandlePayload, EntrypointPayload, GuardPayload, StateMutationPayload, DependencyPayload,
} from '@kernlang/core';
import { conceptId, conceptSpan } from '@kernlang/core';

const EXTRACTOR_VERSION = '1.0.0';

// ── Network call patterns ────────────────────────────────────────────────

const NETWORK_MODULES = new Set(['requests', 'httpx', 'aiohttp', 'urllib']);
const NETWORK_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request', 'fetch']);

const DB_MODULES = new Set(['psycopg2', 'asyncpg', 'pymongo', 'sqlalchemy', 'django']);
const DB_METHODS = new Set(['execute', 'executemany', 'fetchone', 'fetchall', 'fetchmany', 'query', 'find', 'find_one', 'insert_one', 'insert_many', 'update_one', 'delete_one']);

const FS_FUNCTIONS = new Set(['open', 'read', 'write', 'readlines', 'writelines']);

const STDLIB_MODULES = new Set([
  'os', 'sys', 'json', 're', 'math', 'datetime', 'time', 'logging', 'argparse',
  'collections', 'itertools', 'functools', 'pathlib', 'shutil', 'subprocess',
  'threading', 'multiprocessing', 'abc', 'typing', 'io', 'pickle', 'random',
  'hashlib', 'hmac', 'base64', 'csv', 'sqlite3', 'zlib', 'gzip', 'tarfile', 'zipfile',
  'enum', 'struct', 'tempfile', 'unittest', 'urllib', 'uuid', 'xml',
]);

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

  extractEntrypoints(tree.rootNode, source, filePath, nodes);
  extractGuards(tree.rootNode, source, filePath, nodes);
  extractStateMutation(tree.rootNode, source, filePath, nodes);
  extractDependencyEdges(tree.rootNode, source, filePath, edges);

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

// ── entrypoint ──────────────────────────────────────────────────────────

function extractEntrypoints(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
  nodes: ConceptNode[],
): void {
  // 1. Route decorators: @app.route, @app.get, @router.post, etc.
  // tree-sitter Python wraps decorated functions in 'decorated_definition'
  walkNodes(root, 'decorated_definition', (node) => {
    const fnDef = node.children.find(c => c.type === 'function_definition');
    if (!fnDef) return;

    for (const child of node.children) {
      if (child.type !== 'decorator') continue;
      const decText = source.substring(child.startIndex, child.endIndex);

      const routeMatch = decText.match(/@(app|router|bp)\.(route|get|post|put|delete|patch)\s*\(/);
      if (routeMatch) {
        const method = routeMatch[2].toUpperCase();
        const nameNode = fnDef.childForFieldName('name');
        // Try to extract path from decorator args
        const pathMatch = decText.match(/['"]([^'"]+)['"]/);

        nodes.push({
          id: conceptId(filePath, 'entrypoint', child.startIndex),
          kind: 'entrypoint',
          primarySpan: nodeSpan(filePath, child),
          evidence: nodeText(source, child, 100),
          confidence: 1.0,
          language: 'py',
          containerId: getContainerId(node, filePath),
          payload: {
            kind: 'entrypoint',
            subtype: 'route',
            name: nameNode ? nameNode.text : (pathMatch?.[1] || 'anonymous'),
            httpMethod: method === 'ROUTE' ? undefined : method,
          },
        });
      }
    }
  });

  // 2. if __name__ == '__main__':
  walkNodes(root, 'if_statement', (node) => {
    const condition = node.childForFieldName('condition');
    if (condition && condition.text.includes('__name__') && condition.text.includes('__main__')) {
      nodes.push({
        id: conceptId(filePath, 'entrypoint', node.startIndex),
        kind: 'entrypoint',
        primarySpan: nodeSpan(filePath, node),
        evidence: nodeText(source, node, 100),
        confidence: 1.0,
        language: 'py',
        payload: {
          kind: 'entrypoint',
          subtype: 'main',
          name: 'main',
        },
      });
    }
  });
}

// ── guard ───────────────────────────────────────────────────────────────

function extractGuards(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
  nodes: ConceptNode[],
): void {
  // 1. Auth decorators (tree-sitter: decorated_definition → decorator + function_definition)
  walkNodes(root, 'decorated_definition', (node) => {
    for (const child of node.children) {
      if (child.type !== 'decorator') continue;
      const decText = source.substring(child.startIndex, child.endIndex);
      if (/@(login_required|requires_auth|permission_required|auth_required|authenticated)/.test(decText)) {
        nodes.push({
          id: conceptId(filePath, 'guard', child.startIndex),
          kind: 'guard',
          primarySpan: nodeSpan(filePath, child),
          evidence: nodeText(source, child, 100),
          confidence: 1.0,
          language: 'py',
          containerId: getContainerId(node, filePath),
          payload: {
            kind: 'guard',
            subtype: 'auth',
            name: decText.replace('@', '').split('(')[0].trim(),
          },
        });
      }
    }
  });

  // 2. Pydantic validation: BaseModel.model_validate()
  walkNodes(root, 'call', (node) => {
    const func = node.childForFieldName('function');
    if (func && func.text.includes('model_validate')) {
      nodes.push({
        id: conceptId(filePath, 'guard', node.startIndex),
        kind: 'guard',
        primarySpan: nodeSpan(filePath, node),
        evidence: nodeText(source, node, 100),
        confidence: 0.9,
        language: 'py',
        containerId: getContainerId(node, filePath),
        payload: { kind: 'guard', subtype: 'validation', name: 'pydantic' },
      });
    }
  });

  // 3. Early return/raise after auth check: if not request.user: raise/return
  walkNodes(root, 'if_statement', (node) => {
    const cond = node.childForFieldName('condition');
    if (cond && /\b(user|auth|request\.user)\b/.test(cond.text)) {
      const block = node.namedChildren.find(c => c.type === 'block');
      if (block) {
        const firstStmt = block.namedChildren[0];
        if (firstStmt && (firstStmt.type === 'return_statement' || firstStmt.type === 'raise_statement')) {
          nodes.push({
            id: conceptId(filePath, 'guard', node.startIndex),
            kind: 'guard',
            primarySpan: nodeSpan(filePath, node),
            evidence: nodeText(source, node, 100),
            confidence: 0.8,
            language: 'py',
            containerId: getContainerId(node, filePath),
            payload: { kind: 'guard', subtype: 'auth' },
          });
        }
      }
    }
  });
}

// ── state_mutation ───────────────────────────────────────────────────────

function extractStateMutation(
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

// ── dependency ──────────────────────────────────────────────────────────

function extractDependencyEdges(
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
