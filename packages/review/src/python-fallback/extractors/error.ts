import type { ConceptNode } from '@kernlang/core';
import { indentation, type LineInfo } from '../helpers/lines.js';
import { API_ERROR_STATUS_CODES } from '../signatures.js';

export function errorStatusCodesFromBody(body: string): readonly number[] | undefined {
  const codes = new Set<number>();
  for (const match of body.matchAll(/HTTPException\s*\([^)]*status_code\s*=\s*(\d{3})/g)) {
    const code = Number(match[1]);
    if (API_ERROR_STATUS_CODES.has(code)) codes.add(code);
  }
  for (const match of body.matchAll(/HTTPException\s*\(\s*(\d{3})/g)) {
    const code = Number(match[1]);
    if (API_ERROR_STATUS_CODES.has(code)) codes.add(code);
  }
  return codes.size > 0 ? Array.from(codes).sort((a, b) => a - b) : undefined;
}

export function classifyExceptDisposition(lines: LineInfo[], exceptIndex: number): ConceptNode['payload'] {
  const exceptIndent = indentation(lines[exceptIndex].text);
  const body: string[] = [];
  for (let i = exceptIndex + 1; i < lines.length; i++) {
    const text = lines[i].text;
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (indentation(text) <= exceptIndent) break;
    body.push(trimmed);
  }

  let disposition: 'ignored' | 'logged' | 'wrapped' | 'returned' | 'rethrown' | 'retried' = 'wrapped';
  if (body.length === 0 || (body.length === 1 && (body[0] === 'pass' || body[0] === '...'))) {
    disposition = isIntentionalNoopExcept(lines, exceptIndex) ? 'wrapped' : 'ignored';
  } else if (body.some((line) => /^raise\b/.test(line))) {
    disposition = 'rethrown';
  } else if (body.some((line) => /^return\b/.test(line))) {
    disposition = 'returned';
  } else if (body.some((line) => /\b(logging|logger|log|print)\b/.test(line))) {
    disposition = 'logged';
  }

  return { kind: 'error_handle', disposition };
}

function isIntentionalNoopExcept(lines: LineInfo[], exceptIndex: number): boolean {
  const exceptTypes = parseExceptTypes(lines[exceptIndex].text);
  if (exceptTypes.length === 0) return false;

  const tryBody = collectPrecedingTryBody(lines, exceptIndex);
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

function collectPrecedingTryBody(lines: LineInfo[], exceptIndex: number): string[] {
  const exceptIndent = indentation(lines[exceptIndex].text);
  let tryIndex = -1;
  for (let i = exceptIndex - 1; i >= 0; i--) {
    const text = lines[i].text;
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (indentation(text) === exceptIndent && /^try\s*:/.test(trimmed)) {
      tryIndex = i;
      break;
    }
    if (indentation(text) < exceptIndent) break;
  }
  if (tryIndex < 0) return [];

  const body: string[] = [];
  for (let i = tryIndex + 1; i < exceptIndex; i++) {
    const text = lines[i].text;
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (indentation(text) <= exceptIndent) break;
    body.push(trimmed);
  }
  return body;
}
