import type { IRNode, IRSourceLocation } from './types.js';
import { KernParseError } from './errors.js';

let _parseWarnings: string[] = [];

// ── Token types ──────────────────────────────────────────────────────────

export type TokenKind =
  | 'identifier'    // [A-Za-z_][A-Za-z0-9_-]*
  | 'number'        // \d+
  | 'equals'        // =
  | 'quoted'        // "..."
  | 'expr'          // {{ ... }}
  | 'style'         // { ... }
  | 'themeRef'      // $name
  | 'slash'         // /path/segments
  | 'comma'         // ,
  | 'whitespace'    // spaces/tabs
  | 'unknown';      // anything else

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

// ── Tokenizer ────────────────────────────────────────────────────────────

function isIdentStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9') || ch === '-';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** Character-by-character tokenizer for a single KERN line (after indent stripped). */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    // Whitespace
    if (ch === ' ' || ch === '\t') {
      const start = i;
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
      tokens.push({ kind: 'whitespace', value: line.slice(start, i), pos: start });
      continue;
    }

    // Expression block {{ ... }}
    if (ch === '{' && i + 1 < line.length && line[i + 1] === '{') {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < line.length - 1 && depth > 0) {
        if (line[i] === '{' && line[i + 1] === '{') { depth++; i += 2; }
        else if (line[i] === '}' && line[i + 1] === '}') { depth--; if (depth === 0) break; i += 2; }
        else i++;
      }
      const inner = line.slice(start + 2, i).trim();
      i += 2;
      tokens.push({ kind: 'expr', value: inner, pos: start });
      continue;
    }

    // Style block { ... } — find matching } respecting quotes
    if (ch === '{') {
      const start = i;
      let inQuote = false;
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '"') inQuote = !inQuote;
        if (!inQuote && line[j] === '}') { j++; break; }
        j++;
      }
      tokens.push({ kind: 'style', value: line.slice(start + 1, j - 1), pos: start });
      i = j;
      continue;
    }

    // Quoted string "..." with \" escape support
    if (ch === '"') {
      const start = i;
      i++;
      let inner = '';
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) {
          const next = line[i + 1];
          if (next === '"') { inner += '"'; i += 2; }
          else if (next === '\\') { inner += '\\'; i += 2; }
          else { inner += line[i]; i++; }
        } else {
          inner += line[i];
          i++;
        }
      }
      i++; // skip closing quote
      tokens.push({ kind: 'quoted', value: inner, pos: start });
      continue;
    }

    // Theme ref $name
    if (ch === '$' && i + 1 < line.length && isIdentStart(line[i + 1])) {
      const start = i;
      i++;
      while (i < line.length && isIdentChar(line[i])) i++;
      tokens.push({ kind: 'themeRef', value: line.slice(start + 1, i), pos: start });
      continue;
    }

    // Equals
    if (ch === '=') {
      tokens.push({ kind: 'equals', value: '=', pos: i });
      i++;
      continue;
    }

    // Comma
    if (ch === ',') {
      tokens.push({ kind: 'comma', value: ',', pos: i });
      i++;
      continue;
    }

    // Slash-prefixed path: /something
    if (ch === '/') {
      const start = i;
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t' && line[i] !== '{' && line[i] !== '$') i++;
      tokens.push({ kind: 'slash', value: line.slice(start, i), pos: start });
      continue;
    }

    // Number (pure digits)
    if (isDigit(ch)) {
      const start = i;
      while (i < line.length && isDigit(line[i])) i++;
      tokens.push({ kind: 'number', value: line.slice(start, i), pos: start });
      continue;
    }

    // Identifier: [A-Za-z_][A-Za-z0-9_-]*
    // Handles evolved: prefix (evolved:keyword → strips prefix, returns keyword)
    if (isIdentStart(ch)) {
      const start = i;
      while (i < line.length && isIdentChar(line[i])) i++;
      if (line[i] === ':' && line.slice(start, i) === 'evolved' && i + 1 < line.length && isIdentStart(line[i + 1])) {
        i++;
        const nameStart = i;
        while (i < line.length && isIdentChar(line[i])) i++;
        tokens.push({ kind: 'identifier', value: line.slice(nameStart, i), pos: start });
      } else {
        tokens.push({ kind: 'identifier', value: line.slice(start, i), pos: start });
      }
      continue;
    }

    // Unknown character
    tokens.push({ kind: 'unknown', value: ch, pos: i });
    i++;
  }

  return tokens;
}

// ── Token stream ─────────────────────────────────────────────────────────
// Opus: class-based cursor. Codex contribution: consumeAnyValue for evolved hints.

class TokenStream {
  private tokens: Token[];
  private idx = 0;

  constructor(tokens: Token[]) { this.tokens = tokens; }

  peek(): Token | undefined { return this.tokens[this.idx]; }
  next(): Token | undefined { return this.tokens[this.idx++]; }
  done(): boolean { return this.idx >= this.tokens.length; }
  position(): number { return this.idx; }
  setPosition(pos: number): void { this.idx = pos; }

  skipWS(): void {
    while (this.idx < this.tokens.length && this.tokens[this.idx].kind === 'whitespace') this.idx++;
  }

  /** Try to consume an identifier. Returns its value or null. */
  tryIdent(): string | null {
    if (this.idx < this.tokens.length && this.tokens[this.idx].kind === 'identifier') {
      return this.tokens[this.idx++].value;
    }
    return null;
  }

  /** Try to consume a number token. Returns its value or null. */
  tryNumber(): string | null {
    if (this.idx < this.tokens.length && this.tokens[this.idx].kind === 'number') {
      return this.tokens[this.idx++].value;
    }
    return null;
  }

  /** Check if the next non-WS token is an identifier followed by '='. */
  isKeyValue(): boolean {
    let j = this.idx;
    while (j < this.tokens.length && this.tokens[j].kind === 'whitespace') j++;
    if (j >= this.tokens.length || this.tokens[j].kind !== 'identifier') return false;
    return j + 1 < this.tokens.length && this.tokens[j + 1].kind === 'equals';
  }

  /** Check if any remaining token contains '='. */
  hasEquals(): boolean {
    for (let j = this.idx; j < this.tokens.length; j++) {
      if (this.tokens[j].kind === 'equals') return true;
    }
    return false;
  }

  /** Check if there are more non-whitespace tokens. */
  hasMore(): boolean {
    let j = this.idx;
    while (j < this.tokens.length && this.tokens[j].kind === 'whitespace') j++;
    return j < this.tokens.length;
  }

  /** Get remaining raw text from current position (for fallback / params). */
  remainingRaw(line: string): string {
    if (this.idx >= this.tokens.length) return '';
    const startPos = this.tokens[this.idx].pos;
    this.idx = this.tokens.length;
    return line.slice(startPos);
  }

  /** Consume any single non-whitespace token as a value (for evolved positional args). */
  consumeAnyValue(): Token | undefined {
    this.skipWS();
    const tok = this.peek();
    if (!tok || tok.kind === 'whitespace') return undefined;
    return this.next();
  }
}

// ── Prop parsing (extracted from Codex's parsePropToken pattern) ──────────

/** Map a value token to its JS representation. */
function tokenValue(tok: Token): unknown {
  if (tok.kind === 'expr') return { __expr: true, code: tok.value };
  if (tok.kind === 'quoted') return tok.value;
  return tok.value;
}

/** Try to parse a key=value prop from the stream. Returns true if consumed. */
function parseProp(s: TokenStream, props: Record<string, unknown>): boolean {
  if (!s.isKeyValue()) return false;
  s.skipWS();
  const key = s.next()!.value; // identifier
  s.next(); // =
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

// ── ParsedLine ───────────────────────────────────────────────────────────

interface ParsedLine {
  indent: number;
  type: string;
  props: Record<string, unknown>;
  styles: Record<string, string>;
  pseudoStyles: Record<string, Record<string, string>>;
  themeRefs: string[];
  loc: IRSourceLocation;
}

const MULTILINE_BLOCK_TYPES = new Set(['logic', 'handler', 'cleanup', 'body']);

// ── Evolved Node Parser Hints (v4) ──────────────────────────────────────

interface ParserHintsConfig {
  positionalArgs?: string[];
  bareWord?: string;
  multilineBlock?: string;
}

const _parserHints = new Map<string, ParserHintsConfig>();

/** Register parser hints for an evolved node type. */
export function registerParserHints(keyword: string, hints: ParserHintsConfig): void {
  _parserHints.set(keyword, hints);
  if (hints.multilineBlock) {
    MULTILINE_BLOCK_TYPES.add(keyword);
  }
}

/** Unregister parser hints (for rollback/testing). */
export function unregisterParserHints(keyword: string): void {
  const hints = _parserHints.get(keyword);
  if (hints?.multilineBlock) {
    MULTILINE_BLOCK_TYPES.delete(keyword);
  }
  _parserHints.delete(keyword);
}

/** Clear all parser hints (for test isolation). */
export function clearParserHints(): void {
  for (const [keyword, hints] of _parserHints) {
    if (hints.multilineBlock) MULTILINE_BLOCK_TYPES.delete(keyword);
  }
  _parserHints.clear();
}

// ── Keyword handlers ─────────────────────────────────────────────────────

type KeywordHandler = (s: TokenStream, props: Record<string, unknown>, content: string) => void;

/** Consume a bare identifier into props if it's not a key=value pair. */
function consumeBareIdent(s: TokenStream, props: Record<string, unknown>, propName: string): void {
  s.skipWS();
  if (s.isKeyValue()) return;
  const id = s.tryIdent();
  if (id) props[propName] = id;
}

const KEYWORD_HANDLERS = new Map<string, KeywordHandler>([
  ['theme', (s, props) => {
    consumeBareIdent(s, props, 'name');
  }],

  ['import', (s, props) => {
    s.skipWS();
    const pos = s.position();
    const id = s.tryIdent();
    if (id === 'default') {
      if (!s.done() && s.peek()?.kind !== 'equals') {
        props.default = true;
        s.skipWS();
      } else if (s.peek()?.kind === 'equals') {
        s.setPosition(pos);
        return;
      } else {
        props.default = true;
        return;
      }
    } else if (id) {
      s.setPosition(pos);
    }
    if (!s.isKeyValue()) {
      s.skipWS();
      const name = s.tryIdent();
      if (name) props.name = name;
    }
  }],

  ['route', (s, props) => {
    s.skipWS();
    const pos = s.position();
    const verb = s.tryIdent();
    if (verb && /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/i.test(verb)) {
      props.method = verb.toLowerCase();
      s.skipWS();
      const tok = s.peek();
      if (tok && tok.kind === 'slash') {
        props.path = tok.value;
        s.next();
      }
    } else if (verb) {
      s.setPosition(pos);
    }
  }],

  ['params', (s, props, content) => {
    s.skipWS();
    const remaining = s.remainingRaw(content);
    if (remaining.length > 0) {
      const items: Array<{ name: string; type: string; default?: string }> = [];
      const parts = remaining.split(',').map(p => p.trim()).filter(Boolean);
      for (const part of parts) {
        const m = part.match(/^([A-Za-z_]\w*):([A-Za-z_]\w*(?:\[\])?)(?:\s*=\s*(.+))?$/);
        if (m) {
          const item: { name: string; type: string; default?: string } = { name: m[1], type: m[2] };
          if (m[3] !== undefined) item.default = m[3].trim();
          items.push(item);
        }
      }
      props.items = items;
    }
  }],

  ['auth', (s, props) => { consumeBareIdent(s, props, 'mode'); }],
  ['validate', (s, props) => { consumeBareIdent(s, props, 'schema'); }],

  ['error', (s, props) => {
    s.skipWS();
    const num = s.tryNumber();
    if (num) {
      props.status = parseInt(num, 10);
      s.skipWS();
      const tok = s.peek();
      if (tok && tok.kind === 'quoted') {
        props.message = tok.value;
        s.next();
      }
    }
  }],

  ['derive', (s, props) => { consumeBareIdent(s, props, 'name'); }],
  ['guard', (s, props) => { consumeBareIdent(s, props, 'name'); }],
  ['effect', (s, props) => { consumeBareIdent(s, props, 'name'); }],
  ['strategy', (s, props) => { consumeBareIdent(s, props, 'name'); }],
  ['trigger', (s, props) => { consumeBareIdent(s, props, 'kind'); }],

  ['respond', (s, props) => {
    s.skipWS();
    const num = s.tryNumber();
    if (num) props.status = parseInt(num, 10);
  }],

  // Rule syntax — native .kern lint rules
  ['rule', (s, props) => {
    // rule id severity=error category=bug confidence=0.9
    consumeBareIdent(s, props, 'id');
  }],

  ['message', (s, props) => {
    // message "template with {{interpolation}}"
    s.skipWS();
    const tok = s.peek();
    if (tok && tok.kind === 'quoted') {
      props.template = tok.value;
      s.next();
    }
  }],

  ['middleware', (s, props, content) => {
    s.skipWS();
    if (!s.hasMore()) return;
    if (s.hasEquals()) return;
    const remaining = s.remainingRaw(content).trim();
    if (remaining.length > 0) {
      const names = remaining.split(',').map(n => n.trim()).filter(Boolean);
      if (names.length > 1) { props.names = names; }
      else if (names.length === 1) { props.name = names[0]; }
    }
  }],
]);

// ── parseLine (token-based) ──────────────────────────────────────────────

function parseLine(raw: string, lineNum: number): ParsedLine | null {
  if (raw.trim() === '') return null;

  const indent = raw.search(/\S/);
  const content = raw.slice(indent);
  const col = indent + 1;

  const tokens = tokenizeLine(content);
  const s = new TokenStream(tokens);

  // First token must be an identifier (the node type)
  const typeToken = s.tryIdent();
  if (!typeToken) return null;
  const type = typeToken;

  const props: Record<string, unknown> = {};
  const styles: Record<string, string> = {};
  const pseudoStyles: Record<string, Record<string, string>> = {};
  const themeRefs: string[] = [];

  // ── Evolved node parser hints (v4) ──────────────────────────────────
  const evolvedHints = _parserHints.get(type);
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
    if (parseProp(s, props)) continue;

    // Unknown token — skip with warning
    const skipped = s.next()!;
    const errCol = col + skipped.pos;
    _parseWarnings.push(`Unexpected token "${skipped.value}" at line ${lineNum}:${errCol}`);
  }

  return {
    indent: indent / 2,
    type,
    props,
    styles,
    pseudoStyles,
    themeRefs,
    loc: { line: lineNum, col },
  };
}

// ── Style block parsing (unchanged) ──────────────────────────────────────

function splitStylePairs(block: string): string[] {
  const pairs: string[] = [];
  let current = '';
  let inQuote = false;
  let parenDepth = 0;

  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (!inQuote && ch === '(') {
      parenDepth++;
      current += ch;
    } else if (!inQuote && ch === ')') {
      parenDepth--;
      current += ch;
    } else if (!inQuote && parenDepth === 0 && ch === ',') {
      if (current.trim()) pairs.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) pairs.push(current.trim());
  return pairs;
}

function parseStyleBlock(
  block: string,
  styles: Record<string, string>,
  pseudoStyles: Record<string, Record<string, string>>,
): void {
  const pairs = splitStylePairs(block);
  for (const pair of pairs) {
    // Pseudo-selector: :press:bg:#005BB5
    const pseudoMatch = pair.match(/^:([a-z]+):([A-Za-z0-9_-]+):(.+)$/);
    if (pseudoMatch) {
      const [, pseudo, key, value] = pseudoMatch;
      if (!pseudoStyles[pseudo]) pseudoStyles[pseudo] = {};
      pseudoStyles[pseudo][key] = value.trim();
      continue;
    }

    // Quoted key: "backdrop-filter":"blur(8px)"
    const quotedKeyMatch = pair.match(/^"([^"]+)"\s*:\s*(.*)/);
    if (quotedKeyMatch) {
      const key = quotedKeyMatch[1];
      let value = quotedKeyMatch[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      styles[key] = value;
      continue;
    }

    // Normal: key:value (value may be quoted)
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      const key = pair.slice(0, colonIdx).trim();
      let value = pair.slice(colonIdx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      styles[key] = value;
    }
  }
}

function expandMinified(source: string): string {
  if (!source.includes('(') || source.split('\n').length > 2) return source;

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

/** Get warnings from the last parse() call */
export function getParseWarnings(): string[] { return [..._parseWarnings]; }

export function parse(source: string): IRNode {
  _parseWarnings = [];
  source = expandMinified(source);
  const lines = source.split('\n');
  const parsed: ParsedLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    const multilineType = [...MULTILINE_BLOCK_TYPES].find(type => trimmed.startsWith(`${type} <<<`));
    if (multilineType) {
      const indent = lines[i].search(/\S/);
      const codeLines: string[] = [];
      const startLine = i + 1;
      const blockOpen = `${multilineType} <<<`;
      const afterOpen = trimmed.slice(blockOpen.length);
      if (afterOpen.includes('>>>')) {
        codeLines.push(afterOpen.split('>>>')[0]);
      } else {
        i++;
        while (i < lines.length && !lines[i].trimStart().startsWith('>>>')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          const closeLine = lines[i];
          const closeIdx = closeLine.indexOf('>>>');
          if (closeIdx > 0) {
            const before = closeLine.slice(0, closeIdx).trim();
            if (before) codeLines.push(before);
          }
        }
      }
      parsed.push({
        indent: indent / 2,
        type: multilineType,
        props: { code: codeLines.join('\n').replace(/^\n+|\n+$/g, '') },
        styles: {},
        pseudoStyles: {},
        themeRefs: [],
        loc: { line: startLine, col: indent + 1 },
      });
      continue;
    }

    const p = parseLine(lines[i], i + 1);
    if (p) parsed.push(p);
  }

  if (parsed.length === 0) {
    return { type: 'document', children: [], loc: { line: 1, col: 1 } };
  }

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

  const root = toNode(parsed[0]);
  const stack: { node: IRNode; indent: number }[] = [{ node: root, indent: parsed[0].indent }];

  for (let i = 1; i < parsed.length; i++) {
    const p = parsed[i];
    const node = toNode(p);

    while (stack.length > 1 && stack[stack.length - 1].indent >= p.indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].node;
    if (!parent.children) parent.children = [];
    parent.children.push(node);
    stack.push({ node, indent: p.indent });
  }

  // Compute end-spans for autofix support
  computeEndSpans(root);

  return root;
}

/**
 * Parse KERN source into a document-wrapped IR tree.
 * Unlike parse(), this always returns a `document` root so multiple
 * top-level nodes (e.g., multiple `rule` definitions) are siblings.
 */
export function parseDocument(source: string): IRNode {
  _parseWarnings = [];
  source = expandMinified(source);
  const lines = source.split('\n');
  const parsed: ParsedLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    const multilineType = [...MULTILINE_BLOCK_TYPES].find(type => trimmed.startsWith(`${type} <<<`));
    if (multilineType) {
      const indent = lines[i].search(/\S/);
      const codeLines: string[] = [];
      const startLine = i + 1;
      const blockOpen = `${multilineType} <<<`;
      const afterOpen = trimmed.slice(blockOpen.length);
      if (afterOpen.includes('>>>')) {
        codeLines.push(afterOpen.split('>>>')[0]);
      } else {
        i++;
        while (i < lines.length && !lines[i].trimStart().startsWith('>>>')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          const closeLine = lines[i];
          const closeIdx = closeLine.indexOf('>>>');
          if (closeIdx > 0) {
            const before = closeLine.slice(0, closeIdx).trim();
            if (before) codeLines.push(before);
          }
        }
      }
      parsed.push({
        indent: indent / 2,
        type: multilineType,
        props: { code: codeLines.join('\n').replace(/^\n+|\n+$/g, '') },
        styles: {},
        pseudoStyles: {},
        themeRefs: [],
        loc: { line: startLine, col: indent + 1 },
      });
      continue;
    }

    const p = parseLine(lines[i], i + 1);
    if (p) parsed.push(p);
  }

  if (parsed.length === 0) {
    return { type: 'document', children: [], loc: { line: 1, col: 1 } };
  }

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

  const doc: IRNode = { type: 'document', children: [], loc: { line: 1, col: 1 } };
  const stack: { node: IRNode; indent: number }[] = [{ node: doc, indent: -1 }];

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    const node = toNode(p);

    while (stack.length > 1 && stack[stack.length - 1].indent >= p.indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].node;
    if (!parent.children) parent.children = [];
    parent.children.push(node);
    stack.push({ node, indent: p.indent });
  }

  computeEndSpans(doc);
  return doc;
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
    node.loc.endLine = node.loc.line;
    node.loc.endCol = node.loc.col;
  }
}
