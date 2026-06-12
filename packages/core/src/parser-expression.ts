/** Expression-mode tokenizer + recursive-descent parser producing ValueIR.
 *  Supports: identifiers, literals (number/string/true/false/null/undefined/none),
 *  member access (. and ?.), index access ([] and ?.[), call (() and ?.()), spread
 *  (...), expression-bodied lambdas (`x => x.id`), logical ?? || &&, parenthesized grouping, template literals with
 *  ${...} interpolation, regex literals, `await`/`typeof` prefix, TS-style `as Type` assertion nodes,
 *  propagation `?` postfix on call/await-call.
 *
 *  `none` is a KERN-side alias for `null` — both produce nullLit. Per native-handler
 *  spec, `none` is the canonical empty-value form in `lang=kern` bodies; `null` is
 *  retained for legacy/round-trip compatibility.
 *
 *  Slice 2c added arithmetic and comparisons; slice α-2 added ternary
 *  `a ? b : c`. Still NOT supported: bitwise ops, assignment — these would
 *  require shape changes the body emitter doesn't have, so the parser
 *  deliberately rejects them. */

import { classifyClosureBlock, parseClosureBlockAst } from './closure-eligibility.js';
import type { ValueIR } from './value-ir.js';

// ── Tokenizer ────────────────────────────────────────────────────────────

export type ExprTokenKind =
  | 'ident'
  | 'num'
  | 'str'
  | 'regex'
  | 'tmplStart'
  | 'dot'
  | 'optDot'
  | 'nullish'
  | 'or'
  | 'and'
  | 'pipe'
  | 'amp'
  // Slice 6 — bitwise / shift operators on the ToInt32 substrate.
  | 'caret' // ^ (bitwise XOR)
  | 'tilde' // ~ (bitwise NOT, unary prefix)
  | 'shl' // << (left shift)
  | 'shr' // >> (signed right shift)
  | 'ushr' // >>> (unsigned/zero-fill right shift)
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
  | 'arrow'
  | 'closureBlock'
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
  /** Source-end offset (exclusive). Only set on tokens where `value.length`
   *  doesn't match the source span — `str` (quotes + escapes), `regex`
   *  (slashes + flags), and `tmplStart` (the whole template body is consumed
   *  but the token's `value` is just the opening backtick). For all other
   *  tokens `end` is undefined and callers should fall back to
   *  `pos + value.length`. Use the `tokenEnd(t)` helper to avoid the
   *  truncate-trailing-string bug that used to mangle e.g.
   *  `'x' as 'a' | 'b' | 'c'` into `'x' as 'a' | 'b' | 'c` because
   *  `pos + value.length` of the final str token landed ON the closing
   *  quote, not past it. */
  end?: number;
}

/** Authoritative source-end (exclusive) for a token. See `ExprToken.end`. */
function tokenEnd(t: ExprToken): number {
  return t.end ?? t.pos + t.value.length;
}

/** Slice α-2: token kinds that can start an expression. Used by parsePostfix
 *  and the await branch of parseUnary to disambiguate postfix `?`
 *  (propagation) from ternary `?` (which is always followed by an expression).
 *  If the token AFTER `?` is in this set, the `?` belongs to the outer
 *  ternary (parseConditional); otherwise, it's propagation.
 *
 *  `plus` is not in the set — KERN's parseUnary doesn't accept unary `+`.
 *  `kwNew` isn't in the set — `new` is matched by parseUnary as an `ident`
 *  token with value `'new'`. */
const EXPR_START_KINDS: ReadonlySet<ExprTokenKind> = new Set<ExprTokenKind>([
  'ident',
  'num',
  'str',
  'tmplStart',
  'kwTrue',
  'kwFalse',
  'kwNull',
  'kwUndef',
  'kwAwait',
  'lparen',
  'lbrace',
  'lbracket',
  'spread',
  'bang',
  'minus',
  // Slice 6 — `~x` can begin an expression (e.g. ternary consequent `c ? ~x : y`).
  'tilde',
]);

function isExprStartKind(kind: ExprTokenKind): boolean {
  return EXPR_START_KINDS.has(kind);
}

function isTypeAssertionBoundary(kind: ExprTokenKind): boolean {
  return (
    kind === 'comma' ||
    kind === 'rparen' ||
    kind === 'rbracket' ||
    kind === 'rbrace' ||
    kind === 'colon' ||
    kind === 'qmark' ||
    kind === 'nullish' ||
    kind === 'or' ||
    kind === 'and' ||
    kind === 'eq' ||
    kind === 'neq' ||
    kind === 'strictEq' ||
    kind === 'strictNeq' ||
    kind === 'plus' ||
    kind === 'minus' ||
    kind === 'star' ||
    kind === 'slash' ||
    kind === 'percent'
  );
}

function isTypeArgumentTokenKind(kind: ExprTokenKind): boolean {
  return (
    kind === 'ident' ||
    kind === 'kwNull' ||
    kind === 'kwUndef' ||
    kind === 'kwTrue' ||
    kind === 'kwFalse' ||
    kind === 'dot' ||
    kind === 'comma' ||
    kind === 'lt' ||
    kind === 'gt' ||
    kind === 'lbracket' ||
    kind === 'rbracket' ||
    kind === 'qmark'
  );
}

const KEYWORDS: Record<string, ExprTokenKind> = {
  null: 'kwNull',
  none: 'kwNull',
  undefined: 'kwUndef',
  true: 'kwTrue',
  false: 'kwFalse',
  await: 'kwAwait',
  // Slice 4c+4d review fix (Codex P2): `new` is prefix-position-only.
  // Tokenizing it as `kwNew` globally broke `obj.new` and `{ new: 1 }`
  // for property/key names. Now an `ident` token; parseUnary checks
  // `value === 'new'` to recognize the prefix-position usage.
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

/**
 * Decode a JS-style backslash escape starting at `input[i]` (must be `\`).
 * Caller is responsible for context-specific escapes (`\"`, `\'`, `` \` ``, `\$`);
 * this handles the universal table (`\n`, `\xHH`, `\uHHHH`, `\u{...}`, etc.).
 * For escapes not in the table, the backslash is dropped and the next char
 * is consumed verbatim — matching JS string-literal semantics.
 */
function consumeEscape(input: string, i: number): { value: string; advance: number } {
  const next = input[i + 1];
  switch (next) {
    case '\\':
      return { value: '\\', advance: 2 };
    case 'n':
      return { value: '\n', advance: 2 };
    case 't':
      return { value: '\t', advance: 2 };
    case 'r':
      return { value: '\r', advance: 2 };
    case 'b':
      return { value: '\b', advance: 2 };
    case 'f':
      return { value: '\f', advance: 2 };
    case 'v':
      return { value: '\v', advance: 2 };
    case '0': {
      const after = input[i + 2];
      if (after !== undefined && after >= '0' && after <= '9') {
        throw new Error(`Octal escapes are not supported at column ${i + 1}`);
      }
      return { value: '\0', advance: 2 };
    }
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
    case '9':
      throw new Error(`Legacy octal/decimal escapes (\\${next}) are not supported at column ${i + 1}`);
    case '\n':
      return { value: '', advance: 2 };
    case '\r':
      // CRLF is a single line continuation; consume both.
      return input[i + 2] === '\n' ? { value: '', advance: 3 } : { value: '', advance: 2 };
    case ' ':
    case ' ':
      return { value: '', advance: 2 };
    case 'x': {
      const hex = input.slice(i + 2, i + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new Error(`Invalid \\x escape at column ${i + 1}`);
      }
      return { value: String.fromCharCode(parseInt(hex, 16)), advance: 4 };
    }
    case 'u': {
      if (input[i + 2] === '{') {
        const close = input.indexOf('}', i + 3);
        if (close < 0) throw new Error(`Unterminated \\u{ escape at column ${i + 1}`);
        const hex = input.slice(i + 3, close);
        if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) {
          throw new Error(`Invalid \\u{} escape at column ${i + 1}`);
        }
        const cp = parseInt(hex, 16);
        if (cp > 0x10ffff) {
          throw new Error(`Codepoint out of range in \\u{} escape at column ${i + 1}`);
        }
        return { value: String.fromCodePoint(cp), advance: close + 1 - i };
      }
      const hex = input.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new Error(`Invalid \\u escape at column ${i + 1}`);
      }
      return { value: String.fromCharCode(parseInt(hex, 16)), advance: 6 };
    }
    default:
      return { value: next ?? '', advance: next === undefined ? 1 : 2 };
  }
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
        continue;
      }
      const { value: decoded, advance } = consumeEscape(input, i);
      value += decoded;
      i += advance;
    } else {
      value += input[i];
      i++;
    }
  }
  if (i >= input.length) throw new Error(`Unclosed string starting at column ${start + 1}`);
  return { end: i + 1, value };
}

function canStartRegex(tokens: ExprToken[]): boolean {
  const prev = tokens[tokens.length - 1];
  if (!prev) return true;
  if (prev.kind === 'bang') return isPrefixBang(tokens, tokens.length - 1);
  return (
    prev.kind === 'lparen' ||
    prev.kind === 'lbrace' ||
    prev.kind === 'lbracket' ||
    prev.kind === 'colon' ||
    prev.kind === 'comma' ||
    prev.kind === 'qmark' ||
    prev.kind === 'nullish' ||
    prev.kind === 'or' ||
    prev.kind === 'and' ||
    prev.kind === 'pipe' ||
    prev.kind === 'amp' ||
    // Slice 6 — a regex literal may follow a bitwise/shift operator or unary
    // `~` (operator position), e.g. `flags & /re/.source`.
    prev.kind === 'caret' ||
    prev.kind === 'shl' ||
    prev.kind === 'shr' ||
    prev.kind === 'ushr' ||
    prev.kind === 'tilde' ||
    prev.kind === 'eq' ||
    prev.kind === 'neq' ||
    prev.kind === 'strictEq' ||
    prev.kind === 'strictNeq' ||
    prev.kind === 'lt' ||
    prev.kind === 'lte' ||
    prev.kind === 'gt' ||
    prev.kind === 'gte' ||
    prev.kind === 'plus' ||
    prev.kind === 'minus' ||
    prev.kind === 'star' ||
    prev.kind === 'slash' ||
    prev.kind === 'percent' ||
    prev.kind === 'arrow' ||
    prev.kind === 'spread' ||
    prev.kind === 'kwAwait' ||
    (prev.kind === 'ident' && (prev.value === 'typeof' || prev.value === 'void'))
  );
}

function isPrefixBang(tokens: ExprToken[], bangIndex: number): boolean {
  const before = tokens[bangIndex - 1];
  if (!before) return true;
  if (before.kind === 'bang') return isPrefixBang(tokens, bangIndex - 1);
  return canStartRegex(tokens.slice(0, bangIndex));
}

function consumeRegex(input: string, start: number): { end: number; pattern: string; flags: string } {
  let i = start + 1;
  let pattern = '';
  let inClass = false;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      pattern += ch + input[i + 1];
      i += 2;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      pattern += ch;
      i++;
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      pattern += ch;
      i++;
      continue;
    }
    if (ch === '/' && !inClass) {
      i++;
      const flagsStart = i;
      while (i < input.length && isIdentChar(input[i])) i++;
      return { end: i, pattern, flags: input.slice(flagsStart, i) };
    }
    if (ch === '\n' || ch === '\r') throw new Error(`Unclosed regex literal starting at column ${start + 1}`);
    pattern += ch;
    i++;
  }
  throw new Error(`Unclosed regex literal starting at column ${start + 1}`);
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
      // `i` now points past the closing backtick — record it so position-math
      // (e.g. the type-assertion text scanner) sees the full template span,
      // not just the opening backtick.
      tokens.push({ kind: 'tmplStart', value: '`', pos: start, end: i });
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
    if (ch === '=' && input[i + 1] === '>') {
      tokens.push({ kind: 'arrow', value: '=>', pos: i });
      i += 2;
      continue;
    }
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
    // Slice 6 — shift operators. Longest-match: `<<` before `<=`/`<`; and on
    // the `>` side `>>>` before `>>` before `>=`/`>`. (Shift compound-assign
    // `<<=`/`>>=`/`>>>=` is out of slice scope — KERN expressions have no
    // assignment — so `<< =` would lex as `shl` then `eq`, and the parser
    // rejects it downstream, which is the intended fail-closed behavior.)
    if (ch === '<' && input[i + 1] === '<') {
      tokens.push({ kind: 'shl', value: '<<', pos: i });
      i += 2;
      continue;
    }
    if (ch === '>' && input[i + 1] === '>' && input[i + 2] === '>') {
      tokens.push({ kind: 'ushr', value: '>>>', pos: i });
      i += 3;
      continue;
    }
    if (ch === '>' && input[i + 1] === '>') {
      tokens.push({ kind: 'shr', value: '>>', pos: i });
      i += 2;
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
    if (ch === '/' && canStartRegex(tokens)) {
      const { end, pattern, flags } = consumeRegex(input, i);
      tokens.push({ kind: 'regex', value: `${pattern}\u0000${flags}`, pos: i, end });
      i = end;
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
    if (ch === '|') {
      tokens.push({ kind: 'pipe', value: '|', pos: i });
      i++;
      continue;
    }
    if (ch === '&' && input[i + 1] === '&') {
      tokens.push({ kind: 'and', value: '&&', pos: i });
      i += 2;
      continue;
    }
    if (ch === '&') {
      tokens.push({ kind: 'amp', value: '&', pos: i });
      i++;
      continue;
    }
    // Slice 6 — bitwise XOR `^` and bitwise NOT `~` (unary prefix). KERN has no
    // `^=`/`~=` (no assignment in expressions), so single-char is the only form.
    if (ch === '^') {
      tokens.push({ kind: 'caret', value: '^', pos: i });
      i++;
      continue;
    }
    if (ch === '~') {
      tokens.push({ kind: 'tilde', value: '~', pos: i });
      i++;
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
      // Block-bodied arrow capture (slices 0+1). When `{` immediately follows
      // an `arrow` token, the brace opens a statement block, not an object
      // literal — the expression tokenizer otherwise throws on statement-y
      // characters (`;`). Capture the whole `{ … }` (braces included) as ONE
      // `closureBlock` token with a quote-aware balanced-brace scanner. The
      // parse-time TS validation in `parseLambda` turns any miscapture into a
      // clean reject (fail-closed), never corruption.
      const prev = tokens[tokens.length - 1];
      if (prev && prev.kind === 'arrow') {
        const end = scanBalancedBlock(input, i);
        tokens.push({ kind: 'closureBlock', value: input.slice(i, end), pos: i, end });
        i = end;
        continue;
      }
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
      tokens.push({ kind: 'str', value, pos: i, end });
      // Preserve raw form for codegen quote-style preservation
      (tokens[tokens.length - 1] as ExprToken & { quote?: string }).quote = ch;
      i = end;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      while (i < input.length && isIdentChar(input[i])) i++;
      const word = input.slice(start, i);
      // `Object.hasOwn` guard: KEYWORDS is a plain object, so a bare
      // `KEYWORDS[word]` resolves inherited `Object.prototype` members
      // (`toString`, `valueOf`, `toLocaleString`, `hasOwnProperty`,
      // `constructor`, …) to truthy functions. That mis-tokenized any
      // property access or call named after a prototype method — e.g.
      // `x.toString()`, `Date.now().toString()`, `err.valueOf()` —
      // throwing `Expected ident, got function toString()`. Only own keys
      // are real keywords.
      const kw = Object.hasOwn(KEYWORDS, word) ? KEYWORDS[word] : undefined;
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
    const result = this.parseLambda();
    if (this.peek().kind !== 'eof') {
      const t = this.peek();
      throw new Error(`Unexpected token ${t.kind} ('${t.value}') at column ${t.pos + 1}`);
    }
    return result;
  }

  private parseLambda(): ValueIR {
    if (this.peek().kind === 'ident' && this.peek(1).kind === 'arrow') {
      const param = this.advance();
      this.advance();
      const params = [{ name: param.value }];
      if (this.peek().kind === 'closureBlock') {
        return this.buildBlockLambda(params, undefined, false);
      }
      return { kind: 'lambda', params, body: this.parseLambda(), parenthesized: false };
    }
    if (this.peek().kind === 'lparen' && this.isParenthesizedLambdaAhead()) {
      const params = this.parseLambdaParams();
      const returnType = this.peek().kind === 'colon' ? this.consumeLambdaReturnType() : undefined;
      this.expect('arrow');
      if (this.peek().kind === 'closureBlock') {
        return this.buildBlockLambda(params, returnType, true);
      }
      return { kind: 'lambda', params, returnType, body: this.parseLambda(), parenthesized: true };
    }
    return this.parseConditional();
  }

  /** Build a block-bodied arrow lambda (slices 0+1). Consumes the
   *  `closureBlock` token and validates the raw block at parse time:
   *   1. `parseClosureBlockAst` must succeed (TS parse) — else fail-closed.
   *   2. The v1 closure gate (`classifyClosureBlock`) must accept it — else
   *      fail-closed. A lambda with `bodyBlock` existing in the IR therefore
   *      implies it passed the gate; downstream emitters can trust it. */
  private buildBlockLambda(
    params: { name: string; type?: string }[],
    returnType: string | undefined,
    parenthesized: boolean,
  ): ValueIR {
    const tok = this.advance(); // closureBlock
    const raw = tok.value;
    if (parseClosureBlockAst(raw) === null) {
      throw new Error(
        `Unsupported closure body: the block at column ${tok.pos + 1} does not parse as a statement block.`,
      );
    }
    const reason = classifyClosureBlock(raw);
    if (reason !== null) {
      throw new Error(`Unsupported closure body (${reason}) at column ${tok.pos + 1}.`);
    }
    return { kind: 'lambda', params, returnType, bodyBlock: { raw }, parenthesized };
  }

  private isParenthesizedLambdaAhead(): boolean {
    let depth = 0;
    for (let j = this.i; j < this.tokens.length; j++) {
      const t = this.tokens[j];
      if (t.kind === 'lparen') depth++;
      else if (t.kind === 'rparen') {
        depth--;
        if (depth === 0) {
          const next = this.tokens[j + 1];
          if (next?.kind === 'arrow') return true;
          if (next?.kind !== 'colon') return false;
          let typeDepth = 0;
          for (let k = j + 2; k < this.tokens.length; k++) {
            const tk = this.tokens[k];
            if (tk.kind === 'lparen' || tk.kind === 'lbracket' || tk.kind === 'lbrace' || tk.kind === 'lt') {
              typeDepth++;
            } else if (tk.kind === 'rparen' || tk.kind === 'rbracket' || tk.kind === 'rbrace' || tk.kind === 'gt') {
              if (typeDepth === 0) return false;
              typeDepth--;
            } else if (tk.kind === 'arrow' && typeDepth === 0) {
              return true;
            } else if (tk.kind === 'eof' || (tk.kind === 'comma' && typeDepth === 0)) {
              return false;
            }
          }
          return false;
        }
      } else if (t.kind === 'eof') {
        return false;
      }
    }
    return false;
  }

  private parseLambdaParams(): { name: string; type?: string }[] {
    const params: { name: string; type?: string }[] = [];
    this.expect('lparen');
    if (this.peek().kind === 'rparen') {
      this.advance();
      return params;
    }
    while (true) {
      const name = this.expect('ident');
      let type: string | undefined;
      if (this.peek().kind === 'colon') {
        this.advance();
        type = this.consumeLambdaParamTypeText();
      }
      params.push(type ? { name: name.value, type } : { name: name.value });
      if (this.peek().kind !== 'comma') break;
      this.advance();
      if (this.peek().kind === 'rparen') break;
    }
    this.expect('rparen');
    return params;
  }

  private consumeLambdaReturnType(): string {
    const colon = this.expect('colon');
    const first = this.peek();
    const start = first.pos;
    let end = start;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let angleDepth = 0;
    while (true) {
      const t = this.peek();
      if (t.kind === 'eof') break;
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0 && t.kind === 'arrow') {
        break;
      }
      if (t.kind === 'lparen') parenDepth++;
      else if (t.kind === 'rparen') {
        if (parenDepth === 0) break;
        parenDepth--;
      } else if (t.kind === 'lbracket') bracketDepth++;
      else if (t.kind === 'rbracket') {
        if (bracketDepth === 0) break;
        bracketDepth--;
      } else if (t.kind === 'lbrace') braceDepth++;
      else if (t.kind === 'rbrace') {
        if (braceDepth === 0) break;
        braceDepth--;
      } else if (t.kind === 'lt') angleDepth++;
      else if (t.kind === 'gt') {
        if (angleDepth === 0) break;
        angleDepth--;
      }
      const advanced = this.advance();
      end = tokenEnd(advanced);
    }
    const text = this.input.slice(start, end).trim();
    if (text === '') throw new Error(`Expected return type after ':' at column ${colon.pos + 1}`);
    return text;
  }

  private consumeLambdaParamTypeText(): string {
    const first = this.peek();
    const start = first.pos;
    let end = start;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let angleDepth = 0;
    while (true) {
      const t = this.peek();
      if (t.kind === 'eof') break;
      if (
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0 &&
        angleDepth === 0 &&
        (t.kind === 'comma' || t.kind === 'rparen')
      ) {
        break;
      }
      if (t.kind === 'lparen') parenDepth++;
      else if (t.kind === 'rparen') {
        if (parenDepth === 0) break;
        parenDepth--;
      } else if (t.kind === 'lbracket') bracketDepth++;
      else if (t.kind === 'rbracket') {
        if (bracketDepth === 0) break;
        bracketDepth--;
      } else if (t.kind === 'lbrace') braceDepth++;
      else if (t.kind === 'rbrace') {
        if (braceDepth === 0) break;
        braceDepth--;
      } else if (t.kind === 'lt') angleDepth++;
      else if (t.kind === 'gt') {
        if (angleDepth === 0) break;
        angleDepth--;
      }
      const advanced = this.advance();
      end = tokenEnd(advanced);
    }
    const text = this.input.slice(start, end).trim();
    if (text === '') throw new Error(`Expected type after ':' at column ${first.pos + 1}`);
    return text;
  }

  // Slice α-2: ternary `test ? consequent : alternate`. Right-associative —
  // `a ? b : c ? d : e` parses as `a ? b : (c ? d : e)`. Lower precedence
  // than `??`/`||`/`&&`/binary ops, so it wraps `parseNullish`.
  //
  // Disambiguation with propagation `?`: parsePostfix and the await branch
  // of parseUnary both consume a postfix `?` when the next token is NOT an
  // expression-start. So when this method sees `?` at the top, it's
  // unambiguously a ternary `?` (the next token MUST be an expression-start
  // — otherwise parsePostfix would have consumed the `?` as propagation).
  private parseConditional(): ValueIR {
    const test = this.parseNullish();
    if (this.peek().kind !== 'qmark') return test;
    if (!isExprStartKind(this.peek(1).kind)) {
      // Defensive: shouldn't happen given the parsePostfix lookahead rule.
      const t = this.peek();
      throw new Error(
        `Unexpected '?' at column ${t.pos + 1}. Postfix '?' (propagation) is recognized inside expressions; ternary '?' must be followed by an expression then ':'.`,
      );
    }
    this.advance(); // consume `?`
    const consequent = this.parseLambda();
    this.expect('colon');
    const alternate = this.parseLambda();
    return { kind: 'conditional', test, consequent, alternate };
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
    let left = this.parseBitOr();
    while (this.peek().kind === 'and') {
      this.advance();
      const right = this.parseBitOr();
      left = { kind: 'binary', op: '&&', left, right };
    }
    return left;
  }

  // Slice 6 — bitwise OR `|`, left-associative. JS precedence: BELOW `&&`,
  // ABOVE `^`. So `1 | 2 && 0` parses `(1 | 2) && 0` (parseAnd wraps this) and
  // `1 ^ 3 | 4` parses `(1 ^ 3) | 4`.
  private parseBitOr(): ValueIR {
    let left = this.parseBitXor();
    while (this.peek().kind === 'pipe') {
      this.advance();
      const right = this.parseBitXor();
      left = { kind: 'binary', op: '|', left, right };
    }
    return left;
  }

  // Slice 6 — bitwise XOR `^`, left-associative. Between `|` and `&`.
  private parseBitXor(): ValueIR {
    let left = this.parseBitAnd();
    while (this.peek().kind === 'caret') {
      this.advance();
      const right = this.parseBitAnd();
      left = { kind: 'binary', op: '^', left, right };
    }
    return left;
  }

  // Slice 6 — bitwise AND `&`, left-associative. ABOVE `^`, BELOW equality, so
  // `1 & 3 === 1` parses `1 & (3 === 1)` (the equality binds tighter).
  private parseBitAnd(): ValueIR {
    let left = this.parseEquality();
    while (this.peek().kind === 'amp') {
      this.advance();
      const right = this.parseEquality();
      left = { kind: 'binary', op: '&', left, right };
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
  // `instanceof` shares relational precedence in JS. Like `as`/`new`, it stays
  // an `ident` token (never a reserved keyword kind) so it can't shadow a
  // property name (`obj.instanceof`) or object key (`{ instanceof: 1 }`); here,
  // in operator position after a complete operand, an `ident` named
  // `instanceof` can only be the operator.
  private parseRelational(): ValueIR {
    let left = this.parseShift();
    while (true) {
      const t = this.peek();
      if (t.kind === 'ident' && t.value === 'instanceof') {
        this.advance();
        const right = this.parseShift();
        left = { kind: 'binary', op: 'instanceof', left, right };
        continue;
      }
      const k = t.kind;
      if (k !== 'lt' && k !== 'lte' && k !== 'gt' && k !== 'gte') break;
      const op = this.advance().value as '<' | '<=' | '>' | '>=';
      const right = this.parseShift();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  // Slice 6 — shift (<<, >>, >>>), left-associative. JS precedence: ABOVE
  // additive, BELOW relational. So `1 + 2 << 3` parses `(1 + 2) << 3` and
  // `1 << 2 < 8` parses `(1 << 2) < 8`.
  private parseShift(): ValueIR {
    let left = this.parseAdditive();
    while (true) {
      const k = this.peek().kind;
      if (k !== 'shl' && k !== 'shr' && k !== 'ushr') break;
      const op = this.advance().value as '<<' | '>>' | '>>>';
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
    // Slice 6 — bitwise NOT `~`, same precedence level as the other unary
    // prefixes, right-recursive (so `~~x` and `~await f()` nest correctly).
    if (this.peek().kind === 'tilde') {
      this.advance();
      return { kind: 'unary', op: '~', argument: this.parseUnary() };
    }
    if (this.peek().kind === 'ident' && this.peek().value === 'typeof') {
      this.advance();
      return { kind: 'unary', op: 'typeof', argument: this.parseUnary() };
    }
    if (this.peek().kind === 'kwAwait') {
      this.advance();
      // Use parseCall (not parsePostfix) so the trailing `?` stays available
      // for the outer await + propagation composition. With parsePostfix the
      // `?` would bind to the call alone, producing `await(propagate(call()))`
      // instead of the semantically-correct `propagate(await(call()))`.
      const argument = this.parseCall();
      const awaited: ValueIR = { kind: 'await', argument };
      // Slice α-2: only consume postfix `?` as propagation if the token
      // after it is NOT an expression-start. Otherwise leave it for the
      // outer parseConditional (ternary).
      if (this.peek().kind === 'qmark' && !isExprStartKind(this.peek(1).kind)) {
        this.advance();
        return { kind: 'propagate', argument: awaited, op: '?' };
      }
      return awaited;
    }
    // Slice 4c+4d review fix (Codex P2) — match `new` only in prefix
    // position so `obj.new` and `{ new: 1 }` keep working as identifier
    // / property-name uses.
    if (this.peek().kind === 'ident' && this.peek().value === 'new') {
      this.advance();
      const argument = this.parseCall();
      return { kind: 'new', argument };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ValueIR {
    let node = this.parseCall();
    while (true) {
      if (this.peek().kind === 'ident' && this.peek().value === 'as') {
        this.advance();
        node = { kind: 'typeAssert', expression: node, type: this.consumeTypeAssertionText() };
        continue;
      }
      if (this.peek().kind === 'bang') {
        this.advance();
        node = { kind: 'nonNull', expression: node };
        continue;
      }
      break;
    }
    // Slice α-2: only consume postfix `?` as propagation if the token after
    // it is NOT an expression-start. Otherwise leave it for the outer
    // parseConditional (ternary).
    if (this.peek().kind === 'qmark' && !isExprStartKind(this.peek(1).kind)) {
      this.advance();
      return { kind: 'propagate', argument: node, op: '?' };
    }
    return node;
  }

  private consumeTypeAssertionText(): string {
    const first = this.peek();
    const start = first.pos;
    let end = start;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let angleDepth = 0;
    while (true) {
      const t = this.peek();
      if (t.kind === 'eof') break;
      if (
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0 &&
        angleDepth === 0 &&
        isTypeAssertionBoundary(t.kind)
      ) {
        break;
      }
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0) {
        if (t.kind === 'ident' && t.value === 'as') break;
        if (t.kind === 'lte' || t.kind === 'gte' || t.kind === 'gt') break;
        if (t.kind === 'lt' && end !== t.pos) break;
      }
      if (t.kind === 'lparen') parenDepth++;
      else if (t.kind === 'rparen') {
        if (parenDepth === 0) break;
        parenDepth--;
      } else if (t.kind === 'lbracket') bracketDepth++;
      else if (t.kind === 'rbracket') {
        if (bracketDepth === 0) break;
        bracketDepth--;
      } else if (t.kind === 'lbrace') braceDepth++;
      else if (t.kind === 'rbrace') {
        if (braceDepth === 0) break;
        braceDepth--;
      } else if (t.kind === 'lt') angleDepth++;
      else if (t.kind === 'gt') {
        if (angleDepth === 0) break;
        angleDepth--;
      }
      const advanced = this.advance();
      end = tokenEnd(advanced);
    }
    const text = this.input.slice(start, end).trim();
    if (text === '') throw new Error(`Expected type after 'as' at column ${first.pos + 1}`);
    return text;
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
        if (next.kind === 'lbracket') {
          this.advance();
          const index = this.parseLambda();
          this.expect('rbracket');
          node = { kind: 'index', object: node, index, optional: true };
        } else if (next.kind === 'lparen') {
          this.advance();
          const args = this.parseArgs();
          this.expect('rparen');
          node = { kind: 'call', callee: node, args, optional: true };
        } else {
          const name = this.expect('ident');
          node = { kind: 'member', object: node, property: name.value, optional: true };
        }
      } else if (t.kind === 'lt' && this.isTypeArgumentCallAhead()) {
        const typeArgs = this.consumeCallTypeArgsText();
        this.expect('lparen');
        const args = this.parseArgs();
        this.expect('rparen');
        node = { kind: 'call', callee: node, args, optional: false, typeArgs };
      } else if (t.kind === 'lparen') {
        this.advance();
        const args = this.parseArgs();
        this.expect('rparen');
        node = { kind: 'call', callee: node, args, optional: false };
      } else if (t.kind === 'lbracket') {
        this.advance();
        const index = this.parseLambda();
        this.expect('rbracket');
        node = { kind: 'index', object: node, index, optional: false };
      } else if (t.kind === 'bang') {
        this.advance();
        node = { kind: 'nonNull', expression: node };
      } else {
        break;
      }
    }
    return node;
  }

  private isTypeArgumentCallAhead(): boolean {
    if (this.peek().kind !== 'lt') return false;
    let angleDepth = 0;
    for (let j = this.i; j < this.tokens.length; j++) {
      const t = this.tokens[j];
      if (t.kind === 'lt') angleDepth++;
      else if (t.kind === 'gt') {
        angleDepth--;
        if (angleDepth === 0) return this.tokens[j + 1]?.kind === 'lparen';
      } else if (angleDepth > 0 && !isTypeArgumentTokenKind(t.kind)) {
        return false;
      } else if (t.kind === 'eof' || t.kind === 'rparen' || t.kind === 'rbracket' || t.kind === 'rbrace') {
        return false;
      }
    }
    return false;
  }

  private consumeCallTypeArgsText(): string {
    const startTok = this.expect('lt');
    const start = startTok.pos + startTok.value.length;
    let end = start;
    let angleDepth = 1;
    while (true) {
      const t = this.peek();
      if (t.kind === 'eof') throw new Error(`Unclosed type argument list at column ${startTok.pos + 1}`);
      if (t.kind === 'lt') angleDepth++;
      else if (t.kind === 'gt') {
        angleDepth--;
        if (angleDepth === 0) {
          end = t.pos;
          this.advance();
          break;
        }
      }
      if (angleDepth > 0) {
        const advanced = this.advance();
        end = tokenEnd(advanced);
      }
    }
    const text = this.input.slice(start, end).trim();
    if (text === '') throw new Error(`Expected type argument after '<' at column ${startTok.pos + 1}`);
    return text;
  }

  private parseArgs(): ValueIR[] {
    const args: ValueIR[] = [];
    if (this.peek().kind === 'rparen') return args;
    args.push(this.parseLambda());
    while (this.peek().kind === 'comma') {
      this.advance();
      if (this.peek().kind === 'rparen') break;
      args.push(this.parseLambda());
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
      case 'regex': {
        this.advance();
        const [pattern = '', flags = ''] = t.value.split('\u0000');
        return { kind: 'regexLit', pattern, flags };
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
        const inner = this.parseLambda();
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

  // Slice 2d — object literal: `{ key: value, "str-key": value, 0: value }`.
  // Computed keys (`[expr]:`) defer to slice 3.
  private parseObjectLiteral(): ValueIR {
    const entries: ({ key: string; rawKey?: string; value: ValueIR } | { kind: 'spread'; argument: ValueIR })[] = [];
    if (this.peek().kind === 'rbrace') {
      this.advance();
      return { kind: 'objectLit', entries };
    }
    while (true) {
      const keyTok = this.peek();
      if (keyTok.kind === 'spread') {
        this.advance();
        const argument = this.parseConditional();
        entries.push({ kind: 'spread', argument });
      } else {
        let key: string;
        let rawKey: string | undefined;
        let isIdentKey = false;
        if (keyTok.kind === 'ident') {
          key = keyTok.value;
          isIdentKey = true;
          this.advance();
        } else if (keyTok.kind === 'num') {
          key = keyTok.value.replace(/_/g, '');
          rawKey = keyTok.value;
          this.advance();
        } else if (keyTok.kind === 'str') {
          key = keyTok.value;
          this.advance();
        } else {
          throw new Error(
            `Object literal key must be an identifier, string, number, or spread at column ${keyTok.pos + 1}`,
          );
        }
        // Shorthand property: `{ user }` is equivalent to `{ user: user }`.
        // Only valid when the key is a bare identifier (string keys can't
        // be shorthand). Detect by what follows: comma or rbrace means
        // shorthand; colon means longhand.
        const nextKind = this.peek().kind;
        if (isIdentKey && (nextKind === 'comma' || nextKind === 'rbrace')) {
          entries.push({ key, value: { kind: 'ident', name: key } });
        } else {
          this.expect('colon');
          const value = this.parseLambda();
          entries.push(rawKey ? { key, rawKey, value } : { key, value });
        }
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
      items.push(this.parseLambda());
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
        if (next === '$') {
          buf += '$';
          pos += 2;
          continue;
        }
        const { value: decoded, advance } = consumeEscape(this.input, pos);
        buf += decoded;
        pos += advance;
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

/** Scan a balanced `{ … }` block starting at `input[start]` (which must be
 *  `{`), returning the source offset just past the matching `}`. Quote-aware
 *  with the same conventions as `splitTopLevelArgs` (packages/python core/expr):
 *  `'`, `"`, and `` ` `` quotes with `\` escapes are skipped so braces inside
 *  string/template literals don't affect the depth count. Template `${…}`
 *  substitutions are followed (so a `}` inside `${…}` doesn't close the block);
 *  a backtick inside a `${…}` is the documented v1 limitation — a miscapture
 *  there is turned into a clean REJECT by the parse-time TS validation in
 *  `parseLambda` (fail-closed), never a corruption. Throws if unbalanced. */
function scanBalancedBlock(input: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '"' || ch === "'") {
      // Skip a single-/double-quoted string with `\` escapes.
      const quote = ch;
      i++;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\') i += 2;
        else i++;
      }
      i++; // past the closing quote
      continue;
    }
    if (ch === '`') {
      // Template literal — `scanTemplateEnd` follows `${…}` substitutions and
      // `\` escapes, returning the offset past the closing backtick.
      i = scanTemplateEnd(input, i + 1);
      continue;
    }
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      i++;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  throw new Error(`Unclosed closure block starting at column ${start + 1}`);
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
