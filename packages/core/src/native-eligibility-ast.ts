/** Native KERN handler-body AST eligibility — slice α-3.
 *
 *  Replaces slice 5a's regex pre-screen (in `native-eligibility.ts`) with a
 *  TS-AST walk that mirrors the migrator's `mapStatement` rules in
 *  `packages/cli/src/commands/migrate-native-handlers.ts`. After this slice,
 *  the diagnostic and the migrator agree by construction:
 *
 *      classifyHandlerBodyAst(body).eligible === true
 *      ⟺ kern migrate native-handlers will emit a `lang="kern"` rewrite for it.
 *
 *  Why this matters: the slice 5a regex disagreed with the migrator's deeper
 *  TS-AST shape check on ~34% of "eligible" bodies (agon scan, 2026-05-04).
 *  Promoting the diagnostic from `info` to `warn` at that disagreement rate
 *  would surface fix-or-suppress noise on bodies the migrator silently bails
 *  on — exactly the no-unused-vars trust-collapse pattern. AST agreement is
 *  the prerequisite for the future warn promotion.
 *
 *  The reason strings here are deliberately specific (e.g. `var-destructure`,
 *  `try-finally`, `expr-stmt-mutation`) so users running
 *  `kern migrate native-handlers` and `kern review` see actionable hints
 *  instead of a generic "ineligible". */

import ts from 'typescript';
import { supportedCompoundAssignmentOperator } from './assignment-operators.js';
import { classifyClosureBlock } from './closure-eligibility.js';
import { emitTypeAnnotation } from './codegen/emitters.js';
import { instanceofRhsRejectReasonForName } from './instanceof-rhs.js';
import { parseExpression } from './parser-expression.js';
import type { ValueIR } from './value-ir.js';

export interface AstEligibilityResult {
  eligible: boolean;
  /** When eligible: 'empty' | 'ok'.
   *  When ineligible: a short kebab-case slug naming the first blocking shape.
   *  Examples: 'comments-present', 'ts-parse-error', 'var-destructure',
   *  'var-non-const', 'try-finally', 'for-stmt', 'expr-stmt-mutation',
   *  'return-bad-expr', 'unsupported-stmt-<Kind>'. */
  reason: string;
}

interface ClassifyContext {
  loopDepth: number;
  /** W2 — when true, non-block control-flow bodies (`if (c) stmt;`) are
   *  eligible; the migrator emits a braced form and the opt-in canonicalizing
   *  `--verify` accepts the brace-only delta. Off by default (strict). */
  allowNonBlock?: boolean;
}

/** True when `exprText` parses cleanly under KERN's parser-expression.
 *
 *  Multi-line input is accepted: the parser itself is whitespace-insensitive,
 *  and the migrator round-trips through `canonicalKernExpression` before
 *  emitting into a quoted attribute value, so the original line shape never
 *  reaches the .kern serializer.
 *
 *  Exported so the migrator (`migrate-native-handlers.ts`) shares the
 *  same predicate the classifier uses — slice α-3 gemini review pulled
 *  the formerly duplicated helper into core to prevent the migrator's
 *  bail conditions from drifting away from the classifier's pass
 *  conditions. */
export function isValidKernExpression(exprText: string): boolean {
  // Defer to `canonicalKernExpression` so the eligibility classifier and the
  // migrator share the same pass/bail conditions exactly — including the
  // multi-line-template bailout. Without this delegation, a body like
  // `notify(\`hello\n${name}\`);` would parse cleanly here (KERN's
  // parser-expression accepts the template) but later fail in
  // `canonicalKernExpression`, breaking the documented "eligible ≡ migrates"
  // invariant from slice α-3.
  return canonicalKernExpression(exprText) !== null;
}

export function isValidKernAssignmentTarget(exprText: string): boolean {
  if (canonicalKernExpression(exprText) === null) return false;
  try {
    return isAssignableTarget(parseExpression(exprText));
  } catch {
    return false;
  }
}

export function isValidKernAssignmentValue(exprText: string): boolean {
  if (canonicalKernExpression(exprText) === null) return false;
  try {
    const expr = parseExpression(exprText);
    return expr.kind !== 'propagate';
  } catch {
    return false;
  }
}

/** Return a single-line form of `exprText` suitable for a quoted KERN
 *  attribute value. The migrator uses this so multi-line const initializers
 *  (`const x = {\n  a: 1,\n};`) can lift to `let name=x value="{ a: 1 }"`
 *  without leaking the source line shape into the .kern serialization.
 *
 *  Returns `null` if:
 *   - KERN's `parseExpression` rejects it (caller would bail anyway), or
 *   - the TS parser rejects the wrapped form, or
 *   - the expression contains a multi-line template literal whose newlines
 *     are semantically significant and cannot be collapsed.
 *
 *  Why not `emitExpression`: that serializer translates KERN stdlib calls
 *  to their TS-native form (`List.map(arr, fn)` → `arr.map(fn)`), which is
 *  correct for codegen but wrong here — the migrator must keep the surface
 *  call shape (`List.map(...)`) so the next round-trip parses to the same
 *  KERN IR. TS printer + newline-collapse preserves the surface form while
 *  normalizing whitespace outside string/template literals.
 *
 *  The migrator's `--verify` pre/post codegen diff catches any drift the
 *  normalization introduces. */
export function canonicalKernExpression(exprText: string): string | null {
  try {
    parseExpression(exprText);
  } catch {
    return null;
  }
  // Wrap in parens so a bare object literal (`{a:1}`) parses as an expression
  // rather than a block statement.
  const sf = ts.createSourceFile('__expr.ts', `(${exprText});`, ts.ScriptTarget.Latest, true);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  if (diags && diags.length > 0) return null;
  const stmt = sf.statements[0];
  if (!stmt || !ts.isExpressionStatement(stmt)) return null;
  let expr: ts.Expression = stmt.expression;
  if (ts.isParenthesizedExpression(expr)) expr = expr.expression;
  if (hasMultilineTemplate(expr, sf)) return null;
  const printed = canonicalPrinter.printNode(ts.EmitHint.Expression, expr, sf);
  return printed.replace(/\r?\n\s*/g, ' ');
}

export function canonicalObjectEntriesSource(expr: ts.Expression, sf: ts.SourceFile): string | null {
  const unwrapped = unwrapExpressionForShape(expr);
  if (!ts.isCallExpression(unwrapped) || unwrapped.arguments.length !== 1) return null;
  const callee = unwrapped.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (callee.name.text !== 'entries') return null;
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'Object') return null;
  return canonicalKernExpression(unwrapped.arguments[0].getText(sf));
}

function unwrapExpressionForShape(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

const canonicalPrinter = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });

function hasMultilineTemplate(node: ts.Node, sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      if (n.getText(sf).includes('\n')) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

export function isValidKernTypeAnnotation(typeText: string): boolean {
  if (/\n/.test(typeText)) return false;
  try {
    // Reuse the TS codegen sanitizer as a round-trip safety gate. This is
    // not a full type-system soundness check; it only decides whether the
    // original TS annotation can be preserved in native KERN source.
    emitTypeAnnotation(typeText, 'unknown');
    return true;
  } catch {
    return false;
  }
}

/** Classify bodies that should not count as ordinary language-gap blockers.
 *
 *  These are still ineligible for `kern migrate native-handlers`, but the
 *  reason tells the Self-coverage report that the right next action is an
 *  explicit foreign/template boundary, not a parser/codegen lift slice.
 */
function classifyParseFailureBoundary(bodyText: string): string | null {
  if (/\{\{\s*[A-Za-z_$][\w$.-]*\s*\}\}/.test(bodyText)) return 'template-placeholder';
  if (isObjectFragmentBody(bodyText)) return 'foreign-by-design';
  return null;
}

function isObjectFragmentBody(bodyText: string): boolean {
  return /^\s*[A-Za-z_$][\w$]*\s*:\s*[\s\S]*,\s*\n\s*[A-Za-z_$][\w$]*\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(
    bodyText,
  );
}

function isHostInteropBody(sf: ts.SourceFile): boolean {
  let found = false;
  const localBindings = collectLocalBindings(sf);
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (isHostInteropNode(node, localBindings)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function isHostInteropNode(node: ts.Node, localBindings: ReadonlySet<string>): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    const root = rootIdentifierName(node.expression);
    if (root && !localBindings.has(root) && (root === 'res' || root === 'process' || root === 'db' || root === 'uri')) {
      return true;
    }
    if (root && !localBindings.has(root) && root === 'req' && hasOptionalAccess(node)) {
      return true;
    }
  }

  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    const callee = node.expression;
    if (ts.isIdentifier(callee)) {
      if (localBindings.has(callee.text)) return false;
      return (
        callee.text === 'useEffect' ||
        callee.text === 'setTimeout' ||
        callee.text === 'clearTimeout' ||
        callee.text === 'fetch'
      );
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const root = rootIdentifierName(callee.expression);
      if (
        root &&
        !localBindings.has(root) &&
        (root === 'db' || root === 'registry' || root === 'req' || root === 'res')
      ) {
        return true;
      }
    }
  }

  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    if (localBindings.has(node.expression.text)) return false;
    return node.expression.text === 'AbortController' || node.expression.text === 'Pool';
  }

  return false;
}

function collectLocalBindings(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) collectBindingName(node.name, names);
    else if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    else if (ts.isParameter(node)) collectBindingName(node.name, names);
    else if (ts.isCatchClause(node) && node.variableDeclaration)
      collectBindingName(node.variableDeclaration.name, names);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function collectBindingName(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    collectBindingName(element.name, names);
  }
}

function rootIdentifierName(node: ts.Expression): string | null {
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  if (ts.isCallExpression(current)) return null;
  return ts.isIdentifier(current) ? current.text : null;
}

function hasOptionalAccess(node: ts.Expression): boolean {
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if ((current as { questionDotToken?: unknown }).questionDotToken !== undefined) return true;
    current = current.expression;
  }
  return false;
}

function isAssignableTarget(node: ValueIR): boolean {
  if (node.kind === 'ident') return true;
  if (node.kind === 'member') return !node.optional && !containsOptionalAccess(node.object);
  if (node.kind === 'index') return !node.optional && !containsOptionalAccess(node.object);
  return false;
}

function containsOptionalAccess(node: ValueIR): boolean {
  if (node.kind === 'member') return node.optional || containsOptionalAccess(node.object);
  if (node.kind === 'index') return node.optional || containsOptionalAccess(node.object);
  if (node.kind === 'call') return node.optional || containsOptionalAccess(node.callee);
  if (node.kind === 'nonNull' || node.kind === 'typeAssert') return containsOptionalAccess(node.expression);
  return false;
}

/** True when a TS template-literal body contains an escape sequence the
 *  cross-target `fmt` codegen can't safely lower. We only admit escapes that
 *  have the **same runtime semantics** in both TS template literals and
 *  Python f-strings:
 *
 *    `\n` `\t` `\r` `\b` `\f` `\v` `\0` `\\` `\'` `\"`
 *    `\xNN` (exactly 2 hex digits)
 *    `\uNNNN` (exactly 4 hex digits — NOT the ES2015 `\u{…}` brace form,
 *              which Python f-strings reject)
 *    `` \` `` (TS-only escape — Python emitter drops the `\`)
 *    `\${` (TS-only escape — Python emitter emits `${{` to render literal `${`)
 *
 *  Anything else — including TS identity escapes like `\{`, `\}`, `\a`, `\?`
 *  — drifts in Python (TS silently drops the backslash; Python either errors
 *  on `\{` or interprets `\a` as BEL 0x07). Reject those bodies so they stay
 *  in raw `<<<>>>` handlers instead of producing invalid or divergent Python.
 *
 *  Exported so the migrator applies the same predicate (eligibility ≡
 *  migrator invariant). (Codex impl-review P2 fix: widened from just
 *  rejecting `\u{` to a full cross-target safe-set check.) */
export function hasTsOnlyTemplateEscape(body: string): boolean {
  let i = 0;
  while (i < body.length) {
    if (body[i] !== '\\') {
      i++;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      // Trailing lone backslash — not a valid TS template, defensively bail.
      return true;
    }
    if (
      next === '\\' ||
      next === "'" ||
      next === '"' ||
      next === '`' ||
      next === 'n' ||
      next === 't' ||
      next === 'r' ||
      next === 'b' ||
      next === 'f' ||
      next === 'v' ||
      next === '0'
    ) {
      i += 2;
      continue;
    }
    if (next === '$') {
      // Only `\${` (escape the interpolation marker) is cross-target safe.
      // Bare `\$x` is a TS identity escape that diverges in Python.
      if (body[i + 2] !== '{') return true;
      i += 3;
      continue;
    }
    if (next === 'x') {
      if (i + 3 < body.length && /[0-9a-fA-F]/.test(body[i + 2]) && /[0-9a-fA-F]/.test(body[i + 3])) {
        i += 4;
        continue;
      }
      return true;
    }
    if (next === 'u') {
      // `\u{NNNN}` is ES2015-only — Python f-strings reject the brace form.
      if (body[i + 2] === '{') return true;
      if (
        i + 5 < body.length &&
        /[0-9a-fA-F]/.test(body[i + 2]) &&
        /[0-9a-fA-F]/.test(body[i + 3]) &&
        /[0-9a-fA-F]/.test(body[i + 4]) &&
        /[0-9a-fA-F]/.test(body[i + 5])
      ) {
        i += 6;
        continue;
      }
      return true;
    }
    // Any other char after `\` is a TS identity escape — TS drops the `\`,
    // Python either errors (`\{`, `\}`) or interprets differently (`\a` BEL).
    return true;
  }
  return false;
}

/** True when `bodyText` contains any line or block comment. The migrator
 *  drops comments silently on rewrite, so a body containing them is
 *  ineligible — preserving the comment is the user's responsibility.
 *  Exported (slice α-3 gemini review) so the migrator imports the same
 *  scanner predicate and comment-detection cannot diverge between the
 *  two sides. */
export function hasComments(bodyText: string): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ false);
  scanner.setText(bodyText);
  while (true) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) return false;
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) return true;
  }
}

export function hasOnlyMigratableComments(bodyText: string): boolean {
  const all = collectCommentRanges(bodyText);
  if (all.length === 0) return true;

  const sf = ts.createSourceFile('__handler.ts', bodyText, ts.ScriptTarget.Latest, true);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  if (diags && diags.length > 0) return false;

  // KERN-GAPS `comments-present` lift: a comment is migratable when it
  // sits on its own line at a statement boundary the migrator can latch a
  // `comment` body-stmt onto:
  //   - leading (standalone, own line, immediately before a statement)
  //   - tail-of-body (after the last top-level statement, own line)
  //   - tail-of-block (after the last statement inside an `if`/`for`/`while`
  //     body block, before the closing brace, own line)
  // Inline same-line trailing comments (`foo(); // x`) are NOT lifted —
  // the migrator emits them on a new line, which would byte-drift the
  // codegen output and trip `--verify` rollback. Comments INSIDE an
  // expression (e.g. `foo(/* mid */)`) likewise attach to no statement
  // boundary and stay rejected.
  const migratable = new Set<string>();
  const addBlockTail = (block: ts.Block): void => {
    const blockStmts = block.statements;
    if (blockStmts.length === 0) return;
    const lastEnd = blockStmts[blockStmts.length - 1].getEnd();
    const blockEnd = block.getEnd();
    for (const range of all) {
      if (range.pos >= lastEnd && range.end <= blockEnd && isStandaloneCommentRange(sf.text, range)) {
        migratable.add(commentRangeKey(range));
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStatement(node)) {
      for (const range of ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? []) {
        if (isStandaloneCommentRange(sf.text, range)) migratable.add(commentRangeKey(range));
      }
      // W1 — a single same-line trailing comment on a simple (single-line)
      // statement is migratable via the `trailingComment=` slot the migrator
      // re-emits inline. Must mirror the migrator's `trailingCommentRaw`
      // predicate exactly (exactly one range, no embedded newline).
      if (isSimpleTrailingStmt(node)) {
        const trailing = ts.getTrailingCommentRanges(sf.text, node.getEnd());
        if (trailing && trailing.length === 1 && !sf.text.slice(trailing[0].pos, trailing[0].end).includes('\n')) {
          migratable.add(commentRangeKey(trailing[0]));
        }
      }
    }
    if (ts.isBlock(node)) addBlockTail(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Tail-of-body — standalone comments positioned strictly after the last
  // top-level statement's end. A comments-only body (no top-level
  // statements) has no tail position; such handlers stay in
  // `comments-present` so the migrator's "no statements emitted" rule
  // and the classifier verdict remain in lockstep.
  const topStmts = sf.statements;
  if (topStmts.length > 0) {
    const lastTopEnd = topStmts[topStmts.length - 1].getEnd();
    for (const range of all) {
      if (range.pos >= lastTopEnd && isStandaloneCommentRange(sf.text, range)) {
        migratable.add(commentRangeKey(range));
      }
    }
  }

  return all.every((range) => migratable.has(commentRangeKey(range)));
}

function collectCommentRanges(bodyText: string): ts.CommentRange[] {
  const ranges: ts.CommentRange[] = [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ false);
  scanner.setText(bodyText);
  while (true) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) return ranges;
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      ranges.push({ pos: scanner.getTokenPos(), end: scanner.getTextPos(), kind, hasTrailingNewLine: false });
    }
  }
}

function isStandaloneCommentRange(text: string, range: ts.CommentRange): boolean {
  const beforeLineStart = text.lastIndexOf('\n', Math.max(0, range.pos - 1)) + 1;
  const afterLineEndIndex = text.indexOf('\n', range.end);
  const afterLineEnd = afterLineEndIndex === -1 ? text.length : afterLineEndIndex;
  const before = text.slice(beforeLineStart, range.pos);
  const after = text.slice(range.end, afterLineEnd);
  return before.trim() === '' && after.trim() === '';
}

function commentRangeKey(range: ts.CommentRange): string {
  return `${range.pos}:${range.end}:${range.kind}`;
}

/** A statement the migrator maps to a SINGLE body-stmt line, hence one that can
 *  carry an inline trailing comment via the `trailingComment=` slot. Mirrors
 *  the single-line `mapStatementCore` cases; destructuring and multi-declarator
 *  var decls map to multiple lines and are excluded. Keep in lockstep with the
 *  migrator's `trailingCommentRaw` capture. */
function isSimpleTrailingStmt(node: ts.Node): boolean {
  if (
    ts.isReturnStatement(node) ||
    ts.isThrowStatement(node) ||
    ts.isBreakStatement(node) ||
    ts.isContinueStatement(node) ||
    ts.isExpressionStatement(node)
  ) {
    return true;
  }
  if (ts.isVariableStatement(node)) {
    const decls = node.declarationList.declarations;
    return decls.length === 1 && ts.isIdentifier(decls[0].name);
  }
  return false;
}

/** Collect the raw text (braces included) of every block-bodied arrow
 *  (`x => { … }`) inside a statement subtree. TS-AST walk, never string
 *  scanning — `arrow.body.getText(sf)` yields the exact `{ … }` source. */
function collectBlockArrowRaws(node: ts.Node, sf: ts.SourceFile): string[] {
  const raws: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isArrowFunction(n) && ts.isBlock(n.body)) {
      raws.push(n.body.getText(sf));
      // Don't descend into the block body: the v1 closure gate already rejects
      // nested arrows, so a nested block arrow can't be independently eligible.
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return raws;
}

/** Eligibility verdict for any block-bodied arrows in a statement (slices
 *  0+1+2). Returns a reject reason or `null` if the statement's block arrows
 *  are all gate-passing:
 *   - any arrow whose `classifyClosureBlock` is non-null → that gate reason
 *     (the statement is ineligible for the same reason the closure is).
 *   - otherwise `null` (eligible — funnels through isValidKernExpression for
 *     the statement's own expression validity, which now parses the arrow).
 *
 *  Slice 2 lifted the former `closure-in-loop` reject: a gate-passing block
 *  arrow inside a loop is now eligible. The Python lowerer pins per-iteration
 *  captures via default args (`def __kern_closure_N(p, x=x):`) so JS
 *  by-reference / per-iteration capture semantics are preserved across both
 *  targets. The classifier therefore no longer consults `ctx.loopDepth`. */
function classifyBlockArrows(stmt: ts.Statement, sf: ts.SourceFile): string | null {
  const raws = collectBlockArrowRaws(stmt, sf);
  if (raws.length === 0) return null;
  for (const raw of raws) {
    const gateReason = classifyClosureBlock(raw);
    if (gateReason !== null) return gateReason;
  }
  return null;
}

/** Scan a statement subtree for an `instanceof` whose RHS KERN cannot lower
 *  (eligible ≡ lowerable, spec §3). Returns the first reject reason or `null`:
 *   - RHS is a bare ident in the reject set →
 *     `instanceof-rhs-wrapper-rejected` (String/Number/Boolean) or
 *     `instanceof-rhs-unsupported-builtin` (Object/Function/Date/RegExp/
 *     Promise/Map/Set/Symbol/BigInt).
 *   - RHS is NOT an identifier (call/literal/binary/etc.) →
 *     `instanceof-rhs-not-a-type-name`. A member-access RHS (`a.b.C`) is a
 *     qualified type name and stays accepted (emits as-is, like a user class).
 *  Accepted host idents (`Array`/`Error`/`TypeError`) and user-class /
 *  member RHS pass (return `null`); they emit as-is or via the host map.
 *
 *  Detection is on the TS AST (`ts.isBinaryExpression` + `InstanceOfKeyword`),
 *  mirroring the Python emitter's fail-closed reject so the gate and the
 *  lowerer share one source of truth (`instanceof-rhs.ts`). The whole subtree
 *  is scanned so a rejected `instanceof` nested in any expression position
 *  (ternary arm, call arg, arrow body, …) is caught. */
function classifyInstanceofRhs(node: ts.Node): string | null {
  let reason: string | null = null;
  const visit = (n: ts.Node): void => {
    if (reason !== null) return;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
      const rhs = n.right;
      if (ts.isIdentifier(rhs)) {
        reason = instanceofRhsRejectReasonForName(rhs.text);
      } else if (!ts.isPropertyAccessExpression(rhs)) {
        // Member RHS (`a.b.C`) is a qualified type name → accepted (emit
        // as-is). Anything else (call/literal/parenthesized/binary) is not a
        // type name and cannot be lowered.
        reason = 'instanceof-rhs-not-a-type-name';
      }
      if (reason !== null) return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return reason;
}

/** Classify a single statement. Returns null if the migrator can emit it,
 *  otherwise a kebab-case reason. Recurses through if/try branches. */
function classifyStmt(stmt: ts.Statement, sf: ts.SourceFile, ctx: ClassifyContext): string | null {
  // Eligible ≡ lowerable (spec §3): a statement carrying an `instanceof` with a
  // RHS the Python emitter fail-closes on is ineligible, with a reason that
  // names the exact RHS problem. Run before the per-shape checks so the
  // instanceof reason wins over a generic `*-bad-expr`.
  const instanceofReason = classifyInstanceofRhs(stmt);
  if (instanceofReason !== null) return instanceofReason;
  // Slices 0+1+2 — a statement containing a block-bodied arrow is eligible IFF
  // every such arrow passes the v1 closure gate. Slice 2 lifted the former
  // in-loop reject (the Python lowerer now pins per-iteration captures), so the
  // loop context no longer matters here. The statement's own expression
  // validity is still checked below via isValidKernExpression — the block arrow
  // inside it parses now.
  const closureReason = classifyBlockArrows(stmt, sf);
  if (closureReason !== null) return closureReason;
  if (ts.isVariableStatement(stmt)) {
    const flags = stmt.declarationList.flags;
    const isConst = (flags & ts.NodeFlags.Const) !== 0;
    const isLet = (flags & ts.NodeFlags.Let) !== 0;
    if (!isConst && !isLet) return 'var-non-const';
    const decls = stmt.declarationList.declarations;
    if (decls.length !== 1) return 'var-multi-decl';
    const decl = decls[0];
    if (decl.type && !isValidKernTypeAnnotation(decl.type.getText(sf))) return 'var-bad-type';
    if (!decl.initializer) {
      // `let x;` migrates to `let name=x kind=let` (the body emitter handles
      // missing `value=` by emitting `let x = undefined;`, matching TS
      // semantics). Destructured uninitialised bindings (`let { x };`) are a
      // TS parse error in practice, but defensively reject them anyway since
      // the migrator can only emit identifier-named lets in this branch.
      if (!ts.isIdentifier(decl.name)) return 'var-destructure';
      return null;
    }
    if (!ts.isIdentifier(decl.name)) return classifyDestructureDecl(decl, sf);
    // Template-literal initializer is migratable via the `fmt` body-stmt.
    // Single-line restriction stays (KERN attribute syntax can't carry raw
    // newlines). Backslash escape sequences (`\n`, `\t`, `\xNN`, `\uNNNN`,
    // `\\`, `` \` ``, `\${`) round-trip byte-cleanly now that the `fmt`
    // codegen no longer re-escapes backslashes (commit "close template-escapes
    // gap"; see emitters.ts emitFmtTemplate / codegen-body-python.ts
    // templateToPyFString). The ES6 code-point escape `\u{NNNN}` is rejected
    // because Python f-strings only accept `\uNNNN`/`\UNNNNNNNN` — keeping
    // the TS-only form blocked preserves cross-target parity.
    if (ts.isNoSubstitutionTemplateLiteral(decl.initializer) || ts.isTemplateExpression(decl.initializer)) {
      const raw = decl.initializer.getText(sf);
      const body = raw.slice(1, -1);
      if (body.includes('\n')) return 'var-template-multiline';
      if (hasTsOnlyTemplateEscape(body)) return 'var-template-escapes';
      return null;
    }
    if (!isValidKernExpression(decl.initializer.getText(sf))) return 'var-bad-expr';
    return null;
  }
  if (ts.isReturnStatement(stmt)) {
    if (!stmt.expression) return null;
    // Template-literal return is migratable via `fmt return=true`. See the
    // matching binding-form comment above for the backslash-escape policy.
    if (ts.isNoSubstitutionTemplateLiteral(stmt.expression) || ts.isTemplateExpression(stmt.expression)) {
      const raw = stmt.expression.getText(sf);
      const body = raw.slice(1, -1);
      if (body.includes('\n')) return 'return-template-multiline';
      if (hasTsOnlyTemplateEscape(body)) return 'return-template-escapes';
      return null;
    }
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'return-bad-expr';
    return null;
  }
  if (ts.isThrowStatement(stmt)) {
    if (!stmt.expression) return 'throw-no-expr';
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'throw-bad-expr';
    return null;
  }
  if (ts.isBreakStatement(stmt)) {
    if (stmt.label) return 'break-labeled';
    return ctx.loopDepth > 0 ? null : 'break-outside-loop';
  }
  if (ts.isContinueStatement(stmt)) {
    if (stmt.label) return 'continue-labeled';
    return ctx.loopDepth > 0 ? null : 'continue-outside-loop';
  }
  if (ts.isIfStatement(stmt)) {
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'if-bad-cond';
    // Body emitters (`emitNativeKernBodyTS` / `emitNativeKernBodyPython`) always
    // wrap `if` bodies in braces / indented blocks. A raw `if (cond) stmt;`
    // would migrate to `if cond=… → { stmt; }` and lose byte-equivalence under
    // `--verify`. Mirror the `for-of-non-block` / `while-non-block` guards.
    if (!ctx.allowNonBlock && !ts.isBlock(stmt.thenStatement)) return 'if-non-block-then';
    const thenReason = classifyBranch(stmt.thenStatement, sf, ctx);
    if (thenReason !== null) return thenReason;
    if (stmt.elseStatement) {
      // `else if (…)` is a nested IfStatement here. The migrator's mapIf
      // recurses for it, and the body emitters (TS + Python) collapse the
      // resulting `else > if` shape back to `else if` / `elif` (commit
      // 88c06dcc on dev). classifyBranch handles the nested IfStatement
      // by re-entering classifyStmt, so the recursion is automatic.
      if (!ctx.allowNonBlock && !ts.isIfStatement(stmt.elseStatement) && !ts.isBlock(stmt.elseStatement)) {
        return 'if-non-block-else';
      }
      const elseReason = classifyBranch(stmt.elseStatement, sf, ctx);
      if (elseReason !== null) return elseReason;
    }
    return null;
  }
  if (ts.isTryStatement(stmt)) {
    // KERN-GAPS `try-no-catch` (5) + `try-finally` (1): the body-stmt `try`
    // codegen has supported finally-only and catch+finally since slice 4c
    // (body-ts.ts:286-292 / codegen-body-python.ts:316-323), and the schema
    // permits `finally` as a `try` child. The only remaining requirement is
    // the TS-level shape — at least one of `catch`/`finally` must be present.
    if (!stmt.catchClause && !stmt.finallyBlock) return 'try-no-catch';
    if (stmt.catchClause) {
      const cc = stmt.catchClause;
      if (cc.variableDeclaration && !ts.isIdentifier(cc.variableDeclaration.name)) return 'try-destruct-catch';
      const catchReason = classifyBranch(cc.block, sf, ctx);
      if (catchReason !== null) return catchReason;
    }
    const tryReason = classifyBranch(stmt.tryBlock, sf, ctx);
    if (tryReason !== null) return tryReason;
    if (stmt.finallyBlock) {
      const finallyReason = classifyBranch(stmt.finallyBlock, sf, ctx);
      if (finallyReason !== null) return finallyReason;
    }
    return null;
  }
  if (ts.isExpressionStatement(stmt)) {
    // Slice α-1: ExpressionStatement → `do value="…"`. Plain `=` maps to
    // `assign`; compound assignment maps to `assign op=...`; postfix `X++;`
    // / `X--;` maps to the value-less form `assign target=X op="++"`. Prefix
    // `++X;` stays unsupported because there's no IR shape that round-trips
    // back to the prefix form rather than postfix under `--verify`.
    if (ts.isBinaryExpression(stmt.expression)) {
      const op = stmt.expression.operatorToken.kind;
      if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) {
        if (op !== ts.SyntaxKind.EqualsToken && !supportedCompoundAssignmentOperator(op)) {
          return 'expr-stmt-assignment';
        }
        if (!isValidKernAssignmentTarget(stmt.expression.left.getText(sf))) return 'expr-stmt-bad-assign-target';
        if (!isValidKernAssignmentValue(stmt.expression.right.getText(sf))) return 'expr-stmt-bad-assign-value';
        return null;
      }
    }
    if (ts.isPostfixUnaryExpression(stmt.expression)) {
      const op = stmt.expression.operator;
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
        // Postfix `X++;` / `X--;` lifts to `assign target=X op="++"` / `op="--"`
        // (value-less form). The result of the expression is discarded as an
        // expression statement, so postfix-vs-prefix is observationally
        // irrelevant — but the SOURCE TEXT differs, and `--verify` compares
        // byte-equivalent re-emission. We therefore only migrate postfix; the
        // prefix branch below stays in the `expr-stmt-mutation` skip bucket so
        // raw-handler authors get a clear reason and the migrator never rewrites
        // bytes it cannot reproduce.
        if (!isValidKernAssignmentTarget(stmt.expression.operand.getText(sf))) {
          return 'expr-stmt-bad-assign-target';
        }
        return null;
      }
    }
    if (ts.isPrefixUnaryExpression(stmt.expression)) {
      const op = stmt.expression.operator;
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) return 'expr-stmt-mutation';
    }
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'expr-stmt-bad-expr';
    return null;
  }
  if (ts.isForOfStatement(stmt)) {
    if (!ts.isVariableDeclarationList(stmt.initializer)) return 'for-of-non-decl';
    if (!(stmt.initializer.flags & ts.NodeFlags.Const)) return 'for-of-non-const';
    const decls = stmt.initializer.declarations;
    if (decls.length !== 1) return 'for-of-multi-decl';
    const decl = decls[0];
    if (decl.initializer) return 'for-of-init';
    if (!ts.isIdentifier(decl.name)) {
      const entryBinding = parseForOfEntryBinding(decl.name);
      if (entryBinding === null) return 'for-of-destructure';
      if (stmt.awaitModifier && canonicalObjectEntriesSource(stmt.expression, sf) !== null) {
        return 'for-of-async-object-entries';
      }
      if (stmt.awaitModifier && entryBinding.kind !== 'pair') return 'for-of-async-entry';
      // KERN-GAPS: sync pair iteration (`for (const [k, v] of expr)`) lifts to
      // `each pairKey=k pairValue=v in=expr` regardless of whether `expr` is
      // `Object.entries(...)` — Map.entries(), arrays-of-pairs, and generators
      // yielding `[k,v]` all round-trip byte-cleanly through TS codegen.
      // Key-only / value-only modes still require `Object.entries(...)` because
      // the migrator only emits those with `entries=true`. (Codex review fix.)
      if (
        !stmt.awaitModifier &&
        entryBinding.kind !== 'pair' &&
        canonicalObjectEntriesSource(stmt.expression, sf) === null
      ) {
        return 'for-of-sync-pair';
      }
      if (decl.type) return 'for-of-destructure-type';
    } else if (decl.type && !isValidKernTypeAnnotation(decl.type.getText(sf))) {
      return 'for-of-bad-type';
    }
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'for-of-bad-expr';
    // Only block-shaped loops are currently migratable. `each` always emits
    // braces, so migrating `for (const x of xs) do(x);` would drift under
    // --verify even though it is semantically close.
    if (!ctx.allowNonBlock && !ts.isBlock(stmt.statement)) return 'for-of-non-block';
    if (ts.isBlock(stmt.statement) && stmt.statement.statements.length === 0) return 'for-of-empty-body';
    return classifyBranch(stmt.statement, sf, { ...ctx, loopDepth: ctx.loopDepth + 1 });
  }
  if (ts.isWhileStatement(stmt)) {
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'while-bad-cond';
    if (!ctx.allowNonBlock && !ts.isBlock(stmt.statement)) return 'while-non-block';
    if (ts.isBlock(stmt.statement) && stmt.statement.statements.length === 0) return 'while-empty-body';
    return classifyBranch(stmt.statement, sf, { ...ctx, loopDepth: ctx.loopDepth + 1 });
  }
  if (ts.isForStatement(stmt) || ts.isForInStatement(stmt)) return 'for-stmt';
  if (ts.isDoStatement(stmt)) return 'do-while-stmt';
  if (ts.isSwitchStatement(stmt)) return 'switch-stmt';
  if (ts.isBlock(stmt)) return 'bare-block';
  // Fallback — the TS SyntaxKind name surfaces in diagnostics so users have
  // a starting point when they hit something exotic (label, with, debugger).
  return `unsupported-stmt-${ts.SyntaxKind[stmt.kind]}`;
}

function classifyDestructureDecl(decl: ts.VariableDeclaration, sf: ts.SourceFile): string | null {
  if (!decl.initializer) return 'var-no-init';
  if (!isValidKernExpression(decl.initializer.getText(sf))) return 'var-destructure-bad-expr';
  const name = decl.name;
  if (ts.isObjectBindingPattern(name)) {
    if (name.elements.length === 0) return 'var-destructure-empty';
    for (const element of name.elements) {
      if (element.dotDotDotToken) return 'var-destructure-rest';
      if (element.initializer) return 'var-destructure-default';
      if (!ts.isIdentifier(element.name)) return 'var-destructure-nested';
      if (element.propertyName && !ts.isIdentifier(element.propertyName)) return 'var-destructure-computed';
    }
    return null;
  }
  if (ts.isArrayBindingPattern(name)) {
    let concreteElements = 0;
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      concreteElements++;
      if (element.dotDotDotToken) return 'var-destructure-rest';
      if (element.initializer) return 'var-destructure-default';
      if (!ts.isIdentifier(element.name)) return 'var-destructure-nested';
    }
    if (concreteElements === 0) return 'var-destructure-empty';
    return null;
  }
  return 'var-destructure';
}

function parseForOfEntryBinding(name: ts.BindingName): { kind: 'pair' | 'key' | 'value' } | null {
  if (!ts.isArrayBindingPattern(name)) return null;
  if (name.elements.length === 1) {
    const [element] = name.elements;
    if (ts.isOmittedExpression(element)) return null;
    if (element.dotDotDotToken || element.initializer) return null;
    if (!ts.isIdentifier(element.name)) return null;
    return { kind: 'key' };
  }
  if (name.elements.length !== 2) return null;
  const [keyElement, valueElement] = name.elements;
  if (!ts.isOmittedExpression(keyElement)) {
    if (keyElement.dotDotDotToken || keyElement.initializer) return null;
    if (!ts.isIdentifier(keyElement.name)) return null;
  }
  if (ts.isOmittedExpression(valueElement)) return null;
  if (valueElement.dotDotDotToken || valueElement.initializer) return null;
  if (!ts.isIdentifier(valueElement.name)) return null;
  return ts.isOmittedExpression(keyElement) ? { kind: 'value' } : { kind: 'pair' };
}

function classifyBranch(node: ts.Statement, sf: ts.SourceFile, ctx: ClassifyContext): string | null {
  const stmts = ts.isBlock(node) ? Array.from(node.statements) : [node];
  for (const s of stmts) {
    const r = classifyStmt(s, sf, ctx);
    if (r !== null) return r;
  }
  return null;
}

/** Classify a raw `<<<…>>>` handler body — the AST-aware replacement for
 *  the slice 5a regex pass. Returns `eligible: true` only if every top-level
 *  statement (and every nested if/try branch) maps to a body-statement form
 *  the migrator can emit. */
export function classifyHandlerBodyAst(rawBody: string, opts?: { allowNonBlock?: boolean }): AstEligibilityResult {
  const trimmed = rawBody.trim();
  if (trimmed === '') return { eligible: true, reason: 'empty' };
  const sf = ts.createSourceFile('__handler.ts', rawBody, ts.ScriptTarget.Latest, true);
  // ts.SourceFile carries `parseDiagnostics` despite not exposing it on the
  // public type — the migrator reads it the same way.
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  if (diags && diags.length > 0) {
    const parseBoundary = classifyParseFailureBoundary(rawBody);
    if (parseBoundary !== null) return { eligible: false, reason: parseBoundary };
    if (hasComments(rawBody) && !hasOnlyMigratableComments(rawBody)) {
      return { eligible: false, reason: 'comments-present' };
    }
    return { eligible: false, reason: 'ts-parse-error' };
  }
  if (isHostInteropBody(sf)) return { eligible: false, reason: 'foreign-by-design' };
  if (hasComments(rawBody) && !hasOnlyMigratableComments(rawBody)) {
    return { eligible: false, reason: 'comments-present' };
  }
  for (const stmt of sf.statements) {
    const r = classifyStmt(stmt, sf, { loopDepth: 0, allowNonBlock: opts?.allowNonBlock });
    if (r !== null) return { eligible: false, reason: r };
  }
  return { eligible: true, reason: 'ok' };
}
