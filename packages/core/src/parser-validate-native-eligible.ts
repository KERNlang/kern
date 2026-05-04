/** @internal Native KERN body eligibility hint — slice 5a (slice α-4: warn).
 *
 *  Walks the parsed tree and emits a `warning`-severity `NATIVE_KERN_ELIGIBLE`
 *  diagnostic on every `handler` node that:
 *    - has a raw `<<<…>>>` body (`props.code` is a string), AND
 *    - is NOT already opted in via `lang="kern"`, AND
 *    - the raw body passes the `classifyHandlerBody` heuristic.
 *
 *  Slice α-4: severity promoted from `info` → `warning`. After slice α-3 made
 *  classifier eligibility ≡ migrator success by construction, every emitted
 *  hint is actionable — running `kern migrate native-handlers --write` will
 *  rewrite the body to `lang="kern"` and the diagnostic disappears. The warn
 *  level is the durable gate for review: handlers that could be native KERN
 *  IR but aren't are visible noise until migrated, which is the desired
 *  pressure for "full KERN" adoption. Consumers that want the old quiet
 *  behaviour (`kern review`, `kern import`, the CLI build summary) still
 *  filter the code out at the consumer site.
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
          'warning',
          'This handler body uses only patterns supported by `lang="kern"` — opt in for native cross-target validation. Run `kern migrate native-handlers --write` to bulk-rewrite eligible bodies.',
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
