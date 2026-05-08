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
    disposition = 'ignored';
  } else if (body.some((line) => /^raise\b/.test(line))) {
    disposition = 'rethrown';
  } else if (body.some((line) => /^return\b/.test(line))) {
    disposition = 'returned';
  } else if (body.some((line) => /\b(logging|logger|log|print)\b/.test(line))) {
    disposition = 'logged';
  }

  return { kind: 'error_handle', disposition };
}
