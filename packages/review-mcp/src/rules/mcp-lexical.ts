/**
 * Lexical analysis utilities for MCP security rules.
 *
 * - isCommentLine: detect comment lines (JS/TS/Python)
 * - createLexicalMask: blank string literals and comments, preserving positions
 * - findLines: find code lines matching a pattern (ignoring strings/comments)
 * - getSurroundingBlock: extract a function body around a given line
 */

/** Check if a line is a comment (JS/TS single-line or Python) */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/**
 * Create a lexical mask: replace all chars inside string literals and comments
 * with spaces, preserving line breaks and character positions.
 * Patterns matched against masked lines won't hit strings or comments.
 */
export function createLexicalMask(source: string): string {
  const chars = [...source];
  let inSingle = false,
    inDouble = false,
    inLineComment = false,
    inBlockComment = false;
  // Template literal state: stack tracks ${} nesting depth inside backtick strings
  // When templateDepth > 0, we're inside `...${CODE_HERE}...` — code is visible
  const templateStack: number[] = []; // stack of brace depths inside template expressions
  let inTemplate = false; // inside backtick string (not in ${} expression)

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];

    if (ch === '\n') {
      inLineComment = false;
      continue;
    }

    if (inLineComment || inBlockComment) {
      if (inBlockComment && ch === '*' && next === '/') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i++;
        inBlockComment = false;
      } else {
        chars[i] = ' ';
      }
      continue;
    }

    // Inside template literal string portion (not in ${} expression)
    if (inTemplate) {
      if (ch === '\\' && i + 1 < chars.length) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i++;
        continue;
      }
      if (ch === '`') {
        inTemplate = false;
        continue;
      }
      if (ch === '$' && next === '{') {
        // Enter template expression — code is visible again
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i++;
        templateStack.push(0);
        inTemplate = false;
        continue;
      }
      chars[i] = ' ';
      continue;
    }

    // Inside regular string literals
    if (inSingle || inDouble) {
      if (ch === '\\' && i + 1 < chars.length) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i++;
        continue;
      }
      if ((inSingle && ch === "'") || (inDouble && ch === '"')) {
        inSingle = false;
        inDouble = false;
      } else {
        chars[i] = ' ';
      }
      continue;
    }

    // Track brace depth inside template expressions
    if (templateStack.length > 0) {
      if (ch === '{') {
        templateStack[templateStack.length - 1]++;
        continue;
      }
      if (ch === '}') {
        if (templateStack[templateStack.length - 1] === 0) {
          // Close the ${} — back to template string portion
          templateStack.pop();
          inTemplate = true;
          chars[i] = ' ';
          continue;
        }
        templateStack[templateStack.length - 1]--;
        continue;
      }
      // Inside ${} expression — code is visible, fall through to normal processing
    }

    // Not inside anything — check for openers
    if (ch === '/' && next === '/') {
      inLineComment = true;
      chars[i] = ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i++;
      continue;
    }
    if (
      ch === '#' &&
      (i === 0 || source[i - 1] === '\n' || /^\s*$/.test(source.slice(source.lastIndexOf('\n', i - 1) + 1, i)))
    ) {
      inLineComment = true;
      chars[i] = ' ';
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
    }
  }

  return chars.join('');
}

/** Find all 1-based line numbers where a pattern matches on executable code (masked) */
export function findLines(source: string, pattern: RegExp): number[] {
  const lines: number[] = [];
  const masked = createLexicalMask(source);
  const maskedLines = masked.split('\n');
  for (let i = 0; i < maskedLines.length; i++) {
    if (isCommentLine(maskedLines[i])) continue;
    if (pattern.test(maskedLines[i])) lines.push(i + 1);
  }
  return lines;
}

/** Get the function/handler body surrounding a line */
export function getSurroundingBlock(lines: string[], lineIdx: number, maxUp = 50, maxDown = 50): string {
  const start = Math.max(0, lineIdx - maxUp);
  const end = Math.min(lines.length, lineIdx + maxDown);
  return lines.slice(start, end).join('\n');
}
