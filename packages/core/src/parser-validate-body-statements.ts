/** @internal Native KERN body-statement context validator — slice 5b-pre.
 *
 *  Body-statement nodes (`assign`, `return`, `throw`, `do`, `continue`, `break`, `while`, `for`, `with`,
 *  body-form `if`/`else`, body-form `try`) are valid only inside a
 *  `handler lang="kern"` scope (or nested inside another body-statement
 *  under such a handler). Without this rule, the parser silently accepts
 *  orphan `return`/`throw` lines that then crash codegen with confusing
 *  errors deep in the body emitter.
 *
 *  Rules:
 *    - `assign`, `return`, `throw`, `do`, `continue`, `break`, `while`, `for`, `with` are rejected outside
 *      a native-body scope.
 *    - `continue` and `break` are rejected inside native-body scope unless
 *      nested under `for`/`each`/`while`.
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
  /** Depth of body-statement loops (`for`/`each`/`while`) in the native body. */
  loopDepth: number;
  /** Type of the immediate parent — used to disambiguate `else` form. */
  parentType: string | null;
  /**
   * True once we've entered a `route` (and all descendants). Portable
   * side-effects (`assign`/`do`) are valid anywhere in a route's subtree — both
   * as direct children and nested inside portable `branch`/`each` bodies, which
   * the FastAPI/Express portable emitters lower recursively. A route subtree has
   * no render context, so this never wrongly admits them into JSX.
   */
  inPortableRoute: boolean;
}

const ROOT_CTX: WalkContext = { inNativeBody: false, loopDepth: 0, parentType: null, inPortableRoute: false };

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
  if (ctx.inNativeBody && node.type === 'cell' && ctx.parentType !== 'handler') {
    // Rules of Hooks: useState must be called unconditionally at the top of
    // the component. Nesting `cell` inside `if`/`else`/`while`/`for`/`each`/
    // `try`/`catch`/`finally` would emit a conditional `useState` call and
    // crash at runtime. Restrict cell to direct child of `handler lang=kern`.
    const loc = node.loc ?? { line: 1, col: 1, endCol: 2 };
    emitDiagnostic(
      state,
      'CELL_OUTSIDE_HANDLER_TOP_LEVEL',
      'error',
      '`cell` must be a direct child of `handler lang="kern"` (Rules of Hooks). Lift the cell out of any enclosing `if`/`for`/`while`/`try` and use a conditional `set` for the dynamic write instead.',
      loc.line,
      loc.col,
      { endCol: loc.endCol ?? loc.col + 1 },
    );
  }
  if (ctx.inNativeBody && isLoopControlOutsideLoop(node, ctx)) {
    const loc = node.loc ?? { line: 1, col: 1, endCol: 2 };
    emitDiagnostic(
      state,
      'BODY_LOOP_CONTROL_OUTSIDE_LOOP',
      'error',
      `\`${node.type}\` is only valid inside a \`for\`, \`each\`, or \`while\` body-statement loop.`,
      loc.line,
      loc.col,
      { endCol: loc.endCol ?? loc.col + 1 },
    );
  }
  if (ctx.inNativeBody && node.type === 'for') validateForStatementShape(state, node);
  if (node.type === 'let') validateLetKind(state, node);

  const inNativeBody = ctx.inNativeBody || isNativeBodyHandler(node);
  const childCtx: WalkContext = {
    inNativeBody,
    loopDepth: inNativeBody && isBodyStatementLoop(node) ? ctx.loopDepth + 1 : ctx.loopDepth,
    parentType: node.type,
    inPortableRoute: ctx.inPortableRoute || node.type === 'route',
  };
  if (node.children) {
    for (const child of node.children) walk(state, child, childCtx);
  }
}

function validateLetKind(state: ParseState, node: IRNode): void {
  const rawKind = node.props?.kind;
  if (rawKind === undefined || rawKind === '' || rawKind === 'const' || rawKind === 'let') return;
  const loc = node.loc ?? { line: 1, col: 1, endCol: 2 };
  emitDiagnostic(state, 'LET_INVALID_KIND', 'error', '`let kind=` supports only `const` or `let`.', loc.line, loc.col, {
    endCol: loc.endCol ?? loc.col + 1,
  });
}

function isLoopControlOutsideLoop(node: IRNode, ctx: WalkContext): boolean {
  return (node.type === 'continue' || node.type === 'break') && ctx.loopDepth <= 0;
}

function isBodyStatementLoop(node: IRNode): boolean {
  // This validator currently has no native body-statement node that opens a
  // nested function scope. Revisit loopDepth propagation if closure/lambda
  // body nodes are added.
  return node.type === 'for' || node.type === 'each' || node.type === 'while';
}

function validateForStatementShape(state: ParseState, node: IRNode): void {
  const loc = node.loc ?? { line: 1, col: 1, endCol: 2 };
  const rawName = node.props?.name;
  if (rawName !== undefined && rawName !== '' && !isCrossTargetIdentifier(String(rawName))) {
    emitDiagnostic(
      state,
      'BODY_FOR_INVALID_NAME',
      'error',
      '`for name=` must be a cross-target identifier using letters, digits, and underscores only.',
      loc.line,
      loc.col,
      { endCol: loc.endCol ?? loc.col + 1 },
    );
  }
  const rawStep = node.props?.step;
  if (rawStep !== undefined && rawStep !== '' && !isNonZeroIntegerLiteral(String(rawStep))) {
    emitDiagnostic(
      state,
      'BODY_FOR_INVALID_STEP',
      'error',
      '`for step=` must be a non-zero integer literal in this cross-target range-loop slice.',
      loc.line,
      loc.col,
      { endCol: loc.endCol ?? loc.col + 1 },
    );
  }
  for (const propName of ['from', 'to']) {
    const rawBound = node.props?.[propName];
    if (rawBound !== undefined && rawBound !== '' && isNonIntegerNumericLiteral(String(rawBound))) {
      emitDiagnostic(
        state,
        'BODY_FOR_INVALID_BOUND',
        'error',
        `\`for ${propName}=\` must be an integer expression; fractional numeric literals are not cross-target range bounds.`,
        loc.line,
        loc.col,
        { endCol: loc.endCol ?? loc.col + 1 },
      );
    }
  }
}

function isCrossTargetIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function isNonZeroIntegerLiteral(raw: string): boolean {
  const trimmed = raw.trim();
  const numeric = Number(trimmed);
  return /^[+-]?[0-9]+$/.test(trimmed) && Number.isSafeInteger(numeric) && numeric !== 0;
}

function isNonIntegerNumericLiteral(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === '') return false;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && !Number.isInteger(numeric);
}

function isNativeBodyHandler(node: IRNode): boolean {
  return node.type === 'handler' && node.props?.lang === 'kern';
}

function isBodyStatementMisplaced(node: IRNode, ctx: WalkContext): boolean {
  if (ctx.inNativeBody) return false;

  switch (node.type) {
    case 'set':
      // `set` is dual-purpose: an `on` event-handler shortcut (`on event=click
      // → set name=count to=...`) AND a body-statement write to a `cell` inside
      // a `handler lang="kern"`. The on-event form is parented by `on`; the
      // body-stmt form is parented by handler/try/catch/finally/while/for. Only
      // flag as misplaced when neither parent context applies.
      return ctx.parentType !== 'on';
    case 'assign':
    case 'do':
      // Dual-context, mirroring `set`: valid as a body-statement inside a
      // `handler lang="kern"` (handled by the `inNativeBody` early-return above),
      // AND as a portable side-effect anywhere in a `route` subtree — both as a
      // direct child (`assign target="provider.enabled" value="body.enabled"`)
      // and nested inside a portable `branch`/`each`, which the portable emitters
      // lower recursively. Every other non-native context stays rejected.
      return !ctx.inPortableRoute;
    case 'cell':
    case 'return':
    case 'throw':
    case 'continue':
    case 'break':
    case 'while':
    case 'for':
    case 'with':
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
