import { pythonExecutableLineMask } from '../../python-response-contract.js';
import type { LineInfo } from './lines.js';

/**
 * Blank physical lines that start inside a triple-quoted Python string while
 * preserving offsets and line numbers. The fallback remains intentionally
 * lightweight, but it must not interpret docstring examples as executable
 * routes, imports, guards, or error handlers.
 */
export function withoutTripleQuotedStringLines(lines: readonly LineInfo[]): LineInfo[] {
  const executableLines = pythonExecutableLineMask(lines.map((line) => line.text));
  return lines.map((line, index) => (executableLines[index] ? line : { ...line, text: '' }));
}
