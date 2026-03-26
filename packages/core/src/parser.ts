import type { IRNode, IRSourceLocation, ParseDiagnostic, ParseErrorCode, ParseResult } from './types.js';
import { KernParseError } from './errors.js';
import { isKnownNodeType } from './spec.js';

interface ParseState {
  diagnostics: ParseDiagnostic[];
}

interface EmitDiagnosticOptions {
  endCol?: number;
  suggestion?: string;
}

let _lastParseDiagnostics: ParseDiagnostic[] = [];

const DIAGNOSTIC_SUGGESTIONS: Record<ParseErrorCode, string> = {
  UNCLOSED_EXPR: 'Close the `{{ ... }}` expression or move the unfinished code into a quoted string.',
  UNCLOSED_STYLE: 'Close the `{ ... }` style block with `}` and keep any commas inside the block.',
  UNCLOSED_STRING: 'Add the missing closing quote or escape any embedded quotes inside the string.',
  UNEXPECTED_TOKEN: 'Remove the stray token or quote it so the parser can treat it as a value.',
  EMPTY_DOCUMENT: 'Add at least one root KERN node such as `screen`, `view`, or `text`.',
  INVALID_INDENT: 'Replace tabs with spaces so indentation is consistent across sibling nodes.',
  UNKNOWN_NODE_TYPE: 'Rename this node to a supported KERN keyword or register it as an evolved node type.',
  INDENT_JUMP: 'Align this line with an existing indentation level so the parent-child structure is unambiguous.',
  DUPLICATE_PROP: 'Remove the duplicate property or merge the values into a single prop assignment.',
  DROPPED_LINE: 'Rewrite this line so it starts with a valid KERN node type and move stray symbols into props.',
};

function createParseState(): ParseState {
  return { diagnostics: [] };
}

function commitParseState(state: ParseState): void {
  _lastParseDiagnostics = state.diagnostics.map(d => ({ ...d }));
}

function emitDiagnostic(
  state: ParseState,
  code: ParseErrorCode,
  severity: ParseDiagnostic['severity'],
  message: string,
  line: number,
  col: number,
  options: EmitDiagnosticOptions = {},
): void {
  state.diagnostics.push({
    code,
    severity,
    message,
    line,
    col,
    endCol: Math.max(options.endCol ?? (col + 1), col),
    suggestion: options.suggestion ?? DIAGNOSTIC_SUGGESTIONS[code],
  });
}

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
function tokenizeLineInternal(line: string, state?: ParseState): Token[] {
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
      if (depth > 0) {
        if (state) {
          emitDiagnostic(state, 'UNCLOSED_EXPR', 'error', `Unclosed expression block '{{' at column ${start + 1}`, 0, start + 1, { endCol: start + 3 });
        }
      }
      const inner = line.slice(start + 2, i).trim();
      if (i < line.length - 1) i += 2; else i = line.length;
      tokens.push({ kind: 'expr', value: inner, pos: start });
      continue;
    }

    // Style block { ... } — find matching } respecting quotes
    if (ch === '{') {
      const start = i;
      let inQuote = false;
      let j = i + 1;
      let closed = false;
      while (j < line.length) {
        if (line[j] === '\\' && j + 1 < line.length) { j += 2; continue; }
        if (line[j] === '"') inQuote = !inQuote;
        if (!inQuote && line[j] === '}') { j++; closed = true; break; }
        j++;
      }
      if (!closed) {
        if (state) {
          emitDiagnostic(state, 'UNCLOSED_STYLE', 'error', `Unclosed style block '{' at column ${start + 1}`, 0, start + 1, { endCol: start + 2 });
        }
      }
      tokens.push({ kind: 'style', value: line.slice(start + 1, closed ? j - 1 : j), pos: start });
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
      if (i >= line.length) {
        if (state) {
          emitDiagnostic(state, 'UNCLOSED_STRING', 'error', `Unclosed quoted string at column ${start + 1}`, 0, start + 1, { endCol: start + 2 });
        }
      } else {
        i++; // skip closing quote
      }
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

export function tokenizeLine(line: string): Token[] {
  return tokenizeLineInternal(line);
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

function parseLine(state: ParseState, raw: string, lineNum: number): ParsedLine | null {
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
  if (!isKnownNodeType(type) && !MULTILINE_BLOCK_TYPES.has(type)) {
    emitDiagnostic(state, 'UNKNOWN_NODE_TYPE', 'warning', `Unknown node type '${type}' at line ${lineNum}`, lineNum, col, {
      endCol: col + type.length,
    });
  }

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

// ── Style block parsing (unchanged) ──────────────────────────────────────

function splitStylePairs(block: string): string[] {
  const pairs: string[] = [];
  let current = '';
  let inQuote = false;
  let parenDepth = 0;

  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '\\' && i + 1 < block.length) {
      current += ch + block[i + 1];
      i++;
    } else if (ch === '"') {
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
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
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
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      styles[key] = value;
    }
  }
}

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

/** Get warnings from the last parse() call */
export function getParseWarnings(): string[] {
  return _lastParseDiagnostics.map(d => d.message);
}

// ── Shared parse helpers ─────────────────────────────────────────────────

/** Process source lines into ParsedLine entries (multiline blocks + regular lines). */
function parseLines(state: ParseState, source: string): ParsedLine[] {
  const lines = expandMinified(source).split('\n');
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

    const p = parseLine(state, lines[i], i + 1);
    if (p) parsed.push(p);
  }

  return parsed;
}

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

// ── Public parse API ─────────────────────────────────────────────────────

/**
 * Parse KERN source into an IR tree. The first node becomes the root.
 * WARNING: For multi-root content (e.g., multiple `rule` definitions),
 * use `parseDocument()` instead — this function treats subsequent
 * top-level nodes as children of the first node.
 * @see parseDocument
 */
function parseInternal(source: string, asDocument: boolean): ParseResult {
  const state = createParseState();
  const parsed = parseLines(state, source);

  if (parsed.length === 0) {
    if (source.trim() === '') {
      emitDiagnostic(state, 'EMPTY_DOCUMENT', 'info', 'Source document is empty', 1, 1, { endCol: 1 });
    }
    const root = { type: 'document', children: [], loc: { line: 1, col: 1, endLine: 1, endCol: 1 } };
    commitParseState(state);
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
  commitParseState(state);
  return { root, diagnostics: [...state.diagnostics] };
}

export function parse(source: string): IRNode {
  return parseInternal(source, false).root;
}

/**
 * Parse KERN source into a document-wrapped IR tree.
 * Unlike parse(), this always returns a `document` root so multiple
 * top-level nodes (e.g., multiple `rule` definitions) are siblings.
 */
export function parseDocument(source: string): IRNode {
  return parseInternal(source, true).root;
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

// ── Diagnostics API ──────────────────────────────────────────────────────

/** Get structured diagnostics from the last parse() call. */
export function getParseDiagnostics(): ParseDiagnostic[] { return [..._lastParseDiagnostics]; }

/** Parse with diagnostics — returns both tree and structured diagnostics. */
export function parseWithDiagnostics(source: string): ParseResult {
  return parseInternal(source, false);
}

/** Parse with diagnostics (document mode). */
export function parseDocumentWithDiagnostics(source: string): ParseResult {
  return parseInternal(source, true);
}

/** Strict parse — throws KernParseError if any diagnostic has severity=error. */
export function parseStrict(source: string): IRNode {
  const { root, diagnostics } = parseWithDiagnostics(source);
  const errors = diagnostics.filter(d => d.severity === 'error');
  if (errors.length > 0) {
    const first = errors[0];
    const err = new KernParseError(first.message, first.line, first.col, source);
    err.diagnostics = diagnostics;
    throw err;
  }
  return root;
}

/** Strict document parse — throws KernParseError if any diagnostic has severity=error. */
export function parseDocumentStrict(source: string): IRNode {
  const { root, diagnostics } = parseDocumentWithDiagnostics(source);
  const errors = diagnostics.filter(d => d.severity === 'error');
  if (errors.length > 0) {
    const first = errors[0];
    const err = new KernParseError(first.message, first.line, first.col, source);
    err.diagnostics = diagnostics;
    throw err;
  }
  return root;
}
