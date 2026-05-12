/**
 * `kern migrate native-handlers` — rewrite raw `<<<…>>>` handler bodies to
 * `lang="kern"` body-statement form.
 *
 * Input:  raw JS body in `<<<…>>>` that passes the slice 5a `classifyHandlerBody`
 *         eligibility check (no arrow functions, unsupported loops, unsafe mutation,
 *         regex literals, console/process/req/res access, …).
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

import {
  canonicalKernExpression,
  canonicalObjectEntriesSource,
  classifyHandlerBody,
  escapeKernString,
  hasOnlyMigratableComments,
  isValidKernAssignmentTarget,
  isValidKernAssignmentValue,
  isValidKernTypeAnnotation,
  supportedCompoundAssignmentOperator,
} from '@kernlang/core';
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

interface MapContext {
  loopDepth: number;
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
  if (mapped === null) return null;
  return [...mapLeadingComments(stmt, source, indent), ...mapped];
}

function mapLeadingComments(stmt: ts.Statement, source: ts.SourceFile, indent: string): string[] {
  return (ts.getLeadingCommentRanges(source.text, stmt.getFullStart()) ?? [])
    .filter((range) => isStandaloneCommentRange(source.text, range))
    .flatMap((range) => {
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
    if (!isConst && !isLet) return null;
    const decls = stmt.declarationList.declarations;
    if (decls.length !== 1) return null;
    const decl = decls[0];
    if (!decl.initializer) return null;
    const typeText = decl.type?.getText(source);
    if (typeText && !isValidKernTypeAnnotation(typeText)) return null;
    if (!ts.isIdentifier(decl.name)) return mapDestructureDecl(decl, source, indent, typeText, isLet ? 'let' : 'const');
    const name = decl.name.text;
    // Template-literal initializer → emit `fmt name=X template="..."` body-stmt
    // (slice for "lift more template literals to KERN AST"). Multi-line
    // templates fall through to the value-form because KERN's quoted-string
    // attribute doesn't carry embedded newlines. Templates carrying any
    // backslash escape (`\n`, `\t`, `\${`, etc.) also fall through: KERN's
    // string-attribute escaping plus codegen-side backtick escaping
    // round-trip-drifts on raw backslashes, so the value-form preserves the
    // cooked TS template literal verbatim instead.
    if (ts.isNoSubstitutionTemplateLiteral(decl.initializer) || ts.isTemplateExpression(decl.initializer)) {
      const raw = decl.initializer.getText(source);
      const body = raw.slice(1, -1);
      if (!body.includes('\n') && !body.includes('\\')) {
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
    // Same single-line + no-backslash restriction as the binding-form path
    // (see comment above) — guards against escape-sequence round-trip drift.
    if (ts.isNoSubstitutionTemplateLiteral(stmt.expression) || ts.isTemplateExpression(stmt.expression)) {
      const raw = stmt.expression.getText(source);
      const body = raw.slice(1, -1);
      if (!body.includes('\n') && !body.includes('\\')) {
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
    // Prefix/postfix mutations remain unsupported because `x++` would not be
    // byte-equivalent to the `x += 1` body-statement shape under --verify.
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
    if (ts.isPostfixUnaryExpression(stmt.expression) || ts.isPrefixUnaryExpression(stmt.expression)) {
      const op = (stmt.expression as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression).operator;
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) return null;
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
      const elseLines = mapBranch(stmt.elseStatement, source, innerIndent, ctx);
      if (elseLines === null) return null;
      out.push(...elseLines);
    }
  }
  return out;
}

function mapTry(stmt: ts.TryStatement, source: ts.SourceFile, indent: string, ctx: MapContext): string[] | null {
  if (!stmt.catchClause) return null; // body-statement try requires catch
  if (stmt.finallyBlock) return null; // body emitter has no `finally`

  const innerIndent = indent + INDENT_STEP;
  const out: string[] = [`${indent}try`];

  const tryLines = mapBranch(stmt.tryBlock, source, innerIndent, ctx);
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

  const catchLines = mapBranch(catchClause.block, source, innerIndent + INDENT_STEP, ctx);
  if (catchLines === null) return null;
  out.push(...catchLines);
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
  if (!ts.isBlock(stmt.statement)) return null;
  if (stmt.statement.statements.length === 0) return null;

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
    } else {
      if (entriesSource === null) return null;
      out = [
        `${indent}each pairKey=${entryBinding.key} pairValue=${entryBinding.value} in="${escapeKernString(entriesSource)}" entries=true`,
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
  if (!ts.isBlock(stmt.statement)) return null;
  if (stmt.statement.statements.length === 0) return null;

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
  return out;
}

// Slice α-3 (gemini review): comment and expression predicates were
// previously duplicated here and in `packages/core/src/native-eligibility-ast.ts`.
// The classifier needs the same predicates the migrator uses to keep the
// "eligibility ≡ migrate-success" invariant tight, so the canonical
// implementations now live in core and both sides import them.

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

    if (!hasOnlyMigratableComments(block.bodyText)) continue;

    const sourceFile = ts.createSourceFile('__handler.ts', block.bodyText, ts.ScriptTarget.Latest, true);

    // Bail on TS syntax errors (rare since classifier already vets).
    if ((sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics?.length) continue;

    const bodyIndent = block.headerIndent + INDENT_STEP;
    const stmtLines: string[] = [];
    let bailed = false;
    for (const stmt of sourceFile.statements) {
      const mapped = mapStatement(stmt, sourceFile, bodyIndent, { loopDepth: 0 });
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
