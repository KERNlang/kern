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
import { emitTypeAnnotation } from './codegen/emitters.js';
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
  if (all.some((range) => !isStandaloneCommentRange(bodyText, range))) return false;

  const sf = ts.createSourceFile('__handler.ts', bodyText, ts.ScriptTarget.Latest, true);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  if (diags && diags.length > 0) return false;

  const leading = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isStatement(node)) {
      for (const range of ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? []) {
        if (isStandaloneCommentRange(sf.text, range)) leading.add(commentRangeKey(range));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return all.every((range) => leading.has(commentRangeKey(range)));
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

/** Classify a single statement. Returns null if the migrator can emit it,
 *  otherwise a kebab-case reason. Recurses through if/try branches. */
function classifyStmt(stmt: ts.Statement, sf: ts.SourceFile, ctx: ClassifyContext): string | null {
  if (ts.isVariableStatement(stmt)) {
    const flags = stmt.declarationList.flags;
    const isConst = (flags & ts.NodeFlags.Const) !== 0;
    const isLet = (flags & ts.NodeFlags.Let) !== 0;
    if (!isConst && !isLet) return 'var-non-const';
    const decls = stmt.declarationList.declarations;
    if (decls.length !== 1) return 'var-multi-decl';
    const decl = decls[0];
    if (!decl.initializer) return 'var-no-init';
    if (decl.type && !isValidKernTypeAnnotation(decl.type.getText(sf))) return 'var-bad-type';
    if (!ts.isIdentifier(decl.name)) return classifyDestructureDecl(decl, sf);
    // Template-literal initializer is migratable via the `fmt` body-stmt.
    // Restriction parity with the migrator: single-line, no backslash escape
    // sequences (avoids round-trip drift between KERN attribute escaping and
    // codegen-side backtick escaping). Multi-line falls through; templates
    // with escapes are reported separately so the classifier reason matches
    // the actual migrator bail.
    if (ts.isNoSubstitutionTemplateLiteral(decl.initializer) || ts.isTemplateExpression(decl.initializer)) {
      const raw = decl.initializer.getText(sf);
      const body = raw.slice(1, -1);
      if (body.includes('\n')) return 'var-template-multiline';
      if (body.includes('\\')) return 'var-template-escapes';
      return null;
    }
    if (!isValidKernExpression(decl.initializer.getText(sf))) return 'var-bad-expr';
    return null;
  }
  if (ts.isReturnStatement(stmt)) {
    if (!stmt.expression) return null;
    // Template-literal return is migratable via `fmt return=true`. Same
    // single-line + no-backslash restriction as the binding-form path.
    if (ts.isNoSubstitutionTemplateLiteral(stmt.expression) || ts.isTemplateExpression(stmt.expression)) {
      const raw = stmt.expression.getText(sf);
      const body = raw.slice(1, -1);
      if (body.includes('\n')) return 'return-template-multiline';
      if (body.includes('\\')) return 'return-template-escapes';
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
    const thenReason = classifyBranch(stmt.thenStatement, sf, ctx);
    if (thenReason !== null) return thenReason;
    if (stmt.elseStatement) {
      // `else if (…)` is a nested IfStatement here. The migrator's mapIf
      // recurses for it, and the body emitters (TS + Python) collapse the
      // resulting `else > if` shape back to `else if` / `elif` (commit
      // 88c06dcc on dev). classifyBranch handles the nested IfStatement
      // by re-entering classifyStmt, so the recursion is automatic.
      const elseReason = classifyBranch(stmt.elseStatement, sf, ctx);
      if (elseReason !== null) return elseReason;
    }
    return null;
  }
  if (ts.isTryStatement(stmt)) {
    if (!stmt.catchClause) return 'try-no-catch';
    if (stmt.finallyBlock) return 'try-finally';
    const cc = stmt.catchClause;
    if (cc.variableDeclaration && !ts.isIdentifier(cc.variableDeclaration.name)) return 'try-destruct-catch';
    const tryReason = classifyBranch(stmt.tryBlock, sf, ctx);
    if (tryReason !== null) return tryReason;
    return classifyBranch(cc.block, sf, ctx);
  }
  if (ts.isExpressionStatement(stmt)) {
    // Slice α-1: ExpressionStatement → `do value="…"`. Plain `=` maps to
    // `assign`; compound assignment and ++/-- remain unsupported.
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
    if (ts.isPostfixUnaryExpression(stmt.expression) || ts.isPrefixUnaryExpression(stmt.expression)) {
      const op = (stmt.expression as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression).operator;
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
      const pairReason = classifyForOfPairBinding(decl.name);
      if (pairReason !== null) return pairReason;
      if (!stmt.awaitModifier) return 'for-of-sync-pair';
      if (decl.type) return 'for-of-destructure-type';
    } else if (decl.type && !isValidKernTypeAnnotation(decl.type.getText(sf))) {
      return 'for-of-bad-type';
    }
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'for-of-bad-expr';
    // Only block-shaped loops are currently migratable. `each` always emits
    // braces, so migrating `for (const x of xs) do(x);` would drift under
    // --verify even though it is semantically close.
    if (!ts.isBlock(stmt.statement)) return 'for-of-non-block';
    if (stmt.statement.statements.length === 0) return 'for-of-empty-body';
    return classifyBranch(stmt.statement, sf, { ...ctx, loopDepth: ctx.loopDepth + 1 });
  }
  if (ts.isWhileStatement(stmt)) {
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'while-bad-cond';
    if (!ts.isBlock(stmt.statement)) return 'while-non-block';
    if (stmt.statement.statements.length === 0) return 'while-empty-body';
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

function classifyForOfPairBinding(name: ts.BindingName): string | null {
  if (!ts.isArrayBindingPattern(name)) return 'for-of-destructure';
  if (name.elements.length !== 2) return 'for-of-destructure';
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) return 'for-of-destructure';
    if (element.dotDotDotToken || element.initializer) return 'for-of-destructure';
    if (!ts.isIdentifier(element.name)) return 'for-of-destructure';
  }
  // This maps only for `for await` loops. Sync pair-mode is ambiguous across
  // targets: TS can iterate any iterable of pairs, while Python pair-mode emits
  // mapping `.items()`. Hand-write `each pairKey=/pairValue=` when the source
  // is intentionally map/dict-shaped.
  return null;
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
export function classifyHandlerBodyAst(rawBody: string): AstEligibilityResult {
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
    const r = classifyStmt(stmt, sf, { loopDepth: 0 });
    if (r !== null) return { eligible: false, reason: r };
  }
  return { eligible: true, reason: 'ok' };
}
