/** @internal Parser diagnostics infrastructure — not part of the public API. */

import { defaultRuntime, type KernRuntime } from './runtime.js';
import type { ParseDiagnostic, ParseErrorCode } from './types.js';

export interface ParseState {
  diagnostics: ParseDiagnostic[];
}

interface EmitDiagnosticOptions {
  endCol?: number;
  suggestion?: string;
}

const DIAGNOSTIC_SUGGESTIONS: Record<ParseErrorCode, string> = {
  UNCLOSED_EXPR: 'Close the `{{ ... }}` expression or move the unfinished code into a quoted string.',
  UNCLOSED_STYLE: 'Close the `{ ... }` style block with `}` and keep any commas inside the block.',
  UNCLOSED_STRING: 'Add the missing closing quote or escape any embedded quotes inside the string.',
  UNEXPECTED_TOKEN: 'Remove the stray token or quote it so the parser can treat it as a value.',
  EMPTY_DOCUMENT: 'Add at least one root KERN node such as `screen`, `view`, or `text`.',
  INVALID_INDENT: 'Replace tabs with spaces so indentation is consistent across sibling nodes.',
  UNKNOWN_NODE_TYPE: 'Rename this node to a supported KERN keyword or register it as an evolved node type.',
  INDENT_JUMP: 'Align this line with an existing indentation level so the parent-child structure is unambiguous.',
  DUPLICATE_PROP: 'Remove the duplicate property or merge the values into a single prop assignment.',
  DROPPED_LINE: 'Rewrite this line so it starts with a valid KERN node type and move stray symbols into props.',
  INVALID_BIGINT: 'Remove the `n` suffix or drop the fractional part — BigInt literals must be whole integers.',
  INVALID_EXPRESSION:
    'The value could not be parsed as a KERN expression. Wrap it in `{{ ... }}` if it uses syntax not yet natively supported.',
};

export function createParseState(): ParseState {
  return { diagnostics: [] };
}

export function commitParseState(state: ParseState, runtime: KernRuntime = defaultRuntime): void {
  runtime.lastParseDiagnostics = state.diagnostics.map((d) => ({ ...d }));
}

export function emitDiagnostic(
  state: ParseState,
  code: ParseErrorCode,
  severity: ParseDiagnostic['severity'],
  message: string,
  line: number,
  col: number,
  options: EmitDiagnosticOptions = {},
): void {
  state.diagnostics.push({
    code,
    severity,
    message,
    line,
    col,
    endCol: Math.max(options.endCol ?? col + 1, col),
    suggestion: options.suggestion ?? DIAGNOSTIC_SUGGESTIONS[code],
  });
}
