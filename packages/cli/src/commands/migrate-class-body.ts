/**
 * `kern migrate class-body` — convert handler-escaped class expressions to
 * first-class `class` nodes.
 *
 * Detects this shape:
 *
 *   const name=AudioRecorder type=(any|object|unknown) [export=true]
 *     handler <<<
 *       class AudioRecorder [extends X] [implements Y] {
 *         private fd: T = init;
 *         ...
 *         constructor(...) { ... }
 *         foo(...) { ... }
 *       }
 *     >>>
 *
 * and rewrites it to a proper:
 *
 *   class name=AudioRecorder [export=true] [extends=X] [implements=Y]
 *     field name=fd type=T private=true default={{ init }}
 *     constructor params="..."
 *       handler <<< ... >>>
 *     method name=foo params="..." returns=T
 *       handler <<< ... >>>
 *
 * This is NOT byte-equivalent: the original emits
 *   `export const X: any = class X { ... };`   (class expression bound to const)
 * whereas the rewrite emits
 *   `export class X { ... }`                   (class declaration)
 *
 * The two are behaviourally compatible at the call sites we care about
 * (constructor, methods, imports) but differ in hoisting and in the
 * value of `typeof X`. We only migrate when the original annotation was the
 * throwaway `any`/`object`/`unknown` — i.e. no existing code relied on the
 * type of the const, because the const had no useful type to begin with.
 */

import ts from 'typescript';

export interface ClassBodyHit {
  headerLine: number; // 1-based
  literal: string; // class name (for reporting parity with other migrations)
  valueAttr: string; // migrated-to summary, e.g. `class name=X (...members)`
}

export interface ClassBodyResult {
  hits: ClassBodyHit[];
  output: string;
}

const PLACEHOLDER_TYPES = new Set(['any', 'object', 'unknown']);

interface ConstBlock {
  startLine: number;
  endLine: number; // inclusive
  headerIndent: string;
  headerRest: string; // text after "const "
  innerIndent: string; // indent of `handler <<<`
  bodyIndent: string; // indent of first body line
  bodyLines: string[]; // interior of handler (between <<< and >>>), dedent not applied
}

/**
 * Scan for `const ... handler <<< ... >>>` blocks. Unlike the
 * literal-const matcher, class bodies are multi-line, so we capture the full
 * range and let the TS parser validate shape.
 */
function findConstHandlerBlocks(lines: string[]): Array<{ block: ConstBlock; bodyText: string }> {
  const blocks: Array<{ block: ConstBlock; bodyText: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^(\s*)const\s+(.*)$/);
    if (!headerMatch) continue;
    const headerIndent = headerMatch[1];
    const headerRest = headerMatch[2];
    if (/\bvalue=/.test(headerRest)) continue;
    if (!/\bname=/.test(headerRest)) continue;
    if (/(?:^|\s)(?:#|\/\/)/.test(headerRest)) continue;

    const openLine = lines[i + 1];
    if (openLine === undefined) continue;
    const openMatch = openLine.match(/^(\s+)handler\s*<<<\s*$/);
    if (!openMatch) continue;
    if (openMatch[1].length <= headerIndent.length) continue;
    const innerIndent = openMatch[1];

    // Find the matching `>>>` at the same indent as `handler`.
    let closeIdx = -1;
    for (let j = i + 2; j < lines.length; j++) {
      const closeMatch = lines[j].match(/^(\s+)>>>\s*$/);
      if (closeMatch && closeMatch[1] === innerIndent) {
        closeIdx = j;
        break;
      }
    }
    if (closeIdx === -1) continue;

    const bodyLines = lines.slice(i + 2, closeIdx);
    if (bodyLines.length === 0) continue;

    const firstBodyMatch = bodyLines[0].match(/^(\s+)/);
    if (!firstBodyMatch) continue;
    const bodyIndent = firstBodyMatch[1];
    if (bodyIndent.length <= innerIndent.length) continue;

    const dedentLen = bodyIndent.length;
    const bodyText = bodyLines.map((l) => (l.length >= dedentLen ? l.slice(dedentLen) : l)).join('\n');

    blocks.push({
      block: {
        startLine: i,
        endLine: closeIdx,
        headerIndent,
        headerRest,
        innerIndent,
        bodyIndent,
        bodyLines,
      },
      bodyText,
    });
  }
  return blocks;
}

/** Extract `name=VALUE` from a header's prop string, respecting quoted values. */
function readProp(header: string, key: string): string | undefined {
  const re = new RegExp(`\\b${key}=("(?:[^"\\\\]|\\\\.)*"|\\S+)`);
  const match = header.match(re);
  if (!match) return undefined;
  const raw = match[1];
  if (raw.startsWith('"')) return raw.slice(1, -1).replace(/\\"/g, '"');
  return raw;
}

/** True when a header carries `export=true` (default true if absent is false). */
function headerIsExported(header: string): boolean {
  const exp = readProp(header, 'export');
  return exp === 'true';
}

/**
 * Parse a handler body. Returns the ClassDeclaration if and only if the body
 * is exactly one top-level class declaration whose name matches `expectedName`,
 * with no other statements. Otherwise returns null.
 */
function extractSoleClass(bodyText: string, expectedName: string): ts.ClassDeclaration | null {
  const sourceFile = ts.createSourceFile('__class_body.ts', bodyText, ts.ScriptTarget.Latest, true);
  const statements = sourceFile.statements;
  if (statements.length !== 1) return null;
  const stmt = statements[0];
  if (!ts.isClassDeclaration(stmt)) return null;
  if (!stmt.name || stmt.name.getText(sourceFile) !== expectedName) return null;
  return stmt;
}

/** Extract getText helper bound to a synthesised source file. */
function binder(bodyText: string): { source: ts.SourceFile; text: (n: ts.Node | undefined) => string } {
  const source = ts.createSourceFile('__class_body.ts', bodyText, ts.ScriptTarget.Latest, true);
  return {
    source,
    text: (n) => (n ? n.getText(source) : ''),
  };
}

function formatParams(params: ts.NodeArray<ts.ParameterDeclaration>, text: (n: ts.Node | undefined) => string): string {
  return params
    .map((p) => {
      const name = text(p.name);
      const type = p.type ? text(p.type) : '';
      const optional = p.questionToken ? '?' : '';
      const defaultVal = p.initializer ? `=${text(p.initializer)}` : '';
      return type ? `${name}${optional}:${type}${defaultVal}` : `${name}${optional}${defaultVal}`;
    })
    .join(',');
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === kind) ?? false;
}

function quoteTypeIfNeeded(raw: string): string {
  if (raw === '') return '';
  return /\s/.test(raw) ? `"${raw.replace(/"/g, '\\"')}"` : raw;
}

/**
 * Emit KERN lines for a single class member. Returns null when the member
 * shape is unsupported (e.g. static block, getter/setter) — that causes the
 * whole migration to abort for this const so nothing is silently dropped.
 */
/**
 * KERN props live on a single line. If a param list or return-type annotation
 * spans multiple lines in TS (e.g. inline object types `{\n  foo: string;\n}`)
 * we can't safely emit it as `params="..."` — the embedded newline would close
 * the string literal and corrupt the parse. Detect and bail so the caller can
 * fall back to leaving the handler escape-hatch in place.
 */
function hasNewline(s: string): boolean {
  return s.includes('\n');
}

/**
 * Insert synthesised `this.x = x;` lines in the correct position:
 *   - If the body opens with `super(...)`, place the assigns immediately
 *     AFTER the first statement that contains the super call.
 *   - Otherwise, prepend to the top.
 *
 * A single super call can span multiple indented lines (a multi-line arg
 * list). We detect the opening `super(` and advance past the matching `)`
 * at paren-depth zero, treating that as the end of the super statement.
 * This is a line-level heuristic — good enough for the shapes the migration
 * actually accepts (TS already validated the class as syntactically clean).
 */
function spliceAssignsAfterSuper(body: string[], assigns: string[]): string[] {
  if (assigns.length === 0) return body;
  if (body.length === 0) return assigns;

  // Find the first non-blank line that starts with `super(` (modulo
  // leading whitespace).
  let superStart = -1;
  for (let i = 0; i < body.length; i++) {
    const trimmed = body[i].trimStart();
    if (trimmed === '') continue;
    if (/^super\s*\(/.test(trimmed)) {
      superStart = i;
    }
    break;
  }
  if (superStart === -1) {
    return [...assigns, ...body];
  }

  // Advance through lines until paren depth returns to zero and the line
  // looks terminated (ends with `;` or `)` at depth 0).
  let depth = 0;
  let end = superStart;
  for (let i = superStart; i < body.length; i++) {
    for (const ch of body[i]) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    end = i;
    if (depth <= 0) break;
  }

  return [...body.slice(0, end + 1), ...assigns, ...body.slice(end + 1)];
}

function emitMember(
  member: ts.ClassElement,
  text: (n: ts.Node | undefined) => string,
  indent: string,
): string[] | null {
  if (ts.isPropertyDeclaration(member)) {
    const rawType = member.type ? text(member.type) : '';
    const rawInit = member.initializer ? text(member.initializer) : '';
    if (hasNewline(rawType) || hasNewline(rawInit)) return null;
    const name = text(member.name);
    const type = rawType ? quoteTypeIfNeeded(rawType) : '';
    const priv = hasModifier(member, ts.SyntaxKind.PrivateKeyword) ? ' private=true' : '';
    const readonly = hasModifier(member, ts.SyntaxKind.ReadonlyKeyword) ? ' readonly=true' : '';
    const staticStr = hasModifier(member, ts.SyntaxKind.StaticKeyword) ? ' static=true' : '';
    const init = rawInit ? ` default={{ ${rawInit} }}` : '';
    return [`${indent}field name=${name}${type ? ` type=${type}` : ''}${priv}${staticStr}${readonly}${init}`];
  }
  if (ts.isConstructorDeclaration(member)) {
    // Parameter-property shortcuts like `constructor(private x: T, readonly y: U)`
    // implicitly declare fields. KERN params have no modifier slot, so we
    // expand: each modified param becomes a sibling `field` line (inserted
    // BEFORE the constructor) and the body gets a leading `this.x = x;`
    // assignment. The constructor's visible param list keeps only the types.
    const shortcutFields: string[] = [];
    const assignLines: string[] = [];
    for (const param of member.parameters) {
      const paramMods = ts.canHaveModifiers(param) ? ts.getModifiers(param) : undefined;
      const isPriv = paramMods?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
      const isPublic = paramMods?.some((m) => m.kind === ts.SyntaxKind.PublicKeyword) ?? false;
      const isProtected = paramMods?.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword) ?? false;
      const isReadonly = paramMods?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false;
      if (!isPriv && !isPublic && !isProtected && !isReadonly) continue;

      // Protected is not a first-class KERN field modifier yet; fall back to
      // plain (public-equivalent) to avoid silently dropping access-level
      // intent on a rarer pattern.
      const paramName = text(param.name);
      const paramType = param.type ? text(param.type) : '';
      if (hasNewline(paramType)) return null;
      const privStr = isPriv ? ' private=true' : '';
      const readStr = isReadonly ? ' readonly=true' : '';
      const typeStr = paramType ? ` type=${quoteTypeIfNeeded(paramType)}` : '';
      shortcutFields.push(`${indent}field name=${paramName}${typeStr}${privStr}${readStr}`);
      assignLines.push(`this.${paramName} = ${paramName};`);
    }

    const params = formatParams(member.parameters, text);
    if (hasNewline(params)) return null;
    const paramsStr = params ? ` params="${params}"` : '';
    const lines = [...shortcutFields];
    lines.push(`${indent}constructor${paramsStr}`);
    const body = member.body;
    const bodyText = body ? text(body).slice(1, -1) : '';
    const trimmed = body ? dedentInteriorLines(bodyText) : '';
    const originalLines = trimmed ? trimmed.split('\n') : [];
    // TypeScript requires `super(...)` to be the FIRST statement in a derived
    // class constructor before any `this.*` access. If the body opens with a
    // super call, splice the synthesised assignments AFTER it; otherwise
    // prepend at the top as usual.
    const bodyLines = spliceAssignsAfterSuper(originalLines, assignLines);
    if (bodyLines.length > 0) {
      lines.push(`${indent}  handler <<<`);
      for (const line of bodyLines) lines.push(`${indent}    ${line}`);
      lines.push(`${indent}  >>>`);
    }
    return lines;
  }
  if (ts.isMethodDeclaration(member)) {
    // Abstract methods have no body. The `method` schema has no abstract
    // prop yet, and emitting a body-less method would drop the abstractness
    // silently — bail so the class stays in its handler form for now.
    if (hasModifier(member, ts.SyntaxKind.AbstractKeyword) || !member.body) return null;
    const params = formatParams(member.parameters, text);
    const rawReturn = member.type ? text(member.type) : '';
    if (hasNewline(params) || hasNewline(rawReturn)) return null;
    const name = text(member.name);
    const paramsStr = params ? ` params="${params}"` : '';
    const returns = rawReturn ? quoteTypeIfNeeded(rawReturn) : '';
    const returnsStr = returns ? ` returns=${returns}` : '';
    const isAsync = hasModifier(member, ts.SyntaxKind.AsyncKeyword);
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
    const isPriv = hasModifier(member, ts.SyntaxKind.PrivateKeyword);
    const asyncStr = isAsync ? ' async=true' : '';
    const staticStr = isStatic ? ' static=true' : '';
    const privStr = isPriv ? ' private=true' : '';
    const lines = [`${indent}method name=${name}${paramsStr}${returnsStr}${asyncStr}${staticStr}${privStr}`];
    const body = member.body;
    if (body) {
      const bodyText = text(body).slice(1, -1);
      const trimmed = dedentInteriorLines(bodyText);
      lines.push(`${indent}  handler <<<`);
      for (const line of trimmed.split('\n')) lines.push(`${indent}    ${line}`);
      lines.push(`${indent}  >>>`);
    }
    return lines;
  }
  if (ts.isGetAccessorDeclaration(member)) {
    if (!member.body) return null;
    const rawReturn = member.type ? text(member.type) : '';
    if (hasNewline(rawReturn)) return null;
    const name = text(member.name);
    const returns = rawReturn ? quoteTypeIfNeeded(rawReturn) : '';
    const returnsStr = returns ? ` returns=${returns}` : '';
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
    const isPriv = hasModifier(member, ts.SyntaxKind.PrivateKeyword);
    const staticStr = isStatic ? ' static=true' : '';
    const privStr = isPriv ? ' private=true' : '';
    const lines = [`${indent}getter name=${name}${returnsStr}${privStr}${staticStr}`];
    const bodyText = text(member.body).slice(1, -1);
    const trimmed = dedentInteriorLines(bodyText);
    lines.push(`${indent}  handler <<<`);
    for (const line of trimmed.split('\n')) lines.push(`${indent}    ${line}`);
    lines.push(`${indent}  >>>`);
    return lines;
  }
  if (ts.isSetAccessorDeclaration(member)) {
    if (!member.body) return null;
    const params = formatParams(member.parameters, text);
    if (hasNewline(params)) return null;
    const name = text(member.name);
    const paramsStr = params ? ` params="${params}"` : '';
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
    const isPriv = hasModifier(member, ts.SyntaxKind.PrivateKeyword);
    const staticStr = isStatic ? ' static=true' : '';
    const privStr = isPriv ? ' private=true' : '';
    const lines = [`${indent}setter name=${name}${paramsStr}${privStr}${staticStr}`];
    const bodyText = text(member.body).slice(1, -1);
    const trimmed = dedentInteriorLines(bodyText);
    lines.push(`${indent}  handler <<<`);
    for (const line of trimmed.split('\n')) lines.push(`${indent}    ${line}`);
    lines.push(`${indent}  >>>`);
    return lines;
  }
  // Static block / signature / index signature — bail.
  return null;
}

/**
 * Strip the minimum leading indentation from every non-empty line, and trim
 * a single leading/trailing empty line. Matches how kern compiles handler
 * bodies back out (dedent helper in core/codegen/helpers.ts).
 */
function dedentInteriorLines(text: string): string {
  const lines = text.split('\n');
  // Drop a single leading empty line from TS `{ \n ... \n }` formatting.
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
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
 * Main entry: walk .kern source text, rewrite every
 * `const ... handler <<< class X {...} >>>` block to a `class` node.
 */
export function rewriteClassBodies(source: string): ClassBodyResult {
  const lines = source.split('\n');
  const hits: ClassBodyHit[] = [];

  // Walk and collect replacements. Process in order, building the output in
  // one pass to keep indent semantics stable.
  const out: string[] = [];
  let cursor = 0;

  const blocks = findConstHandlerBlocks(lines);
  for (const { block, bodyText } of blocks) {
    const constName = readProp(block.headerRest, 'name');
    const constType = readProp(block.headerRest, 'type');
    if (!constName) continue;
    if (!constType || !PLACEHOLDER_TYPES.has(constType.trim())) continue;

    const cls = extractSoleClass(bodyText, constName);
    if (!cls) continue;

    const { source: classSource, text } = binder(bodyText);
    // Re-find the ClassDeclaration in the fresh binder so getText() uses the
    // matching source file (extractSoleClass used a different file instance).
    const clsStmt = classSource.statements.find(
      (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.getText(classSource) === constName,
    );
    if (!clsStmt) continue;

    const extendsClause = clsStmt.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
    const implementsClause = clsStmt.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ImplementsKeyword);
    const isAbstract = hasModifier(clsStmt, ts.SyntaxKind.AbstractKeyword);
    const extendsStr = extendsClause
      ? ` extends=${extendsClause.types.map((t) => t.getText(classSource)).join(',')}`
      : '';
    const implementsStr = implementsClause
      ? ` implements=${implementsClause.types.map((t) => t.getText(classSource)).join(',')}`
      : '';
    const abstractStr = isAbstract ? ' abstract=true' : '';
    const exportStr = headerIsExported(block.headerRest) ? ' export=true' : '';

    const childIndent = `${block.headerIndent}  `;
    const memberLines: string[] = [];
    let failed = false;
    for (const member of clsStmt.members) {
      const emitted = emitMember(member, text, childIndent);
      if (emitted === null) {
        failed = true;
        break;
      }
      memberLines.push(...emitted);
    }
    if (failed) continue;

    // Flush any lines before this block's start, then emit replacement.
    while (cursor < block.startLine) out.push(lines[cursor++]);
    out.push(`${block.headerIndent}class name=${constName}${extendsStr}${implementsStr}${abstractStr}${exportStr}`);
    out.push(...memberLines);
    cursor = block.endLine + 1;

    hits.push({
      headerLine: block.startLine + 1,
      literal: constName,
      valueAttr: `class name=${constName} (${clsStmt.members.length} members)`,
    });
  }

  // Flush remaining trailing lines.
  while (cursor < lines.length) out.push(lines[cursor++]);

  return { hits, output: out.join('\n') };
}
