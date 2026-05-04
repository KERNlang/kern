/**
 * `kern migrate native-handlers` — rewrite raw `<<<…>>>` handler bodies to
 * `lang="kern"` body-statement form.
 *
 * Input:  raw JS body in `<<<…>>>` that passes the slice 5a `classifyHandlerBody`
 *         eligibility check (no arrow functions, loops, mutation, destructuring,
 *         indexing, regex literals, console/process/req/res access, …).
 *
 * Output: `handler lang="kern"` with structured body-statement children
 *         (`let`/`return`/`if`/`else`/`try`/`catch`/`throw`). Slice 5b-pre
 *         shipped the parser surface so the output round-trips end-to-end.
 *
 * Anything outside the supported AST shape causes the whole handler to be
 * skipped — never half-migrated. Verify mode (`--verify`) is the safety net:
 * it pre-compiles, applies the migration, recompiles, and rolls back on any
 * codegen drift.
 */

import { classifyHandlerBody, escapeKernString, parseExpression } from '@kernlang/core';
import ts from 'typescript';

export interface NativeHandlerHit {
  headerLine: number; // 1-based
  literal: string; // first body line, for reporting parity with other migrations
  valueAttr: string; // short summary: e.g. `2 statements`
}

export interface NativeHandlerResult {
  hits: NativeHandlerHit[];
  output: string;
}

const INDENT_STEP = '  ';

interface HandlerBlock {
  /** 0-based line index of the `handler` header line. */
  startLine: number;
  /** 0-based line index of the closing `>>>` line. */
  endLine: number;
  /** Indent of the `handler` line (spaces). */
  headerIndent: string;
  /** Everything on the header line after `handler`, up to but not including `<<<`. */
  headerProps: string;
  /** Body interior (between `<<<` and `>>>`), dedented to column 0. */
  bodyText: string;
}

/**
 * Locate every multi-line `handler <<< … >>>` block in the source. Mirrors
 * the parser's multiline shape (parser-core.ts:463-520) — content after `<<<`
 * on the open line is dropped, only subsequent lines until `>>>` count.
 */
function findHandlerBlocks(lines: string[]): HandlerBlock[] {
  const blocks: HandlerBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Header MUST end with `<<<` (multi-line shape). Inline `handler <<< body >>>`
    // on a single line is also valid KERN but rare for migration candidates;
    // skipping it keeps the rewriter simple and reduces splice-edge risk.
    const m = lines[i].match(/^(\s*)handler\s*(.*?)\s*<<<\s*$/);
    if (!m) continue;
    const headerIndent = m[1];
    const headerProps = m[2];

    // Find matching `>>>`. Per parser-core.ts:476 the parser ONLY terminates
    // on lines whose trimmed content starts with `>>>` — `indexOf('>>>')`
    // would falsely terminate on a body line containing the literal `">>>"`
    // inside a string or regex. Mirror the parser's predicate exactly.
    let closeIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trimStart().startsWith('>>>')) {
        closeIdx = j;
        break;
      }
    }
    if (closeIdx === -1) continue;

    const bodyLines = lines.slice(i + 1, closeIdx);
    if (bodyLines.length === 0) continue;
    const bodyText = dedent(bodyLines);
    blocks.push({ startLine: i, endLine: closeIdx, headerIndent, headerProps, bodyText });
  }
  return blocks;
}

/** Strip the minimum leading indent from every non-empty line. */
function dedent(lines: string[]): string {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const leading = line.match(/^ */)?.[0].length ?? 0;
    if (leading < min) min = leading;
  }
  if (min === Infinity || min === 0) return lines.join('\n');
  return lines.map((l) => (l.trim() === '' ? '' : l.slice(min))).join('\n');
}

/**
 * Map a TS top-level statement to KERN body-source lines (with indent prefix
 * already applied). Returns null on any unsupported shape — caller bails on
 * the whole handler.
 */
function mapStatement(stmt: ts.Statement, source: ts.SourceFile, indent: string): string[] | null {
  if (ts.isVariableStatement(stmt)) {
    // Only `const` is byte-preserving — KERN body `let` lowers to TS `const`,
    // so migrating raw `let X = …` to body-statement `let` would silently
    // promote a mutable binding to a fresh `const`. Same for `var` (which
    // also has function-scoping semantics that body-`let` can't preserve).
    const flags = stmt.declarationList.flags;
    if (!(flags & ts.NodeFlags.Const)) return null;
    const decls = stmt.declarationList.declarations;
    if (decls.length !== 1) return null;
    const decl = decls[0];
    if (!ts.isIdentifier(decl.name)) return null; // bail on destructuring
    if (!decl.initializer) return null;
    if (decl.type) return null; // bail on type annotations (body-`let` ignores `type`)
    const name = decl.name.text;
    const exprText = decl.initializer.getText(source);
    if (!isValidKernExpression(exprText)) return null;
    return [`${indent}let name=${name} value="${escapeKernString(exprText)}"`];
  }

  if (ts.isReturnStatement(stmt)) {
    if (!stmt.expression) return [`${indent}return`];
    const exprText = stmt.expression.getText(source);
    if (!isValidKernExpression(exprText)) return null;
    return [`${indent}return value="${escapeKernString(exprText)}"`];
  }

  if (ts.isThrowStatement(stmt)) {
    if (!stmt.expression) return null;
    const exprText = stmt.expression.getText(source);
    if (!isValidKernExpression(exprText)) return null;
    return [`${indent}throw value="${escapeKernString(exprText)}"`];
  }

  if (ts.isIfStatement(stmt)) {
    return mapIf(stmt, source, indent);
  }

  if (ts.isTryStatement(stmt)) {
    return mapTry(stmt, source, indent);
  }

  if (ts.isExpressionStatement(stmt)) {
    // Bare expression statement (`reg.load(x);`, `arr.push(y);`) maps to the
    // `do value="…"` body-statement (slice α-1). Largest AST-rejection bucket
    // pre-α — see project_alpha_migrator_ast_plan.md.
    //
    // Reject assignments and prefix/postfix mutations explicitly — the slice 5a
    // regex classifier already rejects these structurally, but a defensive
    // check here keeps `do` from silently miscompiling if the classifier ever
    // loosens (e.g. `arr[i] = v` would parse as a BinaryExpression with `=`).
    //
    // Gemini review: cover ALL assignment operators, not just `=`. The classifier
    // regex `[+\-*/%]=` misses bitwise (`|=`, `&=`, `^=`, `<<=`, `>>=`, `>>>=`),
    // logical (`&&=`, `||=`, `??=`), and exponentiation (`**=`) assignments.
    // TS's FirstAssignment/LastAssignment range covers the full set.
    if (ts.isBinaryExpression(stmt.expression)) {
      const op = stmt.expression.operatorToken.kind;
      if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) return null;
    }
    if (ts.isPostfixUnaryExpression(stmt.expression) || ts.isPrefixUnaryExpression(stmt.expression)) {
      const op = (stmt.expression as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression).operator;
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) return null;
    }
    const exprText = stmt.expression.getText(source);
    if (!isValidKernExpression(exprText)) return null;
    return [`${indent}do value="${escapeKernString(exprText)}"`];
  }

  // Block, ForOf, while, switch, etc — no body-statement equivalent. Bail.
  return null;
}

function mapIf(stmt: ts.IfStatement, source: ts.SourceFile, indent: string): string[] | null {
  const condText = stmt.expression.getText(source);
  if (!isValidKernExpression(condText)) return null;
  const innerIndent = indent + INDENT_STEP;
  const out: string[] = [`${indent}if cond="${escapeKernString(condText)}"`];

  const thenLines = mapBranch(stmt.thenStatement, source, innerIndent);
  if (thenLines === null) return null;
  out.push(...thenLines);

  if (stmt.elseStatement) {
    if (ts.isIfStatement(stmt.elseStatement)) {
      // `else if (...)` — body emitter has no `elseif`; bail. (Future:
      // nest as `else` containing a body-statement `if`.)
      return null;
    }
    out.push(`${indent}else`);
    const elseLines = mapBranch(stmt.elseStatement, source, innerIndent);
    if (elseLines === null) return null;
    out.push(...elseLines);
  }
  return out;
}

function mapTry(stmt: ts.TryStatement, source: ts.SourceFile, indent: string): string[] | null {
  if (!stmt.catchClause) return null; // body-statement try requires catch
  if (stmt.finallyBlock) return null; // body emitter has no `finally`

  const innerIndent = indent + INDENT_STEP;
  const out: string[] = [`${indent}try`];

  const tryLines = mapBranch(stmt.tryBlock, source, innerIndent);
  if (tryLines === null) return null;
  out.push(...tryLines);

  const catchClause = stmt.catchClause;
  // Catch binding name (default `e`). Body emitter expects `name=E` prop.
  let errName = 'e';
  if (catchClause.variableDeclaration) {
    const v = catchClause.variableDeclaration;
    if (!ts.isIdentifier(v.name)) return null; // bail on destructured catch
    errName = v.name.text;
  }
  out.push(`${innerIndent}catch name=${errName}`);

  const catchLines = mapBranch(catchClause.block, source, innerIndent + INDENT_STEP);
  if (catchLines === null) return null;
  out.push(...catchLines);
  return out;
}

/** Branch can be a Block (`{ … }`) or a single statement. Walk uniformly. */
function mapBranch(node: ts.Statement, source: ts.SourceFile, indent: string): string[] | null {
  const stmts = ts.isBlock(node) ? Array.from(node.statements) : [node];
  const out: string[] = [];
  for (const s of stmts) {
    const lines = mapStatement(s, source, indent);
    if (lines === null) return null;
    out.push(...lines);
  }
  return out;
}

/** True when the body text contains line or block comments. Uses ts.Scanner
 *  for token-by-token coverage — the prior AST-walk approach missed comments
 *  inside block bodies (e.g. `if (c) { // missed }`) because `forEachChild`
 *  does not visit every comment trivia position. Bail-on-comments is the
 *  initial cut so silent comment loss can't happen. */
function hasComments(bodyText: string): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ false);
  scanner.setText(bodyText);
  while (true) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) return false;
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) return true;
  }
}

/** Validate that `exprText` (the right-hand side of a body-statement attr)
 *  is acceptable to KERN's expression parser. Codex review found that single-
 *  line TS expressions like ternaries pass the slice-5a classifier but fail
 *  KERN's parseExpression — emitting them blindly produces a `lang="kern"`
 *  handler that fails later at codegen. Multi-line expressions are also
 *  rejected here because escapeKernString does not escape newlines, so a
 *  raw newline inside `value="…"` would split the KERN line. */
function isValidKernExpression(exprText: string): boolean {
  if (/\n/.test(exprText)) return false;
  try {
    parseExpression(exprText);
    return true;
  } catch {
    return false;
  }
}

/** Append `lang="kern"` to a header-props string. Caller filters out
 *  handlers that already carry any `lang=` so we can append unconditionally. */
function ensureLangKern(headerProps: string): string {
  return headerProps.length === 0 ? 'lang="kern"' : `${headerProps} lang="kern"`;
}

export function rewriteNativeHandlers(source: string): NativeHandlerResult {
  const lines = source.split('\n');
  const hits: NativeHandlerHit[] = [];

  const blocks = findHandlerBlocks(lines);
  if (blocks.length === 0) return { hits: [], output: source };

  // Plan replacements first, then build output via cursor scan to keep indent
  // semantics stable.
  type Replacement = { startLine: number; endLine: number; lines: string[]; hit: NativeHandlerHit };
  const replacements: Replacement[] = [];

  for (const block of blocks) {
    // Skip handlers with ANY explicit `lang=…` — `lang="kern"` is already
    // migrated; `lang="ts"`/`lang="python"` are deliberately raw and the user
    // doesn't want them rewritten through KERN's native expression validator.
    if (/\blang=/.test(block.headerProps)) continue;
    if (block.bodyText.trim() === '') continue;

    const cls = classifyHandlerBody(block.bodyText);
    if (!cls.eligible) continue;

    if (hasComments(block.bodyText)) continue;

    const sourceFile = ts.createSourceFile('__handler.ts', block.bodyText, ts.ScriptTarget.Latest, true);

    // Bail on TS syntax errors (rare since classifier already vets).
    if ((sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics?.length) continue;

    const bodyIndent = block.headerIndent + INDENT_STEP;
    const stmtLines: string[] = [];
    let bailed = false;
    for (const stmt of sourceFile.statements) {
      const mapped = mapStatement(stmt, sourceFile, bodyIndent);
      if (mapped === null) {
        bailed = true;
        break;
      }
      stmtLines.push(...mapped);
    }
    if (bailed || stmtLines.length === 0) continue;

    const newHeader = `${block.headerIndent}handler ${ensureLangKern(block.headerProps)}`.replace(/\s+$/, '');
    const replacementLines = [newHeader, ...stmtLines];
    replacements.push({
      startLine: block.startLine,
      endLine: block.endLine,
      lines: replacementLines,
      hit: {
        headerLine: block.startLine + 1,
        // Trim the whole body before splitting so a leading blank line
        // doesn't produce an empty `literal` in the migration report.
        literal: block.bodyText.trim().split('\n')[0],
        valueAttr: `${sourceFile.statements.length} statement${sourceFile.statements.length === 1 ? '' : 's'}`,
      },
    });
  }

  if (replacements.length === 0) return { hits: [], output: source };

  // Splice output via cursor — process in source order.
  const out: string[] = [];
  let cursor = 0;
  for (const r of replacements) {
    while (cursor < r.startLine) {
      out.push(lines[cursor]);
      cursor++;
    }
    out.push(...r.lines);
    cursor = r.endLine + 1;
    hits.push(r.hit);
  }
  while (cursor < lines.length) {
    out.push(lines[cursor]);
    cursor++;
  }

  return { hits, output: out.join('\n') };
}
