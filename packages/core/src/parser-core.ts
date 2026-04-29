/** @internal Core parser pipeline — line parsing, tree building, and orchestration. */

import type { ParseState } from './parser-diagnostics.js';
import { commitParseState, createParseState, emitDiagnostic } from './parser-diagnostics.js';
import { KEYWORD_HANDLERS } from './parser-keywords.js';
import { parseStyleBlock } from './parser-style.js';
import { TokenStream } from './parser-token-stream.js';
import type { Token } from './parser-tokenizer.js';
import { tokenizeLineInternal } from './parser-tokenizer.js';
import { validateEffects } from './parser-validate-effects.js';
import { validateExpressions } from './parser-validate-expressions.js';
import { defaultRuntime, type KernRuntime } from './runtime.js';
import { isKnownNodeType } from './spec.js';
import type { IRNode, IRSourceLocation, ParseResult } from './types.js';

// ── ParsedLine ───────────────────────────────────────────────────────────

interface ParsedLine {
  indent: number;
  rawLength: number;
  type: string;
  props: Record<string, unknown>;
  /** Prop names whose value came from a quoted token. Empty/undefined = none. */
  quotedProps?: string[];
  styles: Record<string, string>;
  pseudoStyles: Record<string, Record<string, string>>;
  themeRefs: string[];
  loc: IRSourceLocation;
}

function stripInlineComment(content: string): string {
  let inQuote = false;
  let quoteChar: '"' | "'" | null = null;
  let styleDepth = 0;
  let exprDepth = 0;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    const prev = i > 0 ? content[i - 1] : '';

    if (ch === '\\' && inQuote) {
      i++;
      continue;
    }
    if ((ch === '"' || ch === "'") && (!inQuote || ch === quoteChar)) {
      if (inQuote) {
        inQuote = false;
        quoteChar = null;
      } else {
        inQuote = true;
        quoteChar = ch as '"' | "'";
      }
      continue;
    }
    if (inQuote) continue;

    if (ch === '{' && next === '{') {
      exprDepth++;
      i++;
      continue;
    }
    if (ch === '}' && next === '}' && exprDepth > 0) {
      exprDepth--;
      i++;
      continue;
    }
    if (exprDepth > 0) continue;

    if (ch === '{') {
      styleDepth++;
      continue;
    }
    if (ch === '}' && styleDepth > 0) {
      styleDepth--;
      continue;
    }
    if (styleDepth > 0) continue;

    const precededByWs = i === 0 || prev === ' ' || prev === '\t';
    if (ch === '#' && precededByWs) {
      return content.slice(0, i).trimEnd();
    }
    if (ch === '/' && next === '/' && precededByWs) {
      return content.slice(0, i).trimEnd();
    }
  }

  return content;
}

// ── Prop parsing ─────────────────────────────────────────────────────────

/** Map a value token to its JS representation. */
function tokenValue(tok: Token): unknown {
  if (tok.kind === 'expr') return { __expr: true, code: tok.value };
  if (tok.kind === 'quoted') return tok.value;
  return tok.value;
}

/** Try to parse a key=value prop from the stream. Returns true if consumed. */
function parseProp(
  state: ParseState,
  s: TokenStream,
  props: Record<string, unknown>,
  quotedProps: Set<string>,
  lineNum?: number,
  col?: number,
): boolean {
  if (!s.isKeyValue()) return false;
  s.skipWS();
  const keyTok = s.next()!;
  const key = keyTok.value; // identifier
  s.next(); // =
  if (key in props) {
    emitDiagnostic(
      state,
      'DUPLICATE_PROP',
      'warning',
      `Duplicate property '${key}' at line ${lineNum ?? 0}`,
      lineNum ?? 0,
      (col ?? 0) + keyTok.pos,
      {
        endCol: (col ?? 0) + keyTok.pos + key.length,
      },
    );
  }
  const valTok = s.peek();
  if (!valTok || valTok.kind === 'whitespace') {
    props[key] = '';
    quotedProps.delete(key); // last write wins on props; metadata must follow
    return true;
  }

  // key={{expr}} or key="quoted"
  if (valTok.kind === 'expr' || valTok.kind === 'quoted') {
    const consumed = s.next()!;
    props[key] = tokenValue(consumed);
    if (consumed.kind === 'quoted') quotedProps.add(key);
    else quotedProps.delete(key);
    return true;
  }

  // key=bareValue — collect tokens up to next WS/style/themeRef
  let value = '';
  while (!s.done()) {
    const vt = s.peek()!;
    if (vt.kind === 'whitespace' || vt.kind === 'style' || vt.kind === 'themeRef') break;
    value += vt.value;
    s.next();
  }
  props[key] = value;
  quotedProps.delete(key); // last write wins on props; metadata must follow
  return true;
}

// ── parseLine ────────────────────────────────────────────────────────────

function parseLine(
  state: ParseState,
  raw: string,
  lineNum: number,
  runtime: KernRuntime = defaultRuntime,
): ParsedLine | null {
  if (raw.trim() === '') return null;

  const indent = raw.search(/\S/);
  const indentText = raw.slice(0, indent);
  const content = stripInlineComment(raw.slice(indent));
  if (content.trim() === '') return null;
  const col = indent + 1;

  if (indentText.includes('\t')) {
    emitDiagnostic(state, 'INVALID_INDENT', 'warning', `Tab indentation at line ${lineNum}`, lineNum, 1, {
      endCol: indent + 1,
    });
  }

  const diagBefore = state.diagnostics.length;
  const tokens = tokenizeLineInternal(content, state);
  for (let d = diagBefore; d < state.diagnostics.length; d++) {
    if (state.diagnostics[d].line === 0) state.diagnostics[d].line = lineNum;
    state.diagnostics[d].col += indent;
    state.diagnostics[d].endCol += indent;
  }
  const s = new TokenStream(tokens);

  // First token must be an identifier (the node type)
  const typeToken = s.tryIdent();
  if (!typeToken) {
    const firstToken = tokens.find((tok) => tok.kind !== 'whitespace');
    if (firstToken) {
      emitDiagnostic(
        state,
        'DROPPED_LINE',
        'error',
        `Dropped line ${lineNum}: expected a node type at the start of the line`,
        lineNum,
        col + firstToken.pos,
        {
          endCol: col + content.length,
        },
      );
    }
    // Return an error node instead of null — preserves position in tree for partial compilation
    return {
      indent,
      rawLength: content.length,
      type: '__error',
      props: {
        message: `Dropped line ${lineNum}: expected a node type`,
        raw: content,
        code: 'DROPPED_LINE',
      },
      styles: {},
      pseudoStyles: {},
      themeRefs: [],
      loc: { line: lineNum, col, endLine: lineNum, endCol: col + content.length },
    };
  }
  const type = typeToken;
  if (!isKnownNodeType(type, runtime) && !runtime.multilineBlockTypes.has(type) && !runtime.isTemplateNode(type)) {
    emitDiagnostic(
      state,
      'UNKNOWN_NODE_TYPE',
      'warning',
      `Unknown node type '${type}' at line ${lineNum}`,
      lineNum,
      col,
      {
        endCol: col + type.length,
      },
    );
  }

  const props: Record<string, unknown> = {};
  const quotedProps = new Set<string>();
  const styles: Record<string, string> = {};
  const pseudoStyles: Record<string, Record<string, string>> = {};
  const themeRefs: string[] = [];

  // ── Evolved node parser hints (v4) ──────────────────────────────────
  const evolvedHints = runtime.parserHints.get(type);
  if (evolvedHints) {
    if (evolvedHints.positionalArgs) {
      for (const argName of evolvedHints.positionalArgs) {
        const tok = s.consumeAnyValue();
        if (tok) props[argName] = tok.value;
      }
    }
    if (evolvedHints.bareWord) {
      s.skipWS();
      if (!s.isKeyValue()) {
        const id = s.tryIdent();
        if (id) props[evolvedHints.bareWord] = id;
      }
    }
  }

  // ── Keyword-specific handling ──────────────────────────────────────
  const handler = KEYWORD_HANDLERS.get(type);
  if (handler) handler(s, props, content);

  // ── Generic prop/style/theme parsing ───────────────────────────────
  while (!s.done()) {
    s.skipWS();
    if (s.done()) break;

    const tok = s.peek()!;

    // Style block
    if (tok.kind === 'style') {
      parseStyleBlock(tok.value, styles, pseudoStyles);
      s.next();
      continue;
    }

    // Theme ref
    if (tok.kind === 'themeRef') {
      themeRefs.push(tok.value);
      s.next();
      continue;
    }

    // Key=value prop (extracted helper from Codex)
    if (parseProp(state, s, props, quotedProps, lineNum, col)) continue;

    // Unknown token — skip with warning
    const skipped = s.next()!;
    const errCol = col + skipped.pos;
    emitDiagnostic(
      state,
      'UNEXPECTED_TOKEN',
      'warning',
      `Unexpected token "${skipped.value}" at line ${lineNum}:${errCol}`,
      lineNum,
      errCol,
      {
        endCol: errCol + skipped.value.length,
      },
    );
  }

  return {
    indent,
    rawLength: content.length,
    type,
    props,
    ...(quotedProps.size > 0 ? { quotedProps: [...quotedProps] } : {}),
    styles,
    pseudoStyles,
    themeRefs,
    loc: { line: lineNum, col, endLine: lineNum, endCol: col + content.length },
  };
}

// ── Minified source expander ─────────────────────────────────────────────

function expandMinified(source: string): string {
  if (!source.includes('(') || source.split('\n').length > 1) return source;

  const result: string[] = [];
  let depth = 0;
  let current = '';
  let inQuote = false;
  let inBraces = 0;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (inQuote) {
      current += ch;
      continue;
    }
    if (ch === '{') {
      inBraces++;
      current += ch;
      continue;
    }
    if (ch === '}') {
      inBraces--;
      current += ch;
      continue;
    }
    if (inBraces > 0) {
      current += ch;
      continue;
    }

    if (ch === '(') {
      result.push('  '.repeat(depth) + current.trim());
      current = '';
      depth++;
    } else if (ch === ')') {
      if (current.trim()) result.push('  '.repeat(depth) + current.trim());
      current = '';
      depth--;
    } else if (ch === ',' && inBraces === 0) {
      if (current.trim()) result.push('  '.repeat(depth) + current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push('  '.repeat(depth) + current.trim());

  return result.join('\n');
}

// ── Multi-line block + line orchestration ────────────────────────────────

function scanLineState(s: string, prev?: { inQuote: boolean }): { inQuote: boolean } {
  let inQuote = prev?.inQuote ?? false;
  let exprDepth = 0;
  let styleDepth = 0;
  let styleInQuote = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];
    const prevCh = i > 0 ? s[i - 1] : '';

    if (inQuote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inQuote = false;
      continue;
    }

    if (exprDepth > 0) {
      if (ch === '{' && next === '{') {
        exprDepth++;
        i++;
        continue;
      }
      if (ch === '}' && next === '}') {
        exprDepth--;
        i++;
      }
      continue;
    }

    if (styleDepth > 0) {
      if (ch === '\\' && styleInQuote) {
        i++;
        continue;
      }
      if (ch === '"') {
        styleInQuote = !styleInQuote;
        continue;
      }
      if (styleInQuote) continue;
      if (ch === '{') {
        styleDepth++;
        continue;
      }
      if (ch === '}') {
        styleDepth--;
      }
      continue;
    }

    const precededByWs = i === 0 || prevCh === ' ' || prevCh === '\t';
    if (ch === '#' && precededByWs) break;
    if (ch === '/' && next === '/' && precededByWs) break;

    if (ch === '{' && next === '{') {
      exprDepth++;
      i++;
      continue;
    }
    if (ch === '{') {
      styleDepth++;
      styleInQuote = false;
      continue;
    }
    if (ch === '"') inQuote = true;
  }

  return { inQuote };
}

/** Process source lines into ParsedLine entries (multiline blocks + regular lines). */
function parseLines(state: ParseState, source: string, runtime: KernRuntime = defaultRuntime): ParsedLine[] {
  const lines = expandMinified(source).split('\n');
  const parsed: ParsedLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    // Skip comment lines (// or #)
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    const multilineType = [...runtime.multilineBlockTypes].find((type) => trimmed.startsWith(`${type} <<<`));
    if (multilineType) {
      const indent = lines[i].search(/\S/);
      const codeLines: string[] = [];
      const startLine = i + 1;
      const blockOpen = `${multilineType} <<<`;
      const afterOpen = trimmed.slice(blockOpen.length);
      let closed = false;
      if (afterOpen.includes('>>>')) {
        closed = true;
        codeLines.push(afterOpen.split('>>>')[0]);
      } else {
        i++;
        while (i < lines.length && !lines[i].trimStart().startsWith('>>>')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          closed = true;
          const closeLine = lines[i];
          const closeIdx = closeLine.indexOf('>>>');
          if (closeIdx > 0) {
            const before = closeLine.slice(0, closeIdx).trim();
            if (before) codeLines.push(before);
          }
        }
      }
      if (!closed) {
        emitDiagnostic(
          state,
          'UNEXPECTED_TOKEN',
          'error',
          `Unclosed multiline block '${multilineType} <<<' at line ${startLine}`,
          startLine,
          indent + 1,
          {
            endCol: indent + 1 + blockOpen.length,
            suggestion: `Close the '${multilineType} <<<' block with a matching '>>>' marker before the file ends.`,
          },
        );
      }
      parsed.push({
        indent,
        rawLength: lines[startLine - 1].slice(indent).length,
        type: multilineType,
        props: { code: codeLines.join('\n').replace(/^\n+|\n+$/g, '') },
        styles: {},
        pseudoStyles: {},
        themeRefs: [],
        loc: {
          line: startLine,
          col: indent + 1,
          endLine: startLine,
          endCol: indent + 1 + lines[startLine - 1].slice(indent).length,
        },
      });
      continue;
    }

    const startLine = i + 1;
    const joinedParts: string[] = [lines[i]];
    let lineState = scanLineState(lines[i]);
    // An unterminated quote must not silently absorb structural lines that the
    // outer loop would otherwise handle specially — comment lines and
    // multiline-block openers (`handler <<<`, etc.). Stop stitching at those
    // boundaries; the tokeniser will emit UNCLOSED_STRING for what we already
    // consumed, preserving the block/comment line for the next iteration.
    while (lineState.inQuote && i + 1 < lines.length) {
      const nextTrimmed = lines[i + 1].trimStart();
      if (nextTrimmed.startsWith('//') || nextTrimmed.startsWith('#')) break;
      if ([...runtime.multilineBlockTypes].some((t) => nextTrimmed.startsWith(`${t} <<<`))) break;
      i++;
      joinedParts.push(lines[i]);
      lineState = scanLineState(lines[i], lineState);
    }
    const joined = joinedParts.length === 1 ? joinedParts[0] : joinedParts.join('\n');

    const p = parseLine(state, joined, startLine, runtime);
    if (p) parsed.push(p); // null only for blank/comment lines; __error nodes are always pushed
  }

  return parsed;
}

// ── Tree building ────────────────────────────────────────────────────────

/** Convert a ParsedLine to an IRNode (no children yet). */
function toNode(p: ParsedLine): IRNode {
  const node: IRNode = {
    type: p.type,
    loc: p.loc,
    props: { ...p.props },
    children: [],
  };
  if (Object.keys(p.styles).length > 0) node.props!.styles = p.styles;
  if (Object.keys(p.pseudoStyles).length > 0) node.props!.pseudoStyles = p.pseudoStyles;
  if (p.themeRefs.length > 0) node.props!.themeRefs = p.themeRefs;
  if (p.quotedProps && p.quotedProps.length > 0) node.__quotedProps = p.quotedProps;
  return node;
}

/** Build a tree from parsed lines using indent-based stack. */
function buildTree(state: ParseState, parsed: ParsedLine[], root: IRNode, rootIndent: number): void {
  const stack: { node: IRNode; indent: number }[] = [{ node: root, indent: rootIndent }];
  const seenIndents = new Set<number>([rootIndent]);

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    const node = toNode(p);

    if (p.indent < (stack[stack.length - 1]?.indent ?? 0) && !seenIndents.has(p.indent)) {
      emitDiagnostic(
        state,
        'INDENT_JUMP',
        'warning',
        `Dedent to unseen indent level ${p.indent} at line ${p.loc.line}`,
        p.loc.line,
        p.loc.col,
        {
          endCol: p.loc.col + p.type.length,
        },
      );
    }

    while (stack.length > 1 && stack[stack.length - 1].indent >= p.indent) {
      stack.pop();
    }

    seenIndents.add(p.indent);
    const parent = stack[stack.length - 1].node;
    if (!parent.children) parent.children = [];
    parent.children.push(node);
    stack.push({ node, indent: p.indent });
  }
}

/** Recursively compute endLine/endCol for each node based on its last child. */
function computeEndSpans(node: IRNode): void {
  if (node.children && node.children.length > 0) {
    for (const child of node.children) computeEndSpans(child);
    const lastChild = node.children[node.children.length - 1];
    if (lastChild.loc && node.loc) {
      node.loc.endLine = lastChild.loc.endLine ?? lastChild.loc.line;
      node.loc.endCol = lastChild.loc.endCol ?? lastChild.loc.col;
    }
  } else if (node.loc) {
    node.loc.endLine = node.loc.endLine ?? node.loc.line;
    node.loc.endCol = node.loc.endCol ?? node.loc.col;
  }
}

// ── Core parse driver ────────────────────────────────────────────────────

/** @internal Single internal entry that wires parseLines → buildTree → computeEndSpans. */
export function parseInternal(source: string, asDocument: boolean, runtime?: KernRuntime): ParseResult {
  const rt = runtime ?? defaultRuntime;
  const state = createParseState();
  const parsed = parseLines(state, source, rt);

  if (parsed.length === 0) {
    if (source.trim() === '') {
      emitDiagnostic(state, 'EMPTY_DOCUMENT', 'info', 'Source document is empty', 1, 1, { endCol: 1 });
    }
    const root = { type: 'document', children: [], loc: { line: 1, col: 1, endLine: 1, endCol: 1 } };
    commitParseState(state, rt);
    return { root, diagnostics: [...state.diagnostics] };
  }

  let root: IRNode;
  if (asDocument) {
    root = { type: 'document', children: [], loc: { line: 1, col: 1 } };
    buildTree(state, parsed, root, -1);
  } else {
    root = toNode(parsed[0]);
    buildTree(state, parsed.slice(1), root, parsed[0].indent);
  }

  computeEndSpans(root);
  validateExpressions(state, root);
  validateEffects(state, root);
  commitParseState(state, rt);

  // Count __error nodes for partial compilation support
  const errorCount = countErrorNodes(root);
  return {
    root,
    diagnostics: [...state.diagnostics],
    ...(errorCount > 0 ? { partial: true, errorCount } : {}),
  };
}

/** Recursively count __error nodes in a tree. */
function countErrorNodes(node: IRNode): number {
  let count = node.type === '__error' ? 1 : 0;
  if (node.children) {
    for (const child of node.children) count += countErrorNodes(child);
  }
  return count;
}
