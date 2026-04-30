/** Expression-mode tokenizer + recursive-descent parser producing ValueIR.
 *  Supports: identifiers, literals (number/string/true/false/null/undefined/none),
 *  member access (. and ?.), call (() and ?.()), spread (...), logical ?? || &&,
 *  parenthesized grouping, template literals with ${...} interpolation,
 *  `await` prefix, propagation `?` postfix on call/await-call.
 *
 *  `none` is a KERN-side alias for `null` — both produce nullLit. Per native-handler
 *  spec, `none` is the canonical empty-value form in `lang=kern` bodies; `null` is
 *  retained for legacy/round-trip compatibility.
 *
 *  Intentionally NOT yet supported: arithmetic, comparisons, ternary, indexing,
 *  bitwise, assignment. Those land in a later slice. */

import type { ValueIR } from './value-ir.js';

// ── Tokenizer ────────────────────────────────────────────────────────────

export type ExprTokenKind =
  | 'ident'
  | 'num'
  | 'str'
  | 'tmplStart'
  | 'dot'
  | 'optDot'
  | 'nullish'
  | 'or'
  | 'and'
  | 'lparen'
  | 'rparen'
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'colon'
  | 'comma'
  | 'spread'
  | 'qmark'
  | 'eq'
  | 'neq'
  | 'strictEq'
  | 'strictNeq'
  | 'bang'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'percent'
  | 'kwNull'
  | 'kwUndef'
  | 'kwTrue'
  | 'kwFalse'
  | 'kwAwait'
  | 'kwNew'
  | 'eof';

export interface ExprToken {
  kind: ExprTokenKind;
  value: string;
  pos: number;
}

const KEYWORDS: Record<string, ExprTokenKind> = {
  null: 'kwNull',
  none: 'kwNull',
  undefined: 'kwUndef',
  true: 'kwTrue',
  false: 'kwFalse',
  await: 'kwAwait',
  new: 'kwNew',
};

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_' || ch === '$';
}

function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function isHexDigit(ch: string): boolean {
  return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function consumeDigitsStrict(input: string, start: number, isValid: (c: string) => boolean): number {
  let i = start;
  let started = false;
  let lastWasUnderscore = false;
  while (i < input.length) {
    const c = input[i];
    if (isValid(c)) {
      lastWasUnderscore = false;
      started = true;
      i++;
    } else if (c === '_' && started && !lastWasUnderscore && i + 1 < input.length && isValid(input[i + 1])) {
      lastWasUnderscore = true;
      i++;
    } else {
      break;
    }
  }
  return i;
}

function consumeNumber(input: string, start: number): number {
  let i = start;
  const ch = input[i];
  if (ch === '0' && i + 1 < input.length) {
    const next = input[i + 1];
    let validator: ((c: string) => boolean) | null = null;
    if (next === 'x' || next === 'X') validator = isHexDigit;
    else if (next === 'b' || next === 'B') validator = (c) => c === '0' || c === '1';
    else if (next === 'o' || next === 'O') validator = (c) => c >= '0' && c <= '7';
    if (validator) {
      const after = consumeDigitsStrict(input, i + 2, validator);
      if (after === i + 2) return start;
      i = after;
      if (i < input.length && input[i] === 'n') i++;
      return i;
    }
  }
  const hasInt = isDigit(ch);
  let j = hasInt ? consumeDigitsStrict(input, i, isDigit) : i;
  let hasFrac = false;
  if (j < input.length && input[j] === '.' && j + 1 < input.length && isDigit(input[j + 1])) {
    j++;
    j = consumeDigitsStrict(input, j, isDigit);
    hasFrac = true;
  }
  if (!hasInt && !hasFrac) return start;
  if (!hasFrac && j < input.length && input[j] === 'n') {
    j++;
  } else if (hasFrac && j < input.length && input[j] === 'n') {
    throw new Error(`BigInt literal cannot have a fractional part at column ${start + 1}`);
  }
  return j;
}

function consumeString(input: string, start: number): { end: number; value: string } {
  const quote = input[start];
  let i = start + 1;
  let value = '';
  while (i < input.length && input[i] !== quote) {
    if (input[i] === '\\' && i + 1 < input.length) {
      const next = input[i + 1];
      if (next === quote) {
        value += quote;
        i += 2;
      } else if (next === '\\') {
        value += '\\';
        i += 2;
      } else if (next === 'n') {
        value += '\n';
        i += 2;
      } else if (next === 't') {
        value += '\t';
        i += 2;
      } else {
        value += input[i];
        i++;
      }
    } else {
      value += input[i];
      i++;
    }
  }
  if (i >= input.length) throw new Error(`Unclosed string starting at column ${start + 1}`);
  return { end: i + 1, value };
}

/** Tokenize an expression source. Stops at end of input. */
export function tokenizeExpression(input: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i++;
      continue;
    }

    if (ch === '`') {
      const start = i;
      i = scanTemplateEnd(input, i + 1);
      tokens.push({ kind: 'tmplStart', value: '`', pos: start });
      continue;
    }

    if (ch === '?' && input[i + 1] === '.') {
      tokens.push({ kind: 'optDot', value: '?.', pos: i });
      i += 2;
      continue;
    }
    if (ch === '?' && input[i + 1] === '?') {
      tokens.push({ kind: 'nullish', value: '??', pos: i });
      i += 2;
      continue;
    }
    if (ch === '?') {
      tokens.push({ kind: 'qmark', value: '?', pos: i });
      i++;
      continue;
    }
    // Slice 2c — equality / strict-equality / negation. Multi-char first.
    if (ch === '=' && input[i + 1] === '=' && input[i + 2] === '=') {
      tokens.push({ kind: 'strictEq', value: '===', pos: i });
      i += 3;
      continue;
    }
    if (ch === '=' && input[i + 1] === '=') {
      tokens.push({ kind: 'eq', value: '==', pos: i });
      i += 2;
      continue;
    }
    if (ch === '!' && input[i + 1] === '=' && input[i + 2] === '=') {
      tokens.push({ kind: 'strictNeq', value: '!==', pos: i });
      i += 3;
      continue;
    }
    if (ch === '!' && input[i + 1] === '=') {
      tokens.push({ kind: 'neq', value: '!=', pos: i });
      i += 2;
      continue;
    }
    if (ch === '!') {
      tokens.push({ kind: 'bang', value: '!', pos: i });
      i++;
      continue;
    }
    // Slice 2c — relational. Multi-char first so `<=` / `>=` win over bare `<` / `>`.
    if (ch === '<' && input[i + 1] === '=') {
      tokens.push({ kind: 'lte', value: '<=', pos: i });
      i += 2;
      continue;
    }
    if (ch === '<') {
      tokens.push({ kind: 'lt', value: '<', pos: i });
      i++;
      continue;
    }
    if (ch === '>' && input[i + 1] === '=') {
      tokens.push({ kind: 'gte', value: '>=', pos: i });
      i += 2;
      continue;
    }
    if (ch === '>') {
      tokens.push({ kind: 'gt', value: '>', pos: i });
      i++;
      continue;
    }
    // Slice 2c — arithmetic. `-` could be sign of a number, but the number
    // tokenizer below handles only unsigned literals; unary minus is a parser
    // concern (see parseUnary), so keep `-` as its own token here.
    if (ch === '+') {
      tokens.push({ kind: 'plus', value: '+', pos: i });
      i++;
      continue;
    }
    if (ch === '-') {
      tokens.push({ kind: 'minus', value: '-', pos: i });
      i++;
      continue;
    }
    if (ch === '*') {
      tokens.push({ kind: 'star', value: '*', pos: i });
      i++;
      continue;
    }
    if (ch === '/') {
      tokens.push({ kind: 'slash', value: '/', pos: i });
      i++;
      continue;
    }
    if (ch === '%') {
      tokens.push({ kind: 'percent', value: '%', pos: i });
      i++;
      continue;
    }
    if (ch === '|' && input[i + 1] === '|') {
      tokens.push({ kind: 'or', value: '||', pos: i });
      i += 2;
      continue;
    }
    if (ch === '&' && input[i + 1] === '&') {
      tokens.push({ kind: 'and', value: '&&', pos: i });
      i += 2;
      continue;
    }
    if (ch === '.' && input[i + 1] === '.' && input[i + 2] === '.') {
      tokens.push({ kind: 'spread', value: '...', pos: i });
      i += 3;
      continue;
    }
    // Number must be checked BEFORE bare-dot so leading-dot floats (.5) lex as num
    if (isDigit(ch) || (ch === '.' && i + 1 < input.length && isDigit(input[i + 1]))) {
      const end = consumeNumber(input, i);
      if (end > i) {
        tokens.push({ kind: 'num', value: input.slice(i, end), pos: i });
        i = end;
        continue;
      }
    }
    if (ch === '.') {
      tokens.push({ kind: 'dot', value: '.', pos: i });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: '(', pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ')', pos: i });
      i++;
      continue;
    }
    if (ch === '{') {
      tokens.push({ kind: 'lbrace', value: '{', pos: i });
      i++;
      continue;
    }
    if (ch === '}') {
      tokens.push({ kind: 'rbrace', value: '}', pos: i });
      i++;
      continue;
    }
    if (ch === '[') {
      tokens.push({ kind: 'lbracket', value: '[', pos: i });
      i++;
      continue;
    }
    if (ch === ']') {
      tokens.push({ kind: 'rbracket', value: ']', pos: i });
      i++;
      continue;
    }
    if (ch === ':') {
      tokens.push({ kind: 'colon', value: ':', pos: i });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', value: ',', pos: i });
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const { end, value } = consumeString(input, i);
      tokens.push({ kind: 'str', value, pos: i });
      // Preserve raw form for codegen quote-style preservation
      (tokens[tokens.length - 1] as ExprToken & { quote?: string }).quote = ch;
      i = end;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      while (i < input.length && isIdentChar(input[i])) i++;
      const word = input.slice(start, i);
      const kw = KEYWORDS[word];
      if (kw) {
        tokens.push({ kind: kw, value: word, pos: start });
      } else {
        tokens.push({ kind: 'ident', value: word, pos: start });
      }
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at column ${i + 1}`);
  }
  tokens.push({ kind: 'eof', value: '', pos: i });
  return tokens;
}

// ── Parser ───────────────────────────────────────────────────────────────

class Parser {
  private i = 0;
  constructor(
    private tokens: ExprToken[],
    private input: string,
  ) {}

  private peek(offset = 0): ExprToken {
    return this.tokens[this.i + offset];
  }
  private advance(): ExprToken {
    return this.tokens[this.i++];
  }
  private expect(kind: ExprTokenKind): ExprToken {
    const t = this.peek();
    if (t.kind !== kind) throw new Error(`Expected ${kind}, got ${t.kind} ('${t.value}') at column ${t.pos + 1}`);
    return this.advance();
  }

  parse(): ValueIR {
    const result = this.parseNullish();
    if (this.peek().kind !== 'eof') {
      const t = this.peek();
      throw new Error(`Unexpected token ${t.kind} ('${t.value}') at column ${t.pos + 1}`);
    }
    return result;
  }

  private parseNullish(): ValueIR {
    let left = this.parseOr();
    while (this.peek().kind === 'nullish') {
      this.advance();
      const right = this.parseOr();
      left = { kind: 'binary', op: '??', left, right };
    }
    return left;
  }

  private parseOr(): ValueIR {
    let left = this.parseAnd();
    while (this.peek().kind === 'or') {
      this.advance();
      const right = this.parseAnd();
      left = { kind: 'binary', op: '||', left, right };
    }
    return left;
  }

  private parseAnd(): ValueIR {
    let left = this.parseEquality();
    while (this.peek().kind === 'and') {
      this.advance();
      const right = this.parseEquality();
      left = { kind: 'binary', op: '&&', left, right };
    }
    return left;
  }

  // Slice 2c — equality (==, !=, ===, !==), left-associative.
  private parseEquality(): ValueIR {
    let left = this.parseRelational();
    while (true) {
      const k = this.peek().kind;
      if (k !== 'eq' && k !== 'neq' && k !== 'strictEq' && k !== 'strictNeq') break;
      const op = this.advance().value as '==' | '!=' | '===' | '!==';
      const right = this.parseRelational();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  // Slice 2c — relational (<, <=, >, >=), left-associative.
  private parseRelational(): ValueIR {
    let left = this.parseAdditive();
    while (true) {
      const k = this.peek().kind;
      if (k !== 'lt' && k !== 'lte' && k !== 'gt' && k !== 'gte') break;
      const op = this.advance().value as '<' | '<=' | '>' | '>=';
      const right = this.parseAdditive();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  // Slice 2c — additive (+, -), left-associative.
  private parseAdditive(): ValueIR {
    let left = this.parseMultiplicative();
    while (true) {
      const k = this.peek().kind;
      if (k !== 'plus' && k !== 'minus') break;
      const op = this.advance().value as '+' | '-';
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  // Slice 2c — multiplicative (*, /, %), left-associative.
  private parseMultiplicative(): ValueIR {
    let left = this.parseUnary();
    while (true) {
      const k = this.peek().kind;
      if (k !== 'star' && k !== 'slash' && k !== 'percent') break;
      const op = this.advance().value as '*' | '/' | '%';
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): ValueIR {
    if (this.peek().kind === 'spread') {
      this.advance();
      return { kind: 'spread', argument: this.parseUnary() };
    }
    if (this.peek().kind === 'bang') {
      this.advance();
      return { kind: 'unary', op: '!', argument: this.parseUnary() };
    }
    if (this.peek().kind === 'minus') {
      this.advance();
      return { kind: 'unary', op: '-', argument: this.parseUnary() };
    }
    if (this.peek().kind === 'kwAwait') {
      this.advance();
      // Use parseCall (not parsePostfix) so the trailing `?` stays available
      // for the outer await + propagation composition. With parsePostfix the
      // `?` would bind to the call alone, producing `await(propagate(call()))`
      // instead of the semantically-correct `propagate(await(call()))`.
      const argument = this.parseCall();
      const awaited: ValueIR = { kind: 'await', argument };
      if (this.peek().kind === 'qmark') {
        this.advance();
        return { kind: 'propagate', argument: awaited, op: '?' };
      }
      return awaited;
    }
    if (this.peek().kind === 'kwNew') {
      this.advance();
      // 'new' typically binds to a call expression: `new Error("oops")`
      const argument = this.parseCall();
      return { kind: 'new', argument };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ValueIR {
    const node = this.parseCall();
    if (this.peek().kind === 'qmark') {
      this.advance();
      return { kind: 'propagate', argument: node, op: '?' };
    }
    return node;
  }

  private parseCall(): ValueIR {
    let node = this.parsePrimary();
    while (true) {
      const t = this.peek();
      if (t.kind === 'dot') {
        this.advance();
        const name = this.expect('ident');
        node = { kind: 'member', object: node, property: name.value, optional: false };
      } else if (t.kind === 'optDot') {
        this.advance();
        const next = this.peek();
        if (next.kind === 'lparen') {
          this.advance();
          const args = this.parseArgs();
          this.expect('rparen');
          node = { kind: 'call', callee: node, args, optional: true };
        } else {
          const name = this.expect('ident');
          node = { kind: 'member', object: node, property: name.value, optional: true };
        }
      } else if (t.kind === 'lparen') {
        this.advance();
        const args = this.parseArgs();
        this.expect('rparen');
        node = { kind: 'call', callee: node, args, optional: false };
      } else {
        break;
      }
    }
    return node;
  }

  private parseArgs(): ValueIR[] {
    const args: ValueIR[] = [];
    if (this.peek().kind === 'rparen') return args;
    args.push(this.parseNullish());
    while (this.peek().kind === 'comma') {
      this.advance();
      args.push(this.parseNullish());
    }
    return args;
  }

  private parsePrimary(): ValueIR {
    const t = this.peek();
    switch (t.kind) {
      case 'ident':
        this.advance();
        return { kind: 'ident', name: t.value };
      case 'num': {
        this.advance();
        const raw = t.value;
        const isBig = raw.endsWith('n');
        const numStr = isBig ? raw.slice(0, -1).replace(/_/g, '') : raw.replace(/_/g, '');
        const value = isBig ? 0 : Number(numStr);
        return isBig ? { kind: 'numLit', value, bigint: true, raw } : { kind: 'numLit', value, raw };
      }
      case 'str': {
        this.advance();
        const quote = ((t as ExprToken & { quote?: string }).quote ?? '"') as '"' | "'";
        return { kind: 'strLit', value: t.value, quote };
      }
      case 'kwTrue':
        this.advance();
        return { kind: 'boolLit', value: true };
      case 'kwFalse':
        this.advance();
        return { kind: 'boolLit', value: false };
      case 'kwNull':
        this.advance();
        return { kind: 'nullLit' };
      case 'kwUndef':
        this.advance();
        return { kind: 'undefLit' };
      case 'lparen': {
        this.advance();
        const inner = this.parseNullish();
        this.expect('rparen');
        return inner;
      }
      case 'lbrace':
        this.advance();
        return this.parseObjectLiteral();
      case 'lbracket':
        this.advance();
        return this.parseArrayLiteral();
      case 'tmplStart':
        this.advance();
        return this.parseTemplate(t.pos);
      default:
        throw new Error(`Unexpected token ${t.kind} ('${t.value}') at column ${t.pos + 1}`);
    }
  }

  // Slice 2d — object literal: `{ key: value, "str-key": value }`. Computed
  // keys (`[expr]:`) defer to slice 3.
  private parseObjectLiteral(): ValueIR {
    const entries: ({ key: string; value: ValueIR } | { kind: 'spread'; argument: ValueIR })[] = [];
    if (this.peek().kind === 'rbrace') {
      this.advance();
      return { kind: 'objectLit', entries };
    }
    while (true) {
      const keyTok = this.peek();
      if (keyTok.kind === 'spread') {
        this.advance();
        const argument = this.parseNullish();
        entries.push({ kind: 'spread', argument });
      } else {
        let key: string;
        if (keyTok.kind === 'ident') {
          key = keyTok.value;
          this.advance();
        } else if (keyTok.kind === 'str') {
          key = keyTok.value;
          this.advance();
        } else {
          throw new Error(`Object literal key must be an identifier, string, or spread at column ${keyTok.pos + 1}`);
        }
        this.expect('colon');
        const value = this.parseNullish();
        entries.push({ key, value });
      }
      if (this.peek().kind === 'comma') {
        this.advance();
        // Trailing comma allowed.
        if (this.peek().kind === 'rbrace') break;
        continue;
      }
      break;
    }
    this.expect('rbrace');
    return { kind: 'objectLit', entries };
  }

  // Slice 2d — array literal: `[a, b, c]`.
  private parseArrayLiteral(): ValueIR {
    const items: ValueIR[] = [];
    if (this.peek().kind === 'rbracket') {
      this.advance();
      return { kind: 'arrayLit', items };
    }
    while (true) {
      items.push(this.parseNullish());
      if (this.peek().kind === 'comma') {
        this.advance();
        if (this.peek().kind === 'rbracket') break;
        continue;
      }
      break;
    }
    this.expect('rbracket');
    return { kind: 'arrayLit', items };
  }

  private parseTemplate(startPos: number): ValueIR {
    // After consuming opening backtick, scan source from token's source position + 1
    // We don't have nice token-stream coverage of template guts (the tokenizer treated
    // ` as just a marker), so re-scan the raw input.
    const quasis: string[] = [];
    const expressions: ValueIR[] = [];
    let pos = startPos + 1;
    let buf = '';
    while (pos < this.input.length) {
      const ch = this.input[pos];
      if (ch === '`') {
        quasis.push(buf);
        // Re-sync the parent tokenizer by setting `i` past this template.
        // Find the corresponding eof or token at this pos.
        this.resyncAfter(pos + 1);
        return { kind: 'tmplLit', quasis, expressions };
      }
      if (ch === '\\' && pos + 1 < this.input.length) {
        const next = this.input[pos + 1];
        if (next === '`') {
          buf += '`';
          pos += 2;
          continue;
        }
        if (next === '\\') {
          buf += '\\';
          pos += 2;
          continue;
        }
        if (next === '$') {
          buf += '$';
          pos += 2;
          continue;
        }
        if (next === 'n') {
          buf += '\n';
          pos += 2;
          continue;
        }
        if (next === 't') {
          buf += '\t';
          pos += 2;
          continue;
        }
        buf += ch;
        pos++;
        continue;
      }
      if (ch === '$' && this.input[pos + 1] === '{') {
        quasis.push(buf);
        buf = '';
        pos += 2;
        const exprEnd = findMatchingBrace(this.input, pos);
        const exprSrc = this.input.slice(pos, exprEnd);
        const innerTokens = tokenizeExpression(exprSrc);
        const innerParser = new Parser(innerTokens, exprSrc);
        expressions.push(innerParser.parse());
        pos = exprEnd + 1;
        continue;
      }
      buf += ch;
      pos++;
    }
    throw new Error(`Unclosed template literal starting at column ${startPos + 1}`);
  }

  private resyncAfter(pos: number): void {
    // Drop any tokens whose pos < `pos` from being re-consumed; jump past them.
    while (this.i < this.tokens.length && this.tokens[this.i].pos < pos) this.i++;
  }
}

function scanTemplateEnd(input: string, start: number): number {
  let i = start;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      i += 2;
      continue;
    }
    if (ch === '`') return i + 1;
    if (ch === '$' && input[i + 1] === '{') {
      i = findMatchingBrace(input, i + 2) + 1;
      continue;
    }
    i++;
  }
  throw new Error(`Unclosed template literal starting at column ${start}`);
}

function findMatchingBrace(input: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    } else if (ch === '`') {
      i = scanTemplateEnd(input, i + 1);
      continue;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < input.length && input[j] !== ch) {
        if (input[j] === '\\') j += 2;
        else j++;
      }
      i = j;
    }
    i++;
  }
  throw new Error(`Unclosed \${...} substitution starting at column ${start + 1}`);
}

export function parseExpression(input: string): ValueIR {
  const tokens = tokenizeExpression(input);
  const parser = new Parser(tokens, input);
  return parser.parse();
}
