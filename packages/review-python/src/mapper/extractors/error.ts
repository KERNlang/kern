import type { ConceptNode, ErrorHandlePayload } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import type Parser from 'tree-sitter';
import { getContainerId, nodeSpan, nodeText, walkNodes } from '../helpers/ast.js';
import { PY_API_ERROR_STATUS_CODES } from '../signatures.js';

export function extractErrorRaise(
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

export function extractErrorHandle(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
  nodes: ConceptNode[],
): void {
  // except clauses
  walkNodes(root, 'except_clause', (node) => {
    const block = node.children.find((c) => c.type === 'block');
    const disposition = classifyPythonDisposition(node, block, source);
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
  exceptNode: Parser.SyntaxNode,
  block: Parser.SyntaxNode | undefined,
  source: string,
): { type: ErrorHandlePayload['disposition']; confidence: number } {
  if (!block) return { type: 'ignored', confidence: 1.0 };

  const children = block.namedChildren;

  // except: pass → ignored
  if (children.length === 1 && children[0].type === 'pass_statement') {
    if (isIntentionalNoopExcept(exceptNode, source)) return { type: 'wrapped', confidence: 0.55 };
    return { type: 'ignored', confidence: 1.0 };
  }

  // except: ... (ellipsis) → ignored
  if (children.length === 1 && children[0].type === 'expression_statement') {
    const text = source.substring(children[0].startIndex, children[0].endIndex).trim();
    if (text === '...') {
      if (isIntentionalNoopExcept(exceptNode, source)) return { type: 'wrapped', confidence: 0.55 };
      return { type: 'ignored', confidence: 1.0 };
    }
  }

  // Empty block
  if (children.length === 0) {
    if (isIntentionalNoopExcept(exceptNode, source)) return { type: 'wrapped', confidence: 0.55 };
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

function isIntentionalNoopExcept(exceptNode: Parser.SyntaxNode, source: string): boolean {
  const block = exceptNode.children.find((child) => child.type === 'block');
  const headerEnd = block?.startIndex ?? exceptNode.endIndex;
  const exceptTypes = parseExceptTypes(source.substring(exceptNode.startIndex, headerEnd));
  if (exceptTypes.length === 0) return false;

  const trySource = exceptNode.parent ? source.substring(exceptNode.parent.startIndex, exceptNode.startIndex) : '';
  const tryBody = trySource
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/^try\s*:/.test(line));
  const hasOnly = (allowed: readonly string[]) => exceptTypes.every((t) => allowed.includes(t));

  if (hasOnly(['ProcessLookupError']) && tryBody.length === 1 && /\bos\.kill\s*\(/.test(tryBody[0])) return true;
  if (hasOnly(['ChildProcessError']) && tryBody.length === 1 && /\bos\.waitpid\s*\(/.test(tryBody[0])) return true;
  if (hasOnly(['FileNotFoundError']) && tryBody.length === 1 && /\b(os\.)?(unlink|remove|rmdir)\s*\(/.test(tryBody[0])) {
    return true;
  }
  if (hasOnly(['OSError']) && tryBody.length === 1 && /\bos\.close\s*\(/.test(tryBody[0])) return true;
  if (hasOnly(['OSError']) && tryBody.length > 0 && tryBody.every((line) => /^(\w+\s*=\s*)?fcntl\.fcntl\s*\(/.test(line))) {
    return true;
  }
  if (hasOnly(['BrokenPipeError']) && tryBody.length === 1 && /\.(write|flush|close)\s*\(/.test(tryBody[0])) return true;
  if (
    hasOnly(['AttributeError', 'ImportError', 'ValueError']) &&
    tryBody.length === 1 &&
    /\b(importlib|faulthandler\.register|signal\.SIG[A-Z0-9_]+|getattr|hasattr|ctypes|fcntl)\b/.test(tryBody[0])
  ) {
    return true;
  }

  return false;
}

function parseExceptTypes(line: string): string[] {
  const match = line.trim().match(/^except\s*(?:\(([\s\S]*?)\)|([A-Za-z_][\w.]*))?/);
  if (!match) return [];
  const raw = match[1] ?? match[2] ?? '';
  return raw
    .split(',')
    .map((part) => part.trim().replace(/\s+as\s+\w+$/, '').split('.').pop() ?? '')
    .filter(Boolean);
}

function extractRaiseType(node: Parser.SyntaxNode): string | undefined {
  // raise ValueError("...") → "ValueError"
  const callNode = node.namedChildren.find((c) => c.type === 'call');
  if (callNode) {
    const func = callNode.childForFieldName('function');
    if (func) return func.text;
  }
  // raise ValueError → just identifier
  const ident = node.namedChildren.find((c) => c.type === 'identifier');
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

export function extractPythonHttpExceptionStatusCodes(text: string): readonly number[] | undefined {
  const codes = new Set<number>();
  const keywordRe = /HTTPException\s*\([^)]*status_code\s*=\s*(\d{3})/g;
  for (const match of text.matchAll(keywordRe)) {
    const code = Number(match[1]);
    if (PY_API_ERROR_STATUS_CODES.has(code)) codes.add(code);
  }
  const positionalRe = /HTTPException\s*\(\s*(\d{3})/g;
  for (const match of text.matchAll(positionalRe)) {
    const code = Number(match[1]);
    if (PY_API_ERROR_STATUS_CODES.has(code)) codes.add(code);
  }
  return codes.size > 0 ? Array.from(codes).sort((a, b) => a - b) : undefined;
}
