/** @internal Native KERN body eligibility hint — slice 5a.
 *
 *  Walks the parsed tree and emits an `info`-severity `NATIVE_KERN_ELIGIBLE`
 *  diagnostic on every `handler` node that:
 *    - has a raw `<<<…>>>` body (`props.code` is a string), AND
 *    - is NOT already opted in via `lang="kern"`, AND
 *    - the raw body passes the `classifyHandlerBody` heuristic.
 *
 *  Severity is `info` to keep the diagnostic non-blocking — existing tooling
 *  (CI, IDE error counters) does not need to be tuned. The message points
 *  users toward the manual rewrite today; once slice 5b's `kern migrate
 *  native-handlers` lands, the suggestion will mention the bulk command.
 */

import { classifyHandlerBody } from './native-eligibility.js';
import { createParseState, emitDiagnostic, type ParseState } from './parser-diagnostics.js';
import type { IRNode, ParseDiagnostic } from './types.js';

export function validateNativeEligible(state: ParseState, root: IRNode): void {
  walk(state, root);
}

/** Test-friendly wrapper — runs the validator over a hand-built IRNode and
 *  returns the collected diagnostics. Used by the unit test that exercises
 *  the `lang="kern"` skip path, which the parser cannot produce end-to-end
 *  (the parser drops raw bodies on `lang="kern" <<< … >>>`). */
export function collectNativeEligibleHints(root: IRNode): ParseDiagnostic[] {
  const state = createParseState();
  validateNativeEligible(state, root);
  return state.diagnostics;
}

function walk(state: ParseState, node: IRNode): void {
  if (node.type === 'handler') {
    const props = node.props ?? {};
    const code = props.code;
    const lang = props.lang;
    if (typeof code === 'string' && lang !== 'kern') {
      const result = classifyHandlerBody(code);
      if (result.eligible) {
        const loc = node.loc ?? { line: 1, col: 1, endCol: 2 };
        emitDiagnostic(
          state,
          'NATIVE_KERN_ELIGIBLE',
          'info',
          'This handler body uses only patterns supported by `lang="kern"` — opt in for native cross-target validation.',
          loc.line,
          loc.col,
          { endCol: loc.endCol ?? loc.col + 1 },
        );
      }
    }
  }
  if (node.children) {
    for (const child of node.children) walk(state, child);
  }
}
