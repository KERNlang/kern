/** @internal Core parser pipeline — line parsing, tree building, and orchestration. */
import type { IRNode, IRSourceLocation, ParseDiagnostic, ParseResult } from './types.js';
import { isKnownNodeType } from './spec.js';
import { defaultRuntime, type KernRuntime } from './runtime.js';
import type { ParseState } from './parser-diagnostics.js';
import { createParseState, commitParseState, emitDiagnostic } from './parser-diagnostics.js';
import type { Token } from './parser-tokenizer.js';
import { tokenizeLineInternal } from './parser-tokenizer.js';
import { TokenStream } from './parser-token-stream.js';
import { parseStyleBlock } from './parser-style.js';
import { KEYWORD_HANDLERS } from './parser-keywords.js';

// ── ParsedLine ───────────────────────────────────────────────────────────

interface ParsedLine {
  indent: number;
  rawLength: number;
  type: string;
  props: Record<string, unknown>;
  styles: Record<string, string>;
  pseudoStyles: Record<string, Record<string, string>>;
  themeRefs: string[];
  loc: IRSourceLocation;
}

// ── Prop parsing ─────────────────────────────────────────────────────────

/** Map a value token to its JS representation. */
function tokenValue(tok: Token): unknown {
  if (tok.kind === 'expr') return { __expr: true, code: tok.value };
  if (tok.kind === 'quoted') return tok.value;
  return tok.value;
}

/** Try to parse a key=value prop from the stream. Returns true if consumed. */
function parseProp(state: ParseState, s: TokenStream, props: Record<string, unknown>, lineNum?: number, col?: number): boolean {
  if (!s.isKeyValue()) return false;
  s.skipWS();
  const keyTok = s.next()!;
  const key = keyTok.value; // identifier
  s.next(); // =
  if (key in props) {
    emitDiagnostic(state, 'DUPLICATE_PROP', 'warning', `Duplicate property '${key}' at line ${lineNum ?? 0}`, lineNum ?? 0, (col ?? 0) + keyTok.pos, {
      endCol: (col ?? 0) + keyTok.pos + key.length,
    });
  }
  const valTok = s.peek();
  if (!valTok || valTok.kind === 'whitespace') {
    props[key] = '';
    return true;
  }

  // key={{expr}} or key="quoted"
  if (valTok.kind === 'expr' || valTok.kind === 'quoted') {
    props[key] = tokenValue(s.next()!);
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
  return true;
}

// ── parseLine ────────────────────────────────────────────────────────────

function parseLine(state: ParseState, raw: string, lineNum: number, runtime: KernRuntime = defaultRuntime): ParsedLine | null {
  if (raw.trim() === '') return null;

  const indent = raw.search(/\S/);
  const indentText = raw.slice(0, indent);
  const content = raw.slice(indent);
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
    const firstToken = tokens.find(tok => tok.kind !== 'whitespace');
    if (firstToken) {
      emitDiagnostic(state, 'DROPPED_LINE', 'error', `Dropped line ${lineNum}: expected a node type at the start of the line`, lineNum, col + firstToken.pos, {
        endCol: col + content.length,
      });
    }
    return null;
  }
  const type = typeToken;
  if (!isKnownNodeType(type, runtime) && !runtime.multilineBlockTypes.has(type) && !runtime.isTemplateNode(type)) {
    emitDiagnostic(state, 'UNKNOWN_NODE_TYPE', 'warning', `Unknown node type '${type}' at line ${lineNum}`, lineNum, col, {
      endCol: col + type.length,
    });
  }

  const props: Record<string, unknown> = {};
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
    if (parseProp(state, s, props, lineNum, col)) continue;

    // Unknown token — skip with warning
    const skipped = s.next()!;
    const errCol = col + skipped.pos;
    emitDiagnostic(state, 'UNEXPECTED_TOKEN', 'warning', `Unexpected token "${skipped.value}" at line ${lineNum}:${errCol}`, lineNum, errCol, {
      endCol: errCol + skipped.value.length,
    });
  }

  return {
    indent,
    rawLength: content.length,
    type,
    props,
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
    if (ch === '"') { inQuote = !inQuote; current += ch; continue; }
    if (inQuote) { current += ch; continue; }
    if (ch === '{') { inBraces++; current += ch; continue; }
    if (ch === '}') { inBraces--; current += ch; continue; }
    if (inBraces > 0) { current += ch; continue; }

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

/** Process source lines into ParsedLine entries (multiline blocks + regular lines). */
function parseLines(state: ParseState, source: string, runtime: KernRuntime = defaultRuntime): ParsedLine[] {
  const lines = expandMinified(source).split('\n');
  const parsed: ParsedLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    const multilineType = [...runtime.multilineBlockTypes].find(type => trimmed.startsWith(`${type} <<<`));
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
        emitDiagnostic(state, 'UNEXPECTED_TOKEN', 'error', `Unclosed multiline block '${multilineType} <<<' at line ${startLine}`, startLine, indent + 1, {
          endCol: indent + 1 + blockOpen.length,
          suggestion: `Close the '${multilineType} <<<' block with a matching '>>>' marker before the file ends.`,
        });
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

    const p = parseLine(state, lines[i], i + 1, runtime);
    if (p) parsed.push(p);
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
      emitDiagnostic(state, 'INDENT_JUMP', 'warning', `Dedent to unseen indent level ${p.indent} at line ${p.loc.line}`, p.loc.line, p.loc.col, {
        endCol: p.loc.col + p.type.length,
      });
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
  commitParseState(state, rt);
  return { root, diagnostics: [...state.diagnostics] };
}
