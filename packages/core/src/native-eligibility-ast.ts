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
 *  `if-elseif-chain`, `expr-stmt-mutation`) so users running
 *  `kern migrate native-handlers` and `kern review` see actionable hints
 *  instead of a generic "ineligible". */

import ts from 'typescript';
import { parseExpression } from './parser-expression.js';

export interface AstEligibilityResult {
  eligible: boolean;
  /** When eligible: 'empty' | 'ok'.
   *  When ineligible: a short kebab-case slug naming the first blocking shape.
   *  Examples: 'comments-present', 'ts-parse-error', 'var-destructure',
   *  'var-non-const', 'if-elseif-chain', 'try-finally', 'for-stmt',
   *  'expr-stmt-mutation', 'return-bad-expr', 'unsupported-stmt-<Kind>'. */
  reason: string;
}

/** True when `exprText` parses cleanly under KERN's parser-expression. The
 *  multi-line guard catches body-statement attributes (`value="…"`) where
 *  raw newlines would break the line shape.
 *
 *  Exported so the migrator (`migrate-native-handlers.ts`) shares the
 *  same predicate the classifier uses — slice α-3 gemini review pulled
 *  the formerly duplicated helper into core to prevent the migrator's
 *  bail conditions from drifting away from the classifier's pass
 *  conditions. */
export function isValidKernExpression(exprText: string): boolean {
  if (/\n/.test(exprText)) return false;
  try {
    parseExpression(exprText);
    return true;
  } catch {
    return false;
  }
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

/** Classify a single statement. Returns null if the migrator can emit it,
 *  otherwise a kebab-case reason. Recurses through if/try branches. */
function classifyStmt(stmt: ts.Statement, sf: ts.SourceFile): string | null {
  if (ts.isVariableStatement(stmt)) {
    const flags = stmt.declarationList.flags;
    if (!(flags & ts.NodeFlags.Const)) return 'var-non-const';
    const decls = stmt.declarationList.declarations;
    if (decls.length !== 1) return 'var-multi-decl';
    const decl = decls[0];
    if (!ts.isIdentifier(decl.name)) return 'var-destructure';
    if (!decl.initializer) return 'var-no-init';
    if (decl.type) return 'var-typed';
    if (!isValidKernExpression(decl.initializer.getText(sf))) return 'var-bad-expr';
    return null;
  }
  if (ts.isReturnStatement(stmt)) {
    if (!stmt.expression) return null;
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'return-bad-expr';
    return null;
  }
  if (ts.isThrowStatement(stmt)) {
    if (!stmt.expression) return 'throw-no-expr';
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'throw-bad-expr';
    return null;
  }
  if (ts.isIfStatement(stmt)) {
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'if-bad-cond';
    const thenReason = classifyBranch(stmt.thenStatement, sf);
    if (thenReason !== null) return thenReason;
    if (stmt.elseStatement) {
      // Body emitter has no `elseif` — `else if` chains have to be hand-
      // unrolled. Mirror the migrator's mapIf bail.
      if (ts.isIfStatement(stmt.elseStatement)) return 'if-elseif-chain';
      const elseReason = classifyBranch(stmt.elseStatement, sf);
      if (elseReason !== null) return elseReason;
    }
    return null;
  }
  if (ts.isTryStatement(stmt)) {
    if (!stmt.catchClause) return 'try-no-catch';
    if (stmt.finallyBlock) return 'try-finally';
    const cc = stmt.catchClause;
    if (cc.variableDeclaration && !ts.isIdentifier(cc.variableDeclaration.name)) return 'try-destruct-catch';
    const tryReason = classifyBranch(stmt.tryBlock, sf);
    if (tryReason !== null) return tryReason;
    return classifyBranch(cc.block, sf);
  }
  if (ts.isExpressionStatement(stmt)) {
    // Slice α-1: ExpressionStatement → `do value="…"`. Reject mutation
    // (assignments, ++, --) here so the classifier matches what the migrator
    // emits — the migrator has the same defensive guards.
    if (ts.isBinaryExpression(stmt.expression)) {
      const op = stmt.expression.operatorToken.kind;
      if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) return 'expr-stmt-assignment';
    }
    if (ts.isPostfixUnaryExpression(stmt.expression) || ts.isPrefixUnaryExpression(stmt.expression)) {
      const op = (stmt.expression as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression).operator;
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) return 'expr-stmt-mutation';
    }
    if (!isValidKernExpression(stmt.expression.getText(sf))) return 'expr-stmt-bad-expr';
    return null;
  }
  if (ts.isForStatement(stmt) || ts.isForOfStatement(stmt) || ts.isForInStatement(stmt)) return 'for-stmt';
  if (ts.isWhileStatement(stmt) || ts.isDoStatement(stmt)) return 'while-do-stmt';
  if (ts.isSwitchStatement(stmt)) return 'switch-stmt';
  if (ts.isBlock(stmt)) return 'bare-block';
  // Fallback — the TS SyntaxKind name surfaces in diagnostics so users have
  // a starting point when they hit something exotic (label, with, debugger).
  return `unsupported-stmt-${ts.SyntaxKind[stmt.kind]}`;
}

function classifyBranch(node: ts.Statement, sf: ts.SourceFile): string | null {
  const stmts = ts.isBlock(node) ? Array.from(node.statements) : [node];
  for (const s of stmts) {
    const r = classifyStmt(s, sf);
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
  if (hasComments(rawBody)) return { eligible: false, reason: 'comments-present' };
  const sf = ts.createSourceFile('__handler.ts', rawBody, ts.ScriptTarget.Latest, true);
  // ts.SourceFile carries `parseDiagnostics` despite not exposing it on the
  // public type — the migrator reads it the same way.
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  if (diags && diags.length > 0) return { eligible: false, reason: 'ts-parse-error' };
  for (const stmt of sf.statements) {
    const r = classifyStmt(stmt, sf);
    if (r !== null) return { eligible: false, reason: r };
  }
  return { eligible: true, reason: 'ok' };
}
