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

import { classifyHandlerBody, type HandlerBodyClassifier, isExplicitForeignRawBody } from './native-eligibility.js';
import { createParseState, emitDiagnostic, type ParseState } from './parser-diagnostics.js';
import type { IRNode, ParseDiagnostic } from './types.js';

/** Slice 0.9 — the `NATIVE_KERN_ELIGIBLE` advisory hint requires the
 *  TypeScript-AST eligibility classifier. To keep the parser browser-safe, the
 *  classifier is INJECTED (Node/codegen callers pass `classifyHandlerBodyAst`
 *  via `@kernlang/core/node`). When absent (browser/default parse), the advisory
 *  hint is simply skipped — it is a non-essential migration nudge, not a
 *  correctness diagnostic. */
export function validateNativeEligible(state: ParseState, root: IRNode, classify?: HandlerBodyClassifier): void {
  if (!classify) return;
  walk(state, root, classify);
}

/** Test-friendly wrapper — runs the validator over a hand-built IRNode and
 *  returns the collected diagnostics. Used by the unit test that exercises
 *  the `lang="kern"` skip path, which the parser cannot produce end-to-end
 *  (the parser drops raw bodies on `lang="kern" <<< … >>>`). */
export function collectNativeEligibleHints(root: IRNode, classify: HandlerBodyClassifier): ParseDiagnostic[] {
  const state = createParseState();
  validateNativeEligible(state, root, classify);
  return state.diagnostics;
}

function walk(state: ParseState, node: IRNode, classify: HandlerBodyClassifier): void {
  if (node.type === 'handler') {
    const props = node.props ?? {};
    const code = props.code;
    const lang = props.lang;
    if (typeof code === 'string' && lang !== 'kern') {
      if (
        isExplicitForeignRawBody({
          opener: 'handler',
          declaredLang: typeof lang === 'string' ? lang : undefined,
          declaredReason: typeof props.reason === 'string' ? props.reason : undefined,
        })
      ) {
        // Explicit foreign boundaries are reviewed as interop, not migration gaps.
      } else {
        const result = classifyHandlerBody(classify, code);
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
  }
  if (node.children) {
    for (const child of node.children) walk(state, child, classify);
  }
}
