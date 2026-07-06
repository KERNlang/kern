import type { ConceptNode } from '@kernlang/core';
import { indentation, type LineInfo } from '../helpers/lines.js';
import { PYTHON_BUILTIN_EXCEPTIONS } from '../../python-builtin-exceptions.js';
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
    // A silent swallow reads as a genuine "ignored" error ONLY when the catch is
    // broad/bare (`except:`, `except Exception:`, `except BaseException:`) AND
    // undocumented. Two cases are expected patterns, not oversights:
    //   • a narrow, NON-builtin (domain/library) exception — `except IntegrityError:
    //     pass` (dedupe on a unique constraint), `except ProgressDataNotFoundException:
    //     pass` (optional summary section). Builtin exceptions stay flaggable
    //     because they are broad enough to hide an UNRELATED failure (e.g.
    //     `except OSError: pass` wrapping mixed I/O — see the "still fires" tests).
    //   • an explanatory comment in the block — the dev made a conscious decision
    //     ("# instrumentation must never break a chat turn"). Note the body scan
    //     above strips comment lines, so this is detected separately.
    // kern-guard on fitvt PR #16 flagged 4 correct swallows of these two shapes.
    const intentional =
      isIntentionalNoopExcept(lines, exceptIndex) ||
      isNarrowNonBuiltinExcept(lines, exceptIndex) ||
      hasExplanatoryComment(lines, exceptIndex);
    disposition = intentional ? 'wrapped' : 'ignored';
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

  if (
    hasOnly(['FileNotFoundError']) &&
    tryBody.length === 1 &&
    /\b(os\.)?(unlink|remove|rmdir)\s*\(/.test(tryBody[0])
  ) {
    return true;
  }
  if (hasOnly(['OSError']) && tryBody.length === 1 && /\bos\.close\s*\(/.test(tryBody[0])) return true;
  if (
    hasOnly(['OSError']) &&
    tryBody.length > 0 &&
    tryBody.every((line) => /^(\w+\s*=\s*)?fcntl\.fcntl\s*\(/.test(line))
  ) {
    return true;
  }
  if (hasOnly(['BrokenPipeError']) && tryBody.length === 1 && /\.(write|flush|close)\s*\(/.test(tryBody[0]))
    return true;

  if (
    hasOnly(['AttributeError', 'ImportError', 'ValueError']) &&
    tryBody.length === 1 &&
    /\b(importlib|faulthandler\.register|signal\.SIG[A-Z0-9_]+|getattr|hasattr|ctypes|fcntl)\b/.test(tryBody[0])
  ) {
    return true;
  }

  return false;
}

// True when EVERY caught type is a narrow, non-builtin exception (bare `except:`
// and any builtin/`Exception`/`BaseException` in the shared set disqualify it).
// A mixed `except (IntegrityError, Exception):` is therefore NOT narrow, so it
// stays flaggable. Reads the FULL except header (joined across lines) so a
// multi-line tuple header `except (\n  IntegrityError,\n):` is not truncated to
// `except (` and mis-parsed as bare.
function isNarrowNonBuiltinExcept(lines: LineInfo[], exceptIndex: number): boolean {
  const types = parseExceptTypes(exceptHeaderText(lines, exceptIndex));
  if (types.length === 0) return false; // bare `except:` is broad
  return types.every((t) => !PYTHON_BUILTIN_EXCEPTIONS.has(t));
}

// Join the except header across physical lines up to the header-terminating
// colon, tracking paren depth so a parenthesized multi-type tuple that spans
// lines is captured whole. Falls back to the single line if no colon is found.
function exceptHeaderText(lines: LineInfo[], exceptIndex: number): string {
  const parts: string[] = [];
  let depth = 0;
  for (let i = exceptIndex; i < lines.length; i++) {
    const text = lines[i].text;
    parts.push(text.trim());
    for (const ch of text) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ':' && depth <= 0) return parts.join(' ');
    }
  }
  return parts.join(' ');
}

// True when the except header line or any line in its block carries a `#`
// comment — an explicit decision to swallow. The block's executable body is only
// `pass`/`...`/empty in the branch that consults this, so any `#` is a comment
// (not code with an inline hash), making the scan safe without string-stripping.
function hasExplanatoryComment(lines: LineInfo[], exceptIndex: number): boolean {
  const exceptIndent = indentation(lines[exceptIndex].text);
  if (lines[exceptIndex].text.includes('#')) return true; // `except X:  # why`
  for (let i = exceptIndex + 1; i < lines.length; i++) {
    const text = lines[i].text;
    const trimmed = text.trim();
    if (!trimmed) continue;
    if (indentation(text) <= exceptIndent) break;
    if (text.includes('#')) return true; // standalone comment or `pass  # why`
  }
  return false;
}

function parseExceptTypes(line: string): string[] {
  const match = line.trim().match(/^except\s*(?:\(([\s\S]*?)\)|([A-Za-z_][\w.]*))?/);
  if (!match) return [];
  const raw = match[1] ?? match[2] ?? '';
  return raw
    .split(',')
    .map(
      (part) =>
        part
          .trim()
          .replace(/\s+as\s+\w+$/, '')
          .split('.')
          .pop() ?? '',
    )
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
