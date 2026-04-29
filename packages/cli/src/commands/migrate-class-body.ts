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
 *     field name=fd type=T private=true value={{ init }}
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

import { escapeKernString } from '@kernlang/core';
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

/**
 * Slice 3c — try to emit fn parameters as structured `param` child lines.
 * Returns the lines on success, or `null` if the signature contains
 * optional `?`, variadic `...`, or destructuring (all-or-nothing per
 * signature; mirrors importer's tryFormatParamChildren).
 */
function tryFormatParamChildren(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  text: (n: ts.Node | undefined) => string,
): string[] | null {
  if (parameters.length === 0) return [];
  for (const p of parameters) {
    // Slice 3c-extension: optional `?`, variadic `...`, and destructured
    // `{a,b}` / `[x,y]` are structurable (gates dropped, mirrors importer.ts).
    if (!ts.isIdentifier(p.name) && !ts.isObjectBindingPattern(p.name) && !ts.isArrayBindingPattern(p.name)) {
      return null;
    }
    // Multi-line types (inline object shapes spread across lines) cannot be
    // round-tripped through a single-line `type="..."` quoted attribute —
    // KERN's tokeniser treats newlines as record separators. Leave the
    // whole signature legacy when any param has a multi-line type.
    if (p.type && /\n/.test(text(p.type))) return null;
  }
  const lines: string[] = [];
  for (const p of parameters) {
    const isObj = ts.isObjectBindingPattern(p.name);
    const isArr = ts.isArrayBindingPattern(p.name);
    const type = p.type ? text(p.type) : '';

    if (isObj || isArr) {
      // Codex review fix: rest+destructure (`...[first]: T[]`) is valid TS
      // but the structured form has no slot for the outer `...`. Bail to
      // legacy so the rest marker survives the round-trip. Mirrors importer.ts.
      if (p.dotDotDotToken) return null;
      const childLines = tryFormatParamBindingPattern(p.name as ts.BindingPattern, text);
      if (childLines === null) return null;
      const parts: string[] = ['param'];
      if (type) parts.push(`type="${escapeKernString(type)}"`);
      if (p.questionToken) parts.push('optional=true');
      if (p.initializer) parts.push(`value={{ ${text(p.initializer)} }}`);
      lines.push(parts.join(' '));
      for (const child of childLines) lines.push(`  ${child}`);
      continue;
    }

    const name = text(p.name);
    const parts: string[] = [`param name=${name}`];
    if (type) parts.push(`type="${escapeKernString(type)}"`);
    if (p.questionToken) parts.push('optional=true');
    if (p.dotDotDotToken) parts.push('variadic=true');
    if (p.initializer) {
      parts.push(`value={{ ${text(p.initializer)} }}`);
    }
    lines.push(parts.join(' '));
  }
  return lines;
}

/**
 * Slice 3c-extension #3 — convert a TS `BindingPattern` (object or array) to
 * structured `binding`/`element` lines. Returns null when the pattern uses
 * rest, defaults, or nesting (caller falls back to legacy `params="..."`).
 * Mirrors importer.ts `tryFormatParamBindingPattern`.
 */
function tryFormatParamBindingPattern(
  pattern: ts.BindingPattern,
  text: (n: ts.Node | undefined) => string,
): string[] | null {
  const childLines: string[] = [];
  if (ts.isObjectBindingPattern(pattern)) {
    for (const el of pattern.elements) {
      if (el.dotDotDotToken) return null;
      if (el.initializer) return null;
      if (!ts.isIdentifier(el.name)) return null;
      const localName = text(el.name);
      let line = `binding name=${localName}`;
      if (el.propertyName) {
        if (!ts.isIdentifier(el.propertyName)) return null;
        line += ` key=${text(el.propertyName)}`;
      }
      childLines.push(line);
    }
  } else {
    let idx = 0;
    for (const el of pattern.elements) {
      if (ts.isOmittedExpression(el)) {
        idx++;
        continue;
      }
      if (el.dotDotDotToken) return null;
      if (el.initializer) return null;
      if (!ts.isIdentifier(el.name)) return null;
      childLines.push(`element name=${text(el.name)} index=${idx}`);
      idx++;
    }
  }
  if (childLines.length === 0) return null;
  return childLines;
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
    const name = text(member.name);
    const type = rawType ? quoteTypeIfNeeded(rawType) : '';
    const priv = hasModifier(member, ts.SyntaxKind.PrivateKeyword) ? ' private=true' : '';
    const readonly = hasModifier(member, ts.SyntaxKind.ReadonlyKeyword) ? ' readonly=true' : '';
    const staticStr = hasModifier(member, ts.SyntaxKind.StaticKeyword) ? ' static=true' : '';
    // Slice 3b: emit `value={{ <init> }}` (canonical) — see importer.ts for
    // the same migration. The `{{...}}` wrap stays so arbitrary TS initializer
    // expressions pass through ValueIR via emitConstValue's ExprObject branch.
    const init = rawInit ? ` value={{ ${rawInit} }}` : '';
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
      let paramType = param.type ? text(param.type) : '';
      // Optional parameter properties (`constructor(private x?: number)`)
      // implicitly declare a field of type `T | undefined`. If we emit
      // `field name=x type=number` the ctor assign `this.x = x;` would fail
      // strictNullChecks (T | undefined → T). Widen the synthesised field
      // type to include undefined so both sides stay consistent.
      const isOptional = param.questionToken !== undefined;
      if (isOptional && paramType) {
        paramType = /[|&]/.test(paramType) ? `(${paramType}) | undefined` : `${paramType} | undefined`;
      }
      const privStr = isPriv ? ' private=true' : '';
      const readStr = isReadonly ? ' readonly=true' : '';
      const typeStr = paramType ? ` type=${quoteTypeIfNeeded(paramType)}` : '';
      shortcutFields.push(`${indent}field name=${paramName}${typeStr}${privStr}${readStr}`);
      assignLines.push(`this.${paramName} = ${paramName};`);
    }

    // Slice 3c — try structured `param` children first.
    const ctorParamChildren = tryFormatParamChildren(member.parameters, text);
    const paramsStr =
      ctorParamChildren !== null
        ? ''
        : (() => {
            const params = formatParams(member.parameters, text);
            return params ? ` params="${params}"` : '';
          })();
    const lines = [...shortcutFields];
    lines.push(`${indent}constructor${paramsStr}`);
    if (ctorParamChildren) {
      for (const childLine of ctorParamChildren) {
        lines.push(`${indent}  ${childLine}`);
      }
    }
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
    // Slice 3c — try structured `param` children first.
    const methodParamChildren = tryFormatParamChildren(member.parameters, text);
    const rawReturn = member.type ? text(member.type) : '';
    const name = text(member.name);
    const paramsStr =
      methodParamChildren !== null
        ? ''
        : (() => {
            const params = formatParams(member.parameters, text);
            return params ? ` params="${params}"` : '';
          })();
    const returns = rawReturn ? quoteTypeIfNeeded(rawReturn) : '';
    const returnsStr = returns ? ` returns=${returns}` : '';
    const isAsync = hasModifier(member, ts.SyntaxKind.AsyncKeyword);
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
    const isPriv = hasModifier(member, ts.SyntaxKind.PrivateKeyword);
    const asyncStr = isAsync ? ' async=true' : '';
    const staticStr = isStatic ? ' static=true' : '';
    const privStr = isPriv ? ' private=true' : '';
    const lines = [`${indent}method name=${name}${paramsStr}${returnsStr}${asyncStr}${staticStr}${privStr}`];
    if (methodParamChildren) {
      for (const childLine of methodParamChildren) {
        lines.push(`${indent}  ${childLine}`);
      }
    }
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
    // Slice 3c — try structured `param` children first.
    const setterParamChildren = tryFormatParamChildren(member.parameters, text);
    const name = text(member.name);
    const paramsStr =
      setterParamChildren !== null
        ? ''
        : (() => {
            const params = formatParams(member.parameters, text);
            return params ? ` params="${params}"` : '';
          })();
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
    const isPriv = hasModifier(member, ts.SyntaxKind.PrivateKeyword);
    const staticStr = isStatic ? ' static=true' : '';
    const privStr = isPriv ? ' private=true' : '';
    const lines = [`${indent}setter name=${name}${paramsStr}${privStr}${staticStr}`];
    if (setterParamChildren) {
      for (const childLine of setterParamChildren) {
        lines.push(`${indent}  ${childLine}`);
      }
    }
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
