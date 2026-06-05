export type PortablePredicateCompareOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
export type PortablePredicateMembershipOp = 'in' | 'nin';
export type PortablePredicateStringOp = 'contains' | 'startsWith' | 'endsWith';
export type PortablePredicateExistsOp = 'exists';
export type PortablePredicateArrayOp = 'and' | 'or';
export type PortablePredicateUnaryOp = 'not';

export const PORTABLE_PREDICATE_COMPARE_OPS: readonly PortablePredicateCompareOp[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
];
export const PORTABLE_PREDICATE_ARRAY_OPS: readonly PortablePredicateArrayOp[] = ['and', 'or'];
export const PORTABLE_PREDICATE_UNARY_OPS: readonly PortablePredicateUnaryOp[] = ['not'];
export const PORTABLE_PREDICATE_EXISTS_OPS: readonly PortablePredicateExistsOp[] = ['exists'];
export const PORTABLE_PREDICATE_MEMBERSHIP_OPS: readonly PortablePredicateMembershipOp[] = ['in', 'nin'];
export const PORTABLE_PREDICATE_STRING_OPS: readonly PortablePredicateStringOp[] = [
  'contains',
  'startsWith',
  'endsWith',
];

export interface PortablePredicateParseResult {
  ok: boolean;
  value?: unknown;
}

export function parsePortablePredicateProp(predicateProp: unknown): PortablePredicateParseResult {
  const code = predicatePropSource(predicateProp).trim();
  if (!code) return { ok: false };

  try {
    const parser = new PredicateLiteralParser(code);
    const value = parser.parseValue();
    parser.skipWhitespace();
    if (!parser.done() || typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false };
    }
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

export function validatePortablePredicateAST(pred: unknown): string[] {
  const messages: string[] = [];
  validatePredicateAST(pred, messages);
  return messages;
}

function predicatePropSource(predicateProp: unknown): string {
  if (typeof predicateProp === 'object' && predicateProp !== null && (predicateProp as any).__expr) {
    return typeof (predicateProp as any).code === 'string' ? (predicateProp as any).code : '';
  }
  if (typeof predicateProp === 'string') return predicateProp;
  return '';
}

class PredicateLiteralParser {
  private index = 0;

  constructor(private readonly input: string) {}

  done(): boolean {
    return this.index >= this.input.length;
  }

  skipWhitespace(): void {
    while (this.index < this.input.length && /\s/.test(this.peek())) {
      this.index++;
    }
  }

  parseValue(): unknown {
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"' || ch === "'") return this.parseString();
    if (ch === '-' || isDigit(ch)) return this.parseNumber();

    const ident = this.parseIdentifier();
    if (ident === 'true') return true;
    if (ident === 'false') return false;
    if (ident === 'null') return null;
    throw new Error('dynamic predicate literal values are not supported');
  }

  private parseObject(): Record<string, unknown> {
    this.expect('{');
    const out: Record<string, unknown> = Object.create(null);
    this.skipWhitespace();
    if (this.consume('}')) return out;

    while (true) {
      this.skipWhitespace();
      const ch = this.peek();
      const key = ch === '"' || ch === "'" ? this.parseString() : this.parseIdentifier();
      if (Object.hasOwn(out, key)) {
        throw new Error(`duplicate object key ${key}`);
      }
      this.skipWhitespace();
      this.expect(':');
      out[key] = this.parseValue();
      this.skipWhitespace();
      if (this.consume('}')) return out;
      this.expect(',');
      this.skipWhitespace();
      if (this.consume('}')) return out;
    }
  }

  private parseArray(): unknown[] {
    this.expect('[');
    const out: unknown[] = [];
    this.skipWhitespace();
    if (this.consume(']')) return out;

    while (true) {
      out.push(this.parseValue());
      this.skipWhitespace();
      if (this.consume(']')) return out;
      this.expect(',');
      this.skipWhitespace();
      if (this.consume(']')) return out;
    }
  }

  private parseString(): string {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") throw new Error('expected string');
    this.index++;

    let out = '';
    while (this.index < this.input.length) {
      const ch = this.input[this.index++] ?? '';
      if (ch === quote) return out;
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      if (this.index >= this.input.length) throw new Error('unterminated escape');
      const escaped = this.input[this.index++] ?? '';
      switch (escaped) {
        case '"':
        case "'":
        case '\\':
        case '/':
          out += escaped;
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        case 'u': {
          const hex = this.input.slice(this.index, this.index + 4);
          if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw new Error('invalid unicode escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.index += 4;
          break;
        }
        default:
          throw new Error('invalid escape');
      }
    }
    throw new Error('unterminated string');
  }

  private parseNumber(): number {
    const start = this.index;
    if (this.peek() === '-') this.index++;

    if (this.peek() === '0') {
      this.index++;
    } else if (isDigitOneToNine(this.peek())) {
      while (isDigit(this.peek())) this.index++;
    } else {
      throw new Error('invalid number');
    }

    if (this.peek() === '.') {
      this.index++;
      if (!isDigit(this.peek())) throw new Error('invalid number');
      while (isDigit(this.peek())) this.index++;
    }

    const exp = this.peek();
    if (exp === 'e' || exp === 'E') {
      this.index++;
      const sign = this.peek();
      if (sign === '+' || sign === '-') this.index++;
      if (!isDigit(this.peek())) throw new Error('invalid number');
      while (isDigit(this.peek())) this.index++;
    }

    const value = Number(this.input.slice(start, this.index));
    if (!Number.isFinite(value)) throw new Error('non-finite number');
    return value;
  }

  private parseIdentifier(): string {
    const start = this.index;
    if (!/[A-Za-z_$]/.test(this.peek())) throw new Error('expected identifier');
    this.index++;
    while (/[A-Za-z0-9_$]/.test(this.peek())) this.index++;
    return this.input.slice(start, this.index);
  }

  private peek(): string {
    return this.input[this.index] ?? '';
  }

  private consume(ch: string): boolean {
    if (this.peek() !== ch) return false;
    this.index++;
    return true;
  }

  private expect(ch: string): void {
    if (!this.consume(ch)) throw new Error(`expected ${ch}`);
  }
}

function isDigit(ch: string): boolean {
  return /^[0-9]$/.test(ch);
}

function isDigitOneToNine(ch: string): boolean {
  return /^[1-9]$/.test(ch);
}

function validatePredicateAST(pred: unknown, messages: string[]): void {
  if (typeof pred !== 'object' || pred === null || Array.isArray(pred)) {
    messages.push('predicate must be an object');
    return;
  }

  const record = pred as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1) {
    messages.push('predicate objects must contain exactly one operator');
    return;
  }

  for (const key of keys) {
    if ((PORTABLE_PREDICATE_ARRAY_OPS as readonly string[]).includes(key)) {
      const val = record[key];
      if (!Array.isArray(val) || val.length === 0) {
        messages.push(`${key} expects a non-empty predicate array`);
        return;
      }
      for (const sub of val) {
        validatePredicateAST(sub, messages);
      }
    } else if ((PORTABLE_PREDICATE_UNARY_OPS as readonly string[]).includes(key)) {
      const val = record[key];
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        messages.push('not expects a predicate object');
        return;
      }
      validatePredicateAST(val, messages);
    } else if ((PORTABLE_PREDICATE_EXISTS_OPS as readonly string[]).includes(key)) {
      validatePredicatePath(record[key], messages, 'exists expects a predicate path string');
    } else if ((PORTABLE_PREDICATE_MEMBERSHIP_OPS as readonly string[]).includes(key)) {
      const val = record[key];
      if (!Array.isArray(val) || val.length !== 2 || !Array.isArray(val[1]) || val[1].length === 0) {
        messages.push(`${key} expects [path, non-empty scalar array]`);
        return;
      }
      const [path, expectedValues] = val;
      validatePredicatePath(path, messages);
      if (!(expectedValues as unknown[]).every(isPredicateScalar)) {
        messages.push(`${key} expects [path, non-empty scalar array]`);
      }
    } else if (key === 'contains') {
      const val = record[key];
      if (!Array.isArray(val) || val.length !== 2) {
        messages.push('contains expects [path, scalar expected]');
        return;
      }
      const [path, expected] = val;
      validatePredicatePath(path, messages);
      if (!isPredicateScalar(expected)) {
        messages.push('contains expects [path, scalar expected]');
      }
    } else if (key === 'startsWith' || key === 'endsWith') {
      const val = record[key];
      if (!Array.isArray(val) || val.length !== 2) {
        messages.push(`${key} expects [path, string expected]`);
        return;
      }
      const [path, expected] = val;
      validatePredicatePath(path, messages);
      if (typeof expected !== 'string') {
        messages.push(`${key} expects [path, string expected]`);
      }
    } else if ((PORTABLE_PREDICATE_COMPARE_OPS as readonly string[]).includes(key)) {
      const val = record[key];
      if (!Array.isArray(val) || val.length !== 2) {
        messages.push(`${key} expects [path, expected]`);
        return;
      }
      const [path, expected] = val;
      validatePredicatePath(path, messages);
      if (!isPredicateScalar(expected)) {
        messages.push(`${key} expects a scalar expected value`);
      }
      if (['lt', 'lte', 'gt', 'gte'].includes(key) && (typeof expected !== 'number' || !Number.isFinite(expected))) {
        messages.push(`${key} expects a non-boolean number`);
      }
    } else {
      messages.push(`unsupported operator '${key}'`);
    }
  }
}

function validatePredicatePath(
  path: unknown,
  messages: string[],
  typeMessage = 'predicate path must be a non-empty string',
): void {
  if (typeof path !== 'string' || path.trim() === '') {
    messages.push(typeMessage);
    return;
  }
  const segments = path.split('.');
  if (segments.some((seg) => seg === '')) {
    messages.push(`predicate path '${path}' must not contain empty segments`);
  }
  for (const seg of segments) {
    if (/^\d+$/.test(seg) && !/^(0|[1-9]\d*)$/.test(seg)) {
      messages.push(`predicate path '${path}' must use canonical decimal indexes`);
    }
  }
}

function isPredicateScalar(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return value === null || ['string', 'boolean'].includes(typeof value);
}
