/** @internal Parser diagnostics infrastructure — not part of the public API. */

import { defaultRuntime, type KernRuntime } from './runtime-state.js';
import type { DiagnosticCategory, ParseDiagnostic, ParseErrorCode } from './types.js';

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
  DROPPED_DECORATOR: 'Move the decorator directly above a fn declaration at the same indentation level.',
  INVALID_BIGINT: 'Remove the `n` suffix or drop the fractional part — BigInt literals must be whole integers.',
  INVALID_EXPRESSION:
    'The value could not be parsed as a KERN expression. Wrap it in `{{ ... }}` if it uses syntax not yet natively supported.',
  INVALID_EFFECTS: 'See docs/language/effects-pure-spec.md for the full forbidden list and incompatible-prop rules.',
  INVALID_UNION_KIND: 'Use `kind=result`, `kind=option`, or omit `kind` for a regular discriminated union.',
  KIND_SHAPE_VIOLATION:
    'A `kind=result` union must declare exactly two variants named `ok` and `err`; `kind=option` must declare exactly two variants named `some` and `none`.',
  INVALID_PROPAGATION:
    'Postfix `?` requires a call to a Result/Option-returning function and a containing fn whose return type is Result<T, E> or Option<T>. Use explicit `match` or a helper to bridge mixed types.',
  NESTED_PROPAGATION:
    'Chained `??` is not supported — bind the intermediate value to a `let`/`const` and propagate each step explicitly.',
  UNSAFE_UNWRAP_IN_RESULT_FN:
    'A function returning Result/Option is using `!` (panic) instead of `?` (propagate). Switch to `?` to keep the rich error shape.',
  NATIVE_KERN_ELIGIBLE:
    'Add `lang="kern"` to this handler and convert the body to KERN structured statements (let/return/if/each/try/throw) for native cross-target validation.',
  BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER:
    'Body-statement nodes (`let`/`return`/`if`/`else`/`each`/`try`/`with`/`catch`/`throw`) are only valid inside a `handler lang="kern"` block (or nested in another body-statement). Add `lang="kern"` to the parent handler, or move this node into one.',
  BODY_LOOP_CONTROL_OUTSIDE_LOOP:
    'Move this statement inside a `for`, `each`, or `while` body-statement loop, or remove it.',
  LET_INVALID_KIND: 'Use `kind=let` for mutable bindings, `kind=const` for explicit immutable bindings, or omit it.',
  BODY_FOR_INVALID_NAME:
    'Use a loop variable name that can compile unchanged to both TypeScript and Python: letters, digits, and underscores only, starting with a letter or underscore.',
  BODY_FOR_INVALID_STEP:
    'Use a literal positive integer step such as `step=1` or omit `step=`. Expression-valued and fractional steps are deferred until range-loop direction semantics are explicit.',
  BODY_FOR_INVALID_BOUND:
    'Use integer range bounds. Literal fractional bounds are rejected because Python range() cannot represent them.',
  CELL_OUTSIDE_HANDLER_TOP_LEVEL:
    'Lift the `cell` out of any enclosing `if`/`for`/`while`/`try`/`each` and place it directly under `handler lang="kern"`. Use a conditional `set` inside the branch instead.',
};

/** Coarse classification per diagnostic code so consumers can split
 *  "fix the source" errors from parser/validator/migration noise. Codes
 *  not listed here fall back to `source`. */
const DIAGNOSTIC_CATEGORIES: Partial<Record<ParseErrorCode, DiagnosticCategory>> = {
  // Parser-level — tree construction, indentation, dropped lines.
  INVALID_INDENT: 'parser',
  INDENT_JUMP: 'parser',
  DROPPED_LINE: 'parser',
  DROPPED_DECORATOR: 'parser',
  UNCLOSED_EXPR: 'parser',
  UNCLOSED_STYLE: 'parser',
  UNCLOSED_STRING: 'parser',
  UNEXPECTED_TOKEN: 'parser',
  EMPTY_DOCUMENT: 'parser',
  UNKNOWN_NODE_TYPE: 'parser',
  DUPLICATE_PROP: 'parser',
  // Validator — IR is structurally sound but a body-statement / cross-prop /
  // shape constraint rejected it. These are typically actionable by the
  // author but distinct from "your source is malformed".
  BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER: 'validator',
  BODY_LOOP_CONTROL_OUTSIDE_LOOP: 'validator',
  LET_INVALID_KIND: 'validator',
  BODY_FOR_INVALID_NAME: 'validator',
  BODY_FOR_INVALID_STEP: 'validator',
  BODY_FOR_INVALID_BOUND: 'validator',
  CELL_OUTSIDE_HANDLER_TOP_LEVEL: 'validator',
  INVALID_EFFECTS: 'validator',
  INVALID_UNION_KIND: 'validator',
  KIND_SHAPE_VIOLATION: 'validator',
  INVALID_PROPAGATION: 'validator',
  NESTED_PROPAGATION: 'validator',
  UNSAFE_UNWRAP_IN_RESULT_FN: 'validator',
  NATIVE_KERN_ELIGIBLE: 'validator',
  INVALID_EXPRESSION: 'validator',
  INVALID_BIGINT: 'validator',
  // Remaining codes fall through to `source` (the source itself violates
  // the language spec — author should rewrite the offending line).
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
    category: DIAGNOSTIC_CATEGORIES[code] ?? 'source',
  });
}
