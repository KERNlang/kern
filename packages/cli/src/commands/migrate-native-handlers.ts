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

import { classifyHandlerBody, escapeKernString } from '@kernlang/core';
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

    // Find matching `>>>`. Per parser-core.ts:480-489 the close can carry
    // tail content: `body; >>>` is valid and the parser includes the
    // pre-`>>>` text in props.code. Mirror that here so the dedent + AST
    // walk see the same body the parser would.
    let closeIdx = -1;
    let tailContent: string | null = null;
    for (let j = i + 1; j < lines.length; j++) {
      const closePos = lines[j].indexOf('>>>');
      if (closePos === -1) continue;
      closeIdx = j;
      const before = lines[j].slice(0, closePos).trim();
      tailContent = before.length > 0 ? lines[j].slice(0, closePos) : null;
      break;
    }
    if (closeIdx === -1) continue;

    const bodyLines = lines.slice(i + 1, closeIdx);
    if (tailContent !== null) bodyLines.push(tailContent);
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
    return [`${indent}let name=${name} value="${escapeKernString(exprText)}"`];
  }

  if (ts.isReturnStatement(stmt)) {
    if (!stmt.expression) return [`${indent}return`];
    const exprText = stmt.expression.getText(source);
    return [`${indent}return value="${escapeKernString(exprText)}"`];
  }

  if (ts.isThrowStatement(stmt)) {
    if (!stmt.expression) return null;
    const exprText = stmt.expression.getText(source);
    return [`${indent}throw value="${escapeKernString(exprText)}"`];
  }

  if (ts.isIfStatement(stmt)) {
    return mapIf(stmt, source, indent);
  }

  if (ts.isTryStatement(stmt)) {
    return mapTry(stmt, source, indent);
  }

  // ExpressionStatement (bare call), Block, ForOf, etc — no body-statement
  // equivalent. Bail.
  return null;
}

function mapIf(stmt: ts.IfStatement, source: ts.SourceFile, indent: string): string[] | null {
  const condText = stmt.expression.getText(source);
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

/** True when the body text contains line or block comments. Initial cut
 *  bails on these to avoid silent loss. */
function hasComments(bodyText: string): boolean {
  // Check via TS scanner so we don't false-positive on `//` inside strings.
  const sf = ts.createSourceFile('__probe.ts', bodyText, ts.ScriptTarget.Latest, true);
  let found = false;
  ts.forEachLeadingCommentRange(bodyText, 0, () => {
    found = true;
  });
  if (found) return true;
  // Walk every node, check for trailing/leading comments.
  function walk(n: ts.Node): void {
    if (found) return;
    const leading = ts.getLeadingCommentRanges(bodyText, n.getFullStart()) ?? [];
    if (leading.length > 0) {
      found = true;
      return;
    }
    const trailing = ts.getTrailingCommentRanges(bodyText, n.getEnd()) ?? [];
    if (trailing.length > 0) {
      found = true;
      return;
    }
    n.forEachChild(walk);
  }
  walk(sf);
  return found;
}

/** Append `lang="kern"` to a header-props string if not already present. */
function ensureLangKern(headerProps: string): string {
  if (/\blang=("kern"|kern)\b/.test(headerProps)) return headerProps;
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
        literal: block.bodyText.split('\n')[0].trim(),
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
