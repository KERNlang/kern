/**
 * `kern migrate native-handlers` — rewrite raw `<<<…>>>` handler bodies to
 * inferred-KERN body-statement form.
 *
 * Input:  raw JS body in `<<<…>>>` that passes the slice 5a `classifyHandlerBody`
 *         eligibility check (no arrow functions, unsupported loops, unsafe mutation,
 *         regex literals, console/process/req/res access, …).
 *
 * Output: `handler` with structured body-statement children
 *         (`let`/`return`/`if`/`else`/`try`/`catch`/`throw`). The parser
 *         infers `lang="kern"` for this shape, so the migration no longer
 *         emits explicit opt-in boilerplate.
 *
 * Anything outside the supported AST shape causes the whole handler to be
 * skipped — never half-migrated. Verify mode (`--verify`) is the safety net:
 * it pre-compiles, applies the migration, recompiles, and rolls back on any
 * codegen drift.
 */

import {
  canonicalKernExpression,
  canonicalObjectEntriesSource,
  classifyHandlerBody,
  escapeKernString,
  hasOnlyMigratableComments,
  hasTsOnlyTemplateEscape,
  isValidKernAssignmentTarget,
  isValidKernAssignmentValue,
  isValidKernTypeAnnotation,
  supportedCompoundAssignmentOperator,
} from '@kernlang/core/node';
import ts from 'typescript';

export interface NativeHandlerHit {
  headerLine: number; // 1-based, header line of the `handler` keyword
  endLine: number; // 1-based, line of the closing `>>>` (source line range of the original block)
  literal: string; // first body line, for reporting parity with other migrations
  valueAttr: string; // short summary: e.g. `2 statements`
}

/** Eligible handler that the rewriter declined to migrate, with the reason
 *  the author can act on. Surfaced via `--check-equivalent` so authors see
 *  why a handler stayed in raw form instead of silently being left behind. */
export interface NativeHandlerSkip {
  headerLine: number; // 1-based header line
  endLine: number; // 1-based closing `>>>` line
  reason: string; // human-readable cause
}

export interface NativeHandlerResult {
  hits: NativeHandlerHit[];
  skipped: NativeHandlerSkip[];
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

interface MapContext {
  loopDepth: number;
  /** Set by mapStatementCore when it bails on an unsupported TS shape. The
   *  caller surfaces this in NativeHandlerSkip so authors can see the
   *  precise statement kind that blocked migration. Reset per-handler. */
  skipReason?: string;
  /** W2 — when true, non-block control-flow bodies (`if (c) stmt;`) are
   *  migrated to a braced native-KERN form. Only set under the opt-in
   *  `--canonicalize-braces` flag, which forces the brace-canonicalizing
   *  `--verify` so the brace-only re-emission is checked. */
  allowNonBlock?: boolean;
}

function recordSkip(ctx: MapContext, reason: string): null {
  if (!ctx.skipReason) ctx.skipReason = reason;
  return null;
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
function mapStatement(stmt: ts.Statement, source: ts.SourceFile, indent: string, ctx: MapContext): string[] | null {
  const mapped = mapStatementCore(stmt, source, indent, ctx);
  if (mapped === null) {
    // Most mapStatementCore bailouts don't yet carry a precise reason —
    // fall back to the TS SyntaxKind name so the report says "skipped:
    // unsupported TS shape SwitchStatement" instead of "unsupported".
    // Specific bail sites (compound-assign, prefix/postfix ++/--, missing
    // initializers, etc.) record a more useful reason via recordSkip first.
    if (!ctx.skipReason) {
      ctx.skipReason = `unsupported TS shape: ${ts.SyntaxKind[stmt.kind]}`;
    }
    return null;
  }
  // W1 — capture an inline same-line trailing comment and re-attach it via the
  // `trailingComment=` slot on the single emitted body-stmt line. Only simple
  // (single-line) statements qualify; compound statements emit multiple lines
  // and leave the comment for the eligibility gate to reject.
  if (mapped.length === 1) {
    const trailing = trailingCommentRaw(stmt, source);
    if (trailing !== null) mapped[0] = `${mapped[0]} trailingComment="${escapeKernString(trailing)}"`;
  }
  return [...mapLeadingComments(stmt, source, indent), ...mapped];
}

/** A single same-line trailing comment after a simple statement
 *  (`return x; // note`). `ts.getTrailingCommentRanges` returns only comments
 *  up to the next line break, so these are same-line by construction. Returns
 *  null for none, more than one (rare; trips eligibility), or a newline-
 *  spanning block comment (can't be an inline slot). Must stay in lockstep
 *  with the `hasOnlyMigratableComments` trailing predicate in core. */
function trailingCommentRaw(stmt: ts.Statement, source: ts.SourceFile): string | null {
  const ranges = ts.getTrailingCommentRanges(source.text, stmt.getEnd());
  if (ranges?.length !== 1) return null;
  const raw = source.text.slice(ranges[0].pos, ranges[0].end);
  if (raw.includes('\n')) return null;
  return raw;
}

function mapLeadingComments(stmt: ts.Statement, source: ts.SourceFile, indent: string): string[] {
  return (ts.getLeadingCommentRanges(source.text, stmt.getFullStart()) ?? [])
    .filter((range) => isStandaloneCommentRange(source.text, range))
    .flatMap((range) => {
      const raw = source.text.slice(range.pos, range.end).trim();
      return mapComment(raw, indent);
    });
}

/** Tail comments — comments positioned in `[startPos, endPos)` that are
 *  past the same-line "trailing" window of the previous statement. Used in
 *  two places: tail-of-body (`startPos = lastStmt.getEnd()`, `endPos = ∞`)
 *  and tail-of-nested-block (`startPos = lastBlockStmt.getEnd()`,
 *  `endPos = block.getEnd()`). The same-line trailing window is already
 *  emitted by `mapTrailingComments`, so we skip everything until the
 *  first newline. The body emitter accepts `comment` body-stmts at any
 *  position. */
function mapTailComments(startPos: number, endPos: number, source: ts.SourceFile, indent: string): string[] {
  if (startPos >= endPos) return [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ false);
  scanner.setText(source.text);
  scanner.setTextPos(startPos);
  let sawNewline = false;
  const tailRanges: ts.CommentRange[] = [];
  while (true) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    if (scanner.getTokenPos() >= endPos) break;
    if (kind === ts.SyntaxKind.NewLineTrivia) {
      sawNewline = true;
      continue;
    }
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      if (sawNewline) {
        tailRanges.push({ pos: scanner.getTokenPos(), end: scanner.getTextPos(), kind, hasTrailingNewLine: false });
      }
      continue;
    }
    if (kind === ts.SyntaxKind.WhitespaceTrivia) continue;
    // Non-trivia inside the tail window means we've crossed into the next
    // construct — stop. Same-line trailing comments are not our concern
    // here (mapTrailingComments handles them).
    break;
  }
  return tailRanges.flatMap((range) => {
    const raw = source.text.slice(range.pos, range.end).trim();
    return mapComment(raw, indent);
  });
}

function mapComment(raw: string, indent: string): string[] {
  if (raw.startsWith('/*') && raw.endsWith('*/') && raw.includes('\n')) {
    return raw
      .slice(2, -2)
      .trim()
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
      .map((line) => `${indent}comment text="${escapeKernString(line)}"`);
  }
  return [`${indent}comment raw="${escapeKernString(raw)}"`];
}

function isStandaloneCommentRange(text: string, range: ts.CommentRange): boolean {
  const beforeLineStart = text.lastIndexOf('\n', Math.max(0, range.pos - 1)) + 1;
  const afterLineEndIndex = text.indexOf('\n', range.end);
  const afterLineEnd = afterLineEndIndex === -1 ? text.length : afterLineEndIndex;
  const before = text.slice(beforeLineStart, range.pos);
  const after = text.slice(range.end, afterLineEnd);
  return before.trim() === '' && after.trim() === '';
}

function mapStatementCore(stmt: ts.Statement, source: ts.SourceFile, indent: string, ctx: MapContext): string[] | null {
  if (ts.isVariableStatement(stmt)) {
    // `const` is the default KERN body binding. TS `let` is now preserved as
    // `let kind=let`; `var` remains unsupported because function scoping
    // cannot be represented by native body bindings.
    const flags = stmt.declarationList.flags;
    const isConst = (flags & ts.NodeFlags.Const) !== 0;
    const isLet = (flags & ts.NodeFlags.Let) !== 0;
    if (!isConst && !isLet)
      return recordSkip(
        ctx,
        '`var` declarations are not supported (function-scoped binding has no native body equivalent)',
      );
    const decls = stmt.declarationList.declarations;
    if (decls.length !== 1)
      return recordSkip(
        ctx,
        'multi-declarator declaration (`const a = …, b = …`) not supported — split into separate statements',
      );
    const decl = decls[0];
    const typeText = decl.type?.getText(source);
    if (typeText && !isValidKernTypeAnnotation(typeText)) return null;
    if (!decl.initializer) {
      // `let x;` (always `let` — `const x;` is a TS parse error so it never
      // reaches this branch). The native KERN body emitter handles a `let`
      // node with no `value=` by emitting `let x = undefined;`, matching TS
      // semantics. Always tag `kind=let` since uninitialised TS bindings are
      // mutable by definition.
      if (!ts.isIdentifier(decl.name))
        return recordSkip(ctx, 'destructuring without initializer not supported (`let { x };` is malformed)');
      const undeclared = decl.name.text;
      const typeAttr = typeText ? ` type="${escapeKernString(typeText)}"` : '';
      return [`${indent}let name=${undeclared}${typeAttr} kind=let`];
    }
    if (!ts.isIdentifier(decl.name)) return mapDestructureDecl(decl, source, indent, typeText, isLet ? 'let' : 'const');
    const name = decl.name.text;
    // Template-literal initializer → emit `fmt name=X template="..."` body-stmt.
    // The `template=` attribute body is the raw TS template-literal source
    // verbatim — backslash escape sequences (`\n`, `\t`, `\xNN`, `\\`,
    // `` \` ``, `\${`) round-trip byte-cleanly through KERN-attr escaping and
    // the `fmt` codegen (commit "close template-escapes gap"; emitFmtTemplate
    // no longer re-escapes backslashes). Multi-line templates still fall
    // through to the value-form because KERN attributes can't carry raw
    // newlines, and the ES6 code-point escape `\u{NNNN}` falls through
    // because Python f-strings only accept `\uNNNN`/`\UNNNNNNNN`.
    if (ts.isNoSubstitutionTemplateLiteral(decl.initializer) || ts.isTemplateExpression(decl.initializer)) {
      const raw = decl.initializer.getText(source);
      const body = raw.slice(1, -1);
      if (!body.includes('\n') && !hasTsOnlyTemplateEscape(body)) {
        const typeAttr = typeText ? ` type="${escapeKernString(typeText)}"` : '';
        const kindAttr = isLet ? ' kind=let' : '';
        return [`${indent}fmt name=${name}${typeAttr}${kindAttr} template="${escapeKernString(body)}"`];
      }
    }
    const exprText = decl.initializer.getText(source);
    const canonical = canonicalKernExpression(exprText);
    if (canonical === null) return null;
    const typeAttr = typeText ? ` type="${escapeKernString(typeText)}"` : '';
    const kindAttr = isLet ? ' kind=let' : '';
    return [`${indent}let name=${name}${typeAttr}${kindAttr} value="${escapeKernString(canonical)}"`];
  }

  if (ts.isReturnStatement(stmt)) {
    if (!stmt.expression) return [`${indent}return`];
    // Template-literal return → `fmt return=true template="..."` body-stmt.
    // Backslash-escape policy: same as the binding-form path above.
    if (ts.isNoSubstitutionTemplateLiteral(stmt.expression) || ts.isTemplateExpression(stmt.expression)) {
      const raw = stmt.expression.getText(source);
      const body = raw.slice(1, -1);
      if (!body.includes('\n') && !hasTsOnlyTemplateEscape(body)) {
        return [`${indent}fmt return=true template="${escapeKernString(body)}"`];
      }
    }
    const exprText = stmt.expression.getText(source);
    const canonical = canonicalKernExpression(exprText);
    if (canonical === null) return null;
    return [`${indent}return value="${escapeKernString(canonical)}"`];
  }

  if (ts.isThrowStatement(stmt)) {
    if (!stmt.expression) return null;
    const exprText = stmt.expression.getText(source);
    const canonical = canonicalKernExpression(exprText);
    if (canonical === null) return null;
    return [`${indent}throw value="${escapeKernString(canonical)}"`];
  }

  if (ts.isBreakStatement(stmt)) {
    if (stmt.label || ctx.loopDepth <= 0) return null;
    return [`${indent}break`];
  }

  if (ts.isContinueStatement(stmt)) {
    if (stmt.label || ctx.loopDepth <= 0) return null;
    return [`${indent}continue`];
  }

  if (ts.isIfStatement(stmt)) {
    return mapIf(stmt, source, indent, ctx);
  }

  if (ts.isTryStatement(stmt)) {
    return mapTry(stmt, source, indent, ctx);
  }

  if (ts.isForOfStatement(stmt)) {
    return mapForOf(stmt, source, indent, ctx);
  }

  if (ts.isWhileStatement(stmt)) {
    return mapWhile(stmt, source, indent, ctx);
  }

  if (ts.isExpressionStatement(stmt)) {
    // Bare expression statement (`reg.load(x);`, `arr.push(y);`) maps to the
    // `do value="…"` body-statement (slice α-1). Largest AST-rejection bucket
    // pre-α — see project_alpha_migrator_ast_plan.md.
    //
    // Plain `=` assignment maps to the structured `assign` body-statement.
    // Cross-target-safe compound assignment maps to `assign op=...`.
    // Postfix `X++;` / `X--;` maps to the value-less form `assign target=X
    // op="++"` / `op="--"` so codegen re-emits `X++;` and `--verify` sees
    // byte-equivalent output. Prefix `++X` remains unsupported (no IR shape
    // that round-trips back to `++X` rather than `X++`).
    //
    // TS's FirstAssignment/LastAssignment range covers the full assignment
    // family. We then admit only the cross-target-safe subset; JS-only
    // `>>>=`, `&&=`, `||=`, and `??=` deliberately stay foreign/raw.
    if (ts.isBinaryExpression(stmt.expression)) {
      const op = stmt.expression.operatorToken.kind;
      if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) {
        const opText = op === ts.SyntaxKind.EqualsToken ? '=' : supportedCompoundAssignmentOperator(op);
        if (!opText) return null;
        const targetText = stmt.expression.left.getText(source);
        const valueText = stmt.expression.right.getText(source);
        if (!isValidKernAssignmentTarget(targetText)) return null;
        if (!isValidKernAssignmentValue(valueText)) return null;
        const canonicalTarget = canonicalKernExpression(targetText);
        const canonicalValue = canonicalKernExpression(valueText);
        if (canonicalTarget === null || canonicalValue === null) return null;
        const opAttr = opText === '=' ? '' : ` op="${escapeKernString(opText)}"`;
        return [
          `${indent}assign target="${escapeKernString(canonicalTarget)}"${opAttr} value="${escapeKernString(canonicalValue)}"`,
        ];
      }
    }
    if (ts.isPostfixUnaryExpression(stmt.expression)) {
      const op = stmt.expression.operator;
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
        // Postfix `X++;` → `assign target=X op="++"` (value-less). Classifier
        // gates this on `isValidKernAssignmentTarget`, so we mirror the same
        // check here; on mismatch we fall through to recordSkip via the bad-
        // target path. Keeps the slice α-3 "eligible ≡ migrates" invariant.
        const targetText = stmt.expression.operand.getText(source);
        if (!isValidKernAssignmentTarget(targetText)) return null;
        const canonicalTarget = canonicalKernExpression(targetText);
        if (canonicalTarget === null) return null;
        const opText = op === ts.SyntaxKind.PlusPlusToken ? '++' : '--';
        return [`${indent}assign target="${escapeKernString(canonicalTarget)}" op="${opText}"`];
      }
    }
    if (ts.isPrefixUnaryExpression(stmt.expression)) {
      const op = stmt.expression.operator;
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
        // Prefix `++X;` is rejected: byte-equivalent re-emission would require
        // a distinct IR shape we deliberately don't model (see classifier).
        return recordSkip(
          ctx,
          'prefix `++`/`--` not supported — rewrite as postfix `X++;` or `assign target=x op="+=" value="1"`',
        );
      }
    }
    const exprText = stmt.expression.getText(source);
    const canonical = canonicalKernExpression(exprText);
    if (canonical === null) return null;
    return [`${indent}do value="${escapeKernString(canonical)}"`];
  }

  // Block, unsupported loop shapes, switch, etc — no body-statement equivalent. Bail.
  return null;
}

function mapIf(stmt: ts.IfStatement, source: ts.SourceFile, indent: string, ctx: MapContext): string[] | null {
  const condText = stmt.expression.getText(source);
  const canonical = canonicalKernExpression(condText);
  if (canonical === null) return null;
  // Classifier rejects non-block then/else (`if-non-block-then` / `-else`)
  // to preserve byte-equivalence: body emitters always wrap in braces, so a
  // raw `if (cond) stmt;` would re-emit as `if (cond) { stmt; }`. Mirror the
  // check here as defense-in-depth so direct migrator entry points stay
  // safe even if the classifier is bypassed.
  if (!ctx.allowNonBlock && !ts.isBlock(stmt.thenStatement)) return null;
  const innerIndent = indent + INDENT_STEP;
  const out: string[] = [`${indent}if cond="${escapeKernString(canonical)}"`];

  const thenLines = mapBranch(stmt.thenStatement, source, innerIndent, ctx);
  if (thenLines === null) return null;
  out.push(...thenLines);

  if (stmt.elseStatement) {
    out.push(`${indent}else`);
    if (ts.isIfStatement(stmt.elseStatement)) {
      // `else if (…)` nests as `else > if(…)` (with optional inner else).
      // The TS+Python body emitters detect this shape and emit `else if`/
      // `elif` directly, so the migration is byte-equivalent to the raw
      // `else if` chain that --verify diffs against.
      const nested = mapIf(stmt.elseStatement, source, innerIndent, ctx);
      if (nested === null) return null;
      out.push(...nested);
    } else {
      if (!ctx.allowNonBlock && !ts.isBlock(stmt.elseStatement)) return null;
      const elseLines = mapBranch(stmt.elseStatement, source, innerIndent, ctx);
      if (elseLines === null) return null;
      out.push(...elseLines);
    }
  }
  return out;
}

function mapTry(stmt: ts.TryStatement, source: ts.SourceFile, indent: string, ctx: MapContext): string[] | null {
  // KERN-GAPS `try-no-catch` + `try-finally`: emit `catch`/`finally` as
  // schema-compliant `try` children. Both codegens (TS body-ts.ts:286 /
  // Python codegen-body-python.ts:316) support finally-only and
  // catch+finally; the schema's `try.allowedChildren` includes both. At
  // least one of catch/finally must be present.
  if (!stmt.catchClause && !stmt.finallyBlock) return null;

  const innerIndent = indent + INDENT_STEP;
  const out: string[] = [`${indent}try`];

  const tryLines = mapBranch(stmt.tryBlock, source, innerIndent, ctx);
  if (tryLines === null) return null;
  out.push(...tryLines);

  if (stmt.catchClause) {
    const catchClause = stmt.catchClause;
    // Catch binding name (default `e`). Body emitter expects `name=E` prop.
    let errName = 'e';
    let errType: 'any' | 'unknown' | null = null;
    if (catchClause.variableDeclaration) {
      const v = catchClause.variableDeclaration;
      if (!ts.isIdentifier(v.name)) return null; // bail on destructured catch
      errName = v.name.text;
      // Preserve `catch (err: any|unknown)` annotation — TS strict mode
      // narrows untyped `err` to `unknown`, which can break member access
      // that worked before migration. Body emitter at body-ts.ts:272-282
      // already supports `type=` on `catch` (only `any`/`unknown` are valid
      // TS catch-parameter types; reject anything else so we don't emit
      // invalid TS). (Codex impl-review P2 fix.)
      if (v.type) {
        const tText = v.type.getText(source).trim();
        if (tText !== 'any' && tText !== 'unknown') return null;
        errType = tText;
      }
    }
    out.push(errType ? `${innerIndent}catch name=${errName} type=${errType}` : `${innerIndent}catch name=${errName}`);

    const catchLines = mapBranch(catchClause.block, source, innerIndent + INDENT_STEP, ctx);
    if (catchLines === null) return null;
    out.push(...catchLines);
  }

  if (stmt.finallyBlock) {
    out.push(`${innerIndent}finally`);
    const finallyLines = mapBranch(stmt.finallyBlock, source, innerIndent + INDENT_STEP, ctx);
    if (finallyLines === null) return null;
    out.push(...finallyLines);
  }

  return out;
}

function mapDestructureDecl(
  decl: ts.VariableDeclaration,
  source: ts.SourceFile,
  indent: string,
  typeText?: string,
  kind: 'const' | 'let' = 'const',
): string[] | null {
  if (!decl.initializer) return null;
  const sourceText = decl.initializer.getText(source);
  const canonicalSource = canonicalKernExpression(sourceText);
  if (canonicalSource === null) return null;
  const typeAttr = typeText ? ` type="${escapeKernString(typeText)}"` : '';
  const out: string[] = [`${indent}destructure kind=${kind}${typeAttr} source="${escapeKernString(canonicalSource)}"`];
  const name = decl.name;

  if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      if (element.dotDotDotToken || element.initializer) return null;
      if (!ts.isIdentifier(element.name)) return null;
      if (element.propertyName && !ts.isIdentifier(element.propertyName)) return null;
      const localName = element.name.text;
      const keyName = element.propertyName?.text;
      out.push(
        keyName
          ? `${indent}${INDENT_STEP}binding name=${localName} key=${keyName}`
          : `${indent}${INDENT_STEP}binding name=${localName}`,
      );
    }
    return out.length > 1 ? out : null;
  }

  if (ts.isArrayBindingPattern(name)) {
    for (let i = 0; i < name.elements.length; i++) {
      const element = name.elements[i];
      if (ts.isOmittedExpression(element)) continue;
      if (element.dotDotDotToken || element.initializer) return null;
      if (!ts.isIdentifier(element.name)) return null;
      out.push(`${indent}${INDENT_STEP}element name=${element.name.text} index=${i}`);
    }
    return out.length > 1 ? out : null;
  }

  return null;
}

function mapForOf(stmt: ts.ForOfStatement, source: ts.SourceFile, indent: string, ctx: MapContext): string[] | null {
  if (!ts.isVariableDeclarationList(stmt.initializer)) return null;
  const flags = stmt.initializer.flags;
  if (!(flags & ts.NodeFlags.Const)) return null;
  const decls = stmt.initializer.declarations;
  if (decls.length !== 1) return null;
  const decl = decls[0];
  if (decl.initializer) return null;
  const typeText = decl.type?.getText(source);
  if (!ctx.allowNonBlock && !ts.isBlock(stmt.statement)) return null;
  if (ts.isBlock(stmt.statement) && stmt.statement.statements.length === 0) return null;

  const innerIndent = indent + INDENT_STEP;
  const awaitAttr = stmt.awaitModifier ? ' await=true' : '';
  const entryBinding = parseForOfEntryBinding(decl.name);
  let out: string[];
  if (entryBinding?.kind === 'pair') {
    if (typeText) return null;
    const entriesSource = canonicalObjectEntriesSource(stmt.expression, source);
    if (stmt.awaitModifier && entriesSource !== null) return null;
    if (stmt.awaitModifier) {
      const canonicalCollection = canonicalKernExpression(stmt.expression.getText(source));
      if (canonicalCollection === null) return null;
      out = [
        `${indent}each pairKey=${entryBinding.key} pairValue=${entryBinding.value} in="${escapeKernString(canonicalCollection)}"${awaitAttr}`,
      ];
    } else if (entriesSource !== null) {
      // `for (const [k, v] of Object.entries(obj))` → `entries=true` form.
      // Python lowers to `for k, v in obj.items():`; TS to
      // `for (const [k, v] of Object.entries(obj))`. Byte-clean both ways.
      out = [
        `${indent}each pairKey=${entryBinding.key} pairValue=${entryBinding.value} in="${escapeKernString(entriesSource)}" entries=true`,
      ];
    } else {
      // KERN-GAPS `for-of-sync-pair`: arbitrary sync iterables of pairs
      // (Map.entries(), arrays-of-pairs, generators yielding `[k,v]`) lift
      // to `each pairKey=k pairValue=v in=expr` (no `entries=true`). TS
      // codegen emits `for (const [k, v] of expr) { … }` — byte-equivalent
      // to the original raw source. Python cross-target note: `each
      // pairKey/pairValue` without `entries=true` lowers to
      // `for k, v in expr.items():`, which is appropriate for dict-like
      // values but not for JS `Map` instances — that's an authoring concern
      // for cross-target portability, not a migration parity violation.
      const canonicalCollection = canonicalKernExpression(stmt.expression.getText(source));
      if (canonicalCollection === null) return null;
      out = [
        `${indent}each pairKey=${entryBinding.key} pairValue=${entryBinding.value} in="${escapeKernString(canonicalCollection)}"`,
      ];
    }
  } else if (entryBinding?.kind === 'key' || entryBinding?.kind === 'value') {
    if (typeText || stmt.awaitModifier) return null;
    const entriesSource = canonicalObjectEntriesSource(stmt.expression, source);
    if (entriesSource === null) return null;
    const prop = entryBinding.kind === 'key' ? `entryKey=${entryBinding.name}` : `entryValue=${entryBinding.name}`;
    out = [`${indent}each ${prop} in="${escapeKernString(entriesSource)}" entries=true`];
  } else {
    if (!ts.isIdentifier(decl.name)) return null;
    if (typeText && !isValidKernTypeAnnotation(typeText)) return null;
    const canonicalCollection = canonicalKernExpression(stmt.expression.getText(source));
    if (canonicalCollection === null) return null;
    const typeAttr = typeText ? ` type="${escapeKernString(typeText)}"` : '';
    out = [`${indent}each name=${decl.name.text} in="${escapeKernString(canonicalCollection)}"${typeAttr}${awaitAttr}`];
  }
  const bodyLines = mapBranch(stmt.statement, source, innerIndent, { ...ctx, loopDepth: ctx.loopDepth + 1 });
  if (bodyLines === null) return null;
  out.push(...bodyLines);
  return out;
}

function parseForOfEntryBinding(
  name: ts.BindingName,
): { kind: 'pair'; key: string; value: string } | { kind: 'key' | 'value'; name: string } | null {
  if (!ts.isArrayBindingPattern(name)) return null;
  if (name.elements.length === 1) {
    const [element] = name.elements;
    if (ts.isOmittedExpression(element)) return null;
    if (element.dotDotDotToken || element.initializer) return null;
    if (!ts.isIdentifier(element.name)) return null;
    return { kind: 'key', name: element.name.text };
  }
  if (name.elements.length !== 2) return null;
  const [keyEl, valueEl] = name.elements;
  if (!ts.isOmittedExpression(keyEl)) {
    if (keyEl.dotDotDotToken || keyEl.initializer) return null;
    if (!ts.isIdentifier(keyEl.name)) return null;
  }
  if (ts.isOmittedExpression(valueEl)) return null;
  if (valueEl.dotDotDotToken || valueEl.initializer) return null;
  if (!ts.isIdentifier(valueEl.name)) return null;
  if (ts.isOmittedExpression(keyEl)) return { kind: 'value', name: valueEl.name.text };
  const keyName = keyEl.name;
  if (!ts.isIdentifier(keyName)) return null;
  return { kind: 'pair', key: keyName.text, value: valueEl.name.text };
}

function mapWhile(stmt: ts.WhileStatement, source: ts.SourceFile, indent: string, ctx: MapContext): string[] | null {
  const condText = stmt.expression.getText(source);
  const canonical = canonicalKernExpression(condText);
  if (canonical === null) return null;
  if (!ctx.allowNonBlock && !ts.isBlock(stmt.statement)) return null;
  if (ts.isBlock(stmt.statement) && stmt.statement.statements.length === 0) return null;

  const innerIndent = indent + INDENT_STEP;
  const out: string[] = [`${indent}while cond="${escapeKernString(canonical)}"`];
  const bodyLines = mapBranch(stmt.statement, source, innerIndent, { ...ctx, loopDepth: ctx.loopDepth + 1 });
  if (bodyLines === null) return null;
  out.push(...bodyLines);
  return out;
}

/** Branch can be a Block (`{ … }`) or a single statement. Walk uniformly. */
function mapBranch(node: ts.Statement, source: ts.SourceFile, indent: string, ctx: MapContext): string[] | null {
  const stmts = ts.isBlock(node) ? Array.from(node.statements) : [node];
  const out: string[] = [];
  for (const s of stmts) {
    const lines = mapStatement(s, source, indent, ctx);
    if (lines === null) return null;
    out.push(...lines);
  }
  // KERN-GAPS `comments-present` lift — preserve tail-of-block comments
  // (`if (x) { foo(); /* tail */ }`). For non-block single-stmt bodies
  // there's no block container, so no tail window exists.
  if (ts.isBlock(node) && stmts.length > 0) {
    out.push(...mapTailComments(stmts[stmts.length - 1].getEnd(), node.getEnd(), source, indent));
  }
  return out;
}

// Slice α-3 (gemini review): comment and expression predicates were
// previously duplicated here and in `packages/core/src/native-eligibility-ast.ts`.
// The classifier needs the same predicates the migrator uses to keep the
// "eligibility ≡ migrate-success" invariant tight, so the canonical
// implementations now live in core and both sides import them.

/** Statement node types that prove a migrated body actually does work
 *  (not just declarations or comments). Used to refuse "declaration-only"
 *  migrations that would silently strip behaviour.
 *
 *  `let`, `destructure`, and the binding-form `fmt name=X template=…` are
 *  deliberately NOT on this list: they are all pure value-binding shapes
 *  (TS `const X = …` / `const {a} = …` / `` const X = `…` ``). A body
 *  that consists entirely of those plus comments is what gemini flagged
 *  in code review as the malformed shape that produced suspicious output
 *  in Agon-AI — refuse the rewrite and force a manual audit instead.
 *
 *  `fmt return=true template=…` is the action-bearing variant (lowers to
 *  TS `return \`…\`;`) and IS counted — see `isActionBearingLine`. */
const ACTION_BEARING_KIND = /^(?:return|throw|do|assign|if|while|for|each|try|break|continue|branch)$/;

function isActionBearingLine(line: string): boolean {
  // Mirror the parser's keyword recognition — first non-whitespace token of
  // the line is the node type. The rewriter never embeds these keywords
  // inside attribute values.
  const trimmed = line.trimStart();
  const head = trimmed.match(/^([a-z]+)/);
  if (!head) return false;
  if (ACTION_BEARING_KIND.test(head[1])) return true;
  // `fmt return=true template=…` is action-bearing (TS `return \`…\`;`);
  // the binding form `fmt name=X template=…` is not. Distinguish them by
  // scanning the attributes on this line.
  if (head[1] === 'fmt' && /\breturn=true\b/.test(trimmed)) return true;
  return false;
}

export function rewriteNativeHandlers(source: string, opts?: { canonicalizeBraces?: boolean }): NativeHandlerResult {
  const lines = source.split('\n');
  const hits: NativeHandlerHit[] = [];
  const skipped: NativeHandlerSkip[] = [];

  const blocks = findHandlerBlocks(lines);
  if (blocks.length === 0) return { hits: [], skipped: [], output: source };

  // Plan replacements first, then build output via cursor scan to keep indent
  // semantics stable.
  type Replacement = { startLine: number; endLine: number; lines: string[]; hit: NativeHandlerHit };
  const replacements: Replacement[] = [];

  for (const block of blocks) {
    const headerLine1 = block.startLine + 1;
    const endLine1 = block.endLine + 1;
    // Skip handlers with ANY explicit `lang=…` — `lang="kern"` is already
    // migrated; `lang="ts"`/`lang="python"` are deliberately raw and the user
    // doesn't want them rewritten through KERN's native expression validator.
    if (/\blang=/.test(block.headerProps)) continue;
    if (block.bodyText.trim() === '') continue;

    const cls = classifyHandlerBody(block.bodyText, { allowNonBlock: opts?.canonicalizeBraces });
    if (!cls.eligible) {
      skipped.push({ headerLine: headerLine1, endLine: endLine1, reason: `not eligible: ${cls.reason}` });
      continue;
    }

    if (!hasOnlyMigratableComments(block.bodyText)) {
      skipped.push({
        headerLine: headerLine1,
        endLine: endLine1,
        reason: 'comments in non-migratable position (between statements that would shift meaning if lifted out)',
      });
      continue;
    }

    const sourceFile = ts.createSourceFile('__handler.ts', block.bodyText, ts.ScriptTarget.Latest, true);

    // Bail on TS syntax errors (rare since classifier already vets).
    if ((sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics?.length) {
      skipped.push({ headerLine: headerLine1, endLine: endLine1, reason: 'TS syntax error in handler body' });
      continue;
    }

    const bodyIndent = block.headerIndent + INDENT_STEP;
    const stmtLines: string[] = [];
    const ctx: MapContext = { loopDepth: 0, allowNonBlock: opts?.canonicalizeBraces };
    let bailed = false;
    for (const stmt of sourceFile.statements) {
      const mapped = mapStatement(stmt, sourceFile, bodyIndent, ctx);
      if (mapped === null) {
        bailed = true;
        break;
      }
      stmtLines.push(...mapped);
    }
    if (!bailed && sourceFile.statements.length > 0) {
      // Comments that come AFTER every top-level statement and don't
      // attach as trailing-on-same-line (i.e. tail-of-body comments) get
      // emitted here so the migrated output preserves them.
      const lastTop = sourceFile.statements[sourceFile.statements.length - 1];
      stmtLines.push(...mapTailComments(lastTop.getEnd(), sourceFile.text.length, sourceFile, bodyIndent));
    }
    if (bailed) {
      skipped.push({ headerLine: headerLine1, endLine: endLine1, reason: ctx.skipReason ?? 'unsupported TS shape' });
      continue;
    }
    if (stmtLines.length === 0) {
      skipped.push({
        headerLine: headerLine1,
        endLine: endLine1,
        reason: 'no statements emitted (empty handler after comment stripping)',
      });
      continue;
    }

    // Refuse declaration-only migrations: a body that emits only comments
    // and/or `let` lines but never returns/throws/calls anything is
    // suspicious — the original handler was likely doing something we
    // failed to capture, or it was a deliberately empty stub the author
    // doesn't want silently transformed. Leave it raw so the author can
    // audit it themselves.
    if (!stmtLines.some(isActionBearingLine)) {
      skipped.push({
        headerLine: headerLine1,
        endLine: endLine1,
        reason:
          'declaration-only output (no return/throw/do/assign/control-flow) — refusing to rewrite a handler that would lose all observable behaviour',
      });
      continue;
    }

    const newHeader = `${block.headerIndent}handler ${block.headerProps}`.replace(/\s+$/, '');
    const replacementLines = [newHeader, ...stmtLines];
    replacements.push({
      startLine: block.startLine,
      endLine: block.endLine,
      lines: replacementLines,
      hit: {
        headerLine: headerLine1,
        endLine: endLine1,
        // Trim the whole body before splitting so a leading blank line
        // doesn't produce an empty `literal` in the migration report.
        literal: block.bodyText.trim().split('\n')[0],
        valueAttr: `${sourceFile.statements.length} statement${sourceFile.statements.length === 1 ? '' : 's'}`,
      },
    });
  }

  if (replacements.length === 0) return { hits: [], skipped, output: source };

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

  return { hits, skipped, output: out.join('\n') };
}
