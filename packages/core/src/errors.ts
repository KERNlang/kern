import type { ParseDiagnostic } from './types.js';

/**
 * Kern Error Types
 */

export class KernError extends Error {
  line: number;
  col: number;
  source: string;

  constructor(message: string, line: number, col: number, source: string) {
    const frame = codeFrame(source, line, col);
    super(`${message}\n\n${frame}`);
    this.name = 'KernError';
    this.line = line;
    this.col = col;
    this.source = source;
  }
}

export class KernParseError extends KernError {
  diagnostics: ParseDiagnostic[] = [];

  constructor(message: string, line: number, col: number, source: string) {
    super(`Parse error: ${message}`, line, col, source);
    this.name = 'KernParseError';
  }
}

export class KernCodegenError extends Error {
  constructor(message: string, public readonly node?: { type: string; loc?: { line: number; col: number } }) {
    const loc = node?.loc ? ` at ${node.type}:${node.loc.line}:${node.loc.col}` : node ? ` at ${node.type}` : '';
    super(`Codegen error: ${message}${loc}`);
    this.name = 'KernCodegenError';
  }
}

function codeFrame(source: string, line: number, col: number): string {
  const lines = source.split('\n');
  const start = Math.max(0, line - 3);
  const end = Math.min(lines.length, line + 2);
  const result: string[] = [];
  const gutterWidth = String(end).length;

  for (let i = start; i < end; i++) {
    const lineNum = String(i + 1).padStart(gutterWidth);
    const marker = i + 1 === line ? '>' : ' ';
    result.push(`${marker} ${lineNum} | ${lines[i]}`);
    if (i + 1 === line) {
      const pointer = ' '.repeat(gutterWidth + 4 + Math.max(0, col - 1)) + '^';
      result.push(pointer);
    }
  }

  return result.join('\n');
}
