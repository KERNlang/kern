/** @internal Native KERN body-statement context validator — slice 5b-pre.
 *
 *  Body-statement nodes (`assign`, `return`, `throw`, `do`, `continue`, `break`,
 *  body-form `if`/`else`, body-form `try`) are valid only inside a
 *  `handler lang="kern"` scope (or nested inside another body-statement
 *  under such a handler). Without this rule, the parser silently accepts
 *  orphan `return`/`throw` lines that then crash codegen with confusing
 *  errors deep in the body emitter.
 *
 *  Rules:
 *    - `assign`, `return`, `throw`, `do`, `continue`, `break` are rejected outside
 *      a native-body scope.
 *    - `if` with a `cond` prop is body-statement form (vs `conditional`'s
 *      `if=` prop); rejected outside native-body scope.
 *    - `else` whose parent is not `conditional` is body-statement form
 *      (sibling of body-`if`); rejected outside native-body scope.
 *    - `try` without a `name` prop and without `step` children is
 *      body-statement form; rejected outside native-body scope.
 *
 *  Not validated here:
 *    - `let` and `each` have other valid contexts (each-block render path).
 *    - Async-orchestration `try name=…` with `step`/`handler`/`catch`.
 *
 *  The validator runs as part of `parseInternal`, so both `parseStrict` and
 *  the diagnostics-collecting parse paths surface the error.
 */

import { emitDiagnostic, type ParseState } from './parser-diagnostics.js';
import type { IRNode } from './types.js';

interface WalkContext {
  /** True once we've entered a `handler lang="kern"` scope (and all descendants). */
  inNativeBody: boolean;
  /** Type of the immediate parent — used to disambiguate `else` form. */
  parentType: string | null;
}

const ROOT_CTX: WalkContext = { inNativeBody: false, parentType: null };

export function validateBodyStatements(state: ParseState, root: IRNode): void {
  walk(state, root, ROOT_CTX);
}

function walk(state: ParseState, node: IRNode, ctx: WalkContext): void {
  if (isBodyStatementMisplaced(node, ctx)) {
    const loc = node.loc ?? { line: 1, col: 1, endCol: 2 };
    emitDiagnostic(
      state,
      'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER',
      'error',
      `\`${node.type}\` is a body-statement node and is only valid inside a \`handler lang="kern"\` block (or nested inside another body-statement under such a handler).`,
      loc.line,
      loc.col,
      { endCol: loc.endCol ?? loc.col + 1 },
    );
  }

  const childCtx: WalkContext = {
    inNativeBody: ctx.inNativeBody || isNativeBodyHandler(node),
    parentType: node.type,
  };
  if (node.children) {
    for (const child of node.children) walk(state, child, childCtx);
  }
}

function isNativeBodyHandler(node: IRNode): boolean {
  return node.type === 'handler' && node.props?.lang === 'kern';
}

function isBodyStatementMisplaced(node: IRNode, ctx: WalkContext): boolean {
  if (ctx.inNativeBody) return false;

  switch (node.type) {
    case 'return':
    case 'assign':
    case 'throw':
    case 'do':
    case 'continue':
    case 'break':
      return true;
    case 'if':
      // Body-statement `if` carries a `cond` prop. `conditional` and route-
      // guard nodes use the unrelated `if=` *prop key* on their own node
      // type, so a node literally typed `if` is unambiguously the body-
      // statement form.
      return node.props?.cond !== undefined;
    case 'else':
      // `else` under `conditional` is the render-fallback branch (allowed
      // outside native-body scope). Anywhere else it's a body-statement
      // sibling of body-`if`.
      return ctx.parentType !== 'conditional';
    case 'try':
      // Async-orchestration `try` carries a `name` prop. Body-statement
      // form has no `name`. The parser cannot tell `try` with neither
      // `name` nor `step` children apart from a body-statement `try`
      // outside scope, so the no-name shape is the discriminator.
      return node.props?.name === undefined;
    default:
      return false;
  }
}
