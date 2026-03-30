/** @internal Tokenizer for KERN source lines. */
import type { ParseState } from './parser-diagnostics.js';
import { emitDiagnostic } from './parser-diagnostics.js';

// ── Token types ──────────────────────────────────────────────────────────

export type TokenKind =
  | 'identifier'    // [A-Za-z_][A-Za-z0-9_-]*
  | 'number'        // \d+
  | 'equals'        // =
  | 'quoted'        // "..."
  | 'expr'          // {{ ... }}
  | 'style'         // { ... }
  | 'themeRef'      // $name
  | 'slash'         // /path/segments
  | 'comma'         // ,
  | 'whitespace'    // spaces/tabs
  | 'unknown';      // anything else

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

// ── Tokenizer ────────────────────────────────────────────────────────────

function isIdentStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9') || ch === '-';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** @internal Character-by-character tokenizer for a single KERN line (after indent stripped). */
export function tokenizeLineInternal(line: string, state?: ParseState): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    // Whitespace
    if (ch === ' ' || ch === '\t') {
      const start = i;
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
      tokens.push({ kind: 'whitespace', value: line.slice(start, i), pos: start });
      continue;
    }

    // Expression block {{ ... }}
    if (ch === '{' && i + 1 < line.length && line[i + 1] === '{') {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < line.length - 1 && depth > 0) {
        if (line[i] === '{' && line[i + 1] === '{') { depth++; i += 2; }
        else if (line[i] === '}' && line[i + 1] === '}') { depth--; if (depth === 0) break; i += 2; }
        else i++;
      }
      if (depth > 0) {
        if (state) {
          emitDiagnostic(state, 'UNCLOSED_EXPR', 'error', `Unclosed expression block '{{' at column ${start + 1}`, 0, start + 1, { endCol: start + 3 });
        }
      }
      const inner = line.slice(start + 2, i).trim();
      if (i < line.length - 1) i += 2; else i = line.length;
      tokens.push({ kind: 'expr', value: inner, pos: start });
      continue;
    }

    // Style block { ... } — find matching } respecting quotes
    if (ch === '{') {
      const start = i;
      let inQuote = false;
      let j = i + 1;
      let closed = false;
      while (j < line.length) {
        if (line[j] === '\\' && j + 1 < line.length) { j += 2; continue; }
        if (line[j] === '"') inQuote = !inQuote;
        if (!inQuote && line[j] === '}') { j++; closed = true; break; }
        j++;
      }
      if (!closed) {
        if (state) {
          emitDiagnostic(state, 'UNCLOSED_STYLE', 'error', `Unclosed style block '{' at column ${start + 1}`, 0, start + 1, { endCol: start + 2 });
        }
      }
      tokens.push({ kind: 'style', value: line.slice(start + 1, closed ? j - 1 : j), pos: start });
      i = j;
      continue;
    }

    // Quoted string "..." with \" escape support
    if (ch === '"') {
      const start = i;
      i++;
      let inner = '';
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) {
          const next = line[i + 1];
          if (next === '"') { inner += '"'; i += 2; }
          else if (next === '\\') { inner += '\\'; i += 2; }
          else { inner += line[i]; i++; }
        } else {
          inner += line[i];
          i++;
        }
      }
      if (i >= line.length) {
        if (state) {
          emitDiagnostic(state, 'UNCLOSED_STRING', 'error', `Unclosed quoted string at column ${start + 1}`, 0, start + 1, { endCol: start + 2 });
        }
      } else {
        i++; // skip closing quote
      }
      tokens.push({ kind: 'quoted', value: inner, pos: start });
      continue;
    }

    // Theme ref $name
    if (ch === '$' && i + 1 < line.length && isIdentStart(line[i + 1])) {
      const start = i;
      i++;
      while (i < line.length && isIdentChar(line[i])) i++;
      tokens.push({ kind: 'themeRef', value: line.slice(start + 1, i), pos: start });
      continue;
    }

    // Equals
    if (ch === '=') {
      tokens.push({ kind: 'equals', value: '=', pos: i });
      i++;
      continue;
    }

    // Comma
    if (ch === ',') {
      tokens.push({ kind: 'comma', value: ',', pos: i });
      i++;
      continue;
    }

    // Slash-prefixed path: /something
    if (ch === '/') {
      const start = i;
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t' && line[i] !== '{' && line[i] !== '$') i++;
      tokens.push({ kind: 'slash', value: line.slice(start, i), pos: start });
      continue;
    }

    // Number (pure digits)
    if (isDigit(ch)) {
      const start = i;
      while (i < line.length && isDigit(line[i])) i++;
      tokens.push({ kind: 'number', value: line.slice(start, i), pos: start });
      continue;
    }

    // Identifier: [A-Za-z_][A-Za-z0-9_-]*
    // Handles evolved: prefix (evolved:keyword → strips prefix, returns keyword)
    if (isIdentStart(ch)) {
      const start = i;
      while (i < line.length && isIdentChar(line[i])) i++;
      if (line[i] === ':' && line.slice(start, i) === 'evolved' && i + 1 < line.length && isIdentStart(line[i + 1])) {
        i++;
        const nameStart = i;
        while (i < line.length && isIdentChar(line[i])) i++;
        tokens.push({ kind: 'identifier', value: line.slice(nameStart, i), pos: start });
      } else {
        tokens.push({ kind: 'identifier', value: line.slice(start, i), pos: start });
      }
      continue;
    }

    // Unknown character
    tokens.push({ kind: 'unknown', value: ch, pos: i });
    i++;
  }

  return tokens;
}

export function tokenizeLine(line: string): Token[] {
  return tokenizeLineInternal(line);
}
